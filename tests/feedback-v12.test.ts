/**
 * 네 문장 피드백 검증 테스트(공통 루브릭 v12-2) — src/lib/feedback.ts
 *
 * 모델 초안은 모두 손으로 만든 가짜다. 실제 모델을 호출하지 않는다.
 * 형식 검사를 통과한 것이 그림 부합이나 내용 정확성을 뜻하지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEEDBACK_FALLBACK_TEXT,
  FEEDBACK_LINE_COUNT,
  extractFeedbackDraft,
  feedbackNotRequested,
  hasForbiddenExpression,
  produceFeedback,
  sentenceCount,
  validateFeedback,
  type FeedbackContext,
  type FeedbackDraft,
} from '@/lib/feedback';
import { NOT_APPLICABLE, nextActionArea, type AreaLevels } from '@/lib/scoring';

const NA = NOT_APPLICABLE;

/* ────────────────────────── 도우미 ────────────────────────── */

const STUDENT = '빨간 사과 한 개가 둥근 접시 위에 있다';

function context(over: Partial<FeedbackContext> = {}): FeedbackContext {
  const levels: AreaLevels = over.levels ?? { object: 4, feature: 2, relation: 3 };
  return {
    studentText: STUDENT,
    levels,
    missing: { object: [], feature: ['사과 꼭지의 색'], relation: ['접시가 놓인 곳'] },
    requiredNextArea: nextActionArea(levels, null),
    ...over,
  };
}

function draft(over: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    line1: '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.',
    line2: '대상 영역에서 빨간 사과 한 개라고 무엇이 몇 개인지 분명하게 썼어요.',
    line3: '사과 꼭지의 색도 함께 써 보세요.',
    line4: '꼭지가 어떤 색인지 그림에서 다시 살펴볼까요?',
    quote: '빨간 사과 한 개',
    strengthArea: 'object',
    nextArea: 'feature',
    nextTarget: '사과 꼭지의 색',
    ...over,
  };
}

function rejected(d: FeedbackDraft, ctx: FeedbackContext, reason: string) {
  const v = validateFeedback(d, ctx);
  assert.equal(v.ok, false, `탈락해야 한다(${reason})`);
  if (!v.ok) assert.equal(v.reason, reason);
}

/* ────────────────────────── 통과·표시 ────────────────────────── */

test('통과한 피드백은 네 줄이고 2·3문장 앞에 코드가 영역 이름을 붙인다', () => {
  const v = validateFeedback(draft(), context());
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  const lines = v.text.split('\n');
  assert.equal(lines.length, FEEDBACK_LINE_COUNT);
  assert.equal(FEEDBACK_LINE_COUNT, 4);
  assert.equal(lines[0], '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.');
  assert.equal(lines[1], '[대상] 대상 영역에서 빨간 사과 한 개라고 무엇이 몇 개인지 분명하게 썼어요.');
  assert.equal(lines[2], '[특징] 사과 꼭지의 색도 함께 써 보세요.');
  assert.equal(lines[3], '꼭지가 어떤 색인지 그림에서 다시 살펴볼까요?');
  assert.equal(v.quote, '빨간 사과 한 개');
  assert.equal(v.strengthArea, 'object');
  assert.equal(v.nextArea, 'feature');
  assert.equal(v.nextTarget, '사과 꼭지의 색');
});

test('모델이 붙인 영역 표시·줄머리 기호는 떼고 코드가 한 번만 다시 붙인다', () => {
  const v = validateFeedback(
    draft({
      line1: '- 이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.',
      line2: '[관계] 대상 영역에서 빨간 사과 한 개라고 썼어요.',
      line3: '[특징] 사과 꼭지의 색도 써 보세요.',
    }),
    context()
  );
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  const lines = v.text.split('\n');
  assert.equal(lines[0], '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.');
  assert.equal(lines[1], '[대상] 대상 영역에서 빨간 사과 한 개라고 썼어요.', '표시는 strengthArea 기준');
  assert.equal(lines[2], '[특징] 사과 꼭지의 색도 써 보세요.');
  assert.equal((v.text.match(/\[특징\]/g) ?? []).length, 1);
});

