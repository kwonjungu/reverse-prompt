/**
 * 차시 개방과 모드 차단의 순수 함수 시험.
 *
 * 대응: 프로그램_수정_프롬프트설계서_v7 §4, 수용시험 6·7
 * 실제 모델·Firestore·인증을 부르지 않는다. 판정 규칙만 확인한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LESSON_DENY_MESSAGE,
  closeLesson,
  decideLessonAccess,
  isScheduleControlled,
  openLesson,
  resolveEntryLesson,
  summarizeLessonProgress,
  visibleLessons,
  type LessonOpenState,
} from '@/server/lessons/policy';
import { checkMode, modeForPath, parseAppMode } from '@/server/lessons/mode-policy';
import { allowedModes, isModeAllowed, MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
import type { AppMode } from '@/lib/research/types';

/** 교사가 1차시만 연 연구 수업. */
const lesson1Open: LessonOpenState = {
  sessionType: 'research_practice',
  currentLesson: 1,
  allowedLessons: [1],
  closedAt: null,
};

/** 다음 수업에서 교사가 2차시를 연 상태. */
const lesson2Open: LessonOpenState = {
  sessionType: 'research_practice',
  currentLesson: 2,
  allowedLessons: [1, 2],
  closedAt: null,
};

/* ────────────────── 수용시험 6: 차시 개방 ────────────────── */

test('1차시를 2문항만 한 학생도 교사가 2차시를 열면 참여할 수 있다', () => {
  // 학생의 진행 상황: 1차시 6문항 가운데 2문항만 제출하였다.
  const lesson1QuestionIds = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06'];
  const attempted = ['L01', 'L03'];
  const progress = summarizeLessonProgress(1, attempted, lesson1QuestionIds);
  assert.equal(progress.attempted, 2);
  assert.equal(progress.notAttempted, 4);

  // 교사가 2차시를 열기 전에는 들어갈 수 없다.
  assert.equal(decideLessonAccess(lesson1Open, 2).allowed, false);

  // 교사가 열면 완료 수와 무관하게 들어간다.
  assert.deepEqual(decideLessonAccess(lesson2Open, 2), { allowed: true });
});

test('완료 수는 차시 개방 조건이 아니다', () => {
  // 판정 함수는 서버 기록과 요청 차시만 받는다. 완료 수·점수를 받지 않는다.
  assert.equal(decideLessonAccess.length, 2);

  // 1차시를 6문항 모두 마쳐도 교사가 열지 않은 3차시는 열리지 않는다.
  const allDone = summarizeLessonProgress(
    1,
    ['L01', 'L02', 'L03', 'L04', 'L05', 'L06'],
    ['L01', 'L02', 'L03', 'L04', 'L05', 'L06']
  );
  assert.equal(allDone.attempted, 6);
  assert.equal(allDone.notAttempted, 0);

  const denied = decideLessonAccess(lesson2Open, 3);
  assert.equal(denied.allowed, false);
  assert.equal(denied.allowed === false && denied.reason, 'not_opened');
});

test('허용되지 않은 차시 진입은 거부한다', () => {
  // 학생이 URL을 ?lesson=3으로 바꾸어도 서버가 거절한다.
  const denied = decideLessonAccess(lesson2Open, 3);
  assert.equal(denied.allowed, false);
  assert.equal(denied.allowed === false && denied.message, LESSON_DENY_MESSAGE.not_opened);

  // 요청이 거절되면 서버가 진입 차시를 다시 정한다. 3차시로 가지 않는다.
  assert.equal(resolveEntryLesson(lesson2Open, 3), 2);

  // 없는 차시 번호와 형식이 틀린 값도 거절한다.
  for (const bad of [0, 7, 2.5, '2', null, undefined, NaN]) {
    const d = decideLessonAccess(lesson2Open, bad);
    assert.equal(d.allowed, false, `허용하면 안 되는 값: ${String(bad)}`);
  }

  // 화면의 단계 목록도 서버가 연 차시만 보여 준다.
  assert.deepEqual(visibleLessons(lesson2Open), [1, 2]);
});

test('세션을 닫으면 어떤 차시에도 들어갈 수 없다', () => {
  const closed: LessonOpenState = { ...lesson2Open, closedAt: '2026-09-07T02:00:00.000Z' };
  const d = decideLessonAccess(closed, 2);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'session_closed');
  assert.deepEqual(visibleLessons(closed), []);
  assert.equal(resolveEntryLesson(closed, 2), null);
});

