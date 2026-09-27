/**
 * 피드백이 정답을 알려 주지 않게 하기(99-1 A1)와 수량 표현의 영역(99-1 A2) — src/lib/feedback.ts, evaluation-prompt.ts
 *
 * 운영 사이트 실측에서 나온 문장을 그대로 시험한다.
 *   L02(접힌 노란 우산): 3문장 "다음에는 … 우산을 써 보세요", 4문장 "비가 올 때 쓰는 우산이 보여요라고 바꾸어 써 볼까요?"
 *   L03(축구공): 3문장 "검은색과 흰색 무늬를 더 써 보세요"
 *   L02: 2문장 "[특징] 특징 영역에서 하나라고 사물의 개수를 짚어 썼어요."
 * 단서 값은 시험용 합성 값이다(실제 비공개 단서 팩이 아니다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NEUTRAL_LINE3,
  NEUTRAL_LINE4,
  answerTermsOf,
  findAnswerLeaks,
  isQuantityOnly,
  produceFeedback,
  validateFeedback,
  type FeedbackContext,
  type FeedbackDraft,
} from '@/lib/feedback';
import { buildEvaluationPrompt, buildFeedbackPrompt, feedbackGuide } from '@/lib/evaluation-prompt';
import { answerValuesOf } from '@/server/grading/operational';
import { NOT_APPLICABLE, nextActionArea, type AreaLevels } from '@/lib/scoring';

const NA = NOT_APPLICABLE;

/* ─────────────── 지시문 ─────────────── */

test('A1 지시문: 4문장은 확인 질문만 — "표현을 제안"이 없고 고쳐 쓴 문장·낱말을 주지 말라고 한다', () => {
  for (const guide of [feedbackGuide(null), feedbackGuide('object')]) {
    assert.ok(!guide.includes('표현을 제안'));
    assert.match(guide, /feedbackLine4: 스스로 확인할 질문을 하나 낸다\. 학생 대신 고쳐 쓴 문장이나 넣을 낱말을 제시하지 않는다\./);
    assert.match(guide, /빠진 정보의 값\(대상 이름·색 이름·개수·장소 이름\)을 말하지 않고, 어느 영역에서 무엇을 다시 볼지/);
    assert.match(guide, /'공의 색과 무늬를 그림에서 다시 살펴보세요'/);
    assert.match(guide, /'그림 속 물건의 이름이 맞는지 확인해 보세요'/);
  }
  const scoring = buildEvaluationPrompt({ band: 'A', studentPrompt: '공', cues: null, noCuePolicy: 'common_only' });
  assert.ok(!scoring.includes('표현을 제안'));
  assert.ok(scoring.includes('학생 대신 고쳐 쓴 문장이나 넣을 낱말을 제시하지 않는다'));
});

test('A1 지시문: 피드백만 다시 만드는 지시문에도 같은 규칙과, 빠진 정보의 값을 쓰지 말라는 문장이 있다', () => {
  const p = buildFeedbackPrompt({
    studentPrompt: '공이 하나 있다',
    areas: {
      object: { level: 3, evidence: '공이 하나', missing: [], evidenceMissing: [] },
      feature: { level: 1, evidence: null, missing: ['흰색과 검은색 무늬'], evidenceMissing: [] },
      relation: { level: NA, evidence: null, missing: [], evidenceMissing: [] },
    },
    focusArea: null,
    requiredNextArea: 'feature',
  });
  assert.ok(!p.includes('표현을 제안'));
  assert.ok(p.includes('학생 대신 고쳐 쓴 문장이나 넣을 낱말을 제시하지 않는다'));
  assert.ok(p.includes('그 값(이름·색·개수·장소)을 3·4문장에 그대로 쓰지 않는다'));
});

test('A2 지시문: 개수·수량 표현은 대상 영역(K01)이라고 2문장 규칙에 적는다', () => {
  assert.match(feedbackGuide(null), /개수·수량 표현\(하나, 두 개 등\)은 대상 영역이다\(K01\)\. 특징 영역으로 표시하지 않는다\./);
});

/* ─────────────── 누설 검사(낱말 대조) ─────────────── */

// 합성 단서 — L02·L03과 같은 모양
const L02_VALUES = ['우산 1개', '노란색', '접혀 있음'];
const L03_VALUES = ['축구공 1개', '흰색과 검은색 무늬'];

test('단서 값에서 낱말·개수를 뽑는다(일반 낱말 색·무늬·모양은 값으로 보지 않는다)', () => {
  assert.deepEqual(answerTermsOf(L03_VALUES), { terms: ['축구공', '흰색', '검은색'], counts: [1] });
  assert.deepEqual(answerTermsOf(L02_VALUES), { terms: ['우산', '노란색', '접혀'], counts: [1] });
  // 조사 글자로 끝나는 명사를 깨지 않는다
  assert.deepEqual(answerTermsOf(['고양이 2마리', '사과']).terms, ['고양이', '사과']);
});

