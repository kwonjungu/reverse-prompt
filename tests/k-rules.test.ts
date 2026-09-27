/**
 * 논문 v12-2 운영 규칙(K01–K07)과 피드백 규칙의 경계 사례 시험.
 *
 * 규칙 대부분은 의미 판정이라 코드가 모델 대신 판정할 수 없다. 그래서 두 가지를 본다.
 *   1. 지시문: 모든 밴드의 실제 전송 지시문에 규칙 문장이 그대로 들어간다(K01·K02·K03·K05·K06·맞춤법).
 *      K07(정보가 1~2개인 과제의 정보별 판정)은 채점자 기록 규칙이라 지시문에 없다.
 *   2. 코드: 구조로 지킬 수 있는 부분은 코드가 막는다.
 *      - K02  단서 팩이 요구하지 않는 정보(예: 시간대·분위기)는 다음 행동으로 요구하지 못한다(next_target_unverified)
 *      - K05  증거 부족(evidence_missing)은 목록으로 따로 남고 수준 값에 섞이지 않는다
 *      - 맞춤법·띄어쓰기  근거는 학생 원문 그대로이며 띄어쓰기만 다른 것은 인정한다(맞춤법을 고쳐 적으면 형식 오류)
 *      - 해당 없음은 어떤 집계(앱 종합 수준·다음 행동 영역)에도 들지 않고, 결측은 1수준이 아니다
 *      - C2  고칠 점은 가장 낮은 영역에서 하나(코드가 영역을 정하고, 3문장은 한 문장)
 *      - C4  한 문장이 너무 길면 탈락(쉬운 말·짧은 문장)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OPERATING_RULES, renderForModel } from '../src/lib/rubric';
import { buildEvaluationPrompt, buildFeedbackPrompt } from '../src/lib/evaluation-prompt';
import {
  MAX_FEEDBACK_LINE_CHARS,
  validateFeedback,
  type FeedbackContext,
  type FeedbackDraft,
} from '../src/lib/feedback';
import {
  NOT_APPLICABLE,
  nextActionArea,
  overallLevelOf,
  overallLevelRaw,
  validateAreaCall,
  type AreaApplicability,
} from '../src/lib/scoring';
import type { QuestionCues } from '../src/server/registry/contract';

const BANDS = ['A', 'B', 'C'] as const;

const RULE_OF: Record<string, RegExp> = {
  K01: /수량은 대상 영역에서만 판단하고 특징 영역에서 다시 감점하지 않는다/,
  K02: /분위기·느낌·시간대는 선택 정보라 필수 채점에서 제외한다/,
  K03: /이름이 곧 형태면 대상 영역.*'둥근'은 특징 영역/,
  K05: /핵심 대상이 빠지면 대상 영역에만 대상 누락으로 반영하고.*증거 부족\(evidence_missing\).*새 오류로도, 맞은 것으로도 세지 않는다/,
  K06: /두 수준 기술에 모두 해당하면 낮은 수준\. 한 속성 누락\(3\)과 핵심 속성 오류\(2, 속성을 다른 대상에 붙인 경우 포함\)가 겹치면 2/,
  맞춤법: /맞춤법·띄어쓰기·글 길이·작성 시간은 판단하지 않음/,
  관계범위: /A밴드\(Lv\.1~12\)는 대상 사이 공간 관계, B·C밴드는 장소와 행동이 필수\(행동이 없는 사물·풍경은 놓인 곳과 배치\)\. C밴드의 시간대·분위기는 선택 정보/,
};

test('K01·K02·K03·K05·K06·맞춤법·관계 범위가 모든 밴드의 실제 전송 지시문에 들어간다', () => {
  for (const band of BANDS) {
    const prompt = buildEvaluationPrompt({ band, studentPrompt: '학생 글', cues: null, noCuePolicy: 'common_only' });
    for (const [name, re] of Object.entries(RULE_OF)) {
      assert.match(prompt, re, `${band}밴드 지시문에 ${name} 규칙이 없다`);
      assert.match(renderForModel(band), re);
    }
  }
  assert.equal(OPERATING_RULES.length, 8);
});

test('K07(정보별 판정)은 지시문에 없고, 모델은 모든 과제에 영역별 수준을 준다', () => {
  for (const band of BANDS) {
    const prompt = buildEvaluationPrompt({ band, studentPrompt: '학생 글', cues: null, noCuePolicy: 'common_only' });
    for (const word of ['정확히 표현함', '부정확하게 표현함', '표현하지 않음', 'K07', '정보별 판정']) {
      assert.equal(prompt.includes(word), false, `${band}밴드 지시문에 K07 문구 "${word}"가 있다`);
    }
    assert.match(prompt, /level: 1~4의 정수, 또는 "not_applicable"/);
  }
});

test('관계 범위는 밴드별로 짚고, B·C는 사물·풍경의 놓인 곳과 배치를 관계로 본다', () => {
  const b = buildEvaluationPrompt({ band: 'B', studentPrompt: '주전자', cues: null, noCuePolicy: 'common_only' });
  assert.match(b, /행동이 없는 사물·풍경이면 놓인 곳과 배치를 본다/);
  const c = buildEvaluationPrompt({ band: 'C', studentPrompt: '놀이터', cues: null, noCuePolicy: 'common_only' });
  assert.match(c, /시간대·분위기는 선택 정보라 없어도 감점하지 않는다/);
  const a = buildEvaluationPrompt({ band: 'A', studentPrompt: '공', cues: null, noCuePolicy: 'common_only' });
  assert.match(a, /대상 사이의 공간 관계를 본다/);
});

/* ────────────────── 코드가 지키는 부분 ────────────────── */

