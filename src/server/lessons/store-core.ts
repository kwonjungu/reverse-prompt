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
import type { LegacyCallRecord, LegacyOperationalResult } from '@/lib/legacy-v7/types';
import {
  AREA_IDS,
  parseAreaLevel,
  type AreaId,
  type AreaLevels,
  type AreaLevelValue,
} from '@/lib/scoring';
import {
  openLesson as applyOpenLesson,
  closeLesson as applyCloseLesson,
  type LessonOpenState,
} from './policy';

/* ────────────────────────── 기록 형 ────────────────────────── */

/**
 * 차시 진행 방식. 'teacher'면 세션 성격과 무관하게 교사(관리자)가 연 차시만 열린다.
 * 값이 없으면 세션 성격의 기본 규칙(연구는 통제, 체험은 자율)을 따른다.
 */
export type LessonPacing = 'teacher';

/** LessonSession에 저장 관리용 필드만 덧붙인다. */
export interface LessonSessionRecord extends LessonSession {
  schemaVersion: string;
  updatedAt: string;
  /** 관리 화면에서 만든 반은 'teacher'. 옛 기록에는 없다. */
  pacing?: LessonPacing | null;
}

/**
 * 제출 문서의 scoring 필드.
 *
 * 새 기록은 공통 루브릭 v12-2(3영역 4수준)의 결과를 담는다(result.areas).
 * 저장소에는 옛 v7(축별 5수준·100점) 기록도 남아 있으므로 형을 둘 다 받는다.
 * 읽는 쪽은 isLegacyPracticeRecord로 구분하고, 옛 기록에서 영역 수준을 지어내지 않는다.
 */
export interface PracticeScoringRecord {
  operationId: string | null;
  repeatIndex: number | null;
  /** v12-2는 OperationalResult(areas), 옛 v7은 LegacyOperationalResult(levels·score). 채점 전 실패는 null. */
  result: OperationalResult | LegacyOperationalResult | null;
  calls: Array<CallRecord | LegacyCallRecord>;
  /** v12-2는 늘 false(추가 호출 없음). 옛 v7은 세 번째 호출 여부. 채점하지 못했으면 null. */
  extraCall: boolean | null;
  feedback: FeedbackPresentation | null;
  /** 설정한 모델 ID(config의 EVALUATION_MODEL_ID) */
  modelId: string | null;
  /**
   * 모델 API가 밝힌, 점수를 낸 실제 모델. 결측이거나 알 수 없으면 null.
   * 옛 v7 기록에는 이 필드가 없다. 읽을 때는 `?? null`로 본다.
   */
  servedModel: string | null;
  /** 판정 여부(해당 없음)를 정한 근거. 옛 기록에는 없다. */
  applicabilitySource?: 'cue_pack' | 'code_default' | 'model' | null;
  /** 피드백의 단계 초점 영역. 옛 기록에는 없다. */
  focusArea?: AreaId | null;
  modelConfig: Record<string, unknown> | null;
  promptHash: string | null;
  codeCommit: string | null;
  scoredAt: string | null;
  /** 채점 자체가 오류로 끝났을 때의 사유. 학생 화면 문구가 아니다. */
  failureReason: string | null;
}

