/**
 * 검사 수집의 판정·저장 본체 — server action이 그대로 부르는 코드
 *
 * actions.ts는 'use server' 파일이라 인증·레지스트리·저장소를 모듈 수준에서 고정한다.
 * 그러면 이 흐름을 시험으로 실행할 수 없어 최초 제출 불변·유령 창·빈 응답 같은 결함이
 * 시험의 사각지대에 남는다. 그래서 판정과 저장을 여기로 옮기고 의존을 인자로 받는다.
 * actions.ts는 실제 의존을 넣어 부르기만 한다. 즉 시험이 도는 코드와 학생이 쓰는 코드가
 * 같은 코드다.
 *
 * 설계서 §5
 *  - 검사 화면 요청 시 AI를 호출하지 않는다. 이 파일은 grading을 import 하지 않는다.
 *  - 점수·피드백·힌트·모범답이 없고 제출 후 재도전이 없다.
 *  - 문항 시작·마감은 서버 시간 기준이며 새로고침으로 초기화되지 않는다.
 *  - 최초 유효 제출은 (researchId, phase, questionId) 한 칸에 대해 불변이고
 *    이후 요청은 rejected_duplicate 기록만 남긴다.
 *  - 빈 응답을 유효 제출로 받지 않는다(최저 점수로 만들지 않는다).
 *  - 기술 실패는 이미 열린 창에만 남기며 없는 창을 만들지 않는다.
 *
 * 클라이언트가 보낸 역할·학급·동의·밴드·이미지·점수는 신뢰하지 않는다.
 * questionId만 받고 나머지는 서버가 레지스트리와 인증에서 확정한다.
 */

import type { Principal, Role } from '@/server/auth/contract';
import type { PiiCheckResult } from '@/server/privacy/contract';
import type { RegistryEntry } from '@/server/registry/contract';
import type {
  AssessmentPhase,
  AssessmentSession,
  ConsentRecord,
  SessionType,
  SubmissionRecord,
} from '@/lib/research/types';
import { isResearchConsentActive } from '@/lib/research/types';
import { acceptsSubmission, type ItemWindow } from './timing';
import {
  PARTICIPATION_MESSAGE,
  buildAssessmentPlan,
  checkParticipation,
  checkResearchStartAllowed,
  findForbiddenPayloadKeys,
  makeAssessmentSessionId,
  toStudentItem,
  type AssessmentRegistryView,
  type StudentAssessmentItem,
} from './session';
import {
  checkSubmitGuards,
  isEmptyResponse,
  makeMissingRecord,
  makeSubmittedRecord,
  sanitizeResponseText,
  type SubmissionContext,
} from './submission';
import {
  makeItemWindow,
  windowIdOf,
  type AssessmentStore,
  type ItemWindowRecord,
} from './store';

/* ────────────────────── 주입받는 의존 ────────────────────── */

/** 이 흐름이 실제로 쓰는 인증 기능만 추린 것. auth 구현을 그대로 넣을 수 있다. */
export interface AssessmentAuthView {
  requirePrincipal(): Promise<Principal>;
  requireClassAccess(classResearchId: string, ...roles: Role[]): Promise<Principal>;
  getConsent(researchId: string): Promise<ConsentRecord | null>;
}

/** 레지스트리에서 쓰는 기능. 세션 판정용 뷰에 requireEntry를 더한 것이다. */
export interface AssessmentRegistryPort extends AssessmentRegistryView {
  requireEntry(questionId: string, sessionType: SessionType): RegistryEntry;
}

export interface AssessmentPrivacyPort {
  checkBeforeSend(text: string): PiiCheckResult;
  assertNoSecrets(payload: unknown): void;
}

export interface CollectDeps {
  auth: AssessmentAuthView;
  registry: AssessmentRegistryPort;
  privacy: AssessmentPrivacyPort;
  store: AssessmentStore;
  /** 서버 시각. 시험에서 고정 시각을 넣는다. */
  now?: () => number;
  /** 동의 기록이 없을 때 남길 동의 버전 */
  consentVersion: string;
}

