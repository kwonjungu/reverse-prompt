/**
 * 차시 개방 기록과 연습 제출 기록의 서버 저장소.
 *
 * 설계서 §4·§7 대응.
 *   - 차시·제출 이력은 서버에 있다. 기기를 바꿔도 여기서 복원한다.
 *   - localStorage는 캐시일 뿐이며 접근 권한·동의·완료의 권위 있는 원천이 아니다.
 *   - 제출은 submissionId로 idempotent 하다. 더블클릭·재시도가 이중 저장을 만들지 않는다.
 *   - 기존 practice_attempts 컬렉션은 건드리지 않는다. schemaVersion으로 구분해 새로 쓴다.
 *   - 연구 자료와 일반 체험 기록은 컬렉션을 나눈다.
 *
 * 저장 매체는 Firebase Admin Firestore이며, 서버 자격 증명이 없으면 프로세스 메모리로
 * 떨어진다. 메모리 저장은 개발·시험용이고 연구 자료의 보관 수단이 아니므로
 * 호출자에게 durable=false로 알린다.
 */

import 'server-only';
import { SCHEMA_VERSION } from '@/lib/research/types';
import type {
  FeedbackPresentation,
  LessonSession,
  OperationalResult,
  SessionType,
  SubmissionRecord,
} from '@/lib/research/types';
import type { CallRecord } from '@/lib/research/types';
import {
  openLesson as applyOpenLesson,
  closeLesson as applyCloseLesson,
  type LessonOpenState,
} from './policy';