test('영역 이름표 — 특징·관계도 맞게 붙는다', () => {
  const ctx = context({ levels: { object: 2, feature: 3, relation: 3 } });
  assert.equal(ctx.requiredNextArea, 'object');
  const v = validateFeedback(
    draft({
      line2: '관계 영역에서 둥근 접시 위에 있다고 어디에 있는지 썼어요.',
      quote: '둥근 접시 위에 있다',
      strengthArea: 'relation',
      line3: '무엇이 더 있는지 빠짐없이 써 보세요.',
      nextArea: 'object',
      nextTarget: null,
    }),
    { ...ctx, missing: { object: [], feature: [], relation: [] } }
  );
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  assert.ok(v.text.split('\n')[1].startsWith('[관계] '));
  assert.ok(v.text.split('\n')[2].startsWith('[대상] '));
});

/* ────────────────────────── 네 문장 ────────────────────────── */

test('한 줄에 두 문장이면 탈락한다(네 문장을 넘는 피드백)', () => {
  rejected(draft({ line4: '꼭지 색을 살펴볼까요? 그다음 다시 써 봐요.' }), context(), 'sentence_count');
  rejected(draft({ line1: '목표는 친구가 떠올리게 쓰는 것이에요. 이번에는 특징이에요.' }), context(), 'sentence_count');
  rejected(draft({ line3: '꼭지 색을 써 보세요! 모양도 써 보세요.' }), context(), 'sentence_count');
});

test('한 필드 안의 줄바꿈(다섯 번째 줄)은 탈락한다', () => {
  rejected(draft({ line4: '꼭지 색을 살펴볼까요?\n다시 써 봐요.' }), context(), 'line_count');
  rejected(draft({ line2: '대상 영역에서 빨간 사과 한 개라고 썼어요.\r\n좋아요' }), context(), 'line_count');
});

test('빈 줄이 있으면 탈락한다', () => {
  for (const key of ['line1', 'line2', 'line3', 'line4'] as const) {
    rejected(draft({ [key]: '   ' }), context(), 'empty_line');
    rejected(draft({ [key]: '- ' }), context(), 'empty_line');
  }
});

test('sentenceCount — 마침표·물음표·느낌표 뒤 공백에서 문장을 나눈다', () => {
  assert.equal(sentenceCount('사과가 있어요.'), 1);
  assert.equal(sentenceCount('사과가 있어요'), 1);
  assert.equal(sentenceCount('사과가 있어요. 접시도 있어요.'), 2);
  assert.equal(sentenceCount('사과가 있나요? 접시는요! 좋아요.'), 3);
  assert.equal(sentenceCount('1.5배 큰 사과예요.'), 1);
});

/* ────────────────────────── 금지 표현 ────────────────────────── */

test('칭찬·비교·점수 언급은 탈락한다', () => {
  const bad = [
    '정말 잘했어요 빨간 사과 한 개라고 썼어요.',
    '빨간 사과 한 개라고 쓴 것이 훌륭해요.',
    '빨간 사과 한 개라고 쓴 것이 최고예요.',
    '빨간 사과 한 개라고 완벽하게 썼어요.',
    '빨간 사과 한 개라고 다른 친구보다 분명하게 썼어요.',
    '빨간 사과 한 개라고 친구들보다 분명하게 썼어요.',
    '빨간 사과 한 개라고 써서 3점을 받았어요.',
    '빨간 사과 한 개라고 써서 점수가 올랐어요.',
    '빨간 사과 한 개라고 써서 수준이 높아요.',
    '빨간 사과 한 개라고 써서 ●●●○예요.',
  ];
  for (const line2 of bad) {
    assert.ok(hasForbiddenExpression(line2), line2);
    rejected(draft({ line2 }), context(), 'forbidden_expression');
  }
  rejected(draft({ line4: '다음에는 만점을 받을 수 있어요.' }), context(), 'forbidden_expression');
  rejected(draft({ line1: '이번 목표는 등급을 올리는 것이에요.' }), context(), 'forbidden_expression');
});

test('금지 표현 목록은 평범한 안내 문장을 막지 않는다', () => {
  for (const ok of [
    '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.',
    '사과 꼭지의 색도 함께 써 보세요.',
    '무엇이 몇 개 있는지 빠짐없이 썼나요?',
    '대상 영역에서 빨간 사과 한 개라고 분명하게 썼어요.',
  ]) {
    assert.equal(hasForbiddenExpression(ok), false, ok);
  }
});

