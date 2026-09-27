/**
 * 운영 채점 1회 테스트(공통 루브릭 v12-2) — src/server/grading/operational.ts
 *
 * 모델 호출은 모두 가짜 함수로 주입한다. 실제 모델을 호출하는 테스트는 만들지 않는다.
 * 이 파일의 통과는 절차가 규칙대로 도는지에 대한 확인이며, 모델의 채점 정확도나
 * 채점자 간 신뢰도에 대한 증거가 아니다.
 *
 * 절차: 모델 1회. 호출 실패·형식 오류일 때만 1회 다시 부른다. 유리한 출력을 고르려 다시 부르지 않고
 * 결합하지 않는다. 판정이 확정되면 피드백만 1회 다시 만들 수 있고 판정은 바뀌지 않는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGrading,
  resolveModelConfig,
  type CallModel,
  type GradingDeps,
  type ModelCallInput,
  type ModelCallOutput,
} from '@/server/grading/operational';
import { privacy as realPrivacy } from '@/server/privacy';
import { NOT_APPLICABLE, type AreaId } from '@/lib/scoring';
import { FEEDBACK_FALLBACK_TEXT } from '@/lib/feedback';
import type { ScoringRun } from '@/lib/research/types';
import type { GradingRequest } from '@/server/grading/contract';
import type { QuestionCues, RegistryEntry } from '@/server/registry/contract';

const NA = NOT_APPLICABLE;

/* ───────────────────────── 가짜 의존 ───────────────────────── */

function practiceEntry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    questionId: 'L13',
    kind: 'practice',
    band: 'B',
    lesson: 4,
    imageVersion: 'v7',
    imageSha256: '',
    cueVersion: 'v12-test-pack',
    rubricVersion: 'v12-2',
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['experience', 'research_practice'],
    durationSeconds: null,
    cuesLoaded: true,
    ...over,
  };
}

/**
 * 테스트 전용 합성 단서. 실제 문항의 비공개 단서가 아니다.
 * 모델은 missing에 단서 팩 항목을 문구 그대로 옮긴다(지시문). 아래 출력의 missing('장화의 색'·'걷는 중')이
 * 단서 팩 항목과 같아야 3문장 nextTarget이 확인된다.
 */
const CUES: QuestionCues = {
  coreObjects: ['합성-아이 1명', '합성-우산 1개'],
  requiredAttributes: ['합성-노란 우산', '장화의 색'],
  requiredContext: ['합성-공원', '걷는 중'],
  acceptedExpressions: [],
  notRequired: [],
  contradictions: [],
  anchors: {
    object: { '4': 'o4', '3': 'o3', '2': 'o2', '1': 'o1' },
    specificity: { '4': 's4', '3': 's3', '2': 's2', '1': 's1' },
    context: { '4': 'c4', '3': 'c3', '2': 'c2', '1': 'c1' },
  },
};

const CUES_NO_RELATION: QuestionCues = {
  ...CUES,
  requiredContext: [],
  anchors: { object: CUES.anchors.object, specificity: CUES.anchors.specificity },
};

const STUDENT = '노란 우산을 쓴 아이가 공원에서 걷고 있다';

type Step = () => ModelCallOutput | Promise<ModelCallOutput>;

interface Harness {
  deps: GradingDeps;
  inputs: ModelCallInput[];
  counters: { getCues: number; loadImage: number; checkBeforeSend: number };
}

function harness(options: {
  script: Step[];
  entry?: RegistryEntry;
  cues?: QuestionCues;
  cuesMissing?: boolean;
  registryError?: string;
  hold?: boolean;
  assertNoSecrets?: (payload: unknown) => void;
}): Harness {
  const inputs: ModelCallInput[] = [];
  const counters = { getCues: 0, loadImage: 0, checkBeforeSend: 0 };
  let index = 0;
  const callModel: CallModel = async (input) => {
    inputs.push(input);
    const step = options.script[index++];
    if (!step) throw new Error(`예상보다 많은 모델 호출(${index}번째)`);
    return step();
  };
  let clock = 0;
  const deps: GradingDeps = {
    callModel,
    registry: {
      requireEntry: () => options.entry ?? practiceEntry(),
      getCues: () => {
        counters.getCues++;
        if (options.registryError) {
          const e = new Error('다른 레지스트리 오류') as Error & { code: string };
          e.code = options.registryError;
          throw e;
        }
        if (options.cuesMissing) {
          const e = new Error('문항 단서를 쓸 수 없습니다') as Error & { code: string };
          e.name = 'RegistryError';
          e.code = 'cues_missing';
          throw e;
        }
        return options.cues ?? CUES;
      },
      loadImage: async () => {
        counters.loadImage++;
        return { bytes: Buffer.from('fake-image-bytes'), contentType: 'image/jpeg', sha256: 'abc123imagehash' };
      },
    },
    privacy: {
      checkBeforeSend: () => {
        counters.checkBeforeSend++;
        return {
          decision: options.hold ? 'hold_for_teacher' : 'pass',
          matchedTypes: options.hold ? ['phone_number'] : [],
          checkVersion: 'test',
          notice: '점검은 보조 수단이다.',
        };
      },
      assertNoSecrets: options.assertNoSecrets ?? (() => undefined),
    },
    modelId: 'googleai/configured-model',
    modelConfig: { temperature: 0.2 },
    codeCommit: 'testcommit',
    now: () => new Date(1700000000000 + clock++ * 1000),
  };
  return { deps, inputs, counters };
}

