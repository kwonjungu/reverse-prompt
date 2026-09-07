import 'server-only';

/**
 * AssessmentStore의 Firestore 구현.
 *
 * 기존 classes/ 트리를 건드리지 않고 research/{schemaVersion}/ 아래에만 쓴다.
 * 서버 자격증명이 없으면 연구 흐름을 열지 않는다. 열린 것처럼 보이게 하지 않는다.
 *
 * 이중 저장 방지는 문서ID를 submissionId로 두고 create를 쓰는 것으로 구현한다.
 * Firestore의 create는 문서가 이미 있으면 실패하므로 최초 유효 제출이 불변이 된다.
 */

import type { Query } from 'firebase-admin/firestore';
import { FIREBASE_ADMIN_CREDENTIAL } from '@/server/config';
import type { AssessmentSession, ScoringRun, SubmissionRecord } from '@/lib/research/types';
import {
  COLLECTIONS,
  DuplicateWriteError,
  collectionPath,
  type AssessmentStore,
  type ItemWindowRecord,
  type ScoringBatchRecord,
} from './store';

export class AssessmentStoreNotConfiguredError extends Error {
  constructor() {
    super('서버 Firebase 자격증명이 없어 연구 검사 저장소를 열 수 없다');
    this.name = 'AssessmentStoreNotConfiguredError';
  }
}

/** firebase-admin을 지연 로드한다. 자격증명이 없으면 저장소를 만들지 않는다. */
async function getDb() {
  if (!FIREBASE_ADMIN_CREDENTIAL) throw new AssessmentStoreNotConfiguredError();
  const appMod = await import('firebase-admin/app');
  const fsMod = await import('firebase-admin/firestore');
  const existing = appMod.getApps();
  const app = existing.length
    ? existing[0]
    : appMod.initializeApp({
        credential: appMod.cert(JSON.parse(FIREBASE_ADMIN_CREDENTIAL)),
      });
  return fsMod.getFirestore(app);
}

/** Firestore 문서에는 undefined를 넣을 수 없다. null은 그대로 둔다(결측 구분을 지킨다). */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function createFirestoreAssessmentStore(): AssessmentStore {
  const col = async (name: string) => (await getDb()).collection(collectionPath(name));

  return {
    async getSession(assessmentSessionId) {
      const snap = await (await col(COLLECTIONS.sessions)).doc(assessmentSessionId).get();
      return snap.exists ? (snap.data() as AssessmentSession) : null;
    },
    async putSession(session) {
      await (await col(COLLECTIONS.sessions))
        .doc(session.assessmentSessionId)
        .set(stripUndefined({ ...session }), { merge: true });
    },
    async findOpenSession(classResearchId, phase) {
      const snap = await (await col(COLLECTIONS.sessions))
        .where('classResearchId', '==', classResearchId)
        .where('phase', '==', phase)
        .where('closedAt', '==', null)
        .limit(1)
        .get();
      return snap.empty ? null : (snap.docs[0].data() as AssessmentSession);
    },

    async getItemWindow(windowId) {
      const snap = await (await col(COLLECTIONS.itemWindows)).doc(windowId).get();
      return snap.exists ? (snap.data() as ItemWindowRecord) : null;
    },
    async createItemWindowIfAbsent(win) {
      const ref = (await col(COLLECTIONS.itemWindows)).doc(win.windowId);
      try {
        await ref.create(stripUndefined({ ...win }));
        return win;
      } catch {
        // 이미 열려 있는 문항이다. 시작 시각을 다시 쓰지 않고 기존 값을 쓴다.
        const snap = await ref.get();
        return snap.exists ? (snap.data() as ItemWindowRecord) : win;
      }
    },
    async updateItemWindowDelivery(windowId, delivery, technicalFailureReason) {
      await (await col(COLLECTIONS.itemWindows))
        .doc(windowId)
        .set({ delivery, technicalFailureReason }, { merge: true });
    },

    async getSubmission(submissionId) {
      const snap = await (await col(COLLECTIONS.submissions)).doc(submissionId).get();
      return snap.exists ? (snap.data() as SubmissionRecord) : null;
    },
    async putSubmission(record) {
      const ref = (await col(COLLECTIONS.submissions)).doc(record.submissionId);
      const snap = await ref.get();
      if (snap.exists && (snap.data() as SubmissionRecord).persistStatus !== 'failed') {
        throw new DuplicateWriteError(record.submissionId);
      }
      if (snap.exists) {
        await ref.set(stripUndefined({ ...record }));
      } else {
        await ref.create(stripUndefined({ ...record }));
      }
    },
    async appendRejection(record) {
      await (await col(COLLECTIONS.rejections)).add(stripUndefined({ ...record }));
    },
    async listSubmissions(filter) {
      let q: Query = await col(COLLECTIONS.submissions);
      if (filter?.classResearchId) q = q.where('classResearchId', '==', filter.classResearchId);
      if (filter?.phase) q = q.where('phase', '==', filter.phase);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as SubmissionRecord);
    },

    async getScoringRun(submissionId, repeatIndex) {
      const snap = await (await col(COLLECTIONS.scoringRuns))
        .doc(`${submissionId}__${repeatIndex}`)
        .get();
      return snap.exists ? (snap.data() as ScoringRun) : null;
    },
    async putScoringRun(submissionId, run) {
      // 같은 (제출, 반복)의 결과는 덮어쓰지 않는다. 주 자료(repeatIndex 1)의 불변을 지킨다.
      await (await col(COLLECTIONS.scoringRuns))
        .doc(`${submissionId}__${run.repeatIndex}`)
        .create(stripUndefined({ submissionId, ...run } as unknown as Record<string, unknown>));
    },
    async putScoringBatch(batch: ScoringBatchRecord) {
      await (await col(COLLECTIONS.scoringBatches))
        .doc(batch.batchId)
        .create(stripUndefined({ ...batch }));
    },
  };
}