test('일반 체험은 자율 진행을 유지한다', () => {
  const experience: LessonOpenState = {
    sessionType: 'experience',
    currentLesson: null,
    allowedLessons: [],
    closedAt: null,
  };
  assert.equal(isScheduleControlled('experience'), false);
  assert.equal(isScheduleControlled('research_practice'), true);
  assert.equal(decideLessonAccess(experience, 5).allowed, true);
  assert.deepEqual(visibleLessons(experience), [1, 2, 3, 4, 5, 6]);
});

test('차시를 열어도 앞 차시는 닫지 않는다', () => {
  assert.deepEqual(openLesson([1], 2), [1, 2]);
  assert.deepEqual(openLesson([1, 2], 2), [1, 2]);
  assert.deepEqual(openLesson([2, 1], 3), [1, 2, 3]);
  // 범위를 벗어난 차시는 목록에 넣지 않는다.
  assert.deepEqual(openLesson([1], 9), [1]);
  // 교사가 특정 차시만 다시 닫을 수 있다.
  assert.deepEqual(closeLesson([1, 2, 3], 2), [1, 3]);
});

test('기록이 없으면 진입할 차시도 없다', () => {
  const none: LessonOpenState = {
    sessionType: 'research_practice',
    currentLesson: null,
    allowedLessons: [],
    closedAt: null,
  };
  assert.equal(resolveEntryLesson(none, 1), null);
  assert.deepEqual(visibleLessons(none), []);
});

/* ────────────────── 수용시험 7: 모드 차단 ────────────────── */

test('연구 수업에서는 게임·타임어택·감수·생성을 거부한다', () => {
  const blocked: AppMode[] = ['game', 'time-attack', 'audit', 'generate'];
  for (const mode of blocked) {
    const d = checkMode('research_practice', mode);
    assert.equal(d.allowed, false, `연구 수업에서 허용되면 안 되는 모드: ${mode}`);
    assert.equal(d.message, MODE_BLOCKED_MESSAGE);
  }
  // 설명·연습은 연구 수업에서 열린다.
  assert.equal(checkMode('research_practice', 'guide').allowed, true);
  assert.equal(checkMode('research_practice', 'practice').allowed, true);
});

test('연구 검사 중에는 검사 화면만 열린다', () => {
  const other: AppMode[] = ['guide', 'practice', 'game', 'time-attack', 'audit', 'generate'];
  for (const mode of other) {
    assert.equal(
      checkMode('research_assessment', mode).allowed,
      false,
      `검사 중 허용되면 안 되는 모드: ${mode}`
    );
  }
  assert.equal(checkMode('research_assessment', 'assessment').allowed, true);
});

test('일반 체험의 기존 의도는 그대로 둔다', () => {
  assert.deepEqual(allowedModes('experience').sort(), ['game', 'guide', 'practice', 'time-attack']);
  assert.equal(isModeAllowed('experience', 'game'), true);
  assert.equal(isModeAllowed('experience', 'time-attack'), true);
  // 감수와 생성은 일반 체험에서도 학생 모드가 아니다.
  assert.equal(isModeAllowed('experience', 'audit'), false);
  assert.equal(isModeAllowed('experience', 'generate'), false);
});

test('직접 경로도 같은 표로 판정한다', () => {
  assert.equal(modeForPath('/game'), 'game');
  assert.equal(modeForPath('/time-attack/'), 'time-attack');
  assert.equal(modeForPath('/admin'), 'audit');
  assert.equal(modeForPath('/api/generate/image'), 'generate');
  assert.equal(modeForPath('/practice'), 'practice');
  assert.equal(modeForPath('/teacher'), null);

  // 경로에서 얻은 모드가 연구 세션에서 막히는지 확인한다.
  for (const path of ['/game', '/time-attack', '/admin', '/api/generate/image']) {
    const mode = modeForPath(path);
    assert.ok(mode, `경로에 대응하는 모드가 있어야 한다: ${path}`);
    assert.equal(isModeAllowed('research_practice', mode as AppMode), false);
  }
});

test('모르는 모드 이름은 허용하지 않는다', () => {
  assert.equal(parseAppMode('game'), 'game');
  assert.equal(parseAppMode('games'), null);
  assert.equal(parseAppMode(''), null);
  assert.equal(parseAppMode(null), null);
  assert.equal(parseAppMode(123), null);
});
