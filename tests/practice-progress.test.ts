/**
 * 연습 순서 진행(순수 함수) 시험.
 *
 * 순서의 기준은 문항 번호(level)가 아니라 제시 순서(order)다(논문 v12 6단계 배치).
 *   1 L01–L06 · 2 L07–L12 · 3 L19–L24 · 4 L13–L18 · 5 L25–L30 · 6 L31–L36
 *
 * 확인 사항
 *  - 들어오면 교사가 연 단계에서 아직 내지 않은 제시 순서상 가장 앞 문항으로 간다.
 *  - 진행 위치보다 뒤 문항·단계는 보이지 않고 고를 수 없다.
 *  - 교사가 열지 않은 단계는 계산에 넣지 않는다(앞 단계를 닫으면 다음 단계부터 시작).
 *  - '다음 문제'는 단계를 넘어가며(L12 → L19, L24 → L13, L18 → L25), 지금 문항을 내지 못했으면 넘어가지 않는다.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isOutOfOrderSubmission,
  isReachable,
  landingQuestion,
  nextQuestionInOrder,
  openQuestionsInOrder,
  progressFrontier,
  reachableLessons,
} from '../src/lib/practice-progress';
import { PRACTICE_QUESTIONS } from '../src/lib/questions';
import { STAGES } from '../src/lib/stages';

const idOf = (level: number) => `L${String(level).padStart(2, '0')}`;
const ALL = PRACTICE_QUESTIONS.map((q, index) => ({
  id: idOf(q.level),
  level: q.level,
  chasi: q.chasi,
  order: q.order,
  index,
}));
const ids = (...levels: number[]) => new Set(levels.map(idOf));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 제시 순서대로의 문항 번호 */
const PRESENTATION = [...range(1, 12), ...range(19, 24), ...range(13, 18), ...range(25, 36)];

test('문항 배치가 6단계 표와 같다', () => {
  assert.deepEqual(STAGES.map((s) => s.levels), [
    range(1, 6),
    range(7, 12),
    range(19, 24),
    range(13, 18),
    range(25, 30),
    range(31, 36),
  ]);
  const byLevel = new Map(ALL.map((q) => [q.level, q]));
  for (const level of range(13, 18)) assert.equal(byLevel.get(level)?.chasi, 4, `L${level}은 4단계`);
  for (const level of range(19, 24)) assert.equal(byLevel.get(level)?.chasi, 3, `L${level}은 3단계`);
  assert.deepEqual(
    [...ALL].sort((a, b) => a.order - b.order).map((q) => q.level),
    PRESENTATION
  );
});

test('연 단계의 문항만 제시 순서로 센다', () => {
  assert.deepEqual(openQuestionsInOrder(ALL, [2, 1]).map((q) => q.level), range(1, 12));
  // 3단계를 열면 L19–L24가 L12 바로 뒤에 온다.
  assert.deepEqual(openQuestionsInOrder(ALL, [3, 1, 2]).map((q) => q.level), [...range(1, 12), ...range(19, 24)]);
  assert.deepEqual(openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]).map((q) => q.level), PRESENTATION);
  assert.deepEqual(openQuestionsInOrder(ALL, []), []);
  // 넘긴 목록이 번호 순서로 섞여 있어도 제시 순서로 정렬한다.
  const shuffled = [...ALL].sort((a, b) => b.level - a.level);
  assert.deepEqual(openQuestionsInOrder(shuffled, [3, 4]).map((q) => q.level), [...range(19, 24), ...range(13, 18)]);
});

test('다 열려 있어도 아직 내지 않은 제시 순서상 가장 앞 문항으로 들어간다', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  const land = (submitted: Set<string>) =>
    landingQuestion(ordered, submitted, { lesson: null, fallbackLesson: 1 })?.level;
  assert.equal(land(ids(1, 2)), 3);
  // 중간을 건너뛴 기록이 있어도 가장 앞의 빈 문항이다.
  assert.equal(land(ids(1, 3)), 2);
  // 1단계를 다 냈으면 2단계 첫 문항
  assert.equal(land(ids(...range(1, 6))), 7);
  // 2단계까지 냈으면 3단계(특징) 첫 문항 L19 — 번호로는 L13이 앞이지만 4단계다.
  assert.equal(land(ids(...range(1, 12))), 19);
  // 3단계까지 냈으면 4단계(관계) 첫 문항 L13
  assert.equal(land(ids(...range(1, 12), ...range(19, 24))), 13);
  // 4단계까지 냈으면 5단계 첫 문항 L25
  assert.equal(land(ids(...range(1, 24))), 25);
  // 아무것도 안 냈으면 L01
  assert.equal(land(new Set()), 1);
  // 번호로 앞선 L13을 먼저 냈어도(요청을 직접 만든 경우 등) 진행 위치는 제시 순서를 따른다.
  assert.equal(land(ids(...range(1, 12), 13)), 19);
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
  // 2단계까지 내면 3단계(L19–L24) 단추가 보인다.
  const f3 = progressFrontier(ordered, ids(...range(1, 12)));
  assert.equal(f3?.level, 19);
  assert.deepEqual(reachableLessons(ordered, f3), [1, 2, 3]);
  // 모두 냈으면 연 단계가 모두 보인다.
  assert.deepEqual(reachableLessons(ordered, progressFrontier(ordered, ids(...range(1, 12), ...range(19, 24)))), [1, 2, 3]);
});

