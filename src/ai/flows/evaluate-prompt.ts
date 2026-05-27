'use server';

/**
 * @fileOverview 학생 프롬프트 평가 — 교육학적 근거 기반 채점
 *
 * 이론적 배경:
 *  1. Bloom의 인지 발달 위계(1956, 2001 개정판) — 대상 식별→속성 기술→맥락 종합 단계
 *  2. 한국 초등학교 국어과 교육과정(2022 개정) — 3~4학년 '대상의 특성 파악하여 표현하기'
 *  3. AI Literacy Framework (Long & Magerko, 2020, CHI) — Precision·Completeness·Specificity
 *  4. 6+1 Trait Writing Model (Culham, 2003) — 어휘 선택·구체성 평가
 *
 * 모델: gemini-2.5-flash (1회 약 ₩2)
 * 레벨별 채점 기준 자동 조정 + 자기검증 루프
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
  questionLevel: z.number().optional().describe('문제 난이도 레벨 (1~15)'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('점수 0~100'),
  feedback: z.string().describe('칭찬 1줄 + 개선 1줄'),
});
export type EvaluatePromptOutput = z.infer<typeof EvaluatePromptOutputSchema>;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  return evaluatePromptFlow(input);
}

// ─────────────────────────────────────────────────────
// 레벨별 채점 기준 (Bloom 인지 위계 + AI 리터러시 3요소)
// ─────────────────────────────────────────────────────
function buildCriteria(level: number): string {
  // 레벨 1~6: 흰 배경, 단일 오브젝트 → 2축 채점 (배경 없으므로 맥락 축 제외)
  if (level <= 6) {
    return `이 그림은 흰 배경에 오브젝트 하나만 있는 단순 그림입니다.
배경이 없으므로 '맥락/분위기' 축은 이 문제에 적용하지 않습니다.

[채점 축 — 2가지]
① 명칭 정확성 (Bloom 1단계·2단계: 지식·이해)
   그림 속 대상이 무엇인지 명확한 명사로 표현했는가?
   - 높음: 종류+특성 모두 (예: "흰색 강아지", "노란 해바라기")
   - 낮음: 대상 이름만 (예: "강아지", "꽃")

② 시각적 구체성 (Bloom 3단계: 적용 / AI 리터러시: Precision·Specificity)
   색·모양·크기·자세·표정·특징 중 몇 가지를 관찰 가능한 단어로 표현했는가?
   - 높음: 형용사 2개 이상 + 행동/자세까지 (예: "혀를 내밀고 앉아있는 작고 하얀 강아지")
   - 중간: 형용사 1개 (예: "하얀 강아지가 앉아있어요")
   - 낮음: 거의 없음 (예: "앉아있는 강아지")

[점수 산출 — 두 축의 합산]
- 92~100: ①높음 + ②높음 (형용사 2개 이상, 행동·자세·표정 포함)
- 80~91:  ①높음 + ②중간 (색깔 1개 + 간단한 묘사)
- 65~79:  ①낮음 + ②중간 또는 ①높음 + ②낮음
- 45~64:  대상 이름만 (①만)
- 20~44:  그림과 다르거나 매우 짧은 문장
- 0~19:   그림과 무관하거나 빈 칸

★ 주의: 정보량이 많은 문장이 적은 문장보다 반드시 높은 점수를 받아야 합니다.
   "앉아있는 하얀 강아지" < "작고 하얀 강아지가 혀를 내밀고 앉아있어요"`;
  }

  // 레벨 7~8: 단색 배경 등장 → 3축이지만 배경(C축)은 완화
  if (level <= 8) {
    return `이 그림은 단색 배경에 캐릭터가 있는 그림입니다.

[채점 축 — 3가지]
① 명칭 정확성: 그림 속 캐릭터/사물을 명확한 명사로 표현했는가?
② 시각적 구체성: 색·모양·표정·특징을 관찰 가능한 단어로 표현했는가?
③ 배경·행동 (간단해도 OK): 배경 색깔 또는 캐릭터가 하는 행동을 적었는가?

[점수 산출]
- 90~100: ①+②+③ 모두, ②에서 형용사 2개 이상
- 75~89:  ①+②+③ 모두 짧게라도 있음
- 55~74:  두 축만
- 35~54:  한 축만
- 0~34:   그림과 거리가 멀거나 비어 있음`;
  }

  // 레벨 9~15: 풀 씬 → 3축 모두 완전히 적용
  return `이 그림은 배경과 여러 요소가 있는 복잡한 장면입니다.

[채점 축 — 3가지 (Bloom 4·5단계: 분석·종합)]
① 대상 완전성 (AI 리터러시: Completeness)
   그림 속 주요 인물·사물·공간을 빠짐없이 언급했는가?
② 시각적 구체성 (AI 리터러시: Specificity)
   색·모양·크기·자세·표정·특징을 구체적으로 묘사했는가?
③ 맥락·분위기 (Bloom 5단계: 종합)
   배경·장소·시간대·느낌·빛·분위기를 파악해서 표현했는가?

[점수 산출]
- 90~100: 세 축 모두, 형용사 2개 이상, 그림 속 복수의 요소 언급
- 75~89:  세 축 모두 간략하게라도 다룸
- 55~74:  두 축만
- 35~54:  한 축만 또는 매우 단순
- 0~34:   그림과 거리가 멀거나 비어 있음`;
}

const FEEDBACK_GUIDE = `
[피드백 — 정확히 2줄, 평문 한국어, 마크다운 기호 없이]
1줄: 학생이 쓴 글에서 실제 단어 1개를 꼭 따옴표로 인용하면서 칭찬
   좋은 예: "'하얀색'이라는 색깔 표현이 그림과 딱 맞아요!"
   나쁜 예: "정말 잘 썼어요!" (인용 없고 추상적)
2줄: 이 학생이 빠뜨린 부분 하나만, 그림에서 실제로 보이는 단서를 들어 안내하고 써볼 단어 2개 제안
   좋은 예: "강아지가 혀를 내밀고 있는데 표정도 같이 써볼까요? '방긋 웃는', '눈이 반짝이는' 같은 표현이 좋아요."
   나쁜 예: "더 자세히 써봐요." (구체적이지 않음)

금지: "대단해요·감동적이에요·최고예요" 같은 내용 없는 칭찬 / 부족한 점 2개 이상 지적 / 별표·샵·하이픈 등 기호`;

async function runEvaluation(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  const level = input.questionLevel ?? 9;
  const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';

  const prompt = `너는 초등학교 3~6학년 담임 선생님이야. 학생이 AI 그림을 보고 쓴 한국어 묘사를 평가한다.

${buildCriteria(level)}

${FEEDBACK_GUIDE}

학생이 쓴 글: "${input.studentPrompt}"

위 기준에 따라 score(정수 0~100)와 feedback(2줄 평문)을 JSON으로 반환해.`;

  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    output: { schema: EvaluatePromptOutputSchema },
    prompt: [
      { media: { url: input.photoDataUri, contentType } },
      { text: prompt },
    ],
    config: { temperature: 0.2 },
  });

  const out = response.output;
  if (!out || typeof out.score !== 'number' || !out.feedback) {
    throw new Error(`AI 응답 형식 오류: ${JSON.stringify(out)?.slice(0, 200)}`);
  }
  out.score = Math.max(0, Math.min(100, Math.round(out.score)));
  return out;
}

// 피드백에 학생 글 인용이 있는지 확인 (자기검증용)
function hasConcreteCitation(feedback: string, studentPrompt: string): boolean {
  const matches = [...feedback.matchAll(/['"]([^'"]{2,})['"]/g)];
  return matches.some(m => studentPrompt.includes(m[1]));
}

const evaluatePromptFlow = ai.defineFlow(
  {
    name: 'evaluatePromptFlow',
    inputSchema: EvaluatePromptInputSchema,
    outputSchema: EvaluatePromptOutputSchema,
  },
  async (input) => {
    try {
      const first = await runEvaluation(input);

      // 자기검증 루프: 피드백이 인용 없이 추상적이면 1회 재평가
      const ok = hasConcreteCitation(first.feedback, input.studentPrompt)
               || input.studentPrompt.trim().length < 8;

      if (!ok) {
        try {
          const retry = await runEvaluation(input);
          if (hasConcreteCitation(retry.feedback, input.studentPrompt)) return retry;
        } catch {
          // 재시도 실패 → 첫 결과 반환
        }
      }

      return first;
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] 실패:', msg);
      return { score: 0, feedback: `(⚠️ AI 평가 실패: ${msg.slice(0, 120)})` };
    }
  }
);
