/**
 * 연수(강의) 모드의 순수 규칙 시험.
 *
 * 여기서 고정하는 것
 *   1. 연수에서 쓰는 문항이 20개 고정이고 연습 문항의 부분집합이라는 것
 *   2. 문항이 6단계 제시 순서(3단계 L19~ 다음 4단계 L13~)를 따른다는 것
 *   3. 목록에 없는 문항 ID를 서버가 받아 주지 않는다는 것
 *   4. 연수 번호 대조가 정확히 일치할 때에만 통과한다는 것
 *   5. 화면에 돌려주는 채점 결과가 영역별 수준(공통 루브릭 v12-2)이고 100점 점수가 없다는 것,
 *      결측이면 수준·피드백을 지어내지 않는다는 것
 *   6. 연구 세션 힌트가 있는 요청은 연수 체험판을 열지 않는다는 것(세션 없는 연수 참가자는 통과)
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
  lectureResultOf,
  LECTURE_SCORING_MISSING_MESSAGE,
} from '../src/server/lecture/core';
import { presentationOrderOf, STAGES } from '../src/lib/stages';
import type { ScoringRun } from '../src/lib/research/types';
import {
  isLectureBlockedFor,
  isLecturePath,
  modeForPath,
} from '../src/server/lessons/mode-policy';

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

test('연수 문항은 여섯 단계를 모두 지나며 단계 제시 순서를 지킨다', () => {
  const chasis = LECTURE_QUESTIONS.map((q) => q.chasi);
  assert.deepEqual([...new Set(chasis)], [1, 2, 3, 4, 5, 6]);
  // 화면 순서가 곧 단계 순서다. 뒤로 갈수록 단계가 내려가지 않는다.
  for (let i = 1; i < chasis.length; i += 1) {
    assert.ok(chasis[i] >= chasis[i - 1], `단계 순서가 뒤집혔다: ${i}`);
  }
  // 연습 화면의 제시 순서(src/lib/stages.ts)와도 어긋나지 않는다.
  const orders = LECTURE_LEVELS.map((level) => presentationOrderOf(level));
  for (let i = 1; i < orders.length; i += 1) {
    assert.ok((orders[i] ?? 0) > (orders[i - 1] ?? 0), `제시 순서가 뒤집혔다: ${i}`);
  }
  // 문항의 단계는 6단계 표가 정한 값 그대로다(3단계=L19–L24, 4단계=L13–L18).
  for (const q of LECTURE_QUESTIONS) {
    const stage = STAGES.find((s) => s.levels.includes(q.level));
    assert.equal(q.chasi, stage?.chasi, `L${q.level}의 단계`);
  }
  const perStage = [1, 2, 3, 4, 5, 6].map((c) => chasis.filter((x) => x === c).length);
  assert.deepEqual(perStage, [3, 3, 3, 3, 4, 4]);
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

/* ────────────────────────── 화면에 돌려줄 채점 결과 ────────────────────────── */

function judgment(level: 1 | 2 | 3 | 4 | 'not_applicable') {
  return level === 'not_applicable'
    ? { level, evidence: null, missing: [], evidenceMissing: [] }
    : { level, evidence: '사과', missing: level < 4 ? ['수량'] : [], evidenceMissing: [] };
}

type RunPart = Pick<ScoringRun, 'result' | 'band' | 'feedback'>;

test('채점되면 영역별 수준만 돌려주고 100점 점수는 없다', () => {
  const run: RunPart = {
    band: 'A',
    result: {
      status: 'scored',
      areas: { object: judgment(3), feature: judgment(2), relation: judgment('not_applicable') },
      feedbackStatus: 'verified',
    },
    feedback: {
      status: 'verified',
      text: '이번 목표는 그림을 못 본 친구가 똑같이 떠올리게 쓰는 거예요.\n[대상] "사과"라고 썼어요.\n[특징] 사과의 색을 써 보세요.\n"빨간"처럼 써 볼 수 있어요.',
      quote: '사과',
      regenerated: false,
    },
  };
  const out = lectureResultOf(run);
  assert.deepEqual(out.scoring, {
    status: 'scored',
    levels: { object: 3, feature: 2, relation: 'not_applicable' },
    band: 'A',
  });
  assert.equal(out.feedback?.status, 'verified');
  assert.equal(out.feedback?.text.split('\n').length, 4);
  const json = JSON.stringify(out);
  // 점수·근거·빠진 정보 목록은 화면으로 넘기지 않는다.
  assert.equal('score' in out.scoring, false);
  assert.equal(json.includes('"score":'), false);
  assert.equal(json.includes('"missing":'), false);
  assert.equal(json.includes('"evidence":'), false);
});

test('결측이면 수준도 피드백도 지어내지 않는다', () => {
  const out = lectureResultOf({
    band: 'B',
    result: { status: 'missing', areas: null, reason: 'schema_error' },
    feedback: null,
  });
  assert.deepEqual(out, {
    scoring: { status: 'missing', message: LECTURE_SCORING_MISSING_MESSAGE },
    feedback: null,
  });
});

test('피드백 검증에 실패한 고정 안내도 상태와 함께 그대로 넘긴다', () => {
  const out = lectureResultOf({
    band: 'C',
    result: {
      status: 'scored',
      areas: { object: judgment(4), feature: judgment(4), relation: judgment(4) },
      feedbackStatus: 'fallback',
    },
    feedback: { status: 'fallback', text: '표현을 선생님과 함께 확인해 보세요', quote: null, regenerated: true },
  });
  assert.equal(out.scoring.status, 'scored');
  assert.deepEqual(out.feedback, { text: '표현을 선생님과 함께 확인해 보세요', status: 'fallback' });
});

test('연구 세션 힌트가 있으면 연수 체험판을 막고, 세션 없는 연수 참가자·일반 체험은 통과한다', () => {
  assert.equal(isLectureBlockedFor(null), false, '연수 참가자는 학생 세션이 없다');
  assert.equal(isLectureBlockedFor(undefined), false);
  assert.equal(isLectureBlockedFor('experience'), false);
  assert.equal(isLectureBlockedFor('research_practice'), true);
  assert.equal(isLectureBlockedFor('research_assessment'), true);
});

test('연수 경로 판정은 /lecture와 그 아래만 잡고 모드 표에는 넣지 않는다', () => {
  assert.equal(isLecturePath('/lecture'), true);
  assert.equal(isLecturePath('/lecture/x'), true);
  assert.equal(isLecturePath('/lectures'), false);
  assert.equal(isLecturePath('/practice'), false);
  // 모드 표에 넣으면 힌트 없는 연수 참가자가 막힌다.
  assert.equal(modeForPath('/lecture'), null);
});
