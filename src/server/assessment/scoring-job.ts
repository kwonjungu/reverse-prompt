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
 * SubmissionRecord에서 questionId와 정제된 text만 가져온다.
 * 밴드는 보내지 않는다. 서버 레지스트리가 questionId로 확정하는 값이므로 저장 기록의
 * band를 함께 보내면 그것이 채점에 쓰인다는 오해를 남긴다.
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
 *
 * 글자가 없는 텍스트도 큐에 넣지 않는다. 수집 단계에서 이미 막지만, 이전 세대에
 * 저장된 빈 텍스트가 모델로 가 수준 1(0점)이 되는 일을 여기서 한 번 더 막는다.
 */
export function buildScoringQueue(
  submissions: readonly SubmissionRecord[],
  seed: string
): QueuedItem[] {
  const ids = submissions
    .filter(
      (s) =>
        s.responseStatus === 'submitted' &&
        s.persistStatus === 'stored' &&
        typeof s.text === 'string' &&
        s.text.trim().length > 0
    )
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
  /**
   * 이 작업이 다루는 자료의 성격. 기본값은 'research'(실데이터)다.
   * dryRun은 'synthetic'일 때만 쓸 수 있다. 실데이터 채점은 dryRun으로 열리지 않는다.
   */
  dataSource?: 'synthetic' | 'research';
  /**
   * 연구 저장소(Firestore)에 쓰는 저장소인지. 모의 실행은 연구 저장소에 쓰지 않는다.
   * 호출한 쪽이 어떤 저장소를 넣었는지 밝힌다.
   */
  storeIsPersistent?: boolean;
}

export interface ScoringJobOptions {
  /** 혼합 시드. 인자로 받아 기록한다. 같은 시드로 순서를 재현한다. */
  seed: string;
  repeatIndex: number;
  /**
   * 합성 자료 대상 모의 실행.
   *
   * 이 플래그는 '합성 자료에 한해' candidate 레지스트리를 허용할 뿐이며,
   * 실데이터 채점의 차단을 풀지 않는다. 아래 assertSyntheticDryRun이 이를 강제한다.
   */
  dryRun?: boolean;
}

/**
 * 합성 자료 표식.
 *
 * 수집 경로는 이 필드를 절대 쓰지 않는다(SubmissionRecord에 없는 필드다).
 * 그러므로 이 표식이 있는 기록은 사람이 만든 합성 픽스처뿐이고,
 * Firestore에서 읽은 실제 학생 제출에는 붙지 않는다.
 */
export const SYNTHETIC_MARKER = 'synthetic' as const;

export function isSyntheticRecord(record: SubmissionRecord): boolean {
  return (record as unknown as Record<string, unknown>)[SYNTHETIC_MARKER] === true;
}

/**
 * dryRun을 합성 자료에만 묶는다.
 *
 * 1) 호출한 쪽이 dataSource='synthetic'이라고 밝혀야 한다.
 * 2) 연구 저장소에 쓰는 저장소로는 모의 실행을 하지 않는다.
 * 3) 모든 기록에 합성 표식이 있어야 한다. 하나라도 없으면 실데이터로 보고 막는다.
 * 반대로 실데이터 채점에 합성 기록이 섞여 있어도 막는다(픽스처가 본자료에 들어가지 않게).
 */
export function assertSyntheticDryRun(
  deps: Pick<ScoringJobDeps, 'dataSource' | 'storeIsPersistent'>,
  submissions: readonly SubmissionRecord[],
  dryRun: boolean
): string[] {
  const blockers: string[] = [];
  if (dryRun) {
    if (deps.dataSource !== 'synthetic') {
      blockers.push('모의 실행(dryRun)은 합성 자료에만 쓸 수 있다(dataSource가 synthetic이 아님)');
    }
    if (deps.storeIsPersistent) {
      blockers.push('모의 실행 결과를 연구 저장소에 쓸 수 없다');
    }
    const notSynthetic = submissions.filter((s) => !isSyntheticRecord(s));
    if (notSynthetic.length) {
      blockers.push(
        `모의 실행 대상에 합성 표식이 없는 기록이 ${notSynthetic.length}건 있다(실데이터로 본다)`
      );
    }
  } else {
    const synthetic = submissions.filter(isSyntheticRecord);
    if (synthetic.length) {
      blockers.push(`본채점 대상에 합성 기록이 ${synthetic.length}건 섞여 있다`);
    }
  }
  return blockers;
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
  /**
   * 모의 실행에서 그대로 남아 있는 미확정 값. 비어 있지 않으면 본연구를 시작할 수 없다.
   * 모의 실행 결과를 '완료'로 읽지 않도록 결과에 함께 담는다.
   */
  unresolvedBlockers: string[];
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

  // dryRun을 먼저 자료 성격에 묶는다. 이 검사를 통과하지 못하면
  // candidate 허용도 받지 못한다(플래그 하나로 실데이터 차단이 풀리지 않게).
  const syntheticBlockers = assertSyntheticDryRun(deps, submissions, dryRun);
  if (syntheticBlockers.length) throw new ScoringBlockedError(syntheticBlockers);

  const start = checkResearchStartAllowed(deps.registry, { allowCandidate: dryRun });
  if (!start.allowed) throw new ScoringBlockedError(start.blockers);
  // 모의 실행이어도 어떤 값이 미확정인지 결과에 남긴다. 완료로 보고하지 않기 위해서다.
  const unresolvedBlockers = dryRun ? start.blockers : [];

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
    unresolvedBlockers,
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
