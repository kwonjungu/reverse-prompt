'use server';

/**
 * 연구 자료 내보내기 실행 경로 — 연구자가 실제로 CSV를 받는 곳
 *
 * csv.ts와 records.ts는 순수 직렬화 계층이라 부르는 곳이 없으면 아무 일도 하지 않는다.
 * 이 파일이 그 둘을 실제 자료에 이어 붙인다.
 *
 * 지키는 것(설계서 §7)
 *  - null 유지, 수준 소수 유지, 기준 버전 포함, 수식 주입 방지, UTF-8 BOM.
 *  - 주 자료(repeatIndex 1)와 신뢰도 반복(2·3)을 다른 파일로 낸다. 평균을 만들지 않는다.
 *  - 연구자·관리자만 부를 수 있고 대상 학급을 서버에서 확인한다. 타 학급은 읽지 못한다.
 *  - 학교 실명 대응표·출석번호·학교명은 애초에 저장 스키마에 없다. 여기서 되살리지 않는다.
 *
 * 'use server' 파일이므로 모든 export는 async 함수다.
 */

import { auth } from '@/server/auth';
import { privacy } from '@/server/privacy';
import { createFirestoreAssessmentStore } from '@/server/assessment/firestore-store';
import { ALL_REPEAT_INDICES, PRIMARY_REPEAT_INDEX } from '@/server/assessment/scoring-job';
import type { AssessmentStore } from '@/server/assessment/store';
import { checkCompleteness, type CompletenessReport } from './completeness';
import { buildCallCsv, buildSubmissionCsv, type ExportRow } from './records';

export type ExportKind = 'submissions' | 'calls';

export interface ExportResult {
  filename: string;
  /** BOM을 포함한 CSV 본문. 그대로 파일에 쓰거나 응답 본문으로 보낸다. */
  csv: string;
  rowCount: number;
  repeatIndex: number;
  kind: ExportKind;
  generatedAt: string;
  /** 학생ID×시점×문항 격자 점검 결과. 중복·결손을 숨기지 않고 함께 낸다. */
  completeness: CompletenessReport;
}

let cachedStore: AssessmentStore | null = null;
function store(): AssessmentStore {
  if (!cachedStore) cachedStore = createFirestoreAssessmentStore();
  return cachedStore;
}

/** 파일 이름에 쓸 수 있는 글자만 남긴다. 경로 구분자를 막는다. */
function safeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
}

/**
 * 한 학급의 검사 자료를 CSV로 만든다.
 *
 * 채점 결과는 요청한 repeatIndex 하나만 붙인다. 주 자료와 반복을 한 파일에 섞으면
 * 분석에서 평균이 만들어지기 쉽다. 아직 채점하지 않은 응답은 채점 열이 모두 NA다.
 */
export async function exportAssessmentCsv(input: {
  classResearchId: string;
  repeatIndex?: number;
  kind?: ExportKind;
}): Promise<ExportResult> {
  // 연구자·관리자만 내보낼 수 있고, 그중에서도 배정된 학급만 읽는다.
  await auth.requireClassAccess(input.classResearchId, 'researcher', 'admin');

  const repeatIndex = input.repeatIndex ?? PRIMARY_REPEAT_INDEX;
  if (!ALL_REPEAT_INDICES.includes(repeatIndex)) {
    throw new Error(`repeatIndex는 ${ALL_REPEAT_INDICES.join('·')} 중 하나여야 한다`);
  }
  const kind: ExportKind = input.kind ?? 'submissions';

  // 대상 범위를 서버에서 좁힌다. 학급을 밝히지 않은 조회는 형(型)으로 막혀 있다.
  const submissions = await store().listSubmissions({ classResearchId: input.classResearchId });

  const rows: ExportRow[] = [];
  for (const submission of submissions) {
    // 거절 기록은 감사 흔적이므로 분석 자료 행으로 내보내지 않는다.
    if (submission.persistStatus === 'rejected_duplicate') continue;
    const run =
      submission.responseStatus === 'submitted'
        ? await store().getScoringRun(submission.submissionId, repeatIndex)
        : null;
    rows.push({ submission, run });
  }

  // API 키·원시 인증토큰이 어떤 열에도 실리지 않는지 마지막으로 확인한다.
  privacy.assertNoSecrets(rows);

  const csv = kind === 'calls' ? buildCallCsv(rows) : buildSubmissionCsv(rows);
  const completeness = checkCompleteness(
    rows
      .filter((r) => r.submission.researchId && r.submission.phase)
      .map((r) => ({
        researchId: r.submission.researchId as string,
        phase: r.submission.phase as 'pre' | 'post',
        questionId: r.submission.questionId,
        submissionId: r.submission.submissionId,
        responseStatus: r.submission.responseStatus,
        missingReason: r.submission.missingReason,
      }))
  );

  const generatedAt = new Date().toISOString();
  return {
    filename: `assessment_${safeFileToken(input.classResearchId)}_repeat${repeatIndex}_${kind}.csv`,
    csv,
    rowCount: kind === 'calls' ? rows.filter((r) => r.run).length : rows.length,
    repeatIndex,
    kind,
    generatedAt,
    completeness,
  };
}

/**
 * 내보내기 전에 격자만 확인한다. 자료를 내려받지 않고 중복·결손만 본다.
 * 결손을 채우지 않는다. 보고만 한다.
 */
export async function checkAssessmentCompleteness(input: {
  classResearchId: string;
  expectedResearchIds?: string[];
}): Promise<CompletenessReport> {
  await auth.requireClassAccess(input.classResearchId, 'teacher', 'researcher', 'admin');
  const submissions = await store().listSubmissions({ classResearchId: input.classResearchId });
  return checkCompleteness(
    submissions
      .filter((s) => s.persistStatus !== 'rejected_duplicate' && s.researchId && s.phase)
      .map((s) => ({
        researchId: s.researchId as string,
        phase: s.phase as 'pre' | 'post',
        questionId: s.questionId,
        submissionId: s.submissionId,
        responseStatus: s.responseStatus,
        missingReason: s.missingReason,
      })),
    { expectedResearchIds: input.expectedResearchIds }
  );
}