test('3단계를 하는 동안 4단계(L13–L18)는 번호가 앞서도 열리지 않는다', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  const byLevel = new Map(ordered.map((q) => [q.level, q]));
  const frontier = progressFrontier(ordered, ids(...range(1, 12), 19, 20));
  assert.equal(frontier?.level, 21);
  assert.equal(isReachable(byLevel.get(20)!, frontier), true);
  assert.equal(isReachable(byLevel.get(21)!, frontier), true);
  assert.equal(isReachable(byLevel.get(22)!, frontier), false);
  // L13은 번호로는 L21보다 앞이지만 4단계라 아직 닫혀 있다.
  assert.equal(isReachable(byLevel.get(13)!, frontier), false);
  assert.deepEqual(reachableLessons(ordered, frontier), [1, 2, 3]);
  // 4단계를 하는 중이면 3단계는 다시 열어 볼 수 있고 5단계는 닫혀 있다.
  const f4 = progressFrontier(ordered, ids(...range(1, 12), ...range(19, 24), 13));
  assert.equal(f4?.level, 14);
  assert.equal(isReachable(byLevel.get(24)!, f4), true);
  assert.equal(isReachable(byLevel.get(15)!, f4), false);
  assert.equal(isReachable(byLevel.get(25)!, f4), false);
  assert.deepEqual(reachableLessons(ordered, f4), [1, 2, 3, 4]);
});

test('교사가 앞 단계를 닫고 다음 단계만 열면 그 단계부터 시작한다', () => {
  const ordered = openQuestionsInOrder(ALL, [2]);
  assert.equal(landingQuestion(ordered, ids(1, 2), { lesson: null, fallbackLesson: 2 })?.level, 7);
  assert.deepEqual(reachableLessons(ordered, progressFrontier(ordered, ids(1, 2))), [2]);
  // 4단계만 열면 L13부터
  const only4 = openQuestionsInOrder(ALL, [4]);
  assert.equal(landingQuestion(only4, new Set(), { lesson: null, fallbackLesson: 4 })?.level, 13);
  // 3·4단계만 열면 3단계 첫 문항 L19부터
  const only34 = openQuestionsInOrder(ALL, [3, 4]);
  assert.equal(landingQuestion(only34, new Set(), { lesson: null, fallbackLesson: 3 })?.level, 19);
});

test('단계 단추: 그 단계의 빈 문항, 다 냈으면 첫 문항, 아직 안 열렸으면 진행 위치', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2]);
  const submitted = ids(...range(1, 6), 7);
  assert.equal(landingQuestion(ordered, submitted, { lesson: 1, fallbackLesson: 1 })?.level, 1);
  assert.equal(landingQuestion(ordered, submitted, { lesson: 2, fallbackLesson: 1 })?.level, 8);
  // 2단계가 아직 열리지 않은 학생이 2단계를 요청해도(URL 등) 진행 위치로 간다.
  assert.equal(landingQuestion(ordered, ids(1), { lesson: 2, fallbackLesson: 1 })?.level, 2);

  const all = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  const upTo3 = ids(...range(1, 12), ...range(19, 21));
  // 3단계 단추 → 3단계의 빈 문항 L22
  assert.equal(landingQuestion(all, upTo3, { lesson: 3, fallbackLesson: 1 })?.level, 22);
  // 아직 닫힌 4단계를 요청하면 진행 위치(L22)로 간다.
  assert.equal(landingQuestion(all, upTo3, { lesson: 4, fallbackLesson: 1 })?.level, 22);
  // 3단계를 다 냈으면 3단계 단추는 그 단계 첫 문항 L19
  const done3 = ids(...range(1, 12), ...range(19, 24));
  assert.equal(landingQuestion(all, done3, { lesson: 3, fallbackLesson: 1 })?.level, 19);
});

