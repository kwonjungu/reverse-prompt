'use server';

/**
 * 검사 수집 server action — 수집만 하고 채점은 하지 않는다.
 *
 * 설계서 §5
 *  - 검사 화면 요청 시 AI를 호출하지 않는다. 이 파일은 grading을 import 하지 않는다.
 *  - 점수·피드백·힌트·모범답이 없고 제출 후 재도전이 없다.
 *  - 문항 시작·마감은 서버 시간 기준이며 새로고침으로 초기화되지 않는다.
 *  - 제출은 submissionId 기준 idempotent이며 최초 유효 제출은 불변이다.
 *
 * 클라이언트가 보낸 역할·학급·동의·밴드·이미지·점수는 신뢰하지 않는다.
 * questionId만 받고 나머지는 서버가 레지스트리와 인증에서 확정한다.
 */

import { auth } from '@/server/auth';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import { CONSENT_VERSION } from '@/server/config';
import type { AssessmentPhase, AssessmentSession, SubmissionRecord } from '@/lib/research/types';
import { SCHEMA_VERSION } from '@/lib/research/types';
import { acceptsSubmission, type ItemWindow } from './timing';
import {
  PARTICIPATION_MESSAGE,
  buildAssessmentPlan,
  checkParticipation,
  checkResearchStartAllowed,
  findForbiddenPayloadKeys,
  makeAssessmentSessionId,
  toStudentItem,
  type StudentAssessmentItem,
} from './session';
import {
  checkSubmitGuards,
  makeMissingRecord,
  makeSubmittedRecord,
  resolveSubmission,
  type SubmissionContext,
} from './submission';
import { createFirestoreAssessmentStore } from './firestore-store';
import { windowIdOf, type AssessmentStore, type ItemWindowRecord } from './store';

let cachedStore: AssessmentStore | null = null;
function store(): AssessmentStore {
  if (!cachedStore) cachedStore = createFirestoreAssessmentStore();
  return cachedStore;
}

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

const EMPTY_STATE = (message: string | null): AssessmentStateResponse => ({
  ok: false,
  message,
  phase: null,
  items: [],
  nextQuestionId: null,
  serverNow: Date.now(),
});

/* ────────────────────── 교사: 세션 열기·닫기 ────────────────────── */

export async function openAssessmentSession(
  classResearchId: string,
  phase: AssessmentPhase
): Promise<{ ok: boolean; assessmentSessionId?: string; blockers?: string[] }> {
  const principal = await auth.requireClassAccess(classResearchId, 'teacher', 'researcher', 'admin');

  // 후보·미승인 레지스트리에서는 본연구 검사를 열 수 없다. 화면 토글로 대신하지 않는다.
  const start = checkResearchStartAllowed(registry);
  if (!start.allowed) return { ok: false, blockers: start.blockers };

  const openedAtMs = Date.now();
  const session: AssessmentSession = {
    assessmentSessionId: makeAssessmentSessionId(classResearchId, phase, openedAtMs),
    classResearchId,
    phase,
    openedAt: new Date(openedAtMs).toISOString(),
    closedAt: null,
    openedBy: principal.uid,
    // 사전·사후가 같은 레지스트리 판을 쓴다는 사실을 세션에 새겨 둔다.
    registryVersion: buildAssessmentPlan(registry)
      .items.map((i) => `${i.questionId}:${i.imageHash.slice(0, 12)}`)
      .join(','),
  };
  await store().putSession(session);
  return { ok: true, assessmentSessionId: session.assessmentSessionId };
}

export async function closeAssessmentSession(assessmentSessionId: string): Promise<{ ok: boolean }> {
  const session = await store().getSession(assessmentSessionId);
  if (!session) return { ok: false };
  await auth.requireClassAccess(session.classResearchId, 'teacher', 'researcher', 'admin');
  await store().putSession({ ...session, closedAt: new Date().toISOString() });
  return { ok: true };
}

/* ────────────────────── 학생: 검사 상태 조회 ────────────────────── */

/**
 * 검사 화면이 처음 열릴 때와 새로고침할 때 부른다.
 * 남은 시간을 서버가 다시 계산하므로 새로고침으로 시간이 초기화되지 않는다.
 * AI를 부르지 않고 저장된 상태만 읽는다.
 */