export interface FeedbackReview {
  kind: 'revised' | 'kept';
  /**
   * kind가 kept일 때 학생이 적은 '고치지 않은 까닭'. 이제 받지 않으며(논문 v12-2) 새 기록은 늘 null이다.
   * 예전 일반 체험 기록에 남은 값은 지우지 않고, 연구 내보내기에 싣지 않는다.
   */
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
  /** 채점 작업의 결과와 호출 이력. 결측이면 result.areas가 null이다(옛 v7 기록은 levels·score가 null). */
  scoring: PracticeScoringRecord;
  /** 피드백 검토 기록. 새 기록은 '고쳐서 다시 쓰기'(revised) 연결만 남는다. 옛 기록에는 kept가 있을 수 있다. */
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

/**
 * 새로 쓰는 문서의 스키마 버전. 읽을 때 이 값과 같은지로 옛 문서를 거르지 않는다
 * (옛 v7.0 문서도 그대로 읽는다). 옛 기록 여부는 아래 isLegacyPracticeRecord가 정한다.
 */
export const LESSON_SCHEMA_VERSION = `${SCHEMA_VERSION}-lesson-session`;
export const PRACTICE_SUBMISSION_SCHEMA_VERSION = `${SCHEMA_VERSION}-practice-submission`;

/* ────────────────────────── 옛 기록 구분 ────────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 저장된 채점 결과가 공통 루브릭 v12-2의 모양(areas 키가 있음)인가.
 * v12-2는 결측이어도 `areas: null`을 남기므로 키의 유무로 가른다.
 */
export function isAreaResult(result: unknown): result is OperationalResult {
  return isObject(result) && 'areas' in result;
}

/**
 * 옛 v7(축별 5수준·100점) 방식의 제출 기록인가.
 *
 *   1. 채점 결과가 있으면 모양으로 가른다. areas가 없고 levels·score가 있으면 옛 기록이다.
 *   2. 채점 결과가 없으면(채점 전 실패) rubricVersion이 v12로 시작하지 않으면 옛 기록이다.
 *   3. rubricVersion도 없으면 schemaVersion이 v7로 시작하는지 본다. 알 수 없으면 옛 기록으로 보지 않는다.
 *
 * 스키마 버전이 지금 값과 다르다는 이유만으로 문서를 버리지 않는다. 구분만 한다.
 */
export function isLegacyPracticeRecord(record: {
  rubricVersion?: unknown;
  schemaVersion?: unknown;
  scoring?: unknown;
}): boolean {
  const result = isObject(record.scoring) ? record.scoring.result : null;
  if (isObject(result)) {
    if ('areas' in result) return false;
    if ('levels' in result || 'score' in result || 'axisScores' in result) return true;
  }
  if (typeof record.rubricVersion === 'string' && record.rubricVersion) {
    return !record.rubricVersion.startsWith('v12');
  }
  return typeof record.schemaVersion === 'string' && record.schemaVersion.startsWith('v7');
}

/**
 * 저장된 v12-2 채점 결과에서 영역 수준을 읽는다.
 * 채점된 결과이고 세 영역 모두 형식이 맞을 때만 돌려준다. 하나라도 어긋나면 null이다
 * (보정하거나 빈 영역을 1수준·해당 없음으로 채우지 않는다). 옛 v7 결과는 늘 null이다.
 */
export function storedAreaLevels(result: unknown): AreaLevels | null {
  if (!isAreaResult(result) || result.status !== 'scored' || !isObject(result.areas)) return null;
  const areas = result.areas as unknown as Record<string, unknown>;
  const out: Partial<Record<AreaId, AreaLevelValue>> = {};
  for (const area of AREA_IDS) {
    const block = areas[area];
    const level = isObject(block) ? parseAreaLevel(block.level) : null;
    if (level === null) return null;
    out[area] = level;
  }
  return out as AreaLevels;
}

/**
 * Firestore 문서에는 undefined를 넣을 수 없다(넣으면 쓰기 전체가 실패한다).
 * 채점 기록의 선택 필드(피드백의 영역 표시 등)가 빠져 있을 때 저장이 통째로 실패하지 않도록
 * undefined인 키만 뺀다. null은 그대로 둔다(결측 구분을 지킨다). 일반 객체와 배열만 훑는다.
 */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withoutUndefined(v)) as unknown as T;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = withoutUndefined(v);
    }
    return out as T;
  }
  return value;
}

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
  /** 개인정보 보류 기록(연구). 학급은 필드(classKey)로 둔다. */
  researchPrivacyHolds: string;
  /** 개인정보 보류 기록(일반 체험). 비연구 수업 기록 트리 아래에 둔다. */
  experiencePrivacyHolds(classCode: string): string;
}

/** 개인정보 보류 기록의 형식 버전 */
export const PRIVACY_HOLD_SCHEMA_VERSION = 'v12.2-privacy-hold';

/**
 * 전송 전 개인정보 점검에 걸려 모델로 보내지 않은 제출 한 건(논문 v12-2 F4).
 * 유형과 시각만 남긴다. 학생 글·일치한 글자·학생 식별자(연구ID·세션)는 담지 않는다.
 * 학급 키와 문항은 건수를 셀 범위로만 둔다.
 */