const APP: AreaApplicability = { object: true, feature: true, relation: true };
const judgment = (level: unknown, evidence: string | null, missing: string[] = [], evidence_missing: string[] = []) => ({
  level,
  evidence,
  missing,
  evidence_missing,
});

test('맞춤법·띄어쓰기: 근거는 학생 원문 그대로, 띄어쓰기만 다른 것은 인정, 맞춤법을 고쳐 적으면 형식 오류', () => {
  const studentText = '빨간 사가 한개가 접시위에 잇다';
  const spaced = validateAreaCall(
    {
      object: judgment(3, '빨간 사가 한 개'), // 띄어쓰기만 다름 → 인정
      feature: judgment(3, '빨간'),
      relation: judgment(3, '접시위에 잇다'), // 맞춤법이 틀린 그대로 → 인정
    },
    { studentText, applicability: APP }
  );
  assert.equal('error' in spaced, false, JSON.stringify(spaced));
  const corrected = validateAreaCall(
    { object: judgment(3, '빨간 사과 한 개'), feature: judgment(3, '빨간'), relation: judgment(3, '접시 위에 있다') },
    { studentText, applicability: APP }
  );
  assert.ok('error' in corrected, '맞춤법을 고쳐 적은 근거를 원문으로 인정했다');
});

test('K05: 증거 부족(evidence_missing)은 목록으로 따로 남고 수준 값과 섞이지 않는다', () => {
  const r = validateAreaCall(
    {
      object: judgment(2, '우산', ['아이 1명']),
      feature: judgment(3, '노란 우산', [], ['아이의 옷 색']),
      relation: judgment(3, '공원에', [], ['아이가 걷는 중']),
    },
    { studentText: '노란 우산이 공원에 있다', applicability: APP }
  );
  assert.equal('error' in r, false, JSON.stringify(r));
  if ('error' in r) return;
  assert.deepEqual(r.feature.evidenceMissing, ['아이의 옷 색']);
  assert.deepEqual(r.relation.evidenceMissing, ['아이가 걷는 중']);
  // 증거 부족은 missing(빠진 정보 = 다음 행동 거리)에 들지 않는다.
  assert.deepEqual(r.feature.missing, []);
  assert.equal(r.feature.level, 3);
});

test('해당 없음은 어떤 집계에도 들지 않고, 결측은 1수준이 아니다', () => {
  assert.equal(overallLevelOf({ object: 2, feature: 3, relation: NOT_APPLICABLE }), 3, '(2+3)/2=2.5 → 3');
  assert.equal(overallLevelRaw({ object: 2, feature: 3, relation: NOT_APPLICABLE }), 2.5);
  assert.equal(overallLevelOf({ object: 1, feature: NOT_APPLICABLE, relation: NOT_APPLICABLE }), 1);
  assert.equal(overallLevelOf(null), null, '결측은 null(자료 없음)');
  // 다음 행동 영역도 해당 없음을 고르지 않는다.
  assert.equal(nextActionArea({ object: 3, feature: NOT_APPLICABLE, relation: 2 }, null), 'relation');
  assert.equal(nextActionArea({ object: 4, feature: NOT_APPLICABLE, relation: NOT_APPLICABLE }, null), null);
});