export async function getAssessmentState(): Promise<AssessmentStateResponse> {
  const principal = await auth.requirePrincipal();
  if (principal.role !== 'student' || !principal.researchId || !principal.classResearchId) {
    return EMPTY_STATE(PARTICIPATION_MESSAGE.session_not_open);
  }

  const researchStart = checkResearchStartAllowed(registry);
  const consent = await auth.getConsent(principal.researchId);

  // 열려 있는 시점(pre/post)을 서버가 찾는다. 클라이언트가 시점을 고르지 않는다.
  let session: AssessmentSession | null = null;
  for (const phase of ['pre', 'post'] as AssessmentPhase[]) {
    const found = await store().findOpenSession(principal.classResearchId, phase);
    if (found) {
      session = found;
      break;
    }
  }

  const participation = checkParticipation({ consent, session, researchStart });
  if (!participation.ok) return EMPTY_STATE(PARTICIPATION_MESSAGE[participation.reason]);

  const openSession = session as AssessmentSession;
  const plan = buildAssessmentPlan(registry);
  if (!plan.planCheck.ok) return EMPTY_STATE(PARTICIPATION_MESSAGE.research_not_ready);

  const nowMs = Date.now();
  const items: StudentAssessmentItem[] = [];
  let nextQuestionId: string | null = null;

  for (let i = 0; i < plan.items.length; i += 1) {
    const planItem = plan.items[i];
    const windowId = windowIdOf(principal.researchId, openSession.phase, planItem.questionId);
    const existingWindow = await store().getItemWindow(windowId);
    // 아직 열지 않은 문항은 시작 시각이 없다. 화면에서 시작을 누를 때 서버가 연다.
    if (!existingWindow) {
      if (!nextQuestionId) nextQuestionId = planItem.questionId;
      continue;
    }

    const submission = await findSubmissionForWindow(
      store(),
      principal.researchId,
      openSession.phase,
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
    phase: openSession.phase,
    items,
    nextQuestionId,
    serverNow: nowMs,
  };

  // 마지막 그물. 점수·앵커·단서가 섞였으면 화면으로 내보내지 않는다.
  const leaked = findForbiddenPayloadKeys(response);
  if (leaked.length) return EMPTY_STATE(PARTICIPATION_MESSAGE.research_not_ready);
  return response;
}

/**
 * 문항을 연다. 서버가 시작 시각을 정하고 이미 열려 있으면 그 값을 그대로 쓴다.
 * 따라서 새로고침·재접속으로 제한시간이 늘어나지 않는다.
 */
export async function startAssessmentItem(
  requestedQuestionId: string | null
): Promise<AssessmentStateResponse> {
  const principal = await auth.requirePrincipal();
  if (principal.role !== 'student' || !principal.researchId || !principal.classResearchId) {
    return EMPTY_STATE(PARTICIPATION_MESSAGE.session_not_open);
  }

  const researchStart = checkResearchStartAllowed(registry);
  const consent = await auth.getConsent(principal.researchId);

  let session: AssessmentSession | null = null;
  for (const phase of ['pre', 'post'] as AssessmentPhase[]) {
    const found = await store().findOpenSession(principal.classResearchId, phase);
    if (found) {
      session = found;
      break;
    }
  }
  const participation = checkParticipation({ consent, session, researchStart });
  if (!participation.ok) return EMPTY_STATE(PARTICIPATION_MESSAGE[participation.reason]);

  const openSession = session as AssessmentSession;

  // 열 문항은 서버가 정한다. 클라이언트가 순서를 앞당기거나 건너뛸 수 없다.
  const state = await getAssessmentState();
  const questionId = state.nextQuestionId;
  if (!questionId) return state;
  if (requestedQuestionId && requestedQuestionId !== questionId) {
    // 화면이 다른 문항을 요구해도 서버가 정한 다음 문항만 연다.
    return state;
  }

  const entry = registry.requireEntry(questionId, 'research_assessment');
  const windowId = windowIdOf(principal.researchId, openSession.phase, questionId);

  const record: ItemWindowRecord = {
    schemaVersion: SCHEMA_VERSION,
    windowId,
    researchId: principal.researchId,
    classResearchId: principal.classResearchId,
    phase: openSession.phase,
    questionId,
    startedAt: new Date().toISOString(),
    durationSeconds: entry.durationSeconds ?? 0,
    delivery: 'delivered',
    technicalFailureReason: null,
  };
  await store().createItemWindowIfAbsent(record);
  return getAssessmentState();
}

/* ────────────────────── 학생: 제출 ────────────────────── */

export interface SubmitResult {
  /** 저장이 실제로 끝났는지. 저장 실패를 완료 화면으로 표시하지 않기 위해 그대로 전한다. */
  stored: boolean;
  /** 같은 제출ID의 재요청이 거절되었는지. 화면에는 이미 냈다는 안내만 보인다. */
  duplicate: boolean;
  message: string;
}

/**
 * 검사 응답을 제출한다.
 *
 * 점수를 만들지 않고 AI를 부르지 않는다. 반환값에도 점수·피드백이 없다.
 * 같은 submissionId로 다시 오면 최초 값을 바꾸지 않고 거절 기록만 남긴다.
 */
export async function submitAssessmentResponse(input: {
  submissionId: string;
  questionId: string;
  text: string;
}): Promise<SubmitResult> {
  const principal = await auth.requirePrincipal();
  if (principal.role !== 'student' || !principal.researchId || !principal.classResearchId) {
    return { stored: false, duplicate: false, message: PARTICIPATION_MESSAGE.session_not_open };
  }

  const researchStart = checkResearchStartAllowed(registry);
  // 동의와 승낙이 활성인 참가자만 연구 검사를 수집한다. 미동의는 여기서 막는다.
  const consent = await auth.getConsent(principal.researchId);

  let session: AssessmentSession | null = null;
  for (const phase of ['pre', 'post'] as AssessmentPhase[]) {
    const found = await store().findOpenSession(principal.classResearchId, phase);
    if (found) {
      session = found;
      break;
    }
  }

  const entry = registry.requireEntry(input.questionId, 'research_assessment');
  const windowId = windowIdOf(
    principal.researchId,
    session?.phase ?? 'pre',
    input.questionId
  );
  const win = await store().getItemWindow(windowId);

  const nowMs = Date.now();
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

  const guard = checkSubmitGuards({
    submissionId: input.submissionId,
    consentActive: !!consent && !consent.withdrawnAt && consent.guardianConsent === 'granted' && consent.studentAssent === 'granted',
    consentWithdrawn: !!consent?.withdrawnAt,
    sessionOpen: !!session && !!session.openedAt && !session.closedAt,
    withinDeadline,
    registryReady: researchStart.allowed,
  });

  if (!guard.ok) {
    return {
      stored: false,
      duplicate: false,
      message:
        guard.reason === 'deadline_passed'
          ? '시간이 다 되어 이 문항은 여기까지예요.'
          : PARTICIPATION_MESSAGE.session_not_open,
    };
  }

  const openSession = session as AssessmentSession;
  // 전송 전 개인정보 점검. 의심 내용은 저장을 멈추고 교사 확인을 받는다.
  const pii = privacy.checkBeforeSend(input.text);
  if (pii.decision === 'hold_for_teacher') {
    return {
      stored: false,
      duplicate: false,
      message: '쓴 내용을 선생님과 함께 확인해 주세요.',
    };
  }

  const ctx: SubmissionContext = {
    submissionId: input.submissionId,
    researchId: principal.researchId,
    classResearchId: principal.classResearchId,
    phase: openSession.phase,
    questionId: input.questionId,
    band: entry.band,
    imageHash: entry.imageSha256,
    cueVersion: entry.cueVersion,
    rubricVersion: entry.rubricVersion,
    consentVersion: consent?.consentVersion ?? CONSENT_VERSION,
    startedAt: (win as ItemWindowRecord).startedAt,
    attemptNo: 1,
  };

  const incoming = makeSubmittedRecord(ctx, input.text, nowMs);
  privacy.assertNoSecrets(incoming);

  const existing = await store().getSubmission(input.submissionId);
  const decision = resolveSubmission(existing, incoming);

  if (decision.outcome === 'rejected_duplicate') {
    await store().appendRejection(decision.rejection as SubmissionRecord);
    return { stored: true, duplicate: true, message: '이미 냈어요. 다음으로 넘어가요.' };
  }

  try {
    await store().putSubmission(decision.toStore as SubmissionRecord);
    return { stored: true, duplicate: false, message: '잘 냈어요.' };
  } catch {
    // 저장 실패를 완료 화면으로 표시하지 않는다. 같은 제출ID로 다시 시도하게 한다.
    await store().appendRejection({
      ...(decision.toStore as SubmissionRecord),
      persistStatus: 'failed',
    });
    return { stored: false, duplicate: false, message: '아직 저장되지 않았어요. 다시 눌러 주세요.' };
  }
}

/**
 * 네트워크 장애 등 기술 실패를 기록한다.
 * 이 기록은 결측 사유일 뿐 점수가 아니며, 타이핑 초안을 연구 응답으로 확정하지 않는다.
 */
export async function reportTechnicalFailure(input: {
  questionId: string;
  reason: string;
}): Promise<{ ok: boolean }> {
  const principal = await auth.requirePrincipal();
  if (principal.role !== 'student' || !principal.researchId || !principal.classResearchId) {
    return { ok: false };
  }
  for (const phase of ['pre', 'post'] as AssessmentPhase[]) {
    const session = await store().findOpenSession(principal.classResearchId, phase);
    if (!session) continue;
    const windowId = windowIdOf(principal.researchId, phase, input.questionId);
    await store().updateItemWindowDelivery(
      windowId,
      'delivery_failed',
      input.reason.slice(0, 200)
    );
    return { ok: true };
  }
  return { ok: false };
}

/**
 * 시간이 끝났는데 제출하지 않은 칸을 결측으로 확정한다.
 * 교사가 세션을 닫을 때 부른다. 화면에 남아 있던 초안 텍스트를 받지 않으므로
 * 초안이 연구 응답이 되는 일이 없다.
 */
export async function finalizeTimeouts(
  assessmentSessionId: string,
  researchIds: string[]
): Promise<{ ok: boolean; created: number }> {
  const session = await store().getSession(assessmentSessionId);
  if (!session) return { ok: false, created: 0 };
  await auth.requireClassAccess(session.classResearchId, 'teacher', 'researcher', 'admin');

  const plan = buildAssessmentPlan(registry);
  const nowMs = Date.now();
  let created = 0;

  for (const researchId of researchIds) {
    const consent = await auth.getConsent(researchId);
    for (const item of plan.items) {
      const windowId = windowIdOf(researchId, session.phase, item.questionId);
      const win = await store().getItemWindow(windowId);
      const existing = await findSubmissionForWindow(
        store(),
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
        consentVersion: consent?.consentVersion ?? CONSENT_VERSION,
        startedAt: win?.startedAt ?? new Date(nowMs).toISOString(),
        attemptNo: 0,
      };

      // 사유를 구분한다. 철회·미동의·기술 실패·시간 종료는 서로 다른 상태다.
      const reason = consent?.withdrawnAt
        ? 'consent_withdrawn'
        : !consent || consent.guardianConsent !== 'granted' || consent.studentAssent !== 'granted'
          ? 'not_consented'
          : win?.delivery === 'delivery_failed'
            ? 'technical_failure'
            : win
              ? 'timeout_unsubmitted'
              : 'absent';

      await store().putSubmission(makeMissingRecord(ctx, reason, nowMs));
      created += 1;
    }
  }
  return { ok: true, created };
}

/** 학생·시점·문항 칸에 해당하는 제출을 찾는다. 문서ID를 모르므로 목록에서 고른다. */
async function findSubmissionForWindow(
  s: AssessmentStore,
  researchId: string,
  phase: AssessmentPhase,
  questionId: string
): Promise<SubmissionRecord | null> {
  const all = await s.listSubmissions({ phase });
  return (
    all.find(
      (r) =>
        r.researchId === researchId &&
        r.questionId === questionId &&
        r.persistStatus === 'stored'
    ) ?? null
  );
}
