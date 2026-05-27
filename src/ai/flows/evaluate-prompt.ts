'use server';

/**
 * @fileOverview 학생 프롬프트 평가 (초등 3~6학년 대상).
 * 모델: gemini-2.5-flash (이미지+한국어, 학생 1회 평가 약 ₩2 수준)
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('점수 (50-95)'),
  feedback: z.string().describe('2줄 피드백 (칭찬 1줄 + 개선 1줄)'),
});
export type EvaluatePromptOutput = z.infer<typeof EvaluatePromptOutputSchema>;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  return evaluatePromptFlow(input);
}

const evaluatePromptFlow = ai.defineFlow(
  {
    name: 'evaluatePromptFlow',
    inputSchema: EvaluatePromptInputSchema,
    outputSchema: EvaluatePromptOutputSchema,
  },
  async (input) => {
    const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';

    try {
      const response = await ai.generate({
        model: 'googleai/gemini-2.5-flash',
        output: { schema: EvaluatePromptOutputSchema },
        prompt: [
          { media: { url: input.photoDataUri, contentType } },
          { text: `너는 초등학교 담임 선생님이야. 3~6학년 학생이 그림을 보고 한국어로 묘사한 글을 평가해.

학생 글: "${input.studentPrompt}"

[채점]
- 대상(무엇/누가) · 묘사(색·모양·동작) · 분위기(느낌·배경) 세 가지 중 몇 개를 다뤘는지 본다.
- 3개 다 = 90~95, 2개 = 75~85, 1개 = 60~70, 0개 = 50~55. 절대 100점 주지 마.
- 그림과 너무 다른 내용이면 -10.

[피드백 — 정확히 2줄]
- 1줄: 학생이 실제로 쓴 단어 하나를 큰따옴표로 그대로 인용하며 칭찬.
  예) "'복슬복슬한'이라는 표현, 그림이랑 딱 맞아요!"
- 2줄: 그림에서 학생이 놓친 부분 1개만 짚고, 다음에 써볼 단어 2개 제안.
  예) "강아지 색깔도 같이 적어볼까요? '갈색', '얼룩무늬' 같은 단어가 어울려요."

[금지]
- "대단해요/감동/최고" 같은 추상 칭찬으로 끝내기 X
- 한 번에 여러 개 지적 X (1개만)
- 마크다운(*, #, -) X

score와 feedback 두 필드로 JSON 응답.` }
        ],
        config: {
          temperature: 0.5,
        },
      });

      const out = response.output;
      if (!out || typeof out.score !== 'number' || !out.feedback) {
        throw new Error(`AI 응답 형식 오류: ${JSON.stringify(out)?.slice(0, 200)}`);
      }

      out.score = Math.max(50, Math.min(95, Math.round(out.score)));
      return out;
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] 실패:', msg);
      return {
        score: 50,
        feedback: `(⚠️ AI 평가 실패: ${msg.slice(0, 120)})`,
      };
    }
  }
);
