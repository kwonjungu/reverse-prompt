/**
 * 문항 레지스트리 순수 함수 테스트 (수용시험 8·12 관련)
 *
 * 여기서는 실제 파일 시스템·환경 변수·모델을 쓰지 않는다. 자산 접근은 모두
 * 가짜 구현으로 주입한다. src/server/registry/index.ts의 실 배선(파일 읽기·설정)은
 * 이 테스트가 아니라 별도 통합 확인 대상이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Band } from '@/lib/scoring';
import {
  ASSESSMENT_INSTRUCTION,
  ASSESSMENT_ORDER,
  baseEntries,
  collectBlockers,
  findBaseEntry,
  practiceQuestionId,
  type ReadinessInput,
} from '@/server/registry/entries';
import {
  createRegistry,
  cuesForSession,
  emptyCuePack,
  parseCuePack,
  validateCues,
  type LoadedCuePack,
  type RegistryDeps,
} from '@/server/registry/core';

/* ────────────────────────── 도우미 ────────────────────────── */

class FakeRegistryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FakeRegistryError';
  }
}

const hasCode = (code: string) => (e: unknown) => e instanceof FakeRegistryError && e.code === code;

/** 필수 항목이 모두 채워진 단서 한 벌. 실제 정답이 아니라 형식 확인용 자리표시다. */
function filledCues(band: Band) {
  const anchor = { '1': 'a1', '2': 'a2', '3': 'a3', '4': 'a4', '5': 'a5' };
  const anchors: Record<string, Record<string, string>> = {
    object: { ...anchor },
    specificity: { ...anchor },
  };
  if (band !== 'A') anchors.context = { ...anchor };
  return {
    coreObjects: ['대상1'],
    requiredAttributes: ['속성1'],
    requiredContext: band === 'A' ? [] : ['맥락1'],
    acceptedExpressions: [],
    notRequired: [],
    contradictions: [],
    anchors,
  };
}

const ALL_ASSETS_PRESENT = {
  researchAssetDir: 'C:/fake/assets',
  consentVersion: 'v7-consent',
  irbApproval: 'IRB-FAKE-0000',
  modelAccessVerified: true,
};

function makeDeps(overrides: Partial<RegistryDeps> = {}): RegistryDeps {
  const pack: LoadedCuePack = overrides.cuePack ? overrides.cuePack() : emptyCuePack('테스트: 팩 없음');
  return {
    makeError: (message, code) => new FakeRegistryError(message, code),
    cuePack: () => pack,
    loadImageBytes: async () => null,
    assessmentImageStatus: () => ({ missing: [], mismatch: [] }),
    config: { ...ALL_ASSETS_PRESENT },
    ...overrides,
  };
}

function packWith(entries: Record<string, unknown>): LoadedCuePack {
  return parseCuePack({ cueVersion: 'v7-candidate', questions: entries });
}

/* ────────────────────────── 등록·거부 ────────────────────────── */

test('등록되지 않은 questionId는 unknown_question으로 거부한다', () => {
  const registry = createRegistry(makeDeps());
  assert.throws(() => registry.getEntry('T9'), hasCode('unknown_question'));
  assert.throws(() => registry.getEntry('L37'), hasCode('unknown_question'));
  assert.throws(() => registry.getEntry(''), hasCode('unknown_question'));
  assert.throws(() => registry.requireEntry('없는문항', 'research_assessment'), hasCode('unknown_question'));
});

test('단색 배경의 이전 T2는 검사 레지스트리에 없다 (수용시험 8)', () => {
  assert.equal(findBaseEntry('T2'), null);
  assert.ok(!ASSESSMENT_ORDER.includes('T2' as never));
  const registry = createRegistry(makeDeps());
  assert.throws(() => registry.requireEntry('T2', 'research_assessment'), hasCode('unknown_question'));
});

