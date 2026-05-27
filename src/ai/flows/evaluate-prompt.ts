'use server';

/**
 * @fileOverview 학생의 프롬프트를 평가하는 AI 에이전트.
 * 초등학생용 구체적 피드백을 생성하며, 호출 실패 시에도 어디서 막혔는지 드러나는 메시지를 반환.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('점수 (0-100)'),
  feedback: z.string().describe('초등학생이 이해할 수 있는 구체적인 피드백'),
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
        model: 'googleai/gemini-2.5-pro',
        output: { schema: EvaluatePromptOutputSchema },
        prompt: [
          { media: { url: input.photoDataUri, contentType } },
          { text: `너는 초등학교 3~6학년 학생을 가르치는 친절한 AI 프롬프트 코치야.
학생이 그림을 보고 한국어로 설명(프롬프트)을 썼어. 이 설명이 그림을 얼마나 잘 묘사했는지 평가해줘.

[학생이 쓴 프롬프트]
"${input.studentPrompt}"

[채점 기준]
1) 누가/무엇이 (그림 속 주인공이나 사물을 정확히 말했는지)
2) 어떻게 (모양, 색깔, 행동, 표정을 묘사했는지)
3) 분위기/스타일 (느낌이나 그림체를 말했는지)
4) 배경/장소 (어디인지, 주변에 뭐가 있는지)

각 항목마다 학생 글에 있으면 점수 더하고, 빠지면 그 부분을 콕 짚어서 알려줘.

[점수 부여]
- 4개 다 들어있으면 90~100
- 3개면 80~89
- 2개면 70~79
- 1개면 60~69
- 0개거나 그림과 거리가 멀면 50점대
- 초등학생이니까 0점은 절대 주지 마. 최소 50점.

[피드백 작성 규칙 — 매우 중요]
- 반드시 한국어, 초등학생이 쓰는 쉬운 말투("~했어요!", "~네요!", "~해볼까요?")
- 3줄로 정확히 구성:
  1줄: 학생이 잘 쓴 단어/표현 1개를 따옴표로 그대로 인용하며 칭찬
     예) "'반짝반짝'이라고 쓴 부분, 정말 멋져요!"
  2줄: 부족한 항목 1개를 콕 집어서, 그림에 실제로 보이는 단서를 알려줌
     예) "그림 속 강아지가 어떤 색인지도 같이 적어보면 어떨까요? 갈색 털이 보이거든요."
  3줄: 다음에 써볼 만한 구체적인 단어 예시 2~3개를 보여줌
     예) "예를 들어 '복슬복슬한', '꼬리를 흔드는', '귀가 쫑긋한' 같은 단어를 써보세요!"
- 절대 일반적인 칭찬("대단해요", "감동받았어요", "최고가 될 수 있어요")으로 끝내지 마.
  반드시 그림이나 학생 프롬프트에서 본 구체적 단어를 인용해야 함.
- 마크다운(*, #, -) 쓰지 마. 줄바꿈은 \\n으로.

지금 바로 score와 feedback 두 필드로 JSON 응답해줘.` }
        ],
        config: {
          temperature: 0.7,
        },
      });

      if (!response.output) {
        throw new Error('AI 응답이 비어있음 (output null). raw text: ' + (response.text?.slice(0, 200) ?? '없음'));
      }

      const out = response.output;

      if (typeof out.score !== 'number' || !out.feedback) {
        throw new Error(`AI 응답 형식 오류: score=${out.score}, feedback=${typeof out.feedback}`);
      }

      out.score = Math.max(50, Math.min(100, Math.round(out.score)));

      return out;
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] AI 호출 실패:', msg, error?.stack);

      return {
        score: 50,
        feedback: `(⚠️ AI 평가에 실패해서 임시 점수만 표시 중이에요. 선생님께 알려주세요.)\n\n학생이 쓴 글: "${input.studentPrompt}"\n실패 원인: ${msg.slice(0, 150)}`,
      };
    }
  }
);
