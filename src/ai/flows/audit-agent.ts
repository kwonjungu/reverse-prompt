'use server';

/**
 * @fileOverview promptgrader 시스템 감수 에이전트.
 *
 * 교육학적 적절성 / 채점 공정성 / 피드백 품질 / 문제 난이도 / 이미지 프롬프트 편향을
 * 자동으로 검토하고 개선안을 제시합니다.
 *
 * 모델: src/server/config.ts의 EVALUATION_MODEL_ID(기본값 googleai/gemini-3.8-flash).
 * 모델명을 이 파일에 따로 적지 않는다. 운영자가 접근을 확인한 값을 한곳에서만 바꾼다.
 *
 * 이 경로는 학생 응답을 다른 AI에 보내는 경로다. 그러므로 기본은 합성 자료(설정만)
 * 감수이며, 실데이터 입력은 연구자 역할과 명시적 승인 기록이 함께 있을 때만 받는다.
 * 테스트 목적으로 실데이터를 내려받거나 감수 AI로 보내지 않는다.
 *
 * 이 파일은 'use server'이므로 export한 함수의 액션 ID가 클라이언트 번들에 실린다.
 * 그러므로 호출부(@/server/auth/audit-actions)의 검사에 기대지 않고 여기서 직접
 * 서버 인증을 다시 한다. 예전에는 이 함수에 인증 검사가 하나도 없었고 approval의
 * 세 문자열이 채워져 있기만 하면 실데이터 감수가 통과했다(수용시험 7·11 위반).
 *
 *   1. 역할이 연구자인지 서버에서 확인한다(학생·교사·개발자·익명 거부).
 *   2. 실데이터는 승인 기록을 서버 저장소에서 조회해 확인한다. 호출자가 보낸
 *      승인번호·승인자·승인시각 문자열을 그대로 믿지 않는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §1 P1, §6, 수용시험 7
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { auth } from '@/server/auth';
import { EVALUATION_MODEL_ID } from '@/server/config';

// ── 입력 스키마 ──────────────────────────────────────────
const QuestionSchema = z.object({
  level: z.number(),
  chasi: z.number(),
  koreanTitle: z.string(),
  sourcePrompt: z.string(),
  rubric: z.string(),
});

// 감수 payload에는 신원 ID(연구ID·학급ID·출석번호·학교명)를 넣지 않는다.
const EvalSampleSchema = z.object({
  questionLevel: z.number().optional(),
  studentPrompt: z.string(),
  score: z.number().optional(),
  feedback: z.string().optional(),
  originalPrompt: z.string().optional(),
});

const AuditInputSchema = z.object({
  questions: z.array(QuestionSchema).describe('현재 설정된 연습 문제 목록'),
  evaluationPrompt: z.string().describe('채점 AI에 사용 중인 시스템 프롬프트'),
  imagePromptTemplate: z.string().describe('이미지 생성 시 사용하는 buildImagePrompt 전체 텍스트'),
  recentEvaluations: z.array(EvalSampleSchema).optional().describe('최근 학생 제출 (선택, 승인 필요)'),
  /** 기본은 합성 자료다. 실데이터는 승인 기록이 있어야 한다. */
  dataSource: z.enum(['synthetic', 'real']).default('synthetic'),
  /**
   * 서버가 저장소에서 확인한 승인 기록. 호출자가 채워 보낸 값은 무시하고
   * runAuditAgent가 조회 결과로 덮어쓴다. 조회에 실패하면 실행하지 않는다.
   */
  approval: z
    .object({
      approvalId: z.string(),
      approvedBy: z.string(),
      approvedAt: z.string(),
    })
    .optional(),
});
export type AuditInput = z.infer<typeof AuditInputSchema>;

/**
 * 실데이터 감수를 요청할 때 함께 넘기는 승인 참조.
 * 이 값은 승인 기록을 조회하는 데만 쓰고 모델에 보내는 지시문에는 넣지 않는다.
 */
export interface AuditApprovalRef {
  approvalId: string;
  /** 승인 대상 학급. 감수 payload에는 넣지 않는다. */
  classResearchId: string;
}

/**
 * 승인 없는 실데이터 감수 전송을 막을 때 던지는 오류.
 * 'use server' 파일은 async 함수 외의 export를 두지 않으므로 내보내지 않는다.
 * 호출부는 error.name === 'AuditPolicyError'로 구분한다.
 */
class AuditPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditPolicyError';
  }
}

// ── 출력 스키마 ──────────────────────────────────────────
const FindingSchema = z.object({
  category: z.enum([
    '문제 난이도',
    '이미지 프롬프트',
    '힌트(rubric)',
    '채점 기준',
    '피드백 품질',
    '교육학적 적절성',
  ]),
  severity: z.enum(['즉시수정', '개선권장', '양호']),
  issue: z.string().describe('발견한 문제 또는 관찰 내용'),
  recommendation: z.string().describe('구체적인 개선 방법'),
  targetFile: z.string().optional().describe('수정이 필요한 파일 경로'),
});

const AuditOutputSchema = z.object({
  overallGrade: z.enum(['A', 'B', 'C', 'D']).describe('시스템 전체 품질 등급'),
  overallComment: z.string().describe('전체 평가 요약 (2~3문장)'),
  findings: z.array(FindingSchema).describe('발견 사항 목록 (중요도 순)'),
  topPriority: z.string().describe('가장 먼저 해야 할 개선 작업 1가지'),
  dataInsights: z.string().optional().describe('실제 학생 데이터에서 발견한 패턴 (데이터가 있을 때만)'),
});
export type AuditOutput = z.infer<typeof AuditOutputSchema>;

