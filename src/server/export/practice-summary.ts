/**
 * 연습 시도 기록의 요약과 연구용 추출 — 저장소를 읽지 않는 순수 함수(논문 v12, 공통 루브릭 v12-2).
 *
 * 연구 흐름
 *   1. 학생이 연습 36문항에 쓰고, 피드백을 보고 다시 쓴다(제출마다 한 건씩 저장된다).
 *   2. 연구자가 A·B·C 밴드에서 대표 문항을 하나씩, 모두 셋을 고른다.
 *   3. 고른 문항의 학생 × 문항 요약에서 부적절한 행을 제외하고, 앱 종합 4수준별로 문항마다
 *      n개(기본 5)를 고정 시드로 무작위 추출한다(3 × 4 × 5 = 60).
 *   4. 60개를 AI 평가 에이전트와 전문가가 따로 채점한다(이 앱 밖).
 *
 * 채점 기준(v12-2)
 *   - 영역 3개(대상·특징·관계)를 정수 1~4 또는 'not_applicable'로 판정한다. 100점·밴드 배점은 없다.
 *   - 앱 종합 수준 = 해당 영역 수준의 평균(not_applicable 제외)을 반올림(0.5 올림)한 1~4
 *     (@/lib/scoring의 overallLevelOf·APP_LEVEL_RULE이 정한다. 여기서 다시 정의하지 않는다).
 *
 * 옛 v7 기록(축별 5수준·100점)
 *   - 연구자용 시도별 CSV에만 legacy_rubric=true와 옛 값(v7_* 열)으로 남긴다(옛 기록 보존용, 지우지 않는다).
 *   - 학생 × 문항 요약·문항 요약·추출에서는 뺀다. 옛 5수준을 새 4수준으로 옮기거나 지어내지 않는다.
 *     뺀 수는 따로 센다(countLegacyAttempts, 행마다 legacyAttemptCount).
 *   - 요약·추출·교사 화면에는 옛 수준·100점 숫자를 싣지 않는다(논문 v12-2 B1·H2).
 *     옛 5수준 추출 결과(schemaVersion 'v12-extraction-1')는 다시 내보내지 않는다.
 *
 * 지키는 것
 *   - 요약은 저장된 기록에서 계산한다. AI로 문장을 요약하지 않고 원문을 바꾸지 않는다.
 *   - 결측은 0점이나 1수준이 아니라 null이다. 분포·평균에 넣지 않고 따로 센다.
 *     'not_applicable'(해당 없음)과 결측(null)을 섞지 않는다. CSV에서도 "not_applicable"과 NA로 갈린다.
 *   - 추출은 시드와 후보 목록만으로 다시 만들 수 있어야 한다. 층(문항×수준)마다 시드에서
 *     갈라 낸 난수를 써서 문항을 고르는 순서가 결과를 바꾸지 않게 한다.
 *   - researchId만 쓴다. 실명·출석번호·학교명은 입력에도 출력에도 없다.
 *
 * 배선(권한·Firestore·동의 조회·저장)은 src/server/admin/research-actions.ts가 맡는다.
 */

import {
  AREA_IDS,
  bandOf,
  overallLevelOf,
  overallLevelRaw,
  parseAreaLevel,
  type AreaId,
  type AreaJudgment,
  type AreaJudgments,
  type AreaLevel,
  type AreaLevels,
  type AreaLevelValue,
  type Band,
} from '@/lib/scoring';
import { chasiOfLevel } from '@/lib/stages';
import { isResearchConsentActive, type ConsentRecord, type ConsentState } from '@/lib/research/types';
import { isLegacyPracticeRecord } from '@/server/lessons/store-core';
import { createSeededRandom } from './completeness';
import { toCsv, type CsvCell, type CsvColumn } from './csv';

/* ────────────────────────── 앱 종합 4수준 ────────────────────────── */

/** 추출 층의 수준. 앱 종합 수준(overallLevelOf)의 값 범위와 같다. */
export const APP_LEVELS: readonly AreaLevel[] = [1, 2, 3, 4];

/* ────────────────────────── 시도 한 건 ────────────────────────── */

