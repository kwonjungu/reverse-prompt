/**
 * 차시 기록·연습 제출 저장소의 순수 핵심.
 *
 * 이 파일은 'server-only'와 firebase-admin을 import 하지 않는다. 저장 매체를
 * 주입받아 판정과 기록 규칙만 담으므로 tests/lessons.test.ts가 가짜 저장소를 넣고
 * 그대로 확인할 수 있다. 실제 Firestore 배선과 컬렉션 경로는 store.ts가 맡는다.
 *
 * 설계서 §4·§7 대응.
 *   - 차시·제출 이력은 서버에 있다. 기기를 바꿔도 여기서 복원한다.
 *   - 같은 제출은 이중 저장되지 않는다. 최초 유효 제출을 바꾸지 않는다.
 *   - 저장 실패를 성공으로 보고하지 않는다. persistStatus는 실제 결과를 적는다.
 *   - 컬렉션 이름을 이 파일에 직접 적지 않는다. 완성된 경로를 주입받는다.
 */

import { SCHEMA_VERSION } from '@/lib/research/types';
import type {
  FeedbackPresentation,
  LessonSession,
  OperationalResult,
  SessionType,
  SubmissionRecord,
  CallRecord,
} from '@/lib/research/types';
import {
  openLesson as applyOpenLesson,
  closeLesson as applyCloseLesson,
  type LessonOpenState,
} from './policy';

/* ────────────────────────── 기록 형 ────────────────────────── */

/** LessonSession에 저장 관리용 필드만 덧붙인다. */
export interface LessonSessionRecord extends LessonSession {
  schemaVersion: string;
  updatedAt: string;
}

export interface PracticeScoringRecord {
  operationId: string | null;
  repeatIndex: number | null;
  result: OperationalResult | null;
  calls: CallRecord[];
  extraCall: boolean | null;
  feedback: FeedbackPresentation | null;
  modelId: string | null;
  modelConfig: Record<string, unknown> | null;
  promptHash: string | null;
  codeCommit: string | null;
  scoredAt: string | null;
  /** 채점 자체가 오류로 끝났을 때의 사유. 학생 화면 문구가 아니다. */
  failureReason: string | null;
}

export interface FeedbackReview {
  kind: 'revised' | 'kept';
  /** kind가 kept일 때 학생이 적은 '고치지 않은 까닭'. */
  note: string | null;
  /** kind가 revised일 때 다시 제출한 제출ID. */
  revisedSubmissionId: string | null;
  recordedAt: string;
}

/**
 * 연습 제출 한 건.
 *
 * SubmissionRecord를 그대로 쓰되, 아직 확정되지 않은 운영값은 null로 남긴다.
 * 미확정 값을 빈 문자열로 채워 확정된 것처럼 보이게 하지 않는다(설계서 원칙 1).
 */
export interface PracticeSubmissionRecord
  extends Omit<SubmissionRecord, 'imageHash' | 'cueVersion' | 'rubricVersion'> {
  imageHash: string | null;
  cueVersion: string | null;
  rubricVersion: string | null;
  questionLevel: number;
  /**
   * 이 제출의 소유자. 연구 세션은 researchId, 일반 체험은 서버 세션 소유자다.
   * 출석번호·학교코드 같은 옛 신원을 쓰지 않는다(감사 A-11).
   * 피드백 검토 기록의 소유자 검사가 이 값을 근거로 한다(감사 A-6).
   */
  ownerKey: string;
  /** 클라이언트가 만들어 보낸 제출ID. 문서 경로에는 쓰지 않고 기록만 남긴다. */
  clientSubmissionId: string | null;
  /** 채점 작업의 결과와 호출 이력. 결측이면 score·levels·axisScores가 모두 null이다. */
  scoring: PracticeScoringRecord;
  /** 피드백 검토 기록. 재제출 또는 고치지 않은 까닭 중 하나가 남는다. */
  feedbackReview: FeedbackReview | null;
  createdAt: string;
}

export interface SaveResult {
  ok: boolean;
  /** 같은 제출ID가 이미 있어 새로 쓰지 않았다. 이중 저장이 아니다. */
  duplicate: boolean;
  /** 재시작해도 남는 저장소에 기록되었는가. */
  durable: boolean;
  error: string | null;
}

export interface StudentSubmissionSummary {
  /** questionId → 제출 횟수. 완료 강제가 아니라 정보 표시용이다. */
  attemptsByQuestion: Record<string, number>;
  /** 피드백 검토를 남긴 문항 수. 적어도 한 문항에서 남기도록 안내할 때 쓴다. */
  reviewedQuestionCount: number;
}