test('실측 L02: 3·4문장이 학생 글에 없는 대상 이름(우산)을 말하면 누설이다', () => {
  const student = '노란 물건이 하나 있다';
  assert.deepEqual(findAnswerLeaks(['다음에는 이 물건이 우산인지 써 보세요.'], student, L02_VALUES), ['우산']);
  assert.deepEqual(findAnswerLeaks(['비가 올 때 쓰는 우산이 보여요라고 바꾸어 써 볼까요?'], student, L02_VALUES), ['우산']);
  // 모범 문장은 걸리지 않는다
  assert.deepEqual(findAnswerLeaks(['그림 속 물건의 이름이 맞는지 확인해 보세요.'], student, L02_VALUES), []);
});

test('실측 L03: "검은색과 흰색 무늬를 더 써 보세요"는 누설, "공의 색과 무늬를 그림에서 다시 살펴보세요"는 아니다', () => {
  const student = '공이 하나 있다';
  assert.deepEqual(findAnswerLeaks(['검은색과 흰색 무늬를 더 써 보세요.'], student, L03_VALUES).sort(), ['검은색', '흰색']);
  assert.deepEqual(findAnswerLeaks(['공의 색과 무늬를 그림에서 다시 살펴보세요.'], student, L03_VALUES), []);
});

test('학생 글에 이미 있는 값을 다시 부르는 것은 누설이 아니다', () => {
  const student = '흰색과 검은색 무늬가 있는 축구공';
  assert.deepEqual(findAnswerLeaks(['축구공이 몇 개인지 세어 보세요.'], student, L03_VALUES), []);
});

test('개수: 학생이 쓰지 않은 개수를 숫자+단위로 말하면 누설, "몇 개"·"한 가지"는 아니다', () => {
  const values = ['공 3개'];
  assert.deepEqual(findAnswerLeaks(['공이 세 개인지 세어 볼까요?'], '공이 있다', values), ['3개']);
  assert.deepEqual(findAnswerLeaks(['공이 몇 개인지 세어 볼까요?'], '공이 있다', values), []);
  assert.deepEqual(findAnswerLeaks(['한 가지만 더 살펴보세요.'], '공이 있다', ['공 1개']), []);
  assert.deepEqual(findAnswerLeaks(['공이 세 개인지 다시 세어 볼까요?'], '공 세 개가 있다', values), []);
});

test('한 글자 대상 이름(새)은 조사가 붙을 때만 센다 — "새로 써 보세요"는 누설이 아니다', () => {
  const values = ['새 1마리'];
  assert.deepEqual(findAnswerLeaks(['그림을 보고 새로 써 보세요.'], '파란 동물이 있다', values), []);
  assert.deepEqual(findAnswerLeaks(['이 동물이 새인지 확인해 보세요.'], '파란 동물이 있다', values), ['새']);
});

/* ─────────────── 검증·재생성·중립 대체 ─────────────── */

const STUDENT = '노란 물건이 하나 있다';

function context(over: Partial<FeedbackContext> = {}): FeedbackContext {
  const levels: AreaLevels = { object: 2, feature: 3, relation: NA };
  return {
    studentText: STUDENT,
    levels,
    missing: { object: ['우산 1개'], feature: [], relation: [] },
    requiredNextArea: nextActionArea(levels, null),
    cueTargets: { object: ['우산 1개'], feature: ['노란색', '접혀 있음'], relation: [] },
    answerValues: L02_VALUES,
    ...over,
  };
}

function draft(over: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    line1: '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.',
    line2: '특징 영역에서 노란 물건이라고 색을 밝혀 썼어요.',
    line3: '다음에는 이 물건이 우산인지 써 보세요.',
    line4: '비가 올 때 쓰는 우산이 보여요라고 바꾸어 써 볼까요?',
    quote: '노란 물건',
    strengthArea: 'feature',
    nextArea: 'object',
    nextTarget: '우산 1개',
    ...over,
  };
}

const CLEAN = {
  line3: '그림 속 물건의 이름이 맞는지 확인해 보세요.',
  line4: '그림 속 물건을 무엇이라고 부르는지 떠올려 볼까요?',
};

test('A1 검증: 누설한 초안은 answer_leak으로 탈락하고, 3·4문장만 중립으로 바꾼 결과를 함께 돌려준다', () => {
  const v = validateFeedback(draft(), context());
  assert.equal(v.ok, false);
  if (v.ok || v.reason !== 'answer_leak') throw new Error(JSON.stringify(v));
  assert.deepEqual(v.leaked, ['우산']);
  assert.deepEqual(v.neutralized.text.split('\n'), [
    '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.',
    '[특징] 특징 영역에서 노란 물건이라고 색을 밝혀 썼어요.',
    `[대상] ${NEUTRAL_LINE3}`,
    NEUTRAL_LINE4,
  ]);
});

