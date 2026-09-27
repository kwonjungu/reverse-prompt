'use server';

/**
 * 통합 관리 화면의 '연구 자료' 탭 — 연습 시도 요약과 연구용 추출(논문 v12, 공통 루브릭 v12-2)의 배선.
 *
 * 계산 규칙은 src/server/export/practice-summary.ts에 있고, 여기서는 관리자 세션 확인,
 * Firestore 읽기, 동의 필터, 제외 표시·추출 결과 저장, CSV 파일 이름만 맡는다.
 *
 * 지키는 것
 *   - 모든 action은 첫 줄에서 requireAdmin()을 부른다.
 *   - 연구 세션(research_practice)의 연습 제출만 읽는다. 일반 체험 기록은 섞지 않는다.
 *   - 동의(보호자 동의 + 학생 승낙, 철회 없음)가 지금 유효하지 않은 학생은 요약·추출에서 뺀다.
 *   - researchId만 쓴다. 실명·출석번호·학교명은 저장 스키마에 없고 여기서 되살리지 않는다.
 *   - 요약은 저장된 기록에서 계산한다. 원문을 고치지 않는다.
 *   - 옛 v7 기록(축별 5수준·100점)은 연구자용 시도별 CSV에만 legacy_rubric=true와 v7_* 열로 남고,
 *     요약·추출에서는 빠진다. 뺀 수를 화면에 알린다. 옛 5수준 추출 결과는 다시 내보내지 않는다.
 *   - 추출 결과는 세 파일로 낸다: 전문가용(새 사례번호·사진ID·학생 문장만), 연구자용(대응표 + 앱 판정),
 *     뺀 수와 사유(문항 × 사유).
 *   - 내보낸 CSV는 브라우저로만 내려가며 저장소에 두지 않는다(.gitignore: rp_*.csv).
 *
 * 이 탭은 통합 관리 화면이 학생 답안을 읽는 유일한 자리다. 연구 책임자가 관리 화면을 함께
 * 운영하는 현재 구성에 맞춘 것이며, 읽을 때마다 admin_events에 남긴다(CLAUDE.md 참고).
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { AuthError } from '@/server/auth/contract';
import { CODE_COMMIT, RESEARCH_SAMPLE_QUESTIONS } from '@/server/config';
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  researchPath,
} from '@/server/firebase-admin';
import { RESEARCH_PRACTICE_SUBMISSIONS_PATH, RESEARCH_PRIVACY_HOLDS_PATH } from '@/server/lessons/store';
import { privacy } from '@/server/privacy';
import { grading } from '@/server/grading';
import {
  REPEAT_INDEXES,
  REPEAT_SCORE_SCHEMA_VERSION,
  buildAgreementCsv,
  buildRepeatCaseCsv,
  isRepeatIndex,
  levelsOfRun,
  repeatDocId,
  type RepeatCaseRow,
  type RepeatIndex,
  type RepeatScoreDoc,
} from '@/server/export/repeat-scores';
import type { ScoringRun } from '@/lib/research/types';
import { APP_LEVEL_RULE } from '@/lib/scoring';
import { RUBRIC_VERSION } from '@/lib/rubric';
import {
  APP_LEVELS,
  DEFAULT_PER_LEVEL,
  EXCLUSION_REASON_LABEL,
  SAMPLE_SCHEMA_VERSION,
  bandCoverageWarning,
  buildAttemptCsv,
  buildExclusionReportCsv,
  buildExpertSampleCsv,
  buildExtractionCsv,
  buildQuestionSummaryCsv,
  buildResearcherSampleCsv,
  buildStudentQuestionCsv,
  countLegacyAttempts,
  drawStratifiedSample,
  exclusionKey,
  isConsentDocActive,
  isExclusionReason,
  isLegacySampleDoc,
  parseRepresentativeQuestions,
  sampleInputProblem,
  summarizeQuestions,
  summarizeStudentQuestions,
  toPracticeAttempt,
  type ExclusionCount,
  type ExclusionMark,
  type ExclusionReason,
  type ExtractionRow,
  type PracticeAttempt,
  type QuestionSummary,
  type SampleCase,
  type SampleStratum,
  type StudentQuestionSummary,
} from '@/server/export/practice-summary';
import { recordAdminEvent, requireAdmin } from './auth';

/**
 * 제외 표시 문서의 형식 버전. 학생 × 문항 키와 사유만 담아 v12-2 전환으로 모양이 바뀌지 않았다.
 * 추출 기록의 형식 버전은 SAMPLE_SCHEMA_VERSION(practice-summary.ts)이다.
 * 저장 경로(research/v7.0)는 어느 쪽도 바꾸지 않는다.
 */
