/**
 * 검사 수집 저장소 — 컬렉션 경로와 읽기·쓰기 계약
 *
 * 설계서 §7 "컬렉션 이름은 기존 구조를 고려해 정해도 된다. 기존 자료를 덮어쓰거나
 * 강제 마이그레이션하지 말고 스키마 버전을 구분한다."
 *
 * 기존 자료는 classes/{classCode}/{submissions,practice_attempts}에 있다.
 * 연구 검사 자료는 그 아래를 건드리지 않고 research/{schemaVersion}/... 아래에만 쓴다.
 * 따라서 기존 문서를 덮어쓰거나 옮기는 일이 없다.
 *
 * 제출 텍스트(assessment_submissions) / 채점 작업(assessment_scoring_runs) /
 * 화면 전달 상태(assessment_item_windows의 delivery)를 서로 다른 문서로 나눈다.
 */

import { SCHEMA_VERSION, type AssessmentPhase, type AssessmentSession, type ScoringRun, type SubmissionRecord } from '@/lib/research/types';

/** 연구 자료의 최상위 경로. 기존 classes/ 트리와 섞지 않는다. */
export const RESEARCH_ROOT = 'research';

/** schemaVersion으로 세대를 구분한다. 이전 세대 문서를 읽거나 고치지 않는다. */
export function collectionPath(name: string): string {
  return `${RESEARCH_ROOT}/${SCHEMA_VERSION}/${name}`;
}

export const COLLECTIONS = {
  /** 교사가 연 pre/post 세션 */
  sessions: 'assessment_sessions',
  /** 문항별 서버 시작 시각. 남은 시간의 단일 기준이다. */
  itemWindows: 'assessment_item_windows',
  /** 확정된 제출·결측 기록. submissionId가 문서ID이므로 이중 저장이 불가능하다. */
  submissions: 'assessment_submissions',
  /** 거절된 재요청의 감사 기록. 점수를 만들지 않는다. */
  rejections: 'assessment_submission_rejections',
  /** 사후 일괄 채점 결과. repeatIndex별로 따로 쌓는다. */
  scoringRuns: 'assessment_scoring_runs',
  /** 채점 작업 묶음(시점 혼합 순서·시드) */
  scoringBatches: 'assessment_scoring_batches',
} as const;

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
  /** 화면 전달 상태. 저장 실패를 성공 화면으로 표시하지 않기 위해 따로 둔다. */
  delivery: 'delivered' | 'delivery_failed';
  /** 기술 실패 사유. 네트워크 장애를 남길 자리이며 점수와 무관하다. */
  technicalFailureReason: string | null;
}

/** 문항 창의 문서ID. 학생·시점·문항이 한 칸이므로 자연 키를 쓴다. */
export function windowIdOf(researchId: string, phase: AssessmentPhase, questionId: string): string {
  return `${researchId}__${phase}__${questionId}`;
}

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
 * 저장소 계약. 실제 구현은 Firestore이지만 순수 테스트에서는 메모리 구현을 넣는다.
 * create 계열은 이미 문서가 있으면 반드시 실패해야 한다(이중 저장 방지의 근거).
 */
export interface AssessmentStore {
  getSession(assessmentSessionId: string): Promise<AssessmentSession | null>;
  putSession(session: AssessmentSession): Promise<void>;
  findOpenSession(classResearchId: string, phase: AssessmentPhase): Promise<AssessmentSession | null>;

  getItemWindow(windowId: string): Promise<ItemWindowRecord | null>;
  /** 이미 있으면 기존 값을 그대로 돌려준다. 시작 시각을 다시 쓰지 않는다. */
  createItemWindowIfAbsent(win: ItemWindowRecord): Promise<ItemWindowRecord>;
  updateItemWindowDelivery(
    windowId: string,
    delivery: ItemWindowRecord['delivery'],
    technicalFailureReason: string | null
  ): Promise<void>;

  getSubmission(submissionId: string): Promise<SubmissionRecord | null>;
  /** 문서ID가 submissionId이므로 같은 ID의 두 번째 쓰기는 거절된다. */
  putSubmission(record: SubmissionRecord): Promise<void>;
  appendRejection(record: SubmissionRecord): Promise<void>;
  listSubmissions(filter?: {
    classResearchId?: string;
    phase?: AssessmentPhase;
  }): Promise<SubmissionRecord[]>;

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

/**
 * 메모리 저장소. 순수 함수 테스트와 합성 자료 모의 실행에 쓴다.
 * 실제 학생 자료를 여기에 담지 않는다.
 */
export function createInMemoryAssessmentStore(): InspectableStore {
  const sessions = new Map<string, AssessmentSession>();
  const windows = new Map<string, ItemWindowRecord>();
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
    async updateItemWindowDelivery(windowId, delivery, technicalFailureReason) {
      const existing = windows.get(windowId);
      if (!existing) return;
      windows.set(windowId, { ...existing, delivery, technicalFailureReason });
    },

    async getSubmission(submissionId) {
      return submissions.get(submissionId) ?? null;
    },
    async putSubmission(record) {
      const existing = submissions.get(record.submissionId);
      // 저장 실패로 남은 자리는 같은 제출ID로 다시 쓸 수 있다. 그 외의 덮어쓰기는 막는다.
      if (existing && existing.persistStatus !== 'failed') {
        throw new DuplicateWriteError(record.submissionId);
      }
      submissions.set(record.submissionId, record);
    },
    async appendRejection(record) {
      rejections.push(record);
    },
    async listSubmissions(filter) {
      return [...submissions.values()].filter((s) => {
        if (filter?.classResearchId && s.classResearchId !== filter.classResearchId) return false;
        if (filter?.phase && s.phase !== filter.phase) return false;
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
