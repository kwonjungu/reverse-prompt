/**
 * 추출 사례의 반복 채점(2·3회차) 규칙 시험 — src/server/export/repeat-scores.ts
 *
 *   1. 회차는 2·3만 받는다(1회차는 제출 문서의 주 자료)
 *   2. 세 번 모두 같은 수준인 비율을 영역별로 낸다. 해당 없음·결측은 분모에서 빼고 따로 센다
 *   3. 비율은 반올림하지 않고, 완전 사례가 없으면 NA
 *   4. 문서 ID는 추출·사례·회차로 정해져 같은 사례를 두 번 채점하지 않는다
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AGREEMENT_COLUMNS,
  REPEAT_INDEXES,
  agreementByArea,
  buildAgreementCsv,
  buildRepeatCaseCsv,
  isRepeatIndex,
  levelsOfRun,
  repeatDocId,
  type RepeatCaseRow,
} from '../src/server/export/repeat-scores';
import type { AreaLevels } from '../src/lib/scoring';

const lv = (object: AreaLevels['object'], feature: AreaLevels['feature'], relation: AreaLevels['relation']): AreaLevels => ({
  object,
  feature,
  relation,
});

function row(caseId: string, levels: RepeatCaseRow['levels']): RepeatCaseRow {
  return { caseId, questionId: 'L14', finalSubmissionId: `ps_${caseId}`, levels };
}

test('반복 회차는 2·3만 받는다', () => {
  assert.deepEqual([...REPEAT_INDEXES], [2, 3]);
  assert.equal(isRepeatIndex(2), true);
  assert.equal(isRepeatIndex(3), true);
  for (const v of [1, 4, '2', null, 2.5]) assert.equal(isRepeatIndex(v), false, String(v));
  assert.equal(repeatDocId('S-1', '14-31', 2), 'S-1__14-31__r2');
  assert.notEqual(repeatDocId('S-1', '14-31', 2), repeatDocId('S-1', '14-31', 3));
});

test('세 번 모두 같은 수준인 비율 — 해당 없음·결측은 분모에서 빼고 따로 센다', () => {
  const rows = [
    row('a', [lv(3, 2, 4), lv(3, 2, 4), lv(3, 2, 4)]), // 모두 같음
    row('b', [lv(3, 2, 4), lv(3, 3, 4), lv(3, 2, 3)]), // 대상만 같음
    row('c', [lv(2, 'not_applicable', 'not_applicable'), lv(2, 'not_applicable', 'not_applicable'), lv(1, 'not_applicable', 3)]),
    row('d', [lv(4, 4, 4), null, lv(4, 4, 4)]), // 2회차 결측
  ];
  const [object, feature, relation] = agreementByArea(rows);
  assert.deepEqual(object, { area: 'object', cases: 4, complete: 3, allSame: 2, rate: 2 / 3, notApplicable: 0, incomplete: 1 });
  assert.deepEqual(feature, { area: 'feature', cases: 4, complete: 2, allSame: 1, rate: 0.5, notApplicable: 1, incomplete: 1 });
  // 관계: c는 해당 없음과 수준이 섞여 불완전, d는 결측
  assert.deepEqual(relation, { area: 'relation', cases: 4, complete: 2, allSame: 1, rate: 0.5, notApplicable: 0, incomplete: 2 });
});

test('완전 사례가 없으면 비율은 NA다(0으로 쓰지 않는다)', () => {
  const [object] = agreementByArea([row('x', [null, null, null])]);
  assert.equal(object.rate, null);
  const csv = buildAgreementCsv([row('x', [null, null, null])]);
  assert.ok(csv.includes('"object",1,0,0,NA,0,1'));
  assert.deepEqual(
    AGREEMENT_COLUMNS.map((c) => c.key),
    ['area', 'cases', 'complete_cases', 'all_three_same', 'agreement_rate', 'all_not_applicable', 'incomplete_cases']
  );
});

test('회차별 CSV는 1·2·3회차 영역 수준을 나란히 두고 해당 없음과 결측을 가른다', () => {
  const csv = buildRepeatCaseCsv([row('14-31', [lv(3, 'not_applicable', 2), lv(3, 'not_applicable', 2), null])]);
  const [head, first] = csv.replace(/^﻿/, '').split('\r\n');
  assert.ok(head.startsWith('"case_id","question_id","final_submission_id","r1_object_level","r2_object_level","r3_object_level"'));
  assert.ok(first.includes('"not_applicable"'));
  assert.ok(first.endsWith('2,2,NA'));
});

test('채점 작업에서 영역 수준을 읽고, 결측이면 null이다', () => {
  const area = (level: 1 | 2 | 3 | 4 | 'not_applicable') => ({ level, evidence: null, missing: [], evidenceMissing: [] });
  const scored = {
    result: { status: 'scored', areas: { object: area(3), feature: area(2), relation: area('not_applicable') }, feedbackStatus: 'verified' },
  } as unknown as Parameters<typeof levelsOfRun>[0];
  assert.deepEqual(levelsOfRun(scored), lv(3, 2, 'not_applicable'));
  const missing = { result: { status: 'missing', areas: null, reason: 'schema_error' } } as unknown as Parameters<typeof levelsOfRun>[0];
  assert.equal(levelsOfRun(missing), null);
  assert.equal(levelsOfRun(null), null);
});