test('비교 금지는 실제로 견주는 말만 막는다 — 1문장 목표의 "다른 친구"는 통과한다', () => {
  const v = validateFeedback(
    draft({ line1: '그림을 못 본 다른 친구도 똑같이 떠올릴 수 있게 쓰는 것이 목표예요.' }),
    context()
  );
  assert.ok(v.ok, JSON.stringify(v));
  for (const line of [
    '빨간 사과 한 개라고 다른 친구보다 분명하게 썼어요.',
    '빨간 사과 한 개라고 친구보다 자세하게 썼어요.',
    '다른 친구와 비교하면 더 분명해요.',
    '친구들하고 견주어도 분명해요.',
    '남들보다 자세해요.',
    '누구보다 분명해요.',
  ]) {
    assert.ok(hasForbiddenExpression(line), line);
  }
});

test('2문장의 학생 인용은 학생 글이다 — 인용 안의 금지어·마침표로 탈락하지 않는다', () => {
  // 학생이 문장을 통째로 쓰는 경우(A밴드에서 흔하다). 인용 끝의 마침표는 떼고 본다.
  const studentText = '빨간 사과 한 개가 있어요. 접시 위에 있어요.';
  const ctx = context({ studentText });
  const quote = '빨간 사과 한 개가 있어요.';
  const noPeriod = validateFeedback(
    draft({ quote, line2: '대상 영역에서 빨간 사과 한 개가 있어요라고 써서 무엇이 있는지 알 수 있어요.' }),
    ctx
  );
  assert.ok(noPeriod.ok, JSON.stringify(noPeriod));
  if (noPeriod.ok) assert.equal(noPeriod.quote, '빨간 사과 한 개가 있어요', '저장하는 인용에도 끝 마침표가 없다');
  const withPeriod = validateFeedback(
    draft({ quote, line2: '대상 영역에서 빨간 사과 한 개가 있어요. 라고 써서 무엇이 있는지 알 수 있어요.' }),
    ctx
  );
  assert.ok(withPeriod.ok, JSON.stringify(withPeriod));
  if (withPeriod.ok) {
    // 화면 문장은 모델이 쓴 그대로다(가림은 검사에만 쓴다).
    assert.ok(withPeriod.text.split('\n')[1].includes('있어요. 라고'));
  }
  // 인용 밖에서 문장이 나뉘면 여전히 두 문장이다.
  rejected(
    draft({ quote, line2: '대상 영역에서 빨간 사과 한 개가 있어요라고 썼어요. 접시도 보여요.' }),
    ctx,
    'sentence_count'
  );

  // 학생 표현 안의 '완벽'·'최고'는 칭찬이 아니다.
  const praiseLike = '완벽한 동그라미 접시 위에 최고로 큰 사과가 있다';
  const pctx = context({ studentText: praiseLike });
  const v = validateFeedback(
    draft({ quote: '완벽한 동그라미', line2: '특징 영역에서 완벽한 동그라미라고 접시 모양을 썼어요.', strengthArea: 'feature' }),
    pctx
  );
  assert.ok(v.ok, JSON.stringify(v));
  // 인용 밖의 칭찬은 그대로 막는다.
  rejected(
    draft({ quote: '완벽한 동그라미', line2: '특징 영역에서 완벽한 동그라미라고 훌륭하게 썼어요.', strengthArea: 'feature' }),
    pctx,
    'forbidden_expression'
  );
  // 학생 글에 없는 '인용'으로 금지어를 가릴 수 없다.
  rejected(
    draft({ quote: '정말 최고인 사과', line2: '대상 영역에서 정말 최고인 사과라고 썼어요.' }),
    pctx,
    'quote_not_found'
  );
});

/* ────────────────────────── 2문장 — 인용과 영역 ────────────────────────── */

test('인용은 학생 글에 그대로 있어야 한다', () => {
  rejected(
    draft({ quote: '초록 사과 두 개', line2: '대상 영역에서 초록 사과 두 개라고 썼어요.' }),
    context(),
    'quote_not_found'
  );
  // 공백만 다른 인용은 같은 표현으로 본다.
  const v = validateFeedback(draft({ quote: '빨간사과 한개', line2: '대상 영역에서 빨간 사과 한 개라고 썼어요.' }), context());
  assert.ok(v.ok, JSON.stringify(v));
});

