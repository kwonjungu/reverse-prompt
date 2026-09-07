/**
 * 검사 응답의 제출 판정 — submissionId 기준 idempotent 저장
 *
 * 설계서 §5
 *  - 제출ID에 대해 idempotent. 더블클릭·네트워크 재시도로 이중 저장·다른 점수 생성 금지.
 *    최초 유효 제출은 불변이고 이후 요청은 거절 기록으로 남긴다.
 *  - 시간 종료 미제출은 timeout_unsubmitted. 장애·철회·미동의는 서로 다른 상태다.
 *  - 빈 응답을 최저 점수로 만들지 않는다.
 *  - 제출 전 타이핑 초안을 자동으로 연구 응답으로 확정하지 않는다.
 *
 * 이 파일은 저장소 구현을 모르는 순수 판정 계층이다. 실제 쓰기는 store.ts가 맡는다.
 * SubmissionRecord에는 점수 필드가 없다. 채점은 수집이 끝난 뒤 별도 작업이 한다.
 */

import type { Band } from '@/lib/scoring';
import {
  SCHEMA_VERSION,
  type AssessmentPhase,
  type MissingReasonSubmission,
  type SubmissionRecord,
} from '@/lib/research/types';

/** 제출 텍스트의 상한. 초등학생 한 문항 응답으로 충분하며 저장·전송 폭주를 막는다. */
export const MAX_RESPONSE_CHARS = 2000;

/**
 * 제출ID 형식. 클라이언트가 만들지만 서버가 형식을 확인하고 그대로 키로만 쓴다.
 * 여기에 학번·학교코드 같은 식별 값을 담지 않는다.
 */
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidSubmissionId(id: string): boolean {
  return SUBMISSION_ID_PATTERN.test(id);
}

/**
 * 저장 전 텍스트 정제. 개인정보 점검은 privacy 모듈이 따로 하며 여기서는
 * 제어문자·과도한 공백·길이만 손본다. 맞춤법을 고치거나 내용을 바꾸지 않는다.
 */
export function sanitizeResponseText(raw: string): string {
  const normalized = raw
    .replace(/\r\n?/g, '\n')
    // 줄바꿈·탭을 제외한 제어문자를 없앤다.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return normalized.length > MAX_RESPONSE_CHARS
    ? normalized.slice(0, MAX_RESPONSE_CHARS)
    : normalized;
}

/** 서버가 확정한 값만 담는다. 밴드·이미지해시·버전은 레지스트리에서 온다. */
export interface SubmissionContext {
  submissionId: string;
  researchId: string;
  classResearchId: string;
  phase: AssessmentPhase;
  questionId: string;
  band: Band;
  imageHash: string;
  cueVersion: string;
  rubricVersion: string;
  consentVersion: string;
  /** 서버가 문항을 연 시각(ISO). 클라이언트가 보낸 시각을 쓰지 않는다. */
  startedAt: string;
  attemptNo: number;
}

function baseRecord(ctx: SubmissionContext): Omit<
  SubmissionRecord,
  'text' | 'submittedAt' | 'durationMs' | 'responseStatus' | 'missingReason' | 'persistStatus'
> {
  return {
    schemaVersion: SCHEMA_VERSION,
    submissionId: ctx.submissionId,
    researchId: ctx.researchId,
    classResearchId: ctx.classResearchId,
    sessionType: 'research_assessment',
    phase: ctx.phase,
    // 검사는 차시 활동이 아니므로 lesson은 null이다. 0으로 채우지 않는다.
    lesson: null,
    questionId: ctx.questionId,
    band: ctx.band,
    imageHash: ctx.imageHash,
    cueVersion: ctx.cueVersion,
    rubricVersion: ctx.rubricVersion,
    startedAt: ctx.startedAt,
    attemptNo: ctx.attemptNo,
    consentVersion: ctx.consentVersion,
  };
}

/** 학생이 실제로 제출을 누른 응답 */
export function makeSubmittedRecord(
  ctx: SubmissionContext,
  rawText: string,
  submittedAtMs: number
): SubmissionRecord {
  const submittedAt = new Date(submittedAtMs).toISOString();
  const startedAtMs = Date.parse(ctx.startedAt);
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, submittedAtMs - startedAtMs)
    : null;
  return {
    ...baseRecord(ctx),
    text: sanitizeResponseText(rawText),
    submittedAt,
    durationMs,
    responseStatus: 'submitted',
    missingReason: null,
    persistStatus: 'stored',
  };
}

/**
 * 제출되지 않은 칸의 결측 기록.
 * 초안 텍스트를 인자로 받지 않는다. 시간이 끝났을 때 화면에 남아 있던 타이핑 초안을
 * 연구 응답으로 확정하지 않기 위해서다. text는 언제나 빈 문자열이며 점수는 만들지 않는다.
 */