const EXCLUSION_SCHEMA_VERSION = 'v12-extraction-1';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; signedOut: boolean };

class ResearchInputError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: err.message, signedOut: err.code === 'unauthenticated' };
    }
    if (err instanceof ResearchInputError) return { ok: false, error: err.message, signedOut: false };
    console.error('[admin/research] 처리 실패');
    return { ok: false, error: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.', signedOut: false };
  }
}

/* ────────────────────────── 읽기 ────────────────────────── */

interface LoadedResearchData {
  /** 동의가 유효한 학생의 시도. 옛 v7 시도(legacyRubric)도 들어 있다. */
  attempts: PracticeAttempt[];
  /** 동의가 지금 유효하지 않아 뺀 학생 수 */
  consentExcludedStudents: number;
  /** 문항별로, 동의가 지금 유효하지 않아 뺀 학생 수(그 문항에 제출이 있던 학생만) */
  consentExcludedByQuestion: Map<string, number>;
}

function scopeOf(classResearchId: string | null | undefined): string | null {
  if (!classResearchId) return null;
  return assertSafeDocId(String(classResearchId), '수업 번호');
}

async function loadConsentedAttempts(classResearchId: string | null): Promise<LoadedResearchData> {
  const db = getAdminFirestore();
  const base = db.collection(RESEARCH_PRACTICE_SUBMISSIONS_PATH);
  const snap = classResearchId
    ? await base.where('classResearchId', '==', classResearchId).get()
    : await base.get();

  const all = snap.docs
    .map((d) => toPracticeAttempt(d.id, d.data()))
    .filter((a): a is PracticeAttempt => a !== null);

  // 동의는 제출할 때가 아니라 지금 기준으로 다시 본다. 그사이 철회한 학생은 뺀다.
  const researchIds = [...new Set(all.map((a) => a.researchId))];
  const active = new Set<string>();
  for (let i = 0; i < researchIds.length; i += 200) {
    const chunk = researchIds.slice(i, i + 200);
    const refs = chunk.map((id) => db.collection(COLLECTIONS.consents).doc(assertSafeDocId(id, '연구ID')));
    const docs = await db.getAll(...(refs as DocumentReference[]));
    for (const d of docs) {
      if (isConsentDocActive(d.id, d.exists ? (d.data() ?? null) : null)) active.add(d.id);
    }
  }
  const byQuestion = new Map<string, Set<string>>();
  for (const a of all) {
    if (active.has(a.researchId)) continue;
    const set = byQuestion.get(a.questionId) ?? new Set<string>();
    set.add(a.researchId);
    byQuestion.set(a.questionId, set);
  }
  return {
    attempts: all.filter((a) => active.has(a.researchId)),
    consentExcludedStudents: researchIds.length - active.size,
    consentExcludedByQuestion: new Map([...byQuestion].map(([q, set]) => [q, set.size])),
  };
}

/** 연구 수업의 개인정보 보류 건수(유형·시각만 남은 기록). 범위를 주면 그 반만 센다. */
async function countPrivacyHolds(classResearchId: string | null): Promise<number> {
  const base = getAdminFirestore().collection(RESEARCH_PRIVACY_HOLDS_PATH);
  const snap = classResearchId ? await base.where('classKey', '==', classResearchId).get() : await base.get();
  return snap.size;
}

function exclusionsCollection() {
  return getAdminFirestore().collection(researchPath(RESEARCH_COLLECTIONS.extractionExclusions));
}

function samplesCollection() {
  return getAdminFirestore().collection(researchPath(RESEARCH_COLLECTIONS.extractionSamples));
}

function repeatScoresCollection() {
  return getAdminFirestore().collection(researchPath(RESEARCH_COLLECTIONS.sampleRepeatScores));
}

