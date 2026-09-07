/**
 * 검사 수집 저장소 — 읽기·쓰기 계약
 *
 * 설계서 §7 "컬렉션 이름은 기존 구조를 고려해 정해도 된다. 기존 자료를 덮어쓰거나
 * 강제 마이그레이션하지 말고 스키마 버전을 구분한다."
 *
 * 기존 자료는 classes/{classCode}/{submissions,practice_attempts}에 있다.
 * 연구 검사 자료는 그 아래를 건드리지 않고 research/{schemaVersion}/... 아래에만 쓴다.
 * 실제 경로는 @/server/firebase-admin의 researchPath()가 단독으로 정한다. 이 파일은
 * 컬렉션 이름을 알지 못한다(쓰기와 읽기가 다른 경로를 쓰는 일을 구조적으로 막는다).
 *
 * 제출 텍스트(assessmentSubmissions) / 채점 작업(scoringRuns) /
 * 화면 전달 상태(assessmentWindows의 delivery)를 서로 다른 문서로 나눈다.
 *
 * 핵심 불변(설계서 §5): 최초 유효 제출은 (researchId, phase, questionId) 한 칸에
 * 하나뿐이다. 그래서 제출 문서의 ID는 클라이언트가 만든 submissionId가 아니라
 * 그 칸의 자연 키다. 두 탭·두 기기에서 서로 다른 submissionId로 눌러도 두 번째는
 * 저장되지 않고 거절 기록만 남는다.
 */

import {
  SCHEMA_VERSION,
  type AssessmentPhase,
  type AssessmentSession,
  type ScoringRun,
  type SubmissionRecord,
} from '@/lib/research/types';
import { resolveSubmission, type SubmissionDecision } from './submission';

/**
 * 학생·시점·문항 한 칸의 자연 키.
 * 문항 창 문서와 제출 문서가 같은 키를 쓴다. 한 칸에 창 하나, 제출 하나다.
 */
export function cellIdOf(
  researchId: string,
  phase: AssessmentPhase,
  questionId: string
): string {
  return `${researchId}__${phase}__${questionId}`;
}

/** 문항 창의 문서ID. 칸 키와 같은 값이다. */
export const windowIdOf = cellIdOf;

/** 제출 기록에서 칸 키를 얻는다. 연구ID·시점이 없는 기록은 연구 자료가 아니다. */
export function cellIdOfRecord(record: SubmissionRecord): string {
  if (!record.researchId || !record.phase) {
    throw new Error('연구 검사 제출에는 researchId와 phase가 있어야 한다');
  }
  return cellIdOf(record.researchId, record.phase, record.questionId);
}

/**
 * 문항 창(window) 문서. 학생·시점·문항마다 하나이며 서버가 연 시각을 담는다.
 * 새로고침해도 이 값이 바뀌지 않으므로 남은 시간이 초기화되지 않는다.
 */
export interface ItemWindowRecord {
  schemaVersion: string;
  windowId: string;
  researchId: string;
  classResearchId: string;
  phase: AssessmentPhase;
  questionId: string;
  /** 서버가 문항을 연 시각(ISO) */
  startedAt: string;
  durationSeconds: number;
  /**
   * 화면 전달 상태. 저장 실패를 성공 화면으로 표시하지 않기 위해 따로 둔다.
   * 이 값은 교사·서버가 확인한 상태이며 학생 신고만으로 바뀌지 않는다.
   */
  delivery: 'delivered' | 'delivery_failed';
  /** 교사·서버가 확인한 기술 실패 사유. 점수와 무관하다. */
  technicalFailureReason: string | null;
  /**
   * 학생이 신고한 장애 사유(확인 전 신고).
   * 결측 사유를 학생이 고르게 하지 않기 위해 delivery와 분리해 둔다.
   */
  studentReportedFailureReason: string | null;
  studentReportedFailureAt: string | null;
}

/** 창 문서에서 고칠 수 있는 필드. 새 창을 만들지 않고 이 값들만 덮어쓴다. */
export type ItemWindowPatch = Partial<
  Pick<
    ItemWindowRecord,
    | 'delivery'
    | 'technicalFailureReason'
    | 'studentReportedFailureReason'
    | 'studentReportedFailureAt'
  >
>;