test('인용은 2문장 안에 들어 있어야 한다', () => {
  rejected(draft({ quote: '둥근 접시', line2: '대상 영역에서 무엇이 있는지 분명하게 썼어요.' }), context(), 'quote_not_in_line2');
  // 따옴표로 감싸 넣어도 2문장 안에 있으면 통과한다.
  const v = validateFeedback(draft({ line2: "대상 영역에서 '빨간 사과 한 개'라고 썼어요." }), context());
  assert.ok(v.ok, JSON.stringify(v));
});

test('판정한 영역 가운데 수준 2 이상이 있으면 인용이 반드시 있어야 한다', () => {
  rejected(draft({ quote: null }), context(), 'quote_required');
  rejected(draft({ quote: '  ' }), context(), 'quote_required');
  rejected(draft({ quote: '""' }), context(), 'quote_required');
});

test('판정한 영역이 모두 수준 1이면 인용 없이 중립적으로 확인할 수 있다', () => {
  const levels: AreaLevels = { object: 1, feature: 1, relation: NA };
  const ctx = context({
    levels,
    missing: { object: ['사과'], feature: ['사과의 색'], relation: [] },
    requiredNextArea: nextActionArea(levels, null),
  });
  assert.equal(ctx.requiredNextArea, 'object');
  const v = validateFeedback(
    draft({
      line2: '지금은 그림 속 물건이 무엇인지 아직 드러나지 않았어요.',
      quote: null,
      strengthArea: null,
      line3: '그림 가운데 있는 것이 무엇인지 써 보세요.',
      nextArea: 'object',
      nextTarget: '사과',
    }),
    ctx
  );
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  assert.equal(v.quote, null);
  assert.equal(v.strengthArea, null);
  const lines = v.text.split('\n');
  assert.ok(!lines[1].startsWith('['), '영역이 없으면 이름표를 붙이지 않는다');
  assert.ok(lines[2].startsWith('[대상] '));
});

test('2문장의 영역(strengthArea)은 판정한 영역이어야 하고, 인용이 있으면 반드시 있어야 한다', () => {
  const ctx = context({ levels: { object: 4, feature: 2, relation: NA } });
  rejected(draft({ strengthArea: 'relation' }), { ...ctx, requiredNextArea: 'feature' }, 'strength_area');
  rejected(draft({ strengthArea: null }), context(), 'strength_area');
  rejected(draft({ strengthArea: 'context' as never }), context(), 'strength_area');
});

/* ────────────────────────── 3문장 — 다음 행동 ────────────────────────── */

test('3문장의 영역(nextArea)은 코드가 정한 영역과 같아야 한다', () => {
  rejected(draft({ nextArea: 'relation', nextTarget: '접시가 놓인 곳' }), context(), 'next_area');
  rejected(draft({ nextArea: null, nextTarget: null }), context(), 'next_area');
  // 코드가 초점 영역을 반영해 정한 영역을 따른다.
  const levels: AreaLevels = { object: 4, feature: 2, relation: 2 };
  const ctx = context({ levels, requiredNextArea: nextActionArea(levels, 'relation') });
  assert.equal(ctx.requiredNextArea, 'relation');
  rejected(draft(), ctx, 'next_area');
  const v = validateFeedback(
    draft({ line3: '접시가 놓인 곳을 써 보세요.', nextArea: 'relation', nextTarget: '접시가 놓인 곳' }),
    ctx
  );
  assert.ok(v.ok, JSON.stringify(v));
});

test('3문장이 겨냥한 정보는 그 영역의 빠진 필수 정보 목록에 있어야 한다(그림에 없는 정보 요구 차단)', () => {
  // 목록 밖의 정보
  rejected(draft({ nextTarget: '사과 옆의 칼' }), context(), 'next_target');
  // 다른 영역의 빠진 정보
  rejected(draft({ nextTarget: '접시가 놓인 곳' }), context(), 'next_target');
  // 목록이 있는데 겨냥한 정보가 없음
  rejected(draft({ nextTarget: null }), context(), 'next_target');
  rejected(draft({ nextTarget: '   ' }), context(), 'next_target');
  // 공백만 다른 문구는 목록의 문구로 돌려준다.
  const v = validateFeedback(draft({ nextTarget: '사과꼭지의  색' }), context());
  assert.ok(v.ok, JSON.stringify(v));
  if (v.ok) assert.equal(v.nextTarget, '사과 꼭지의 색');
});

