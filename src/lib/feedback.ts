/**
 * 학생에게 보여 줄 피드백의 조립·검증 — 점수와 분리한다(공통 루브릭 v12-2).
 *
 * 네 문장, 한 줄에 한 문장.
 *   1문장 이번 목표(단계 초점)
 *   2문장 잘 쓴 점 — 어느 영역인지 밝히고 학생 글의 표현을 그대로 넣는다
 *   3문장 다음 행동 한 가지 — 가장 낮은 영역(같으면 단계 초점 영역)에서 하나만
 *   4문장 쓸 수 있는 표현 제안 또는 스스로 확인할 질문
 * 네 문장과 제안 수는 아동의 처리 부담을 고려한 설계 선택이며 효과가 검증된 최적값이 아니다.
 *
 * 코드가 확인하는 것(형식)
 *   - 네 줄이 모두 있고 줄마다 한 문장이다. 넘으면 탈락시키고 피드백만 1회 다시 만든다.
 *   - 2문장의 인용(quote)이 학생 글에 그대로 있고 2문장 안에 들어 있다. 인용 끝의 마침표는 떼고 본다.
 *   - 2문장의 영역(strengthArea)은 판정한 영역이다. 3문장의 영역(nextArea)은 코드가 정한 영역과 같다.
 *   - 3문장이 겨냥한 정보(nextTarget)는 그 영역의 빠진 필수 정보 목록(missing)에 있는 것이다.
 *     비공개 단서 팩이 있으면(연구 세션) 그 항목이 단서 팩의 그 영역 필수 정보(또는 허용 표현)와도
 *     같아야 한다 — 모델이 missing에 지어낸 정보를 3문장이 요구하지 못하게 한다.
 *     단서 팩이 없으면(일반 체험) 모델이 낸 missing 목록 안인지만 본다(구조 점검).
 *   - 칭찬·비교·점수 언급이 없다. 2문장의 학생 인용 부분은 학생 글이므로 이 점검과 문장 수 세기에서 뺀다.
 * 코드가 확인하지 않는 것
 *   - 문장의 뜻. 3문장이 nextTarget을 실제로 요구하는지, 4문장(표현 제안·확인 질문)이 그림에 있는
 *     정보만 다루는지는 검사하지 않는다. 지시문으로만 요구한다.
 * 다시 만들어도 통과하지 못하면 고정 안내를 쓰고 status='fallback'으로 남긴다. 점수는 그대로다.
 * 형식 검사를 통과한 것이 그림 부합이나 내용 정확성을 뜻하지 않는다.
 */

import type { FeedbackPresentation } from '@/lib/research/types';
import { normalizeQuote, quoteAppearsInText } from '@/lib/quote';
import {
  AREA_IDS,
  AREA_LABEL,
  isAreaId,
  NOT_APPLICABLE,
  type AreaId,
  type AreaLevels,
} from '@/lib/scoring';

export { quoteAppearsInText };

/** 두 번째 시도까지 검증되지 않았을 때 쓰는 고정 안내 */
export const FEEDBACK_FALLBACK_TEXT = '표현을 선생님과 함께 확인해 보세요';

/**
 * 모든 AI 피드백 화면에 늘 붙이는 고정 안내(설계 원리 5). 피드백을 그대로 받아들이지 않고
 * 그림과 견주어 보게 한다. 모델이 만든 문장이 아니라 화면이 붙이는 문장이다.
 */
export const FEEDBACK_CAUTION = '피드백이 틀릴 수 있어요. 그림과 견주어 보고, 이상하면 선생님께 물어봐요.';

/** 화면에 보여 줄 문장 수. 한 줄에 한 문장이다. */
export const FEEDBACK_LINE_COUNT = 4;

/** 모델이 낸 피드백 초안. 영역과 인용은 문장에 섞지 않고 구조화된 필드로 받는다. */
export interface FeedbackDraft {
  line1: string;
  line2: string;
  line3: string;
  line4: string;
  /** 2문장에 넣은 학생 글의 표현. 인용할 표현이 없으면 null. */
  quote: string | null;
  /** 2문장이 다룬 영역 */
  strengthArea: AreaId | null;
  /** 3문장이 다룬 영역. 고칠 것이 없으면 null. */
  nextArea: AreaId | null;
  /** 3문장이 겨냥한 빠진 정보(그 영역 missing 목록의 문구 그대로). 없으면 null. */
  nextTarget: string | null;
}

