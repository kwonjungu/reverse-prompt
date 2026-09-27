/**
 * 학생 원문 인용 확인 — 채점 근거(evidence)와 피드백 인용(quote)이 함께 쓴다.
 * 모델이 "원문 그대로"라고 낸 표현이 실제로 학생 글에 있는지 코드가 확인한다.
 */

/** 앞뒤 따옴표와 여분 공백만 걷어낸다. 내용은 바꾸지 않는다. */
export function normalizeQuote(quote: string): string {
  return quote
    .replace(/^[\s'"‘’“”]+/, '')
    .replace(/[\s'"‘’“”]+$/, '')
    .trim();
}

const stripSpaces = (s: string) => s.replace(/\s+/g, '');

/**
 * 인용 표현이 원문에 있는가. 한 글자 표현도 허용한다. 공백만 다른 경우는 같은 표현으로 본다.
 */
export function quoteAppearsInText(text: string, quote: string): boolean {
  const q = normalizeQuote(quote);
  if (!q.length) return false;
  if (text.includes(q)) return true;
  return stripSpaces(text).includes(stripSpaces(q));
}