export const LESSON_SCHEMA_VERSION = `${SCHEMA_VERSION}-lesson-session`;
export const PRACTICE_SUBMISSION_SCHEMA_VERSION = `${SCHEMA_VERSION}-practice-submission`;

/* ────────────────────────── 저장 매체 계약 ────────────────────────── */

export class DuplicateDocumentError extends Error {
  constructor(readonly documentId: string) {
    super(`이미 있는 문서에 다시 쓰려 하였다: ${documentId}`);
    this.name = 'DuplicateDocumentError';
  }
}

/**
 * 문서 단위 저장 매체. Firestore 구현은 store.ts에, 메모리 구현은 아래에 둔다.
 * create는 이미 있는 문서에 대해 반드시 실패해야 한다(이중 저장 방지의 근거).
 */
export interface LessonBackend {
  /** 재시작해도 남는 저장소인가. 연구 자료는 false면 저장 성공으로 보고하지 않는다. */
  readonly durable: boolean;
  get<T>(collectionPath: string, docId: string): Promise<T | null>;
  create(collectionPath: string, docId: string, data: unknown): Promise<void>;
  set(collectionPath: string, docId: string, data: unknown): Promise<void>;
  /** 있는 문서에만 병합한다. 없으면 false. */
  merge(collectionPath: string, docId: string, patch: Record<string, unknown>): Promise<boolean>;
  query<T>(collectionPath: string, field: string, value: unknown): Promise<T[]>;
}

/** 시험·개발용 메모리 저장소. 연구 자료의 보관 수단이 아니므로 durable=false. */
export function createMemoryBackend(): LessonBackend & { dump(): Map<string, unknown> } {
  const docs = new Map<string, unknown>();
  const key = (c: string, id: string) => `${c}/${id}`;
  return {
    durable: false,
    dump: () => docs,
    async get<T>(c: string, id: string) {
      return (docs.get(key(c, id)) as T) ?? null;
    },
    async create(c: string, id: string, data: unknown) {
      if (docs.has(key(c, id))) throw new DuplicateDocumentError(key(c, id));
      docs.set(key(c, id), data);
    },
    async set(c: string, id: string, data: unknown) {
      docs.set(key(c, id), data);
    },
    async merge(c: string, id: string, patch: Record<string, unknown>) {
      const found = docs.get(key(c, id));
      if (found === undefined) return false;
      docs.set(key(c, id), { ...(found as Record<string, unknown>), ...patch });
      return true;
    },
    async query<T>(c: string, field: string, value: unknown) {
      const prefix = `${c}/`;
      return [...docs.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v as T)
        .filter((v) => (v as Record<string, unknown>)[field] === value);
    },
  };
}

/* ────────────────────────── 저장소 ────────────────────────── */

/**
 * 완성된 컬렉션 경로. 이름 문자열의 단일 지점은 @/server/firebase-admin이며
 * store.ts가 거기서 만들어 넣는다. 이 파일은 이름을 만들지 않는다.
 */
export interface LessonPaths {
  /** 차시 개방 기록(연구). 문서ID는 학급 연구ID. */
  lessonSessions: string;
  /** 연구 연습 제출. 학급·학생은 경로가 아니라 필드로 둔다. */
  researchPracticeSubmissions: string;
  /** 일반 체험 제출. 비연구 수업 기록 트리 아래에 둔다. */
  experienceSubmissions(classCode: string): string;
}

export interface LessonStoreDeps {
  backend: LessonBackend;
  paths: LessonPaths;
  /** 문서 ID로 쓸 수 있는 값인지 확인한다. 통과하지 못하면 던진다. */
  safeDocId(value: string, label: string): string;
}

export interface OpenLessonInput {
  classResearchId: string;
  /** 서버가 확정한 학급의 세션 성격. 클라이언트가 보낸 값을 넣지 않는다. */
  sessionType: SessionType;
  lesson: number;
  openedBy: string;
  reason: string | null;
}

export interface CloseLessonInput {
  classResearchId: string;
  /** 특정 차시만 닫으려면 지정한다. 없으면 세션 전체를 닫는다. */
  lesson?: number;
  closedBy: string;
  reason: string | null;
}

