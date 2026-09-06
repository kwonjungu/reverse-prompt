'use server';

/**
 * @fileOverview 학생 프롬프트 평가 — 축별 5수준 판정과 운영 채점 결합
 *
 * 논문 대응:
 *  <표 Ⅲ-4> AI·교사 공통 5수준 루브릭과 환산 규칙
 *  <표 Ⅲ-5> 밴드 전환의 확정 명세
 *  <표 Ⅲ-7> 운영 채점 1회의 결합 규칙
 *
 * 채점자는 수준만 판정하고 점수 환산은 코드가 일괄 수행한다.
 * 모델: gemini-3.8-flash (단가는 착수 시점에 재확인)
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import {
  bandOf, toScores, clampLevel, withinOneLevel, combine,
  type Band, type AxisLevels,
} from '@/lib/scoring';
import { buildEvaluationPrompt } from '@/lib/evaluation-prompt';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
  questionLevel: z.number().optional().describe('문항 레벨 1~36'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

/** 축별 수준(1~5). 맥락 축은 A밴드에서 적용하지 않으므로 null이 될 수 있다. */
const AxisLevelsSchema = z.object({
  objectLevel: z.number().describe('대상 완전성 수준 1~5'),
  specificityLevel: z.number().describe('시각적 구체성 수준 1~5'),
  contextLevel: z.number().nullable().describe('맥락 축 수준 1~5. A밴드에서는 null'),
});

/** 채점 모형 1회 호출의 산출 */
const SingleCallSchema = AxisLevelsSchema.extend({
  feedback: z.string().describe('확인 1줄 + 개선 1줄'),
});

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('환산 총점 0~100'),
  feedback: z.string().describe('확인 1줄 + 개선 1줄'),
  band: z.string().describe('적용 밴드 A/B/C'),
  levels: AxisLevelsSchema.describe('결합된 축별 수준. 반수준을 유지한다'),
  axisScores: z.object({
    object: z.number(),
    specificity: z.number(),
    context: z.number().nullable(),
  }).describe('축별 환산 점수'),
  calls: z.array(AxisLevelsSchema).describe('호출별 원 수준. 연구 자료로 저장한다'),
  extraCall: z.boolean().describe('세 번째 호출을 추가하였는지'),
  missing: z.boolean().describe('결측 처리 여부'),
});
export type EvaluatePromptOutput = z.infer<typeof EvaluatePromptOutputSchema>;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  return evaluatePromptFlow(input);
}

type SingleCall = AxisLevels & { feedback: string };

async function runEvaluation(input: EvaluatePromptInput, band: Band): Promise<SingleCall> {
  const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';
  const prompt = buildEvaluationPrompt(band, input.studentPrompt);

  const response = await ai.generate({
    model: 'googleai/gemini-3.8-flash',
    output: { schema: SingleCallSchema },
    prompt: [{ media: { url: input.photoDataUri, contentType } }, { text: prompt }],
    config: { temperature: 0.2 },
  });

  const out = response.output;
  if (!out || !out.feedback) {
    throw new Error(`AI 응답 형식 오류: ${JSON.stringify(out)?.slice(0, 200)}`);
  }
  return {
    objectLevel: clampLevel(out.objectLevel),
    specificityLevel: clampLevel(out.specificityLevel),
    contextLevel: band === 'A' ? null : clampLevel(out.contextLevel),
    feedback: out.feedback,
  };
}

/** 피드백에 학생 글의 실제 표현이 인용되었는지 확인한다(자기검증). */
function hasConcreteCitation(feedback: string, studentPrompt: string): boolean {
  const matches = [...feedback.matchAll(/['"]([^'"]{2,})['"]/g)];
  return matches.some((m) => studentPrompt.includes(m[1]));
}

const evaluatePromptFlow = ai.defineFlow(
  {
    name: 'evaluatePromptFlow',
    inputSchema: EvaluatePromptInputSchema,
    outputSchema: EvaluatePromptOutputSchema,
  },
  async (input): Promise<EvaluatePromptOutput> => {
    const band = bandOf(input.questionLevel ?? 1);
    const missingResult = (msg: string): EvaluatePromptOutput => ({
      score: 0,
      feedback: msg,
      band,
      levels: { objectLevel: 1, specificityLevel: 1, contextLevel: null },
      axisScores: { object: 0, specificity: 0, context: null },
      calls: [],
      extraCall: false,
      missing: true,
    });

    // 실패한 호출에 한하여 1회 재시도한다.
    const callOnce = async (): Promise<SingleCall> => {
      try {
        return await runEvaluation(input, band);
      } catch {
        return await runEvaluation(input, band);
      }
    };

    try {
      // 운영 채점 1회 = 독립 2회 병렬 호출
      const settled = await Promise.allSettled([callOnce(), callOnce()]);
      const ok = settled
        .filter((s): s is PromiseFulfilledResult<SingleCall> => s.status === 'fulfilled')
        .map((s) => s.value);
      if (ok.length < 2) {
        return missingResult('(채점 실패: 필수 호출이 완료되지 않았습니다)');
      }

      const calls: AxisLevels[] = ok.map(({ feedback, ...lv }) => lv);
      let extraCall = false;

      if (!withinOneLevel(calls[0], calls[1])) {
        // 한 축이라도 1수준을 넘게 벌어지면 세 번째 호출 후 축별 중앙값
        try {
          const third = await callOnce();
          const { feedback: _unused, ...lv } = third;
          calls.push(lv);
          ok.push(third);
          extraCall = true;
        } catch {
          return missingResult('(채점 실패: 추가 호출이 완료되지 않았습니다)');
        }
      }

      const levels = combine(calls, extraCall);
      const s = toScores(levels, band);

      // 피드백은 학생 글을 실제로 인용한 호출을 우선 채택한다.
      const cited = ok.find((c) => hasConcreteCitation(c.feedback, input.studentPrompt));
      const feedback = (cited ?? ok[0]).feedback;

      return {
        score: s.total,
        feedback,
        band,
        levels,
        axisScores: { object: s.object, specificity: s.specificity, context: s.context },
        calls,
        extraCall,
        missing: false,
      };
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] 실패:', msg);
      return missingResult(`(AI 평가 실패: ${msg.slice(0, 120)})`);
    }
  }
);
