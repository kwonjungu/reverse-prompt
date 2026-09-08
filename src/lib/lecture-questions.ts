/**
 * 연수(강의) 모드가 쓰는 고정 20문항.
 *
 * 연수에서는 교사가 차시를 열어 줄 사람도, 수업 번호도 없다. 그래서 연습 36문항
 * 전체를 차시별로 나눠 보여 주는 대신, 여섯 차시에서 고르게 뽑은 20문항을
 * 1~20번으로 늘어놓고 순서대로 쓰게 한다. 목록은 여기 한 곳에서만 정한다.
 *
 * 순서는 연습 모드의 난이도 진행을 그대로 따른다.
 *   1~3번   색·모양            (연습 1차시, A밴드)
 *   4~6번   크기·개수          (연습 2차시, A밴드)
 *   7~9번   배경·행동          (연습 3차시, B밴드)
 *   10~12번 질감·자세          (연습 4차시, B밴드)
 *   13~16번 시간대·분위기      (연습 5차시, C밴드)
 *   17~20번 3축 종합           (연습 6차시, C밴드)
 *
 * 뒤 두 차시를 4문항씩 둔 것은 연수에서 보여 줄 것이 그쪽에 많기 때문이며,
 * 연구 설계가 정한 배분이 아니다. 이 목록은 연구 자료 수집에 쓰지 않는다.
 *
 * 이 파일은 클라이언트 번들에 실린다. 채점 단서·제작 프롬프트를 두지 않는다.
 */

import { PRACTICE_QUESTIONS, type PracticeQuestion } from '@/lib/questions';

/**
 * 연수에서 쓸 연습 문항의 레벨. 연습 36문항의 부분집합이며 순서가 곧 화면 순서다.
 * 문항을 바꾸려면 이 배열만 고친다.
 */
export const LECTURE_LEVELS: readonly number[] = [
  1, 3, 5,
  7, 9, 11,
  13, 15, 17,
  19, 21, 23,
  25, 27, 29, 30,
  31, 33, 35, 36,
];

/**
 * 문항 ID 규칙은 연습 문항과 같다(L01~L36).
 * 서버 레지스트리의 practiceQuestionId와 같은 규칙이며, 그 파일은 서버 전용
 * 디렉터리에 있어 여기서 불러 쓰지 않는다. 규칙을 고치면 양쪽을 함께 고친다.
 */
export function lectureQuestionId(level: number): string {
  return `L${String(level).padStart(2, '0')}`;
}

/** 연수 모드 문항 20개. 화면 순서대로. */
export const LECTURE_QUESTIONS: PracticeQuestion[] = LECTURE_LEVELS.map((level) => {
  const found = PRACTICE_QUESTIONS.find((q) => q.level === level);
  if (!found) {
    // 목록을 고치다 없는 레벨을 적으면 빌드가 아니라 여기서 바로 드러나게 한다.
    throw new Error(`연수 문항 목록에 없는 연습 레벨이 있습니다: ${level}`);
  }
  return found;
});

/** 연수 모드에서 낼 수 있는 문항인가. 서버가 questionId를 받을 때 확인한다. */
export function isLectureQuestionId(questionId: string): boolean {
  return LECTURE_QUESTIONS.some((q) => lectureQuestionId(q.level) === questionId);
}