const nowMsOf = (deps: CollectDeps) => (deps.now ? deps.now() : Date.now());

/* ────────────────────── 학생 화면 응답 ────────────────────── */

/** 학생 화면이 받는 응답. 점수·단서·앵커가 들어갈 자리를 두지 않는다. */
export interface AssessmentStateResponse {
  ok: boolean;
  /** 학생에게 보일 문구. 구현 용어를 쓰지 않는다. */
  message: string | null;
  phase: AssessmentPhase | null;
  items: StudentAssessmentItem[];
  /**
   * 다음에 열 문항. 순서는 서버가 정한다. 화면이 문항ID를 지어내지 않는다.
   * 모두 열었으면 null이다.
   */
  nextQuestionId: string | null;
  /** 서버 시각(epoch ms). 브라우저 시계 대신 이 값으로 남은 시간을 맞춘다. */
  serverNow: number;
}

const emptyState = (message: string | null, nowMs: number): AssessmentStateResponse => ({
  ok: false,
  message,
  phase: null,
  items: [],
  nextQuestionId: null,
  serverNow: nowMs,
});

export interface SubmitResult {
  /** 저장이 실제로 끝났는지. 저장 실패를 완료 화면으로 표시하지 않기 위해 그대로 전한다. */
  stored: boolean;
  /** 이미 이 칸에 유효 제출이 있어 거절되었는지. 화면에는 이미 냈다는 안내만 보인다. */
  duplicate: boolean;
  message: string;
}

/* ────────────────────── 학생 신원·세션 ────────────────────── */

interface StudentContext {
  principal: Principal;
  researchId: string;
  classResearchId: string;
  session: AssessmentSession;
  consent: ConsentRecord | null;
}

/** 학생 본인의 열린 검사 세션을 찾는다. 시점은 서버가 정하며 클라이언트가 고르지 않는다. */
async function loadStudentContext(
  deps: CollectDeps
): Promise<
  { ok: true; ctx: StudentContext } | { ok: false; message: string }
> {
  const principal = await deps.auth.requirePrincipal();
  if (principal.role !== 'student' || !principal.researchId || !principal.classResearchId) {
    return { ok: false, message: PARTICIPATION_MESSAGE.session_not_open };
  }

  const researchStart = checkResearchStartAllowed(deps.registry);
  const consent = await deps.auth.getConsent(principal.researchId);

  let session: AssessmentSession | null = null;
  for (const phase of ['pre', 'post'] as AssessmentPhase[]) {
    const found = await deps.store.findOpenSession(principal.classResearchId, phase);
    if (found) {
      session = found;
      break;
    }
  }

  const participation = checkParticipation({ consent, session, researchStart });
  if (!participation.ok) {
    return { ok: false, message: PARTICIPATION_MESSAGE[participation.reason] };
  }

  return {
    ok: true,
    ctx: {
      principal,
      researchId: principal.researchId,
      classResearchId: principal.classResearchId,
      session: session as AssessmentSession,
      consent,
    },
  };
}

/* ────────────────────── 교사: 세션 열기·닫기 ────────────────────── */

export async function openAssessmentSession(
  deps: CollectDeps,
  classResearchId: string,
  phase: AssessmentPhase
): Promise<{ ok: boolean; assessmentSessionId?: string; blockers?: string[] }> {
  const principal = await deps.auth.requireClassAccess(
    classResearchId,
    'teacher',
    'researcher',
    'admin'
  );

  // 후보·미승인 레지스트리에서는 본연구 검사를 열 수 없다. 화면 토글로 대신하지 않는다.
  const start = checkResearchStartAllowed(deps.registry);
  if (!start.allowed) return { ok: false, blockers: start.blockers };

  const openedAtMs = nowMsOf(deps);
  const session: AssessmentSession = {
    assessmentSessionId: makeAssessmentSessionId(classResearchId, phase, openedAtMs),
    classResearchId,
    phase,
    openedAt: new Date(openedAtMs).toISOString(),
    closedAt: null,
    openedBy: principal.uid,
    // 사전·사후가 같은 레지스트리 판을 쓴다는 사실을 세션에 새겨 둔다.
    registryVersion: buildAssessmentPlan(deps.registry)
      .items.map((i) => `${i.questionId}:${i.imageHash.slice(0, 12)}`)
      .join(','),
  };
  await deps.store.putSession(session);
  return { ok: true, assessmentSessionId: session.assessmentSessionId };
}

