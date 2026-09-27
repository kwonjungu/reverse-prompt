/**
 * 연구용 공통 도메인 타입 — 클라이언트·서버가 함께 쓰는 형(型)만 둔다.
 *
 * 여기에는 검사 단서·앵커·정답 문언을 넣지 않는다. 이 파일은 클라이언트 번들에
 * 포함될 수 있으므로 비공개 자산은 src/server/ 아래에서만 다룬다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2, §5, §7
 */

import type { AreaId, AreaJudgments, AreaLevels, Band } from '@/lib/scoring';

/**
 * 저장 문서의 스키마 버전. 기존 문서를 강제 이관하지 않고 버전으로 구분한다.
 * v12.2: 공통 루브릭 v12-2(3영역 4수준) 채점 결과를 담는다. 옛 v7.0 문서도 그대로 읽는다.
 */
export const SCHEMA_VERSION = 'v12.2';

/**
 * 연구 저장 경로의 버전 조각(research/{이 값}/…). 문서 스키마 버전과 분리해 고정한다.
 * 스키마를 올릴 때마다 경로가 바뀌면 이미 열린 차시·검사 자료가 새 경로로 갈라지기 때문이다.
 */
export const RESEARCH_STORE_VERSION = 'v7.0';

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

/* ────────────────────────── 채점 결과(공통 루브릭 v12-2) ────────────────────────── */

/**
 * verified     형식 검사를 통과한 모델 문장(다시 만들어 통과한 것 포함)
 * neutralized  3·4문장이 정답 값(단서 팩의 대상 이름·속성 값)을 알려 줘 다시 만들어도 그대로여서,
 *              1·2문장은 모델 문장을 두고 3·4문장만 고정 중립 문장으로 바꾼 것
 * fallback     다시 만들어도 형식을 지키지 못해 고정 안내 한 줄로 바꾼 것
 */
export type FeedbackStatus = 'verified' | 'neutralized' | 'fallback' | 'not_requested';

export type MissingReasonModel = 'model_error' | 'schema_error' | 'required_call_failed';

/**
 * 운영 채점 1회의 결과. 결측은 최저 수준이 아니라 areas: null이다.
 * 무응답은 이 타입의 모델 실패가 아니라 제출 단계의 missingReason으로 관리한다.
 * 점수(100점)·배점·종합 수준은 담지 않는다. 종합 수준은 필요할 때 areas에서 계산한다.
 */
export type OperationalResult =
  | {
      status: 'scored';
      areas: AreaJudgments;
      feedbackStatus: FeedbackStatus;
    }
  | {
      status: 'missing';
      areas: null;
      reason: MissingReasonModel;
    };

/**
 * 모델 호출 1회의 기록. 원문 프롬프트·개인정보는 넣지 않는다.
 * 예외: 연구 세션 채점의 rawOutput(모델 원응답)에는 학생 글 인용(evidence·quote)이 들어 있다 — 아래 설명.
 */
export interface CallRecord {
  callId: string;
  retryIndex: number;
  /** 'score'는 채점 호출, 'feedback'은 피드백만 다시 만든 호출(점수에 반영하지 않는다). */
  purpose: 'score' | 'feedback';
  /** 형식 검증을 통과한 영역 수준. 실패 호출·피드백 호출은 null. */
  levels: AreaLevels | null;
  failureReason: string | null;
  /** 모델 API가 응답에 밝힌 실제 모델(Gemini 응답의 modelVersion). 알 수 없으면 null. */
  servedModel: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /**
   * 모델 원응답(JSON 문자열, 검증 전 그대로). **연구 세션 채점(제출 채점·반복 채점)에서만** 남긴다(99-1 B2 —
   * 출력을 같은 조건에서 다시 확인할 수 있게 보관). 일반 체험·연수에는 이 필드가 없다. 호출이 예외로 끝나 받은 것이
   * 없으면 null. 학생 글 인용이 들어 있으므로 제출 문서 안에만 두고 교사 블라인드 레코드·전문가 CSV에는 싣지 않는다.
   */
  rawOutput?: string | null;
  /** 비밀값 점검(privacy.assertNoSecrets)에 걸려 rawOutput을 비웠다 */
  rawOutputWithheld?: boolean;
  /** 너무 길어 앞부분만 남겼다(RAW_OUTPUT_MAX_CHARS) */
  rawOutputTruncated?: boolean;
}

/** 채점 작업 1건(=운영 1회)의 전체 기록 */
export interface ScoringRun {
  operationId: string;
  /** 1이 주 자료. 2·3은 신뢰도 분석용 반복이며 주 자료를 덮어쓰지 않는다. */
  repeatIndex: number;
  band: Band;
  result: OperationalResult;
  calls: CallRecord[];
  /** v12-2는 추가 호출(옛 2+1 결합)이 없다. 옛 기록과 열을 맞추려고 늘 false로 남긴다. */
  extraCall: false;
  feedback: FeedbackPresentation | null;
  /** 설정한 모델 ID(config의 EVALUATION_MODEL_ID) */
  modelId: string;
  /** 점수를 낸 호출에서 모델 API가 밝힌 실제 모델. 결측이거나 알 수 없으면 null. */
  servedModel: string | null;
  modelConfig: Record<string, unknown>;
  rubricVersion: string;
  cueVersion: string;
  /** 이 채점에서 판정 여부를 정한 근거. 'cue_pack'이면 단서 팩, 'model'이면 모델이 정했다. */
  /**
   * 영역 판정 여부(해당 없음)의 근거. cue_pack = 비공개 단서 팩, code_default = 단서 팩 없이 코드의 기본 목록
   * (src/lib/question-areas.ts)이 관계를 해당 없음으로 정함(나머지는 모델), model = 모델이 정함.
   */
  applicabilitySource: 'cue_pack' | 'code_default' | 'model';
  /** 피드백의 단계 초점 영역(문항이 속한 단계). 검사 문항은 null. */
  focusArea: AreaId | null;
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
  /** 화면에 보여 줄 네 문장(한 줄에 한 문장). 2·3문장 앞에 영역 이름이 붙는다. */
  text: string;
  /** 2문장에 넣은 학생 원문 표현. 없으면 null. */
  quote: string | null;
  /** 재생성을 1회 시도했는지 */
  regenerated: boolean;
  /** 2문장(잘 쓴 점)의 영역. 옛 v7 기록에는 없다. */
  strengthArea?: AreaId | null;
  /** 3문장(다음 행동)의 영역 */
  nextArea?: AreaId | null;
  /** 3문장이 겨냥한 빠진 정보 */
  nextTarget?: string | null;
  /** 검증에서 탈락한 사유(시도 순). 통과한 초안의 사유는 없다. */
  rejections?: string[];
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
