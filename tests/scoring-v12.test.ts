/**
 * 공통 루브릭 v12-2(3영역 4수준) 채점 규칙 테스트 — src/lib/scoring.ts
 *
 * 모의 값만 쓴다. 실제 모델을 호출하지 않는다.
 * 형식 오류를 유효 값으로 바꾸지 않는다는 규칙(보정 금지)을 여기서 고정한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AREA_IDS,
  AREA_LABEL,
  APP_LEVEL_RULE,
  NOT_APPLICABLE,
  bandOf,
  isAreaId,
  isAreaSchemaError,
  levelsOf,
  nextActionArea,
  overallLevelOf,
  overallLevelRaw,
  parseAreaLevel,
  validateAreaCall,
  type AreaApplicability,
  type AreaJudgments,
  type AreaLevels,
  type AreaSchemaError,
} from '@/lib/scoring';

const NA = NOT_APPLICABLE;

/* ────────────────────────── 도우미 ────────────────────────── */

const STUDENT = '노란 우산이 하나 있고 손잡이는 갈색이다. 우산은 벽에 기대어 있다';
const ALL_JUDGED: AreaApplicability = { object: true, feature: true, relation: true };
const MODEL_DECIDES: AreaApplicability = { object: true, feature: null, relation: null };

function area(level: unknown, over: Record<string, unknown> = {}) {
  return { level, evidence: null, missing: [], evidence_missing: [], ...over };
}

function output(over: Record<string, unknown> = {}) {
  return {
    object: area(3, { evidence: '노란 우산이 하나', missing: [] }),
    feature: area(2, { evidence: '손잡이는 갈색', missing: ['우산 천의 무늬'] }),
    relation: area(4, { evidence: '벽에 기대어 있다', missing: [] }),
    ...over,
  };
}

function check(raw: unknown, applicability: AreaApplicability = ALL_JUDGED, studentText = STUDENT) {
  return validateAreaCall(raw, { studentText, applicability });
}

function expectOk(v: AreaJudgments | AreaSchemaError): AreaJudgments {
  assert.ok(!isAreaSchemaError(v), `형식 오류가 아니어야 한다: ${JSON.stringify(v)}`);
  return v as AreaJudgments;
}

function expectSchemaError(v: AreaJudgments | AreaSchemaError, hint?: string) {
  assert.ok(isAreaSchemaError(v), `형식 오류여야 한다: ${JSON.stringify(v)}`);
  if (hint) assert.ok((v as AreaSchemaError).detail.includes(hint), `사유에 '${hint}': ${(v as AreaSchemaError).detail}`);
}

const levels = (object: AreaLevels['object'], feature: AreaLevels['feature'], relation: AreaLevels['relation']): AreaLevels => ({
  object,
  feature,
  relation,
});

/* ────────────────────────── 밴드·영역 ────────────────────────── */

test('밴드는 문항 번호로 정한다 — A=1–12, B=13–24, C=25–36', () => {
  for (let lv = 1; lv <= 36; lv++) {
    const want = lv <= 12 ? 'A' : lv <= 24 ? 'B' : 'C';
    assert.equal(bandOf(lv), want, `L${lv}`);
  }
});

test('영역은 모든 밴드 공통으로 대상·특징·관계 셋이다', () => {
  assert.deepEqual([...AREA_IDS], ['object', 'feature', 'relation']);
  assert.deepEqual(AREA_LABEL, { object: '대상', feature: '특징', relation: '관계' });
  assert.equal(NOT_APPLICABLE, 'not_applicable');
  assert.ok(isAreaId('object') && isAreaId('feature') && isAreaId('relation'));
  for (const bad of ['specificity', 'context', 'Object', '', null, undefined, 1]) {
    assert.equal(isAreaId(bad), false, String(bad));
  }
});

/* ────────────────────────── parseAreaLevel ────────────────────────── */

test('parseAreaLevel — 정수 1~4와 정확히 not_applicable만 통과한다', () => {
  for (const v of [1, 2, 3, 4]) assert.equal(parseAreaLevel(v), v);
  assert.equal(parseAreaLevel('not_applicable'), 'not_applicable');
});

