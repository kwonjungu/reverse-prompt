/**
 * 피드백 분리 테스트 (수용시험 5)
 *
 * 실제 모델을 호출하지 않는다. 초안은 모두 합성 값이다.
 * 여기서 확인하는 것은 문구의 형식과 인용 표현의 원문 포함 여부뿐이다.
 * 형식 검사를 통과한 것이 그림 부합이나 내용 정확성을 뜻하지는 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEEDBACK_FALLBACK_TEXT,
  FEEDBACK_LINE_COUNT,
  produceFeedback,
  quoteAppearsInText,
  validateFeedback,
  type FeedbackDraft,
} from '@/lib/feedback';
import { FEEDBACK_GUIDE } from '@/lib/evaluation-prompt';

const STUDENT = '노란 세모 블록의 밑면이 넓고 위쪽 꼭짓점이 뾰족하다';

test('수용시험 5 — 지시문이 모든 응답에 누락 지적과 낱말 두 개를 강제하지 않는다', () => {
  assert.ok(!FEEDBACK_GUIDE.includes('낱말 두 개'));
  assert.ok(!FEEDBACK_GUIDE.includes('빠뜨린 것 하나만'));
  // 필요한 단서가 다 들어 있으면 억지 지적 대신 자기 점검을 안내하도록 되어 있어야 한다.
  assert.ok(FEEDBACK_GUIDE.includes('억지로 지적을 만들지 말고'));
});

test('수용시험 5 — 모든 단서가 충족된 문장에 억지 누락 지적을 요구하지 않는다', async () => {
  const draft: FeedbackDraft = {
    line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
    line2: '노란 세모 블록의 꼭짓점과 밑면까지 빠짐없이 썼어요',
    line3: '더 보태야 할 것은 없어요',
    line4: '쓴 글을 다시 읽으며 그림과 맞는지 확인해 보세요',
    quote: '위쪽 꼭짓점',
  };
  const fb = await produceFeedback({ studentText: STUDENT, generate: async () => draft });
  assert.equal(fb.status, 'verified');
  assert.equal(fb.regenerated, false);
  assert.equal(fb.quote, '위쪽 꼭짓점');
  assert.equal(fb.text.split('\n').length, 4);
});

test('인용이 없는 중립 안내는 인용 실패가 아니다', async () => {
  const draft: FeedbackDraft = {
    line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
    line2: '지금은 그림에서 본 것을 적기 시작한 상태예요',
    line3: '무엇이 있는지 이름부터 한 가지 적어 보세요',
    line4: '이름을 적을 때 눈에 보이는 색도 함께 써 볼 수 있어요',
    quote: null,
  };
  const v = validateFeedback(draft, STUDENT);
  assert.equal(v.ok, true);

  const fb = await produceFeedback({ studentText: STUDENT, generate: async () => draft });
  assert.equal(fb.status, 'verified');
  assert.equal(fb.quote, null);
});

test('인용 표현은 코드가 원문 포함 여부를 확인한다 — 한 글자도 허용', () => {
  assert.equal(quoteAppearsInText(STUDENT, '넓'), true);
  assert.equal(quoteAppearsInText(STUDENT, '노란 세모 블록'), true);
  assert.equal(quoteAppearsInText(STUDENT, '‘노란’'), true);
  assert.equal(quoteAppearsInText(STUDENT, '분홍 리본'), false);
  assert.equal(quoteAppearsInText(STUDENT, ''), false);
});

test('인용 검증 실패는 중립 안내와 다른 사유로 구분된다', () => {
  const v = validateFeedback(
    {
      line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '잘 썼어요',
      line3: '분홍 리본도 써 보세요',
      line4: '리본이라는 낱말을 써 볼 수 있어요',
      quote: '분홍 리본',
    },
    STUDENT,
  );
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'quote_not_found');
});

test('수용시험 5 — 인용 실패 시 피드백만 1회 재생성하고 성공하면 verified', async () => {
  const drafts: FeedbackDraft[] = [
    {
      line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '좋아요',
      line3: '없는 표현을 인용함',
      line4: '표현을 하나 더 써 보세요',
      quote: '분홍 리본',
    },
    {
      line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '노란 세모 블록을 정확히 적었어요',
      line3: '옆면의 홈도 한 가지 더 적어 보세요',
      line4: '파인, 홈 같은 낱말을 써 볼 수 있어요',
      quote: '밑면',
    },
  ];
  let attempts = 0;
  const fb = await produceFeedback({
    studentText: STUDENT,
    generate: async (attempt) => {
      attempts++;
      return drafts[attempt];
    },
  });
  assert.equal(attempts, 2);
  assert.equal(fb.status, 'verified');
  assert.equal(fb.regenerated, true);
  assert.equal(fb.quote, '밑면');
});

test('수용시험 5 — 재생성도 실패하면 고정 안내를 쓰고 fallback으로 남는다', async () => {
  let attempts = 0;
  const fb = await produceFeedback({
    studentText: STUDENT,
    generate: async () => {
      attempts++;
      return {
        line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
        line2: '좋아요',
        line3: '없는 표현',
        line4: '표현을 하나 더 써 보세요',
        quote: '분홍 리본',
      };
    },
  });
  assert.equal(attempts, 2, '피드백 재생성은 1회만 한다');
  assert.equal(fb.status, 'fallback');
  assert.equal(fb.text, FEEDBACK_FALLBACK_TEXT);
  assert.equal(fb.quote, null);
});

test('생성이 예외를 던져도 재생성 1회 뒤 고정 안내로 끝난다', async () => {
  let attempts = 0;
  const fb = await produceFeedback({
    studentText: STUDENT,
    generate: async () => {
      attempts++;
      throw new Error('생성 실패');
    },
  });
  assert.equal(attempts, 2);
  assert.equal(fb.status, 'fallback');
});

test('네 줄 가운데 빈 줄이 있으면 형식 오류다', () => {
  const v = validateFeedback(
    { line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요', line2: '좋아요', line3: '   ', line4: '표현을 써 보세요', quote: null },
    STUDENT,
  );
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'empty_line');
});

test('한 필드에 여러 줄을 몰아넣으면 네 줄을 넘기므로 형식 오류다', () => {
  const v = validateFeedback(
    {
      line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '좋아요\n그리고 색도 잘 썼어요',
      line3: '옆면의 홈도 적어 보세요',
      line4: '홈이라는 낱말을 써 볼 수 있어요',
      quote: null,
    },
    STUDENT,
  );
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'line_count');
});

test('검증을 통과한 문구는 언제나 정확히 네 줄이다', () => {
  const v = validateFeedback(
    {
      line1: '- 이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '* 노란 세모 블록을 정확히 적었어요',
      line3: '   옆면의 홈도  한 가지 적어 보세요  ',
      line4: '# 홈이라는 낱말을 써 볼 수 있어요',
      quote: '밑면',
    },
    STUDENT,
  );
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(v.text.split('\n').length, FEEDBACK_LINE_COUNT);
  // 줄머리 기호와 여분 공백만 걷어내고 내용은 바꾸지 않는다.
  assert.ok(!v.text.includes('- 이번'));
  assert.ok(v.text.includes('옆면의 홈도 한 가지 적어 보세요'));
});

test('형식 통과가 그림 부합이나 내용 정확성을 뜻하지 않는다', () => {
  // 그림과 아무 관계 없는 네 줄도 형식 검사는 통과한다. 이 검사는 형식만 본다.
  const v = validateFeedback(
    {
      line1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
      line2: '노란 세모 블록이라고 적었어요',
      line3: '하늘의 색도 적어 보세요',
      line4: '파랗다는 낱말을 써 볼 수 있어요',
      quote: '노란 세모 블록',
    },
    STUDENT,
  );
  assert.equal(v.ok, true, '형식만 보는 검사이므로 통과한다(부합 보장 아님)');
});
