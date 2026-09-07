'use server';

/**
 * @fileOverview 연습 화면이 쓰는 얇은 서버 액션. 실제 채점은 서버 채점기에 위임한다.
 *
 * 논문 대응:
 *  <표 Ⅲ-4> AI·교사 공통 5수준 루브릭과 환산 규칙
 *  <표 Ⅲ-5> 밴드 전환의 확정 명세
 *  <표 Ⅲ-7> 운영 채점 1회의 결합 규칙
 *
 * 클라이언트는 questionId만 보낸다. 밴드·이미지·문항별 단서는 서버가 questionId로
 * 확정한다. 클라이언트가 보낸 밴드·이미지 데이터 URI·문항 레벨은 신뢰하지 않는다.
 * 누락되었거나 등록되지 않은 questionId는 거부한다.
 *
 * 이 파일은 게임·타임어택 화면도 import 한다. 그러므로 서버 액션 ID가 클라이언트
 * 번들에 실려 나가며, 화면을 거치지 않고 직접 호출될 수 있다. 화면에서 이미 막았다는
 * 것을 근거로 삼지 않고 여기서 다시 판정한다(설계서 §4·§6, 수용시험 7·11).
 *
 *   1. 세션 성격을 서버가 확정한다. 확정하지 못한 요청은 채점하지 않는다.
 *   2. 연습 채점이 허용되지 않는 세션(검사 중)은 거부한다.
 *   3. 연구 세션은 교사가 연 차시의 문항만 채점한다. 열리지 않은 차시는 거부한다.
 *   4. 연구 세션은 보호자 동의와 학생 승낙이 모두 활성일 때만 외부 모델로 보낸다.
 *      미동의·철회자는 여기서 멈춘다.
 *
 * 반환 타입(연습 화면이 그대로 쓰는 형):
 *
 *   type EvaluatePromptOutput = {
 *     questionId: string;
 *     band: 'A' | 'B' | 'C';
 *     result:
 *       | { status: 'scored'; levels: AxisLevels; score: number;
 *           axisScores: AxisScores; feedbackStatus: 'verified'|'fallback'|'not_requested' }
 *       | { status: 'missing'; levels: null; score: null; axisScores: null;
 *           reason: 'model_error'|'schema_error'|'required_call_failed' };
 *     feedback: { status; text; quote; regenerated } | null;
 *     extraCall: boolean;
 *   }
 *
 * status가 'missing'이면 점수는 0이 아니라 null이다. 화면은 결측을 최저 수행처럼
 * 보여 주지 않는다. 호출 이력·지시문 해시·모델 ID는 연구 자료로만 남기고 이 반환값에
 * 담지 않는다.
 */

import { randomUUID } from 'node:crypto';
import { auth } from '@/server/auth';
import { registry } from '@/server/registry';
import { grading } from '@/server/grading';
import { assertModeAllowed } from '@/server/lessons/mode-policy';
import { getLessonStateAction } from '@/server/lessons/actions';
import type { Band } from '@/lib/scoring';
import type { FeedbackPresentation, OperationalResult } from '@/lib/research/types';

export interface EvaluatePromptInput {
  /** 서버 레지스트리에 등록된 문항 ID. 밴드·이미지·단서의 유일한 근거다. */
  questionId: string;
  /** 학생이 작성한 한국어 프롬프트. 평가 대상 데이터이며 채점 지시가 아니다. */
  studentPrompt: string;
}

export interface EvaluatePromptOutput {
  questionId: string;
  band: Band;
  result: OperationalResult;
  feedback: FeedbackPresentation | null;
  extraCall: boolean;
}

/** 학생 화면에 그대로 보여 줄 거절 문구. 구현 용어를 쓰지 않는다. */
const NOT_OPEN_MESSAGE = '아직 선생님이 열지 않은 단계예요.';
const NO_CONSENT_MESSAGE = '지금은 이 활동의 기록을 남길 수 없어요. 선생님께 여쭤보세요.';

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  const questionId = typeof input?.questionId === 'string' ? input.questionId.trim() : '';
  if (!questionId) {
    throw new Error('questionId가 없습니다. 문항을 확정할 수 없어 채점하지 않습니다.');
  }
  const studentText = typeof input?.studentPrompt === 'string' ? input.studentPrompt.trim() : '';
  if (!studentText) {
    // 무응답은 모델 실패가 아니라 제출 단계의 결측이다. 여기서 최저 점수를 만들지 않는다.
    throw new Error('응답이 비어 있습니다. 제출 단계에서 결측으로 기록합니다.');
  }

  // 1) 세션 성격·권한은 서버가 확정한다. 인증이 없으면 AuthError가 그대로 올라간다.
  const principal = await auth.requirePrincipal();

  // 2) 이 세션에서 연습 채점 자체가 허용되는가. 검사 중에는 AI를 부르지 않는다.
  assertModeAllowed(principal.sessionType, 'practice');

  // 3) 등록되지 않았거나 이 세션에서 쓸 수 없는 문항이면 여기서 거부된다.
  const entry = registry.requireEntry(questionId, principal.sessionType);

  if (principal.sessionType !== 'experience') {
    // 4) 차시 개방은 교사가 서버에서 정한다. 완료 수·점수·기기 저장값은 근거가 아니다.
    const lessonState = await getLessonStateAction(entry.lesson);
    if (!lessonState.verified) throw new Error(NOT_OPEN_MESSAGE);
    if (entry.lesson === null || !lessonState.allowedLessons.includes(entry.lesson)) {
      throw new Error(lessonState.deniedMessage ?? NOT_OPEN_MESSAGE);
    }

    // 5) 미동의·철회자의 응답은 외부 모델로 보내지 않는다. 상태는 서버에서 조회한다.
    if (!principal.researchId) throw new Error(NO_CONSENT_MESSAGE);
    await auth.requireActiveResearchConsent(principal.researchId);
  }

  const run = await grading.runOperationalScoring({
    questionId: entry.questionId,
    studentText,
    operationId: randomUUID(),
    // 연습 즉시 채점은 주 자료 1회분이다. 신뢰도 반복은 별도 작업에서 수행한다.
    repeatIndex: 1,
    sessionType: principal.sessionType,
    wantFeedback: true,
  });

  return {
    questionId: entry.questionId,
    band: run.band,
    result: run.result,
    feedback: run.feedback,
    extraCall: run.extraCall,
  };
}
