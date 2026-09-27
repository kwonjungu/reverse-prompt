/**
 * 비공개 단서 팩 보관·적재 시험 (src/server/registry/cue-pack-store.ts)
 *
 * 여기서 고정하는 것
 *   1. 파일(RESEARCH_ASSET_DIR/cue-pack.json)이 있으면 파일이 이기고 Firestore 사본을 읽지 않는다.
 *      파일이 깨져 있어도 사본으로 내려가지 않는다.
 *   2. 사본은 TTL 안에서 한 번만 읽고, 읽기 실패·해시 불일치·깨진 JSON은 빈 팩(fail closed)이다.
 *   3. 올리기는 저장 전에 parseCuePack 검증을 먼저 하고, 통과하지 못하면 저장할 문서를 만들지 않는다.
 *   4. 점검 결과·상태 요약에 단서 본문과 파일에서 온 임의 ID가 실리지 않는다.
 *
 * 실제 파일 시스템·Firestore는 쓰지 않는다. 읽기는 모두 가짜 구현으로 주입한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Band } from '@/lib/scoring';
import { PRACTICE_QUESTION_IDS, findBaseEntry } from '@/server/registry/entries';
import { createRegistry, emptyCuePack, type RegistryDeps } from '@/server/registry/core';
import {
  CUE_PACK_MAX_BYTES,
  CUE_PACK_STORE_SCHEMA,
  checkCuePackUpload,
  copyInfoOf,
  coverageOf,
  createCuePackLoader,
  parseStoredCuePack,
  sha256Text,
  storedDocOf,
  summarizeActive,
  type CuePackDocRead,
  type CuePackFileProbe,
  type CuePackUploadContext,
} from '@/server/registry/cue-pack-store';

/* ────────────────────────── 도우미 ────────────────────────── */

/** 단서 본문에 넣는 표지. 점검 결과·요약·기록에 이 문자열이 나오면 본문이 새어 나간 것이다. */
const SECRET = '비밀단서표지-7f3a';

function cuesFor(band: Band, tag: string) {
  const anchor = { '1': `${SECRET}-a1`, '2': `${SECRET}-a2`, '3': `${SECRET}-a3`, '4': `${SECRET}-a4` };
  const anchors: Record<string, Record<string, string>> = { object: { ...anchor }, specificity: { ...anchor } };
  if (band !== 'A') anchors.context = { ...anchor };
  return {
    coreObjects: [`${SECRET}-대상-${tag}`],
    requiredAttributes: [`${SECRET}-속성-${tag}`],
    requiredContext: band === 'A' ? [] : [`${SECRET}-맥락-${tag}`],
    acceptedExpressions: [],
    notRequired: [],
    contradictions: [],
    anchors,
  };
}

function packJson(options: { cueVersion?: string | null; omit?: string[]; extra?: Record<string, unknown> } = {}): string {
  const questions: Record<string, unknown> = {};
  for (const id of PRACTICE_QUESTION_IDS) {
    if (options.omit?.includes(id)) continue;
    questions[id] = cuesFor(findBaseEntry(id)!.band, id);
  }
  const body: Record<string, unknown> = { questions: { ...questions, ...(options.extra ?? {}) } };
  if (options.cueVersion !== null) body.cueVersion = options.cueVersion ?? 'v12-2-test-1';
  return JSON.stringify(body, null, 2);
}

const NO_CONTEXT: CuePackUploadContext = { current: null, currentPracticeLoadedCount: null, fileSourceActive: false };

function assertNoSecret(value: unknown, label: string) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(SECRET), false, `${label}에 단서 본문이 실렸다`);
}

/** 가짜 시계와 가짜 Firestore를 붙인 적재기 */
function makeLoader(options: {
  file?: () => CuePackFileProbe;
  doc?: () => Promise<CuePackDocRead>;
  ttlMs?: number;
}) {
  let clock = 1_000_000;
  let reads = 0;
  const errors: unknown[] = [];
  const loader = createCuePackLoader({
    probeFile: options.file ?? (() => ({ kind: 'no_dir' })),
    readDoc: async () => {
      reads += 1;
      return (options.doc ?? (async () => ({ exists: false }) as CuePackDocRead))();
    },
    now: () => clock,
    ttlMs: options.ttlMs ?? 60_000,
    onReadError: (e) => errors.push(e),
  });
  return {
    loader,
    advance: (ms: number) => {
      clock += ms;
    },
    reads: () => reads,
    errors,
  };
}