export interface PrivacyHoldRecord {
  schemaVersion: string;
  sessionType: SessionType;
  /** 연구 수업은 학급 연구ID, 일반 수업은 학급 코드 */
  classKey: string;
  questionId: string;
  /** 점검에 걸린 유형(예: phone, email). 원문은 담지 않는다. */
  types: string[];
  checkVersion: string | null;
  heldAt: string;
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
  /** lesson과 함께 열 차시. 관리 화면의 수업 시작은 1~6차시를 한 번에 연다. */
  alsoOpen?: readonly number[];
  openedBy: string;
  reason: string | null;
}

export interface EnsureLessonInput {
  classResearchId: string;
  /** 서버가 확정한 학급의 세션 성격. */
  sessionType: SessionType;
  pacing: LessonPacing;
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
  /**
   * 차시 기록이 없으면 빈 기록을 만들고, 있으면 진행 방식만 정한다.
   * 연 차시·닫힘 시각은 바꾸지 않는다. 관리 화면이 반을 만들 때 쓴다.
   */
  ensureLessonSession(
    input: EnsureLessonInput
  ): Promise<{ session: LessonSessionRecord; durable: boolean }>;
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
  /** 개인정보 보류를 남긴다. 실패해도 학생 화면의 보류 안내는 그대로 나간다. */
  recordPrivacyHold(record: PrivacyHoldRecord): Promise<{ ok: boolean }>;
  /** 한 학급의 개인정보 보류 기록(건수·유형·시각) */
  listPrivacyHolds(sessionType: SessionType, classKey: string): Promise<PrivacyHoldRecord[]>;
  /** ownerKey를 여럿 주면 한 학생의 여러 세션(다시 들어온 경우)을 합쳐 센다. */
  readStudentSubmissions(
    sessionType: SessionType,
    classKey: string,
    ownerKey: string | readonly string[]
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
    // 학급 기록은 통제를 더할 수만 있다. 세션 성격을 바꾸지는 않는다.
    teacherPaced: session?.pacing === 'teacher',
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

  const holdCollection = (sessionType: SessionType, classKey: string): string =>
    sessionType === 'experience'
      ? paths.experiencePrivacyHolds(safeDocId(classKey, '학급'))
      : (safeDocId(classKey, '학급'), paths.researchPrivacyHolds);

  return {
    durable: backend.durable,

    async recordPrivacyHold(record) {
      try {
        const collection = holdCollection(record.sessionType, record.classKey);
        const docId = `${record.heldAt.replace(/[^0-9]/g, '')}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
        await backend.create(collection, docId, {
          schemaVersion: PRIVACY_HOLD_SCHEMA_VERSION,
          sessionType: record.sessionType,
          classKey: record.classKey,
          questionId: record.questionId,
          types: [...record.types],
          checkVersion: record.checkVersion,
          heldAt: record.heldAt,
        } satisfies PrivacyHoldRecord);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    async listPrivacyHolds(sessionType, classKey) {
      const collection = holdCollection(sessionType, classKey);
      return backend.query<PrivacyHoldRecord>(collection, 'classKey', classKey);
    },

    async readLessonSession(classResearchId) {
      safeDocId(classResearchId, '학급');
      return backend.get<LessonSessionRecord>(paths.lessonSessions, classResearchId);
    },

    async ensureLessonSession(input) {
      safeDocId(input.classResearchId, '학급');
      const now = new Date().toISOString();
      const prev = await backend.get<LessonSessionRecord>(
        paths.lessonSessions,
        input.classResearchId
      );
      const session: LessonSessionRecord = {
        ...(prev ?? emptyLessonSession(input.classResearchId, input.sessionType, now)),
        pacing: input.pacing,
        updatedAt: now,
      };
      try {
        await backend.set(paths.lessonSessions, input.classResearchId, session);
        return { session, durable: backend.durable };
      } catch {
        return { session, durable: false };
      }
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
        allowedLessons: [input.lesson, ...(input.alsoOpen ?? [])].reduce(
          (open, n) => applyOpenLesson(open, n),
          prev.allowedLessons ?? []
        ),
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
      const owners = [...new Set(typeof ownerKey === 'string' ? [ownerKey] : ownerKey)].filter(Boolean);
      if (!owners.length) return EMPTY_SUMMARY;
      try {
        const collection = submissionCollection(sessionType, classKey);
        const rows = (
          await Promise.all(
            owners.map((owner) =>
              backend.query<PracticeSubmissionRecord>(collection, 'ownerKey', owner)
            )
          )
        ).flat();
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
