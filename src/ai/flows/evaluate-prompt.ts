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

  // 세션 성격·권한은 서버가 확정한다.
  const principal = await auth.requirePrincipal();

  // 등록되지 않았거나 이 세션에서 쓸 수 없는 문항이면 여기서 거부된다.
  const entry = registry.requireEntry(questionId, principal.sessionType);

  const run = await grading.runOperationalScoring({
    questionId: entry.questionId,
    band: entry.band,
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