function storedDataOf(json: string, now = new Date('2026-09-01T00:00:00Z')) {
  const check = checkCuePackUpload(json, NO_CONTEXT);
  assert.ok(check.ok, check.problem ?? '');
  const doc = storedDocOf(json, check, { now, actor: 'admin-console' });
  assert.ok(doc);
  return doc;
}

/* ────────────────────────── 올리기 전 점검 ────────────────────────── */

test('올리기 — 연습 36문항이 다 있는 팩은 경고 없이 저장할 수 있고 저장 문서는 형식 버전·해시·개수를 담는다', () => {
  const json = packJson({ extra: { T1: cuesFor('A', 'T1') } });
  const check = checkCuePackUpload(json, NO_CONTEXT);
  assert.equal(check.ok, true);
  assert.equal(check.problem, null);
  assert.deepEqual(check.warnings, []);
  assert.equal(check.practiceLoadedCount, 36);
  assert.equal(check.validCount, 37);
  assert.equal(check.cueVersion, 'v12-2-test-1');
  assert.deepEqual(check.others, [{ questionId: 'T1', state: 'loaded', reason: null }]);

  const doc = storedDocOf(json, check, { now: new Date('2026-09-01T00:00:00Z'), actor: 'admin-console' });
  assert.ok(doc);
  assert.equal(doc.schemaVersion, CUE_PACK_STORE_SCHEMA);
  assert.equal(doc.sha256, sha256Text(json));
  assert.equal(doc.json, json);
  assert.equal(doc.questionCount, 37);
  assert.equal(doc.invalidCount, 0);
  assert.equal(doc.byteLength, Buffer.byteLength(json, 'utf8'));
  assert.equal(doc.updatedAt, '2026-09-01T00:00:00.000Z');
});

test('올리기 — 검증을 저장보다 먼저 한다: 통과하지 못한 파일로는 저장할 문서를 만들지 않는다', () => {
  const cases: Array<[unknown, RegExp]> = [
    [undefined, /읽지 못했습니다/],
    ['', /빈 파일/],
    ['   ', /빈 파일/],
    ['{"questions": [', /JSON 형식이 아닙니다/],
    ['[1,2,3]', /최상위가 객체가 아닙니다/],
    ['{"cueVersion":"v1"}', /questions 객체가 없습니다/],
    [packJson({ cueVersion: null }), /cueVersion이 없습니다/],
    [packJson({ cueVersion: 'x'.repeat(101) }), /cueVersion이 너무 깁니다/],
    [JSON.stringify({ cueVersion: 'v1', questions: { L01: { coreObjects: [] } } }), /하나도 없어/],
  ];
  for (const [input, problem] of cases) {
    const check = checkCuePackUpload(input, NO_CONTEXT);
    assert.equal(check.ok, false, String(input).slice(0, 40));
    assert.match(check.problem ?? '', problem);
    assert.equal(storedDocOf(String(input ?? ''), check, { now: new Date(), actor: 'a' }), null);
  }
});

test('올리기 — JSON 오류 문구에 파일 내용을 인용하지 않는다', () => {
  const broken = `{"cueVersion":"v1","questions":{"L01":{"coreObjects":["${SECRET}"]}`;
  const check = checkCuePackUpload(broken, NO_CONTEXT);
  assert.equal(check.ok, false);
  assertNoSecret(check, 'JSON 오류 점검 결과');
});

test('올리기 — 크기 상한을 넘으면 해석하지 않고 거절한다', () => {
  const big = `{"cueVersion":"v1","questions":{},"pad":"${'가'.repeat(Math.ceil(CUE_PACK_MAX_BYTES / 3) + 10)}"}`;
  const check = checkCuePackUpload(big, NO_CONTEXT);
  assert.equal(check.ok, false);
  assert.match(check.problem ?? '', /너무 큽니다/);
});