/** 지금 유효한 제외 표시(해제하지 않은 것) */
async function loadActiveExclusions(): Promise<Map<string, ExclusionMark>> {
  const snap = await exclusionsCollection().where('active', '==', true).get();
  const map = new Map<string, ExclusionMark>();
  for (const d of snap.docs) {
    const data = d.data();
    if (typeof data.researchId !== 'string' || typeof data.questionId !== 'string') continue;
    if (!isExclusionReason(data.reason)) continue;
    map.set(exclusionKey(data.researchId, data.questionId), {
      researchId: data.researchId,
      questionId: data.questionId,
      reason: data.reason,
      note: typeof data.note === 'string' && data.note ? data.note : null,
      markedAt: typeof data.markedAt === 'string' ? data.markedAt : '',
    });
  }
  return map;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function fileScope(classResearchId: string | null): string {
  return classResearchId ? classResearchId.replace(/[^0-9A-Za-z_-]/g, '_') : 'all';
}

/* ────────────────────────── 개요 ────────────────────────── */

export interface ResearchOverview {
  classes: { classResearchId: string; label: string | null; sessionType: string }[];
  /** 요약·추출에 쓰는 v12-2 시도 수 */
  attemptCount: number;
  /** v12-2 시도가 있는 학생 수 */
  studentCount: number;
  consentExcludedStudents: number;
  /** 요약·추출에서 뺀 옛 v7(5수준·100점) 시도 수. 시도별 CSV에는 남는다. */
  legacyAttemptCount: number;
  /** 전송 전 개인정보 점검으로 멈춘 제출 수(건수만. 글은 남기지 않는다) */
  privacyHoldCount: number;
  /** 대표 문항 설정값(RESEARCH_SAMPLE_QUESTIONS). 미정이면 빈 목록 */
  representativeQuestions: string[];
  /** 설정값이 올바르지 않으면 그 까닭 */
  representativeProblem: string | null;
  questionSummary: QuestionSummary[];
  /** 앱 종합 4수준의 산정 규칙(@/lib/scoring) */
  appLevelRule: string;
  rubricVersion: string;
  loadedAt: string;
}

export async function loadResearchOverviewAction(input: {
  classResearchId?: string | null;
}): Promise<Result<ResearchOverview>> {
  return run(async () => {
    await requireAdmin();
    const scope = scopeOf(input?.classResearchId);
    const db = getAdminFirestore();
    const [classSnap, loaded, privacyHoldCount] = await Promise.all([
      db.collection(COLLECTIONS.researchClasses).get(),
      loadConsentedAttempts(scope),
      countPrivacyHolds(scope),
    ]);
    const representative = parseRepresentativeQuestions(RESEARCH_SAMPLE_QUESTIONS);
    const rows = summarizeStudentQuestions(loaded.attempts);
    const current = loaded.attempts.filter((a) => !a.legacyRubric);
    await recordAdminEvent('research_overview', scope, { attempts: loaded.attempts.length });
    return {
      classes: classSnap.docs
        .map((d) => ({
          classResearchId: d.id,
          label: typeof d.data().label === 'string' ? (d.data().label as string) : null,
          sessionType: typeof d.data().sessionType === 'string' ? (d.data().sessionType as string) : 'experience',
        }))
        .filter((c) => c.sessionType !== 'experience')
        .sort((a, b) => a.classResearchId.localeCompare(b.classResearchId)),
      attemptCount: current.length,
      studentCount: new Set(current.map((a) => a.researchId)).size,
      consentExcludedStudents: loaded.consentExcludedStudents,
      legacyAttemptCount: countLegacyAttempts(loaded.attempts),
      privacyHoldCount,
      representativeQuestions: representative.questionIds,
      representativeProblem: representative.problem,
      questionSummary: summarizeQuestions(rows),
      appLevelRule: APP_LEVEL_RULE,
      rubricVersion: RUBRIC_VERSION,
      loadedAt: new Date().toISOString(),
    };
  });
}

/* ────────────────────────── CSV 내보내기 ────────────────────────── */

export type ResearchCsvKind = 'attempts' | 'student_question' | 'question';

export interface CsvFile {
  filename: string;
  /** BOM을 포함한 CSV 본문 */
  csv: string;
  rowCount: number;
}

export async function exportResearchCsvAction(input: {
  kind: ResearchCsvKind;
  classResearchId?: string | null;
}): Promise<Result<CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const scope = scopeOf(input?.classResearchId);
    const { attempts } = await loadConsentedAttempts(scope);
    const rows = summarizeStudentQuestions(attempts);
    let file: CsvFile;
    if (input.kind === 'attempts') {
      // 연구자용 시도별 CSV만 옛 v7 시도를 함께 낸다(legacy_rubric=true, 옛 값은 v7_* 열 — 옛 기록 보존용).
      const sorted = [...attempts].sort(
        (a, b) =>
          a.researchId.localeCompare(b.researchId) ||
          a.questionId.localeCompare(b.questionId) ||
          (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')
      );
      file = { filename: `rp_attempts_${fileScope(scope)}_${stamp()}.csv`, csv: buildAttemptCsv(sorted), rowCount: sorted.length };
    } else if (input.kind === 'student_question') {
      file = { filename: `rp_student_question_${fileScope(scope)}_${stamp()}.csv`, csv: buildStudentQuestionCsv(rows), rowCount: rows.length };
    } else if (input.kind === 'question') {
      const summary = summarizeQuestions(rows);
      file = { filename: `rp_question_summary_${fileScope(scope)}_${stamp()}.csv`, csv: buildQuestionSummaryCsv(summary), rowCount: summary.length };
    } else {
      throw new ResearchInputError('없는 내보내기 종류입니다.');
    }
    // API 키·원시 토큰이 어떤 칸에도 실리지 않는지 마지막으로 확인한다.
    privacy.assertNoSecrets([file.csv]);
    await recordAdminEvent('research_export', scope, { kind: input.kind, rows: file.rowCount });
    return file;
  });
}

