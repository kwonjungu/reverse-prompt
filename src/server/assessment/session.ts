/**
 * 검사 세션의 순수 판정 — 시작 가능 여부, 문항 계획, 학생 화면 payload
 *
 * 설계서 §5, 수용시험 8·9
 *  - 교사가 pre/post 세션을 열며 동의와 승낙이 활성인 참가자만 수집 대상이다.
 *  - 사전·사후가 같은 3파일·같은 순서·같은 제한시간을 쓴다.
 *  - 검사 화면·API·브라우저 payload에 점수·앵커·단서·모범답이 실리지 않는다.
 *  - 레지스트리가 candidate이거나 researchReady=false면 본연구를 시작하지 못한다.
 *
 * 부수효과가 없어야 테스트에서 가짜 레지스트리로 거부 동작을 그대로 확인할 수 있다.
 * 실제 인증·저장은 actions.ts가 맡는다.
 */

import type { Band } from '@/lib/scoring';
import type {
  AssessmentPhase,
  AssessmentSession,
  ConsentRecord,
} from '@/lib/research/types';
import { isResearchConsentActive } from '@/lib/research/types';
import type { PublicQuestionView, RegistryEntry } from '@/server/registry/contract';
import { remainingSeconds, verifyItemPlan, type ItemWindow } from './timing';

/** 세션 판정에 필요한 레지스트리 기능만 추린 것. RegistryApi 구현을 그대로 넣을 수 있다. */
export interface AssessmentRegistryView {
  assessmentOrder(): string[];
  getEntry(questionId: string): RegistryEntry;
  toPublicView(entry: RegistryEntry): PublicQuestionView;
  readiness(): { researchReady: boolean; blockers: string[] };
}

/** 검사 문항 하나의 서버측 계획. 단서·앵커는 담지 않는다. */
export interface AssessmentPlanItem {
  questionId: string;
  band: Band;
  durationSeconds: number;
  imageHash: string;
  cueVersion: string;
  rubricVersion: string;
  status: RegistryEntry['status'];
  approvedAt: string | null;
  publicView: PublicQuestionView;
}

export interface AssessmentPlan {
  items: AssessmentPlanItem[];
  /** 계획 검산 결과. 순서·제한시간·총 시간이 어긋나면 검사를 열지 않는다. */
  planCheck: { ok: true } | { ok: false; reason: string };
}

/**
 * 검사 문항 계획을 만든다. 시점(pre/post)을 인자로 받지 않는다.
 * 같은 계획을 두 시점이 그대로 쓰므로 파일 해시·순서·제한시간이 구조적으로 같아진다.
 */
export function buildAssessmentPlan(registry: AssessmentRegistryView): AssessmentPlan {
  const items = registry.assessmentOrder().map((questionId) => {
    const entry = registry.getEntry(questionId);
    return {
      questionId: entry.questionId,
      band: entry.band,
      // 검사 문항의 제한시간은 레지스트리가 확정한 값이다. 클라이언트가 정하지 않는다.
      durationSeconds: entry.durationSeconds ?? 0,
      imageHash: entry.imageSha256,
      cueVersion: entry.cueVersion,
      rubricVersion: entry.rubricVersion,
      status: entry.status,
      approvedAt: entry.approvedAt,
      publicView: registry.toPublicView(entry),
    } satisfies AssessmentPlanItem;
  });

  return {
    items,
    planCheck: verifyItemPlan(
      items.map((i) => ({ questionId: i.questionId, durationSeconds: i.durationSeconds }))
    ),
  };
}

/**
 * 사전·사후가 같은 검사 파일을 쓰는지 확인할 때 쓰는 지문(fingerprint).
 * 두 시점에서 이 값이 같아야 한다.
 */
export function assessmentAssetFingerprint(plan: AssessmentPlan): string {
  return plan.items.map((i) => `${i.questionId}:${i.imageHash}:${i.durationSeconds}`).join('|');
}

export interface ResearchStartCheck {
  allowed: boolean;
  blockers: string[];
}

/**
 * 본연구 검사를 시작해도 되는지 판정한다.
 *
 * candidate 상태이거나 승인일이 없거나 readiness가 false이면 막는다.
 * 화면 토글이 아니라 이 판정이 근거이며 route·server action·스크립트가 모두 이것을 부른다.
 *
 * allowCandidate는 '합성 자료 모의 실행'에서만 쓴다. 이 옵션은 레지스트리 상태에 대한
 * 예외일 뿐 실데이터 채점의 차단을 푸는 열쇠가 아니다. 자료가 실제로 합성인지는
 * scoring-job의 assertSyntheticDryRun이 따로 강제하며, 이 함수만 통과했다고
 * 실데이터를 채점해도 된다는 뜻이 아니다. 막힌 사유는 허용하는 경우에도 그대로 돌려주어
 * 호출한 쪽이 '완료'로 보고하지 않게 한다.
 */
export function checkResearchStartAllowed(
  registry: AssessmentRegistryView,
  options?: { allowCandidate?: boolean }
): ResearchStartCheck {
  const blockers: string[] = [];
  const readiness = registry.readiness();
  if (!readiness.researchReady) blockers.push(...readiness.blockers);

  const plan = buildAssessmentPlan(registry);
  if (!plan.planCheck.ok) blockers.push(`검사 계획 불일치: ${plan.planCheck.reason}`);

  for (const item of plan.items) {
    if (item.status !== 'frozen') {
      blockers.push(`${item.questionId} 문항이 ${item.status} 상태(전문가 확정 전)`);
    }
    if (!item.approvedAt) {
      blockers.push(`${item.questionId} 문항의 승인일이 없음`);
    }
  }

  if (options?.allowCandidate) {
    // 합성 자료 모의 실행에서는 후보 상태를 허용하되 계획 자체의 불일치는 그대로 막는다.
    const remaining = blockers.filter((b) => b.startsWith('검사 계획 불일치'));
    return { allowed: remaining.length === 0, blockers };
  }

  return { allowed: blockers.length === 0, blockers };
}