test('단서 팩이 있으면 nextTarget이 단서 팩의 그 영역 필수 정보와도 같아야 한다', () => {
  const cueTargets = { object: ['사과 1개'], feature: ['사과 꼭지의 색'], relation: ['접시가 놓인 곳'] };
  const ok = validateFeedback(draft(), context({ cueTargets }));
  assert.ok(ok.ok, JSON.stringify(ok));
  // missing 목록에는 있지만 단서 팩에 없는 정보(모델이 지어낸 것)
  const invented = context({
    cueTargets,
    missing: { object: [], feature: ['사과 꼭지의 색', '사과 옆의 칼'], relation: [] },
  });
  rejected(draft({ nextTarget: '사과 옆의 칼' }), invented, 'next_target_unverified');
  // 다른 영역의 단서 항목으로는 확인되지 않는다.
  rejected(
    draft(),
    context({ cueTargets: { object: ['사과 꼭지의 색'], feature: [], relation: [] } }),
    'next_target_unverified'
  );
  // 단서 팩이 없으면(null) missing 목록 안인지만 본다.
  const structural = validateFeedback(draft({ nextTarget: '사과 옆의 칼' }), { ...invented, cueTargets: null });
  assert.ok(structural.ok, JSON.stringify(structural));
});

test('다음 행동 영역의 빠진 정보 목록이 비어 있으면 nextTarget은 null이어야 한다', () => {
  const ctx = context({ missing: { object: [], feature: [], relation: ['접시가 놓인 곳'] } });
  assert.equal(ctx.requiredNextArea, 'feature');
  const ok = validateFeedback(draft({ nextTarget: null }), ctx);
  assert.ok(ok.ok, JSON.stringify(ok));
  if (ok.ok) assert.equal(ok.nextTarget, null);
  // 목록이 비었는데 무언가를 겨냥하면 목록 밖의 정보를 요구하는 것이다.
  rejected(draft({ nextTarget: '사과 꼭지의 색' }), ctx, 'next_target');
});

test('모든 해당 영역이 4수준이면 nextArea·nextTarget은 null이고 3문장에 이름표가 없다', () => {
  const levels: AreaLevels = { object: 4, feature: 4, relation: NA };
  const ctx = context({ levels, requiredNextArea: nextActionArea(levels, 'feature'), missing: { object: [], feature: [], relation: [] } });
  assert.equal(ctx.requiredNextArea, null);
  const d = draft({ line3: '지금 쓴 글에 필요한 내용이 모두 들어 있어요.', nextArea: null, nextTarget: null });
  const v = validateFeedback(d, ctx);
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  assert.equal(v.nextArea, null);
  assert.equal(v.nextTarget, null);
  assert.ok(!v.text.split('\n')[2].startsWith('['));
  rejected({ ...d, nextArea: 'feature' }, ctx, 'next_area');
  rejected({ ...d, nextTarget: '사과 꼭지의 색' }, ctx, 'next_target');
});

/* ────────────────────────── 초안 추출 ────────────────────────── */

test('extractFeedbackDraft — 구조화된 필드만 받고 모르는 영역 이름은 null로 둔다', () => {
  assert.equal(extractFeedbackDraft(null), null);
  assert.equal(extractFeedbackDraft('문장'), null);
  assert.equal(extractFeedbackDraft({}), null);
  assert.equal(extractFeedbackDraft({ feedbackLine1: '', feedbackLine2: '' }), null);

  const d = extractFeedbackDraft({
    feedbackLine1: 'a',
    feedbackLine2: 'b',
    feedbackLine3: 'c',
    feedbackLine4: 'd',
    quote: 'q',
    strengthArea: 'specificity',
    nextArea: 'relation',
    nextTarget: 3,
  });
  assert.deepEqual(d, {
    line1: 'a',
    line2: 'b',
    line3: 'c',
    line4: 'd',
    quote: 'q',
    strengthArea: null,
    nextArea: 'relation',
    nextTarget: null,
  });
  // 영역 판정 필드가 함께 있어도 피드백 필드만 뽑는다.
  const mixed = extractFeedbackDraft({ object: { level: 3 }, feedbackLine1: 'x' });
  assert.ok(mixed);
  assert.ok(!('object' in (mixed as object)));
});