test('parseAreaLevel — 범위 밖·소수·문자열·null·NaN·Infinity는 형식 오류(null)다. 보정하지 않는다', () => {
  const bad: unknown[] = [
    0,
    5,
    -1,
    6,
    2.5,
    3.0000001,
    '3',
    '4',
    ' 3',
    NaN,
    Infinity,
    -Infinity,
    null,
    undefined,
    true,
    {},
    [3],
    'Not_Applicable',
    'not applicable',
    'n/a',
    'NA',
    ' not_applicable',
  ];
  for (const v of bad) assert.equal(parseAreaLevel(v), null, `거부되어야 한다: ${String(v)}`);
});

/* ────────────────────────── validateAreaCall — 정상 ────────────────────────── */

test('validateAreaCall — 정상 출력은 영역별 level·evidence·missing·evidenceMissing으로 받는다', () => {
  const v = expectOk(check(output()));
  assert.deepEqual(v.object, { level: 3, evidence: '노란 우산이 하나', missing: [], evidenceMissing: [] });
  assert.deepEqual(v.feature, { level: 2, evidence: '손잡이는 갈색', missing: ['우산 천의 무늬'], evidenceMissing: [] });
  assert.deepEqual(v.relation, { level: 4, evidence: '벽에 기대어 있다', missing: [], evidenceMissing: [] });
  assert.deepEqual(levelsOf(v), { object: 3, feature: 2, relation: 4 });
  // 점수·총점·배점은 담지 않는다.
  assert.ok(!('score' in v));
});

test('validateAreaCall — evidence_missing은 없어도 되고, 있으면 문자열 배열로 받는다', () => {
  const noEm = output({ object: { level: 2, evidence: '노란 우산', missing: ['의자'] } });
  assert.deepEqual(expectOk(check(noEm)).object.evidenceMissing, []);

  const withEm = output({
    object: area(2, { evidence: '노란 우산', missing: ['의자'], evidence_missing: ['의자의 색'] }),
  });
  assert.deepEqual(expectOk(check(withEm)).object.evidenceMissing, ['의자의 색']);

  expectSchemaError(check(output({ object: area(2, { evidence_missing: '의자의 색' }) })), 'evidence_missing');
  expectSchemaError(check(output({ object: area(2, { evidence_missing: [3] }) })), 'evidence_missing');
});

test('validateAreaCall — evidence가 null이거나 빈 문자열이면 근거 없음(null)으로 둔다', () => {
  const v = expectOk(check(output({ relation: area(1, { evidence: null, missing: ['장소'] }) })));
  assert.equal(v.relation.evidence, null);
  const blank = expectOk(check(output({ relation: area(1, { evidence: '   ', missing: ['장소'] }) })));
  assert.equal(blank.relation.evidence, null);
});

/* ────────────────────────── validateAreaCall — 수준 형식 ────────────────────────── */

test('validateAreaCall — 한 영역이라도 수준이 형식 오류면 호출 전체가 형식 오류다(일부만 받지 않는다)', () => {
  for (const bad of [0, 5, 2.5, '3', NaN, Infinity, null, undefined, 'n/a']) {
    for (const a of AREA_IDS) {
      const raw = output({ [a]: area(bad) });
      expectSchemaError(check(raw), `${a}.level`);
    }
  }
});

test('validateAreaCall — 출력이 객체가 아니거나 영역 블록이 없으면 형식 오류다', () => {
  for (const raw of [null, undefined, 'text', 3, true]) expectSchemaError(check(raw));
  for (const a of AREA_IDS) {
    const raw: Record<string, unknown> = output();
    delete raw[a];
    expectSchemaError(check(raw), `${a}(없음)`);
    expectSchemaError(check({ ...output(), [a]: null }), `${a}(없음)`);
    expectSchemaError(check({ ...output(), [a]: 3 }), `${a}(없음)`);
  }
  // 옛 v7 형식(objectLevel·specificityLevel·contextLevel)은 새 규칙에서 형식 오류다.
  expectSchemaError(check({ objectLevel: 4, specificityLevel: 4, contextLevel: null }));
});

/* ────────────────────────── validateAreaCall — 판정 여부(단서 팩) ────────────────────────── */