/* ────────────────────── 학생 화면에 내려보내는 payload ────────────────────── */

/**
 * 검사 중 학생 브라우저가 받는 문항 정보.
 * 점수·앵커·단서·모범답·이미지 원 프롬프트가 들어갈 자리를 아예 두지 않는다.
 * 이미지도 인증 경로 URL만 주고 데이터 URI를 싣지 않는다.
 */
export interface StudentAssessmentItem {
  questionId: string;
  /** 몇 번째 문항인지. 1부터 센다. */
  order: number;
  imageUrl: string;
  /** 일반 안내 문구. 문항별 정답 단서가 아니다. */
  instruction: string;
  durationSeconds: number;
  /** 서버가 문항을 연 시각(ISO). 클라이언트는 표시만 한다. */
  startedAt: string;
  /** 서버 기준 남은 시간(초). 새로고침해도 서버가 다시 계산해 준다. */
  remainingSeconds: number;
  /** 이미 확정 제출한 문항인지. 제출 뒤 재도전은 없다. */
  submitted: boolean;
}

/** payload에 절대 실리면 안 되는 열쇠말. 테스트와 런타임 점검이 함께 쓴다. */
export const FORBIDDEN_PAYLOAD_KEYS = [
  'score',
  'levels',
  'axisScores',
  'anchors',
  'cues',
  'coreObjects',
  'requiredAttributes',
  'requiredContext',
  'acceptedExpressions',
  'contradictions',
  'sourcePrompt',
  'rubric',
  'feedback',
  'modelAnswer',
] as const;

/**
 * payload를 재귀로 훑어 금지 열쇠말이 있는지 확인한다.
 * 화면 컴포넌트가 필드를 늘렸을 때 조용히 새어 나가는 것을 막는 마지막 그물이다.
 */
export function findForbiddenPayloadKeys(payload: unknown, path = '$'): string[] {
  const found: string[] = [];
  const walk = (value: unknown, at: string) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(k)) {
        found.push(`${at}.${k}`);
      }
      walk(v, `${at}.${k}`);
    }
  };
  walk(payload, path);
  return found;
}

export interface ItemWindowState {
  questionId: string;
  startedAt: string;
  durationSeconds: number;
  submitted: boolean;
}

/**
 * 학생 payload를 만든다. 화이트리스트 방식이므로 레지스트리에 필드가 늘어도
 * 여기에 적지 않은 값은 브라우저로 가지 않는다.
 */
export function toStudentItem(
  item: AssessmentPlanItem,
  order: number,
  window: ItemWindowState,
  nowMs: number
): StudentAssessmentItem {
  const win: ItemWindow = {
    questionId: item.questionId,
    startedAtMs: Date.parse(window.startedAt),
    durationSeconds: window.durationSeconds,
  };
  return {
    questionId: item.questionId,
    order,
    imageUrl: item.publicView.imageUrl,
    instruction: item.publicView.instruction,
    durationSeconds: window.durationSeconds,
    startedAt: window.startedAt,
    remainingSeconds: remainingSeconds(win, nowMs),
    submitted: window.submitted,
  };
}

/* ────────────────────── 참가 자격 ────────────────────── */

export type ParticipationDenial =
  | 'not_consented'
  | 'consent_withdrawn'
  | 'session_not_open'
  | 'research_not_ready';

/**
 * 이 학생에게서 연구 검사를 수집해도 되는지 판정한다.
 * 동의·승낙 상태는 서버에서 조회한 ConsentRecord만 본다. 클라이언트 값은 쓰지 않는다.
 */
export function checkParticipation(input: {
  consent: ConsentRecord | null;
  session: AssessmentSession | null;
  researchStart: ResearchStartCheck;
}): { ok: true } | { ok: false; reason: ParticipationDenial } {
  if (input.consent?.withdrawnAt) return { ok: false, reason: 'consent_withdrawn' };
  if (!isResearchConsentActive(input.consent)) return { ok: false, reason: 'not_consented' };
  if (!input.researchStart.allowed) return { ok: false, reason: 'research_not_ready' };
  if (!input.session || !input.session.openedAt || input.session.closedAt) {
    return { ok: false, reason: 'session_not_open' };
  }
  return { ok: true };
}

/** 학생 화면에 보일 문구. 구현 용어를 쓰지 않는다. */
export const PARTICIPATION_MESSAGE: Record<ParticipationDenial, string> = {
  not_consented: '지금은 다른 활동을 하게 되어 있어요. 선생님께 알려 주세요.',
  consent_withdrawn: '지금은 다른 활동을 하게 되어 있어요. 선생님께 알려 주세요.',
  session_not_open: '아직 시작 시간이 아니에요. 선생님을 기다려 주세요.',
  research_not_ready: '아직 준비 중이에요. 선생님께 알려 주세요.',
};

/** 세션 식별자를 만든다. 학번·학교코드를 담지 않는다. */
export function makeAssessmentSessionId(
  classResearchId: string,
  phase: AssessmentPhase,
  openedAtMs: number
): string {
  return `as_${classResearchId}_${phase}_${openedAtMs.toString(36)}`;
}
