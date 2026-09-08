/**
 * 연수(강의) 모드의 순수 규칙 시험.
 *
 * 여기서 고정하는 것은 세 가지다.
 *   1. 연수에서 쓰는 문항이 20개 고정이고 연습 문항의 부분집합이라는 것
 *   2. 목록에 없는 문항 ID를 서버가 받아 주지 않는다는 것
 *   3. 연수 번호 대조가 정확히 일치할 때에만 통과한다는 것
 *
 * 모델 호출과 쿠키 배선은 여기서 시험하지 않는다(actions.ts는 서버 전용 배선이다).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRACTICE_QUESTIONS } from '../src/lib/questions';
import {
  LECTURE_LEVELS,
  LECTURE_QUESTIONS,
  isLectureQuestionId,
  lectureQuestionId,
} from '../src/lib/lecture-questions';
import {
  DEFAULT_LECTURE_CODE,
  isAllowedLectureQuestion,
  isLectureCodeValid,
} from '../src/server/lecture/core';

test('연수 문항은 20개 고정이고 중복이 없다', () => {
  assert.equal(LECTURE_QUESTIONS.length, 20);
  assert.equal(new Set(LECTURE_LEVELS).size, 20);
});

test('연수 문항은 모두 연습 36문항 안에 있다', () => {
  const practiceLevels = new Set(PRACTICE_QUESTIONS.map((q) => q.level));
  for (const level of LECTURE_LEVELS) {
    assert.ok(practiceLevels.has(level), `연습 문항에 없는 레벨: ${level}`);
  }
});

test('연수 문항은 여섯 차시를 모두 지나며 난이도 순서를 지킨다', () => {
  const chasis = LECTURE_QUESTIONS.map((q) => q.chasi);
  assert.deepEqual([...new Set(chasis)], [1, 2, 3, 4, 5, 6]);
  // 화면 순서가 곧 난이도 순서다. 뒤로 갈수록 차시가 내려가지 않는다.
  for (let i = 1; i < chasis.length; i += 1) {
    assert.ok(chasis[i] >= chasis[i - 1], `차시 순서가 뒤집혔다: ${i}`);
  }
});

test('문항 ID 규칙은 연습 이미지 파일명과 같다', () => {
  assert.equal(lectureQuestionId(1), 'L01');
  assert.equal(lectureQuestionId(36), 'L36');
  for (const q of LECTURE_QUESTIONS) {
    assert.equal(q.imageUrl, `/questions/${lectureQuestionId(q.level)}.jpg`);
  }
});

test('목록에 없는 문항은 연수 모드에서 받지 않는다', () => {
  assert.ok(isLectureQuestionId('L01'));
  // L02는 연습 문항이지만 연수 목록에는 없다.
  assert.equal(isLectureQuestionId('L02'), false);
  // 검사 문항과 체험 전용 문항도 열리지 않는다.
  assert.equal(isLectureQuestionId('T1'), false);
  assert.equal(isLectureQuestionId('game-01'), false);
});

test('isAllowedLectureQuestion은 문자열이 아닌 값을 거절한다', () => {
  assert.ok(isAllowedLectureQuestion('L01'));
  assert.ok(isAllowedLectureQuestion(' L03 '));
  assert.equal(isAllowedLectureQuestion(null), false);
  assert.equal(isAllowedLectureQuestion(1), false);
  assert.equal(isAllowedLectureQuestion(''), false);
});

test('연수 번호는 정확히 일치할 때에만 통과한다', () => {
  assert.ok(isLectureCodeValid('1111', DEFAULT_LECTURE_CODE));
  assert.ok(isLectureCodeValid(' 1111 ', DEFAULT_LECTURE_CODE));
  assert.equal(isLectureCodeValid('1112', DEFAULT_LECTURE_CODE), false);
  assert.equal(isLectureCodeValid('', DEFAULT_LECTURE_CODE), false);
  assert.equal(isLectureCodeValid(null, DEFAULT_LECTURE_CODE), false);
});

test('설정된 번호가 비어 있으면 어떤 입력도 통과시키지 않는다', () => {
  assert.equal(isLectureCodeValid('', ''), false);
  assert.equal(isLectureCodeValid('1111', '   '), false);
});
