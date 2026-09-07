#!/usr/bin/env node
/**
 * 검사 응답 사후 일괄 채점 작업.
 *
 * 수집이 끝난 뒤에 돌린다. 검사 화면은 AI를 부르지 않으므로 채점은 전부 여기서 일어난다.
 * 사전·사후를 섞어 같은 frozen 도구로 채점하며, 채점자 payload에는
 * 시점·학생·학급·자동 점수를 넣지 않는다.
 *
 * 실행 (TypeScript 모듈을 그대로 불러오므로 tsx가 필요하다)
 *
 *   node --import tsx --import ./scripts/_node-server-modules.mjs scripts/score-assessments.mjs --seed <시드>
 *   node --import tsx --import ./scripts/_node-server-modules.mjs scripts/score-assessments.mjs --seed <시드> --repeat 1 --dry-run --input <합성자료.json>
 *
 * `--import ./scripts/_node-server-modules.mjs`를 반드시 함께 넣는다. src/server/** 가 쓰는
 * `server-only` 패키지는 Node 기본 조건에서 불러오는 즉시 예외를 던지므로, 그 preload가
 * 빈 모듈로 바꿔 준다. `--conditions=react-server`는 React 18을 깨뜨리므로 쓰지 않는다.
 *
 * 인자
 *   --seed     시점 혼합에 쓸 시드. 필수. 결과에 그대로 기록되어 순서를 재현할 수 있다.
 *   --repeat   1(주 자료) | 2 | 3(신뢰도 분석용). 기본 1.
 *   --dry-run  합성 자료 대상 모의 실행. candidate 레지스트리를 이 플래그로만 허용한다.
 *              이 플래그는 실데이터 채점의 차단을 풀지 않는다. 대상 기록마다
 *              "synthetic": true 표식이 있어야 하고 결과는 메모리에만 쌓인다.
 *   --input    모의 실행에서 읽을 합성 제출 JSON 파일. 실제 학생 자료를 넣지 않는다.
 *   --class    특정 학급만 채점할 때의 연구용 학급ID.
 *   --all-classes  학급을 지정하지 않고 전부 채점한다. 범위를 밝히지 않은 조회를 막으려고,
 *              --class 없이 실행할 때는 이 플래그를 명시하게 한다.
 *   --out      결과 요약을 쓸 JSON 경로. 생략하면 표준출력에만 쓴다.
 *
 * 실채점(--dry-run 아님)에는 서버 자격증명(FIREBASE_SERVICE_ACCOUNT_JSON)과 모델 키
 * (GOOGLE_GENAI_API_KEY)가 있어야 한다. 없으면 모듈을 불러오는 단계에서 멈춘다.
 * 모의 실행에는 둘 다 필요하지 않다.
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
    else if (a === '--all-classes') out.allClasses = true;
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
    // 모의 실행 대상은 합성 자료여야 한다. 표식이 없는 기록은 실데이터로 본다.
    const notMarked = submissions.filter((r) => r?.synthetic !== true);
    if (notMarked.length) {
      console.error(
        `--dry-run 입력의 ${notMarked.length}건에 "synthetic": true 표식이 없다. ` +
          '실제 학생 자료를 모의 실행으로 채점할 수 없다.'
      );
      process.exit(2);
    }
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
      imageHash: 'dry-run',
      promptHash: 'dry-run',
      codeCommit: 'dry-run',
      scoredAt: new Date().toISOString(),
    });
    isConsentActive = async () => true;
  } else {
    // 인자 오류를 먼저 알린다. 모듈을 불러오기 전에 확인해야 환경 변수 오류에 가려지지 않는다.
    if (!args.classResearchId && !args.allClasses) {
      console.error('--class 로 학급을 지정하거나, 전부 채점하려면 --all-classes 를 명시한다.');
      process.exit(2);
    }
    const [{ createFirestoreAssessmentStore }, { grading }, { auth }] = await Promise.all([
      import('../src/server/assessment/firestore-store.ts'),
      import('../src/server/grading/index.ts'),
      import('../src/server/auth/index.ts'),
    ]);
    store = createFirestoreAssessmentStore();
    submissions = await store.listSubmissions(
      args.classResearchId ? { classResearchId: args.classResearchId } : { allClasses: true }
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
      {
        store,
        registry,
        runOperationalScoring,
        isConsentActive,
        // 자료 성격을 밝힌다. dryRun은 synthetic일 때만 통과한다.
        dataSource: args.dryRun ? 'synthetic' : 'research',
        storeIsPersistent: !args.dryRun,
      },
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
      // 모의 실행에서 그대로 남은 미확정 값. 비어 있지 않으면 본연구를 시작할 수 없다.
      unresolvedBlockers: result.unresolvedBlockers,
      // 순서 전체를 남긴다. 같은 시드로 이 순서를 다시 만들 수 있어야 한다.
      order: result.order,
    };

    console.log(JSON.stringify(summary, null, 2));
    if (args.out) await writeFile(args.out, JSON.stringify({ ...result }, null, 2), 'utf8');
    if (args.dryRun) {
      console.log('\n모의 실행이다. 합성 자료를 대상으로 하였으며 실제 채점 결과가 아니다.');
      if (result.unresolvedBlockers.length) {
        console.log('아직 남아 있는 미확정 값(본연구 시작 불가):');
        for (const b of result.unresolvedBlockers) console.log(` - ${b}`);
      }
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