test('validateAreaCall — 대상 영역은 어떤 경우에도 not_applicable일 수 없다', () => {
  const raw = output({ object: area(NA) });
  expectSchemaError(check(raw, ALL_JUDGED), 'object.level');
  expectSchemaError(check(raw, MODEL_DECIDES), 'object.level');
  // applicability에 object=false가 잘못 들어와도 대상은 늘 판정한다.
  expectSchemaError(check(raw, { object: false, feature: null, relation: null } as unknown as AreaApplicability), 'object.level');
});

test('validateAreaCall — 단서 팩이 판정한다고 정한 영역에 not_applicable이 오면 형식 오류다', () => {
  expectSchemaError(check(output({ feature: area(NA) }), ALL_JUDGED), 'feature.level(판정해야 하는 영역)');
  expectSchemaError(check(output({ relation: area(NA) }), ALL_JUDGED), 'relation.level(판정해야 하는 영역)');
});

test('validateAreaCall — 단서 팩이 해당 없음으로 정한 영역에 수준이 오면 형식 오류다', () => {
  const featureNa: AreaApplicability = { object: true, feature: false, relation: true };
  const relationNa: AreaApplicability = { object: true, feature: true, relation: false };
  expectSchemaError(check(output(), featureNa), 'feature.level(해당 없음이어야 하는 영역)');
  expectSchemaError(check(output(), relationNa), 'relation.level(해당 없음이어야 하는 영역)');

  // 해당 없음으로 맞게 내면 통과한다.
  const ok = expectOk(check(output({ relation: area(NA) }), relationNa));
  assert.deepEqual(ok.relation, { level: NA, evidence: null, missing: [], evidenceMissing: [] });
  const ok2 = expectOk(check(output({ feature: area(NA) }), featureNa));
  assert.equal(ok2.feature.level, NA);
});

test('validateAreaCall — 단서 팩이 없으면(null) 특징·관계의 판정 여부를 모델이 정한다', () => {
  expectOk(check(output(), MODEL_DECIDES));
  const na = expectOk(check(output({ feature: area(NA), relation: area(NA) }), MODEL_DECIDES));
  assert.equal(na.feature.level, NA);
  assert.equal(na.relation.level, NA);
  assert.equal(na.object.level, 3);
});

/* ────────────────────────── validateAreaCall — 근거·누락 ────────────────────────── */

test('validateAreaCall — evidence는 학생 원문에 그대로 있어야 한다(공백 차이만 허용)', () => {
  // 원문에 없는 표현 → 형식 오류
  expectSchemaError(check(output({ object: area(3, { evidence: '빨간 우산' }) })), 'object.evidence(원문에 없음)');
  // 의역 → 형식 오류
  expectSchemaError(check(output({ feature: area(2, { evidence: '갈색 손잡이', missing: [] }) })), 'feature.evidence');
  // 공백만 다르면 같은 표현으로 본다.
  const spaced = expectOk(check(output({ object: area(3, { evidence: '노란우산이  하나' }) })));
  assert.equal(spaced.object.evidence, '노란우산이  하나');
  // 앞뒤 따옴표·공백은 걷어 낸다(내용은 바꾸지 않는다).
  const quoted = expectOk(check(output({ relation: area(4, { evidence: ' 벽에 기대어 있다 ' }) })));
  assert.equal(quoted.relation.evidence, '벽에 기대어 있다');
  // 한 글자 표현도 원문에 있으면 허용한다.
  assert.equal(expectOk(check(output({ object: area(3, { evidence: '우' }) }))).object.evidence, '우');
  // 문자열이 아니면 형식 오류
  expectSchemaError(check(output({ object: area(3, { evidence: 3 }) })), 'object.evidence');
  expectSchemaError(check(output({ object: area(3, { evidence: ['노란 우산'] }) })), 'object.evidence');
});

test('validateAreaCall — 학생 글이 달라지면 같은 근거도 형식 오류다(검증은 실제 제출 원문 기준)', () => {
  expectOk(check(output(), ALL_JUDGED, STUDENT));
  expectSchemaError(check(output(), ALL_JUDGED, '파란 공이 있다'), '원문에 없음');
});

