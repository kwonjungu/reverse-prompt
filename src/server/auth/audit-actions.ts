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
import {
  COLLECTIONS,
  RESEARCH_COLLECTIONS,
  assertSafeDocId,
  getAdminFirestore,
  researchPath,
} from '@/server/firebase-admin';
import { runAuditAgent, type AuditInput, type AuditOutput } from '@/ai/flows/audit-agent';
import { practiceSourcePromptByLevel } from '@/server/registry/practice-source-prompts';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { getEvaluationPromptForAudit } from '@/lib/evaluation-prompt';
import { buildImagePrompt } from '@/lib/image-prompt';

type QuestionSnapshot = {
  level: number;
  chasi: number;
  koreanTitle: string;
  sourcePrompt: string;
  rubric: string;
};

/**
 * 감수 실행. 기본은 합성 자료(설정만) 감수다.
 * realData를 요청하면 연구자 역할과 승인 기록을 확인한 뒤에만 실데이터를 넣는다.
 */
export async function runAuditFromServer(options?: {
  realData?: { classResearchId: string; approvalId: string };
}): Promise<AuditOutput> {
  // 감수는 승인된 연구자 작업이다. 수업 모드에서 임의로 호출하지 않는다.
  // 이 검사는 화면 진입 관문이며, 플로우 자체도 runAuditAgent에서 다시 확인한다.
  await auth.requireRole('researcher');

  // 문항 정보와 제작 프롬프트는 모두 정적 import로 읽는다. 예전에는 모듈 전체를
  // Record<string, unknown>으로 받아 이름을 뒤졌고, 제작 프롬프트 모듈은 함수만
  // 내보내는데 객체를 찾는 바람에 전 문항의 sourcePrompt가 ''이 되었다.
  // 그 형 불일치를 가리던 타입 검사 무시 주석도 함께 없앴다.
  const questions: QuestionSnapshot[] = PRACTICE_QUESTIONS.map((q) => ({
    level: q.level,
    chasi: q.chasi,
    koreanTitle: q.koreanTitle,
    sourcePrompt: practiceSourcePromptByLevel(q.level) ?? '',
    rubric: q.rubric,
  }));

  const input: AuditInput = {
    questions,
    evaluationPrompt: getEvaluationPromptForAudit(),
    imagePromptTemplate: buildImagePrompt('{subject}'),
    dataSource: 'synthetic',
  };

  if (!options?.realData) {
    privacy.assertNoSecrets(input);
    return runAuditAgent(input);
  }

  // 실데이터 경로. 승인 확인은 runAuditAgent에서 한 번 더 하며, 여기서는 자료를 읽기
  // 전에 먼저 확인해 승인 없는 조회 자체를 막는다.
  const classResearchId = assertSafeDocId(options.realData.classResearchId, '수업ID');
  await auth.requireRealDataAuditApproval({
    approvalId: options.realData.approvalId,
    classResearchId,
  });

  const snap = await getAdminFirestore()
    .collection(researchPath(RESEARCH_COLLECTIONS.practiceSubmissions))
    .where('classResearchId', '==', classResearchId)
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
    }));

  if (samples.length === 0) {
    throw new AuthError('감수에 넣을 수 있는 자료가 없습니다.', 'forbidden');
  }
  input.recentEvaluations = samples;
  input.dataSource = 'real';

  privacy.assertNoSecrets(input);
  // 승인 참조는 별도 인자로 넘긴다. 학급ID를 감수 payload에 담지 않기 위해서다.
  return runAuditAgent(input, {
    approvalId: options.realData.approvalId,
    classResearchId,
  });
}

/* ────────────────────────── 승인 기록 ────────────────────────── */

export interface AuditApprovalView {
  approvalId: string;
  classResearchId: string;
  approvedBy: string;
  approvedAt: string;
  active: boolean;
  reason: string;
  revokedAt: string | null;
}

/**
 * 실데이터 감수 승인 기록을 만든다.
 *
 * 승인은 연구자 스스로 낼 수 없다. 관리 역할만 기록할 수 있게 하여 '요청자'와
 * '승인자'를 분리한다. 승인 기록이 없으면 runAuditAgent가 실데이터를 거부한다.
 * 코드가 만들어 낼 수 없는 값(실제 사람의 판단)을 대신 채우지 않고, 여기서는
 * 사람이 내린 결정을 조회 가능한 형태로 남기기만 한다.
 */
export async function grantRealDataAuditApproval(input: {
  approvalId: string;
  classResearchId: string;
  reason: string;
}): Promise<AuditApprovalView> {
  const approver = await auth.requireRole('admin');
  const approvalId = assertSafeDocId(input.approvalId, '승인번호');
  const classResearchId = assertSafeDocId(input.classResearchId, '수업ID');
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new AuthError('승인 사유를 적어야 합니다.', 'forbidden');
  }

  const approvedAt = new Date().toISOString();
  const record = {
    scope: 'audit_real_data' as const,
    classResearchId,
    approvedBy: approver.uid,
    approvedAt,
    reason,
    active: true,
    revokedAt: null as string | null,
  };
  // 같은 승인번호를 덮어써 되살리지 않는다. 다시 승인하려면 새 번호를 쓴다.
  const ref = getAdminFirestore().collection(COLLECTIONS.auditApprovals).doc(approvalId);
  if ((await ref.get()).exists) {
    throw new AuthError('이미 있는 승인번호입니다.', 'forbidden');
  }
  await ref.create(record);
  return { approvalId, ...record };
}

/** 승인 철회. 기록을 지우지 않고 active만 내린다. */
export async function revokeRealDataAuditApproval(input: {
  approvalId: string;
  reason: string;
}): Promise<void> {
  const actor = await auth.requireRole('admin');
  const approvalId = assertSafeDocId(input.approvalId, '승인번호');
  await getAdminFirestore()
    .collection(COLLECTIONS.auditApprovals)
    .doc(approvalId)
    .set(
      {
        active: false,
        revokedAt: new Date().toISOString(),
        revokedBy: actor.uid,
        revokeReason: (input.reason ?? '').trim(),
      },
      { merge: true },
    );
}

/** 한 학급의 승인 기록 목록. 화면이 '승인 있음/없음'을 사실대로 보이게 한다. */
export async function listRealDataAuditApprovals(
  classResearchId: string,
): Promise<AuditApprovalView[]> {
  await auth.requireRole('researcher', 'admin');
  const id = assertSafeDocId(classResearchId, '수업ID');
  // 읽기 전용 목록이다. 기본값이 write라 행위를 명시하지 않으면 연구자가 거부된다.
  await auth.requireClassAccess(id, 'researcher', 'admin', { action: 'read' });
  const snap = await getAdminFirestore()
    .collection(COLLECTIONS.auditApprovals)
    .where('classResearchId', '==', id)
    .limit(50)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() ?? {};
    return {
      approvalId: d.id,
      classResearchId: id,
      approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : '',
      approvedAt: typeof data.approvedAt === 'string' ? data.approvedAt : '',
      active: data.active === true,
      reason: typeof data.reason === 'string' ? data.reason : '',
      revokedAt: typeof data.revokedAt === 'string' ? data.revokedAt : null,
    };
  });
}
