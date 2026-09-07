/**
 * 연구용 공통 도메인 타입 — 클라이언트·서버가 함께 쓰는 형(型)만 둔다.
 *
 * 여기에는 검사 단서·앵커·정답 문언을 넣지 않는다. 이 파일은 클라이언트 번들에
 * 포함될 수 있으므로 비공개 자산은 src/server/ 아래에서만 다룬다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2, §5, §7
 */

import type { AxisLevels, Band } from '@/lib/scoring';

/** 저장 스키마 버전. 기존 문서를 강제 이관하지 않고 버전으로 구분한다. */
export const SCHEMA_VERSION = 'v7.0';

/** 세션 성격. 연구 세션과 일반 체험을 구분한다. */
export type SessionType = 'experience' | 'research_practice' | 'research_assessment';

/** 검사 시점 */
export type AssessmentPhase = 'pre' | 'post';

/** 문항 종류 */
export type QuestionKind = 'practice' | 'assessment';

/** 레지스트리 확정 상태. candidate는 본연구에 쓸 수 없다. */
export type RegistryStatus = 'candidate' | 'frozen';

/** 화면 모드. 연구 세션에서 허용 여부가 달라진다. */
export type AppMode = 'guide' | 'practice' | 'assessment' | 'game' | 'time-attack' | 'audit' | 'generate';

/* ────────────────────────── 채점 결과 ────────────────────────── */

export interface AxisScores {
  object: number;
  specificity: number;
  context: number | null;
}

export type FeedbackStatus = 'verified' | 'fallback' | 'not_requested';

export type MissingReasonModel = 'model_error' | 'schema_error' | 'required_call_failed';

/**
 * 운영 채점 1회의 결과. 결측은 0점이 아니라 null이다.
 * 무응답은 이 타입의 모델 실패가 아니라 제출 단계의 missingReason으로 관리한다.
 */
export type OperationalResult =
  | {
      status: 'scored';
      levels: AxisLevels;
      score: number;
      axisScores: AxisScores;
      feedbackStatus: FeedbackStatus;
    }
  | {
      status: 'missing';
      levels: null;
      score: null;
      axisScores: null;
      reason: MissingReasonModel;
    };

/** 모델 호출 1회의 기록. 원문 프롬프트·개인정보는 넣지 않는다. */
export interface CallRecord {
  callId: string;
  retryIndex: number;
  /** 형식 검증을 통과한 수준. 실패 호출은 null. */
  levels: AxisLevels | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/** 채점 작업 1건(=운영 1회)의 전체 기록 */
export interface ScoringRun {
  operationId: string;
  /** 1이 주 자료. 2·3은 신뢰도 분석용 반복이며 주 자료를 덮어쓰지 않는다. */
  repeatIndex: number;
  band: Band;
  result: OperationalResult;
  calls: CallRecord[];
  extraCall: boolean;
  feedback: FeedbackPresentation | null;
  modelId: string;
  modelConfig: Record<string, unknown>;
  rubricVersion: string;
  cueVersion: string;
  /**
   * 채점에 실제로 보낸 이미지의 SHA-256(설계서 §7 필수 필드).
   * 연습 문항은 명세 해시가 없으므로 읽을 때 계산한 값을 쓴다.
   * 이미지를 열기 전에 끝난 결측에서는 빈 문자열이며, 없는 값을 지어내지 않는다.
   */
  imageHash: string;
  promptHash: string;
  codeCommit: string;
  scoredAt: string;
}

/** 피드백은 점수와 분리한다. 인용 실패와 인용 없는 중립 안내를 구분한다. */
export interface FeedbackPresentation {
  status: FeedbackStatus;
  /** 화면에 보여 줄 4줄 문구 */
  text: string;
  /** 학생 원문에 실제로 포함된 인용 표현. 없으면 null(인용 없는 중립 안내). */
  quote: string | null;
  /** 재생성을 1회 시도했는지 */
  regenerated: boolean;
}

/* ────────────────────────── 제출 ────────────────────────── */

export type ResponseStatus = 'submitted' | 'missing';

export type MissingReasonSubmission =
  | 'timeout_unsubmitted'
  | 'technical_failure'
  | 'consent_withdrawn'
  | 'not_consented'
  | 'absent';

/** 저장 문서의 공통 필수 필드 (설계서 §7) */
export interface SubmissionRecord {
  schemaVersion: string;
  submissionId: string;
  researchId: string | null;
  classResearchId: string | null;
  sessionType: SessionType;
  phase: AssessmentPhase | null;
  lesson: number | null;
  questionId: string;
  band: Band;
  imageHash: string;
  cueVersion: string;
  rubricVersion: string;
  /** 개인정보 점검을 거친 제출 텍스트 */
  text: string;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number | null;
  attemptNo: number;
  consentVersion: string | null;
  responseStatus: ResponseStatus;
  missingReason: MissingReasonSubmission | null;
  /** 저장 자체의 상태. 저장 실패를 성공 화면으로 표시하지 않기 위해 남긴다. */
  persistStatus: 'stored' | 'rejected_duplicate' | 'failed';
}

/* ────────────────────────── 동의·수업 일정 ────────────────────────── */

export type ConsentState = 'granted' | 'declined' | 'withdrawn' | 'unknown';

export interface ConsentRecord {
  researchId: string;
  /** 보호자 동의 */
  guardianConsent: ConsentState;
  /** 학생 승낙 */
  studentAssent: ConsentState;
  consentVersion: string | null;
  updatedAt: string;
  withdrawnAt: string | null;
}

/** 동의와 승낙이 모두 유효할 때만 연구 수집이 가능하다. */
export function isResearchConsentActive(c: ConsentRecord | null | undefined): boolean {
  return !!c && c.guardianConsent === 'granted' && c.studentAssent === 'granted' && !c.withdrawnAt;
}

/** 교사가 서버에서 여는 차시. 점수·완료 수는 개방 조건이 아니다. */
export interface LessonSession {
  classResearchId: string;
  currentLesson: number | null;
  allowedLessons: number[];
  openedAt: string | null;
  closedAt: string | null;
  openedBy: string | null;
  reason: string | null;
  sessionType: SessionType;
}

/** 검사 세션. 교사가 pre/post를 연다. */
export interface AssessmentSession {
  assessmentSessionId: string;
  classResearchId: string;
  phase: AssessmentPhase;
  openedAt: string | null;
  closedAt: string | null;
  openedBy: string | null;
  registryVersion: string;
}

/* ────────────────────────── 미확정 운영값 ────────────────────────── */

/** 코드가 만들어 낼 수 없는 값. 누락이면 연구 시작을 막는다. */
export interface ResearchReadiness {
  researchReady: boolean;
  blockers: string[];
}
