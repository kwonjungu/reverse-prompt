/**
 * 사후 일괄 채점 작업 — 수집이 끝난 뒤 사전·사후를 섞어 같은 도구로 채점한다.
 *
 * 설계서 §5
 *  - 검사 화면에서는 AI를 부르지 않는다. 응답을 모은 뒤 이 작업이 채점한다.
 *  - 채점자 payload에는 시점·학생·학급·자동 점수를 넣지 않는다.
 *  - 전체 자료의 최초 운영 점수를 주 자료로 잠그고, 추가 두 운영 반복은
 *    신뢰도 분석용으로 별도 저장한다. 3회 평균으로 주 자료를 덮어쓰지 않는다.
 *  - 레지스트리가 candidate이거나 researchReady=false면 본연구 채점을 시작하지 못한다.
 *  - 동의 철회 뒤에는 새 전송과 추가 채점을 차단하고 대기 중 작업도 취소한다.
 *
 * 모델 호출은 주입받는다. 테스트는 가짜 채점 함수를 넣고, 실제 모델을 부르지 않는다.
 */

import { SCHEMA_VERSION, type ScoringRun, type SubmissionRecord } from '@/lib/research/types';
import type { GradingRequest } from '@/server/grading/contract';
import { createSeededRandom } from '@/server/export/completeness';
import { checkResearchStartAllowed, type AssessmentRegistryView } from './session';
import type { AssessmentStore, ScoringBatchRecord } from './store';

/** 주 자료로 잠그는 반복 번호. 이 값의 결과는 다시 쓰지 않는다. */
export const PRIMARY_REPEAT_INDEX = 1;

/** 신뢰도 분석용 반복. 주 자료를 덮어쓰지 않고 따로 쌓는다. */
export const RELIABILITY_REPEAT_INDICES = [2, 3] as const;

export const ALL_REPEAT_INDICES = [PRIMARY_REPEAT_INDEX, ...RELIABILITY_REPEAT_INDICES];

/**
 * 채점자 payload에 절대 실리면 안 되는 필드.
 * 시점·학생·학급·자동 점수와 신원 ID가 여기에 해당한다.
 */
export const FORBIDDEN_GRADER_FIELDS = [
  'phase',
  'researchId',
  'classResearchId',
  'attendanceNumber',
  'studentName',
  'schoolCode',
  'schoolName',
  'score',
  'levels',
  'axisScores',
  'autoScore',
  'submissionId',
] as const;

/** payload에 금지 필드가 섞였는지 확인한다. 런타임과 테스트가 함께 쓴다. */
export function findForbiddenGraderFields(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return [];
  return Object.keys(payload as Record<string, unknown>).filter((k) =>
    (FORBIDDEN_GRADER_FIELDS as readonly string[]).includes(k)
  );
}

/**
 * 채점자에게 보낼 요청을 만든다.
 *
 * SubmissionRecord에서 questionId·band·정제된 text만 가져온다.
 * phase·researchId·classResearchId는 여기서 의도적으로 버린다. 결과를 되붙일 때는
 * 반환하지 않고 호출한 쪽이 별도로 들고 있는 순서 정보로 잇는다.
 */
export function buildGraderPayload(
  submission: SubmissionRecord,
  operationId: string,
  repeatIndex: number
): GradingRequest {
  return {
    questionId: submission.questionId,
    band: submission.band,
    studentText: submission.text,
    operationId,
    repeatIndex,
    sessionType: 'research_assessment',
    // 검사 채점에서는 학생에게 돌려줄 피드백을 만들지 않는다.
    wantFeedback: false,
  };
}

/* ────────────────────── 시점 혼합 순서 ────────────────────── */

export interface QueuedItem {
  /** 혼합된 순서. 0부터 센다. 재현의 기준이다. */
  orderIndex: number;
  submissionId: string;
}

