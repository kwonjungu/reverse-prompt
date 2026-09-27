/**
 * 실제 모델 예비 점검 결과 정리 규칙 시험 — src/server/export/pilot-summary.ts (모델은 부르지 않는다)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { PILOT_COLUMNS, buildPilotCsv, feedbackOutcome, parsePilotInput, summarizePilot, type PilotRow } from '../src/server/export/pilot-summary';
import type { ScoringRun } from '../src/lib/research/types';

function run(over: Partial<ScoringRun> & { result: ScoringRun['result'] }): ScoringRun {
  return {
    operationId: 'op',
    repeatIndex: 1,
    band: 'A',
    calls: [{ callId: 'c1', retryIndex: 0, purpose: 'score', levels: null, failureReason: null, servedModel: null, startedAt: 'a', finishedAt: 'b', durationMs: 1 }],
    extraCall: false,
    feedback: null,
    modelId: 'googleai/test-configured-model',
    servedModel: 'test-served',
    modelConfig: { temperature: 0.2 },
    rubricVersion: 'v12-2',
    cueVersion: 'cv',
    applicabilitySource: 'cue_pack',
    focusArea: null,
    imageHash: 'ih',
    promptHash: 'ph',
    codeCommit: 'cc',
    scoredAt: 't',
    ...over,
  } as ScoringRun;
}

const area = (level: 1 | 2 | 3 | 4 | 'not_applicable', evidence: string | null) => ({ level, evidence, missing: [], evidenceMissing: [] });
const scored = run({
  result: { status: 'scored', areas: { object: area(3, '사과'), feature: area(2, '빨간'), relation: area('not_applicable', null) }, feedbackStatus: 'verified' },
  feedback: { status: 'verified', text: '가\n나\n다\n라', quote: null, regenerated: false, rejections: [] },
});
const fallback = run({
  result: { status: 'scored', areas: { object: area(2, '공'), feature: area(2, '둥근'), relation: area(1, '옆') }, feedbackStatus: 'fallback' },
  feedback: { status: 'fallback', text: '표현을 선생님과 함께 확인해 보세요', quote: null, regenerated: true, rejections: ['quote_not_found', 'line_too_long'] },
  calls: [
    { callId: 'c1', retryIndex: 0, purpose: 'score', levels: null, failureReason: 'schema_error: x', servedModel: null, startedAt: 'a', finishedAt: 'b', durationMs: 1 },
    { callId: 'c2', retryIndex: 1, purpose: 'score', levels: null, failureReason: null, servedModel: null, startedAt: 'a', finishedAt: 'b', durationMs: 1 },
  ],
});
const missing = run({ result: { status: 'missing', areas: null, reason: 'schema_error' } });

const item = (id: string) => ({ id, questionId: 'L05', text: `문장 ${id}` });

test('입력은 문항 ID(L01~L36)와 문장의 배열이며, 틀리면 일부만 채점하지 않고 멈춘다', () => {
  assert.deepEqual(parsePilotInput([{ questionId: 'l05', text: '가' }]), [{ id: 'P001', questionId: 'L05', text: '가' }]);
  assert.deepEqual(parsePilotInput({ items: [{ id: 'A', questionId: 'L16', sentence: '나' }] }), [{ id: 'A', questionId: 'L16', text: '나' }]);
  assert.throws(() => parsePilotInput([{ questionId: 'L37', text: '가' }]), /L01~L36/);
  assert.throws(() => parsePilotInput([{ questionId: 'L01', text: '  ' }]), /비어/);
  assert.throws(() => parsePilotInput([]));
  // 오류 문구에 문장을 싣지 않는다.
  try {
    parsePilotInput([{ questionId: 'L99', text: '비밀 문장' }]);
  } catch (e) {
    assert.equal(String((e as Error).message).includes('비밀 문장'), false);
  }
});

test('요약: 결측률·fallback률·탈락 사유·재호출 수', () => {
  const rows: PilotRow[] = [
    { item: item('1'), run: scored },
    { item: item('2'), run: fallback },
    { item: item('3'), run: missing },
    { item: item('4'), run: scored },
  ];
  const s = summarizePilot(rows);
  assert.equal(s.total, 4);
  assert.equal(s.scored, 3);
  assert.equal(s.missing, 1);
  assert.equal(s.missingRate, 0.25);
  assert.deepEqual(s.missingReasons, { schema_error: 1 });
  assert.equal(s.fallback, 1);
  assert.equal(s.fallbackRate, 1 / 3, '피드백을 만든 사례(채점된 3건) 가운데');
  assert.deepEqual(s.rejectionReasons, { quote_not_found: 1, line_too_long: 1 });
  assert.equal(s.retried, 1);
  assert.equal(summarizePilot([]).missingRate, null);
  assert.equal(feedbackOutcome(scored), 'ok');
  assert.equal(feedbackOutcome(fallback), 'fallback');
  assert.equal(feedbackOutcome(missing), 'none');
});

test('CSV: 영역별 수준·근거·결측 이유·피드백 상태·탈락 사유를 담는다', () => {
  const csv = buildPilotCsv([{ item: item('1'), run: scored }, { item: item('3'), run: missing }]);
  const head = csv.replace(/^﻿/, '').split('\r\n')[0];
  for (const key of ['object_level', 'object_evidence', 'relation_level', 'result_status', 'missing_reason', 'feedback_outcome', 'feedback_rejections', 'served_model']) {
    assert.ok(head.includes(`"${key}"`), key);
  }
  assert.ok(csv.includes('"not_applicable"'));
  assert.ok(csv.includes('"schema_error"'));
  assert.equal(PILOT_COLUMNS.some((c) => /key|token|secret/i.test(c.key)), false);
});

test('예비 점검 스크립트는 연구 저장소에 쓰지 않고 키를 인자로 받지 않는다', () => {
  const src = readFileSync(path.join(process.cwd(), 'scripts', 'pilot-score.mjs'), 'utf8');
  assert.equal(/firebase|getAdminFirestore|getLessonStore|saveSubmission/.test(src), false, '연구 저장소를 연다');
  assert.equal(/--key|--api-key/.test(src), false, '키를 인자로 받는다');
  assert.ok(src.includes('GOOGLE_GENAI_API_KEY'));
  // 로그에 문장(item.text)을 찍지 않는다.
  assert.equal(/console\.(log|error)\([^)]*item\.text/.test(src), false);
});