test('올리기 — 앞의 BOM은 떼고 저장한다', () => {
  const json = packJson();
  const check = checkCuePackUpload(`﻿${json}`, NO_CONTEXT);
  assert.equal(check.ok, true);
  assert.equal(check.sha256, sha256Text(json));
  const doc = storedDocOf(`﻿${json}`, check, { now: new Date(), actor: 'a' });
  assert.equal(doc?.json, json);
});

test('올리기 — 점검한 내용과 저장하려는 내용이 다르면 문서를 만들지 않는다', () => {
  const check = checkCuePackUpload(packJson(), NO_CONTEXT);
  assert.equal(storedDocOf(packJson({ cueVersion: 'other' }), check, { now: new Date(), actor: 'a' }), null);
});

test('올리기 — 지금 사본과 cueVersion이 같은데 내용이 다르면 거절하고, 똑같은 파일이면 바꿀 것이 없다고 한다', () => {
  const json = packJson();
  const current = copyInfoOf(storedDataOf(json));

  const same = checkCuePackUpload(json, { ...NO_CONTEXT, current, currentPracticeLoadedCount: 36 });
  assert.equal(same.ok, false);
  assert.match(same.problem ?? '', /똑같은 파일/);

  const changed = checkCuePackUpload(packJson({ omit: ['L36'] }), {
    ...NO_CONTEXT,
    current,
    currentPracticeLoadedCount: 36,
  });
  assert.equal(changed.ok, false);
  assert.match(changed.problem ?? '', /cueVersion\(v12-2-test-1\)이 같은데/);

  const bumped = checkCuePackUpload(packJson({ cueVersion: 'v12-2-test-2', omit: ['L36'] }), {
    ...NO_CONTEXT,
    current,
    currentPracticeLoadedCount: 36,
  });
  assert.equal(bumped.ok, true);
  assert.ok(bumped.warnings.some((w) => w.includes('35개만')));
  assert.ok(bumped.warnings.some((w) => w.includes('지금 사본(연습 36개 적재)보다')));
});

test('올리기 — 문항별 상태(L01~L36): 적재·실격(고정 사유)·없음, 레지스트리에 없는 ID는 개수만', () => {
  const json = packJson({
    omit: ['L05'],
    extra: {
      L07: { ...cuesFor('A', 'L07'), coreObjects: [] },
      [`${SECRET}-없는문항`]: cuesFor('A', 'x'),
    },
  });
  const check = checkCuePackUpload(json, { ...NO_CONTEXT, fileSourceActive: true });
  assert.equal(check.ok, true);
  assert.equal(check.practice.length, 36);
  assert.deepEqual(check.practice.find((r) => r.questionId === 'L05'), { questionId: 'L05', state: 'absent', reason: null });
  const l07 = check.practice.find((r) => r.questionId === 'L07');
  assert.equal(l07?.state, 'invalid');
  assert.match(l07?.reason ?? '', /coreObjects/);
  assert.equal(check.practiceLoadedCount, 34);
  assert.equal(check.unknownIdCount, 1);
  assert.equal(check.others.length, 0);
  assert.ok(check.warnings.some((w) => w.includes('RESEARCH_ASSET_DIR')), '파일이 우선한다는 경고');
  assert.ok(check.warnings.some((w) => w.includes('레지스트리에 없는 문항 ID 1개')));
  assertNoSecret(check, '점검 결과');
});

/* ────────────────────────── Firestore 사본 읽기 ────────────────────────── */

test('사본 — 저장한 문서를 다시 읽으면 같은 단서가 적재된다', () => {
  const doc = storedDataOf(packJson());
  const { pack, sha256 } = parseStoredCuePack(doc);
  assert.equal(pack.loaded, true);
  assert.equal(pack.cueVersion, 'v12-2-test-1');
  assert.equal(Object.keys(pack.questions).length, 36);
  assert.equal(sha256, doc.sha256);
  const info = copyInfoOf(doc);
  assert.equal(info.readable, true);
  assert.equal(info.practiceLoadedCount, 36);
  assertNoSecret(info, '사본 정보');
});