/** LessonSession에 저장 관리용 필드만 덧붙인다. */
export interface LessonSessionRecord extends LessonSession {
  schemaVersion: string;
  updatedAt: string;
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
  /** 채점 작업의 결과와 호출 이력. 결측이면 score·levels·axisScores가 모두 null이다. */
  scoring: PracticeScoringRecord;
  /** 피드백 검토 기록. 재제출 또는 고치지 않은 까닭 중 하나가 남는다. */
  feedbackReview: FeedbackReview | null;
  createdAt: string;
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

export interface SaveResult {
  ok: boolean;
  /** 같은 제출ID가 이미 있어 새로 쓰지 않았다. 이중 저장이 아니다. */
  duplicate: boolean;
  /** 재시작해도 남는 저장소에 기록되었는가. */
  durable: boolean;
  error: string | null;
}

const LESSON_SCHEMA_VERSION = `${SCHEMA_VERSION}-lesson-session`;
export const PRACTICE_SUBMISSION_SCHEMA_VERSION = `${SCHEMA_VERSION}-practice-submission`;

const LESSON_COLLECTION = 'lesson_sessions';
/** 연구 세션의 제출. 학급 연구ID 아래에 둔다. */
const RESEARCH_SUBMISSIONS = 'research_practice_submissions';
/** 일반 체험의 제출. 연구 저장소와 분리한다. */
const EXPERIENCE_SUBMISSIONS = 'experience_practice_submissions';

// ---------------------------------------------------------------------------
// Firestore Admin 접근 (자격 증명이 없으면 null)
// ---------------------------------------------------------------------------

type AdminDb = {
  collection: (path: string) => any;
  doc: (path: string) => any;
};

let adminDbPromise: Promise<AdminDb | null> | null = null;

async function getAdminDb(): Promise<AdminDb | null> {
  if (!adminDbPromise) {
    adminDbPromise = (async () => {
      try {
        const appMod = await import('firebase-admin/app');
        const fsMod = await import('firebase-admin/firestore');
        const apps = appMod.getApps();
        const app = apps.length ? apps[0] : appMod.initializeApp();
        return fsMod.getFirestore(app) as unknown as AdminDb;
      } catch (err) {
        console.warn(
          '[lessons/store] 서버 Firestore를 열지 못해 메모리 저장으로 내려갑니다:',
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }
    })();
  }
  return adminDbPromise;
}

// ---------------------------------------------------------------------------
// 메모리 대체 저장소 (개발·시험용)
// ---------------------------------------------------------------------------

const memoryLessons = new Map<string, LessonSessionRecord>();
const memorySubmissions = new Map<string, PracticeSubmissionRecord>();

// ---------------------------------------------------------------------------
// 차시 개방 기록
// ---------------------------------------------------------------------------

export function emptyLessonSession(
  classResearchId: string,
  sessionType: SessionType
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
    updatedAt: new Date().toISOString(),
  };
}

export async function readLessonSession(
  classResearchId: string
): Promise<LessonSessionRecord | null> {
  const db = await getAdminDb();
  if (!db) return memoryLessons.get(classResearchId) ?? null;
  try {
    const snap = await db.collection(LESSON_COLLECTION).doc(classResearchId).get();
    if (!snap.exists) return null;
    return snap.data() as LessonSessionRecord;
  } catch (err) {
    console.error('[lessons/store] 차시 기록 조회 실패:', err);
    return memoryLessons.get(classResearchId) ?? null;
  }
}

async function writeLessonSession(record: LessonSessionRecord): Promise<boolean> {
  const db = await getAdminDb();
  if (!db) {
    memoryLessons.set(record.classResearchId, record);
    return false;
  }
  try {
    await db.collection(LESSON_COLLECTION).doc(record.classResearchId).set(record);
    return true;
  } catch (err) {
    console.error('[lessons/store] 차시 기록 저장 실패:', err);
    memoryLessons.set(record.classResearchId, record);
    return false;
  }
}

export interface OpenLessonInput {
  classResearchId: string;
  sessionType: SessionType;
  lesson: number;
  openedBy: string;
  reason: string | null;
}

/** 교사가 차시를 연다. 학생의 완료 수·점수는 조건에 넣지 않는다. */
export async function openLessonSession(
  input: OpenLessonInput
): Promise<{ session: LessonSessionRecord; durable: boolean }> {
  const now = new Date().toISOString();
  const prev =
    (await readLessonSession(input.classResearchId)) ??
    emptyLessonSession(input.classResearchId, input.sessionType);

  const session: LessonSessionRecord = {
    ...prev,
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
  const durable = await writeLessonSession(session);
  return { session, durable };
}

export interface CloseLessonInput {
  classResearchId: string;
  /** 특정 차시만 닫으려면 지정한다. 없으면 세션 전체를 닫는다. */
  lesson?: number;
  closedBy: string;
  reason: string | null;
}

export async function closeLessonSession(
  input: CloseLessonInput
): Promise<{ session: LessonSessionRecord | null; durable: boolean }> {
  const prev = await readLessonSession(input.classResearchId);
  if (!prev) return { session: null, durable: false };
  const now = new Date().toISOString();

  const session: LessonSessionRecord =
    input.lesson === undefined
      ? { ...prev, closedAt: now, openedBy: prev.openedBy, reason: input.reason, updatedAt: now }
      : {
          ...prev,
          allowedLessons: applyCloseLesson(prev.allowedLessons ?? [], input.lesson),
          currentLesson: prev.currentLesson === input.lesson ? null : prev.currentLesson,
          reason: input.reason,
          updatedAt: now,
        };
  const durable = await writeLessonSession(session);
  return { session, durable };
}

/** 판정 함수에 넘길 상태로 줄인다. 기록이 없으면 아직 아무 차시도 열리지 않은 것이다. */
export function toOpenState(
  session: LessonSessionRecord | null,
  fallbackSessionType: SessionType
): LessonOpenState {
  if (!session) {
    return {
      sessionType: fallbackSessionType,
      currentLesson: null,
      allowedLessons: [],
      closedAt: null,
    };
  }
  return {
    sessionType: session.sessionType ?? fallbackSessionType,
    currentLesson: session.currentLesson,
    allowedLessons: session.allowedLessons ?? [],
    closedAt: session.closedAt,
  };
}

// ---------------------------------------------------------------------------
// 연습 제출 기록
// ---------------------------------------------------------------------------

/** 연구 자료와 일반 체험 기록의 저장 위치를 나눈다. */
function submissionCollection(record: PracticeSubmissionRecord): string | null {
  if (record.sessionType === 'experience') {
    return record.classResearchId
      ? `classes/${record.classResearchId}/${EXPERIENCE_SUBMISSIONS}`
      : null;
  }
  return record.classResearchId
    ? `class_research/${record.classResearchId}/${RESEARCH_SUBMISSIONS}`
    : null;
}

/**
 * 제출을 저장한다. 같은 submissionId가 이미 있으면 새로 쓰지 않고 duplicate로 알린다.
 * 저장에 실패하면 ok=false를 돌려준다. 호출자는 이것을 성공 화면으로 바꾸지 않는다.
 */
export async function saveSubmission(record: PracticeSubmissionRecord): Promise<SaveResult> {
  const path = submissionCollection(record);
  if (!path) {
    return {
      ok: false,
      duplicate: false,
      durable: false,
      error: '학급을 확인하지 못해 저장하지 않았습니다.',
    };
  }
  const key = `${path}/${record.submissionId}`;

  const db = await getAdminDb();
  if (!db) {
    if (memorySubmissions.has(key)) {
      return { ok: true, duplicate: true, durable: false, error: null };
    }
    memorySubmissions.set(key, record);
    return { ok: true, duplicate: false, durable: false, error: null };
  }

  try {
    await db.doc(key).create(record);
    return { ok: true, duplicate: false, durable: true, error: null };
  } catch (err: any) {
    // ALREADY_EXISTS(6). 같은 제출ID의 재요청이므로 새 응답·재도전으로 세지 않는다.
    if (err?.code === 6 || /already exists/i.test(String(err?.message ?? ''))) {
      return { ok: true, duplicate: true, durable: true, error: null };
    }
    console.error('[lessons/store] 제출 저장 실패:', err);
    return {
      ok: false,
      duplicate: false,
      durable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 같은 제출ID로 이미 저장된 기록을 읽는다. 최초 유효 제출은 바꾸지 않는다. */
export async function readSubmission(
  sessionType: SessionType,
  classResearchId: string,
  submissionId: string
): Promise<PracticeSubmissionRecord | null> {
  const path =
    sessionType === 'experience'
      ? `classes/${classResearchId}/${EXPERIENCE_SUBMISSIONS}`
      : `class_research/${classResearchId}/${RESEARCH_SUBMISSIONS}`;
  const key = `${path}/${submissionId}`;
  const db = await getAdminDb();
  if (!db) return memorySubmissions.get(key) ?? null;
  try {
    const snap = await db.doc(key).get();
    return snap.exists ? (snap.data() as PracticeSubmissionRecord) : null;
  } catch (err) {
    console.error('[lessons/store] 제출 조회 실패:', err);
    return null;
  }
}

/** 피드백 검토 기록을 기존 제출에 덧붙인다. 점수·응답 본문은 바꾸지 않는다. */
export async function attachFeedbackReview(
  sessionType: SessionType,
  classResearchId: string,
  submissionId: string,
  review: FeedbackReview
): Promise<SaveResult> {
  const path =
    sessionType === 'experience'
      ? `classes/${classResearchId}/${EXPERIENCE_SUBMISSIONS}`
      : `class_research/${classResearchId}/${RESEARCH_SUBMISSIONS}`;
  const key = `${path}/${submissionId}`;

  const db = await getAdminDb();
  if (!db) {
    const found = memorySubmissions.get(key);
    if (!found) {
      return { ok: false, duplicate: false, durable: false, error: '제출을 찾지 못했습니다.' };
    }
    memorySubmissions.set(key, { ...found, feedbackReview: review });
    return { ok: true, duplicate: false, durable: false, error: null };
  }
  try {
    await db.doc(key).update({ feedbackReview: review });
    return { ok: true, duplicate: false, durable: true, error: null };
  } catch (err) {
    console.error('[lessons/store] 피드백 검토 기록 실패:', err);
    return {
      ok: false,
      duplicate: false,
      durable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface StudentSubmissionSummary {
  /** questionId → 제출 횟수. 완료 강제가 아니라 정보 표시용이다. */
  attemptsByQuestion: Record<string, number>;
  /** 피드백 검토를 남긴 문항 수. 적어도 한 문항에서 남기도록 안내할 때 쓴다. */
  reviewedQuestionCount: number;
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
    attemptsByQuestion[row.questionId] = (attemptsByQuestion[row.questionId] ?? 0) + 1;
    if (row.feedbackReview) reviewed.add(row.questionId);
  }
  return { attemptsByQuestion, reviewedQuestionCount: reviewed.size };
}

/** 기기를 바꿔도 복원할 수 있도록 서버의 제출 이력을 요약해 돌려준다. */
export async function readStudentSubmissions(
  sessionType: SessionType,
  classResearchId: string,
  researchId: string
): Promise<StudentSubmissionSummary> {
  const path =
    sessionType === 'experience'
      ? `classes/${classResearchId}/${EXPERIENCE_SUBMISSIONS}`
      : `class_research/${classResearchId}/${RESEARCH_SUBMISSIONS}`;

  const db = await getAdminDb();
  if (!db) {
    const rows = [...memorySubmissions.entries()]
      .filter(([key]) => key.startsWith(`${path}/`))
      .map(([, v]) => v)
      .filter((v) => v.researchId === researchId);
    return collectSummary(rows);
  }
  try {
    const snap = await db.collection(path).where('researchId', '==', researchId).get();
    return collectSummary(snap.docs.map((d: any) => d.data() as PracticeSubmissionRecord));
  } catch (err) {
    console.error('[lessons/store] 제출 이력 조회 실패:', err);
    return EMPTY_SUMMARY;
  }
}
