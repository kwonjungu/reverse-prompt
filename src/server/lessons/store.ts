import 'server-only';

/**
 * 차시 개방 기록과 연습 제출 기록의 서버 저장소 — 실제 배선.
 *
 * 판정과 기록 규칙은 store-core.ts에 있고 이 파일은 Firestore 연결과 컬렉션 경로만
 * 맡는다. 설계서 §4·§6·§7 대응.
 *
 *   - Firestore는 반드시 @/server/firebase-admin의 getAdminFirestore()로만 연다.
 *     예전에는 이 파일이 firebase-admin을 직접 열어 애플리케이션 기본 자격증명(ADC)을
 *     집어 자격증명 관문을 지나쳤다. 그 통로를 없앤다(감사 A-2).
 *   - 자격증명이 없으면 AuthError('not_configured')로 실패한다. 메모리 저장으로
 *     조용히 내려가 '저장된 것처럼' 보이게 하지 않는다(감사 A-3).
 *   - 컬렉션 이름을 여기에 적지 않는다. @/server/firebase-admin의 단일 지점을 쓴다.
 *     기존 classes/ 트리(비연구 수업 기록)는 건드리지 않는다.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { AuthError } from '@/server/auth/contract';
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  isAdminConfigured,
  researchPath,
} from '@/server/firebase-admin';
import {
  DuplicateDocumentError,
  createLessonStore,
  type LessonBackend,
  type LessonPaths,
  type LessonStore,
} from './store-core';

export {
  LESSON_SCHEMA_VERSION,
  PRACTICE_SUBMISSION_SCHEMA_VERSION,
  createMemoryBackend,
  emptyLessonSession,
  toOpenState,
} from './store-core';
export type {
  FeedbackReview,
  LessonSessionRecord,
  LessonStore,
  PracticeScoringRecord,
  PracticeSubmissionRecord,
  SaveResult,
  StudentSubmissionSummary,
} from './store-core';

/**
 * 일반 체험 제출이 놓이는 비연구 하위 컬렉션 이름.
 *
 * 연구 자료 이름은 @/server/firebase-admin의 RESEARCH_COLLECTIONS가 단일 지점이지만
 * 비연구 수업 기록 트리(classes/…)의 하위 이름은 거기에 없다. 기존 practice_attempts·
 * submissions 문서를 건드리지 않으려고 새 이름을 여기서만 쓴다.
 */
const EXPERIENCE_SUBMISSIONS = 'experience_practice_submissions';

const PATHS: LessonPaths = {
  lessonSessions: researchPath(RESEARCH_COLLECTIONS.lessonSessions),
  researchPracticeSubmissions: researchPath(RESEARCH_COLLECTIONS.practiceSubmissions),
  experienceSubmissions: (classCode: string) =>
    `${COLLECTIONS.classes}/${assertSafeDocId(classCode, '학급')}/${EXPERIENCE_SUBMISSIONS}`,
};

/** Firestore를 문서 단위 계약으로 감싼다. 규칙 판정은 store-core가 한다. */
function createFirestoreBackend(db: Firestore): LessonBackend {
  return {
    durable: true,
    async get<T>(collectionPath: string, docId: string) {
      const snap = await db.collection(collectionPath).doc(docId).get();
      return snap.exists ? (snap.data() as T) : null;
    },
    async create(collectionPath: string, docId: string, data: unknown) {
      try {
        await db.collection(collectionPath).doc(docId).create(data as Record<string, unknown>);
      } catch (err: unknown) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === 6 || /already exists/i.test(String((err as Error)?.message ?? ''))) {
          throw new DuplicateDocumentError(`${collectionPath}/${docId}`);
        }
        throw err;
      }
    },
    async set(collectionPath: string, docId: string, data: unknown) {
      await db.collection(collectionPath).doc(docId).set(data as Record<string, unknown>);
    },
    async merge(collectionPath: string, docId: string, patch: Record<string, unknown>) {
      const ref = db.collection(collectionPath).doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return false;
      await ref.set(patch, { merge: true });
      return true;
    },
    async query<T>(collectionPath: string, field: string, value: unknown) {
      const snap = await db.collection(collectionPath).where(field, '==', value).get();
      return snap.docs.map((d) => d.data() as T);
    },
  };
}

let cached: LessonStore | null = null;

/**
 * 서버 저장소를 얻는다.
 * 자격증명이 없으면 여기서 실패한다. 우회 저장으로 내려가지 않는다.
 */
export function getLessonStore(): LessonStore {
  if (cached) return cached;
  if (!isAdminConfigured()) {
    throw new AuthError('서버 자격증명이 없어 수업 기록을 열 수 없습니다.', 'not_configured');
  }
  cached = createLessonStore({
    backend: createFirestoreBackend(getAdminFirestore()),
    paths: PATHS,
    safeDocId: assertSafeDocId,
  });
  return cached;
}

/** 시험에서 가짜 저장소를 넣기 위한 통로. 운영 경로에서는 부르지 않는다. */
export function __setLessonStoreForTests(store: LessonStore | null): void {
  cached = store;
}