export interface LessonStore {
  /** 재시작해도 남는 저장소인가. 연구 자료는 false면 성공으로 보고하지 않는다. */
  readonly durable: boolean;
  readLessonSession(classResearchId: string): Promise<LessonSessionRecord | null>;
  openLessonSession(
    input: OpenLessonInput
  ): Promise<{ session: LessonSessionRecord; durable: boolean }>;
  closeLessonSession(
    input: CloseLessonInput
  ): Promise<{ session: LessonSessionRecord | null; durable: boolean }>;
  saveSubmission(record: PracticeSubmissionRecord): Promise<SaveResult>;
  readSubmission(
    sessionType: SessionType,
    classKey: string,
    submissionId: string
  ): Promise<PracticeSubmissionRecord | null>;
  attachFeedbackReview(input: {
    sessionType: SessionType;
    classKey: string;
    submissionId: string;
    /** 요청자의 소유 키. 문서의 ownerKey와 다르면 기록하지 않는다. */
    ownerKey: string;
    review: FeedbackReview;
  }): Promise<SaveResult>;
  readStudentSubmissions(
    sessionType: SessionType,
    classKey: string,
    ownerKey: string
  ): Promise<StudentSubmissionSummary>;
}

export function emptyLessonSession(
  classResearchId: string,
  sessionType: SessionType,
  now: string
): LessonSessionRecord {
  return {
    classResearchId,
    sessionType,
    currentLesson: null,
    allowedLessons: [],
    openedAt: null,
    closedAt: null,
    openedBy: null,
    reason: null,
    schemaVersion: LESSON_SCHEMA_VERSION,
    updatedAt: now,
  };
}

/**
 * 판정 함수에 넘길 상태로 줄인다.
 *
 * sessionType은 **학생의 서버 세션**에서만 온다. 학급 기록에 남은 값이 학생 세션을
 * 덮어쓰지 못하게 한다. 교사가 한 번 experience로 열었다고 그 학급 학생 전원이
 * 자율 진행으로 바뀌는 일을 막는다(감사 A-5).
 */
export function toOpenState(
  session: LessonSessionRecord | null,
  studentSessionType: SessionType,
  sessionVerified: boolean
): LessonOpenState {
  return {
    sessionType: studentSessionType,
    currentLesson: session?.currentLesson ?? null,
    allowedLessons: session?.allowedLessons ?? [],
    closedAt: session?.closedAt ?? null,
    sessionVerified,
  };
}

const EMPTY_SUMMARY: StudentSubmissionSummary = {
  attemptsByQuestion: {},
  reviewedQuestionCount: 0,
};

function collectSummary(rows: PracticeSubmissionRecord[]): StudentSubmissionSummary {
  const attemptsByQuestion: Record<string, number> = {};
  const reviewed = new Set<string>();
  for (const row of rows) {
    if (row.responseStatus !== 'submitted') continue;
    if (row.persistStatus === 'failed') continue;
    attemptsByQuestion[row.questionId] = (attemptsByQuestion[row.questionId] ?? 0) + 1;
    if (row.feedbackReview) reviewed.add(row.questionId);
  }
  return { attemptsByQuestion, reviewedQuestionCount: reviewed.size };
}

