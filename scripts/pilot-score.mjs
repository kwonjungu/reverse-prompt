#!/usr/bin/env node
/**
 * 실제 모델 예비 점검(논문 v12-2 Ⅲ.4.나 '예비 점검').
 *
 * 연구자가 구성한 문장(대표 사진 3장 × 문항당 8개 = 24개)을 운영 채점기(grading.runOperationalScoring)와
 * 같은 설정(모델 ID·온도·지시문·단서 팩·재시도·피드백 검증)으로 채점하고, 결과를 로컬 CSV로만 남긴다.
 * 연구 저장소(Firestore)에 쓰지 않는다. 결과는 결측률·fallback률 확인용이며 연구 자료가 아니다.
 *
 * 실행
 *
 *   GOOGLE_GENAI_API_KEY=… RESEARCH_ASSET_DIR=… \
 *   node --import tsx --import ./scripts/_node-server-modules.mjs scripts/pilot-score.mjs --input pilot.json
 *
 * 입력 JSON: [{ "id": "P01", "questionId": "L05", "text": "연구자가 구성한 문장" }, …] (id는 생략 가능)
 *
 * 인자
 *   --input       입력 JSON 경로. 필수.
 *   --out         결과 CSV 경로. 생략하면 ./rp_pilot_<시각>.csv (.gitignore의 rp_*.csv — 커밋되지 않는다)
 *   --experience  단서 팩 없이 공통 문언만으로 채점한다(일반 체험과 같은 경로). 기본은 연구 수업과 같은
 *                 경로(research_practice)이며, 그때는 단서 팩(RESEARCH_ASSET_DIR/cue-pack.json)이 있어야 한다.
 *
 * 지키는 것
 *   - 모델 키는 환경 변수(GOOGLE_GENAI_API_KEY)로만 받는다. 인자로 받지 않는다.
 *   - 표준출력·오류 출력에 키·문장을 찍지 않는다. 항목 ID와 결과 상태·요약만 찍는다.
 *   - 개인정보 점검에 걸린 문장은 운영과 같이 모델에 보내지 않고 결측으로 남는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const out = { experience: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--experience') out.experience = true;
  }
  return out;
}

// tsx가 .ts를 CommonJS로 읽으므로 이름 있는 import 대신 모듈 전체를 받아 꺼낸다.
const pick = (mod) => mod.default ?? mod;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('--input 이 필요하다(문항 ID와 문장의 JSON 배열).');
    process.exit(2);
  }
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    console.error('GOOGLE_GENAI_API_KEY 환경 변수가 없다. 모델 키는 환경 변수로만 받는다.');
    process.exit(2);
  }

  const { parsePilotInput, buildPilotCsv, summarizePilot } = pick(await import('../src/server/export/pilot-summary.ts'));
  let items;
  try {
    items = parsePilotInput(JSON.parse(await readFile(args.input, 'utf8')));
  } catch (err) {
    // 입력 검사 문구에는 문장이 들어가지 않는다(몇 번째 항목인지만).
    console.error(`입력을 읽지 못했다: ${err instanceof Error ? err.message : 'error'}`);
    process.exit(2);
  }
  const { grading } = pick(await import('../src/server/grading/index.ts'));
  const sessionType = args.experience ? 'experience' : 'research_practice';

  // 연구 경로는 문항 단서가 있어야 채점한다. 단서가 없으면 운영 채점기는 모델을 부르지 않고 결측
  // (required_call_failed)을 돌려주므로, 그것이 모델 결측률에 섞이지 않게 미리 확인하고 멈춘다.
  if (!args.experience) {
    const { registry, ensureCuePackLoaded } = pick(await import('../src/server/registry/index.ts'));
    await ensureCuePackLoaded();
    const missingCues = [];
    for (const qid of [...new Set(items.map((it) => it.questionId))]) {
      try {
        registry.getCues(qid);
      } catch {
        missingCues.push(qid);
      }
    }
    if (missingCues.length) {
      console.error(
        `단서 팩에 없는 문항: ${missingCues.join(', ')}. RESEARCH_ASSET_DIR/cue-pack.json을 두거나 --experience로 공통 문언만 쓴다.`
      );
      process.exit(2);
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const rows = [];
  for (const [i, item] of items.entries()) {
    let run;
    try {
      run = await grading.runOperationalScoring({
        questionId: item.questionId,
        studentText: item.text,
        operationId: `pilot_${stamp}_${item.id}`,
        repeatIndex: 1,
        sessionType,
        wantFeedback: true,
      });
    } catch (err) {
      // 등록되지 않은 문항·세션 같은 레지스트리 오류는 운영에서도 채점을 거부한다. 문장은 찍지 않는다.
      console.error(`[${i + 1}/${items.length}] ${item.id} ${item.questionId}: 채점 거부 — ${err?.code ?? err?.name ?? 'error'}`);
      process.exitCode = 1;
      continue;
    }
    rows.push({ item, run });
    const status = run.result.status === 'scored' ? 'scored' : `missing(${run.result.reason})`;
    console.log(`[${i + 1}/${items.length}] ${item.id} ${item.questionId}: ${status}, 피드백 ${run.feedback?.status ?? '-'}`);
  }

  const out = path.resolve(args.out ?? `rp_pilot_${stamp}.csv`);
  await writeFile(out, buildPilotCsv(rows), 'utf8');
  const summary = summarizePilot(rows);
  console.log(JSON.stringify({ sessionType, out: path.relative(process.cwd(), out), ...summary }, null, 2));
}

main().catch((err) => {
  // 오류 메시지에 키·문장이 들어가지 않도록 이름과 코드만 찍는다.
  console.error(`예비 점검 실패: ${err?.code ?? err?.name ?? 'error'}`);
  process.exit(1);
});