/** 검증에 필요한 확정 채점 정보. 점수가 확정된 뒤의 값만 쓴다. */
export interface FeedbackContext {
  studentText: string;
  levels: AreaLevels;
  missing: Record<AreaId, string[]>;
  /** 코드가 정한 다음 행동 영역(nextActionArea). null이면 고칠 것이 없다. */
  requiredNextArea: AreaId | null;
  /**
   * 비공개 단서 팩이 정한 영역별 필수 정보(허용 표현 포함). 있으면 nextTarget이 이 목록과도 같아야 한다.
   * 단서 팩이 없으면(일반 체험) null — missing 목록 안인지만 본다. 서버 안에서만 쓰고 화면에 보내지 않는다.
   */
  cueTargets?: Record<AreaId, string[]> | null;
}

export type FeedbackRejectReason =
  | 'empty_line'
  | 'line_count'
  | 'sentence_count'
  | 'line_too_long'
  | 'forbidden_expression'
  | 'quote_required'
  | 'quote_not_found'
  | 'quote_not_in_line2'
  | 'strength_area'
  | 'next_area'
  | 'next_target'
  | 'next_target_unverified';

export type FeedbackValidation =
  | {
      ok: true;
      text: string;
      quote: string | null;
      strengthArea: AreaId | null;
      nextArea: AreaId | null;
      nextTarget: string | null;
    }
  | { ok: false; reason: FeedbackRejectReason };