function request(over: Partial<GradingRequest> = {}): GradingRequest {
  return {
    questionId: 'L13',
    studentText: STUDENT,
    operationId: 'op-1',
    repeatIndex: 1,
    sessionType: 'research_practice',
    wantFeedback: false,
    ...over,
  };
}

const area = (level: unknown, evidence: string | null, missing: string[] = []) => ({
  level,
  evidence,
  missing,
  evidence_missing: [],
});

/** 형식이 맞는 출력(대상 3, 특징 2, 관계 4). */
function validOutput(over: Record<string, unknown> = {}) {
  return {
    object: area(3, '노란 우산을 쓴 아이', ['우산의 개수']),
    feature: area(2, '노란 우산', ['장화의 색']),
    relation: area(4, '공원에서 걷고 있다'),
    ...over,
  };
}

/** 대상 3 · 특징 2 · 관계 4에 맞는 네 문장 초안. 다음 행동은 특징(가장 낮은 영역). */
const GOOD_FEEDBACK = {
  feedbackLine1: '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 것이 이번 목표예요.',
  feedbackLine2: '관계 영역에서 공원에서 걷고 있다라고 어디에서 무엇을 하는지 썼어요.',
  // 빠진 값(장화)을 말하지 않고 무엇을 다시 볼지만 안내한다(99-1 A1 — 학생 글에 없는 단서 값은 누설).
  feedbackLine3: '아이의 신발을 그림에서 다시 살펴보세요.',
  feedbackLine4: '신발이 어떤 색인지 그림을 다시 볼까요?',
  quote: '공원에서 걷고 있다',
  strengthArea: 'relation',
  nextArea: 'feature',
  nextTarget: '장화의 색',
};

const ok =
  (output: unknown, servedModel: string | null = 'gemini-served-001'): Step =>
  () => ({ output, servedModel });
const fail =
  (name = 'NetworkError'): Step =>
  () => {
    const e = new Error('모델 호출 실패');
    e.name = name;
    throw e;
  };

async function run(h: Harness, req: Partial<GradingRequest> = {}): Promise<ScoringRun> {
  return createGrading(h.deps).runOperationalScoring(request(req));
}

function scored(r: ScoringRun) {
  assert.equal(r.result.status, 'scored', JSON.stringify(r.result));
  if (r.result.status !== 'scored') throw new Error('unreachable');
  return r.result;
}

/* ───────────────────────── 모델 1회 ───────────────────────── */

test('형식이 맞으면 모델을 정확히 1회만 부르고 영역별 판정을 그대로 남긴다', async () => {
  const h = harness({ script: [ok(validOutput())] });
  const r = await run(h);
  assert.equal(h.inputs.length, 1);
  const res = scored(r);
  assert.deepEqual(res.areas, {
    object: { level: 3, evidence: '노란 우산을 쓴 아이', missing: ['우산의 개수'], evidenceMissing: [] },
    feature: { level: 2, evidence: '노란 우산', missing: ['장화의 색'], evidenceMissing: [] },
    relation: { level: 4, evidence: '공원에서 걷고 있다', missing: [], evidenceMissing: [] },
  });
  assert.equal(res.feedbackStatus, 'not_requested');
  // 100점 환산·축 점수를 담지 않는다.
  assert.ok(!('score' in res));
  assert.ok(!('axisScores' in res));
  assert.ok(!('levels' in res));
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].purpose, 'score');
  assert.equal(r.calls[0].retryIndex, 0);
  assert.equal(r.calls[0].callId, 'op-1:c1');
  assert.deepEqual(r.calls[0].levels, { object: 3, feature: 2, relation: 4 });
  assert.equal(r.calls[0].failureReason, null);
  assert.equal(r.extraCall, false);
});

test('유효한 결과가 낮은 수준이어도 "개선"하려고 다시 부르지 않는다', async () => {
  const low = validOutput({
    object: area(1, null, ['아이', '우산']),
    feature: area(1, null, ['노란 우산']),
    relation: area(1, null, ['공원']),
  });
  const h = harness({ script: [ok(low), ok(validOutput())] });
  const r = await run(h);
  assert.equal(h.inputs.length, 1, '두 번째 호출이 없어야 한다');
  const res = scored(r);
  assert.equal(res.areas.object.level, 1);
  assert.equal(res.areas.feature.level, 1);
  assert.equal(res.areas.relation.level, 1);
});

