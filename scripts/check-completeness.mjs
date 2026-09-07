#!/usr/bin/env node
/**
 * 학생ID × 시점 × 문항의 중복·완전성 점검 도구.
 *
 * 한 학생은 사전 3문항 + 사후 3문항 = 6응답을 가져야 한다.
 * 검증 표본 36명은 학생 단위로 표집하며 각 6응답을 그대로 유지한다.
 * 이 도구는 결손을 채우지 않고 보고만 한다. 빈 칸을 0점이나 빈 응답으로 만들지 않는다.
 *
 * 실행 (TypeScript 모듈을 그대로 불러오므로 tsx가 필요하다)
 *   node --import tsx scripts/check-completeness.mjs --input <제출목록.json>
 *   node --import tsx scripts/check-completeness.mjs --live --class <연구용학급ID>
 *
 * 인자
 *   --input   제출 기록 JSON 배열 파일. 합성 자료 점검에 쓴다.
 *   --live    Firestore에서 실제 제출을 읽는다. 서버 자격증명이 필요하다.
 *   --class   특정 학급만 볼 때의 연구용 학급ID.
 *   --expect  점검 대상 학생ID 목록 파일(JSON 배열). 기록이 하나도 없는 학생의 결손도 잡는다.
 *   --out     보고서를 쓸 JSON 경로.
 */

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

function parseArgs(argv) {
  const out = { live: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') out.live = true;
    else if (a === '--input') out.input = argv[++i];
    else if (a === '--class') out.classResearchId = argv[++i];
    else if (a === '--expect') out.expect = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { checkCompleteness, RESPONSES_PER_STUDENT } = await import(
    '../src/server/export/completeness.ts'
  );

  let records;
  if (args.live) {
    const { createFirestoreAssessmentStore } = await import(
      '../src/server/assessment/firestore-store.ts'
    );
    const store = createFirestoreAssessmentStore();
    records = await store.listSubmissions(
      args.classResearchId ? { classResearchId: args.classResearchId } : undefined
    );
  } else if (args.input) {
    records = JSON.parse(await readFile(args.input, 'utf8'));
  } else {
    console.error('--input 또는 --live 가 필요하다.');
    process.exit(2);
  }

  const rows = records
    // 거절 기록은 정상적인 감사 흔적이므로 격자 점검에서 제외한다.
    .filter((r) => r.persistStatus !== 'rejected_duplicate')
    .map((r) => ({
      researchId: r.researchId,
      phase: r.phase,
      questionId: r.questionId,
      submissionId: r.submissionId,
      responseStatus: r.responseStatus,
      missingReason: r.missingReason ?? null,
    }));

  const expectedResearchIds = args.expect
    ? JSON.parse(await readFile(args.expect, 'utf8'))
    : undefined;

  const report = checkCompleteness(rows, { expectedResearchIds });

  const duplicates = report.issues.filter((i) => i.kind === 'duplicate');
  const absent = report.issues.filter((i) => i.kind === 'absent');
  const notSubmitted = report.issues.filter((i) => i.kind === 'not_submitted');
  const unknown = report.issues.filter((i) => i.kind === 'unknown_question');

  console.log(`학생 수: ${report.studentCount}`);
  console.log(`학생당 기대 응답 수: ${RESPONSES_PER_STUDENT}`);
  console.log(`6응답 완전한 학생: ${report.completeStudentCount}`);
  console.log(`중복(유효 제출 2건 이상): ${duplicates.length}`);
  console.log(`기록 없음: ${absent.length}`);
  console.log(`결측(사유 있음): ${notSubmitted.length}`);
  console.log(`레지스트리에 없는 문항: ${unknown.length}`);

  if (duplicates.length) {
    console.log('\n[중복] 최초 제출 불변 규칙을 확인할 것');
    for (const d of duplicates) {
      console.log(` - ${d.researchId} ${d.phase} ${d.questionId}: ${d.submissionIds.join(', ')}`);
    }
  }

  const incomplete = report.students.filter((s) => !s.complete);
  if (incomplete.length) {
    console.log('\n[6응답 미완] 결손을 채우지 말고 사유를 확인할 것');
    for (const s of incomplete) {
      console.log(
        ` - ${s.researchId}: 제출 ${s.submittedCount} / 결측 ${s.missingCount} / 기록없음 ${s.absentCount}`
      );
    }
  }

  if (args.out) await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