/* ────────────────────────── 연구용 추출 ────────────────────────── */

function validQuestionIds(questionIds: unknown): string[] {
  const ids = Array.isArray(questionIds) ? questionIds.filter((v): v is string => typeof v === 'string') : [];
  const problem = sampleInputProblem({ questionIds: ids, perLevel: DEFAULT_PER_LEVEL, seed: 'x' });
  if (problem) throw new ResearchInputError(problem);
  return [...ids].sort();
}

async function buildExtractionRows(
  questionIds: string[],
  scope: string | null
): Promise<{
  rows: ExtractionRow[];
  consentExcludedStudents: number;
  consentExcludedByQuestion: Map<string, number>;
  legacyAttemptCount: number;
}> {
  const [loaded, exclusions] = await Promise.all([loadConsentedAttempts(scope), loadActiveExclusions()]);
  const wanted = new Set(questionIds);
  const picked = loaded.attempts.filter((a) => wanted.has(a.questionId));
  // 옛 v7 시도는 요약에서 빠진다(summarizeStudentQuestions). 뺀 수만 알린다.
  const rows = summarizeStudentQuestions(picked).map(
    (r): ExtractionRow => ({
      ...r,
      exclusion: exclusions.get(exclusionKey(r.researchId, r.questionId)) ?? null,
      piiSuspected: privacy.checkBeforeSend(r.finalPrompt).decision === 'hold_for_teacher',
    })
  );
  return {
    rows,
    consentExcludedStudents: loaded.consentExcludedStudents,
    consentExcludedByQuestion: loaded.consentExcludedByQuestion,
    legacyAttemptCount: countLegacyAttempts(picked),
  };
}

export interface ExtractionView {
  questionIds: string[];
  rows: ExtractionRow[];
  consentExcludedStudents: number;
  /** 고른 문항에서 요약·추출에서 뺀 옛 v7 시도 수 */
  legacyAttemptCount: number;
  /** 고른 문항이 A·B·C밴드 하나씩이 아니면 경고 문구 */
  bandWarning: string | null;
}

/** 고른 문항(최대 3개)의 학생 × 문항 요약과 제외 표시 */
export async function loadExtractionAction(input: {
  questionIds: string[];
  classResearchId?: string | null;
}): Promise<Result<ExtractionView>> {
  return run(async () => {
    await requireAdmin();
    const questionIds = validQuestionIds(input?.questionIds);
    const scope = scopeOf(input?.classResearchId);
    const { rows, consentExcludedStudents, legacyAttemptCount } = await buildExtractionRows(questionIds, scope);
    await recordAdminEvent('research_extraction_view', scope, { questionIds, rows: rows.length });
    return { questionIds, rows, consentExcludedStudents, legacyAttemptCount, bandWarning: bandCoverageWarning(questionIds) };
  });
}

/** 고른 문항의 학생 × 문항 요약만 CSV로(제외 표시 열 포함) */
export async function exportExtractionCsvAction(input: {
  questionIds: string[];
  classResearchId?: string | null;
}): Promise<Result<CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const questionIds = validQuestionIds(input?.questionIds);
    const scope = scopeOf(input?.classResearchId);
    const { rows } = await buildExtractionRows(questionIds, scope);
    const csv = buildExtractionCsv(rows);
    privacy.assertNoSecrets([csv]);
    await recordAdminEvent('research_export', scope, { kind: 'extraction', questionIds, rows: rows.length });
    return { filename: `rp_extraction_${questionIds.join('-')}_${stamp()}.csv`, csv, rowCount: rows.length };
  });
}

/**
 * 제외 표시를 달거나 뗀다. 떼어도 문서를 지우지 않고 active:false와 이력을 남긴다.
 * reason이 null이면 해제다.
 */