test('feedbackNotRequested — 검사 채점처럼 피드백을 만들지 않은 경우의 표시', () => {
  assert.deepEqual(feedbackNotRequested(), {
    status: 'not_requested',
    text: '',
    quote: null,
    regenerated: false,
    strengthArea: null,
    nextArea: null,
    nextTarget: null,
    rejections: [],
  });
});

/* ────────────────────────── 재생성·고정 안내 ────────────────────────── */

test('produceFeedback — 첫 초안이 통과하면 재생성하지 않는다', async () => {
  let calls = 0;
  const fb = await produceFeedback({
    context: context(),
    generate: async () => {
      calls++;
      return draft();
    },
  });
  assert.equal(calls, 1);
  assert.equal(fb.status, 'verified');
  assert.equal(fb.regenerated, false);
  assert.deepEqual(fb.rejections, []);
  assert.equal(fb.strengthArea, 'object');
  assert.equal(fb.nextArea, 'feature');
  assert.equal(fb.nextTarget, '사과 꼭지의 색');
  assert.equal(fb.text.split('\n').length, 4);
});

test('produceFeedback — 첫 초안이 탈락하면 피드백만 1회 다시 만들고 탈락 사유를 남긴다', async () => {
  const attempts: number[] = [];
  const fb = await produceFeedback({
    context: context(),
    generate: async (attempt) => {
      attempts.push(attempt);
      return attempt === 0 ? draft({ line4: '살펴볼까요? 다시 써요.' }) : draft();
    },
  });
  assert.deepEqual(attempts, [0, 1]);
  assert.equal(fb.status, 'verified');
  assert.equal(fb.regenerated, true);
  assert.deepEqual(fb.rejections, ['sentence_count']);
});

test('produceFeedback — 두 번 모두 탈락하면 고정 안내(fallback)이고 사유를 모두 남긴다. 세 번째는 없다', async () => {
  let calls = 0;
  const fb = await produceFeedback({
    context: context(),
    generate: async (attempt) => {
      calls++;
      return attempt === 0 ? draft({ quote: '초록 사과', line2: '대상 영역에서 초록 사과라고 썼어요.' }) : draft({ line2: '훌륭해요 빨간 사과 한 개.' });
    },
  });
  assert.equal(calls, 2);
  assert.equal(fb.status, 'fallback');
  assert.equal(fb.text, FEEDBACK_FALLBACK_TEXT);
  assert.equal(FEEDBACK_FALLBACK_TEXT, '표현을 선생님과 함께 확인해 보세요');
  assert.equal(fb.quote, null);
  assert.equal(fb.strengthArea, null);
  assert.equal(fb.nextArea, null);
  assert.equal(fb.nextTarget, null);
  assert.equal(fb.regenerated, true);
  assert.deepEqual(fb.rejections, ['quote_not_found', 'forbidden_expression']);
});

test('produceFeedback — 초안이 없거나 생성이 예외를 던지면 no_draft로 세고 재생성한다', async () => {
  const fb = await produceFeedback({
    context: context(),
    generate: async (attempt) => {
      if (attempt === 0) return null;
      throw new Error('모델 오류');
    },
  });
  assert.equal(fb.status, 'fallback');
  assert.deepEqual(fb.rejections, ['no_draft', 'no_draft']);

  const recovered = await produceFeedback({
    context: context(),
    generate: async (attempt) => {
      if (attempt === 0) throw new Error('모델 오류');
      return draft();
    },
  });
  assert.equal(recovered.status, 'verified');
  assert.equal(recovered.regenerated, true);
  assert.deepEqual(recovered.rejections, ['no_draft']);
});

test('produceFeedback — 확정된 판정(수준·빠진 정보·다음 행동 영역)을 바꾸지 않는다', async () => {
  const ctx = context();
  const before = JSON.parse(JSON.stringify(ctx));
  await produceFeedback({ context: ctx, generate: async () => draft({ line1: '' }) });
  await produceFeedback({ context: ctx, generate: async () => draft() });
  assert.deepEqual(ctx, before);
});