export interface PracticeAttempt {
  submissionId: string;
  schemaVersion: string | null;
  researchId: string;
  classResearchId: string | null;
  questionId: string;
  level: number;
  /** 저장된 차시(lesson) 그대로. 옛 기록은 옛 단계 번호일 수 있다. 없으면 null. */
  chasi: number | null;
  band: Band;
  attemptNo: number | null;
  /** 제시 순서를 건너뛴 제출(99-1 B3). 판정 전 옛 문서·일반 수업은 null */
  outOfOrder: boolean | null;
  text: string;
  feedbackText: string | null;
  feedbackStatus: string | null;
  /** 옛 v7 기록(축별 5수준·100점)인가. true면 요약·추출에서 빠진다. */
  legacyRubric: boolean;
  /** 저장된 채점 결과의 상태. 옛 기록도 옛 결과의 상태를 그대로 적는다. */
  scoreStatus: 'scored' | 'missing';
  /** v12-2 영역별 판정(수준·근거·빠진 정보). 결측이거나 옛 기록이면 null. */
  areas: AreaJudgments | null;
  /** 영역 수준. null은 결측(또는 옛 기록), 'not_applicable'은 해당 없음. */
  objectLevel: AreaLevelValue | null;
  featureLevel: AreaLevelValue | null;
  relationLevel: AreaLevelValue | null;
  /** 앱 종합 수준(1~4)과 반올림 전 값. 결측·옛 기록이면 null. */
  appLevel: AreaLevel | null;
  appLevelRaw: number | null;
  /**
   * 옛 v7 값. 새 기록이면 모두 null. 옛 수준은 반수준(2.5)일 수 있어 그대로 둔다.
   * 연구자용 시도별 CSV(옛 기록 보존)에만 나가고 요약·추출에는 쓰지 않는다.
   */
  v7TotalScore: number | null;
  v7ObjectLevel: number | null;
  v7SpecificityLevel: number | null;
  v7ContextLevel: number | null;
  /** 설정한 모델 ID */
  modelId: string | null;
  /** 모델 API가 밝힌, 점수를 낸 실제 모델. 옛 기록에는 없다. */
  servedModel: string | null;
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
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const PRACTICE_ID = /^L(\d{2})$/;

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string') ? [...(v as string[])] : null;
}

/**
 * 저장된 v12-2 채점 결과에서 영역 판정을 읽는다. 채점된 결과이고 세 영역 모두 형식이 맞을 때만
 * 돌려준다. 하나라도 어긋나면 null(결측)이다. 빈 영역을 1수준·해당 없음으로 채우지 않는다.
 */
function readAreas(result: unknown): AreaJudgments | null {
  if (!isObject(result) || result.status !== 'scored' || !isObject(result.areas)) return null;
  const out: Partial<AreaJudgments> = {};
  for (const area of AREA_IDS) {
    const block = result.areas[area];
    if (!isObject(block)) return null;
    const level = parseAreaLevel(block.level);
    if (level === null) return null;
    let evidence: string | null = null;
    if (typeof block.evidence === 'string') evidence = block.evidence ? block.evidence : null;
    else if (block.evidence !== null && block.evidence !== undefined) return null;
    const missing = stringArray(block.missing);
    if (missing === null) return null;
    const evidenceMissing = block.evidenceMissing === undefined ? [] : stringArray(block.evidenceMissing);
    if (evidenceMissing === null) return null;
    const judgment: AreaJudgment = { level, evidence, missing, evidenceMissing };
    out[area] = judgment;
  }
  return out as AreaJudgments;
}

/**
 * 저장된 연습 제출 문서를 시도 한 건으로 옮긴다. 옛 v7 문서도 읽는다(없는 필드는 null).
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
  const scoring = isObject(raw.scoring) ? raw.scoring : null;
  const result = scoring && isObject(scoring.result) ? scoring.result : null;
  const feedback = scoring && isObject(scoring.feedback) ? scoring.feedback : null;
  const band = raw.band === 'A' || raw.band === 'B' || raw.band === 'C' ? raw.band : bandOf(level);
  const legacyRubric = isLegacyPracticeRecord(raw);

  // 옛 v7 결과: 100점과 축별 5수준. 새 영역 수준으로 옮기지 않고 시도별 CSV에만 옛 값 그대로 남긴다.
  const legacyScored = legacyRubric && result?.status === 'scored' && num(result.score) !== null;
  const legacyLevels = legacyScored && isObject(result?.levels) ? result.levels : null;

  // 새 v12-2 결과: 영역별 판정.
  const areas = legacyRubric ? null : readAreas(result);
  const levels: AreaLevels | null = areas
    ? { object: areas.object.level, feature: areas.feature.level, relation: areas.relation.level }
    : null;

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
    outOfOrder: typeof raw.outOfOrder === 'boolean' ? raw.outOfOrder : null,
    text: typeof raw.text === 'string' ? raw.text : '',
    feedbackText: str(feedback?.text),
    feedbackStatus: str(feedback?.status),
    legacyRubric,
    scoreStatus: (legacyRubric ? legacyScored : areas !== null) ? 'scored' : 'missing',
    areas,
    objectLevel: levels?.object ?? null,
    featureLevel: levels?.feature ?? null,
    relationLevel: levels?.relation ?? null,
    appLevel: overallLevelOf(levels),
    appLevelRaw: overallLevelRaw(levels),
    v7TotalScore: legacyScored ? num(result?.score) : null,
    v7ObjectLevel: num(legacyLevels?.objectLevel),
    v7SpecificityLevel: num(legacyLevels?.specificityLevel),
    v7ContextLevel: num(legacyLevels?.contextLevel),
    modelId: str(scoring?.modelId),
    servedModel: str(scoring?.servedModel),
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

/** 요약·추출에서 뺀 옛 v7 시도 수 */
export function countLegacyAttempts(attempts: readonly PracticeAttempt[]): number {
  return attempts.filter((a) => a.legacyRubric).length;
}

