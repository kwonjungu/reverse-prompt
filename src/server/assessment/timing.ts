/**
 * 검사 문항의 시간 계산 — 서버 시간이 단일 기준
 *
 * 설계서 §5
 *  - 동일 3파일·순서·일반 안내·문항별 제한시간. 안내 5분 + 7/8/10분 + 마무리 3분 = 33분.
 *  - 문항 시작·마감은 서버 시간 기준. 새로고침으로 시간이 초기화되면 안 된다.
 *  - 시간 종료 미제출은 timeout_unsubmitted 결측이며 빈 응답을 최저 점수로 만들지 않는다.
 *
 * 클라이언트는 남은 시간을 화면에 표시만 하고, 마감 판정은 언제나 이 모듈이 한다.
 * 브라우저 시계·localStorage 값은 신뢰하지 않는다.
 */

/** 검사 진행 단계. 안내와 마무리는 문항이 아니다. */
export type AssessmentStage = 'intro' | 'item' | 'closing';

/** 일반 안내 5분 */
export const INTRO_SECONDS = 300;
/** 마무리 3분 */
export const CLOSING_SECONDS = 180;

/** 전체 33분. 안내 5 + 7 + 8 + 10 + 마무리 3. */
export const TOTAL_ASSESSMENT_SECONDS = 33 * 60;

/**
 * 검사 문항의 제한시간. 레지스트리(에이전트2)가 확정한 durationSeconds와 같아야 하며
 * 이 상수는 총 시간 검산과 레지스트리 대조에만 쓴다. 화면에 내려보내는 값은 레지스트리 값이다.
 */
export const EXPECTED_ITEM_SECONDS: Readonly<Record<string, number>> = {
  T1: 420,
  T2_v7: 480,
  T3: 600,
};

/** 검사 문항 순서. 레지스트리의 assessmentOrder와 어긋나면 검사를 열지 않는다. */
export const EXPECTED_ASSESSMENT_ORDER: readonly string[] = ['T1', 'T2_v7', 'T3'];

/** 안내·문항·마무리를 더한 값이 33분인지 확인한다. */
export function totalPlannedSeconds(itemSeconds: readonly number[]): number {
  return INTRO_SECONDS + itemSeconds.reduce((s, v) => s + v, 0) + CLOSING_SECONDS;
}

export interface ItemWindow {
  questionId: string;
  /** 서버가 이 문항을 연 시각(epoch ms). 학생이 처음 문항을 받은 때이다. */
  startedAtMs: number;
  /** 문항 제한시간(초). 레지스트리 값을 그대로 쓴다. */
  durationSeconds: number;
}

/** 문항 마감 시각(epoch ms). 서버가 연 시각에만 의존한다. */
export function deadlineMs(win: ItemWindow): number {
  return win.startedAtMs + win.durationSeconds * 1000;
}

/**
 * 남은 시간(초, 소수 유지). 새로고침해도 startedAtMs가 그대로이므로 값이 초기화되지 않는다.
 * 음수는 0으로 보고하되 마감 여부는 isExpired로 따로 판정한다.
 */
export function remainingSeconds(win: ItemWindow, nowMs: number): number {
  const left = (deadlineMs(win) - nowMs) / 1000;
  return left > 0 ? left : 0;
}

/** 마감 판정. 마감 시각과 같은 순간부터 마감으로 본다. */
export function isExpired(win: ItemWindow, nowMs: number): boolean {
  return nowMs >= deadlineMs(win);
}

/**
 * 제출을 받아도 되는지 서버 시간으로 판정한다.
 * 마감 뒤 도착한 제출은 받지 않는다. 다만 짧은 네트워크 지연을 마감 초과로 잘라내면
 * 학생이 제 시간에 누른 제출이 사라지므로, 허용 오차를 명시적으로 둔다.
 */
export const SUBMIT_GRACE_MS = 3000;

export function acceptsSubmission(win: ItemWindow, nowMs: number): boolean {
  return nowMs <= deadlineMs(win) + SUBMIT_GRACE_MS;
}

/**
 * 문항 순서와 제한시간이 계획과 같은지 검산한다.
 * 어긋나면 검사를 열지 않는다. 화면에서 순서를 바꿀 수 없게 하는 것과 별개의 서버 확인이다.
 */
export function verifyItemPlan(
  items: readonly { questionId: string; durationSeconds: number }[]
): { ok: true } | { ok: false; reason: string } {
  if (items.length !== EXPECTED_ASSESSMENT_ORDER.length) {
    return { ok: false, reason: `문항 수가 ${EXPECTED_ASSESSMENT_ORDER.length}이 아님` };
  }
  for (let i = 0; i < items.length; i += 1) {
    const expectedId = EXPECTED_ASSESSMENT_ORDER[i];
    if (items[i].questionId !== expectedId) {
      return { ok: false, reason: `문항 순서 불일치: ${i + 1}번이 ${items[i].questionId}` };
    }
    const expectedSeconds = EXPECTED_ITEM_SECONDS[expectedId];
    if (items[i].durationSeconds !== expectedSeconds) {
      return {
        ok: false,
        reason: `${expectedId}의 제한시간이 ${items[i].durationSeconds}초(계획 ${expectedSeconds}초)`,
      };
    }
  }
  const total = totalPlannedSeconds(items.map((i) => i.durationSeconds));
  if (total !== TOTAL_ASSESSMENT_SECONDS) {
    return { ok: false, reason: `총 시간이 ${total}초(계획 ${TOTAL_ASSESSMENT_SECONDS}초)` };
  }
  return { ok: true };
}