test('실행 기록 — 설정 모델, 실제 응답 모델, 루브릭 v12-2, 단서 버전, 해시, 코드 커밋을 남긴다', async () => {
  const h = harness({ script: [ok(validOutput(), 'gemini-served-xyz')] });
  const r = await run(h);
  assert.equal(r.modelId, 'googleai/configured-model');
  assert.equal(r.servedModel, 'gemini-served-xyz');
  assert.equal(r.calls[0].servedModel, 'gemini-served-xyz');
  assert.equal(r.rubricVersion, 'v12-2');
  assert.equal(r.cueVersion, 'v12-test-pack');
  assert.equal(r.applicabilitySource, 'cue_pack');
  assert.equal(r.imageHash, 'abc123imagehash');
  assert.match(r.promptHash, /^[0-9a-f]{64}$/);
  assert.equal(r.codeCommit, 'testcommit');
  assert.deepEqual(r.modelConfig, { temperature: 0.2 });
  assert.equal(r.band, 'B');
  assert.equal(r.operationId, 'op-1');
  assert.ok(!Number.isNaN(Date.parse(r.scoredAt)));
});

test('모델 API가 실제 모델을 밝히지 않으면 servedModel은 null이다(지어내지 않는다)', async () => {
  const h = harness({ script: [ok(validOutput(), null)] });
  const r = await run(h);
  assert.equal(r.servedModel, null);
  assert.equal(r.calls[0].servedModel, null);
  assert.equal(r.modelId, 'googleai/configured-model');
});

test('모델 입력 — 같은 고정 지시문·이미지, 신원 ID 없음, purpose=score', async () => {
  const h = harness({ script: [ok(validOutput())] });
  await run(h, { operationId: 'op-secret-777' });
  const input = h.inputs[0];
  assert.equal(input.purpose, 'score');
  assert.equal(input.modelId, 'googleai/configured-model');
  assert.deepEqual(input.modelConfig, { temperature: 0.2 });
  assert.ok(input.image);
  assert.equal(input.image?.contentType, 'image/jpeg');
  assert.ok(input.image?.dataUri.startsWith('data:image/jpeg;base64,'));
  assert.ok(input.prompt.includes(STUDENT));
  assert.ok(input.prompt.includes('[공통 루브릭 v12-2]'));
  assert.ok(input.prompt.includes('합성-노란 우산'), '연구 세션은 단서 팩을 넣는다');
  assert.ok(!input.prompt.includes('op-secret-777'), '운영 ID를 지시문에 넣지 않는다');
});

/* ───────────────────────── 재시도 ───────────────────────── */

test('호출 실패(model_error)는 1회만 다시 부르고, 성공하면 그 판정을 쓴다', async () => {
  const h = harness({ script: [fail('TimeoutError'), ok(validOutput(), 'served-2')] });
  const r = await run(h);
  assert.equal(h.inputs.length, 2);
  assert.equal(h.inputs[0].prompt, h.inputs[1].prompt, '같은 고정 입력으로 다시 부른다');
  const res = scored(r);
  assert.equal(res.areas.feature.level, 2);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(
    r.calls.map((c) => c.retryIndex),
    [0, 1]
  );
  assert.equal(r.calls[0].levels, null);
  assert.equal(r.calls[0].servedModel, null);
  assert.match(r.calls[0].failureReason ?? '', /^model_error: TimeoutError/);
  assert.equal(r.calls[1].failureReason, null);
  assert.equal(r.servedModel, 'served-2');
});

test('형식 오류(schema_error)는 1회만 다시 부르고, 성공하면 두 번째 판정만 쓴다(결합하지 않는다)', async () => {
  const bad = validOutput({ object: area(5, null) });
  const second = validOutput({ object: area(2, '아이', ['우산의 개수']) });
  const h = harness({ script: [ok(bad, 'served-1'), ok(second, 'served-2')] });
  const r = await run(h);
  assert.equal(h.inputs.length, 2);
  const res = scored(r);
  assert.equal(res.areas.object.level, 2, '두 번째 판정 그대로(평균·중앙값 없음)');
  assert.match(r.calls[0].failureReason ?? '', /^schema_error: /);
  assert.equal(r.calls[0].servedModel, 'served-1', '형식 오류 호출도 실제 모델을 남긴다');
  assert.equal(r.calls[0].levels, null);
  assert.equal(r.servedModel, 'served-2', '점수를 낸 호출의 실제 모델');
});

test('두 번 모두 형식 오류면 schema_error 결측이다. 세 번째 호출·일부 결과·보정이 없다', async () => {
  for (const bad of [
    validOutput({ object: area(5, null) }),
    validOutput({ feature: area(2.5, null) }),
    validOutput({ relation: area('3', null) }),
    validOutput({ object: area(0, null) }),
    validOutput({ feature: area(NaN, null) }),
    validOutput({ relation: area(null, null) }),
    validOutput({ object: area(NA, null) }),
    { object: area(3, null, []) }, // 일부 영역만 있는 출력
    'not json',
  ]) {
    const h = harness({ script: [ok(bad), ok(bad), ok(validOutput())] });
    const r = await run(h);
    assert.equal(h.inputs.length, 2, JSON.stringify(bad));
    assert.deepEqual(r.result, { status: 'missing', areas: null, reason: 'schema_error' });
    assert.equal(r.servedModel, null);
    assert.equal(r.calls.length, 2);
    assert.ok(r.calls.every((c) => c.levels === null));
    assert.equal(r.feedback, null);
  }
});

