#!/usr/bin/env node
/**
 * 검사 응답 사후 일괄 채점 작업.
 *
 * 수집이 끝난 뒤에 돌린다. 검사 화면은 AI를 부르지 않으므로 채점은 전부 여기서 일어난다.
 * 사전·사후를 섞어 같은 frozen 도구로 채점하며, 채점자 payload에는
 * 시점·학생·학급·자동 점수를 넣지 않는다.
 *
 * 실행 (TypeScript 모듈을 그대로 불러오므로 tsx가 필요하다)
 *   node --import tsx scripts/score-assessments.mjs --seed <시드> --repeat 1
 *   node --import tsx scripts/score-assessments.mjs --seed <시드> --repeat 1 --dry-run --input <합성자료.json>
 *
 * 인자
 *   --seed     시점 혼합에 쓸 시드. 필수. 결과에 그대로 기록되어 순서를 재현할 수 있다.
 *   --repeat   1(주 자료) | 2 | 3(신뢰도 분석용). 기본 1.
 *   --dry-run  합성 자료 대상 모의 실행. candidate 레지스트리를 이 플래그로만 허용한다.
 *   --input    모의 실행에서 읽을 합성 제출 JSON 파일. 실제 학생 자료를 넣지 않는다.
 *   --class    특정 학급만 채점할 때의 연구용 학급ID.
 *   --out      결과 요약을 쓸 JSON 경로. 생략하면 표준출력에만 쓴다.
 *
 * 주 자료(repeat 1)는 한 번 저장되면 다시 채점하지 않는다. 반복 2·3은 따로 쌓이며
 * 3회 평균으로 주 자료를 덮어쓰지 않는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

function parseArgs(argv) {
  const out = { repeat: 1, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--repeat') out.repeat = Number(argv[++i]);
    else if (a === '--input') out.input = argv[++i];
    else if (a === '--class') out.classResearchId = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.seed) {
    console.error('--seed 가 필요하다. 시점 혼합 순서를 재현하려면 시드를 기록해야 한다.');
    process.exit(2);
  }

  const [{ runScoringJob, ScoringBlockedError }, { createInMemoryAssessmentStore }, { registry }] =
    await Promise.all([
      import('../src/server/assessment/scoring-job.ts'),
      import('../src/server/assessment/store.ts'),
      import('../src/server/registry/index.ts'),
    ]);

  let store;
  let submissions;
  let runOperationalScoring;
  let isConsentActive;

  if (args.dryRun) {
    if (!args.input) {
      console.error('--dry-run 은 --input 합성 자료 파일이 필요하다. 실제 학생 자료를 쓰지 않는다.');
      process.exit(2);
    }
    submissions = JSON.parse(await readFile(args.input, 'utf8'));
    store = createInMemoryAssessmentStore();
    // 모의 실행에서는 실제 모델을 부르지 않는다. 합성 결과를 결측으로 남긴다.
    runOperationalScoring = async (req) => ({
      operationId: req.operationId,
      repeatIndex: req.repeatIndex,
      band: req.band,
      result: { status: 'missing', levels: null, score: null, axisScores: null, reason: 'model_error' },
      calls: [],
      extraCall: false,
      feedback: null,
      modelId: 'dry-run',
      modelConfig: {},
      rubricVersion: 'dry-run',
      cueVersion: 'dry-run',
      promptHash: 'dry-run',
      codeCommit: 'dry-run',
      scoredAt: new Date().toISOString(),
    });
    isConsentActive = async () => true;
  } else {
    const [{ createFirestoreAssessmentStore }, { grading }, { auth }] = await Promise.all([
      import('../src/server/assessment/firestore-store.ts'),
      import('../src/server/grading/index.ts'),
      import('../src/server/auth/index.ts'),
    ]);
    store = createFirestoreAssessmentStore();
    submissions = await store.listSubmissions(
      args.classResearchId ? { classResearchId: args.classResearchId } : undefined
    );
    runOperationalScoring = (req) => grading.runOperationalScoring(req);
    // 동의 철회 뒤에는 새 전송을 막는다. 전송 직전에 매 건 확인한다.
    isConsentActive = async (researchId) => {
      const consent = await auth.getConsent(researchId);
      return (
        !!consent &&
        !consent.withdrawnAt &&
        consent.guardianConsent === 'granted' &&
        consent.studentAssent === 'granted'
      );
    };
  }

  try {
    const result = await runScoringJob(
      { store, registry, runOperationalScoring, isConsentActive },
      submissions,
      { seed: args.seed, repeatIndex: args.repeat, dryRun: args.dryRun }
    );

    const summary = {
      seed: result.seed,
      repeatIndex: result.repeatIndex,
      dryRun: result.dryRun,
      batchId: result.batchId,
      total: result.order.length,
      scored: result.scored.length,
      skipped: result.skipped.length,
      cancelledByWithdrawal: result.cancelled.length,
      failed: result.failed.length,
      // 순서 전체를 남긴다. 같은 시드로 이 순서를 다시 만들 수 있어야 한다.
      order: result.order,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (args.out) await writeFile(args.out, JSON.stringify({ ...result }, null, 2), 'utf8');
    if (args.dryRun) {
      console.log('\n모의 실행이다. 합성 자료를 대상으로 하였으며 실제 채점 결과가 아니다.');
    }
  } catch (e) {
    if (e instanceof ScoringBlockedError) {
      console.error('본연구 채점을 시작할 수 없다. 막는 사유:');
      for (const b of e.blockers) console.error(` - ${b}`);
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
