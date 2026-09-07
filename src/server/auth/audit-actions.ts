'use server';

/**
 * 감수 실행의 서버 액션.
 *
 * 문항 제작 프롬프트(sourcePrompt)와 채점 시스템 프롬프트는 비공개 자산이다.
 * 클라이언트가 직접 import 하지 않도록 여기서 서버에서만 읽어 감수 입력에 넣는다.
 *
 * 연구 세션은 별도 승인 없는 감수 전송을 금지한다. 실데이터는 연구자 역할과
 * 명시적 승인 기록이 함께 있을 때만 넣는다. 기본은 합성 자료다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §1 P1, §6
 */

import { auth } from '@/server/auth';
import { AuthError } from '@/server/auth/contract';
import { privacy } from '@/server/privacy';
import { COLLECTIONS, getAdminFirestore } from '@/server/firebase-admin';
import { runAuditAgent, type AuditInput, type AuditOutput } from '@/ai/flows/audit-agent';
import * as questionsModule from '@/lib/questions';
import * as evaluationPromptModule from '@/lib/evaluation-prompt';
import * as imagePromptModule from '@/lib/image-prompt';

type QuestionSnapshot = {
  level: number;
  chasi: number;
  koreanTitle: string;
  sourcePrompt: string;
  rubric: string;
};

/**
 * 문항 제작 프롬프트를 서버 전용 모듈에서 읽는다.
 * 에이전트2가 sourcePrompt를 @/server/registry/practice-source-prompts로 옮기는 것을 전제한다.
 * 모듈이 없거나 이름이 다르면 제작 프롬프트 없이 감수한다(추측한 값을 만들지 않는다).
 */
async function loadSourcePrompts(): Promise<Record<string, string>> {
  try {
    // @ts-ignore 서버 전용 모듈. 아직 없을 수 있으므로 실패해도 감수를 계속한다.
    const mod = (await import('@/server/registry/practice-source-prompts')) as Record<
      string,
      unknown
    >;
    for (const key of ['PRACTICE_SOURCE_PROMPTS', 'SOURCE_PROMPTS', 'default']) {
      const value = mod[key];
      if (value && typeof value === 'object') return value as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function readQuestions(): Array<Record<string, unknown>> {
  const mod = questionsModule as unknown as Record<string, unknown>;
  const list = mod.PRACTICE_QUESTIONS;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

function readEvaluationPrompt(): string {
  const mod = evaluationPromptModule as unknown as Record<string, unknown>;
  const getter = mod.getEvaluationPromptForAudit;
  if (typeof getter === 'function') {
    try {
      return String((getter as () => string)());
    } catch {
      return '(채점 시스템 프롬프트를 읽지 못했습니다.)';
    }
  }
  return '(채점 시스템 프롬프트를 읽지 못했습니다.)';
}

function readImagePromptTemplate(): string {
  const mod = imagePromptModule as unknown as Record<string, unknown>;
  const build = mod.buildImagePrompt;
  if (typeof build === 'function') {
    try {
      return String((build as (s: string) => string)('{subject}'));
    } catch {
      return '(이미지 프롬프트 템플릿을 읽지 못했습니다.)';
    }
  }
  return '(이미지 프롬프트 템플릿을 읽지 못했습니다.)';
}

/**
 * 감수 실행. 기본은 합성 자료(설정만) 감수다.
 * realData를 요청하면 연구자 역할과 승인 기록을 확인한 뒤에만 실데이터를 넣는다.
 */
export async function runAuditFromServer(options?: {
  realData?: { classResearchId: string; approvalId: string };
}): Promise<AuditOutput> {
  // 감수는 승인된 연구자 작업이다. 수업 모드에서 임의로 호출하지 않는다.
  await auth.requireRole('researcher');

  const sourcePrompts = await loadSourcePrompts();
  const questions: QuestionSnapshot[] = readQuestions().map((q) => {
    const level = typeof q.level === 'number' ? q.level : 0;
    const key = `L${String(level).padStart(2, '0')}`;
    const fromServer = sourcePrompts[key] ?? sourcePrompts[String(level)] ?? '';
    return {
      level,
      chasi: typeof q.chasi === 'number' ? q.chasi : 0,
      koreanTitle: typeof q.koreanTitle === 'string' ? q.koreanTitle : '',
      // 이미 questions.ts에서 옮겨졌다면 서버 모듈 값만 남는다.
      sourcePrompt: fromServer || (typeof q.sourcePrompt === 'string' ? q.sourcePrompt : ''),
      rubric: typeof q.rubric === 'string' ? q.rubric : '',
    };
  });

  const input: AuditInput = {
    questions,
    evaluationPrompt: readEvaluationPrompt(),
    imagePromptTemplate: readImagePromptTemplate(),
    dataSource: 'synthetic',
  };

  if (options?.realData) {
    const approval = await auth.requireRealDataAuditApproval({
      approvalId: options.realData.approvalId,
      classResearchId: options.realData.classResearchId,
    });
    const snap = await getAdminFirestore()
      .collection(COLLECTIONS.researchSubmissions)
      .where('classResearchId', '==', options.realData.classResearchId)
      .limit(30)
      .get();

    // 신원 ID는 감수 payload에 넣지 않는다. 개인정보가 의심되면 그 건을 뺀다.
    const samples = snap.docs
      .map((d) => d.data())
      .filter((d) => typeof d.text === 'string')
      .filter((d) => privacy.checkBeforeSend(String(d.text)).decision === 'pass')
      .map((d) => ({
        questionLevel: typeof d.lesson === 'number' ? d.lesson : undefined,
        studentPrompt: String(d.text),
        score: 0,
        feedback: '',
      }));

    if (samples.length === 0) {
      throw new AuthError('감수에 넣을 수 있는 자료가 없습니다.', 'forbidden');
    }
    input.recentEvaluations = samples;
    input.dataSource = 'real';
    input.approval = approval;
  }

  privacy.assertNoSecrets(input);
  return runAuditAgent(input);
}