/** 시점 혼합 채점 묶음의 기록. 순서와 시드를 남겨 재현할 수 있게 한다. */
export interface ScoringBatchRecord {
  schemaVersion: string;
  batchId: string;
  /** 혼합에 쓴 시드. 인자로 받아 그대로 기록한다. */
  seed: string;
  repeatIndex: number;
  /** 혼합된 순서대로의 제출ID. 이 배열이 재현의 근거다. */
  order: string[];
  createdAt: string;
  codeCommit: string;
  /** 합성 자료 대상 모의 실행인지. 본연구 자료와 구분한다. */
  dryRun: boolean;
  registryStatusSnapshot: string;
}

/**
 * 조회 범위. 학급을 밝히지 않은 조회를 실수로 하지 않도록 형(型)으로 강제한다.
 * allClasses는 연구자 오프라인 도구 전용이며 요청 처리 경로에서 쓰지 않는다.
 */
export type SubmissionScope =
  | { classResearchId: string; phase?: AssessmentPhase }
  | { allClasses: true; phase?: AssessmentPhase };

/**
 * 저장소 계약. 실제 구현은 Firestore이지만 순수 테스트에서는 메모리 구현을 넣는다.
 * 두 구현의 동작은 같아야 한다(테스트가 가짜 Firestore로 이를 확인한다).
 */
export interface AssessmentStore {
  getSession(assessmentSessionId: string): Promise<AssessmentSession | null>;
  putSession(session: AssessmentSession): Promise<void>;
  findOpenSession(classResearchId: string, phase: AssessmentPhase): Promise<AssessmentSession | null>;

  getItemWindow(windowId: string): Promise<ItemWindowRecord | null>;
  /** 이미 있으면 기존 값을 그대로 돌려준다. 시작 시각을 다시 쓰지 않는다. */
  createItemWindowIfAbsent(win: ItemWindowRecord): Promise<ItemWindowRecord>;
  /**
   * 이미 열린 창만 고친다. 없는 창을 만들지 않는다.
   * 없으면 false를 돌려준다(유령 문항 창을 만들어 학생을 가두지 않는다).
   */
  patchItemWindow(windowId: string, patch: ItemWindowPatch): Promise<boolean>;

  /** 한 칸의 권위 있는 제출 기록. 문서 하나를 직접 읽는다(전체 스캔 금지). */
  getSubmissionForCell(
    researchId: string,
    phase: AssessmentPhase,
    questionId: string
  ): Promise<SubmissionRecord | null>;

  /**
   * 한 칸의 최초 유효 제출을 원자적으로 확정한다.
   *
   * 이미 유효 제출이 있으면 저장하지 않고 rejected_duplicate를 돌려준다.
   * get 뒤 create 하는 경합에서 거짓 실패를 만들지 않도록, 구현은 create를 먼저
   * 시도하고 충돌일 때만 다시 읽는다.
   */
  claimSubmission(record: SubmissionRecord): Promise<SubmissionDecision>;

  /** 결측 기록처럼 서버가 만드는 문서를 쓴다. 이미 찬 칸이면 거절한다. */
  putSubmission(record: SubmissionRecord): Promise<void>;
  appendRejection(record: SubmissionRecord): Promise<void>;
  listSubmissions(scope: SubmissionScope): Promise<SubmissionRecord[]>;

  /** repeatIndex별로 따로 쌓는다. 같은 (submissionId, repeatIndex)를 덮어쓰지 않는다. */
  getScoringRun(submissionId: string, repeatIndex: number): Promise<ScoringRun | null>;
  putScoringRun(submissionId: string, run: ScoringRun): Promise<void>;
  putScoringBatch(batch: ScoringBatchRecord): Promise<void>;
}

export class DuplicateWriteError extends Error {
  constructor(readonly documentId: string) {
    super(`이미 있는 문서에 다시 쓰려 하였다: ${documentId}`);
    this.name = 'DuplicateWriteError';
  }
}

/** 테스트·모의 실행에서 내부 상태를 들여다볼 때 쓰는 보조 계약 */
export interface InspectableStore extends AssessmentStore {
  /** 거절된 재요청 기록. 이중 저장 대신 여기에만 쌓인다. */
  readonly rejections: readonly SubmissionRecord[];
  readonly batches: readonly ScoringBatchRecord[];
}