test('두 번 모두 호출 실패면 model_error 결측이고 최저 수준으로 채우지 않는다', async () => {
  const h = harness({ script: [fail(), fail(), ok(validOutput())] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 2);
  assert.deepEqual(r.result, { status: 'missing', areas: null, reason: 'model_error' });
  assert.equal(r.feedback, null);
  assert.equal(r.servedModel, null);
});

test('결측 사유는 마지막 실패의 유형을 따른다', async () => {
  const a = harness({ script: [fail(), ok(validOutput({ object: area(9, null) }))] });
  assert.deepEqual((await run(a)).result, { status: 'missing', areas: null, reason: 'schema_error' });
  const b = harness({ script: [ok(validOutput({ object: area(9, null) })), fail()] });
  assert.deepEqual((await run(b)).result, { status: 'missing', areas: null, reason: 'model_error' });
});

test('원문에 없는 근거(evidence)는 형식 오류로 보고 다시 부른다', async () => {
  const fabricated = validOutput({ feature: area(3, '빨간 장화', []) });
  const h = harness({ script: [ok(fabricated), ok(validOutput())] });
  const r = await run(h);
  assert.equal(h.inputs.length, 2);
  assert.match(r.calls[0].failureReason ?? '', /feature\.evidence/);
  scored(r);
});

/* ───────────────────────── 판정 여부(단서 팩) ───────────────────────── */

test('단서 팩이 관계를 요구하지 않으면 관계는 not_applicable이어야 한다 — 어기면 형식 오류', async () => {
  const withRelation = validOutput();
  const naRelation = validOutput({ relation: area(NA, null) });
  const h = harness({ cues: CUES_NO_RELATION, script: [ok(withRelation), ok(naRelation)] });
  const r = await run(h);
  assert.equal(h.inputs.length, 2);
  assert.match(r.calls[0].failureReason ?? '', /relation\.level\(해당 없음이어야 하는 영역\)/);
  const res = scored(r);
  assert.equal(res.areas.relation.level, NA);
  assert.equal(r.applicabilitySource, 'cue_pack');
  assert.ok(h.inputs[0].prompt.includes(`관계(relation): 이 과제는 요구하지 않는다. level을 "${NA}"로 둔다`));
});

test('단서 팩이 요구하는 영역을 not_applicable로 내면 형식 오류다', async () => {
  const h = harness({ script: [ok(validOutput({ feature: area(NA, null) })), ok(validOutput({ feature: area(NA, null) }))] });
  const r = await run(h);
  assert.deepEqual(r.result, { status: 'missing', areas: null, reason: 'schema_error' });
});

/* ───────────────────────── 일반 체험(단서 없음) ───────────────────────── */

test('일반 체험에서 단서가 적재되지 않았으면 공통 문언만으로 판정하고 판정 여부는 모델이 정한다', async () => {
  const h = harness({
    entry: practiceEntry({ questionId: 'L01', band: 'A', lesson: 1, cuesLoaded: false }),
    script: [ok(validOutput({ relation: area(NA, null) }))],
  });
  const r = await run(h, { questionId: 'L01', sessionType: 'experience' });
  assert.equal(h.counters.getCues, 0, '단서를 조회하지 않는다');
  assert.ok(h.inputs[0].prompt.includes('공통 문언만으로 판정하고'));
  assert.ok(!h.inputs[0].prompt.includes('이 상태에서는 채점하지 않는다'));
  assert.ok(h.inputs[0].prompt.includes('요구하면 1~4로 판정하고'));
  // L01은 코드의 기본 목록이 관계를 해당 없음으로 정한다(단서 팩이 없을 때). 특징은 모델이 정한다.
  assert.ok(h.inputs[0].prompt.includes('관계(relation): 이 과제는 요구하지 않는다'));
  assert.equal(r.applicabilitySource, 'code_default');
  const res = scored(r);
  assert.equal(res.areas.relation.level, NA);

  // 기본 목록에 없는 문항은 모델이 정한다.
  const h2 = harness({
    entry: practiceEntry({ questionId: 'L07', band: 'A', lesson: 2, cuesLoaded: false }),
    script: [ok(validOutput({ relation: area(NA, null) }))],
  });
  const r2 = await run(h2, { questionId: 'L07', sessionType: 'experience' });
  assert.equal(r2.applicabilitySource, 'model');
});

test('일반 체험이라도 단서가 적재되어 있으면 단서 팩으로 판정한다', async () => {
  const h = harness({ script: [ok(validOutput())] });
  const r = await run(h, { sessionType: 'experience' });
  assert.equal(h.counters.getCues, 1);
  assert.equal(r.applicabilitySource, 'cue_pack');
  assert.ok(h.inputs[0].prompt.includes('합성-공원'));
});

/* ───────────────────────── 전송 전에 멈추는 경우 ───────────────────────── */

test('연구 세션에서 단서가 없으면(cues_missing) 모델을 부르지 않고 결측으로 마감한다', async () => {
  const h = harness({ cuesMissing: true, script: [ok(validOutput())] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 0, '모델을 부르지 않는다');
  assert.equal(h.counters.loadImage, 0, '이미지를 열지 않는다');
  assert.deepEqual(r.result, { status: 'missing', areas: null, reason: 'required_call_failed' });
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0].failureReason ?? '', /^cues_missing/);
  assert.equal(r.calls[0].levels, null);
  assert.equal(r.promptHash, '', '보내지 않은 지시문의 해시를 남기지 않는다');
  assert.equal(r.imageHash, '', '읽지 않은 이미지의 해시를 지어내지 않는다');
  assert.equal(r.servedModel, null);
  assert.equal(r.feedback, null);
});