export async function closeAssessmentSession(
  deps: CollectDeps,
  assessmentSessionId: string
): Promise<{ ok: boolean }> {
  const session = await deps.store.getSession(assessmentSessionId);
  if (!session) return { ok: false };
  await deps.auth.requireClassAccess(session.classResearchId, 'teacher', 'researcher', 'admin');
  await deps.store.putSession({
    ...session,
    closedAt: new Date(nowMsOf(deps)).toISOString(),
  });
  return { ok: true };
}

/* ────────────────────── 학생: 검사 상태 조회 ────────────────────── */

/**
 * 검사 화면이 처음 열릴 때와 새로고침할 때 부른다.
 * 남은 시간을 서버가 다시 계산하므로 새로고침으로 시간이 초기화되지 않는다.
 * AI를 부르지 않고 저장된 상태만 읽는다.
 *
 * 조회는 이 학생 본인의 칸만 문서 단위로 읽는다. 학급 전체·타 학급을 훑지 않는다.
 */
export async function getAssessmentState(deps: CollectDeps): Promise<AssessmentStateResponse> {
  const nowMs = nowMsOf(deps);
  const loaded = await loadStudentContext(deps);
  if (!loaded.ok) return emptyState(loaded.message, nowMs);
  const { ctx } = loaded;

  const plan = buildAssessmentPlan(deps.registry);
  if (!plan.planCheck.ok) return emptyState(PARTICIPATION_MESSAGE.research_not_ready, nowMs);

  const items: StudentAssessmentItem[] = [];
  let nextQuestionId: string | null = null;

  for (let i = 0; i < plan.items.length; i += 1) {
    const planItem = plan.items[i];
    const windowId = windowIdOf(ctx.researchId, ctx.session.phase, planItem.questionId);
    const existingWindow = await deps.store.getItemWindow(windowId);
    // 아직 열지 않은 문항은 시작 시각이 없다. 화면에서 시작을 누를 때 서버가 연다.
    if (!existingWindow) {
      if (!nextQuestionId) nextQuestionId = planItem.questionId;
      continue;
    }

    const submission = await deps.store.getSubmissionForCell(
      ctx.researchId,
      ctx.session.phase,
      planItem.questionId
    );
    items.push(
      toStudentItem(
        planItem,
        i + 1,
        {
          questionId: planItem.questionId,
          startedAt: existingWindow.startedAt,
          durationSeconds: existingWindow.durationSeconds,
          submitted: submission?.responseStatus === 'submitted',
        },
        nowMs
      )
    );
  }

  const response: AssessmentStateResponse = {
    ok: true,
    message: null,
    phase: ctx.session.phase,
    items,
    nextQuestionId,
    serverNow: nowMs,
  };

  // 마지막 그물. 점수·앵커·단서가 섞였으면 화면으로 내보내지 않는다.
  const leaked = findForbiddenPayloadKeys(response);
  if (leaked.length) return emptyState(PARTICIPATION_MESSAGE.research_not_ready, nowMs);
  return response;
}

/**
 * 문항을 연다. 서버가 시작 시각을 정하고 이미 열려 있으면 그 값을 그대로 쓴다.
 * 따라서 새로고침·재접속으로 제한시간이 늘어나지 않는다.
 */