export async function setExclusionAction(input: {
  researchId: string;
  questionId: string;
  reason: ExclusionReason | null;
  note?: string | null;
}): Promise<Result<ExclusionMark | null>> {
  return run(async () => {
    await requireAdmin();
    const researchId = assertSafeDocId(String(input?.researchId ?? ''), '연구ID');
    const [questionId] = validQuestionIds([input?.questionId]);
    if (input.reason !== null && !isExclusionReason(input.reason)) {
      throw new ResearchInputError('제외 사유를 골라 주세요.');
    }
    const note = typeof input.note === 'string' ? input.note.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200) || null : null;
    const now = new Date().toISOString();
    const ref = exclusionsCollection().doc(exclusionKey(researchId, questionId));
    const history = {
      action: input.reason ? 'mark' : 'clear',
      reason: input.reason,
      note,
      at: now,
    };
    if (input.reason) {
      await ref.set(
        {
          schemaVersion: EXCLUSION_SCHEMA_VERSION,
          researchId,
          questionId,
          reason: input.reason,
          reasonLabel: EXCLUSION_REASON_LABEL[input.reason],
          note,
          active: true,
          markedAt: now,
          updatedAt: now,
          history: FieldValue.arrayUnion(history),
        },
        { merge: true }
      );
    } else {
      await ref.set({ active: false, clearedAt: now, updatedAt: now, history: FieldValue.arrayUnion(history) }, { merge: true });
    }
    await recordAdminEvent(input.reason ? 'research_exclude' : 'research_unexclude', questionId, {
      reason: input.reason,
    });
    return input.reason ? { researchId, questionId, reason: input.reason, note, markedAt: now } : null;
  });
}

export interface SampleView {
  sampleId: string;
  seed: string;
  perLevel: number;
  questionIds: string[];
  classResearchId: string | null;
  createdAt: string;
  strata: SampleStratum[];
  cases: SampleCase[];
  excludedCount: number;
  unlevelledCount: number;
  consentExcludedStudents: number;
  /** 고른 문항에서 추출 대상에서 뺀 옛 v7 시도 수 */
  legacyAttemptCount: number;
  /** 문항 × 사유별로 뺀 수(무관·개인정보·동의 없음·최종 결측) */
  exclusionCounts: ExclusionCount[];
  /** 고른 문항이 A·B·C밴드 하나씩이 아니면 경고 문구 */
  bandWarning: string | null;
}

/** 추출 결과로 내는 세 파일 */
export type SampleFileKind = 'expert' | 'researcher' | 'exclusions';

function sampleFile(
  kind: SampleFileKind,
  sampleId: string,
  seed: string,
  cases: SampleCase[],
  exclusionCounts: ExclusionCount[]
): CsvFile {
  if (kind === 'expert') {
    return { filename: `rp_sample_${sampleId}_expert.csv`, csv: buildExpertSampleCsv(seed, cases), rowCount: cases.length };
  }
  if (kind === 'researcher') {
    return {
      filename: `rp_sample_${sampleId}_researcher.csv`,
      csv: buildResearcherSampleCsv(sampleId, seed, cases),
      rowCount: cases.length,
    };
  }
  return {
    filename: `rp_sample_${sampleId}_exclusions.csv`,
    csv: buildExclusionReportCsv(sampleId, exclusionCounts),
    rowCount: exclusionCounts.length,
  };
}

function newSampleId(): string {
  return `S-${stamp()}-${randomBytes(3).toString('hex')}`;
}

/**
 * 제외 뒤 앱 종합 4수준별로 문항마다 perLevel개(기본 5)를 고정 시드로 뽑고, 결과를 저장한다.
 * 저장하는 것: 시드·문항·n·수준 산정 규칙·루브릭 버전·층별 후보(연구ID·최종 제출ID)·제외 목록·
 * 뺀 옛 v7 시도 수·뽑힌 사례. 같은 시드와 같은 후보면 같은 결과가 나온다.
 */
