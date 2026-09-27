/**
 * 연수(강의) 모드가 쓰는 고정 20문항.
 *
 * 연수에서는 교사가 단계를 열어 줄 사람도, 수업 번호도 없다. 그래서 연습 36문항
 * 전체를 단계별로 나눠 보여 주는 대신, 여섯 단계에서 고르게 뽑은 20문항을
 * 1~20번으로 늘어놓고 순서대로 쓰게 한다. 목록은 여기 한 곳에서만 정한다.
 *
 * 순서는 연습 모드의 6단계 제시 순서(src/lib/stages.ts)를 그대로 따른다.
 *   1~3번   1단계 도구와 작성 방식 이해  (L01·L03·L05, A밴드)
 *   4~6번   2단계 대상과 수량            (L07·L09·L11, A밴드)
 *   7~9번   3단계 특징                   (L19·L21·L23, B밴드)
 *   10~12번 4단계 관계                   (L13·L15·L17, B밴드)
 *   13~16번 5단계 피드백 검토와 재작성   (L25·L27·L29·L30, C밴드)
 *   17~20번 6단계 종합                   (L31·L33·L35·L36, C밴드)
 * 3단계(L19–L24)가 4단계(L13–L18)보다 앞에 오므로 문항 번호 순서와 화면 순서가 다르다.
 *
 * 뒤 두 단계를 4문항씩 둔 것은 연수에서 보여 줄 것이 그쪽에 많기 때문이며,
 * 연구 설계가 정한 배분이 아니다. 이 목록은 연구 자료 수집에 쓰지 않는다.
 *
 * 이 파일은 클라이언트 번들에 실린다. 채점 단서·제작 프롬프트를 두지 않는다.
 */

import { PRACTICE_QUESTIONS, type PracticeQuestion } from '@/lib/questions';

/**
 * 연수에서 쓸 연습 문항의 번호(level). 연습 36문항의 부분집합이며 순서가 곧 화면 순서다.
 * 단계 제시 순서를 지킨다(3단계 L19~ 다음에 4단계 L13~). 문항을 바꾸려면 이 배열만 고친다.
 */
export const LECTURE_LEVELS: readonly number[] = [
  1, 3, 5,
  7, 9, 11,
  19, 21, 23,
  13, 15, 17,
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