test('validateAreaCall — not_applicable 영역은 evidence가 null이고 missing·evidence_missing이 비어야 한다', () => {
  const app: AreaApplicability = { object: true, feature: true, relation: false };
  expectSchemaError(check(output({ relation: area(NA, { evidence: '벽에 기대어' }) }), app), '해당 없음인데');
  expectSchemaError(check(output({ relation: area(NA, { missing: ['장소'] }) }), app), '해당 없음인데');
  expectSchemaError(check(output({ relation: area(NA, { evidence_missing: ['장소'] }) }), app), '해당 없음인데');
  expectOk(check(output({ relation: area(NA, { evidence: null, missing: [], evidence_missing: [] }) }), app));
});

test('validateAreaCall — missing은 반드시 있어야 하며 문자열 배열이어야 한다', () => {
  const noMissing = output();
  delete (noMissing.object as Record<string, unknown>).missing;
  expectSchemaError(check(noMissing), 'object.missing');

  for (const bad of [null, '장소', 3, { a: 1 }, [1], ['장소', null], [['중첩']]]) {
    expectSchemaError(check(output({ feature: area(2, { missing: bad }) })), 'feature.missing');
  }
  // 빈 문자열 항목은 걷어 내고 앞뒤 공백을 다듬는다(내용은 바꾸지 않는다).
  const v = expectOk(check(output({ feature: area(2, { missing: [' 우산 천의 무늬 ', '', '  '] }) })));
  assert.deepEqual(v.feature.missing, ['우산 천의 무늬']);
});

test('validateAreaCall — 형식 오류 사유에 학생 원문을 싣지 않는다', () => {
  const secret = '홍길동은 노란 우산을 들었다';
  const v = check(output({ object: area(3, { evidence: '김철수' }) }), ALL_JUDGED, secret);
  expectSchemaError(v);
  assert.ok(!(v as AreaSchemaError).detail.includes('홍길동'));
  assert.ok(!(v as AreaSchemaError).detail.includes('김철수'));
});

test('validateAreaCall — 여러 영역의 오류를 한꺼번에 사유로 남긴다', () => {
  const v = check(output({ object: area(5), feature: area('2'), relation: area(2.5) }));
  expectSchemaError(v);
  const d = (v as AreaSchemaError).detail;
  assert.ok(d.includes('object.level') && d.includes('feature.level') && d.includes('relation.level'), d);
});

/* ────────────────────────── 앱 종합 수준 ────────────────────────── */

test('앱 종합 수준 — 해당 영역 평균을 반올림(0.5는 올림)한 1~4', () => {
  assert.equal(overallLevelOf(levels(4, 4, 4)), 4);
  assert.equal(overallLevelOf(levels(1, 1, 1)), 1);
  // [2,3,N/A] → 2.5 → 3
  assert.equal(overallLevelRaw(levels(2, 3, NA)), 2.5);
  assert.equal(overallLevelOf(levels(2, 3, NA)), 3);
  assert.equal(overallLevelOf(levels(2, NA, 3)), 3);
  // [1,2,2] → 1.667 → 2
  assert.ok(Math.abs((overallLevelRaw(levels(1, 2, 2)) as number) - 5 / 3) < 1e-12);
  assert.equal(overallLevelOf(levels(1, 2, 2)), 2);
  // [1,1,2] → 1.333 → 1
  assert.equal(overallLevelOf(levels(1, 1, 2)), 1);
  // [3,4,N/A] → 3.5 → 4
  assert.equal(overallLevelOf(levels(3, 4, NA)), 4);
  // [1,2,N/A] → 1.5 → 2
  assert.equal(overallLevelOf(levels(1, 2, NA)), 2);
  // [2,3,3] → 2.667 → 3,  [2,2,3] → 2.333 → 2
  assert.equal(overallLevelOf(levels(2, 3, 3)), 3);
  assert.equal(overallLevelOf(levels(2, 2, 3)), 2);
});

test('앱 종합 수준 — 대상만 판정하면(나머지 해당 없음) 대상 수준 그대로다', () => {
  for (const lv of [1, 2, 3, 4] as const) {
    assert.equal(overallLevelRaw(levels(lv, NA, NA)), lv);
    assert.equal(overallLevelOf(levels(lv, NA, NA)), lv);
  }
});