export async function drawSampleAction(input: {
  questionIds: string[];
  perLevel: number;
  seed: string;
  classResearchId?: string | null;
}): Promise<Result<SampleView & { files: CsvFile[] }>> {
  return run(async () => {
    await requireAdmin();
    const questionIds = validQuestionIds(input?.questionIds);
    const perLevel = Number(input?.perLevel);
    const seed = String(input?.seed ?? '').trim();
    const problem = sampleInputProblem({ questionIds, perLevel, seed });
    if (problem) throw new ResearchInputError(problem);
    const scope = scopeOf(input?.classResearchId);

    const { rows, consentExcludedStudents, consentExcludedByQuestion, legacyAttemptCount } =
      await buildExtractionRows(questionIds, scope);
    const excludedKeys = new Set(
      rows.filter((r) => r.exclusion).map((r) => exclusionKey(r.researchId, r.questionId))
    );
    const exclusionReasons = new Map(
      rows.filter((r) => r.exclusion).map((r) => [exclusionKey(r.researchId, r.questionId), r.exclusion!.reason])
    );
    const plain: StudentQuestionSummary[] = rows.map(({ exclusion: _e, piiSuspected: _p, ...rest }) => rest);
    const result = drawStratifiedSample({ rows: plain, questionIds, perLevel, seed, excludedKeys, exclusionReasons });
    const exclusionCounts: ExclusionCount[] = [
      ...result.exclusionCounts,
      ...questionIds.map((questionId) => ({
        questionId,
        reason: 'no_consent' as const,
        count: consentExcludedByQuestion.get(questionId) ?? 0,
      })),
    ].sort((a, b) => a.questionId.localeCompare(b.questionId));
    const bandWarning = bandCoverageWarning(questionIds);

    const sampleId = newSampleId();
    const createdAt = new Date().toISOString();
    const candidates = questionIds.flatMap((questionId) =>
      APP_LEVELS.map((level) => ({
        questionId,
        level,
        members: plain
          .filter(
            (r) =>
              r.questionId === questionId &&
              r.finalAppLevel === level &&
              !excludedKeys.has(exclusionKey(r.researchId, r.questionId))
          )
          .map((r) => ({ researchId: r.researchId, finalSubmissionId: r.finalSubmissionId }))
          .sort((a, b) => a.researchId.localeCompare(b.researchId)),
      }))
    );

    await samplesCollection().doc(sampleId).create({
      schemaVersion: SAMPLE_SCHEMA_VERSION,
      sampleId,
      seed,
      perLevel,
      questionIds,
      classResearchId: scope,
      appLevelRule: APP_LEVEL_RULE,
      appLevels: [...APP_LEVELS],
      rubricVersion: RUBRIC_VERSION,
      createdAt,
      codeCommit: CODE_COMMIT,
      strata: result.strata,
      excludedCount: result.excludedCount,
      unlevelledCount: result.unlevelledCount,
      consentExcludedStudents,
      legacyAttemptsExcluded: legacyAttemptCount,
      exclusionCounts,
      bandWarning,
      exclusions: rows
        .filter((r) => r.exclusion)
        .map((r) => ({
          researchId: r.researchId,
          questionId: r.questionId,
          reason: r.exclusion!.reason,
          note: r.exclusion!.note,
        })),
      candidates,
      cases: result.cases,
    });
    await recordAdminEvent('research_sample', sampleId, {
      seed,
      perLevel,
      questionIds,
      cases: result.cases.length,
    });

    return {
      sampleId,
      seed,
      perLevel,
      questionIds,
      classResearchId: scope,
      createdAt,
      strata: result.strata,
      cases: result.cases,
      excludedCount: result.excludedCount,
      unlevelledCount: result.unlevelledCount,
      consentExcludedStudents,
      legacyAttemptCount,
      exclusionCounts,
      bandWarning,
      files: (['expert', 'researcher', 'exclusions'] as const).map((kind) =>
        sampleFile(kind, sampleId, seed, result.cases, exclusionCounts)
      ),
    };
  });
}

export interface SampleListItem {
  sampleId: string;
  seed: string;
  perLevel: number;
  questionIds: string[];
  createdAt: string;
  caseCount: number;
  shortfall: number;
  /** 옛 앱 AI 5수준(v7 100점 환산) 층으로 뽑은 추출인가 */
  legacy: boolean;
  /** 반복 채점(2·3회차)을 마친 사례 수 */
  repeatDone: Record<RepeatIndex, number>;
}

export async function listSamplesAction(): Promise<Result<SampleListItem[]>> {
  return run(async () => {
    await requireAdmin();
    const snap = await samplesCollection().orderBy('createdAt', 'desc').limit(30).get();
    const ids = snap.docs.map((d) => d.id);
    const done = new Map<string, Record<RepeatIndex, number>>();
    if (ids.length) {
      const repeats = await repeatScoresCollection().where('sampleId', 'in', ids).select('sampleId', 'repeatIndex').get();
      for (const d of repeats.docs) {
        const { sampleId, repeatIndex } = d.data() as { sampleId?: string; repeatIndex?: unknown };
        if (typeof sampleId !== 'string' || !isRepeatIndex(repeatIndex)) continue;
        const counts = done.get(sampleId) ?? { 2: 0, 3: 0 };
        counts[repeatIndex] += 1;
        done.set(sampleId, counts);
      }
    }
    return snap.docs.map((d) => {
      const data = d.data();
      const strata = Array.isArray(data.strata) ? (data.strata as SampleStratum[]) : [];
      return {
        sampleId: d.id,
        seed: typeof data.seed === 'string' ? data.seed : '',
        perLevel: typeof data.perLevel === 'number' ? data.perLevel : 0,
        questionIds: Array.isArray(data.questionIds) ? (data.questionIds as string[]) : [],
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        caseCount: Array.isArray(data.cases) ? data.cases.length : 0,
        shortfall: strata.reduce((s, x) => s + (typeof x.shortfall === 'number' ? x.shortfall : 0), 0),
        legacy: isLegacySampleDoc(data),
        repeatDone: done.get(d.id) ?? { 2: 0, 3: 0 },
      };
    });
  });
}

