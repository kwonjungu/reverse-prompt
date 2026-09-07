import 'server-only';

/**
 * AssessmentStore의 Firestore 구현.
 *
 * 기존 classes/ 트리를 건드리지 않고 research/{schemaVersion}/ 아래에만 쓴다.
 * 경로는 @/server/firebase-admin의 researchPath()에서만 온다. 이 파일에 컬렉션
 * 이름을 직접 적지 않는다. 쓰기와 읽기가 서로 다른 경로를 쓰던 결함을 구조로 막는다.
 *
 * 서버 자격증명이 없으면 연구 흐름을 열지 않는다. 열린 것처럼 보이게 하지 않는다.
 *
 * 이중 저장 방지는 문서ID를 '학생·시점·문항 한 칸'의 자연 키로 두고 create를 쓰는
 * 것으로 구현한다. Firestore의 create는 문서가 이미 있으면 실패하므로 최초 유효
 * 제출이 불변이 된다. 클라이언트가 새 submissionId를 지어내도 칸은 하나다.
 *
 * get 뒤 create 하는 방식은 두 요청이 겹칠 때 둘 다 '없음'을 보고 나중 것이 예외로
 * 죽어 '저장 실패'로 보였다. 그래서 여기서는 create를 먼저 시도하고 충돌일 때만
 * 다시 읽어 중복으로 판정한다.
 */

import {
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  isAdminConfigured,
  researchPath,
  type ResearchCollection,
} from '@/server/firebase-admin';
import { AuthError } from '@/server/auth/contract';
import type { AssessmentSession, ScoringRun, SubmissionRecord } from '@/lib/research/types';
import { resolveSubmission, type SubmissionDecision } from './submission';
import {
  DuplicateWriteError,
  cellIdOf,
  cellIdOfRecord,
  type AssessmentStore,
  type ItemWindowPatch,
  type ItemWindowRecord,
  type ScoringBatchRecord,
} from './store';

export class AssessmentStoreNotConfiguredError extends Error {
  constructor() {
    super('서버 Firebase 자격증명이 없어 연구 검사 저장소를 열 수 없다');
    this.name = 'AssessmentStoreNotConfiguredError';
  }
}

/* ────────────────────── 최소 Firestore 계약 ──────────────────────
 * 테스트가 가짜 Firestore를 주입해 이 구현의 동작(메모리 저장소와 같아야 한다)을
 * 그대로 확인할 수 있도록, 실제로 쓰는 기능만 형(型)으로 추린다.
 */

export interface DocSnapshotLike {
  readonly exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRefLike {
  get(): Promise<DocSnapshotLike>;
  /** 이미 있으면 반드시 실패해야 한다. 이중 저장 방지의 근거다. */
  create(data: Record<string, unknown>): Promise<unknown>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  /** 없는 문서를 만들지 않는다. 없으면 실패해야 한다. */
  update(data: Record<string, unknown>): Promise<unknown>;
}

export interface QueryLike {
  where(field: string, op: string, value: unknown): QueryLike;
  limit(n: number): QueryLike;
  get(): Promise<{ empty: boolean; docs: DocSnapshotLike[] }>;
}

export interface CollectionLike extends QueryLike {
  doc(id: string): DocRefLike;
  add(data: Record<string, unknown>): Promise<unknown>;
}

export interface FirestoreLike {
  collection(path: string): CollectionLike;
}

/** Firestore 문서에는 undefined를 넣을 수 없다. null은 그대로 둔다(결측 구분을 지킨다). */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * 서버가 조립한 문서ID의 안전 점검.
 *
 * 클라이언트가 보낸 낱값(문항ID)은 assertSafeDocId로 거른다. 다만 그 함수는 '-'까지
 * 거부하는데 연구ID(예: R-0001)·학급 연구ID·제출ID(SUBMISSION_ID_PATTERN)는 '-'를
 * 허용한다. 그래서 서버가 그 값들로 조립한 키는 경로 구분자·상대경로·이상 문자만
 * 여기서 막는다. 조립에 들어가는 낱값은 모두 서버가 확정했거나 위에서 검사한 값이다.
 */
function assertComposedDocId(value: string, label: string): string {
  const ok =
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 400 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9_.:@+-]+$/.test(value);
  if (!ok) throw new AuthError(`${label} 값이 올바르지 않습니다.`, 'forbidden');
  return value;
}