export async function runAuditAgent(
  input: AuditInput,
  approvalRef?: AuditApprovalRef,
): Promise<AuditOutput> {
  const dataSource = input.dataSource ?? 'synthetic';
  const hasRealData = (input.recentEvaluations?.length ?? 0) > 0;

  // 0. 감수는 승인된 연구자 작업이다. 화면을 거치지 않고 이 액션을 직접 불러도 여기서 막힌다.
  //    학생·교사·개발자·익명은 통과하지 못한다(개발자는 Principal 자체를 받지 못한다).
  await auth.requireRole('researcher');

  // 1. 합성 자료만 기본 허용한다. 실데이터가 섞여 오면 승인 여부와 무관하게 먼저 막는다.
  if (hasRealData && dataSource !== 'real') {
    throw new AuditPolicyError(
      '실데이터 감수는 기본 허용되지 않습니다. 합성 자료로만 감수합니다.'
    );
  }

  if (dataSource !== 'real') {
    // 합성 자료 감수에는 승인 기록이 필요 없다. 호출자가 붙여 보낸 승인 값도 남기지 않는다.
    return auditFlow({ ...input, approval: undefined });
  }

  // 2. 실데이터는 서버 저장소의 승인 기록으로만 연다.
  //    호출자가 보낸 승인번호·승인자·승인시각 문자열은 근거가 되지 못한다.
  if (!approvalRef?.approvalId || !approvalRef?.classResearchId) {
    throw new AuditPolicyError(
      '연구자 역할과 명시적 승인 기록이 없으면 실데이터를 감수 AI로 보내지 않습니다.'
    );
  }
  let approval: { approvalId: string; approvedBy: string; approvedAt: string };
  try {
    // 역할·학급 접근·승인 기록(audit_approvals)을 서버가 한 번에 확인한다.
    approval = await auth.requireRealDataAuditApproval({
      approvalId: approvalRef.approvalId,
      classResearchId: approvalRef.classResearchId,
    });
  } catch (e) {
    // 승인 조회에 실패하면 실데이터를 보내지 않는다. 사유는 정책 오류로 통일한다.
    throw new AuditPolicyError(
      `승인 기록을 확인하지 못해 실데이터 감수를 중단했습니다: ${
        e instanceof Error ? e.message : '알 수 없는 사유'
      }`
    );
  }

  // 확인한 값으로 덮어쓴다. 승인 참조(학급ID)는 모델 지시문에 넣지 않는다.
  return auditFlow({ ...input, dataSource: 'real', approval });
}

// ── 에이전트 플로우 ──────────────────────────────────────
const auditFlow = ai.defineFlow(
  {
    name: 'auditAgentFlow',
    inputSchema: AuditInputSchema,
    outputSchema: AuditOutputSchema,
  },
  async (input) => {
    const hasData = (input.recentEvaluations?.length ?? 0) > 0;
    const dataSection = hasData
      ? `\n\n[승인된 학생 제출 자료 ${input.recentEvaluations!.length}건 - 신원 정보 없음]\n` +
        input.recentEvaluations!.map((e, i) =>
          `#${i + 1} Lv.${e.questionLevel ?? '?'} | 학생 응답:"${e.studentPrompt.slice(0, 60)}..."`
        ).join('\n')
      : '\n\n[학생 자료 없음 — 설정만으로 감수]';

    const prompt = `
너는 초등교육 전문가이자 AI 시스템 품질 감수관이야.
아래 promptgrader 프로젝트의 구성 요소를 교육학적 관점에서 꼼꼼히 감수하고 JSON으로 보고해.

대상: 초등학교 5~6학년 / 역프롬프트 학습 시스템

──────────────────────────────────────────
[1] 연습 문항 ${input.questions.length}개 (level / 차시 / 제목 / 이미지 원 프롬프트 / 안내문)
${input.questions.map(q =>
  `  Lv.${q.level}(${q.chasi}차시) ${q.koreanTitle}: src="${q.sourcePrompt.slice(0, 80)}..." | 안내="${q.rubric.slice(0, 60)}..."`
).join('\n')}

[2] 채점 AI 시스템 프롬프트
${input.evaluationPrompt}

[3] 이미지 생성 프롬프트 템플릿
${input.imagePromptTemplate}
${dataSection}
──────────────────────────────────────────

감수 포인트:
1. 문제 난이도 — 1~15단계 사이에 과도한 점프가 있는가? 초등학생이 소화 가능한가?
2. 이미지 프롬프트 — 모델 편향(불필요한 요소 추가) 방지 장치가 충분한가?
3. 힌트(rubric) — 학생의 상상력을 여는가, 닫는가? 난이도에 맞는가?
4. 채점 기준 — 초등학생 수준에 공정한가? 특정 축이 너무 어렵지 않은가?
5. 피드백 품질 — 실제 데이터가 있으면 피드백이 구체적인지, 칭찬-개선 비율이 적절한지 확인.
6. 교육학적 적절성 — 전체 학습 경험이 초등생의 인지 발달에 맞는가?

findings는 severity 순(즉시수정 → 개선권장 → 양호)으로 정렬해서 JSON 반환.
`;

    try {
      const response = await ai.generate({
        // 모델 ID는 서버 설정 한곳에서만 정한다. 이 파일에 모델명을 적지 않는다.
        model: EVALUATION_MODEL_ID,
        output: { schema: AuditOutputSchema },
        prompt,
        config: { temperature: 0.3 },
      });

      const out = response.output;
      if (!out) throw new Error('에이전트 응답 없음');
      return out;
    } catch (error: any) {
      console.error('[auditAgentFlow] 실패:', error?.message);
      const fallback: AuditOutput = {
        overallGrade: 'C',
        overallComment: `감수 에이전트 실행 실패: ${error?.message?.slice(0, 100)}`,
        findings: [],
        topPriority: '에이전트 오류를 확인하세요.',
      };
      return fallback;
    }
  }
);
