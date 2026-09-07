/**
 * 채점 환산·결합·개별 호출 검증 테스트 (수용시험 1·2·3·4)
 *
 * 모의 값만 쓴다. 실제 모델을 호출하지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bandOf,
  combine,
  isAxisSchemaError,
  parseAxisLevel,
  toScores,
  validateSingleCall,
  withinOneLevel,
  WEIGHTS,
  type AxisLevels,
} from '@/lib/scoring';

test('수용시험 1 — A 5·5·null은 100점, 맥락 축은 항상 null', () => {
  const levels: AxisLevels = { objectLevel: 5, specificityLevel: 5, contextLevel: null };
  const s = toScores(levels, 'A');
  assert.equal(s.total, 100);
  assert.equal(s.context, null);
  assert.equal(WEIGHTS.A.object + WEIGHTS.A.specificity, 100);
});

test('수용시험 1 — A밴드는 contextLevel에 값이 들어와도 맥락 점수를 만들지 않는다', () => {
  const s = toScores({ objectLevel: 5, specificityLevel: 5, contextLevel: 5 }, 'A');
  assert.equal(s.context, null);
  assert.equal(s.total, 100);
});

test('수용시험 1 — B 3·3·3은 50점', () => {
  const s = toScores({ objectLevel: 3, specificityLevel: 3, contextLevel: 3 }, 'B');
  assert.equal(s.object, 17.5);
  assert.equal(s.specificity, 17.5);
  assert.equal(s.context, 15);
  assert.equal(s.total, 50);
});

test('수용시험 1 — C 1·1·1은 0점 (유효한 최저 수행이며 결측이 아니다)', () => {
  const s = toScores({ objectLevel: 1, specificityLevel: 1, contextLevel: 1 }, 'C');
  assert.equal(s.total, 0);
  assert.equal(s.context, 0);
});

test('밴드 경계 — Lv.12까지 A, Lv.24까지 B, 그 뒤 C', () => {
  assert.equal(bandOf(1), 'A');
  assert.equal(bandOf(12), 'A');
  assert.equal(bandOf(13), 'B');
  assert.equal(bandOf(24), 'B');
  assert.equal(bandOf(25), 'C');
  assert.equal(bandOf(36), 'C');
});

test('수용시험 2 — A 두 호출 (2,4)·(3,4)는 수준 (2.5,4), 총점 56.25 (반올림 금지)', () => {
  const a: AxisLevels = { objectLevel: 2, specificityLevel: 4, contextLevel: null };
  const b: AxisLevels = { objectLevel: 3, specificityLevel: 4, contextLevel: null };
  assert.equal(withinOneLevel(a, b), true);

  const levels = combine([a, b], false);
  assert.deepEqual(levels, { objectLevel: 2.5, specificityLevel: 4, contextLevel: null });

  const s = toScores(levels, 'A');
  assert.equal(s.total, 56.25);
  assert.equal(s.object, 18.75);
  assert.equal(s.specificity, 37.5);
});

test('수용시험 3 — B (1,5,3)·(5,1,3)은 총점이 같아도 3차 호출이 필요하다', () => {
  const a: AxisLevels = { objectLevel: 1, specificityLevel: 5, contextLevel: 3 };
  const b: AxisLevels = { objectLevel: 5, specificityLevel: 1, contextLevel: 3 };
  // 두 호출의 총점은 같다. 총점 일치를 일치 판정으로 쓰지 않는다.
  assert.equal(toScores(a, 'B').total, toScores(b, 'B').total);
  assert.equal(withinOneLevel(a, b), false);

  const c: AxisLevels = { objectLevel: 3, specificityLevel: 3, contextLevel: 3 };
  const levels = combine([a, b, c], true);
  assert.deepEqual(levels, { objectLevel: 3, specificityLevel: 3, contextLevel: 3 });
  assert.equal(toScores(levels, 'B').total, 50);
});

test('수용시험 4 — parseAxisLevel은 정수 1~5만 통과시킨다', () => {
  assert.equal(parseAxisLevel(1), 1);
  assert.equal(parseAxisLevel(5), 5);
  for (const bad of [6, 0, -1, 2.5, '3', '4', NaN, Infinity, -Infinity, null, undefined, {}, []]) {
    assert.equal(parseAxisLevel(bad), null, `${String(bad)}는 형식 오류여야 한다`);
  }
});

test('수용시험 4 — 6·0·2.5·문자열·NaN을 최저 수행으로 보정하지 않는다', () => {
  const cases: unknown[] = [
    { objectLevel: 6, specificityLevel: 3, contextLevel: null },
    { objectLevel: 0, specificityLevel: 3, contextLevel: null },
    { objectLevel: 2.5, specificityLevel: 3, contextLevel: null },
    { objectLevel: '4', specificityLevel: 3, contextLevel: null },
    { objectLevel: NaN, specificityLevel: 3, contextLevel: null },
    { objectLevel: Infinity, specificityLevel: 3, contextLevel: null },
  ];
  for (const raw of cases) {
    const v = validateSingleCall(raw, 'A');
    assert.equal(isAxisSchemaError(v), true, `${JSON.stringify(raw)}는 형식 오류여야 한다`);
  }
});

test('수용시험 4 — B밴드의 contextLevel null은 형식 오류다', () => {
  const v = validateSingleCall({ objectLevel: 3, specificityLevel: 3, contextLevel: null }, 'B');
  assert.equal(isAxisSchemaError(v), true);
});

test('수용시험 4 — A밴드의 contextLevel은 반드시 null이다', () => {
  const ok = validateSingleCall({ objectLevel: 3, specificityLevel: 3, contextLevel: null }, 'A');
  assert.equal(isAxisSchemaError(ok), false);
  assert.deepEqual(ok, { objectLevel: 3, specificityLevel: 3, contextLevel: null });

  const bad = validateSingleCall({ objectLevel: 3, specificityLevel: 3, contextLevel: 3 }, 'A');
  assert.equal(isAxisSchemaError(bad), true);
});

test('B·C밴드의 정상 개별 호출은 그대로 통과한다', () => {
  const v = validateSingleCall({ objectLevel: 4, specificityLevel: 2, contextLevel: 5 }, 'C');
  assert.deepEqual(v, { objectLevel: 4, specificityLevel: 2, contextLevel: 5 });
});

test('combine은 결측을 1로 채우지 않는다 — 결합할 값이 없으면 예외', () => {
  assert.throws(() => combine([], false));
});

test('결합 결과의 반수준은 유지한다', () => {
  const levels = combine(
    [
      { objectLevel: 3, specificityLevel: 4, contextLevel: 2 },
      { objectLevel: 4, specificityLevel: 4, contextLevel: 3 },
    ],
    false,
  );
  assert.equal(levels.objectLevel, 3.5);
  assert.equal(levels.contextLevel, 2.5);
});