test('A1 검증: 단서 팩이 없는 문항(answerValues 없음)은 누설 검사를 건너뛴다', () => {
  const v = validateFeedback(draft(), context({ answerValues: null, cueTargets: null }));
  assert.ok(v.ok, JSON.stringify(v));
});

test('A1 절차: 첫 초안이 누설이면 1회 다시 만들고, 깨끗하면 verified(regenerated)', async () => {
  const fb = await produceFeedback({
    context: context(),
    generate: async (attempt) => (attempt === 0 ? draft() : draft(CLEAN)),
  });
  assert.equal(fb.status, 'verified');
  assert.equal(fb.regenerated, true);
  assert.deepEqual(fb.rejections, ['answer_leak']);
  assert.equal(fb.text.split('\n')[2], `[대상] ${CLEAN.line3}`);
});

test('A1 절차: 다시 만들어도 누설이면 3·4문장을 중립 문장으로 바꾸고 status=neutralized', async () => {
  const fb = await produceFeedback({ context: context(), generate: async () => draft() });
  assert.equal(fb.status, 'neutralized');
  assert.deepEqual(fb.rejections, ['answer_leak', 'answer_leak']);
  const lines = fb.text.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[2], `[대상] ${NEUTRAL_LINE3}`);
  assert.equal(lines[3], NEUTRAL_LINE4);
  assert.ok(!fb.text.includes('우산'), '중립 대체 뒤에는 누설 값이 남지 않는다');
  assert.equal(fb.nextArea, 'object');
});

test('A1 절차: 누설 초안 뒤 재생성이 다른 형식 오류면 고정 안내 대신 앞 초안의 중립 대체를 쓴다', async () => {
  const fb = await produceFeedback({
    context: context(),
    generate: async (attempt) => (attempt === 0 ? draft() : draft({ line1: '' })),
  });
  assert.equal(fb.status, 'neutralized');
  assert.deepEqual(fb.rejections, ['answer_leak', 'empty_line']);
});

/* ─────────────── A2 수량 표현은 대상 영역 ─────────────── */

test('A2: 수량 표현만인 인용을 알아본다', () => {
  for (const q of ['하나', '하나라고', '세 개', '두 마리가', '한 개만', '3개', '셋']) assert.ok(isQuantityOnly(q), q);
  for (const q of ['노란 우산 하나', '우산', '세모', '네모난 판', '하나의 빨간 공']) assert.ok(!isQuantityOnly(q), q);
});

test('A2 실측 L02: "[특징] 특징 영역에서 하나라고 사물의 개수를 짚어 썼어요" → [대상]으로 고친다', () => {
  const v = validateFeedback(
    draft({
      line2: '특징 영역에서 하나라고 사물의 개수를 짚어 썼어요.',
      quote: '하나',
      strengthArea: 'feature',
      ...CLEAN,
    }),
    context()
  );
  assert.ok(v.ok, JSON.stringify(v));
  if (!v.ok) return;
  assert.equal(v.strengthArea, 'object');
  assert.equal(v.text.split('\n')[1], '[대상] 대상 영역에서 하나라고 사물의 개수를 짚어 썼어요.');
});

test('A2: 특징 영역이 해당 없음이어도 수량 인용이면 대상 영역으로 고쳐 통과한다(strength_area로 떨어뜨리지 않는다)', () => {
  const v = validateFeedback(
    draft({ line2: '특징 영역에서 하나라고 개수를 썼어요.', quote: '하나', strengthArea: 'feature', ...CLEAN }),
    context({ levels: { object: 2, feature: NA, relation: NA }, requiredNextArea: 'object' })
  );
  assert.ok(v.ok, JSON.stringify(v));
  if (v.ok) assert.equal(v.strengthArea, 'object');
});

test('A2: 수량이 아닌 인용의 특징 영역은 그대로 둔다', () => {
  const v = validateFeedback(draft({ ...CLEAN }), context());
  assert.ok(v.ok, JSON.stringify(v));
  if (v.ok) assert.equal(v.strengthArea, 'feature');
});

/* ─────────────── 채점 절차가 단서 값을 넘긴다 ─────────────── */

test('answerValuesOf: 단서 팩의 핵심 대상·필수 속성만 넘기고, 단서 팩이 없으면 null', () => {
  assert.equal(answerValuesOf(null), null);
  assert.deepEqual(
    answerValuesOf({
      coreObjects: ['우산 1개'],
      requiredAttributes: ['노란색'],
      requiredContext: ['바닥'],
      acceptedExpressions: ['양산'],
      notRequired: [],
      contradictions: [],
      anchors: {},
    }),
    ['우산 1개', '노란색']
  );
});