test('사본 — 해시 불일치·형식 버전 불명·깨진 JSON·빈 문서는 빈 팩(fail closed)', () => {
  const doc = storedDataOf(packJson());
  const cases: Array<[unknown, RegExp]> = [
    [{ ...doc, json: doc.json.replace('L01', 'L02') }, /SHA-256이 내용과 맞지 않습니다/],
    [{ ...doc, schemaVersion: 'cue-pack-store-0' }, /schemaVersion/],
    [{ ...doc, json: '{', sha256: sha256Text('{') }, /JSON으로 읽지 못했습니다/],
    [{ ...doc, json: undefined }, /json·sha256이 없습니다/],
    [null, /형식이 올바르지 않습니다/],
  ];
  for (const [data, reason] of cases) {
    const { pack } = parseStoredCuePack(data);
    assert.equal(pack.loaded, false);
    assert.deepEqual(pack.questions, {}, '일부만 맞는 자료를 쓰지 않는다');
    assert.match(pack.error ?? '', reason);
    assert.equal(copyInfoOf(data).readable, false);
  }
});

/* ────────────────────────── 적재기: 우선순위·TTL·실패 ────────────────────────── */

test('적재기 — 파일이 있으면 파일을 쓰고 Firestore 사본을 읽지 않는다', async () => {
  const fileJson = packJson({ cueVersion: 'file-v1' });
  const copy = storedDataOf(packJson({ cueVersion: 'copy-v1' }));
  const h = makeLoader({
    file: () => ({ kind: 'present', key: 'k1', read: () => fileJson }),
    doc: async () => ({ exists: true, data: copy }),
  });
  const active = await h.loader.ensureLoaded();
  assert.equal(active.source, 'file');
  assert.equal(active.pack.cueVersion, 'file-v1');
  assert.equal(h.loader.current().pack.cueVersion, 'file-v1');
  await h.loader.ensureLoaded({ force: true });
  assert.equal(h.reads(), 0, '파일이 있으면 사본을 읽지 않는다');
});

test('적재기 — 파일이 깨져 있어도 사본으로 내려가지 않는다', async () => {
  const copy = storedDataOf(packJson({ cueVersion: 'copy-v1' }));
  const h = makeLoader({
    file: () => ({ kind: 'present', key: 'k1', read: () => '{ 깨진' }),
    doc: async () => ({ exists: true, data: copy }),
  });
  const active = await h.loader.ensureLoaded();
  assert.equal(active.source, 'file');
  assert.equal(active.pack.loaded, false);
  assert.match(active.pack.error ?? '', /JSON으로 읽지 못했습니다/);
  assert.equal(h.reads(), 0);
});

test('적재기 — 파일은 수정 표지(key)가 바뀔 때만 다시 읽는다', () => {
  let key = 'k1';
  let body = packJson({ cueVersion: 'file-v1' });
  let fileReads = 0;
  const h = makeLoader({
    file: () => ({ kind: 'present', key, read: () => { fileReads += 1; return body; } }),
  });
  h.loader.current();
  h.loader.current();
  assert.equal(fileReads, 1);
  body = packJson({ cueVersion: 'file-v2' });
  key = 'k2';
  assert.equal(h.loader.current().pack.cueVersion, 'file-v2');
  assert.equal(fileReads, 2);
});

test('적재기 — 파일이 없으면 사본을 읽고, TTL 안에서는 다시 읽지 않는다', async () => {
  const copy = storedDataOf(packJson({ cueVersion: 'copy-v1' }));
  const h = makeLoader({ file: () => ({ kind: 'missing' }), doc: async () => ({ exists: true, data: copy }) });

  // 아직 읽지 않았으면 동기 조회는 빈 팩이다(지어내지 않는다).
  assert.equal(h.loader.current().source, 'none');
  assert.equal(h.loader.current().pack.loaded, false);

  const active = await h.loader.ensureLoaded();
  assert.equal(active.source, 'firestore');
  assert.equal(active.pack.cueVersion, 'copy-v1');
  assert.equal(h.loader.current().pack.cueVersion, 'copy-v1', '레지스트리는 캐시를 동기로 읽는다');
  assert.equal(h.reads(), 1);

  h.advance(59_000);
  await h.loader.ensureLoaded();
  assert.equal(h.reads(), 1, 'TTL 안에서는 다시 읽지 않는다');

  h.advance(2_000);
  await h.loader.ensureLoaded();
  assert.equal(h.reads(), 2, 'TTL이 지나면 다시 읽는다');

  await h.loader.ensureLoaded({ force: true });
  assert.equal(h.reads(), 3, 'force는 TTL을 무시한다');
});

