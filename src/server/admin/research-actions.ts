'use server';

/**
 * 통합 관리 화면의 '연구 자료' 탭 — 연습 시도 요약과 연구용 추출(논문 v12)의 배선.
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
 *   - 내보낸 CSV는 브라우저로만 내려가며 저장소에 두지 않는다(.gitignore: rp_*.csv).
 *
 * 이 탭은 통합 관리 화면이 학생 답안을 읽는 유일한 자리다. 연구 책임자가 관리 화면을 함께
 * 운영하는 현재 구성에 맞춘 것이며, 읽을 때마다 admin_events에 남긴다(CLAUDE.md 참고).
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { AuthError } from '@/server/auth/contract';
import { CODE_COMMIT } from '@/server/config';
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  researchPath,
} from '@/server/firebase-admin';
import { RESEARCH_PRACTICE_SUBMISSIONS_PATH } from '@/server/lessons/store';
import { privacy } from '@/server/privacy';
import {
  APP_LEVEL_RULE,
  DEFAULT_PER_LEVEL,
  EXCLUSION_REASON_LABEL,
  buildAttemptCsv,
  buildExtractionCsv,
  buildQuestionSummaryCsv,
  buildSampleCsv,
  buildStudentQuestionCsv,
  drawStratifiedSample,
  exclusionKey,
  isConsentDocActive,
  isExclusionReason,
  sampleInputProblem,
  summarizeQuestions,
  summarizeStudentQuestions,
  toPracticeAttempt,
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

/** 새로 만드는 추출 기록의 형식 버전. 저장 경로(research/v7.0)는 바꾸지 않는다. */
const EXTRACTION_SCHEMA_VERSION = 'v12-extraction-1';

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
  attempts: PracticeAttempt[];
  /** 동의가 지금 유효하지 않아 뺀 학생 수 */
  consentExcludedStudents: number;
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
  return {
    attempts: all.filter((a) => active.has(a.researchId)),
    consentExcludedStudents: researchIds.length - active.size,
  };
}

function exclusionsCollection() {
  return getAdminFirestore().collection(researchPath(RESEARCH_COLLECTIONS.extractionExclusions));
}

function samplesCollection() {
  return getAdminFirestore().collection(researchPath(RESEARCH_COLLECTIONS.extractionSamples));
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
  attemptCount: number;
  studentCount: number;
  consentExcludedStudents: number;
  questionSummary: QuestionSummary[];
  appLevelRule: string;
  loadedAt: string;
}

