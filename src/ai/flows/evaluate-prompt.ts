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

// ─────────────────────────────────────────────────────
// 축별 5수준 판정 기준 (<표 Ⅲ-4>)
// AI와 교사는 같은 문언을 사용한다.
// ─────────────────────────────────────────────────────
const AXIS_OBJECT = `[축 1 대상 완전성] 대상의 명칭, 핵심 대상의 누락, 수량을 본다.
5 핵심 대상을 모두 정확히 지칭하고 필요한 수량을 밝혀 대상을 구별한다.
4 핵심 대상을 모두 지칭하나 한 명칭이 포괄적이거나 필수 수량이 불명확하다.
3 핵심 대상 일부를 정확히 지칭하나 주요 누락 또는 복수의 포괄적 명칭이 있다.
2 대상을 지칭하였으나 명칭이 부정확하거나 그림과 일치하지 않는다.
1 무응답이거나 그림과 무관한 내용을 진술하였다.`;

const AXIS_SPECIFICITY = `[축 2 시각적 구체성] 대상에 귀속되는 색, 형태, 크기, 질감, 정적인 자세를 본다.
5 속성 진술이 대상별로 이루어져 같은 부류의 다른 사물과 뚜렷이 구별되며, 진술한 속성이 모두 그림에서 확인된다.
4 속성을 진술하였으나 일부 대상에 국한되거나 같은 부류를 좁히기에는 일반적인 수준이다.
3 속성 진술이 한 종류에 그치거나 대상을 좁히는 데 기여하지 못한다. 평가어가 구체 진술을 대신한다.
2 속성 진술이 거의 없이 이름만 나열한다. 수식어가 있어도 그림과 무관하다.
1 무응답이거나 속성에 관한 어떠한 진술도 없다.`;

const AXIS_CONTEXT_B = `[축 3 배경과 행동] 장소와 동작을 본다. 분위기는 이 밴드에서 요구하지 않는다.
5 배경의 성격과 대상의 행동을 모두 진술하고 그림과 부합한다.
4 배경과 행동을 모두 진술하였으나 하나가 일반적이다.
3 배경 또는 행동 중 하나만 진술한다.
2 배경의 존재만 언급한다.
1 배경과 행동을 모두 진술하지 않았다.`;

const AXIS_CONTEXT_C = `[축 3 맥락과 분위기] 장소, 시간, 동작, 대상 간 공간 관계, 분위기를 본다.
5 장소와 시간대, 분위기를 모두 진술하고, 분위기 표현이 그림의 색이나 행동과 근거를 이루며 연결된다.
4 셋 중 둘을 진술한다. 분위기 표현은 있으나 근거와의 연결이 약하다.
3 셋 중 하나만 진술한다.
2 배경의 존재만 언급한다.
1 배경과 상황에 관한 어떠한 진술도 없다.`;

const COMMON_RULE = `[공통 판정 원칙]
같은 단서를 두 축에서 중복하여 가점하지 않는다.
위치 관계는 맥락 축, 대상에 귀속되는 외형은 구체성 축으로 판정한다.
그림에서 확인되지 않는 요소를 진술하면 해당 축을 한 수준 낮추되 최저 수준은 1이다.
근거가 부족한 중립적 추가 표현은 가점하지 않는다.
이 과제의 목표는 묘사의 풍부함이 아니라 제시된 그림의 재현이므로,
진술이 길어져도 재현할 대상이 특정되지 않으면 상위 수준으로 판정하지 않는다.`;

const FEEDBACK_GUIDE = `[피드백 — 정확히 2줄, 평문 한국어, 기호 없이]
1줄: 학생이 쓴 글에서 실제 낱말 하나를 따옴표로 인용하며 현재 상태를 확인한다.
   장점이 없으면 억지 칭찬 대신 중립적으로 관찰 내용을 확인한다.
2줄: 빠뜨린 것 하나만, 그림에서 실제로 보이는 단서를 들어 안내하고 써 볼 낱말 두 개를 제안한다.

금지: 내용 없는 칭찬, 부족한 점을 둘 이상 지적하는 것, 별표나 샵 같은 기호.`;

function buildCriteria(band: Band): string {
  const axes =
    band === 'A'
      ? [AXIS_OBJECT, AXIS_SPECIFICITY]
      : [AXIS_OBJECT, AXIS_SPECIFICITY, band === 'B' ? AXIS_CONTEXT_B : AXIS_CONTEXT_C];
  const note =
    band === 'A'
      ? '이 문항은 흰 배경 또는 사물이 없는 단색 배경이므로 맥락 축을 적용하지 않는다. contextLevel은 null로 반환한다.'
      : '세 축을 모두 판정한다.';
  return `${axes.join('\n\n')}\n\n${COMMON_RULE}\n\n${note}`;
}

type SingleCall = AxisLevels & { feedback: string };

async function runEvaluation(input: EvaluatePromptInput, band: Band): Promise<SingleCall> {
  const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';
  const prompt = `너는 초등학교 5~6학년 담임 선생님이야. 학생이 그림을 보고 쓴 한국어 프롬프트를 축별로 판정한다.

${buildCriteria(band)}

${FEEDBACK_GUIDE}

학생이 쓴 글: "${input.studentPrompt}"

각 축의 수준(1에서 5 사이의 정수)과 feedback(2줄 평문)을 JSON으로 반환해. 점수는 계산하지 마라.`;

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