test('앱 종합 수준 — 반올림 전 값은 반올림하지 않고 그대로 낸다', () => {
  assert.equal(overallLevelRaw(levels(2, 3, NA)), 2.5);
  assert.equal(overallLevelRaw(levels(4, 3, 3)), 10 / 3);
  assert.equal(overallLevelRaw(levels(1, 4, NA)), 2.5);
});

test('앱 종합 수준 — 결측(null)이나 판정한 영역이 없으면 null이다(0이나 1로 채우지 않는다)', () => {
  assert.equal(overallLevelOf(null), null);
  assert.equal(overallLevelOf(undefined), null);
  assert.equal(overallLevelRaw(null), null);
  assert.equal(overallLevelOf(levels(NA, NA, NA)), null);
  assert.equal(overallLevelRaw(levels(NA, NA, NA)), null);
});

test('앱 종합 수준 — 형식이 어긋난 저장 값은 보정하지 않고 null이다', () => {
  // 손상된 기록(범위 밖·소수·문자열·빈 영역)을 1~4로 끌어다 맞추지 않는다.
  const corrupt: unknown[] = [
    { object: 5, feature: 4, relation: 4 },
    { object: 0, feature: 1, relation: 1 },
    { object: 2.5, feature: 3, relation: NA },
    { object: '3', feature: 3, relation: 3 },
    { object: 3, feature: null, relation: 3 },
    { object: 3, feature: 3 },
    { objectLevel: 3, specificityLevel: 3, contextLevel: null },
  ];
  for (const c of corrupt) {
    assert.equal(overallLevelRaw(c as AreaLevels), null, JSON.stringify(c));
    assert.equal(overallLevelOf(c as AreaLevels), null, JSON.stringify(c));
  }
});

test('앱 종합 수준 규칙 문구가 있다(내보내기 문서에 함께 싣는다)', () => {
  assert.ok(APP_LEVEL_RULE.includes('round_half_up'));
  assert.ok(APP_LEVEL_RULE.includes('not_applicable'));
  assert.ok(APP_LEVEL_RULE.includes('1~4'));
});

/* ────────────────────────── 다음 행동의 영역 ────────────────────────── */

test('nextActionArea — 수준이 가장 낮은 해당 영역을 고른다', () => {
  assert.equal(nextActionArea(levels(4, 2, 3), null), 'feature');
  assert.equal(nextActionArea(levels(3, 4, 1), null), 'relation');
  assert.equal(nextActionArea(levels(1, 4, 4), 'relation'), 'object', '초점보다 가장 낮은 영역이 먼저다');
  assert.equal(nextActionArea(levels(3, 2, 3), 'relation'), 'feature');
});

test('nextActionArea — 가장 낮은 영역이 여럿이면 단계 초점 영역, 그다음 대상 → 특징 → 관계', () => {
  assert.equal(nextActionArea(levels(2, 2, 2), 'relation'), 'relation');
  assert.equal(nextActionArea(levels(2, 2, 2), 'feature'), 'feature');
  assert.equal(nextActionArea(levels(2, 2, 2), 'object'), 'object');
  assert.equal(nextActionArea(levels(2, 2, 2), null), 'object');
  assert.equal(nextActionArea(levels(3, 2, 2), null), 'feature');
  assert.equal(nextActionArea(levels(3, 2, 2), 'relation'), 'relation');
  assert.equal(nextActionArea(levels(3, 2, 2), 'object'), 'feature', '초점 영역이 가장 낮지 않으면 순서대로');
  assert.equal(nextActionArea(levels(2, 3, 2), null), 'object');
});

test('nextActionArea — 해당 없음 영역은 고르지 않는다', () => {
  assert.equal(nextActionArea(levels(3, NA, 4), 'feature'), 'object');
  assert.equal(nextActionArea(levels(4, NA, 2), null), 'relation');
  assert.equal(nextActionArea(levels(2, NA, NA), 'relation'), 'object');
});

test('nextActionArea — 해당 영역이 모두 4수준이면 null(고칠 것이 없다)', () => {
  assert.equal(nextActionArea(levels(4, 4, 4), null), null);
  assert.equal(nextActionArea(levels(4, 4, 4), 'feature'), null);
  assert.equal(nextActionArea(levels(4, NA, NA), 'object'), null);
  assert.equal(nextActionArea(levels(4, NA, 4), 'relation'), null);
});