/** 줄머리 기호·영역 표시·여분 공백을 정리한다. 문장 내용은 바꾸지 않는다. */
function normalizeLine(line: string): string {
  return line
    .replace(/\r/g, '')
    .replace(/^[\s*#\-•]+/, '')
    .replace(/^\[[^\]]{1,6}\]\s*/, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function hasLineBreak(line: string): boolean {
  return /\n/.test((line ?? '').replace(/\r/g, ''));
}

/**
 * 한 문장의 최대 글자 수(공백 포함, 2문장의 학생 인용 자리는 가린 뒤에 센다).
 * 초등학생이 읽기 쉬운 짧은 문장을 지키려는 구조 점검이다(논문 v12-2 C4). 넉넉하게 잡은 설계 선택이며
 * 읽기 쉬움을 검증한 값이 아니다. 넘으면 탈락하고 피드백만 1회 다시 만든다.
 */
export const MAX_FEEDBACK_LINE_CHARS = 80;

/** 한 줄에 든 문장 수. 마침표·물음표·느낌표 뒤에 공백이 오면 문장이 나뉜 것으로 본다. */
export function sentenceCount(line: string): number {
  return line
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * 넣지 않는 표현: 칭찬, 다른 사람과의 비교, 점수·수준 언급.
 * 비교는 실제로 견주는 말만 막는다. 1문장 목표("그림을 못 본 (다른) 친구가 똑같이 떠올릴 수 있게")는
 * 친구를 말하지만 비교가 아니므로 걸리지 않는다.
 */
const FORBIDDEN: readonly RegExp[] = [
  /훌륭|멋지|멋져|멋있|대단|최고|완벽|짱|잘했|잘 했|칭찬/,
  /친구(?:들)?\s*보다|친구(?:들)?(?:와|과|하고|랑)\s*(?:비교|견주)|남들\s*보다|누구\s*보다|보다 더 잘/,
  /점수|\d+\s*점|만점|수준|등급|레벨|[●○]/,
];

export function hasForbiddenExpression(line: string): boolean {
  return FORBIDDEN.some((re) => re.test(line));
}

const squash = (s: string) => normalizeQuote(s).replace(/\s+/g, '');

/** 빠진 정보·단서 항목을 같은 것으로 볼 때의 비교 키(앞뒤 따옴표·공백 차이만 무시한다). */
export const targetKey = squash;

/** 문장 끝 부호. 인용 끝에 붙어 와도 인용의 일부로 보지 않는다. */
const END_PUNCT = /[.!?。…~]+$/;

/**
 * 인용을 정리한다. 앞뒤 따옴표·공백과 끝의 마침표를 걷어 낸다(학생이 한 문장을 통째로 쓴 경우가 흔하다).
 * 남는 것이 없으면 null.
 */
function cleanQuote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = normalizeQuote(normalizeQuote(raw).replace(END_PUNCT, ''));
  return q.length ? q : null;
}

const escapeRe = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 2문장에서 인용이 차지하는 자리를 가릴 때 넣는 말. 문장 부호·금지어가 없다. */
const QUOTE_MASK = '학생 표현';

/**
 * 2문장 안의 인용 자리를 찾아 QUOTE_MASK로 바꾼다. 공백만 다른 경우도 찾고, 인용 바로 뒤의 문장 끝 부호도
 * 함께 가린다(예: "…있어요. 라고 썼어요"). 인용이 없으면 null.
 * 학생 글의 표현이 칭찬·비교 금지어나 문장 부호를 품어도 피드백 문장이 탈락하지 않게 하려는 것이다.
 */
function maskQuoteInLine(line: string, quote: string): string | null {
  const chars = [...quote.replace(/\s+/g, '')].map(escapeRe);
  if (!chars.length) return null;
  const re = new RegExp(`${chars.join('\\s*')}[.!?。…~]*`);
  const m = re.exec(line);
  if (!m) return null;
  return line.slice(0, m.index) + QUOTE_MASK + line.slice(m.index + m[0].length);
}

/** 판정한 영역(해당 없음이 아닌 영역)인가 */
function isJudged(levels: AreaLevels, area: AreaId): boolean {
  return levels[area] !== NOT_APPLICABLE;
}

/**
 * 초안을 검증한다. 통과하면 화면에 보일 네 줄을 돌려준다.
 * 2·3문장 앞에는 코드가 영역 이름을 붙인다(예: "[대상] …"). 모델이 붙인 표시는 떼고 다시 붙인다.
 */
export function validateFeedback(draft: FeedbackDraft, ctx: FeedbackContext): FeedbackValidation {
  const raw = [draft.line1, draft.line2, draft.line3, draft.line4];
  if (raw.some(hasLineBreak)) return { ok: false, reason: 'line_count' };
  const lines = raw.map((l) => normalizeLine(l ?? ''));
  if (lines.some((l) => !l.length)) return { ok: false, reason: 'empty_line' };

  // 2문장의 학생 인용 자리는 학생 글이다. 문장 수·금지어는 그 자리를 가린 문장으로 센다.
  const quote = cleanQuote(draft.quote);
  const maskedLine2 = quote !== null ? maskQuoteInLine(lines[1], quote) : null;
  const checked = [lines[0], maskedLine2 ?? lines[1], lines[2], lines[3]];
  if (checked.some((l) => sentenceCount(l) !== 1)) return { ok: false, reason: 'sentence_count' };
  if (checked.some((l) => [...l].length > MAX_FEEDBACK_LINE_CHARS)) return { ok: false, reason: 'line_too_long' };
  if (checked.some(hasForbiddenExpression)) return { ok: false, reason: 'forbidden_expression' };

  // 2문장 — 영역과 인용
  const strengthArea = draft.strengthArea;
  if (strengthArea !== null && (!isAreaId(strengthArea) || !isJudged(ctx.levels, strengthArea))) {
    return { ok: false, reason: 'strength_area' };
  }
  // 판정한 영역이 모두 1수준이면 인용할 잘 쓴 표현이 없을 수 있다. 그 밖에는 인용이 있어야 한다.
  const anyAboveOne = AREA_IDS.some((a) => {
    const v = ctx.levels[a];
    return typeof v === 'number' && v > 1;
  });
  if (quote === null) {
    if (anyAboveOne) return { ok: false, reason: 'quote_required' };
  } else {
    if (!quoteAppearsInText(ctx.studentText, quote)) return { ok: false, reason: 'quote_not_found' };
    if (maskedLine2 === null) return { ok: false, reason: 'quote_not_in_line2' };
    if (strengthArea === null) return { ok: false, reason: 'strength_area' };
  }

  // 3문장 — 코드가 정한 영역, 그 영역의 빠진 정보
  if ((draft.nextArea ?? null) !== ctx.requiredNextArea) return { ok: false, reason: 'next_area' };
  // 겨냥한 정보는 그 영역의 빠진 필수 정보 목록 안에서만 고른다. 목록이 비었거나 고칠 것이 없으면
  // nextTarget은 null이어야 한다(목록 밖의 정보, 곧 그림에 없는 정보를 요구하지 않게 하는 구조 점검).
  const draftTarget =
    typeof draft.nextTarget === 'string' && squash(draft.nextTarget).length ? squash(draft.nextTarget) : null;
  let nextTarget: string | null = null;
  const list = ctx.requiredNextArea !== null ? ctx.missing[ctx.requiredNextArea] ?? [] : [];
  if (list.length) {
    const hit = draftTarget === null ? undefined : list.find((m) => squash(m) === draftTarget);
    if (!hit) return { ok: false, reason: 'next_target' };
    // 단서 팩이 있으면 모델이 낸 missing 항목도 믿지 않는다. 단서 팩의 그 영역 필수 정보(허용 표현 포함)와
    // 같아야 그림에 있는 정보로 본다.
    if (ctx.cueTargets && ctx.requiredNextArea !== null) {
      const verified = (ctx.cueTargets[ctx.requiredNextArea] ?? []).some((c) => squash(c) === squash(hit));
      if (!verified) return { ok: false, reason: 'next_target_unverified' };
    }
    nextTarget = hit;
  } else if (draftTarget !== null) {
    return { ok: false, reason: 'next_target' };
  }

  const text = [
    lines[0],
    strengthArea ? `[${AREA_LABEL[strengthArea]}] ${lines[1]}` : lines[1],
    ctx.requiredNextArea ? `[${AREA_LABEL[ctx.requiredNextArea]}] ${lines[2]}` : lines[2],
    lines[3],
  ].join('\n');
  return { ok: true, text, quote, strengthArea, nextArea: ctx.requiredNextArea, nextTarget };
}

/** 모델 원 출력에서 피드백 초안만 뽑는다. 네 줄이 모두 비어 있으면 null. */
export function extractFeedbackDraft(raw: unknown): FeedbackDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const line1 = str(r.feedbackLine1);
  const line2 = str(r.feedbackLine2);
  const line3 = str(r.feedbackLine3);
  const line4 = str(r.feedbackLine4);
  if (!line1 && !line2 && !line3 && !line4) return null;
  const area = (v: unknown): AreaId | null => (isAreaId(v) ? v : null);
  return {
    line1,
    line2,
    line3,
    line4,
    quote: typeof r.quote === 'string' ? r.quote : null,
    strengthArea: area(r.strengthArea),
    nextArea: area(r.nextArea),
    nextTarget: typeof r.nextTarget === 'string' ? r.nextTarget : null,
  };
}

/** 피드백을 요청하지 않은 경우(예: 검사 채점)의 표시 */
export function feedbackNotRequested(): FeedbackPresentation {
  return {
    status: 'not_requested',
    text: '',
    quote: null,
    regenerated: false,
    strengthArea: null,
    nextArea: null,
    nextTarget: null,
    rejections: [],
  };
}

/**
 * 피드백 초안을 받아 검증하고, 실패하면 피드백만 1회 다시 만든다.
 * 다시 만들어도 통과하지 못하면 고정 안내를 쓰고 status를 fallback으로 남긴다.
 * 점수는 이 함수의 결과와 무관하게 이미 확정된 값을 그대로 둔다.
 */
export async function produceFeedback(params: {
  context: FeedbackContext;
  /** attempt 0이 최초 초안, 1이 재생성. 예외를 던지면 실패로 본다. */
  generate: (attempt: number) => Promise<FeedbackDraft | null>;
}): Promise<FeedbackPresentation> {
  const rejections: string[] = [];
  for (let attempt = 0; attempt <= 1; attempt++) {
    let draft: FeedbackDraft | null = null;
    try {
      draft = await params.generate(attempt);
    } catch {
      draft = null;
    }
    if (!draft) {
      rejections.push('no_draft');
      continue;
    }
    const v = validateFeedback(draft, params.context);
    if (v.ok) {
      return {
        status: 'verified',
        text: v.text,
        quote: v.quote,
        regenerated: attempt > 0,
        strengthArea: v.strengthArea,
        nextArea: v.nextArea,
        nextTarget: v.nextTarget,
        rejections,
      };
    }
    rejections.push(v.reason);
  }
  return {
    status: 'fallback',
    text: FEEDBACK_FALLBACK_TEXT,
    quote: null,
    regenerated: true,
    strengthArea: null,
    nextArea: null,
    nextTarget: null,
    rejections,
  };
}