/** 새 문항 창의 기본값. 두 저장소 구현이 같은 모양을 쓰도록 여기서 만든다. */
export function makeItemWindow(input: {
  researchId: string;
  classResearchId: string;
  phase: AssessmentPhase;
  questionId: string;
  startedAt: string;
  durationSeconds: number;
}): ItemWindowRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    windowId: cellIdOf(input.researchId, input.phase, input.questionId),
    researchId: input.researchId,
    classResearchId: input.classResearchId,
    phase: input.phase,
    questionId: input.questionId,
    startedAt: input.startedAt,
    durationSeconds: input.durationSeconds,
    delivery: 'delivered',
    technicalFailureReason: null,
    studentReportedFailureReason: null,
    studentReportedFailureAt: null,
  };
}

/**
 * 메모리 저장소. 순수 함수 테스트와 합성 자료 모의 실행에 쓴다.
 * 실제 학생 자료를 여기에 담지 않는다.
 * Firestore 구현과 동작이 갈리면 결함이 테스트에 잡히지 않으므로 규칙을 똑같이 쓴다.
 */
export function createInMemoryAssessmentStore(): InspectableStore {
  const sessions = new Map<string, AssessmentSession>();
  const windows = new Map<string, ItemWindowRecord>();
  /** 문서ID는 칸 키다. 한 칸에 제출 하나. */
  const submissions = new Map<string, SubmissionRecord>();
  const rejections: SubmissionRecord[] = [];
  const runs = new Map<string, ScoringRun>();
  const batches: ScoringBatchRecord[] = [];

  const runKey = (submissionId: string, repeatIndex: number) => `${submissionId}#${repeatIndex}`;

  return {
    rejections,
    batches,
    async getSession(id) {
      return sessions.get(id) ?? null;
    },
    async putSession(session) {
      sessions.set(session.assessmentSessionId, session);
    },
    async findOpenSession(classResearchId, phase) {
      for (const s of sessions.values()) {
        if (s.classResearchId === classResearchId && s.phase === phase && s.openedAt && !s.closedAt) {
          return s;
        }
      }
      return null;
    },

    async getItemWindow(windowId) {
      return windows.get(windowId) ?? null;
    },
    async createItemWindowIfAbsent(win) {
      const existing = windows.get(win.windowId);
      if (existing) return existing;
      windows.set(win.windowId, win);
      return win;
    },
    async patchItemWindow(windowId, patch) {
      const existing = windows.get(windowId);
      // 없는 창을 만들지 않는다. Firestore 구현도 같다.
      if (!existing) return false;
      windows.set(windowId, { ...existing, ...patch });
      return true;
    },

    async getSubmissionForCell(researchId, phase, questionId) {
      return submissions.get(cellIdOf(researchId, phase, questionId)) ?? null;
    },
    async claimSubmission(record) {
      const cellId = cellIdOfRecord(record);
      const existing = submissions.get(cellId) ?? null;
      const decision = resolveSubmission(existing, record);
      if (decision.toStore) submissions.set(cellId, decision.toStore);
      return decision;
    },
    async putSubmission(record) {
      const cellId = cellIdOfRecord(record);
      const existing = submissions.get(cellId);
      // 저장 실패로 남은 자리는 다시 쓸 수 있다. 그 외의 덮어쓰기는 막는다.
      if (existing && existing.persistStatus !== 'failed') {
        throw new DuplicateWriteError(cellId);
      }
      submissions.set(cellId, record);
    },
    async appendRejection(record) {
      rejections.push(record);
    },
    async listSubmissions(scope) {
      return [...submissions.values()].filter((s) => {
        if ('classResearchId' in scope && s.classResearchId !== scope.classResearchId) return false;
        if (scope.phase && s.phase !== scope.phase) return false;
        return true;
      });
    },

    async getScoringRun(submissionId, repeatIndex) {
      return runs.get(runKey(submissionId, repeatIndex)) ?? null;
    },
    async putScoringRun(submissionId, run) {
      const key = runKey(submissionId, run.repeatIndex);
      // 주 자료(repeatIndex 1)를 포함해 이미 있는 반복 결과를 덮어쓰지 않는다.
      if (runs.has(key)) throw new DuplicateWriteError(key);
      runs.set(key, run);
    },
    async putScoringBatch(batch) {
      batches.push(batch);
    },
  };
}