export async function startAssessmentItem(
  deps: CollectDeps,
  requestedQuestionId: string | null
): Promise<AssessmentStateResponse> {
  const nowMs = nowMsOf(deps);
  const loaded = await loadStudentContext(deps);
  if (!loaded.ok) return emptyState(loaded.message, nowMs);
  const { ctx } = loaded;

  // 열 문항은 서버가 정한다. 클라이언트가 순서를 앞당기거나 건너뛸 수 없다.
  const state = await getAssessmentState(deps);
  const questionId = state.nextQuestionId;
  if (!questionId) return state;
  if (requestedQuestionId && requestedQuestionId !== questionId) {
    // 화면이 다른 문항을 요구해도 서버가 정한 다음 문항만 연다.
    return state;
  }

  const entry = deps.registry.requireEntry(questionId, 'research_assessment');
  await deps.store.createItemWindowIfAbsent(
    makeItemWindow({
      researchId: ctx.researchId,
      classResearchId: ctx.classResearchId,
      phase: ctx.session.phase,
      questionId,
      startedAt: new Date(nowMs).toISOString(),
      durationSeconds: entry.durationSeconds ?? 0,
    })
  );
  return getAssessmentState(deps);
}

/* ────────────────────── 학생: 제출 ────────────────────── */

/**
 * 검사 응답을 제출한다.
 *
 * 점수를 만들지 않고 AI를 부르지 않는다. 반환값에도 점수·피드백이 없다.
 * 한 칸(학생·시점·문항)의 최초 유효 제출은 불변이다. 제출ID가 달라도 두 번째는
 * 저장하지 않고 거절 기록만 남긴다.
 */
export async function submitAssessmentResponse(
  deps: CollectDeps,
  input: { submissionId: string; questionId: string; text: string }
): Promise<SubmitResult> {
  const nowMs = nowMsOf(deps);
  const loaded = await loadStudentContext(deps);
  if (!loaded.ok) return { stored: false, duplicate: false, message: loaded.message };
  const { ctx } = loaded;

  // 등록되지 않은 문항·검사에 쓸 수 없는 문항은 여기서 거부된다.
  const entry = deps.registry.requireEntry(input.questionId, 'research_assessment');

  const windowId = windowIdOf(ctx.researchId, ctx.session.phase, input.questionId);
  const win = await deps.store.getItemWindow(windowId);

  const withinDeadline = win
    ? acceptsSubmission(
        {
          questionId: input.questionId,
          startedAtMs: Date.parse(win.startedAt),
          durationSeconds: win.durationSeconds,
        } satisfies ItemWindow,
        nowMs
      )
    : false;

  const researchStart = checkResearchStartAllowed(deps.registry);
  const text = sanitizeResponseText(input.text);

  const guard = checkSubmitGuards({
    submissionId: input.submissionId,
    consentActive: isResearchConsentActive(ctx.consent),
    consentWithdrawn: !!ctx.consent?.withdrawnAt,
    sessionOpen: !!ctx.session.openedAt && !ctx.session.closedAt,
    itemStarted: !!win,
    withinDeadline,
    registryReady: researchStart.allowed,
    // 빈 응답을 유효 제출로 받지 않는다. 클라이언트 버튼 disabled에 기대지 않는다.
    hasText: !isEmptyResponse(text),
  });

  if (!guard.ok) {
    return {
      stored: false,
      duplicate: false,
      message:
        guard.reason === 'deadline_passed'
          ? '시간이 다 되어 이 문항은 여기까지예요.'
          : guard.reason === 'empty_response'
            ? '아직 아무것도 쓰지 않았어요. 한 문장이라도 써 볼까요?'
            : PARTICIPATION_MESSAGE.session_not_open,
    };
  }

  // 이 칸에 이미 유효 제출이 있으면 새 제출ID로 와도 받지 않는다.
  // (두 탭·두 기기의 이중 제출은 여기와 저장소의 원자적 create가 함께 막는다.)
  const alreadyStored = await deps.store.getSubmissionForCell(
    ctx.researchId,
    ctx.session.phase,
    input.questionId
  );

  // 전송 전 개인정보 점검. 의심 내용은 저장을 멈추고 교사 확인을 받는다.
  const pii = deps.privacy.checkBeforeSend(text);
  if (pii.decision === 'hold_for_teacher') {
    return {
      stored: false,
      duplicate: false,
      message: '쓴 내용을 선생님과 함께 확인해 주세요.',
    };
  }

  const ctxRecord: SubmissionContext = {
    submissionId: input.submissionId,
    researchId: ctx.researchId,
    classResearchId: ctx.classResearchId,
    phase: ctx.session.phase,
    questionId: input.questionId,
    band: entry.band,
    imageHash: entry.imageSha256,
    cueVersion: entry.cueVersion,
    rubricVersion: entry.rubricVersion,
    consentVersion: ctx.consent?.consentVersion ?? deps.consentVersion,
    startedAt: (win as ItemWindowRecord).startedAt,
    attemptNo: 1,
  };

  const incoming = makeSubmittedRecord(ctxRecord, text, nowMs);
  deps.privacy.assertNoSecrets(incoming);

  if (alreadyStored && alreadyStored.persistStatus !== 'failed') {
    await deps.store.appendRejection({ ...incoming, persistStatus: 'rejected_duplicate' });
    return { stored: true, duplicate: true, message: '이미 냈어요. 다음으로 넘어가요.' };
  }

  try {
    // 저장소가 원자적으로 판정한다. 앞의 조회와 이 호출 사이에 다른 탭이 끼어들어도
    // 한쪽만 저장되고 다른 쪽은 거절로 돌아온다(경합이 '저장 실패'로 보이지 않는다).
    const decision = await deps.store.claimSubmission(incoming);
    if (decision.outcome === 'rejected_duplicate') {
      await deps.store.appendRejection(
        decision.rejection ?? { ...incoming, persistStatus: 'rejected_duplicate' }
      );
      return { stored: true, duplicate: true, message: '이미 냈어요. 다음으로 넘어가요.' };
    }
    return { stored: true, duplicate: false, message: '잘 냈어요.' };
  } catch {
    // 저장 실패를 완료 화면으로 표시하지 않는다. 같은 제출ID로 다시 시도하게 한다.
    await deps.store.appendRejection({ ...incoming, persistStatus: 'failed' });
    return { stored: false, duplicate: false, message: '아직 저장되지 않았어요. 다시 눌러 주세요.' };
  }
}