/**
 * 사전·사후를 섞은 채점 순서를 만든다.
 *
 * 입력 순서와 무관하게 같은 결과가 나오도록 submissionId로 먼저 정렬한 뒤
 * 시드 기반 셔플을 돌린다. 같은 시드는 언제나 같은 순서를 낸다.
 * 결측(미제출·철회·미동의)은 채점 대상이 아니므로 큐에 넣지 않는다.
 * 빈 응답에 최저 점수를 매기지 않기 위해서다.
 */
export function buildScoringQueue(
  submissions: readonly SubmissionRecord[],
  seed: string
): QueuedItem[] {
  const ids = submissions
    .filter((s) => s.responseStatus === 'submitted' && s.persistStatus === 'stored')
    .map((s) => s.submissionId)
    .sort();

  const rand = createSeededRandom(seed);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.map((submissionId, orderIndex) => ({ orderIndex, submissionId }));
}

/** 채점 작업 식별자. 시점·학생 정보를 담지 않는다. */
export function makeOperationId(batchId: string, orderIndex: number): string {
  return `${batchId}_${orderIndex.toString(36)}`;
}

export function makeBatchId(seed: string, repeatIndex: number, createdAtMs: number): string {
  return `sb_${repeatIndex}_${createdAtMs.toString(36)}_${seed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)}`;
}

/* ────────────────────── 작업 실행 ────────────────────── */

export interface ScoringJobDeps {
  store: AssessmentStore;
  registry: AssessmentRegistryView;
  /** grading.runOperationalScoring을 넣는다. 테스트는 가짜 구현을 넣는다. */
  runOperationalScoring: (req: GradingRequest) => Promise<ScoringRun>;
  /**
   * 이 학생의 연구 동의가 아직 유효한지 서버에서 확인한다.
   * 큐에 넣은 뒤 철회하는 경우가 있으므로 매 건 전송 직전에 다시 부른다.
   */
  isConsentActive: (researchId: string) => Promise<boolean>;
  now?: () => number;
  codeCommit?: string;
}

export interface ScoringJobOptions {
  /** 혼합 시드. 인자로 받아 기록한다. 같은 시드로 순서를 재현한다. */
  seed: string;
  repeatIndex: number;
  /** 합성 자료 대상 모의 실행. candidate 레지스트리를 이 플래그로만 허용한다. */
  dryRun?: boolean;
}

export type SkipReason =
  | 'already_scored_primary_locked'
  | 'already_scored'
  | 'consent_withdrawn'
  | 'not_submitted';

export interface ScoringJobResult {
  batchId: string;
  seed: string;
  repeatIndex: number;
  dryRun: boolean;
  order: string[];
  scored: string[];
  skipped: { submissionId: string; reason: SkipReason }[];
  /** 동의 철회로 전송하지 않고 취소한 대기 작업 */
  cancelled: string[];
  failed: { submissionId: string; reason: string }[];
}

export class ScoringBlockedError extends Error {
  constructor(readonly blockers: string[]) {
    super(`본연구 채점을 시작할 수 없다: ${blockers.join(' / ')}`);
    this.name = 'ScoringBlockedError';
  }
}

/**
 * 일괄 채점을 수행한다.
 *
 * repeatIndex 1은 주 자료다. 이미 저장된 주 자료가 있으면 다시 채점하지 않고 건너뛴다.
 * repeatIndex 2·3은 같은 제출에 대해 따로 저장되며 주 자료를 고치지 않는다.
 */