test('세션 성격이 맞지 않으면 not_allowed로 거부한다', () => {
  const registry = createRegistry(makeDeps());

  // 검사 문항은 연구 검사 세션에서만 쓴다.
  assert.throws(() => registry.requireEntry('T1', 'experience'), hasCode('not_allowed'));
  assert.throws(() => registry.requireEntry('T1', 'research_practice'), hasCode('not_allowed'));
  assert.equal(registry.requireEntry('T1', 'research_assessment').questionId, 'T1');

  // 연습 문항은 검사 세션에서 쓰지 않는다.
  assert.throws(() => registry.requireEntry('L01', 'research_assessment'), hasCode('not_allowed'));
  assert.equal(registry.requireEntry('L01', 'experience').questionId, 'L01');
  assert.equal(registry.requireEntry('L01', 'research_practice').questionId, 'L01');
});

/* ────────────────────────── 검사 문항 명세 ────────────────────────── */

test('검사 순서는 T1 → T2_v7 → T3 이다', () => {
  const registry = createRegistry(makeDeps());
  assert.deepEqual(registry.assessmentOrder(), ['T1', 'T2_v7', 'T3']);
});

test('검사 문항의 밴드와 제한시간은 420 / 480 / 600초이다', () => {
  const expected = [
    { questionId: 'T1', band: 'A', durationSeconds: 420 },
    { questionId: 'T2_v7', band: 'B', durationSeconds: 480 },
    { questionId: 'T3', band: 'C', durationSeconds: 600 },
  ];
  for (const want of expected) {
    const entry = findBaseEntry(want.questionId);
    assert.ok(entry, `${want.questionId}이 등록되어 있어야 한다`);
    assert.equal(entry.band, want.band);
    assert.equal(entry.durationSeconds, want.durationSeconds);
    assert.equal(entry.kind, 'assessment');
    assert.deepEqual(entry.allowedSessionTypes, ['research_assessment']);
  }
  // 세 문항 합계 420+480+600 = 1500초 = 25분
  const total = expected.reduce((s, e) => s + e.durationSeconds, 0);
  assert.equal(total, 1500);
});

test('검사 문항은 명세 그대로 candidate·approvedAt null 상태로 둔다', () => {
  for (const id of ASSESSMENT_ORDER) {
    const entry = findBaseEntry(id);
    assert.ok(entry);
    assert.equal(entry.status, 'candidate');
    assert.equal(entry.approvedAt, null);
    assert.equal(entry.cueVersion, 'v7-candidate');
    assert.equal(entry.rubricVersion, 'v7-candidate');
    assert.match(entry.imageSha256, /^[0-9a-f]{64}$/);
  }
});

/* ────────────────────────── 연습 문항 ────────────────────────── */

test('연습 문항 36개가 L01~L36으로 등록되고 차시·밴드가 이어진다', () => {
  // 게임·시간 제한 모드의 체험 문항도 kind는 practice이므로 L 접두로 구분한다.
  const practice = baseEntries().filter(
    (e) => e.kind === 'practice' && /^L\d{2}$/.test(e.questionId),
  );
  assert.equal(practice.length, 36);

  for (let level = 1; level <= 36; level += 1) {
    const entry = findBaseEntry(practiceQuestionId(level));
    assert.ok(entry, `L${level}이 등록되어 있어야 한다`);
    assert.equal(entry.lesson, Math.ceil(level / 6));
    assert.equal(entry.durationSeconds, null);
    assert.deepEqual(entry.allowedSessionTypes, ['experience', 'research_practice']);
    const wantBand: Band = level <= 12 ? 'A' : level <= 24 ? 'B' : 'C';
    assert.equal(entry.band, wantBand);
  }
});

/* ────────────────────────── 단서 ────────────────────────── */

test('단서 팩이 없으면 채점용 단서를 주지 않는다 (cues_missing)', () => {
  const registry = createRegistry(makeDeps());
  for (const id of [...ASSESSMENT_ORDER, 'L01']) {
    assert.throws(() => registry.getCues(id), hasCode('cues_missing'));
  }
});

test('필수 항목이 빈 단서는 채점에 통과시키지 않는다', () => {
  const emptyShell = {
    coreObjects: [],
    requiredAttributes: [],
    requiredContext: [],
    acceptedExpressions: [],
    notRequired: [],
    contradictions: [],
    anchors: {},
  };
  const pack = packWith({ T1: emptyShell, T2_v7: emptyShell, T3: emptyShell });
  const registry = createRegistry(makeDeps({ cuePack: () => pack }));

  for (const id of ASSESSMENT_ORDER) {
    assert.throws(() => registry.getCues(id), hasCode('cues_missing'));
    assert.equal(registry.getEntry(id).cuesLoaded, false);
  }
  assert.deepEqual(Object.keys(pack.invalid).sort(), ['T1', 'T2_v7', 'T3']);
});