/**
 * 저장해 둔 추출 결과를 그대로 CSV로 다시 받는다(다시 뽑지 않는다). 파일은 전문가용·연구자용·뺀 수 셋 가운데 하나.
 * 옛 5수준 추출(v12-extraction-1)은 옛 100점 환산 층이라 내보내지 않는다(기록은 지우지 않는다).
 */
export async function exportSampleCsvAction(sampleId: string, kind: SampleFileKind = 'researcher'): Promise<Result<CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const id = assertSafeDocId(String(sampleId ?? ''), '추출 번호');
    if (kind !== 'expert' && kind !== 'researcher' && kind !== 'exclusions') {
      throw new ResearchInputError('없는 파일 종류입니다.');
    }
    const snap = await samplesCollection().doc(id).get();
    if (!snap.exists) throw new ResearchInputError('없는 추출 기록입니다.');
    const data = snap.data() ?? {};
    if (isLegacySampleDoc(data)) {
      throw new ResearchInputError('옛 기준(v7, 5수준·100점 환산)으로 뽑은 추출은 내보내지 않습니다. 기록은 그대로 있습니다.');
    }
    const cases = Array.isArray(data.cases) ? (data.cases as SampleCase[]) : [];
    const seed = typeof data.seed === 'string' ? data.seed : '';
    const counts = Array.isArray(data.exclusionCounts) ? (data.exclusionCounts as ExclusionCount[]) : [];
    const file = sampleFile(kind, id, seed, cases, counts);
    privacy.assertNoSecrets([file.csv]);
    await recordAdminEvent('research_export', id, { kind: `sample_${kind}`, rows: file.rowCount });
    return file;
  });
}

/* ────────────────────────── 반복 채점(2·3회차) ────────────────────────── */

/** 저장된 v12-2 추출 기록을 읽는다. 옛 5수준 추출은 반복 채점하지 않는다. */
async function loadCurrentSample(sampleId: string): Promise<{ id: string; cases: SampleCase[] }> {
  const id = assertSafeDocId(String(sampleId ?? ''), '추출 번호');
  const snap = await samplesCollection().doc(id).get();
  if (!snap.exists) throw new ResearchInputError('없는 추출 기록입니다.');
  const data = snap.data() ?? {};
  if (isLegacySampleDoc(data)) throw new ResearchInputError('옛 기준(v7)으로 뽑은 추출은 다시 채점하지 않습니다.');
  const cases = Array.isArray(data.cases) ? (data.cases as SampleCase[]) : [];
  return { id, cases };
}

export interface RepeatProgress {
  sampleId: string;
  repeatIndex: RepeatIndex;
  total: number;
  done: number;
  /** 이번 호출에서 채점한 사례 */
  scoredNow: number;
  /** 이번 호출에서 동의가 없어 건너뛴 사례 */
  skippedNow: number;
}

/**
 * 추출 사례를 운영 채점기(grading.runOperationalScoring)와 같은 설정으로 다시 채점해 repeatIndex 2·3으로
 * 따로 저장한다. 1회차(제출 문서의 채점)는 건드리지 않는다. 한 번에 limit개(기본 1)씩 하고 남은 수를 돌려준다
 * — 화면이 다 끝날 때까지 이어 부른다(서버 함수 시간 제한 때문). 이미 저장된 사례는 다시 부르지 않는다.
 * 동의가 지금 유효하지 않은 학생의 글은 모델에 보내지 않고 skipped_consent로 남긴다(철회 뒤 추가 채점 금지).
 */