test('단서 없음이 아닌 레지스트리 오류는 그대로 올린다', async () => {
  const h = harness({ registryError: 'asset_missing', script: [ok(validOutput())] });
  await assert.rejects(() => run(h), /다른 레지스트리 오류/);
  assert.equal(h.inputs.length, 0);
});

test('개인정보 점검이 hold_for_teacher이면 모델을 부르지 않고 결측으로 남긴다', async () => {
  const h = harness({ hold: true, script: [ok(validOutput())] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.counters.checkBeforeSend, 1);
  assert.equal(h.inputs.length, 0);
  assert.equal(h.counters.loadImage, 0);
  assert.deepEqual(r.result, { status: 'missing', areas: null, reason: 'required_call_failed' });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].failureReason, 'privacy_hold_for_teacher: phone_number');
  assert.equal(r.imageHash, '');
  assert.equal(r.feedback, null);
});

test('호출 기록에 학생 원문을 남기지 않는다', async () => {
  const text = '노란 우산을 쓴 아이가 공원에서 걷고 있다 비밀문장칠칠칠';
  const h = harness({ script: [ok(validOutput({ object: area(3, '비밀문장칠칠칠 아님') })), fail()] });
  const r = await run(h, { studentText: text });
  assert.ok(!JSON.stringify(r.calls).includes('비밀문장칠칠칠'));
  assert.ok(!JSON.stringify(r.calls).includes('노란 우산'));
});

/* ───────────────────────── 단계 초점 영역 ───────────────────────── */

test('초점 영역은 연습 문항의 단계(entry.lesson)로 정한다 — 2 대상, 3 특징, 4 관계, 1·5·6 없음', async () => {
  const cases: Array<[number, AreaId | null]> = [
    [1, null],
    [2, 'object'],
    [3, 'feature'],
    [4, 'relation'],
    [5, null],
    [6, null],
  ];
  for (const [lesson, want] of cases) {
    const h = harness({ entry: practiceEntry({ lesson }), script: [ok(validOutput())] });
    const r = await run(h);
    assert.equal(r.focusArea, want, `단계 ${lesson}`);
    if (want === 'relation') assert.ok(h.inputs[0].prompt.includes('이번 단계의 초점은 관계 영역'));
    if (want === null) assert.ok(h.inputs[0].prompt.includes('세 영역(대상·특징·관계)을 모두 다룬다'));
  }
});

test('검사 문항과 단계가 없는 문항은 초점 영역이 없다', async () => {
  const assessment = harness({
    entry: practiceEntry({ questionId: 'T2_v7', kind: 'assessment', lesson: 3, allowedSessionTypes: ['research_assessment'] }),
    script: [ok(validOutput())],
  });
  const r = await run(assessment, { questionId: 'T2_v7', sessionType: 'research_assessment' });
  assert.equal(r.focusArea, null, '연습 문항만 단계 초점을 쓴다');

  const game = harness({ entry: practiceEntry({ questionId: 'game-01', lesson: null, cuesLoaded: false }), script: [ok(validOutput())] });
  const g = await run(game, { questionId: 'game-01', sessionType: 'experience' });
  assert.equal(g.focusArea, null);
});

/* ───────────────────────── 반복 채점 ───────────────────────── */

test('repeatIndex와 operationId는 요청 값을 그대로 남긴다(반복 2·3은 주 자료를 덮어쓰지 않는다)', async () => {
  for (const repeatIndex of [1, 2, 3]) {
    const h = harness({ script: [ok(validOutput())] });
    const r = await run(h, { repeatIndex, operationId: `op-r${repeatIndex}` });
    assert.equal(r.repeatIndex, repeatIndex);
    assert.equal(r.operationId, `op-r${repeatIndex}`);
    assert.equal(r.calls[0].callId, `op-r${repeatIndex}:c1`);
    assert.equal(h.inputs.length, 1);
  }
});