function levelsOfAttempt(a: PracticeAttempt): AreaLevels | null {
  if (a.objectLevel === null || a.featureLevel === null || a.relationLevel === null) return null;
  return { object: a.objectLevel, feature: a.featureLevel, relation: a.relationLevel };
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

/** 피드백 목록의 구분자(요청서 그대로). 피드백 한 건은 네 문장을 줄바꿈으로 이은 원문이다. */
export const FEEDBACK_SEPARATOR = ' | ';
/** 피드백이 없던 시도의 자리 표시. 원문을 지어내지 않는다. */
export const NO_FEEDBACK_MARK = '(피드백 없음)';

export interface StudentQuestionSummary {
  researchId: string;
  classResearchId: string | null;
  questionId: string;
  level: number;
  /** 현재 6단계 배치의 단계(chasiOfLevel). 3·4단계가 문항 번호 순서와 다르다. */
  chasi: number | null;
  band: Band;
  /** v12-2 시도 수(옛 v7 시도는 넣지 않는다) */
  attemptCount: number;
  /** 같은 학생 × 문항에서 요약에서 뺀 옛 v7 시도 수 */
  legacyAttemptCount: number;
  firstSubmissionId: string;
  finalSubmissionId: string;
  firstPrompt: string;
  finalPrompt: string;
  /** 첫 시도의 영역 수준. 결측이면 null. */
  firstLevels: AreaLevels | null;
  firstAppLevel: AreaLevel | null;
  /** 최종 시도의 영역 수준. 결측이면 null. */
  finalLevels: AreaLevels | null;
  finalAppLevel: AreaLevel | null;
  finalAppLevelRaw: number | null;
  /** 최종 시도의 영역별 근거·빠진 정보(전문가가 맥락을 보도록). 결측이면 null. */
  finalAreas: AreaJudgments | null;
  /** 시도 순서대로 받은 피드백 원문. 구분자는 FEEDBACK_SEPARATOR. */
  feedbacks: string;
  firstSubmittedAt: string | null;
  finalSubmittedAt: string | null;
  /** 점수가 결측인 시도 수 */
  missingScoreCount: number;
  /** 최종 시도의 점수가 결측인가 */
  finalScoreMissing: boolean;
  finalRubricVersion: string | null;
  finalModelId: string | null;
  finalServedModel: string | null;
}

/**
 * 학생 × 문항 한 행씩 요약한다. 옛 v7 시도는 넣지 않는다. 옛 시도만 있는 학생 × 문항은 행이 없다.
 */
export function summarizeStudentQuestions(attempts: readonly PracticeAttempt[]): StudentQuestionSummary[] {
  const groups = new Map<string, { current: PracticeAttempt[]; legacy: number }>();
  for (const a of attempts) {
    const key = `${a.researchId}\u0000${a.questionId}`;
    let g = groups.get(key);
    if (!g) {
      g = { current: [], legacy: 0 };
      groups.set(key, g);
    }
    if (a.legacyRubric) g.legacy += 1;
    else g.current.push(a);
  }
  const rows: StudentQuestionSummary[] = [];
  for (const g of groups.values()) {
    if (!g.current.length) continue;
    const sorted = [...g.current].sort(byAttemptOrder);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    rows.push({
      researchId: first.researchId,
      classResearchId: first.classResearchId,
      questionId: first.questionId,
      level: first.level,
      chasi: chasiOfLevel(first.level),
      band: first.band,
      attemptCount: sorted.length,
      legacyAttemptCount: g.legacy,
      firstSubmissionId: first.submissionId,
      finalSubmissionId: last.submissionId,
      firstPrompt: first.text,
      finalPrompt: last.text,
      firstLevels: levelsOfAttempt(first),
      firstAppLevel: first.appLevel,
      finalLevels: levelsOfAttempt(last),
      finalAppLevel: last.appLevel,
      finalAppLevelRaw: last.appLevelRaw,
      finalAreas: last.areas,
      feedbacks: sorted.map((a) => a.feedbackText ?? NO_FEEDBACK_MARK).join(FEEDBACK_SEPARATOR),
      firstSubmittedAt: first.submittedAt,
      finalSubmittedAt: last.submittedAt,
      missingScoreCount: sorted.filter((a) => a.scoreStatus !== 'scored').length,
      finalScoreMissing: last.scoreStatus !== 'scored',
      finalRubricVersion: last.rubricVersion,
      finalModelId: last.modelId,
      finalServedModel: last.servedModel,
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
  /** 현재 6단계 배치의 단계(chasiOfLevel) */
  chasi: number | null;
  band: Band;
  students: number;
  /** 제출 학생이 없으면 null(0이 아니다). 반올림하지 않는다. */
  meanAttempts: number | null;
  /** 최종 프롬프트의 앱 종합 4수준별 인원. 결측은 넣지 않는다. */
  finalLevelCounts: [number, number, number, number];
  /** 영역별 최종 수준 평균. 해당 없음·결측은 빼고, 남는 학생이 없으면 null. 반올림하지 않는다. */
  finalAreaMeans: Record<AreaId, number | null>;
  /** 영역별로 최종 시도가 해당 없음(not_applicable)인 학생 수 */
  finalAreaNotApplicable: Record<AreaId, number>;
  /** 최종 시도의 점수가 결측인 학생 수 */
  finalMissing: number;
}

/** 36문항 모두 한 줄씩 낸다(L01~L36 순). 제출이 없는 문항도 0명으로 남는다. */
export function summarizeQuestions(rows: readonly StudentQuestionSummary[]): QuestionSummary[] {
  const out: QuestionSummary[] = [];
  for (let level = 1; level <= 36; level += 1) {
    const questionId = `L${String(level).padStart(2, '0')}`;
    const mine = rows.filter((r) => r.questionId === questionId);
    const counts: [number, number, number, number] = [0, 0, 0, 0];
    for (const r of mine) if (r.finalAppLevel !== null) counts[r.finalAppLevel - 1] += 1;
    const means = {} as Record<AreaId, number | null>;
    const notApplicable = {} as Record<AreaId, number>;
    for (const area of AREA_IDS) {
      const values = mine
        .map((r) => r.finalLevels?.[area])
        .filter((v): v is AreaLevel => typeof v === 'number');
      means[area] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
      notApplicable[area] = mine.filter((r) => r.finalLevels?.[area] === 'not_applicable').length;
    }
    out.push({
      questionId,
      level,
      chasi: chasiOfLevel(level),
      band: bandOf(level),
      students: mine.length,
      meanAttempts: mine.length ? mine.reduce((s, r) => s + r.attemptCount, 0) / mine.length : null,
      finalLevelCounts: counts,
      finalAreaMeans: means,
      finalAreaNotApplicable: notApplicable,
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

export const DEFAULT_PER_LEVEL = 5;
/** 사례 ID의 순번이 한 자리여야 {문항번호}-{수준}{순번} 형식이 흔들리지 않는다. */
export const MAX_PER_LEVEL = 9;
export const MAX_SAMPLE_QUESTIONS = 3;

/**
 * 추출 기록(research/v7.0/extraction_samples)의 형식 버전.
 * v12-2-extraction-1: 앱 종합 4수준(v12-2) 층, 행에 영역별 수준·근거·빠진 정보.
 * 그 전의 'v12-extraction-1'은 앱 AI 5수준(v7 100점 환산) 층이다. 다시 내보내지 않는다.
 */
export const SAMPLE_SCHEMA_VERSION = 'v12-2-extraction-1';

/** 저장된 추출 기록이 옛 5수준 추출인가(형식 버전이 지금 값이 아니면 옛 기록으로 본다). 옛 추출은 내보내지 않는다. */
export function isLegacySampleDoc(data: { schemaVersion?: unknown } | null | undefined): boolean {
  return data?.schemaVersion !== SAMPLE_SCHEMA_VERSION;
}

export interface SampleStratum {
  questionId: string;
  level: AreaLevel;
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
  level: AreaLevel;
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
  /** 문항·사유별로 뺀 수(제외 표시 사유, 최종 결측). 동의 없는 학생 수는 배선에서 더한다. */
  exclusionCounts: ExclusionCount[];
}

/**
 * 추출에서 뺀 수 한 줄. 사유:
 *   irrelevant     무관한 내용(제외 표시)
 *   personal_info  개인정보 포함(제외 표시)
 *   no_consent     동의(보호자 동의 + 학생 승낙)가 지금 유효하지 않은 학생
 *   final_missing  최종 시도의 채점이 결측이라 종합 수준이 없음
 */
export type ExclusionCountReason =
  | ExclusionReason
  | 'no_consent'
  | 'final_missing'
  | 'no_consent_after_draw'
  | 'excluded_after_draw';

export interface ExclusionCount {
  questionId: string;
  reason: ExclusionCountReason;
  count: number;
}

export const EXCLUSION_COUNT_LABEL: Record<ExclusionCountReason, string> = {
  irrelevant: '무관한 내용',
  personal_info: '개인정보 포함',
  no_consent: '동의 없음·철회',
  final_missing: '최종 채점 결측',
  no_consent_after_draw: '추출 뒤 동의 철회(내보내기에서 뺌)',
  excluded_after_draw: '추출 뒤 제외 표시(내보내기에서 뺌)',
};

/** 추출 뒤에 빠져야 하는 사례의 까닭: 지금 동의가 유효하지 않음 / 지금 제외 표시가 있음 */
export type WithheldReason = 'no_consent' | ExclusionReason;

/**
 * 저장된 추출 사례 가운데 지금 기준으로 내보내거나 다시 채점하면 안 되는 사례(사례 ID → 까닭).
 * 추출 뒤에 동의를 철회했거나 제외 표시(무관·개인정보)를 단 행이다. 동의가 우선한다.
 */
export function withheldCasesOf(
  cases: readonly SampleCase[],
  activeConsent: ReadonlySet<string>,
  exclusions: ReadonlyMap<string, ExclusionReason>
): Map<string, WithheldReason> {
  const out = new Map<string, WithheldReason>();
  for (const c of cases) {
    if (!activeConsent.has(c.row.researchId)) out.set(c.caseId, 'no_consent');
    else {
      const reason = exclusions.get(exclusionKey(c.row.researchId, c.questionId));
      if (reason) out.set(c.caseId, reason);
    }
  }
  return out;
}

/** 추출 뒤에 빠진 사례를 문항 × 까닭으로 센다(뺀 수 파일에 덧붙인다). */
export function withheldCounts(cases: readonly SampleCase[], withheld: ReadonlyMap<string, WithheldReason>): ExclusionCount[] {
  const counts = new Map<string, ExclusionCount>();
  for (const c of cases) {
    const why = withheld.get(c.caseId);
    if (!why) continue;
    const reason: ExclusionCountReason = why === 'no_consent' ? 'no_consent_after_draw' : 'excluded_after_draw';
    const key = `${c.questionId}|${reason}`;
    const cur = counts.get(key) ?? { questionId: c.questionId, reason, count: 0 };
    cur.count += 1;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => a.questionId.localeCompare(b.questionId) || a.reason.localeCompare(b.reason));
}

/**
 * 뺀 수를 문항·사유별로 담지 않은 예전 추출 기록(이 기능 전의 v12-2 추출)에서 뺀 수를 다시 만든다.
 * 제외 목록(exclusions)은 문항·사유별로, 결측·동의 없음은 문항을 가를 수 없어 문항 'ALL'로 합계만 낸다.
 */
export function exclusionCountsFromStoredSample(data: Record<string, unknown>): ExclusionCount[] {
  if (Array.isArray(data.exclusionCounts)) return data.exclusionCounts as ExclusionCount[];
  const counts = new Map<string, ExclusionCount>();
  for (const e of Array.isArray(data.exclusions) ? data.exclusions : []) {
    const row = e as { questionId?: unknown; reason?: unknown };
    if (typeof row.questionId !== 'string' || !isExclusionReason(row.reason)) continue;
    const key = `${row.questionId}|${row.reason}`;
    const cur = counts.get(key) ?? { questionId: row.questionId, reason: row.reason, count: 0 };
    cur.count += 1;
    counts.set(key, cur);
  }
  const out = [...counts.values()];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  out.push({ questionId: 'ALL', reason: 'final_missing', count: num(data.unlevelledCount) });
  out.push({ questionId: 'ALL', reason: 'no_consent', count: num(data.consentExcludedStudents) });
  return out;
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
    return `수준마다 뽑을 수는 1~${MAX_PER_LEVEL} 사이여야 합니다.`;
  }
  const seed = input.seed.trim();
  if (!seed || seed.length > 100) return '시드를 1~100자로 적어 주세요.';
  return null;
}

/**
 * 고른 문항이 A·B·C밴드에서 하나씩인지 본다(논문 v12-2: 대표 사진은 밴드마다 하나).
 * 막지는 않고 경고 문구만 돌려준다. 맞으면 null.
 */
export function bandCoverageWarning(questionIds: readonly string[]): string | null {
  const bands = questionIds
    .filter((id) => PRACTICE_ID.exec(id))
    .map((id) => bandOf(Number(id.slice(1))))
    .sort();
  if (bands.join('') === 'ABC') return null;
  const label = bands.length ? bands.join('·') : '없음';
  return `대표 문항은 A·B·C밴드에서 하나씩 고르는 것이 논문의 절차입니다. 지금 고른 밴드: ${label}.`;
}

/**
 * 대표 문항 설정값(RESEARCH_SAMPLE_QUESTIONS, 쉼표로 구분한 문항 ID)을 읽는다.
 * 비어 있으면(미정) 빈 목록. L01~L36 밖의 값·중복·네 개 이상이면 쓰지 않고 빈 목록과 문제 문구를 돌려준다.
 */
export function parseRepresentativeQuestions(raw: string | null | undefined): { questionIds: string[]; problem: string | null } {
  const ids = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!ids.length) return { questionIds: [], problem: null };
  const problem = sampleInputProblem({ questionIds: ids, perLevel: DEFAULT_PER_LEVEL, seed: 'x' });
  if (problem) return { questionIds: [], problem: `대표 문항 설정값이 올바르지 않습니다: ${problem}` };
  return { questionIds: [...ids].sort(), problem: null };
}

/**
 * 문항 × 앱 종합 4수준으로 층을 나눠 층마다 perLevel개를 무작위로 뽑는다.
 *
 *   - 후보: 고른 문항의 학생 × 문항 요약 가운데 제외 표시가 없고 최종 종합 수준이 있는 행
 *     (옛 v7 시도는 요약 단계에서 이미 빠져 있다)
 *   - 순서: 후보를 연구ID·최종 제출ID 순으로 정렬한 뒤 `${seed}|${문항}|${수준}` 난수로 섞는다
 *   - 모자라면 있는 만큼만 뽑고 shortfall로 남긴다(다른 층에서 채우지 않는다)
 */
export function drawStratifiedSample(input: {
  rows: readonly StudentQuestionSummary[];
  questionIds: readonly string[];
  perLevel: number;
  seed: string;
  excludedKeys: ReadonlySet<string>;
  /** 제외 키 → 사유. 없으면 사유별 수에서 '무관한 내용'으로 센다. */
  exclusionReasons?: ReadonlyMap<string, ExclusionReason>;
}): SampleResult {
  const problem = sampleInputProblem(input);
  if (problem) throw new Error(problem);

  const questionIds = [...input.questionIds].sort();
  const seed = input.seed.trim();
  const cases: SampleCase[] = [];
  const strata: SampleStratum[] = [];
  const exclusionCounts: ExclusionCount[] = [];
  let excludedCount = 0;
  let unlevelledCount = 0;

  for (const questionId of questionIds) {
    const inQuestion = input.rows.filter((r) => r.questionId === questionId);
    const byReason = new Map<ExclusionReason, number>();
    const kept = inQuestion.filter((r) => {
      const key = exclusionKey(r.researchId, r.questionId);
      const excluded = input.excludedKeys.has(key);
      if (excluded) {
        excludedCount += 1;
        const reason = input.exclusionReasons?.get(key) ?? 'irrelevant';
        byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
      }
      return !excluded;
    });
    const unlevelled = kept.filter((r) => r.finalAppLevel === null).length;
    unlevelledCount += unlevelled;
    for (const reason of EXCLUSION_REASONS) {
      exclusionCounts.push({ questionId, reason, count: byReason.get(reason) ?? 0 });
    }
    exclusionCounts.push({ questionId, reason: 'final_missing', count: unlevelled });

    for (const level of APP_LEVELS) {
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
  return { cases, strata, excludedCount, unlevelledCount, exclusionCounts };
}

/* ────────────────────────── CSV ────────────────────────── */

/**
 * 영역 수준 한 칸. 'not_applicable'은 문자열 "not_applicable"로, 결측(null)은 NA로 쓴다.
 * 둘을 섞지 않는다.
 */
function levelCell(v: AreaLevelValue | null | undefined): CsvCell {
  return v ?? null;
}

/** 목록 한 칸. 빈 목록은 "[]"(빠진 것 없음), 결측은 NA. 항목 안의 구분자와 섞이지 않게 JSON으로 쓴다. */
function listCell(v: readonly string[] | null | undefined): CsvCell {
  return Array.isArray(v) ? JSON.stringify(v) : null;
}

/** 영역별 수준 열 셋(prefix_object_level …) */
function areaLevelColumns<T>(prefix: string, get: (row: T) => AreaLevels | null | undefined): CsvColumn<T>[] {
  return AREA_IDS.map((area) => ({
    key: `${prefix}${area}_level`,
    get: (row: T) => levelCell(get(row)?.[area]),
  }));
}

/** 영역별 근거·빠진 정보·확인할 수 없던 정보 열(prefix_object_evidence …) */
function areaDetailColumns<T>(
  prefix: string,
  get: (row: T) => AreaJudgments | null | undefined,
  withEvidenceMissing: boolean
): CsvColumn<T>[] {
  return AREA_IDS.flatMap((area) => {
    const k = `${prefix}${area}`;
    const cols: CsvColumn<T>[] = [
      { key: `${k}_evidence`, get: (row: T) => get(row)?.[area]?.evidence ?? null },
      { key: `${k}_missing`, get: (row: T) => listCell(get(row)?.[area]?.missing) },
    ];
    if (withEvidenceMissing) {
      cols.push({ key: `${k}_evidence_missing`, get: (row: T) => listCell(get(row)?.[area]?.evidenceMissing) });
    }
    return cols;
  });
}

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
  { key: 'legacy_rubric', get: (r) => r.legacyRubric },
  { key: 'score_status', get: (r) => r.scoreStatus },
  ...areaLevelColumns<PracticeAttempt>('', (r) => levelsOfAttempt(r)),
  { key: 'app_level', get: (r) => r.appLevel },
  { key: 'app_level_raw', get: (r) => r.appLevelRaw },
  ...areaDetailColumns<PracticeAttempt>('', (r) => r.areas, true),
  // 옛 기록 보존용(연구자용 시도 CSV에만). 요약·추출 CSV에는 없다.
  { key: 'v7_total_score', get: (r) => r.v7TotalScore },
  { key: 'v7_object_level', get: (r) => r.v7ObjectLevel },
  { key: 'v7_specificity_level', get: (r) => r.v7SpecificityLevel },
  { key: 'v7_context_level', get: (r) => r.v7ContextLevel },
  { key: 'model_id', get: (r) => r.modelId },
  { key: 'served_model', get: (r) => r.servedModel },
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
  { key: 'legacy_attempt_count', get: (r) => r.legacyAttemptCount },
  { key: 'first_prompt', get: (r) => r.firstPrompt },
  { key: 'final_prompt', get: (r) => r.finalPrompt },
  ...areaLevelColumns<StudentQuestionSummary>('first_', (r) => r.firstLevels),
  { key: 'first_app_level', get: (r) => r.firstAppLevel },
  ...areaLevelColumns<StudentQuestionSummary>('final_', (r) => r.finalLevels),
  { key: 'final_app_level', get: (r) => r.finalAppLevel },
  { key: 'final_app_level_raw', get: (r) => r.finalAppLevelRaw },
  ...areaDetailColumns<StudentQuestionSummary>('final_', (r) => r.finalAreas, true),
  { key: 'feedbacks', get: (r) => r.feedbacks },
  { key: 'first_submitted_at', get: (r) => r.firstSubmittedAt },
  { key: 'final_submitted_at', get: (r) => r.finalSubmittedAt },
  { key: 'missing_score_count', get: (r) => r.missingScoreCount },
  { key: 'final_score_missing', get: (r) => r.finalScoreMissing },
  { key: 'first_submission_id', get: (r) => r.firstSubmissionId },
  { key: 'final_submission_id', get: (r) => r.finalSubmissionId },
  { key: 'final_rubric_version', get: (r) => r.finalRubricVersion },
  { key: 'final_model_id', get: (r) => r.finalModelId },
  { key: 'final_served_model', get: (r) => r.finalServedModel },
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
  { key: 'final_missing', get: (r) => r.finalMissing },
  ...AREA_IDS.map(
    (area): CsvColumn<QuestionSummary> => ({
      key: `final_${area}_mean`,
      get: (r) => r.finalAreaMeans[area],
    })
  ),
  ...AREA_IDS.map(
    (area): CsvColumn<QuestionSummary> => ({
      key: `final_${area}_not_applicable`,
      get: (r) => r.finalAreaNotApplicable[area],
    })
  ),
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
  { key: 'final_app_level_raw', get: (r) => r.item.row.finalAppLevelRaw },
  ...areaLevelColumns<SampleCsvRow>('final_', (r) => r.item.row.finalLevels),
  ...areaDetailColumns<SampleCsvRow>('final_', (r) => r.item.row.finalAreas, false),
  { key: 'chasi', get: (r) => r.item.row.chasi },
  { key: 'attempt_count', get: (r) => r.item.row.attemptCount },
  { key: 'final_submission_id', get: (r) => r.item.row.finalSubmissionId },
  { key: 'final_submitted_at', get: (r) => r.item.row.finalSubmittedAt },
  { key: 'final_rubric_version', get: (r) => r.item.row.finalRubricVersion },
  { key: 'sample_id', get: (r) => r.sampleId },
  { key: 'seed', get: (r) => r.seed },
];

/* ────────────────────────── 전문가용·연구자용 추출 파일 ────────────────────────── */

/**
 * 전문가용 사례번호. 전문가는 앱의 판정을 보지 않고 채점하므로(논문 Ⅲ.4.나) 앱 사례 ID(문항-수준-순번)를
 * 쓰지 않고 새 번호를 붙인다. 사례를 앱 사례 ID 순으로 놓은 뒤 `${seed}|expert` 난수로 섞어 E001부터 매긴다.
 * 같은 시드·같은 사례면 같은 번호가 나온다(다시 받아도 대응표가 바뀌지 않는다).
 */
export function expertCaseIdsOf(seed: string, cases: readonly Pick<SampleCase, 'caseId'>[]): Map<string, string> {
  const ids = [...new Set(cases.map((c) => c.caseId))].sort();
  const rand = createSeededRandom(`${seed.trim()}|expert`);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const width = Math.max(3, String(ids.length).length);
  return new Map(ids.map((caseId, i) => [caseId, `E${String(i + 1).padStart(width, '0')}`]));
}

export interface ExpertSampleRow {
  expertCaseId: string;
  questionId: string;
  text: string;
}

/** 전문가용 열: 새 사례번호·사진 ID·학생 문장만. 앱 판정·수준·연구ID·시각·단계는 싣지 않는다. */
export const EXPERT_SAMPLE_COLUMNS: CsvColumn<ExpertSampleRow>[] = [
  { key: 'expert_case_id', get: (r) => r.expertCaseId },
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'student_text', get: (r) => r.text },
];

/**
 * 전문가용 행. 번호는 뽑힌 사례 전체로 매겨(나중에 빠진 사례가 있어도 번호가 바뀌지 않게) 빠진 사례만 뺀다.
 * withheld: 추출 뒤 동의 철회·제외 표시로 내보내지 않는 사례(withheldCasesOf).
 */
export function expertSampleRows(
  seed: string,
  cases: readonly SampleCase[],
  withheld: ReadonlyMap<string, WithheldReason> = new Map()
): ExpertSampleRow[] {
  const ids = expertCaseIdsOf(seed, cases);
  return cases
    .filter((c) => !withheld.has(c.caseId))
    .map((c) => ({ expertCaseId: ids.get(c.caseId)!, questionId: c.questionId, text: c.row.finalPrompt }))
    .sort((a, b) => a.expertCaseId.localeCompare(b.expertCaseId));
}

export const buildExpertSampleCsv = (
  seed: string,
  cases: readonly SampleCase[],
  withheld: ReadonlyMap<string, WithheldReason> = new Map()
) => toCsv(expertSampleRows(seed, cases, withheld), EXPERT_SAMPLE_COLUMNS);

type ResearcherSampleRow = SampleCsvRow & { expertCaseId: string | null; withheld: WithheldReason | null };

/**
 * 연구자용: 전문가용 사례번호 대응표 + 앱 판정(기존 추출 열). 추출 뒤 빠진 사례는 행을 남기되 학생 문장·근거를 비우고
 * withheld_reason에 까닭을 적는다(철회한 학생의 글을 다시 내보내지 않는다).
 */
export const buildResearcherSampleCsv = (
  sampleId: string,
  seed: string,
  cases: readonly SampleCase[],
  withheld: ReadonlyMap<string, WithheldReason> = new Map()
) => {
  const ids = expertCaseIdsOf(seed, cases);
  const blank = (c: SampleCase): SampleCase => ({
    ...c,
    row: { ...c.row, finalPrompt: '', firstPrompt: '', feedbacks: '', finalAreas: null },
  });
  return toCsv<ResearcherSampleRow>(
    cases.map((item) => {
      const why = withheld.get(item.caseId) ?? null;
      return { sampleId, seed, item: why ? blank(item) : item, expertCaseId: ids.get(item.caseId) ?? null, withheld: why };
    }),
    [
      { key: 'expert_case_id', get: (r) => r.expertCaseId },
      { key: 'withheld_reason', get: (r) => r.withheld },
      ...(SAMPLE_COLUMNS as CsvColumn<ResearcherSampleRow>[]),
    ]
  );
};

export interface ExclusionReportRow extends ExclusionCount {
  sampleId: string;
}

export const EXCLUSION_REPORT_COLUMNS: CsvColumn<ExclusionReportRow>[] = [
  { key: 'sample_id', get: (r) => r.sampleId },
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'reason', get: (r) => r.reason },
  { key: 'reason_label', get: (r) => EXCLUSION_COUNT_LABEL[r.reason] },
  { key: 'count', get: (r) => r.count },
];

/** 추출에서 뺀 수와 사유(문항 × 사유). 학생 식별 정보는 싣지 않는다. */
export const buildExclusionReportCsv = (sampleId: string, counts: readonly ExclusionCount[]) =>
  toCsv(
    counts.map((c) => ({ ...c, sampleId })),
    EXCLUSION_REPORT_COLUMNS
  );

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

/* ────────────────────────── 개인정보 보류 유형별 건수(99-1 B4) ────────────────────────── */

/** 개인정보 점검 보류 기록에서 유형별 건수와 처음·마지막 시각. 원문·학생·문항은 싣지 않는다. */
export interface PrivacyHoldRow {
  /** 점검 유형(예: phone, email). 'ALL'은 보류 전체 건수(한 건에 유형이 여럿이면 유형별로는 각각 센다). */
  type: string;
  count: number;
  firstHeldAt: string | null;
  lastHeldAt: string | null;
}

/** 보류 기록 → 유형별 줄. 맨 앞은 전체(ALL), 그다음 유형 이름 순. 유형이 비었으면 'unknown'. */
export function summarizePrivacyHolds(
  holds: readonly { types?: readonly string[] | null; heldAt?: string | null }[]
): PrivacyHoldRow[] {
  const byType = new Map<string, PrivacyHoldRow>();
  const add = (type: string, at: string | null) => {
    const row = byType.get(type) ?? { type, count: 0, firstHeldAt: null, lastHeldAt: null };
    row.count += 1;
    if (at && (!row.firstHeldAt || at < row.firstHeldAt)) row.firstHeldAt = at;
    if (at && (!row.lastHeldAt || at > row.lastHeldAt)) row.lastHeldAt = at;
    byType.set(type, row);
  };
  for (const h of holds) {
    const at = typeof h.heldAt === 'string' && h.heldAt ? h.heldAt : null;
    add('ALL', at);
    const types = [...new Set((h.types ?? []).filter((t): t is string => typeof t === 'string' && t.length > 0))];
    for (const t of types.length ? types : ['unknown']) add(t, at);
  }
  const all = byType.get('ALL') ?? { type: 'ALL', count: 0, firstHeldAt: null, lastHeldAt: null };
  byType.delete('ALL');
  return [all, ...[...byType.values()].sort((a, b) => a.type.localeCompare(b.type))];
}

export const PRIVACY_HOLD_COLUMNS: CsvColumn<PrivacyHoldRow>[] = [
  { key: 'type', get: (r) => r.type },
  { key: 'count', get: (r) => r.count },
  { key: 'first_held_at', get: (r) => r.firstHeldAt },
  { key: 'last_held_at', get: (r) => r.lastHeldAt },
];

export const buildPrivacyHoldCsv = (rows: readonly PrivacyHoldRow[]) => toCsv(rows, PRIVACY_HOLD_COLUMNS);