export function createLessonStore(deps: LessonStoreDeps): LessonStore {
  const { backend, paths, safeDocId } = deps;

  /**
   * 제출이 놓일 컬렉션.
   * 연구 제출은 학급·학생을 경로가 아니라 필드에 둔다. 클라이언트가 보낸 값이
   * 경로에 끼어들어 임의 문서를 덮어쓰던 통로를 없앤다(감사 A-1).
   */
  const submissionCollection = (sessionType: SessionType, classKey: string): string => {
    if (sessionType === 'experience') {
      return paths.experienceSubmissions(safeDocId(classKey, '학급'));
    }
    // 학급 연구ID는 경로에 쓰이지 않지만 형식은 그대로 확인한다.
    safeDocId(classKey, '학급');
    return paths.researchPracticeSubmissions;
  };

  return {
    durable: backend.durable,

    async readLessonSession(classResearchId) {
      safeDocId(classResearchId, '학급');
      return backend.get<LessonSessionRecord>(paths.lessonSessions, classResearchId);
    },

    async openLessonSession(input) {
      safeDocId(input.classResearchId, '학급');
      const now = new Date().toISOString();
      const prev =
        (await backend.get<LessonSessionRecord>(paths.lessonSessions, input.classResearchId)) ??
        emptyLessonSession(input.classResearchId, input.sessionType, now);

      const session: LessonSessionRecord = {
        ...prev,
        // 기록의 sessionType은 서버가 확정한 학급 성격이다. 학생 세션을 덮어쓰지 않는다.
        sessionType: input.sessionType,
        currentLesson: input.lesson,
        allowedLessons: applyOpenLesson(prev.allowedLessons ?? [], input.lesson),
        openedAt: prev.openedAt ?? now,
        closedAt: null,
        openedBy: input.openedBy,
        reason: input.reason,
        schemaVersion: LESSON_SCHEMA_VERSION,
        updatedAt: now,
      };
      try {
        await backend.set(paths.lessonSessions, input.classResearchId, session);
        return { session, durable: backend.durable };
      } catch {
        return { session, durable: false };
      }
    },

    async closeLessonSession(input) {
      safeDocId(input.classResearchId, '학급');
      const prev = await backend.get<LessonSessionRecord>(
        paths.lessonSessions,
        input.classResearchId
      );
      if (!prev) return { session: null, durable: false };
      const now = new Date().toISOString();
      const session: LessonSessionRecord =
        input.lesson === undefined
          ? { ...prev, closedAt: now, reason: input.reason, updatedAt: now }
          : {
              ...prev,
              allowedLessons: applyCloseLesson(prev.allowedLessons ?? [], input.lesson),
              currentLesson: prev.currentLesson === input.lesson ? null : prev.currentLesson,
              reason: input.reason,
              updatedAt: now,
            };
      try {
        await backend.set(paths.lessonSessions, input.classResearchId, session);
        return { session, durable: backend.durable };
      } catch {
        return { session, durable: false };
      }
    },

    async saveSubmission(record) {
      if (!record.classResearchId) {
        return {
          ok: false,
          duplicate: false,
          durable: false,
          error: '학급을 확인하지 못해 저장하지 않았습니다.',
        };
      }
      let collection: string;
      let docId: string;
      try {
        collection = submissionCollection(record.sessionType, record.classResearchId);
        docId = safeDocId(record.submissionId, '제출');
      } catch (err) {
        return {
          ok: false,
          duplicate: false,
          durable: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      try {
        // persistStatus는 실제로 쓰인 문서에만 'stored'로 남는다.
        // 쓰기가 실패하면 문서 자체가 없으므로 성공으로 보이는 기록이 생기지 않는다(감사 A-7).
        await backend.create(collection, docId, { ...record, persistStatus: 'stored' });
        return { ok: true, duplicate: false, durable: backend.durable, error: null };
      } catch (err: unknown) {
        if (isAlreadyExists(err)) {
          // 같은 제출ID의 재요청이다. 최초 유효 제출을 바꾸지 않는다.
          return { ok: true, duplicate: true, durable: backend.durable, error: null };
        }
        return {
          ok: false,
          duplicate: false,
          durable: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async readSubmission(sessionType, classKey, submissionId) {
      const collection = submissionCollection(sessionType, classKey);
      return backend.get<PracticeSubmissionRecord>(
        collection,
        safeDocId(submissionId, '제출')
      );
    },

    async attachFeedbackReview(input) {
      const collection = submissionCollection(input.sessionType, input.classKey);
      const docId = safeDocId(input.submissionId, '제출');
      const found = await backend.get<PracticeSubmissionRecord>(collection, docId);
      if (!found) {
        return { ok: false, duplicate: false, durable: false, error: '제출을 찾지 못했습니다.' };
      }
      // 같은 학급이라도 남의 제출은 고치지 못한다(감사 A-6).
      if (!found.ownerKey || found.ownerKey !== input.ownerKey) {
        return { ok: false, duplicate: false, durable: false, error: 'not_owner' };
      }
      const merged = await backend.merge(collection, docId, { feedbackReview: input.review });
      if (!merged) {
        return { ok: false, duplicate: false, durable: false, error: '제출을 찾지 못했습니다.' };
      }
      return { ok: true, duplicate: false, durable: backend.durable, error: null };
    },

    async readStudentSubmissions(sessionType, classKey, ownerKey) {
      if (!ownerKey) return EMPTY_SUMMARY;
      try {
        const collection = submissionCollection(sessionType, classKey);
        const rows = await backend.query<PracticeSubmissionRecord>(
          collection,
          'ownerKey',
          ownerKey
        );
        // 연구 제출은 한 컬렉션에 모이므로 학급도 함께 맞춘다.
        return collectSummary(rows.filter((r) => r.classResearchId === classKey));
      } catch {
        return EMPTY_SUMMARY;
      }
    },
  };
}

function isAlreadyExists(err: unknown): boolean {
  if (err instanceof DuplicateDocumentError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 6 || code === 'already-exists') return true;
  return /already exists/i.test(String((err as { message?: unknown } | null)?.message ?? ''));
}