export async function runScoringJob(
  deps: ScoringJobDeps,
  submissions: readonly SubmissionRecord[],
  options: ScoringJobOptions
): Promise<ScoringJobResult> {
  const dryRun = options.dryRun === true;
  if (!ALL_REPEAT_INDICES.includes(options.repeatIndex)) {
    throw new Error(`repeatIndex는 ${ALL_REPEAT_INDICES.join('·')} 중 하나여야 한다`);
  }

  const start = checkResearchStartAllowed(deps.registry, { allowCandidate: dryRun });
  if (!start.allowed) throw new ScoringBlockedError(start.blockers);
  if (dryRun && start.blockers.length) {
    // 모의 실행이어도 어떤 값이 미확정인지 결과에 남긴다. 완료로 보고하지 않기 위해서다.
  }

  const now = deps.now ?? (() => Date.now());
  const createdAtMs = now();
  const batchId = makeBatchId(options.seed, options.repeatIndex, createdAtMs);
  const queue = buildScoringQueue(submissions, options.seed);
  const byId = new Map(submissions.map((s) => [s.submissionId, s]));

  const statusSnapshot = deps.registry
    .assessmentOrder()
    .map((q) => `${q}:${deps.registry.getEntry(q).status}`)
    .join(',');

  const batch: ScoringBatchRecord = {
    schemaVersion: SCHEMA_VERSION,
    batchId,
    seed: options.seed,
    repeatIndex: options.repeatIndex,
    order: queue.map((q) => q.submissionId),
    createdAt: new Date(createdAtMs).toISOString(),
    codeCommit: deps.codeCommit ?? 'unknown',
    dryRun,
    registryStatusSnapshot: statusSnapshot,
  };
  await deps.store.putScoringBatch(batch);

  const result: ScoringJobResult = {
    batchId,
    seed: options.seed,
    repeatIndex: options.repeatIndex,
    dryRun,
    order: batch.order,
    scored: [],
    skipped: [],
    cancelled: [],
    failed: [],
  };

  for (const item of queue) {
    const submission = byId.get(item.submissionId);
    if (!submission) continue;

    if (submission.responseStatus !== 'submitted') {
      result.skipped.push({ submissionId: item.submissionId, reason: 'not_submitted' });
      continue;
    }

    // 대기 중 작업도 전송 직전에 동의를 다시 확인한다. 철회했으면 보내지 않고 취소한다.
    const consentOk = submission.researchId
      ? await deps.isConsentActive(submission.researchId)
      : false;
    if (!consentOk) {
      result.cancelled.push(item.submissionId);
      continue;
    }

    const existing = await deps.store.getScoringRun(item.submissionId, options.repeatIndex);
    if (existing) {
      result.skipped.push({
        submissionId: item.submissionId,
        reason:
          options.repeatIndex === PRIMARY_REPEAT_INDEX
            ? 'already_scored_primary_locked'
            : 'already_scored',
      });
      continue;
    }

    const operationId = makeOperationId(batchId, item.orderIndex);
    const payload = buildGraderPayload(submission, operationId, options.repeatIndex);
    const leaked = findForbiddenGraderFields(payload);
    if (leaked.length) {
      throw new Error(`채점 payload에 금지 필드가 있다: ${leaked.join(', ')}`);
    }

    try {
      const run = await deps.runOperationalScoring(payload);
      await deps.store.putScoringRun(item.submissionId, {
        ...run,
        operationId,
        repeatIndex: options.repeatIndex,
      });
      result.scored.push(item.submissionId);
    } catch (e) {
      // 채점 실패는 결측으로 남기고 0점으로 만들지 않는다. 다음 건을 계속 처리한다.
      result.failed.push({
        submissionId: item.submissionId,
        reason: e instanceof Error ? e.message : '알 수 없는 실패',
      });
    }
  }

  return result;
}

/**
 * 주 자료를 고른다. repeatIndex 1의 결과만 쓴다.
 * 세 반복의 평균을 만들지 않는다. 평균이 필요한 신뢰도 분석은 분석 단계에서 따로 한다.
 */
export function primaryRun(runs: readonly ScoringRun[]): ScoringRun | null {
  return runs.find((r) => r.repeatIndex === PRIMARY_REPEAT_INDEX) ?? null;
}

/** 신뢰도 분석용 반복만 고른다. */
export function reliabilityRuns(runs: readonly ScoringRun[]): ScoringRun[] {
  return runs
    .filter((r) => (RELIABILITY_REPEAT_INDICES as readonly number[]).includes(r.repeatIndex))
    .sort((a, b) => a.repeatIndex - b.repeatIndex);
}