test('적재기 — 동시에 부르면 한 번만 읽는다', async () => {
  const copy = storedDataOf(packJson());
  const h = makeLoader({ doc: async () => ({ exists: true, data: copy }) });
  await Promise.all([h.loader.ensureLoaded(), h.loader.ensureLoaded(), h.loader.ensureLoaded()]);
  assert.equal(h.reads(), 1);
});

test('적재기 — 사본이 없으면 출처 none과 안내 문구', async () => {
  const h = makeLoader({ doc: async () => ({ exists: false }) });
  const active = await h.loader.ensureLoaded();
  assert.equal(active.source, 'none');
  assert.equal(active.pack.loaded, false);
  assert.match(active.pack.error ?? '', /관리 화면/);
});

test('적재기 — 읽기 실패는 빈 팩(앞서 읽은 사본도 버림)이고 다음 요청이 다시 읽는다', async () => {
  const copy = storedDataOf(packJson({ cueVersion: 'copy-v1' }));
  let fail = false;
  const h = makeLoader({
    doc: async () => {
      if (fail) throw Object.assign(new Error('UNAVAILABLE'), { code: 14 });
      return { exists: true, data: copy };
    },
  });
  assert.equal((await h.loader.ensureLoaded()).pack.cueVersion, 'copy-v1');

  fail = true;
  h.advance(61_000);
  const failed = await h.loader.ensureLoaded();
  assert.equal(failed.source, 'none');
  assert.equal(failed.pack.loaded, false);
  assert.deepEqual(failed.pack.questions, {}, '지워졌을 수도 있는 사본으로 채점하지 않는다');
  assert.match(failed.pack.error ?? '', /읽지 못했습니다/);
  assert.equal(h.errors.length, 1);

  // 실패는 캐시하지 않는다. TTL 안이어도 다음 요청이 다시 읽는다.
  fail = false;
  const again = await h.loader.ensureLoaded();
  assert.equal(again.pack.cueVersion, 'copy-v1');
  assert.equal(h.reads(), 3);
});

test('적재기 — invalidate 전에 시작한 읽기의 결과는 버리고 새로 읽는다', async () => {
  const v1 = storedDataOf(packJson({ cueVersion: 'copy-v1' }));
  const v2 = storedDataOf(packJson({ cueVersion: 'copy-v2' }));
  let release: (() => void) | null = null;
  let current = v1;
  let first = true;
  const h = makeLoader({
    doc: async () => {
      const data = current;
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { exists: true, data };
    },
  });
  const slow = h.loader.ensureLoaded();
  // 관리 화면이 새 사본을 저장하고 캐시를 버린다.
  current = v2;
  h.loader.invalidate();
  const fresh = await h.loader.ensureLoaded();
  assert.equal(fresh.pack.cueVersion, 'copy-v2');
  (release as unknown as () => void)();
  await slow;
  assert.equal(h.loader.current().pack.cueVersion, 'copy-v2', '늦게 끝난 옛 읽기가 새 사본을 덮지 않는다');
});

/* ────────────────────────── 상태 요약·레지스트리 연결 ────────────────────────── */

test('상태 요약 — 출처·버전·해시 앞자리·문항별 상태만 담고 단서 본문과 임의 ID는 담지 않는다', async () => {
  const json = packJson({ extra: { [`${SECRET}-없는문항`]: cuesFor('A', 'x'), L02: { coreObjects: [] } } });
  const copy = storedDataOf(json);
  const h = makeLoader({ doc: async () => ({ exists: true, data: copy }) });
  const summary = summarizeActive(await h.loader.ensureLoaded());
  assert.equal(summary.source, 'firestore');
  assert.equal(summary.loaded, true);
  assert.equal(summary.cueVersion, 'v12-2-test-1');
  assert.equal(summary.sha256Prefix, copy.sha256.slice(0, 12));
  assert.equal(summary.coverage.practiceLoadedCount, 35);
  assert.ok(summary.invalid.L02);
  assert.equal(Object.keys(summary.invalid).length, 1, '등록되지 않은 ID는 사유 목록에 넣지 않는다');
  assertNoSecret(summary, '상태 요약');
});