function defaultDb(): FirestoreLike {
  // 자격증명이 없으면 저장소를 만들지 않는다. 인증 우회로를 두지 않는다.
  if (!isAdminConfigured()) throw new AssessmentStoreNotConfiguredError();
  return getAdminFirestore() as unknown as FirestoreLike;
}

/**
 * 저장된 문항 창 문서를 읽는다. 이전 세대 문서에 없던 필드는 null로 채운다.
 * (학생 신고 필드는 나중에 생겼다. 없는 값을 '신고 있음'으로 읽지 않는다.)
 */
function toItemWindow(data: Record<string, unknown>): ItemWindowRecord {
  const w = data as unknown as ItemWindowRecord;
  return {
    ...w,
    technicalFailureReason: w.technicalFailureReason ?? null,
    studentReportedFailureReason: w.studentReportedFailureReason ?? null,
    studentReportedFailureAt: w.studentReportedFailureAt ?? null,
  };
}

export function createFirestoreAssessmentStore(deps?: {
  /** 테스트가 가짜 Firestore를 넣는 자리. 실제 운영에서는 쓰지 않는다. */
  db?: FirestoreLike;
}): AssessmentStore {
  const db = (): FirestoreLike => deps?.db ?? defaultDb();
  const col = (name: ResearchCollection): CollectionLike =>
    db().collection(researchPath(name));

  /**
   * 제출 문서 하나. 문서ID는 학생·시점·문항 한 칸의 자연 키다.
   * 클라이언트에서 오는 값은 questionId뿐이므로 그 값만 낱개로 거른다.
   */
  const submissionRef = (
    researchId: string,
    phase: SubmissionRecord['phase'],
    questionId: string
  ): DocRefLike => {
    assertSafeDocId(questionId, '문항 식별자');
    if (!phase) throw new AuthError('검사 시점이 없습니다.', 'forbidden');
    const cellId = assertComposedDocId(
      cellIdOf(researchId, phase, questionId),
      '제출 칸 식별자'
    );
    return col(RESEARCH_COLLECTIONS.assessmentSubmissions).doc(cellId);
  };

  return {
    async getSession(assessmentSessionId) {
      const snap = await col(RESEARCH_COLLECTIONS.assessmentSessions)
        .doc(assertComposedDocId(assessmentSessionId, '검사 세션 식별자'))
        .get();
      return snap.exists ? (snap.data() as unknown as AssessmentSession) : null;
    },
    async putSession(session) {
      await col(RESEARCH_COLLECTIONS.assessmentSessions)
        .doc(assertComposedDocId(session.assessmentSessionId, '검사 세션 식별자'))
        .set(stripUndefined({ ...session } as unknown as Record<string, unknown>), { merge: true });
    },
    async findOpenSession(classResearchId, phase) {
      const snap = await col(RESEARCH_COLLECTIONS.assessmentSessions)
        .where('classResearchId', '==', classResearchId)
        .where('phase', '==', phase)
        .where('closedAt', '==', null)
        .limit(1)
        .get();
      return snap.empty ? null : (snap.docs[0].data() as unknown as AssessmentSession);
    },

    async getItemWindow(windowId) {
      const snap = await col(RESEARCH_COLLECTIONS.assessmentWindows)
        .doc(assertComposedDocId(windowId, '문항 창 식별자'))
        .get();
      const data = snap.exists ? snap.data() : undefined;
      return data ? toItemWindow(data) : null;
    },
    async createItemWindowIfAbsent(win) {
      assertSafeDocId(win.questionId, '문항 식별자');
      const ref = col(RESEARCH_COLLECTIONS.assessmentWindows).doc(
        assertComposedDocId(win.windowId, '문항 창 식별자')
      );
      try {
        await ref.create(stripUndefined({ ...win } as unknown as Record<string, unknown>));
        return win;
      } catch (error) {
        // 이미 열려 있는 문항이다. 시작 시각을 다시 쓰지 않고 기존 값을 쓴다.
        const snap = await ref.get();
        const data = snap.exists ? snap.data() : undefined;
        if (!data) throw error;
        return toItemWindow(data);
      }
    },
    async patchItemWindow(windowId, patch: ItemWindowPatch) {
      const ref = col(RESEARCH_COLLECTIONS.assessmentWindows).doc(
        assertComposedDocId(windowId, '문항 창 식별자')
      );
      try {
        // merge-set이 아니라 update를 쓴다. 없는 창을 만들지 않는다.
        await ref.update(stripUndefined({ ...patch } as Record<string, unknown>));
        return true;
      } catch (error) {
        const snap = await ref.get();
        // 창이 없으면 조용히 실패로 알린다(메모리 저장소와 같은 동작).
        if (!snap.exists) return false;
        throw error;
      }
    },

    async getSubmissionForCell(researchId, phase, questionId) {
      const snap = await submissionRef(researchId, phase, questionId).get();
      return snap.exists ? (snap.data() as unknown as SubmissionRecord) : null;
    },

    async claimSubmission(record): Promise<SubmissionDecision> {
      cellIdOfRecord(record);
      const ref = submissionRef(record.researchId as string, record.phase, record.questionId);
      const data = stripUndefined({ ...record } as unknown as Record<string, unknown>);

      try {
        // 먼저 create를 시도한다. 경합해도 한쪽만 성공한다.
        await ref.create(data);
        return { outcome: 'stored', authoritative: record, toStore: record, rejection: null };
      } catch (error) {
        const snap = await ref.get();
        const existingData = snap.exists ? snap.data() : undefined;
        // 이미 있어서 실패한 것이 아니면(네트워크 등) 그대로 올린다. 조용히 삼키지 않는다.
        if (!existingData) throw error;

        const existing = existingData as unknown as SubmissionRecord;
        const decision = resolveSubmission(existing, record);
        if (decision.toStore) {
          // 앞선 저장이 실패로 남은 자리다. 같은 칸에 다시 쓴다.
          await ref.set(
            stripUndefined({ ...decision.toStore } as unknown as Record<string, unknown>)
          );
        }
        return decision;
      }
    },

    async putSubmission(record) {
      const cellId = cellIdOfRecord(record);
      const ref = submissionRef(record.researchId as string, record.phase, record.questionId);
      const data = stripUndefined({ ...record } as unknown as Record<string, unknown>);
      try {
        await ref.create(data);
      } catch (error) {
        const snap = await ref.get();
        const existingData = snap.exists ? snap.data() : undefined;
        if (!existingData) throw error;
        const existing = existingData as unknown as SubmissionRecord;
        // 저장 실패로 남은 자리만 다시 쓴다. 그 외의 덮어쓰기는 막는다.
        if (existing.persistStatus !== 'failed') throw new DuplicateWriteError(cellId);
        await ref.set(data);
      }
    },
    async appendRejection(record) {
      await col(RESEARCH_COLLECTIONS.assessmentRejections).add(
        stripUndefined({ ...record } as unknown as Record<string, unknown>)
      );
    },
    async listSubmissions(scope) {
      let q: QueryLike = col(RESEARCH_COLLECTIONS.assessmentSubmissions);
      // 학급 범위를 서버에서 좁힌다. 타 학급 전체 스캔을 하지 않는다.
      if ('classResearchId' in scope) q = q.where('classResearchId', '==', scope.classResearchId);
      if (scope.phase) q = q.where('phase', '==', scope.phase);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as unknown as SubmissionRecord);
    },

    async getScoringRun(submissionId, repeatIndex) {
      const snap = await col(RESEARCH_COLLECTIONS.scoringRuns)
        .doc(assertComposedDocId(`${submissionId}__${repeatIndex}`, '채점 작업 식별자'))
        .get();
      return snap.exists ? (snap.data() as unknown as ScoringRun) : null;
    },
    async putScoringRun(submissionId, run) {
      // 같은 (제출, 반복)의 결과는 덮어쓰지 않는다. 주 자료(repeatIndex 1)의 불변을 지킨다.
      await col(RESEARCH_COLLECTIONS.scoringRuns)
        .doc(assertComposedDocId(`${submissionId}__${run.repeatIndex}`, '채점 작업 식별자'))
        .create(stripUndefined({ submissionId, ...run } as unknown as Record<string, unknown>));
    },
    async putScoringBatch(batch: ScoringBatchRecord) {
      await col(RESEARCH_COLLECTIONS.scoringBatches)
        .doc(assertComposedDocId(batch.batchId, '채점 묶음 식별자'))
        .create(stripUndefined({ ...batch } as unknown as Record<string, unknown>));
    },
  };
}
