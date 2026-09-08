/**
 * 연수 모드의 판정 규칙 — 파일 시스템도 환경 변수도 읽지 않는 순수 모듈.
 *
 * 배선(쿠키·채점기·개인정보 점검)은 같은 디렉터리의 actions.ts가 맡는다.
 * 여기 있는 규칙만 순수 함수 시험으로 고정한다(tests/lecture.test.ts).
 *
 * 이 경로가 무엇이고 무엇이 아닌지는 actions.ts 머리글에 적어 두었다.
 */

import { isLectureQuestionId } from '@/lib/lecture-questions';

/** 연수 코드가 설정되지 않았을 때 쓰는 기본값. 비밀이 아니며 칠판에 적는 값이다. */
export const DEFAULT_LECTURE_CODE = '1111';

/** 학생 화면에 그대로 보여 줄 문구. 구현 용어를 쓰지 않는다. */
export const LECTURE_CODE_WRONG_MESSAGE = '번호가 맞지 않아요. 화면에 적힌 번호를 다시 확인해 주세요.';
export const LECTURE_LOCKED_MESSAGE = '먼저 연수 번호를 입력해 주세요.';
export const LECTURE_UNKNOWN_QUESTION_MESSAGE = '연수에서 쓰지 않는 문항이에요.';

/**
 * 입력한 코드가 맞는가.
 *
 * 길이가 짧은 고정 코드이므로 타이밍 공격을 막았다고 주장하지 않는다. 이 코드는
 * 연수장에서 공유하는 값이고, 막으려는 것은 URL이 밖으로 퍼졌을 때의 무작위 접근이다.
 * 앞뒤 공백만 다듬고 그대로 비교한다.
 */
export function isLectureCodeValid(input: unknown, expected: string): boolean {
  if (typeof input !== 'string') return false;
  const given = input.trim();
  const want = expected.trim();
  if (!want) return false;
  return given === want;
}

/** 연수 모드가 받아 줄 문항인가. 연습 36문항 가운데 목록에 있는 20개만 허용한다. */
export function isAllowedLectureQuestion(questionId: unknown): questionId is string {
  return typeof questionId === 'string' && isLectureQuestionId(questionId.trim());
}