export async function loadResearchOverviewAction(input: {
  classResearchId?: string | null;
}): Promise<Result<ResearchOverview>> {
  return run(async () => {
    await requireAdmin();
    const scope = scopeOf(input?.classResearchId);
    const db = getAdminFirestore();
    const [classSnap, loaded] = await Promise.all([
      db.collection(COLLECTIONS.researchClasses).get(),
      loadConsentedAttempts(scope),
    ]);
    const rows = summarizeStudentQuestions(loaded.attempts);
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
      attemptCount: loaded.attempts.length,
      studentCount: new Set(loaded.attempts.map((a) => a.researchId)).size,
      consentExcludedStudents: loaded.consentExcludedStudents,
      questionSummary: summarizeQuestions(rows),
      appLevelRule: APP_LEVEL_RULE,
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
): Promise<{ rows: ExtractionRow[]; consentExcludedStudents: number }> {
  const [loaded, exclusions] = await Promise.all([loadConsentedAttempts(scope), loadActiveExclusions()]);
  const wanted = new Set(questionIds);
  const rows = summarizeStudentQuestions(loaded.attempts.filter((a) => wanted.has(a.questionId))).map(
    (r): ExtractionRow => ({
      ...r,
      exclusion: exclusions.get(exclusionKey(r.researchId, r.questionId)) ?? null,
      piiSuspected: privacy.checkBeforeSend(r.finalPrompt).decision === 'hold_for_teacher',
    })
  );
  return { rows, consentExcludedStudents: loaded.consentExcludedStudents };
}

export interface ExtractionView {
  questionIds: string[];
  rows: ExtractionRow[];
  consentExcludedStudents: number;
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
    const { rows, consentExcludedStudents } = await buildExtractionRows(questionIds, scope);
    await recordAdminEvent('research_extraction_view', scope, { questionIds, rows: rows.length });
    return { questionIds, rows, consentExcludedStudents };
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
          schemaVersion: EXTRACTION_SCHEMA_VERSION,
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
}

function newSampleId(): string {
  return `S-${stamp()}-${randomBytes(3).toString('hex')}`;
}

/**
 * 제외 뒤 앱 AI 5수준별로 문항마다 perLevel개를 고정 시드로 뽑고, 결과를 저장한다.
 * 저장하는 것: 시드·문항·n·수준 산정 규칙·층별 후보(연구ID·최종 제출ID)·제외 목록·뽑힌 사례.
 * 같은 시드와 같은 후보면 같은 결과가 나온다.
 */
export async function drawSampleAction(input: {
  questionIds: string[];
  perLevel: number;
  seed: string;
  classResearchId?: string | null;
}): Promise<Result<SampleView & CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const questionIds = validQuestionIds(input?.questionIds);
    const perLevel = Number(input?.perLevel);
    const seed = String(input?.seed ?? '').trim();
    const problem = sampleInputProblem({ questionIds, perLevel, seed });
    if (problem) throw new ResearchInputError(problem);
    const scope = scopeOf(input?.classResearchId);

    const { rows, consentExcludedStudents } = await buildExtractionRows(questionIds, scope);
    const excludedKeys = new Set(
      rows.filter((r) => r.exclusion).map((r) => exclusionKey(r.researchId, r.questionId))
    );
    const plain: StudentQuestionSummary[] = rows.map(({ exclusion: _e, piiSuspected: _p, ...rest }) => rest);
    const result = drawStratifiedSample({ rows: plain, questionIds, perLevel, seed, excludedKeys });

    const sampleId = newSampleId();
    const createdAt = new Date().toISOString();
    const candidates = questionIds.flatMap((questionId) =>
      [1, 2, 3, 4, 5].map((level) => ({
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
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      sampleId,
      seed,
      perLevel,
      questionIds,
      classResearchId: scope,
      appLevelRule: APP_LEVEL_RULE,
      createdAt,
      codeCommit: CODE_COMMIT,
      strata: result.strata,
      excludedCount: result.excludedCount,
      unlevelledCount: result.unlevelledCount,
      consentExcludedStudents,
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
      filename: `rp_sample_${sampleId}.csv`,
      csv: buildSampleCsv(sampleId, seed, result.cases),
      rowCount: result.cases.length,
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
}

export async function listSamplesAction(): Promise<Result<SampleListItem[]>> {
  return run(async () => {
    await requireAdmin();
    const snap = await samplesCollection().orderBy('createdAt', 'desc').limit(30).get();
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
      };
    });
  });
}

/** 저장해 둔 추출 결과를 그대로 CSV로 다시 받는다(다시 뽑지 않는다). */
export async function exportSampleCsvAction(sampleId: string): Promise<Result<CsvFile>> {
  return run(async () => {
    await requireAdmin();
    const id = assertSafeDocId(String(sampleId ?? ''), '추출 번호');
    const snap = await samplesCollection().doc(id).get();
    if (!snap.exists) throw new ResearchInputError('없는 추출 기록입니다.');
    const data = snap.data() ?? {};
    const cases = Array.isArray(data.cases) ? (data.cases as SampleCase[]) : [];
    const csv = buildSampleCsv(id, typeof data.seed === 'string' ? data.seed : '', cases);
    await recordAdminEvent('research_export', id, { kind: 'sample', rows: cases.length });
    return { filename: `rp_sample_${id}.csv`, csv, rowCount: cases.length };
  });
}
