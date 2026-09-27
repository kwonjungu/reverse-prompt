/**
 * 연습 순서 진행(순수 함수) 시험.
 *
 * 확인 사항
 *  - 들어오면 교사가 연 단계에서 아직 내지 않은 가장 낮은 번호 문항으로 간다.
 *  - 진행 위치보다 뒤 문항·단계는 보이지 않고 고를 수 없다.
 *  - 교사가 열지 않은 단계는 계산에 넣지 않는다(앞 단계를 닫으면 다음 단계부터 시작).
 *  - '다음 문제'는 단계를 넘어가며, 지금 문항을 내지 못했으면 넘어가지 않는다.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isReachable,
  landingQuestion,
  nextQuestionInOrder,
  openQuestionsInOrder,
  progressFrontier,
  reachableLessons,
} from '../src/lib/practice-progress';
import { PRACTICE_QUESTIONS } from '../src/lib/questions';

const ALL = PRACTICE_QUESTIONS.map((q) => ({
  id: `L${String(q.level).padStart(2, '0')}`,
  level: q.level,
  chasi: q.chasi,
}));
const ids = (...levels: number[]) => new Set(levels.map((l) => `L${String(l).padStart(2, '0')}`));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('연 단계의 문항만 번호 순서로 센다', () => {
  const ordered = openQuestionsInOrder(ALL, [2, 1]);
  assert.deepEqual(ordered.map((q) => q.level), range(1, 12));
  assert.deepEqual(openQuestionsInOrder(ALL, []), []);
});

test('다 열려 있어도 아직 내지 않은 가장 낮은 문항으로 들어간다', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  const submitted = ids(1, 2);
  assert.equal(landingQuestion(ordered, submitted, { lesson: null, fallbackLesson: 1 })?.level, 3);
  // 중간을 건너뛴 기록이 있어도 가장 낮은 빈 문항이다.
  assert.equal(landingQuestion(ordered, ids(1, 3), { lesson: null, fallbackLesson: 1 })?.level, 2);
  // 1단계를 다 냈으면 2단계 첫 문항
  assert.equal(landingQuestion(ordered, ids(...range(1, 6)), { lesson: null, fallbackLesson: 1 })?.level, 7);
  // 아무것도 안 냈으면 1번
  assert.equal(landingQuestion(ordered, new Set(), { lesson: null, fallbackLesson: 1 })?.level, 1);
});

test('진행 위치보다 뒤 문항과 단계는 열리지 않는다', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3]);
  const frontier = progressFrontier(ordered, ids(1, 2));
  assert.equal(frontier?.level, 3);
  assert.equal(isReachable(ordered[1], frontier), true); // 낸 문항 L02
  assert.equal(isReachable(ordered[2], frontier), true); // 진행 위치 L03
  assert.equal(isReachable(ordered[3], frontier), false); // L04
  assert.deepEqual(reachableLessons(ordered, frontier), [1]);
  // 1단계를 다 내면 2단계 단추가 보인다. 3단계는 아직이다.
  assert.deepEqual(reachableLessons(ordered, progressFrontier(ordered, ids(...range(1, 6)))), [1, 2]);
  // 모두 냈으면 연 단계가 모두 보인다.
  assert.deepEqual(reachableLessons(ordered, progressFrontier(ordered, ids(...range(1, 18)))), [1, 2, 3]);
});

test('교사가 앞 단계를 닫고 다음 단계만 열면 그 단계부터 시작한다', () => {
  const ordered = openQuestionsInOrder(ALL, [2]);
  assert.equal(landingQuestion(ordered, ids(1, 2), { lesson: null, fallbackLesson: 2 })?.level, 7);
  assert.deepEqual(reachableLessons(ordered, progressFrontier(ordered, ids(1, 2))), [2]);
});

test('단계 단추: 그 단계의 빈 문항, 다 냈으면 첫 문항, 아직 안 열렸으면 진행 위치', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2]);
  const submitted = ids(...range(1, 6), 7);
  assert.equal(landingQuestion(ordered, submitted, { lesson: 1, fallbackLesson: 1 })?.level, 1);
  assert.equal(landingQuestion(ordered, submitted, { lesson: 2, fallbackLesson: 1 })?.level, 8);
  // 2단계가 아직 열리지 않은 학생이 2단계를 요청해도(URL 등) 진행 위치로 간다.
  assert.equal(landingQuestion(ordered, ids(1), { lesson: 2, fallbackLesson: 1 })?.level, 2);
});

test('모두 냈으면 서버가 정한 진입 단계의 첫 문항', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2]);
  const all = ids(...range(1, 12));
  assert.equal(landingQuestion(ordered, all, { lesson: null, fallbackLesson: 2 })?.level, 7);
  assert.equal(landingQuestion(ordered, all, { lesson: null, fallbackLesson: null })?.level, 1);
  assert.equal(landingQuestion([], all, { lesson: null, fallbackLesson: 1 }), null);
});

test("'다음 문제'는 단계를 넘어가고, 지금 문항을 내지 못했으면 넘어가지 않는다", () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2]);
  // L06을 냈으면 다음은 2단계 L07
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 6)), 6)?.level, 7);
  // L03을 아직 못 냈으면(저장 실패 등) L04로 가지 않는다.
  assert.equal(nextQuestionInOrder(ordered, ids(1, 2), 3), null);
  // 앞 문항으로 돌아가 다시 본 뒤 다음은 그다음 문항(이미 낸 문항)
  assert.equal(nextQuestionInOrder(ordered, ids(1, 2, 3), 1)?.level, 2);
  // 모두 냈으면 끝에서 처음으로 돈다.
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 12)), 12)?.level, 1);
});
