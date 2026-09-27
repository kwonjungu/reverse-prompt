'use server';

/**
 * @fileOverview 게임·타임어택 화면이 쓰는 얇은 서버 액션 — 옛 공통 루브릭 v7(5수준·100점) 채점.
 *
 * 연습·검사·연수 채점은 공통 루브릭 v12-2(src/server/grading/operational.ts)로 하며 이 액션을 쓰지 않는다.
 * 게임·타임어택은 이번 루브릭 전환에서 제외해 예전 채점을 그대로 쓴다(src/server/grading/legacy-v7.ts).
 *
 * 이 파일은 클라이언트 화면이 import 하므로 서버 액션 ID가 번들에 실려 나가고, 화면을 거치지 않고
 * 직접 호출될 수 있다. 화면에서 막았다는 것을 근거로 삼지 않고 여기서 다시 판정한다.
 *
 *   1. 세션 성격을 서버가 확정한다. 확정하지 못한 요청은 채점하지 않는다.
 *   2. 일반 체험 세션만 받는다. 연구 세션(연습·검사)은 게임·타임어택을 쓰지 않으므로 거부한다.
 *   3. 게임·타임어택 문항(game-XX, ta-XX)만 받는다. 연습 문항(L01~L36)은 연습 화면에서만 채점한다.
 *   4. 결과를 저장하지 않는다. 이 점수는 연구 자료가 아니다.
 *
 * status가 'missing'이면 점수는 0이 아니라 null이다. 화면은 결측을 최저 수행처럼 보여 주지 않는다.
 */

import { randomUUID } from 'node:crypto';
import { auth } from '@/server/auth';
import { ensureCuePackLoaded, registry } from '@/server/registry';
import { legacyV7Grading } from '@/server/grading';
import { assertModeAllowed } from '@/server/lessons/mode-policy';
import type { Band } from '@/lib/scoring';
import type { FeedbackPresentation } from '@/lib/research/types';
import type { LegacyOperationalResult } from '@/lib/legacy-v7/types';

export interface EvaluatePromptInput {
  /** 서버 레지스트리에 등록된 게임·타임어택 문항 ID. 밴드·이미지의 유일한 근거다. */
  questionId: string;
  /** 학생이 작성한 한국어 프롬프트. 평가 대상 데이터이며 채점 지시가 아니다. */
  studentPrompt: string;
}

export interface EvaluatePromptOutput {
  questionId: string;
  band: Band;
  result: LegacyOperationalResult;
  feedback: FeedbackPresentation | null;
  extraCall: boolean;
}

/** 학생 화면에 그대로 보여 줄 거절 문구. 구현 용어를 쓰지 않는다. */
const NOT_THIS_ACTIVITY_MESSAGE = '지금은 선생님이 연 활동만 할 수 있어요.';

/** 게임·타임어택 문항 ID */
const GAME_QUESTION_ID = /^(game|ta)-\d{2}$/;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  const questionId = typeof input?.questionId === 'string' ? input.questionId.trim() : '';
  if (!questionId) {
    throw new Error('questionId가 없습니다. 문항을 확정할 수 없어 채점하지 않습니다.');
  }
  const studentText = typeof input?.studentPrompt === 'string' ? input.studentPrompt.trim() : '';
  if (!studentText) {
    // 무응답은 모델 실패가 아니라 결측이다. 여기서 최저 점수를 만들지 않는다.
    throw new Error('응답이 비어 있습니다.');
  }

  // 1) 세션 성격·권한은 서버가 확정한다. 인증이 없으면 AuthError가 그대로 올라간다.
  const principal = await auth.requirePrincipal();

  // 2) 게임·타임어택은 일반 체험 전용이다. 연구 세션은 여기서 멈춘다.
  if (principal.sessionType !== 'experience') throw new Error(NOT_THIS_ACTIVITY_MESSAGE);
  assertModeAllowed(principal.sessionType, 'game');

  // 3) 게임·타임어택 문항만. 등록되지 않았거나 이 세션에서 쓸 수 없는 문항이면 여기서 거부된다.
  if (!GAME_QUESTION_ID.test(questionId)) throw new Error(NOT_THIS_ACTIVITY_MESSAGE);
  await ensureCuePackLoaded();
  const entry = registry.requireEntry(questionId, principal.sessionType);

  const run = await legacyV7Grading.runOperationalScoring({
    questionId: entry.questionId,
    studentText,
    operationId: randomUUID(),
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