/* ────────────────── 피드백: C2 한 가지, C4 짧은 문장, K02 선택 정보 ────────────────── */

const STUDENT = '노란 우산을 쓴 아이가 공원에서 걷고 있다';
function ctx(over: Partial<FeedbackContext> = {}): FeedbackContext {
  const levels = over.levels ?? { object: 3, feature: 2, relation: 3 };
  return {
    studentText: STUDENT,
    levels,
    missing: { object: [], feature: ['장화의 색'], relation: ['저녁 시간대'] },
    requiredNextArea: nextActionArea(levels, null),
    ...over,
  };
}
function draft(over: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    line1: '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.',
    line2: '관계 영역에서 공원에서 걷고 있다라고 어디에서 무엇을 하는지 썼어요.',
    line3: '장화의 색도 써 보세요.',
    line4: '장화가 무슨 색인지 그림을 다시 볼까요?',
    quote: '공원에서 걷고 있다',
    strengthArea: 'relation',
    nextArea: 'feature',
    nextTarget: '장화의 색',
    ...over,
  };
}

test('C2: 고칠 점은 가장 낮은 영역에서 하나 — 다른 영역·두 문장은 탈락', () => {
  assert.equal(ctx().requiredNextArea, 'feature');
  assert.ok(validateFeedback(draft(), ctx()).ok);
  const other = validateFeedback(draft({ nextArea: 'relation', nextTarget: '저녁 시간대', line3: '저녁 시간대도 써 보세요.' }), ctx());
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.reason, 'next_area');
  const two = validateFeedback(draft({ line3: '장화의 색도 써 보세요. 우산 손잡이도 써 보세요.' }), ctx());
  assert.equal(two.ok, false);
  if (!two.ok) assert.equal(two.reason, 'sentence_count');
});

test('K02: 단서 팩이 요구하지 않는 시간대·분위기는 다음 행동으로 요구하지 못한다', () => {
  const cues: Pick<QuestionCues, 'coreObjects' | 'requiredAttributes' | 'requiredContext' | 'acceptedExpressions'> = {
    coreObjects: ['아이', '우산'],
    requiredAttributes: ['노란 우산', '장화의 색'],
    requiredContext: ['공원', '걷는 중'],
    acceptedExpressions: [],
  };
  const cueTargets = {
    object: [...cues.coreObjects],
    feature: [...cues.requiredAttributes],
    relation: [...cues.requiredContext],
  };
  const levels = { object: 4, feature: 4, relation: 3 } as const;
  const res = validateFeedback(
    draft({ nextArea: 'relation', nextTarget: '저녁 시간대', line3: '저녁 시간대도 써 보세요.' }),
    ctx({ levels, requiredNextArea: nextActionArea(levels, null), cueTargets })
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'next_target_unverified');
});

test('C4: 한 문장이 너무 길면 탈락한다(학생 인용 자리는 길이에서 뺀다)', () => {
  const long = '장화의 색'.padEnd(MAX_FEEDBACK_LINE_CHARS + 5, '을') + ' 써 보세요.';
  const r = validateFeedback(draft({ line3: long }), ctx());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'line_too_long');
  // 학생이 길게 쓴 문장을 그대로 인용해도 인용 자리는 세지 않는다.
  const longStudent = '노란 우산을 쓴 아이가 공원에서 걷고 있다 '.repeat(4).trim();
  const quoted = validateFeedback(
    draft({ line2: `관계 영역에서 ${longStudent}라고 썼어요.`, quote: longStudent }),
    ctx({ studentText: longStudent })
  );
  assert.ok(quoted.ok, JSON.stringify(quoted));
  assert.equal(MAX_FEEDBACK_LINE_CHARS, 80);
});

test('피드백 지시문도 쉬운 말·짧은 문장·한 가지를 요구한다', () => {
  const p = buildFeedbackPrompt({
    studentPrompt: STUDENT,
    areas: {
      object: { level: 3, evidence: '아이', missing: [], evidenceMissing: [] },
      feature: { level: 2, evidence: '노란 우산', missing: ['장화의 색'], evidenceMissing: [] },
      relation: { level: 3, evidence: '공원에서', missing: [], evidenceMissing: [] },
    },
    focusArea: null,
    requiredNextArea: 'feature',
  });
  assert.match(p, /쉬운 말로 짧게 쓴다/);
  assert.match(p, /다음 행동은 한 가지만 말한다/);
});
