/**
 * 연습 시도 기록의 요약과 연구용 추출 — 저장소를 읽지 않는 순수 함수(논문 v12).
 *
 * 연구 흐름
 *   1. 학생이 연습 36문항에 쓰고, 피드백을 보고 다시 쓴다(제출마다 한 건씩 저장된다).
 *   2. 연구자가 A·B·C 밴드에서 대표 문항을 하나씩, 모두 셋을 고른다.
 *   3. 고른 문항의 학생 × 문항 요약에서 부적절한 행을 제외하고, 앱 AI 5수준별로 문항마다
 *      n개(기본 4)를 고정 시드로 무작위 추출한다(3 × 5 × 4 = 60).
 *   4. 60개를 AI 평가 에이전트와 전문가가 따로 채점한다(이 앱 밖).
 *
 * 지키는 것
 *   - 요약은 저장된 기록에서 계산한다. AI로 문장을 요약하지 않고 원문을 바꾸지 않는다.
 *   - 결측 점수는 0점이 아니라 null이다. 분포·평균에 넣지 않고 따로 센다.
 *   - 추출은 시드와 후보 목록만으로 다시 만들 수 있어야 한다. 층(문항×수준)마다 시드에서
 *     갈라 낸 난수를 써서 문항을 고르는 순서가 결과를 바꾸지 않게 한다.
 *   - researchId만 쓴다. 실명·출석번호·학교명은 입력에도 출력에도 없다.
 *
 * 배선(권한·Firestore·동의 조회·저장)은 src/server/admin/research-actions.ts가 맡는다.
 */

import { bandOf, type Band } from '@/lib/scoring';
import { isResearchConsentActive, type ConsentRecord, type ConsentState } from '@/lib/research/types';
import { createSeededRandom } from './completeness';
import { toCsv, type CsvColumn } from './csv';

/* ────────────────────────── 앱 AI 5수준 ────────────────────────── */

/**
 * 앱 AI 5수준의 산정 규칙. 총점(0~100)은 밴드 배점으로 가중한 축별 (수준−1)/4의 합이므로
 * 1 + 4 × 총점/100은 축 수준의 가중 평균이다. 이를 반올림(0.5는 올림)해 1~5로 둔다.
 * 반올림 전 값도 함께 내보내 연구자가 다른 구간으로 다시 나눌 수 있게 한다.
 */
export const APP_LEVEL_RULE =
  '앱 AI 5수준 = round_half_up(1 + 4 × 총점/100). 총점은 밴드 배점으로 가중한 축별 (수준−1)/4의 합(0~100).';

export function appLevelRawOf(totalScore: number | null): number | null {
  if (totalScore === null || !Number.isFinite(totalScore)) return null;
  return 1 + (4 * totalScore) / 100;
}

export function appLevelOf(totalScore: number | null): number | null {
  const raw = appLevelRawOf(totalScore);
  if (raw === null) return null;
  // 부동소수 오차로 2.4999…가 2가 되지 않게 아주 작은 값을 더한다.
  return Math.min(5, Math.max(1, Math.floor(raw + 0.5 + 1e-9)));
}

/* ────────────────────────── 시도 한 건 ────────────────────────── */