export async function rescoreSampleBatchAction(input: {
  sampleId: string;
  repeatIndex: number;
  limit?: number;
}): Promise<Result<RepeatProgress>> {
  return run(async () => {
    await requireAdmin();
    const { id, cases } = await loadCurrentSample(input?.sampleId);
    const repeatIndex = input?.repeatIndex;
    if (!isRepeatIndex(repeatIndex)) throw new ResearchInputError('반복 채점은 2회차나 3회차만 합니다.');
    const limit = Math.min(Math.max(Math.trunc(Number(input?.limit ?? 1)) || 1, 1), 3);

    const existing = await repeatScoresCollection()
      .where('sampleId', '==', id)
      .where('repeatIndex', '==', repeatIndex)
      .select('caseId')
      .get();
    const doneIds = new Set(existing.docs.map((d) => String(d.data().caseId)));
    const todo = cases.filter((c) => !doneIds.has(c.caseId)).slice(0, limit);

    const db = getAdminFirestore();
    let scoredNow = 0;
    let skippedNow = 0;
    for (const c of todo) {
      const researchId = c.row.researchId;
      const finalSubmissionId = c.row.finalSubmissionId;
      const base = {
        schemaVersion: REPEAT_SCORE_SCHEMA_VERSION,
        sampleId: id,
        caseId: c.caseId,
        questionId: c.questionId,
        finalSubmissionId,
        repeatIndex,
      };
      const consent = await db.collection(COLLECTIONS.consents).doc(assertSafeDocId(researchId, '연구ID')).get();
      let docData: RepeatScoreDoc;
      if (!isConsentDocActive(researchId, consent.exists ? (consent.data() ?? null) : null)) {
        docData = { ...base, status: 'skipped_consent', run: null, scoredAt: new Date().toISOString() };
        skippedNow += 1;
      } else {
        const sub = await db
          .collection(RESEARCH_PRACTICE_SUBMISSIONS_PATH)
          .doc(assertSafeDocId(finalSubmissionId, '제출'))
          .get();
        const text = sub.exists ? sub.data()?.text : null;
        if (typeof text !== 'string' || !text.trim()) {
          docData = { ...base, status: 'skipped_missing_submission', run: null, scoredAt: new Date().toISOString() };
          skippedNow += 1;
        } else {
          // 채점 payload에는 학생·학급·시점이 없다(operationId도 사례 번호만 쓴다).
          const scoringRun: ScoringRun = await grading.runOperationalScoring({
            questionId: c.questionId,
            studentText: text,
            operationId: `repeat_${id}_${c.caseId}_r${repeatIndex}`,
            repeatIndex,
            sessionType: 'research_practice',
            wantFeedback: true,
          });
          docData = { ...base, status: 'scored', run: scoringRun, scoredAt: new Date().toISOString() };
          scoredNow += 1;
        }
      }
      try {
        await repeatScoresCollection().doc(repeatDocId(id, c.caseId, repeatIndex)).create(docData);
      } catch (err) {
        // 같은 사례를 다른 창에서 먼저 채점했다. 먼저 저장된 것을 그대로 둔다.
        const code = (err as { code?: unknown } | null)?.code;
        if (code !== 6) throw err;
      }
    }
    await recordAdminEvent('research_repeat_score', id, { repeatIndex, scoredNow, skippedNow });
    return {
      sampleId: id,
      repeatIndex,
      total: cases.length,
      done: Math.min(doneIds.size + todo.length, cases.length),
      scoredNow,
      skippedNow,
    };
  });
}

/**
 * 반복 채점 결과를 CSV로 낸다.
 *   cases      사례마다 1·2·3회차의 영역 수준(1회차 = 제출 문서의 주 자료)
 *   agreement  영역별로 세 번 모두 같은 수준인 비율(해당 없음·결측은 분모에서 빼고 따로 센다)
 */
export async function exportRepeatScoresCsvAction(input: {
  sampleId: string;
  kind: 'cases' | 'agreement';
}): Promise<Result<CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const { id, cases } = await loadCurrentSample(input?.sampleId);
    if (input?.kind !== 'cases' && input?.kind !== 'agreement') throw new ResearchInputError('없는 파일 종류입니다.');
    const db = getAdminFirestore();
    const repeats = await repeatScoresCollection().where('sampleId', '==', id).get();
    const byKey = new Map<string, RepeatScoreDoc>();
    for (const d of repeats.docs) {
      const r = d.data() as RepeatScoreDoc;
      byKey.set(`${r.caseId}|${r.repeatIndex}`, r);
    }
    const rows: RepeatCaseRow[] = [];
    for (const c of cases) {
      const sub = await db
        .collection(RESEARCH_PRACTICE_SUBMISSIONS_PATH)
        .doc(assertSafeDocId(c.row.finalSubmissionId, '제출'))
        .get();
      const primary = sub.exists ? ((sub.data()?.scoring as ScoringRun | undefined) ?? null) : null;
      rows.push({
        caseId: c.caseId,
        questionId: c.questionId,
        finalSubmissionId: c.row.finalSubmissionId,
        levels: [
          levelsOfRun(primary),
          ...REPEAT_INDEXES.map((n) => levelsOfRun(byKey.get(`${c.caseId}|${n}`)?.run ?? null)),
        ] as RepeatCaseRow['levels'],
      });
    }
    const csv = input.kind === 'cases' ? buildRepeatCaseCsv(rows) : buildAgreementCsv(rows);
    await recordAdminEvent('research_export', id, { kind: `repeat_${input.kind}`, rows: rows.length });
    return { filename: `rp_sample_${id}_repeat_${input.kind}.csv`, csv, rowCount: rows.length };
  });
}