/* ────────────────────── 기술 실패 ────────────────────── */

/**
 * 학생이 겪은 장애를 신고로 남긴다.
 *
 * 이 값은 '확인 전 신고'일 뿐 결측 사유를 확정하지 않는다. 학생이 결측 사유를 고를 수
 * 있으면 시간 종료 미제출(timeout_unsubmitted)을 기술 실패로 바꿀 수 있기 때문이다.
 * 사유 확정은 교사가 confirmTechnicalFailure로 한다.
 *
 * 이미 열린 창에만 남긴다. 없는 창을 만들지 않는다. 열지 않은 문항에 신고가 오면
 * 시작 시각 없는 유령 창이 생겨 학생이 그 문항에 영영 들어가지 못했다.
 */
export async function reportTechnicalFailure(
  deps: CollectDeps,
  input: { questionId: string; reason: string }
): Promise<{ ok: boolean; recorded: boolean }> {
  const loaded = await loadStudentContext(deps);
  if (!loaded.ok) return { ok: false, recorded: false };
  const { ctx } = loaded;

  // 등록되지 않은 문항ID는 받지 않는다. 임의 문자열로 문서를 만들지 못하게 한다.
  const entry = deps.registry.requireEntry(input.questionId, 'research_assessment');

  const windowId = windowIdOf(ctx.researchId, ctx.session.phase, entry.questionId);
  const patched = await deps.store.patchItemWindow(windowId, {
    studentReportedFailureReason: input.reason.slice(0, 200),
    studentReportedFailureAt: new Date(nowMsOf(deps)).toISOString(),
  });
  // 열지 않은 문항이면 아무것도 만들지 않고 그대로 알린다.
  return { ok: patched, recorded: patched };
}

/**
 * 교사가 기술 실패를 확인해 결측 사유를 확정한다.
 * 학생 신고만으로는 바뀌지 않던 delivery 상태를 여기서 바꾼다.
 */