test('모두 냈으면 서버가 정한 진입 단계의 첫 문항', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2]);
  const all = ids(...range(1, 12));
  assert.equal(landingQuestion(ordered, all, { lesson: null, fallbackLesson: 2 })?.level, 7);
  assert.equal(landingQuestion(ordered, all, { lesson: null, fallbackLesson: null })?.level, 1);
  assert.equal(landingQuestion([], all, { lesson: null, fallbackLesson: 1 }), null);
  // 진입 단계가 4단계면 그 단계의 첫 문항 L13
  const every = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  assert.equal(landingQuestion(every, ids(...range(1, 36)), { lesson: null, fallbackLesson: 4 })?.level, 13);
  assert.equal(landingQuestion(every, ids(...range(1, 36)), { lesson: null, fallbackLesson: 3 })?.level, 19);
});

test("'다음 문제'는 제시 순서로 단계를 넘어가고, 지금 문항을 내지 못했으면 넘어가지 않는다", () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  // L06을 냈으면 다음은 2단계 L07
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 6)), 6)?.level, 7);
  // L12 다음은 3단계 첫 문항 L19(L13이 아니다)
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 12)), 12)?.level, 19);
  // 3단계 안에서는 번호 순서
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 12), 19), 19)?.level, 20);
  // L24 다음은 4단계 첫 문항 L13
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 12), ...range(19, 24)), 24)?.level, 13);
  // L18 다음은 5단계 첫 문항 L25(L19가 아니다)
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 24)), 18)?.level, 25);
  // L03을 아직 못 냈으면(저장 실패 등) L04로 가지 않는다.
  assert.equal(nextQuestionInOrder(ordered, ids(1, 2), 3), null);
  // L12를 못 냈으면 L19로 가지 않는다.
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 11)), 12), null);
  // 앞 문항으로 돌아가 다시 본 뒤 다음은 그다음 문항(이미 낸 문항)
  assert.equal(nextQuestionInOrder(ordered, ids(1, 2, 3), 1)?.level, 2);
  // 모두 냈으면 끝(L36)에서 처음(L01)으로 돈다.
  assert.equal(nextQuestionInOrder(ordered, ids(...range(1, 36)), 36)?.level, 1);
  // 연 단계가 1·2단계뿐이면 L12에서 L01로 돈다.
  const first2 = openQuestionsInOrder(ALL, [1, 2]);
  assert.equal(nextQuestionInOrder(first2, ids(...range(1, 12)), 12)?.level, 1);
  // 목록에 없는 문항에서 누르면 진행 위치로
  assert.equal(nextQuestionInOrder(first2, ids(1, 2), 30)?.level, 3);
  assert.equal(nextQuestionInOrder([], ids(1), 1), null);
});

test('화면이 넘기는 index가 그대로 따라온다', () => {
  const ordered = openQuestionsInOrder(ALL, [1, 2, 3, 4, 5, 6]);
  const target = landingQuestion(ordered, ids(...range(1, 12)), { lesson: null, fallbackLesson: 1 });
  assert.ok(target);
  assert.equal(PRACTICE_QUESTIONS[target.index].level, 19);
  const next = nextQuestionInOrder(ordered, ids(...range(1, 24)), 18);
  assert.ok(next);
  assert.equal(PRACTICE_QUESTIONS[next.index].level, 25);
});

test('99-1 B3: 제출이 제시 순서를 건너뛰었는가 — 진행 위치보다 뒤이면서 아직 내지 않은 문항', () => {
  const all = [1, 2, 3, 4, 5, 6];
  // 처음: 진행 위치는 L01
  assert.equal(isOutOfOrderSubmission(ALL, all, ids(), 'L01'), false);
  assert.equal(isOutOfOrderSubmission(ALL, all, ids(), 'L02'), true);
  // L01–L12를 냈으면 다음은 L19(3단계) — L13(4단계)은 건너뛴 것
  const firstTwelve = ids(...range(1, 12));
  assert.equal(isOutOfOrderSubmission(ALL, all, firstTwelve, 'L19'), false);
  assert.equal(isOutOfOrderSubmission(ALL, all, firstTwelve, 'L13'), true);
  // 이미 낸 문항을 다시 내는 것(고쳐 쓰기)은 건너뛴 것이 아니다
  assert.equal(isOutOfOrderSubmission(ALL, all, ids(1, 5), 'L05'), false);
  // 열리지 않은 단계의 문항은 판정하지 않는다
  assert.equal(isOutOfOrderSubmission(ALL, [1], ids(), 'L07'), false);
  // 모두 냈으면 어느 문항도 건너뛴 것이 아니다
  assert.equal(isOutOfOrderSubmission(ALL, all, ids(...range(1, 36)), 'L36'), false);
});