test('레지스트리 연결 — 사본에서 적재한 팩으로 v12 준비 조건이 통과하고 단서를 쓸 수 있다', async () => {
  const copy = storedDataOf(packJson());
  const h = makeLoader({ doc: async () => ({ exists: true, data: copy }) });
  const deps: RegistryDeps = {
    makeError: (message, code) => Object.assign(new Error(message), { code }),
    cuePack: () => h.loader.current().pack,
    loadImageBytes: async () => null,
    assessmentImageStatus: () => ({ missing: ['T1', 'T2_v7', 'T3'], mismatch: [] }),
    config: { researchAssetDir: '', consentVersion: 'c1', irbApproval: 'IRB-1', modelAccessVerified: true },
  };
  const registry = createRegistry(deps);

  // 적재 전: 단서가 없어 연구 수업을 열 수 없다.
  assert.equal(registry.readiness().researchReady, false);
  assert.throws(() => registry.getCues('L01'), (e: unknown) => (e as { code?: string }).code === 'cues_missing');

  await h.loader.ensureLoaded();
  assert.deepEqual(registry.readiness().blockers, []);
  assert.equal(registry.getEntry('L01').cuesLoaded, true);
  assert.equal(registry.getEntry('L01').cueVersion, 'v12-2-test-1');
  assert.ok(registry.getCues('L20').coreObjects.length > 0);
  // 옛 검사 조건은 그대로 막힌다(검사 이미지·단서·확정 없음).
  assert.equal(registry.assessmentReadiness().researchReady, false);
});

test('coverageOf — 빈 팩은 연습 36문항 모두 없음이다', () => {
  const c = coverageOf(emptyCuePack('없음'));
  assert.equal(c.practice.length, 36);
  assert.ok(c.practice.every((r) => r.state === 'absent'));
  assert.equal(c.practiceLoadedCount, 0);
});

/* ────────────────────────── 배선의 정적 확인 ────────────────────────── */

const readSource = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

test('서버 진입점은 레지스트리를 쓰기 전에 단서 팩 적재를 기다린다', () => {
  for (const file of [
    'src/server/lessons/actions.ts',
    'src/server/admin/actions.ts',
    'src/server/assessment/actions.ts',
    'src/server/grading/index.ts',
    'src/ai/flows/evaluate-prompt.ts',
    'src/app/api/research/asset/[questionId]/route.ts',
  ]) {
    assert.match(readSource(file), /await ensureCuePackLoaded\(\)/, `${file}이 단서 팩 적재를 기다리지 않는다`);
  }
});

test('단서 팩 올리기 action은 점검을 먼저 하고, 조작 기록에 본문을 싣지 않는다', () => {
  const src = readSource('src/server/admin/cue-pack-actions.ts');
  const start = src.indexOf('export async function saveCuePackAction(');
  const body = src.slice(start, src.indexOf('export async function', start + 10));
  const checkAt = body.indexOf('checkAgainstCurrent(');
  const writeAt = body.indexOf('writeCuePackCopy(');
  assert.ok(checkAt > 0 && writeAt > checkAt, '저장 전에 점검한다');
  assert.match(body, /if \(!check\.ok\) return \{ saved: false/);
  const event = body.slice(body.indexOf("recordAdminEvent('upload_cue_pack'"));
  assert.equal(/json|text/.test(event.slice(0, event.indexOf('});'))), false, '조작 기록에 본문을 싣지 않는다');
  // 규칙 파일이 admin_config를 클라이언트에 닫아 둔다.
  const rules = readSource('firestore.rules');
  assert.match(rules, /match \/admin_config\/\{docId\} \{\s*allow read, write: if false;/);
});