test('단서가 채워진 문항만 cuesLoaded=true가 되고 나머지는 거부된다', () => {
  const pack = packWith({ T1: filledCues('A'), L01: filledCues('A') });
  const registry = createRegistry(makeDeps({ cuePack: () => pack }));

  assert.equal(registry.getEntry('T1').cuesLoaded, true);
  assert.deepEqual(registry.getCues('T1').coreObjects, ['대상1']);
  assert.equal(registry.getEntry('L01').cuesLoaded, true);

  // 팩에 없는 연습 문항은 cuesLoaded=false이고 연구 채점에서는 단서를 주지 않는다.
  assert.equal(registry.getEntry('L02').cuesLoaded, false);
  assert.throws(() => registry.getCues('L02'), hasCode('cues_missing'));
  assert.throws(() => registry.getCues('T3'), hasCode('cues_missing'));
});

test('밴드에 맞지 않는 단서 형식을 거른다', () => {
  // A밴드에 맥락 필수 단서를 넣으면 실격
  const aWithContext = { ...filledCues('A'), requiredContext: ['교실'] };
  assert.ok('reason' in validateCues(aWithContext, 'A'));

  // B밴드에 맥락 단서·앵커가 없으면 실격
  assert.ok('reason' in validateCues(filledCues('A'), 'B'));

  // 앵커의 한 수준이라도 비면 실격
  const missingAnchor = filledCues('A');
  missingAnchor.anchors.specificity['4'] = '   ';
  assert.ok('reason' in validateCues(missingAnchor, 'A'));

  // 정상 형식은 통과
  assert.ok('cues' in validateCues(filledCues('C'), 'C'));
});

test('등록되지 않은 questionId가 단서 팩에 있으면 무시하고 사유만 남긴다', () => {
  const pack = packWith({ T2: filledCues('B'), T1: filledCues('A') });
  assert.equal(pack.questions.T2, undefined);
  assert.ok(pack.invalid.T2);
  assert.ok(pack.questions.T1);
});

test('연구 세션은 단서 없는 문항 채점을 거부하고 일반 체험은 null을 받는다', () => {
  const pack = packWith({ L01: filledCues('A') });
  const registry = createRegistry(makeDeps({ cuePack: () => pack }));

  // 단서가 적재된 문항은 어느 세션에서나 그대로 온다.
  assert.deepEqual(cuesForSession(registry, 'L01', 'experience')?.coreObjects, ['대상1']);
  assert.deepEqual(cuesForSession(registry, 'L01', 'research_practice')?.coreObjects, ['대상1']);

  // 단서가 없는 문항: 연구 세션은 거부, 일반 체험은 null(공통 루브릭만으로 판단)
  assert.throws(() => cuesForSession(registry, 'L02', 'research_practice'), hasCode('cues_missing'));
  assert.equal(cuesForSession(registry, 'L02', 'experience'), null);

  // 세션 성격이 어긋나면 단서를 보기 전에 거부한다.
  assert.throws(() => cuesForSession(registry, 'T1', 'research_practice'), hasCode('not_allowed'));
  assert.throws(() => cuesForSession(registry, 'T1', 'research_assessment'), hasCode('cues_missing'));
});

/* ────────────────────────── readiness ────────────────────────── */

test('검사 문항이 candidate이면 researchReady는 false다', () => {
  const pack = packWith({
    T1: filledCues('A'),
    T2_v7: filledCues('B'),
    T3: filledCues('C'),
  });
  const registry = createRegistry(makeDeps({ cuePack: () => pack }));
  const readiness = registry.readiness();

  assert.equal(readiness.researchReady, false);
  assert.ok(readiness.blockers.some((b) => b.includes('candidate')));
  assert.ok(readiness.blockers.some((b) => b.includes('approvedAt')));
});