export function makeMissingRecord(
  ctx: SubmissionContext,
  missingReason: MissingReasonSubmission,
  /** 결측을 확정한 시각. 감사 로그에 쓰며 제출 문서에는 남기지 않는다. */
  recordedAtMs: number
): SubmissionRecord {
  void recordedAtMs;
  return {
    ...baseRecord(ctx),
    text: '',
    // 제출한 적이 없으므로 submittedAt과 durationMs는 null이다. 0으로 채우지 않는다.
    submittedAt: null,
    durationMs: null,
    responseStatus: 'missing',
    missingReason,
    persistStatus: 'stored',
  };
}

export type SubmissionOutcome =
  /** 최초 유효 제출이 저장되었다. */
  | 'stored'
  /** 이미 유효 제출이 있어 거절되었다. 최초 값은 그대로 둔다. */
  | 'rejected_duplicate'
  /** 앞선 저장이 실패로 남아 있어 같은 제출ID로 다시 저장했다. 새 도전으로 세지 않는다. */
  | 'retried_after_failure';

export interface SubmissionDecision {
  outcome: SubmissionOutcome;
  /** 이 제출ID의 권위 있는 기록. 거절일 때는 기존 기록을 그대로 돌려준다. */
  authoritative: SubmissionRecord;
  /** 저장해야 할 새 문서. 거절일 때는 null이고 대신 rejection을 남긴다. */
  toStore: SubmissionRecord | null;
  /** 거절 감사 기록. 이중 저장 대신 이 문서만 별도 컬렉션에 쌓는다. */
  rejection: SubmissionRecord | null;
}

/**
 * 같은 submissionId로 들어온 요청을 판정한다.
 *
 * 더블클릭·네트워크 재시도는 모두 여기로 모이며, 최초 유효 제출은 바뀌지 않는다.
 * 두 번째 요청의 텍스트가 달라도 저장된 값을 덮어쓰지 않는다.
 */
export function resolveSubmission(
  existing: SubmissionRecord | null,
  incoming: SubmissionRecord
): SubmissionDecision {
  if (!existing) {
    return { outcome: 'stored', authoritative: incoming, toStore: incoming, rejection: null };
  }

  if (existing.persistStatus === 'failed') {
    // 저장 실패로 남은 자리다. 같은 제출ID로 다시 쓰되 attemptNo를 올리지 않는다.
    const retried: SubmissionRecord = { ...incoming, attemptNo: existing.attemptNo };
    return {
      outcome: 'retried_after_failure',
      authoritative: retried,
      toStore: retried,
      rejection: null,
    };
  }

  return {
    outcome: 'rejected_duplicate',
    authoritative: existing,
    toStore: null,
    rejection: { ...incoming, persistStatus: 'rejected_duplicate' },
  };
}

/**
 * 제출 요청을 받아도 되는지 확인한다. 실패 사유를 학생 화면 문구가 아니라
 * 서버 사유 코드로 돌려준다. 화면 문구는 호출한 쪽에서 정한다.
 */
export type SubmitGuardFailure =
  | 'invalid_submission_id'
  | 'not_consented'
  | 'consent_withdrawn'
  | 'session_closed'
  | 'deadline_passed'
  | 'registry_not_ready';

export interface SubmitGuardInput {
  submissionId: string;
  consentActive: boolean;
  consentWithdrawn: boolean;
  sessionOpen: boolean;
  withinDeadline: boolean;
  registryReady: boolean;
}

export function checkSubmitGuards(
  input: SubmitGuardInput
): { ok: true } | { ok: false; reason: SubmitGuardFailure } {
  if (!isValidSubmissionId(input.submissionId)) {
    return { ok: false, reason: 'invalid_submission_id' };
  }
  if (input.consentWithdrawn) return { ok: false, reason: 'consent_withdrawn' };
  if (!input.consentActive) return { ok: false, reason: 'not_consented' };
  if (!input.registryReady) return { ok: false, reason: 'registry_not_ready' };
  if (!input.sessionOpen) return { ok: false, reason: 'session_closed' };
  if (!input.withinDeadline) return { ok: false, reason: 'deadline_passed' };
  return { ok: true };
}

/** 거절·결측 사유를 제출 단계의 missingReason으로 옮긴다. 모델 실패와 섞지 않는다. */
export function guardFailureToMissingReason(
  reason: SubmitGuardFailure
): MissingReasonSubmission | null {
  switch (reason) {
    case 'not_consented':
      return 'not_consented';
    case 'consent_withdrawn':
      return 'consent_withdrawn';
    case 'deadline_passed':
      return 'timeout_unsubmitted';
    case 'invalid_submission_id':
    case 'session_closed':
    case 'registry_not_ready':
      // 연구 응답으로 세지 않는다. 결측 칸을 만들지 않고 요청만 거부한다.
      return null;
  }
}