/* ───────────────────────── 피드백 ───────────────────────── */

test('피드백을 요청하지 않으면 not_requested이고 호출은 1회다', async () => {
  const h = harness({ script: [ok({ ...validOutput(), ...GOOD_FEEDBACK })] });
  const r = await run(h, { wantFeedback: false });
  assert.equal(h.inputs.length, 1);
  assert.equal(r.feedback?.status, 'not_requested');
  assert.equal(r.feedback?.text, '');
  assert.equal(scored(r).feedbackStatus, 'not_requested');
});

test('첫 출력의 피드백이 통과하면 추가 호출 없이 영역 이름표가 붙은 네 문장을 쓴다', async () => {
  const h = harness({ script: [ok({ ...validOutput(), ...GOOD_FEEDBACK })] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 1);
  assert.equal(scored(r).feedbackStatus, 'verified');
  assert.equal(r.feedback?.status, 'verified');
  assert.equal(r.feedback?.regenerated, false);
  const lines = (r.feedback?.text ?? '').split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith('[관계] '));
  assert.ok(lines[2].startsWith('[특징] '));
  assert.equal(r.feedback?.quote, '공원에서 걷고 있다');
  assert.equal(r.feedback?.strengthArea, 'relation');
  assert.equal(r.feedback?.nextArea, 'feature');
  assert.equal(r.feedback?.nextTarget, '장화의 색');
});