export interface PracticeAttempt {
  submissionId: string;
  schemaVersion: string | null;
  researchId: string;
  classResearchId: string | null;
  questionId: string;
  level: number;
  chasi: number | null;
  band: Band;
  attemptNo: number | null;
  text: string;
  feedbackText: string | null;
  feedbackStatus: string | null;
  scoreStatus: 'scored' | 'missing';
  totalScore: number | null;
  objectLevel: number | null;
  specificityLevel: number | null;
  contextLevel: number | null;
  appLevel: number | null;
  appLevelRaw: number | null;
  modelId: string | null;
  promptHash: string | null;
  rubricVersion: string | null;
  cueVersion: string | null;
  imageHash: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  durationMs: number | null;
  responseStatus: string | null;
  missingReason: string | null;
  persistStatus: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const PRACTICE_ID = /^L(\d{2})$/;

/**
 * 저장된 연습 제출 문서를 시도 한 건으로 옮긴다. 옛 문서도 읽는다(없는 필드는 null).
 * 연구ID가 없거나(일반 체험) 연습 문항이 아니거나 제출되지 않은 문서는 null이다.
 */
export function toPracticeAttempt(id: string, raw: Record<string, unknown>): PracticeAttempt | null {
  const researchId = str(raw.researchId);
  const questionId = str(raw.questionId);
  if (!researchId || !questionId) return null;
  if (raw.sessionType === 'experience') return null;
  const m = PRACTICE_ID.exec(questionId);
  if (!m) return null;
  if (raw.responseStatus !== undefined && raw.responseStatus !== 'submitted') return null;
  if (raw.persistStatus === 'failed' || raw.persistStatus === 'rejected_duplicate') return null;

  const level = num(raw.questionLevel) ?? Number(m[1]);
  const scoring = (raw.scoring ?? null) as {
    result?: {
      status?: unknown;
      score?: unknown;
      levels?: { objectLevel?: unknown; specificityLevel?: unknown; contextLevel?: unknown } | null;
    } | null;
    feedback?: { text?: unknown; status?: unknown } | null;
    modelId?: unknown;
    promptHash?: unknown;
  } | null;
  const result = scoring?.result ?? null;
  const scored = result?.status === 'scored' && num(result.score) !== null;
  const totalScore = scored ? num(result?.score) : null;
  const band = raw.band === 'A' || raw.band === 'B' || raw.band === 'C' ? raw.band : bandOf(level);

  return {
    submissionId: str(raw.submissionId) ?? id,
    schemaVersion: str(raw.schemaVersion),
    researchId,
    classResearchId: str(raw.classResearchId),
    questionId,
    level,
    chasi: num(raw.lesson),
    band,
    attemptNo: num(raw.attemptNo),
    text: typeof raw.text === 'string' ? raw.text : '',
    feedbackText: str(scoring?.feedback?.text),
    feedbackStatus: str(scoring?.feedback?.status),
    scoreStatus: scored ? 'scored' : 'missing',
    totalScore,
    objectLevel: scored ? num(result?.levels?.objectLevel) : null,
    specificityLevel: scored ? num(result?.levels?.specificityLevel) : null,
    contextLevel: scored ? num(result?.levels?.contextLevel) : null,
    appLevel: appLevelOf(totalScore),
    appLevelRaw: appLevelRawOf(totalScore),
    modelId: str(scoring?.modelId),
    promptHash: str(scoring?.promptHash),
    rubricVersion: str(raw.rubricVersion),
    cueVersion: str(raw.cueVersion),
    imageHash: str(raw.imageHash),
    startedAt: str(raw.startedAt),
    submittedAt: str(raw.submittedAt) ?? str(raw.createdAt),
    durationMs: num(raw.durationMs),
    responseStatus: str(raw.responseStatus),
    missingReason: str(raw.missingReason),
    persistStatus: str(raw.persistStatus),
  };
}

/** 시도 순서. 제출 시각이 먼저이고, 같으면 시도 번호·제출ID 순이다. */
function byAttemptOrder(a: PracticeAttempt, b: PracticeAttempt): number {
  return (
    (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') ||
    (a.attemptNo ?? 0) - (b.attemptNo ?? 0) ||
    a.submissionId.localeCompare(b.submissionId)
  );
}

/* ────────────────────────── 동의 ────────────────────────── */

function consentState(v: unknown): ConsentState {
  return v === 'granted' || v === 'declined' || v === 'withdrawn' ? v : 'unknown';
}

/** consents 문서가 지금 연구 수집을 허락하는가(보호자 동의 + 학생 승낙, 철회 없음). */
export function isConsentDocActive(researchId: string, data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  const record: ConsentRecord = {
    researchId,
    guardianConsent: consentState(data.guardianConsent),
    studentAssent: consentState(data.studentAssent),
    consentVersion: str(data.consentVersion),
    updatedAt: str(data.updatedAt) ?? '',
    withdrawnAt: str(data.withdrawnAt),
  };
  return isResearchConsentActive(record);
}

/* ────────────────────────── 가. 학생 × 문항 ────────────────────────── */

/** 피드백 목록의 구분자(요청서 그대로). */
export const FEEDBACK_SEPARATOR = ' | ';
/** 피드백이 없던 시도의 자리 표시. 원문을 지어내지 않는다. */
export const NO_FEEDBACK_MARK = '(피드백 없음)';

export interface StudentQuestionSummary {
  researchId: string;
  classResearchId: string | null;
  questionId: string;
  level: number;
  chasi: number | null;
  band: Band;
  attemptCount: number;
  firstSubmissionId: string;
  finalSubmissionId: string;
  firstPrompt: string;
  finalPrompt: string;
  firstTotalScore: number | null;
  firstAppLevel: number | null;
  finalTotalScore: number | null;
  finalAppLevel: number | null;
  finalAppLevelRaw: number | null;
  finalObjectLevel: number | null;
  finalSpecificityLevel: number | null;
  finalContextLevel: number | null;
  /** 시도 순서대로 받은 피드백 원문. 구분자는 FEEDBACK_SEPARATOR. */
  feedbacks: string;
  firstSubmittedAt: string | null;
  finalSubmittedAt: string | null;
  /** 점수가 결측인 시도 수 */
  missingScoreCount: number;
  /** 최종 시도의 점수가 결측인가 */
  finalScoreMissing: boolean;
}

export function summarizeStudentQuestions(attempts: readonly PracticeAttempt[]): StudentQuestionSummary[] {
  const groups = new Map<string, PracticeAttempt[]>();
  for (const a of attempts) {
    const key = `${a.researchId}\u0000${a.questionId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const rows: StudentQuestionSummary[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort(byAttemptOrder);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    rows.push({
      researchId: first.researchId,
      classResearchId: first.classResearchId,
      questionId: first.questionId,
      level: first.level,
      chasi: first.chasi,
      band: first.band,
      attemptCount: sorted.length,
      firstSubmissionId: first.submissionId,
      finalSubmissionId: last.submissionId,
      firstPrompt: first.text,
      finalPrompt: last.text,
      firstTotalScore: first.totalScore,
      firstAppLevel: first.appLevel,
      finalTotalScore: last.totalScore,
      finalAppLevel: last.appLevel,
      finalAppLevelRaw: last.appLevelRaw,
      finalObjectLevel: last.objectLevel,
      finalSpecificityLevel: last.specificityLevel,
      finalContextLevel: last.contextLevel,
      feedbacks: sorted.map((a) => a.feedbackText ?? NO_FEEDBACK_MARK).join(FEEDBACK_SEPARATOR),
      firstSubmittedAt: first.submittedAt,
      finalSubmittedAt: last.submittedAt,
      missingScoreCount: sorted.filter((a) => a.scoreStatus !== 'scored').length,
      finalScoreMissing: last.scoreStatus !== 'scored',
    });
  }
  return rows.sort(
    (a, b) => a.questionId.localeCompare(b.questionId) || a.researchId.localeCompare(b.researchId)
  );
}

/* ────────────────────────── 나. 문항 ────────────────────────── */

export interface QuestionSummary {
  questionId: string;
  level: number;
  chasi: number;
  band: Band;
  students: number;
  /** 제출 학생이 없으면 null(0이 아니다). 반올림하지 않는다. */
  meanAttempts: number | null;
  /** 최종 프롬프트의 앱 AI 5수준별 인원. 결측은 넣지 않는다. */
  finalLevelCounts: [number, number, number, number, number];
  /** 최종 시도의 점수가 결측인 학생 수 */
  finalMissing: number;
}

/** 36문항 모두 한 줄씩 낸다. 제출이 없는 문항도 0명으로 남는다. */
export function summarizeQuestions(rows: readonly StudentQuestionSummary[]): QuestionSummary[] {
  const out: QuestionSummary[] = [];
  for (let level = 1; level <= 36; level += 1) {
    const questionId = `L${String(level).padStart(2, '0')}`;
    const mine = rows.filter((r) => r.questionId === questionId);
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const r of mine) if (r.finalAppLevel !== null) counts[r.finalAppLevel - 1] += 1;
    out.push({
      questionId,
      level,
      chasi: Math.ceil(level / 6),
      band: bandOf(level),
      students: mine.length,
      meanAttempts: mine.length ? mine.reduce((s, r) => s + r.attemptCount, 0) / mine.length : null,
      finalLevelCounts: counts,
      finalMissing: mine.filter((r) => r.finalScoreMissing).length,
    });
  }
  return out;
}

/* ────────────────────────── 다. 제외 표시 ────────────────────────── */

export const EXCLUSION_REASONS = ['irrelevant', 'personal_info'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  irrelevant: '무관한 내용',
  personal_info: '개인정보 포함',
};

export function isExclusionReason(v: unknown): v is ExclusionReason {
  return typeof v === 'string' && (EXCLUSION_REASONS as readonly string[]).includes(v);
}

export interface ExclusionMark {
  researchId: string;
  questionId: string;
  reason: ExclusionReason;
  note: string | null;
  markedAt: string;
}

/** 학생 × 문항 한 행의 키. 문서 ID로 쓸 수 있도록 '/'를 남기지 않는다. */
export function exclusionKey(researchId: string, questionId: string): string {
  return `${encodeURIComponent(researchId)}__${questionId}`;
}

/* ────────────────────────── 다. 층화 무작위 추출 ────────────────────────── */

export const DEFAULT_PER_LEVEL = 4;
export const MAX_PER_LEVEL = 9;
export const MAX_SAMPLE_QUESTIONS = 3;

export interface SampleStratum {
  questionId: string;
  level: number;
  /** 제외·결측을 뺀 뒤의 후보 수 */
  candidates: number;
  drawn: number;
  /** 후보가 모자라 채우지 못한 수. 다른 층에서 끌어오지 않는다. */
  shortfall: number;
}

export interface SampleCase {
  /** {문항번호}-{수준}{순번}. 예: L01의 3수준 첫째 → 01-31 */
  caseId: string;
  questionId: string;
  level: number;
  sequence: number;
  row: StudentQuestionSummary;
}

export interface SampleResult {
  cases: SampleCase[];
  strata: SampleStratum[];
  /** 고른 문항의 행 가운데 제외 표시로 뺀 수 */
  excludedCount: number;
  /** 최종 점수가 결측이라 어느 층에도 들지 못한 수 */
  unlevelledCount: number;
}

export function caseIdOf(questionId: string, level: number, sequence: number): string {
  const m = PRACTICE_ID.exec(questionId);
  return `${m ? m[1] : questionId}-${level}${sequence}`;
}

/** 입력 검사. 문제가 있으면 화면에 보여 줄 문구, 없으면 null. */
export function sampleInputProblem(input: {
  questionIds: readonly string[];
  perLevel: number;
  seed: string;
}): string | null {
  const ids = [...new Set(input.questionIds)];
  if (ids.length === 0) return '문항을 골라 주세요.';
  if (ids.length > MAX_SAMPLE_QUESTIONS) return `문항은 ${MAX_SAMPLE_QUESTIONS}개까지 고를 수 있습니다.`;
  if (ids.length !== input.questionIds.length) return '같은 문항을 두 번 골랐습니다.';
  if (ids.some((id) => !PRACTICE_ID.exec(id) || Number(id.slice(1)) < 1 || Number(id.slice(1)) > 36)) {
    return '연습 문항(L01~L36)만 고를 수 있습니다.';
  }
  if (!Number.isInteger(input.perLevel) || input.perLevel < 1 || input.perLevel > MAX_PER_LEVEL) {
    // 사례 ID의 순번이 한 자리여야 01-31 같은 형식이 흔들리지 않는다.
    return `수준마다 뽑을 수는 1~${MAX_PER_LEVEL} 사이여야 합니다.`;
  }
  const seed = input.seed.trim();
  if (!seed || seed.length > 100) return '시드를 1~100자로 적어 주세요.';
  return null;
}

/**
 * 문항 × 앱 AI 5수준으로 층을 나눠 층마다 perLevel개를 무작위로 뽑는다.
 *
 *   - 후보: 고른 문항의 학생 × 문항 요약 가운데 제외 표시가 없고 최종 수준이 있는 행
 *   - 순서: 후보를 연구ID·최종 제출ID 순으로 정렬한 뒤 `${seed}|${문항}|${수준}` 난수로 섞는다
 *   - 모자라면 있는 만큼만 뽑고 shortfall로 남긴다(다른 층에서 채우지 않는다)
 */
export function drawStratifiedSample(input: {
  rows: readonly StudentQuestionSummary[];
  questionIds: readonly string[];
  perLevel: number;
  seed: string;
  excludedKeys: ReadonlySet<string>;
}): SampleResult {
  const problem = sampleInputProblem(input);
  if (problem) throw new Error(problem);

  const questionIds = [...input.questionIds].sort();
  const seed = input.seed.trim();
  const cases: SampleCase[] = [];
  const strata: SampleStratum[] = [];
  let excludedCount = 0;
  let unlevelledCount = 0;

  for (const questionId of questionIds) {
    const inQuestion = input.rows.filter((r) => r.questionId === questionId);
    const kept = inQuestion.filter((r) => {
      const excluded = input.excludedKeys.has(exclusionKey(r.researchId, r.questionId));
      if (excluded) excludedCount += 1;
      return !excluded;
    });
    unlevelledCount += kept.filter((r) => r.finalAppLevel === null).length;

    for (let level = 1; level <= 5; level += 1) {
      const pool = kept
        .filter((r) => r.finalAppLevel === level)
        .sort(
          (a, b) =>
            a.researchId.localeCompare(b.researchId) ||
            a.finalSubmissionId.localeCompare(b.finalSubmissionId)
        );
      const rand = createSeededRandom(`${seed}|${questionId}|${level}`);
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const drawn = pool.slice(0, input.perLevel);
      drawn.forEach((row, index) => {
        cases.push({
          caseId: caseIdOf(questionId, level, index + 1),
          questionId,
          level,
          sequence: index + 1,
          row,
        });
      });
      strata.push({
        questionId,
        level,
        candidates: pool.length,
        drawn: drawn.length,
        shortfall: input.perLevel - drawn.length,
      });
    }
  }
  return { cases, strata, excludedCount, unlevelledCount };
}

/* ────────────────────────── CSV ────────────────────────── */

export const ATTEMPT_COLUMNS: CsvColumn<PracticeAttempt>[] = [
  { key: 'research_id', get: (r) => r.researchId },
  { key: 'class_research_id', get: (r) => r.classResearchId },
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'level', get: (r) => r.level },
  { key: 'chasi', get: (r) => r.chasi },
  { key: 'band', get: (r) => r.band },
  { key: 'attempt_no', get: (r) => r.attemptNo },
  { key: 'submission_id', get: (r) => r.submissionId },
  { key: 'text', get: (r) => r.text },
  { key: 'feedback_text', get: (r) => r.feedbackText },
  { key: 'feedback_status', get: (r) => r.feedbackStatus },
  { key: 'score_status', get: (r) => r.scoreStatus },
  { key: 'total_score', get: (r) => r.totalScore },
  { key: 'object_level', get: (r) => r.objectLevel },
  { key: 'specificity_level', get: (r) => r.specificityLevel },
  { key: 'context_level', get: (r) => r.contextLevel },
  { key: 'app_level', get: (r) => r.appLevel },
  { key: 'app_level_raw', get: (r) => r.appLevelRaw },
  { key: 'model_id', get: (r) => r.modelId },
  { key: 'prompt_hash', get: (r) => r.promptHash },
  { key: 'rubric_version', get: (r) => r.rubricVersion },
  { key: 'cue_version', get: (r) => r.cueVersion },
  { key: 'image_hash', get: (r) => r.imageHash },
  { key: 'started_at', get: (r) => r.startedAt },
  { key: 'submitted_at', get: (r) => r.submittedAt },
  { key: 'duration_ms', get: (r) => r.durationMs },
  { key: 'response_status', get: (r) => r.responseStatus },
  { key: 'missing_reason', get: (r) => r.missingReason },
  { key: 'persist_status', get: (r) => r.persistStatus },
  { key: 'schema_version', get: (r) => r.schemaVersion },
];

const STUDENT_QUESTION_BASE: CsvColumn<StudentQuestionSummary>[] = [
  { key: 'research_id', get: (r) => r.researchId },
  { key: 'class_research_id', get: (r) => r.classResearchId },
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'level', get: (r) => r.level },
  { key: 'chasi', get: (r) => r.chasi },
  { key: 'band', get: (r) => r.band },
  { key: 'attempt_count', get: (r) => r.attemptCount },
  { key: 'first_prompt', get: (r) => r.firstPrompt },
  { key: 'final_prompt', get: (r) => r.finalPrompt },
  { key: 'first_total_score', get: (r) => r.firstTotalScore },
  { key: 'first_app_level', get: (r) => r.firstAppLevel },
  { key: 'final_total_score', get: (r) => r.finalTotalScore },
  { key: 'final_app_level', get: (r) => r.finalAppLevel },
  { key: 'final_app_level_raw', get: (r) => r.finalAppLevelRaw },
  { key: 'final_object_level', get: (r) => r.finalObjectLevel },
  { key: 'final_specificity_level', get: (r) => r.finalSpecificityLevel },
  { key: 'final_context_level', get: (r) => r.finalContextLevel },
  { key: 'feedbacks', get: (r) => r.feedbacks },
  { key: 'first_submitted_at', get: (r) => r.firstSubmittedAt },
  { key: 'final_submitted_at', get: (r) => r.finalSubmittedAt },
  { key: 'missing_score_count', get: (r) => r.missingScoreCount },
  { key: 'final_score_missing', get: (r) => r.finalScoreMissing },
  { key: 'first_submission_id', get: (r) => r.firstSubmissionId },
  { key: 'final_submission_id', get: (r) => r.finalSubmissionId },
];

export const STUDENT_QUESTION_COLUMNS = STUDENT_QUESTION_BASE;

/** 추출 후보 행: 요약에 제외 표시와 개인정보 의심 여부를 붙인 것. */
export interface ExtractionRow extends StudentQuestionSummary {
  exclusion: ExclusionMark | null;
  /** 최종 프롬프트가 전송 전 개인정보 점검에 걸리는가. 표시일 뿐 자동 제외가 아니다. */
  piiSuspected: boolean;
}

export const EXTRACTION_COLUMNS: CsvColumn<ExtractionRow>[] = [
  ...(STUDENT_QUESTION_BASE as CsvColumn<ExtractionRow>[]),
  { key: 'excluded', get: (r) => r.exclusion !== null },
  { key: 'exclusion_reason', get: (r) => r.exclusion?.reason ?? null },
  { key: 'exclusion_note', get: (r) => r.exclusion?.note ?? null },
  { key: 'pii_suspected', get: (r) => r.piiSuspected },
];

export const QUESTION_SUMMARY_COLUMNS: CsvColumn<QuestionSummary>[] = [
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'level', get: (r) => r.level },
  { key: 'chasi', get: (r) => r.chasi },
  { key: 'band', get: (r) => r.band },
  { key: 'students', get: (r) => r.students },
  { key: 'mean_attempts', get: (r) => r.meanAttempts },
  { key: 'final_level_1', get: (r) => r.finalLevelCounts[0] },
  { key: 'final_level_2', get: (r) => r.finalLevelCounts[1] },
  { key: 'final_level_3', get: (r) => r.finalLevelCounts[2] },
  { key: 'final_level_4', get: (r) => r.finalLevelCounts[3] },
  { key: 'final_level_5', get: (r) => r.finalLevelCounts[4] },
  { key: 'final_missing', get: (r) => r.finalMissing },
];

export interface SampleCsvRow {
  sampleId: string;
  seed: string;
  item: SampleCase;
}

export const SAMPLE_COLUMNS: CsvColumn<SampleCsvRow>[] = [
  { key: 'case_id', get: (r) => r.item.caseId },
  { key: 'question_id', get: (r) => r.item.questionId },
  { key: 'band', get: (r) => r.item.row.band },
  { key: 'app_level', get: (r) => r.item.level },
  { key: 'sequence', get: (r) => r.item.sequence },
  { key: 'research_id', get: (r) => r.item.row.researchId },
  { key: 'final_prompt', get: (r) => r.item.row.finalPrompt },
  { key: 'final_total_score', get: (r) => r.item.row.finalTotalScore },
  { key: 'final_app_level_raw', get: (r) => r.item.row.finalAppLevelRaw },
  { key: 'final_object_level', get: (r) => r.item.row.finalObjectLevel },
  { key: 'final_specificity_level', get: (r) => r.item.row.finalSpecificityLevel },
  { key: 'final_context_level', get: (r) => r.item.row.finalContextLevel },
  { key: 'attempt_count', get: (r) => r.item.row.attemptCount },
  { key: 'final_submission_id', get: (r) => r.item.row.finalSubmissionId },
  { key: 'final_submitted_at', get: (r) => r.item.row.finalSubmittedAt },
  { key: 'sample_id', get: (r) => r.sampleId },
  { key: 'seed', get: (r) => r.seed },
];

export const buildAttemptCsv = (rows: readonly PracticeAttempt[]) => toCsv(rows, ATTEMPT_COLUMNS);
export const buildStudentQuestionCsv = (rows: readonly StudentQuestionSummary[]) =>
  toCsv(rows, STUDENT_QUESTION_COLUMNS);
export const buildExtractionCsv = (rows: readonly ExtractionRow[]) => toCsv(rows, EXTRACTION_COLUMNS);
export const buildQuestionSummaryCsv = (rows: readonly QuestionSummary[]) =>
  toCsv(rows, QUESTION_SUMMARY_COLUMNS);
export const buildSampleCsv = (sampleId: string, seed: string, cases: readonly SampleCase[]) =>
  toCsv(
    cases.map((item) => ({ sampleId, seed, item })),
    SAMPLE_COLUMNS
  );