test('미확정 운영값과 자산 누락이 각각 사유로 남는다', () => {
  const base: ReadinessInput = {
    researchAssetDir: '',
    consentVersion: '',
    irbApproval: '',
    modelAccessVerified: false,
    cuePackLoaded: false,
    assessmentCuesMissing: ['T1', 'T2_v7', 'T3'],
    assessmentImagesMissing: ['T1'],
    assessmentImageHashMismatch: ['T3'],
  };
  const blockers = collectBlockers(base);

  for (const needle of [
    'RESEARCH_ASSET_DIR',
    'CONSENT_VERSION',
    'IRB_APPROVAL',
    'EVALUATION_MODEL_VERIFIED',
    'cue-pack.json',
    '단서가 비어',
    '찾지 못했습니다',
    'SHA-256',
    'candidate',
  ]) {
    assert.ok(
      blockers.some((b) => b.includes(needle)),
      `사유에 '${needle}'가 들어 있어야 한다: ${blockers.join(' | ')}`,
    );
  }
});

test('이미지 해시가 명세와 다르면 연구 시작을 막는다', () => {
  const pack = packWith({ T1: filledCues('A'), T2_v7: filledCues('B'), T3: filledCues('C') });
  const registry = createRegistry(
    makeDeps({
      cuePack: () => pack,
      assessmentImageStatus: () => ({ missing: [], mismatch: ['T2_v7'] }),
    }),
  );
  const readiness = registry.readiness();
  assert.equal(readiness.researchReady, false);
  assert.ok(readiness.blockers.some((b) => b.includes('SHA-256') && b.includes('T2_v7')));
});

/* ────────────────────────── 공개 view ────────────────────────── */

test('학생에게 내려보내는 view에 단서·앵커·해시가 없다 (수용시험 12)', () => {
  const pack = packWith({ T1: filledCues('A') });
  const registry = createRegistry(makeDeps({ cuePack: () => pack }));

  const assessment = registry.toPublicView(registry.getEntry('T1'));
  assert.deepEqual(Object.keys(assessment).sort(), [
    'durationSeconds',
    'imageUrl',
    'instruction',
    'kind',
    'lesson',
    'questionId',
  ]);
  // 검사 이미지는 public 경로가 아니라 인증 스트리밍 경로로만 준다.
  assert.equal(assessment.imageUrl, '/api/research/asset/T1');
  assert.equal(assessment.durationSeconds, 420);
  assert.equal(assessment.instruction, ASSESSMENT_INSTRUCTION);

  const serialized = JSON.stringify(assessment);
  assert.ok(!serialized.includes('대상1'));
  assert.ok(!serialized.includes('속성1'));
  assert.ok(!serialized.includes('f4734f7d'));
  // 세 검사 문항이 같은 일반 안내를 쓴다. 문항별 제목·단서를 안내에 담지 않는다.
  for (const id of ASSESSMENT_ORDER) {
    assert.equal(registry.toPublicView(registry.getEntry(id)).instruction, ASSESSMENT_INSTRUCTION);
  }

  const practice = registry.toPublicView(registry.getEntry('L01'));
  assert.equal(practice.imageUrl, '/questions/L01.jpg');
  assert.equal(practice.durationSeconds, null);
  assert.equal(practice.lesson, 1);
  assert.ok(practice.instruction.length > 0);
});

test('이미지 바이트를 열지 못하면 asset_missing으로 거부한다', async () => {
  const registry = createRegistry(makeDeps());
  await assert.rejects(() => registry.loadImage('T1'), hasCode('asset_missing'));
  await assert.rejects(() => registry.loadImage('없는문항'), hasCode('unknown_question'));
});

test('게임·시간 제한 모드 문항은 일반 체험에서만 쓰이고 연구 세션에서는 거부된다', () => {
  const registry = createRegistry(makeDeps());
  for (const id of ['game-01', 'game-04', 'ta-01', 'ta-08']) {
    const entry = findBaseEntry(id);
    assert.ok(entry, `${id}가 등록되어 있어야 한다`);
    assert.deepEqual(entry.allowedSessionTypes, ['experience']);
    assert.equal(entry.lesson, null);
    assert.equal(entry.durationSeconds, null);
    // 연구 세션에서는 레지스트리 단계에서 막힌다.
    assert.throws(() => registry.requireEntry(id, 'research_practice'), /쓸 수 없는 문항/);
    assert.throws(() => registry.requireEntry(id, 'research_assessment'), /쓸 수 없는 문항/);
  }
});