test('다음 행동 영역은 코드가 정한다 — 가장 낮은 영역이 같으면 단계 초점 영역', async () => {
  // 대상 3 · 특징 2 · 관계 2, 4단계(관계 초점) → 관계
  const out = validOutput({ relation: area(2, '공원에서', ['걷는 중']) });
  const fb = {
    ...GOOD_FEEDBACK,
    feedbackLine2: '대상 영역에서 노란 우산을 쓴 아이라고 무엇이 있는지 썼어요.',
    quote: '노란 우산을 쓴 아이',
    strengthArea: 'object',
    feedbackLine3: '아이가 무엇을 하고 있는지도 써 보세요.',
    nextArea: 'relation',
    nextTarget: '걷는 중',
  };
  const h = harness({ entry: practiceEntry({ lesson: 4 }), script: [ok({ ...out, ...fb })] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(r.feedback?.status, 'verified', JSON.stringify(r.feedback));
  assert.equal(r.feedback?.nextArea, 'relation');

  // 같은 출력이라도 3단계(특징 초점)에서는 특징이어야 하므로 이 초안은 탈락한다.
  const h3 = harness({ entry: practiceEntry({ lesson: 3 }), script: [ok({ ...out, ...fb }), ok({ ...fb })] });
  const r3 = await run(h3, { wantFeedback: true });
  assert.equal(r3.feedback?.status, 'fallback');
  assert.deepEqual(r3.feedback?.rejections, ['next_area', 'next_area']);
});

test('피드백이 탈락하면 피드백만 1회 다시 만든다(purpose=feedback) — 판정은 바뀌지 않는다', async () => {
  const badFeedback = { ...GOOD_FEEDBACK, feedbackLine4: '신발을 볼까요? 다시 써 봐요.' };
  // 재생성 호출이 영역 판정을 섞어 보내도 무시한다.
  const regenerated = { ...GOOD_FEEDBACK, object: area(1, null, ['아이']) };
  const h = harness({ script: [ok({ ...validOutput(), ...badFeedback }, 'served-score'), ok(regenerated, 'served-fb')] });
  const r = await run(h, { wantFeedback: true });

  assert.equal(h.inputs.length, 2);
  assert.equal(h.inputs[1].purpose, 'feedback');
  assert.ok(h.inputs[1].prompt.includes('판정을 바꾸지 말고 피드백 네 문장만'));
  assert.ok(h.inputs[1].prompt.includes('- 특징(feature): 수준 2 / 빠진 정보: 장화의 색'));
  assert.ok(h.inputs[1].prompt.includes('nextArea는 "feature"다'));
  assert.ok(h.inputs[1].image, '같은 그림을 함께 보낸다');

  const res = scored(r);
  assert.equal(res.areas.object.level, 3, '판정은 첫 호출 그대로');
  assert.equal(res.areas.feature.level, 2);
  assert.equal(res.feedbackStatus, 'verified');
  assert.equal(r.feedback?.regenerated, true);
  assert.deepEqual(r.feedback?.rejections, ['sentence_count']);

  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[0].purpose, 'score');
  assert.equal(r.calls[1].purpose, 'feedback');
  assert.equal(r.calls[1].callId, 'op-1:f1');
  assert.equal(r.calls[1].levels, null, '피드백 호출은 수준을 남기지 않는다');
  assert.equal(r.calls[1].servedModel, 'served-fb');
  assert.equal(r.calls[1].failureReason, null);
  assert.equal(r.servedModel, 'served-score', '실행의 servedModel은 점수를 낸 호출의 것');
});

test('첫 출력에 피드백이 없으면 피드백 호출로 만든다', async () => {
  const h = harness({ script: [ok(validOutput()), ok(GOOD_FEEDBACK)] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 2);
  assert.equal(r.feedback?.status, 'verified');
  assert.deepEqual(r.feedback?.rejections, ['no_draft']);
});

test('단서 팩이 있으면 3문장이 겨냥한 정보가 단서 팩의 필수 정보여야 한다(모델이 지어낸 missing 차단)', async () => {
  // 모델이 missing에 단서 팩에 없는 정보를 넣고 3문장이 그것을 요구한다.
  const invented = validOutput({ feature: area(2, '노란 우산', ['장화의 색', '우산 손잡이의 무늬']) });
  const fbInvented = {
    ...GOOD_FEEDBACK,
    feedbackLine3: '우산 손잡이의 무늬도 써 보세요.',
    nextTarget: '우산 손잡이의 무늬',
  };
  const h = harness({ script: [ok({ ...invented, ...fbInvented }), ok(GOOD_FEEDBACK)] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 2);
  // 다시 만들 때는 단서 팩으로 확인되는 빠진 정보만 알려 준다. 판정은 그대로다.
  assert.ok(h.inputs[1].prompt.includes('- 특징(feature): 수준 2 / 빠진 정보: 장화의 색\n'), h.inputs[1].prompt);
  assert.equal(h.inputs[1].prompt.includes('우산 손잡이의 무늬'), false);
  assert.equal(r.feedback?.status, 'verified');
  assert.deepEqual(r.feedback?.rejections, ['next_target_unverified']);
  assert.equal(r.feedback?.nextTarget, '장화의 색');
  assert.deepEqual(scored(r).areas.feature.missing, ['장화의 색', '우산 손잡이의 무늬'], '판정 기록은 모델 출력 그대로');

  // 빠진 정보가 모두 단서 팩 밖이면 확인할 수 없으므로 고정 안내로 간다.
  const onlyInvented = validOutput({ feature: area(2, '노란 우산', ['우산 손잡이의 무늬']) });
  const h2 = harness({ script: [ok({ ...onlyInvented, ...fbInvented }), ok(fbInvented)] });
  const r2 = await run(h2, { wantFeedback: true });
  assert.equal(r2.feedback?.status, 'fallback');
  assert.deepEqual(r2.feedback?.rejections, ['next_target_unverified', 'next_target_unverified']);
});

test('단서 팩이 없는 일반 체험은 missing 목록 안인지만 본다(구조 점검)', async () => {
  const out = validOutput({ feature: area(2, '노란 우산', ['우산 손잡이의 무늬']) });
  const fb = { ...GOOD_FEEDBACK, feedbackLine3: '우산 손잡이의 무늬도 써 보세요.', nextTarget: '우산 손잡이의 무늬' };
  const h = harness({
    entry: practiceEntry({ cuesLoaded: false, allowedSessionTypes: ['experience'] }),
    script: [ok({ ...out, ...fb })],
  });
  const r = await run(h, { wantFeedback: true, sessionType: 'experience' });
  assert.equal(r.applicabilitySource, 'model');
  assert.equal(r.feedback?.status, 'verified', JSON.stringify(r.feedback));
  assert.equal(r.feedback?.nextTarget, '우산 손잡이의 무늬');
});

test('재생성도 탈락하면 고정 안내(fallback)이고 재채점하지 않는다', async () => {
  const bad = { ...GOOD_FEEDBACK, feedbackLine2: '관계 영역에서 공원에서 걷고 있다라고 훌륭하게 썼어요.' };
  const h = harness({ script: [ok({ ...validOutput(), ...bad }), ok(bad), ok(validOutput())] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 2, '채점 1 + 피드백 1, 그 밖의 호출 없음');
  assert.deepEqual(
    h.inputs.map((i) => i.purpose),
    ['score', 'feedback']
  );
  const res = scored(r);
  assert.equal(res.feedbackStatus, 'fallback');
  assert.deepEqual(
    [res.areas.object.level, res.areas.feature.level, res.areas.relation.level],
    [3, 2, 4]
  );
  assert.equal(r.feedback?.status, 'fallback');
  assert.equal(r.feedback?.text, FEEDBACK_FALLBACK_TEXT);
  assert.deepEqual(r.feedback?.rejections, ['forbidden_expression', 'forbidden_expression']);
});

test('피드백 호출이 실패해도 판정은 그대로이고 호출 기록에 실패가 남는다', async () => {
  const h = harness({ script: [ok(validOutput()), fail('QuotaError')] });
  const r = await run(h, { wantFeedback: true });
  const res = scored(r);
  assert.equal(res.feedbackStatus, 'fallback');
  assert.equal(res.areas.feature.level, 2);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[1].purpose, 'feedback');
  assert.match(r.calls[1].failureReason ?? '', /^model_error: QuotaError/);
  assert.equal(r.calls[1].servedModel, null);
  assert.deepEqual(r.feedback?.rejections, ['no_draft', 'no_draft']);
});

test('피드백 호출의 출력이 형식에 맞지 않으면 schema_error로 기록한다', async () => {
  const h = harness({ script: [ok(validOutput()), ok({ nothing: true }, 'served-fb')] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(r.calls[1].failureReason, 'schema_error: 피드백 형식 오류');
  assert.equal(r.calls[1].servedModel, 'served-fb');
  assert.equal(r.feedback?.status, 'fallback');
});

test('피드백 문구에 자격정보가 섞이면 판정은 그대로 두고 문구만 고정 안내로 바꾼다', async () => {
  const leaked = 'AIzaSyA1234567890abcdefghijklmnopqrstuvw';
  const fb = { ...GOOD_FEEDBACK, feedbackLine4: `신발 색을 확인해 볼까요 ${leaked}` };
  const h = harness({ script: [ok({ ...validOutput(), ...fb })], assertNoSecrets: realPrivacy.assertNoSecrets });
  const r = await run(h, { wantFeedback: true });
  const res = scored(r);
  assert.equal(res.feedbackStatus, 'fallback');
  assert.equal(res.areas.feature.level, 2);
  assert.equal(r.feedback?.text, FEEDBACK_FALLBACK_TEXT);
  assert.equal(r.feedback?.nextArea, null);
  assert.ok(!JSON.stringify(r).includes(leaked), '기록 어디에도 자격정보가 남지 않는다');
});

test('검사 채점(피드백 없음)도 같은 1회 절차를 쓴다', async () => {
  const h = harness({
    entry: practiceEntry({ questionId: 'T3', kind: 'assessment', band: 'C', lesson: null, allowedSessionTypes: ['research_assessment'] }),
    script: [ok(validOutput())],
  });
  const r = await run(h, { questionId: 'T3', sessionType: 'research_assessment', wantFeedback: false });
  assert.equal(h.inputs.length, 1);
  assert.equal(r.band, 'C');
  assert.equal(r.feedback?.status, 'not_requested');
  assert.equal(r.rubricVersion, 'v12-2');
});

/* ───────────────────────── 설정 ───────────────────────── */

test('온도 설정이 쓸 수 없는 값이면 기본값 0.2로 되돌린다', () => {
  assert.equal(resolveModelConfig({ temperature: 0.2 }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: 0 }).temperature, 0);
  assert.equal(resolveModelConfig({ temperature: Number('abc') }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: -1 }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: 3 }).temperature, 0.2);
  assert.equal(resolveModelConfig({}).temperature, 0.2);
});

test('99-1 A1: 3·4문장이 학생 글에 없는 단서 값(장화)을 말하면 피드백만 다시 만들고, 그래도면 3·4문장만 중립 문장', async () => {
  const leaky = { ...GOOD_FEEDBACK, feedbackLine3: '장화의 색도 써 보세요.', feedbackLine4: '장화가 무슨 색인지 그림을 다시 볼까요?' };
  const h = harness({ script: [ok({ ...validOutput(), ...leaky }), ok(leaky, 'served-fb')] });
  const r = await run(h, { wantFeedback: true });
  assert.equal(h.inputs.length, 2, '피드백만 1회 다시 만든다');
  assert.equal(h.inputs[1].purpose, 'feedback');
  assert.ok(h.inputs[1].prompt.includes('그 값(이름·색·개수·장소)을 3·4문장에 그대로 쓰지 않는다'));
  const res = scored(r);
  assert.equal(res.feedbackStatus, 'neutralized');
  assert.equal(res.areas.feature.level, 2, '판정은 그대로');
  assert.deepEqual(r.feedback?.rejections, ['answer_leak', 'answer_leak']);
  const lines = (r.feedback?.text ?? '').split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith('[관계] '), '1·2문장은 모델 문장 그대로');
  assert.equal(lines[2], '[특징] 그림과 내 글을 다시 견주어 보세요.');
  assert.ok(!r.feedback?.text.includes('장화'));
});

test('99-1 A1: 단서 팩 없이 채점하는 일반 체험(공통 문언만)은 누설 검사를 하지 않는다', async () => {
  const leaky = { ...GOOD_FEEDBACK, feedbackLine3: '장화의 색도 써 보세요.', feedbackLine4: '장화가 무슨 색인지 그림을 다시 볼까요?' };
  const h = harness({
    script: [ok({ ...validOutput({ feature: area(2, '노란 우산', ['장화의 색']) }), ...leaky })],
    entry: practiceEntry({ cuesLoaded: false }),
  });
  const r = await run(h, { wantFeedback: true, sessionType: 'experience' });
  assert.equal(h.inputs.length, 1);
  assert.equal(r.feedback?.status, 'verified');
});