export async function confirmTechnicalFailure(
  deps: CollectDeps,
  input: {
    classResearchId: string;
    researchId: string;
    phase: AssessmentPhase;
    questionId: string;
    reason: string;
  }
): Promise<{ ok: boolean }> {
  await deps.auth.requireClassAccess(input.classResearchId, 'teacher', 'researcher', 'admin');
  const entry = deps.registry.requireEntry(input.questionId, 'research_assessment');
  const windowId = windowIdOf(input.researchId, input.phase, entry.questionId);
  const patched = await deps.store.patchItemWindow(windowId, {
    delivery: 'delivery_failed',
    technicalFailureReason: input.reason.slice(0, 200),
  });
  return { ok: patched };
}

/* ────────────────────── 마감 처리 ────────────────────── */

/**
 * 시간이 끝났는데 제출하지 않은 칸을 결측으로 확정한다.
 * 교사가 세션을 닫을 때 부른다. 화면에 남아 있던 초안 텍스트를 받지 않으므로
 * 초안이 연구 응답이 되는 일이 없다.
 */
export async function finalizeTimeouts(
  deps: CollectDeps,
  assessmentSessionId: string,
  researchIds: string[]
): Promise<{ ok: boolean; created: number }> {
  const session = await deps.store.getSession(assessmentSessionId);
  if (!session) return { ok: false, created: 0 };
  await deps.auth.requireClassAccess(session.classResearchId, 'teacher', 'researcher', 'admin');

  const plan = buildAssessmentPlan(deps.registry);
  const nowMs = nowMsOf(deps);
  let created = 0;

  for (const researchId of researchIds) {
    const consent = await deps.auth.getConsent(researchId);
    for (const item of plan.items) {
      const windowId = windowIdOf(researchId, session.phase, item.questionId);
      const win = await deps.store.getItemWindow(windowId);
      // 다른 학급 학생의 칸에는 쓰지 않는다. 교사가 목록에 남의 학급 연구ID를 섞어도
      // 이 세션의 학급과 다른 창이면 건너뛴다.
      if (win && win.classResearchId !== session.classResearchId) continue;
      // 다른 학급·다른 학생을 훑지 않고 이 칸의 문서 하나만 읽는다.
      const existing = await deps.store.getSubmissionForCell(
        researchId,
        session.phase,
        item.questionId
      );
      if (existing) continue;

      const ctx: SubmissionContext = {
        // 결측 칸의 제출ID는 서버가 만든다. 학생이 만든 값이 아니다.
        submissionId: `miss_${windowId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64),
        researchId,
        classResearchId: session.classResearchId,
        phase: session.phase,
        questionId: item.questionId,
        band: item.band,
        imageHash: item.imageHash,
        cueVersion: item.cueVersion,
        rubricVersion: item.rubricVersion,
        consentVersion: consent?.consentVersion ?? deps.consentVersion,
        startedAt: win?.startedAt ?? new Date(nowMs).toISOString(),
        attemptNo: 0,
      };

      await deps.store.putSubmission(
        makeMissingRecord(ctx, resolveMissingReason(consent, win), nowMs)
      );
      created += 1;
    }
  }
  return { ok: true, created };
}

/**
 * 결측 사유를 정한다. 철회·미동의·기술 실패·시간 종료·미실시는 서로 다른 상태다.
 *
 * 기술 실패는 교사가 확인한 delivery 상태로만 정한다. 학생 신고
 * (studentReportedFailureReason)는 참고 기록으로 남을 뿐 사유를 바꾸지 않는다.
 */
export function resolveMissingReason(
  consent: ConsentRecord | null,
  win: ItemWindowRecord | null
): 'consent_withdrawn' | 'not_consented' | 'technical_failure' | 'timeout_unsubmitted' | 'absent' {
  if (consent?.withdrawnAt) return 'consent_withdrawn';
  if (!isResearchConsentActive(consent)) return 'not_consented';
  if (win?.delivery === 'delivery_failed') return 'technical_failure';
  return win ? 'timeout_unsubmitted' : 'absent';
}

/** 이 칸의 제출 기록을 읽는다(연구자 도구·점검용). 문서 하나만 읽는다. */
export async function getSubmissionForCell(
  deps: CollectDeps,
  researchId: string,
  phase: AssessmentPhase,
  questionId: string
): Promise<SubmissionRecord | null> {
  return deps.store.getSubmissionForCell(researchId, phase, questionId);
}
