/**
 * 학생에게 보여 줄 피드백 문구의 조립·검증 — 점수와 분리한다.
 *
 * 논문 대응: 설계서 §3 운영 채점과 피드백의 분리
 *
 * 점수가 확정된 뒤에는 피드백 생성·검증이 실패해도 재채점하지 않고 점수를 바꾸지 않는다.
 * 이 모듈은 문구의 형식과 인용 표현의 원문 포함 여부만 확인한다.
 * 형식 검사를 통과한 것은 문구가 그림에 부합한다거나 내용이 정확하다는 뜻이 아니다.
 */

import type { FeedbackPresentation } from '@/lib/research/types';

/** 두 번째 시도까지 검증되지 않았을 때 쓰는 고정 안내 */
export const FEEDBACK_FALLBACK_TEXT = '표현을 선생님과 함께 확인해 보세요';

/** 모델이 낸 피드백 초안. 인용은 문장에 섞지 않고 구조화된 quote 필드로 받는다. */
export interface FeedbackDraft {
  /** 목표 — 이 문항에서 무엇을 하려는지 */
  line1: string;
  /** 현재 수행 — 학생이 실제로 쓴 표현에 근거한 장점 또는 현재 상태 */
  line2: string;
  /** 다음 행동 — 필요한 수정 단서 하나. 없으면 중립적 확인 */
  line3: string;
  /** 활용 가능한 표현 제안. 고칠 것이 없으면 자기 점검 안내 */
  line4: string;
  /** 학생 글에 그대로 있는 표현. 인용할 것이 없으면 null(인용 없는 중립 안내). */
  quote: string | null;
}

/** 화면에 보여 줄 줄 수. 아동의 처리 부담을 고려한 설계 선택이다. */
export const FEEDBACK_LINE_COUNT = 4;

export type FeedbackRejectReason =
  | 'empty_line' // 네 줄 가운데 빈 줄이 있음
  | 'quote_not_found'; // quote가 학생 원문에 없음

export type FeedbackValidation =
  | { ok: true; text: string; quote: string | null }
  | { ok: false; reason: FeedbackRejectReason };

/** 줄머리 기호와 여분 공백을 정리한다. 문구 내용은 바꾸지 않는다. */
function normalizeLine(line: string): string {
  return line
    .replace(/\r/g, '')
    .replace(/^[\s*#\-•]+/, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 인용 확인용 정규화. 앞뒤 따옴표와 여분 공백만 걷어낸다. */
function normalizeQuote(quote: string): string {
  return quote
    .replace(/^[\s'"‘’“”]+/, '')
    .replace(/[\s'"‘’“”]+$/, '')
    .trim();
}

/**
 * 인용 표현이 학생 원문에 실제로 있는지 코드가 확인한다.
 * 한 글자 표현도 허용한다. 공백만 다른 경우는 같은 표현으로 본다.
 */
export function quoteAppearsInText(studentText: string, quote: string): boolean {
  const q = normalizeQuote(quote);
  if (!q.length) return false;
  if (studentText.includes(q)) return true;
  const strip = (s: string) => s.replace(/\s+/g, '');
  return strip(studentText).includes(strip(q));
}

/**
 * 초안을 검증한다.
 * quote가 null인 것은 실패가 아니라 인용 없는 중립 안내다.
 * quote가 있는데 원문에 없으면 인용 실패로 구분해 돌려준다.
 */
export function validateFeedback(draft: FeedbackDraft, studentText: string): FeedbackValidation {
  const lines = [draft.line1, draft.line2, draft.line3, draft.line4].map((l) =>
    normalizeLine(l ?? ''),
  );
  if (lines.some((l) => !l.length)) return { ok: false, reason: 'empty_line' };
  const text = lines.join('\n');

  if (draft.quote === null || draft.quote === undefined) {
    return { ok: true, text, quote: null };
  }
  if (!quoteAppearsInText(studentText, draft.quote)) {
    return { ok: false, reason: 'quote_not_found' };
  }
  return { ok: true, text, quote: normalizeQuote(draft.quote) };
}

/** 피드백을 요청하지 않은 경우(예: 검사 수집)의 표시 */
export function feedbackNotRequested(): FeedbackPresentation {
  return { status: 'not_requested', text: '', quote: null, regenerated: false };
}

/**
 * 피드백 초안을 받아 검증하고, 실패하면 피드백만 1회 재생성한다.
 * 재생성해도 검증되지 않으면 고정 안내를 쓰고 status를 fallback으로 남긴다.
 * 점수는 이 함수의 결과와 무관하게 이미 확정된 값을 그대로 둔다.
 */
export async function produceFeedback(params: {
  studentText: string;
  /** attempt 0이 최초 생성, 1이 재생성. 예외를 던지면 실패로 본다. */
  generate: (attempt: number) => Promise<FeedbackDraft>;
}): Promise<FeedbackPresentation> {
  const { studentText, generate } = params;

  for (let attempt = 0; attempt <= 1; attempt++) {
    let draft: FeedbackDraft | null = null;
    try {
      draft = await generate(attempt);
    } catch {
      draft = null;
    }
    if (draft) {
      const v = validateFeedback(draft, studentText);
      if (v.ok) {
        return {
          status: 'verified',
          text: v.text,
          quote: v.quote,
          regenerated: attempt > 0,
        };
      }
    }
  }

  return {
    status: 'fallback',
    text: FEEDBACK_FALLBACK_TEXT,
    quote: null,
    regenerated: true,
  };
}
