/**
 * 운영 채점 1회 테스트 (수용시험 2·3·4·5·13)
 *
 * 모델 호출은 모두 가짜 함수로 주입한다. 실제 모델을 호출하는 테스트는 만들지 않는다.
 * 따라서 이 파일의 통과는 절차가 규칙대로 도는지에 대한 확인이며,
 * 모델의 채점 정확도나 채점자 간 신뢰도에 대한 증거가 아니다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  createGrading,
  resolveModelConfig,
  type CallModel,
  type GradingDeps,
} from '@/server/grading/operational';
import { privacy as realPrivacy } from '@/server/privacy';
import type { Band } from '@/lib/scoring';
import type { GradingRequest } from '@/server/grading/contract';
import type { QuestionCues, RegistryEntry } from '@/server/registry/contract';

/* ───────────────────────── 가짜 의존 ───────────────────────── */

function makeEntry(band: Band): RegistryEntry {
  return {
    questionId: 'T1',
    kind: 'assessment',
    band,
    lesson: null,
    imageVersion: 'v7',
    imageSha256: 'f4734f7d',
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['research_assessment', 'research_practice', 'experience'],
    durationSeconds: 420,
    cuesLoaded: true,
  };
}

/**
 * 테스트 전용 합성 문항의 단서. 실제 검사 문항의 단서·앵커가 아니다(공개 저장소에 두지 않는다).
 */
const SYNTHETIC_CUES: QuestionCues = {
  coreObjects: ['세모 블록 1개'],
  requiredAttributes: [
    'S1 노란색 몸체',
    'S2 위쪽의 뾰족한 꼭짓점',
    'S3 넓은 밑면',
    'S4 옆면에 파인 홈',
  ],
  requiredContext: [],
  acceptedExpressions: ['삼각 블록', '세모난 나무 조각'],
  notRequired: ['나무라는 재질 추론', '흰 배경'],
  contradictions: ['파란 몸체', '꼭짓점이 없다는 진술'],
  anchors: {
    object: { '5': '노란 세모 블록이 있다.', '3': '블록 하나가 있다.' },
    specificity: { '5': '노란 몸체의 위쪽이 뾰족하고 밑면이 넓으며 옆면에 홈이 파여 있다.', '3': '노란 세모 블록의 밑면이 넓다.' },
  },
};

interface Harness {
  deps: GradingDeps;
  callCount: () => number;
}

function harness(options: {
  band: Band;
  script: Array<() => unknown>;
  hold?: boolean;
  /** 단서 팩이 없는 상태. 레지스트리가 cues_missing으로 거부한다. */
  cuesMissing?: boolean;
  /** 비밀값 점검을 실제 구현으로 바꾼다. */
  assertNoSecrets?: (payload: unknown) => void;
}): Harness {
  let index = 0;
  let calls = 0;
  const callModel: CallModel = async () => {
    calls++;
    const step = options.script[Math.min(index, options.script.length - 1)];
    index++;
    return step();
  };
  let clock = 0;
  const deps: GradingDeps = {
    callModel,
    registry: {
      requireEntry: () => makeEntry(options.band),
      getCues: () => {
        if (options.cuesMissing) {
          const e = new Error('문항 단서를 쓸 수 없습니다') as Error & { code: string };
          e.name = 'RegistryError';
          e.code = 'cues_missing';
          throw e;
        }
        return SYNTHETIC_CUES;
      },
      loadImage: async () => ({
        bytes: Buffer.from('fake-image-bytes'),
        contentType: 'image/png',
        sha256: 'f4734f7d',
      }),
    },
    privacy: {
      checkBeforeSend: () => ({
        decision: options.hold ? 'hold_for_teacher' : 'pass',
        matchedTypes: options.hold ? ['phone_number'] : [],
        checkVersion: 'test',
        notice: '점검은 보조 수단이다.',
      }),
      assertNoSecrets: options.assertNoSecrets ?? (() => undefined),
    },
    modelId: 'test-model',
    modelConfig: { temperature: 0.2 },
    codeCommit: 'testcommit',
    now: () => new Date(1700000000000 + clock++ * 1000),
  };
  return { deps, callCount: () => calls };
}

function request(over: Partial<GradingRequest> = {}): GradingRequest {
  // band는 요청에 넣지 않는다. 밴드는 레지스트리가 questionId로 확정한다.
  return {
    questionId: 'T1',
    studentText: '노란 세모 블록의 밑면이 넓다',
    operationId: 'op-1',
    repeatIndex: 1,
    sessionType: 'research_practice',
    wantFeedback: false,
    ...over,
  };
}

const levels = (o: number, s: number, c: number | null, fb?: Partial<Record<string, unknown>>) => () => ({
  objectLevel: o,
  specificityLevel: s,
  contextLevel: c,
  ...fb,
});

/* ───────────────────────── 테스트 ───────────────────────── */

test('수용시험 2 — A 두 호출 (2,4)·(3,4)는 축별 평균으로 총점 56.25', async () => {
  const h = harness({ band: 'A', script: [levels(2, 4, null), levels(3, 4, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(request());

  assert.equal(run.result.status, 'scored');
  if (run.result.status !== 'scored') return;
  assert.deepEqual(run.result.levels, { objectLevel: 2.5, specificityLevel: 4, contextLevel: null });
  assert.equal(run.result.score, 56.25);
  assert.equal(run.extraCall, false);
  assert.equal(h.callCount(), 2, '일치하면 세 번째 호출을 하지 않는다');
  assert.equal(run.calls.length, 2, '호출별 기록을 모두 남긴다');
  assert.equal(run.calls[0].retryIndex, 0);
});

test('수용시험 3 — B (1,5,3)·(5,1,3)은 총점이 같아도 3차 호출 후 중앙값 (3,3,3)·50점', async () => {
  const h = harness({
    band: 'B',
    script: [levels(1, 5, 3), levels(5, 1, 3), levels(3, 3, 3)],
  });
  const run = await createGrading(h.deps).runOperationalScoring(request());

  assert.equal(h.callCount(), 3);
  assert.equal(run.extraCall, true);
  assert.equal(run.result.status, 'scored');
  if (run.result.status !== 'scored') return;
  assert.deepEqual(run.result.levels, { objectLevel: 3, specificityLevel: 3, contextLevel: 3 });
  assert.equal(run.result.score, 50);
  assert.equal(run.calls.length, 3);
});

test('수용시험 4 — 형식 오류 호출은 1회만 재시도하고 계속 실패하면 schema_error 결측', async () => {
  // 두 번째 호출이 범위 밖 6을 반환한다. clamp로 5나 1로 바꾸지 않는다.
  let n = 0;
  const script = [
    () => {
      n++;
      return n === 1 ? { objectLevel: 3, specificityLevel: 3, contextLevel: null } : { objectLevel: 6, specificityLevel: 3, contextLevel: null };
    },
  ];
  const h = harness({ band: 'A', script });
  const run = await createGrading(h.deps).runOperationalScoring(request());

  assert.equal(run.result.status, 'missing');
  if (run.result.status !== 'missing') return;
  assert.equal(run.result.score, null);
  assert.equal(run.result.levels, null);
  assert.equal(run.result.axisScores, null);
  assert.equal(run.result.reason, 'schema_error');
  assert.equal(h.callCount(), 3, '성공한 호출은 재시도하지 않고 실패한 호출만 1회 재시도한다');
  const failed = run.calls.filter((c) => c.levels === null);
  assert.equal(failed.length, 2);
  assert.deepEqual(
    failed.map((c) => c.retryIndex),
    [0, 1],
  );
});

test('수용시험 4 — B밴드에서 contextLevel이 null이면 성공으로 보정하지 않는다', async () => {
  const h = harness({ band: 'B', script: [levels(3, 3, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(run.result.status, 'missing');
  if (run.result.status !== 'missing') return;
  assert.equal(run.result.reason, 'schema_error');
  assert.equal(run.result.score, null);
});

test('수용시험 4 — 문자열·NaN·2.5도 유효 값으로 바꾸지 않는다', async () => {
  for (const bad of [{ objectLevel: '4' }, { objectLevel: NaN }, { objectLevel: 2.5 }]) {
    const h = harness({
      band: 'A',
      script: [() => ({ specificityLevel: 3, contextLevel: null, ...bad })],
    });
    const run = await createGrading(h.deps).runOperationalScoring(request());
    assert.equal(run.result.status, 'missing', `${JSON.stringify(bad)}는 결측이어야 한다`);
  }
});

test('수용시험 4 — 모델 호출이 실패하면 model_error 결측이고 점수는 null', async () => {
  const h = harness({
    band: 'A',
    script: [
      () => {
        throw new Error('network');
      },
    ],
  });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(run.result.status, 'missing');
  if (run.result.status !== 'missing') return;
  assert.equal(run.result.reason, 'model_error');
  assert.equal(run.result.score, null);
  // 두 호출이 각각 1회씩 재시도한다.
  assert.equal(h.callCount(), 4);
});

test('세 번째 호출이 실패하면 두 값의 평균으로 대체하지 않고 required_call_failed 결측', async () => {
  let n = 0;
  const h = harness({
    band: 'B',
    script: [
      () => {
        n++;
        if (n === 1) return { objectLevel: 1, specificityLevel: 5, contextLevel: 3 };
        if (n === 2) return { objectLevel: 5, specificityLevel: 1, contextLevel: 3 };
        throw new Error('network');
      },
    ],
  });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(run.result.status, 'missing');
  if (run.result.status !== 'missing') return;
  assert.equal(run.result.reason, 'required_call_failed');
  assert.equal(run.extraCall, true);
  assert.equal(run.calls.length, 4, '3차 호출과 그 재시도까지 기록에 남는다');
});

test('개인정보 점검이 hold_for_teacher이면 외부로 전송하지 않고 그 상태를 남긴다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)], hold: true });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(h.callCount(), 0, '전송 전에 멈춘다');
  assert.equal(run.result.status, 'missing');
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0].failureReason ?? '', /privacy_hold_for_teacher/);
});

test('수용시험 5 — 인용 검증이 실패해도 재생성 뒤 대체 문구를 쓰고 점수는 바뀌지 않는다', async () => {
  const draft = {
    feedbackLine1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
    feedbackLine2: '잘 썼어요',
    feedbackLine3: '분홍 리본도 적어 보세요',
    feedbackLine4: '리본이라는 낱말을 써 볼 수 있어요',
    quote: '분홍 리본', // 학생 글에 없는 표현
  };
  const h = harness({ band: 'A', script: [levels(3, 3, null, draft)] });
  const run = await createGrading(h.deps).runOperationalScoring(request({ wantFeedback: true }));

  assert.equal(run.result.status, 'scored');
  if (run.result.status !== 'scored') return;
  assert.equal(run.result.score, 50, '피드백 실패는 점수를 바꾸지 않는다');
  assert.equal(run.result.feedbackStatus, 'fallback');
  assert.equal(run.feedback?.text, '표현을 선생님과 함께 확인해 보세요');
  assert.equal(h.callCount(), 3, '채점 2회 + 피드백 재생성 1회');
});

test('수용시험 5 — 인용이 원문에 있으면 그대로 verified로 쓴다', async () => {
  const draft = {
    feedbackLine1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
    feedbackLine2: '노란 세모 블록을 정확히 적었어요',
    feedbackLine3: '옆면의 홈도 한 가지 적어 보세요',
    feedbackLine4: '파인, 홈 같은 낱말을 써 볼 수 있어요',
    quote: '노란 세모 블록',
  };
  const h = harness({ band: 'A', script: [levels(3, 3, null, draft)] });
  const run = await createGrading(h.deps).runOperationalScoring(request({ wantFeedback: true }));
  assert.equal(run.feedback?.status, 'verified');
  assert.equal(run.feedback?.quote, '노란 세모 블록');
  assert.equal(run.feedback?.regenerated, false);
  assert.equal(h.callCount(), 2, '피드백이 통과하면 추가 호출을 하지 않는다');
});

test('피드백을 요청하지 않으면 not_requested로 남는다', async () => {
  const h = harness({ band: 'A', script: [levels(4, 4, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(request({ wantFeedback: false }));
  assert.equal(run.feedback?.status, 'not_requested');
});

test('호출 기록에 학생 원문이 남지 않는다', async () => {
  const h = harness({
    band: 'A',
    script: [
      () => {
        throw new Error('노란 세모 블록의 밑면이 넓다');
      },
    ],
  });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  for (const c of run.calls) {
    assert.ok(!(c.failureReason ?? '').includes('세모 블록'));
  }
});

test('실행 기록에 모델·루브릭·단서 버전과 지시문 해시가 남는다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(run.modelId, 'test-model');
  assert.equal(run.cueVersion, 'v7-candidate');
  assert.equal(run.rubricVersion, 'v7-candidate');
  assert.match(run.promptHash, /^[0-9a-f]{64}$/);
  assert.equal(run.codeCommit, 'testcommit');
  assert.equal(run.repeatIndex, 1);
});

/**
 * 수용시험 13.
 * 원래 항목은 T1의 대상5·구체성3 경계를 확인하는 것이나, 검사 문항의 실제 단서·앵커는
 * 공개 저장소에 두지 않는다(수용시험 12). 같은 경계를 가진 **합성 대체 문항**으로 확인한다.
 * 연구자가 작성한 개발 초안이며 실제 학생 응답도, 전문가 확정 결과도 아니다.
 * 아래는 그 경계가 코드에서 어떤 점수로 환산되는지만 확인한다.
 * 모델의 임의 한 번 출력으로 독립 신뢰도가 통과했다고 선언하지 않는다.
 */
test('수용시험 13 — 합성 대체 문항의 대상5·구체성3 경계: 명칭만으로 만점이 아니다', async () => {
  const h = harness({ band: 'A', script: [levels(5, 3, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(
    request({ studentText: '노란 세모 블록' }),
  );
  assert.equal(run.result.status, 'scored');
  if (run.result.status !== 'scored') return;
  assert.deepEqual(run.result.levels, { objectLevel: 5, specificityLevel: 3, contextLevel: null });
  assert.equal(run.result.axisScores?.object, 50);
  assert.equal(run.result.axisScores?.specificity, 25);
  assert.equal(run.result.score, 75, '대상 축 최고 수준이 전체 만점을 뜻하지 않는다');
  assert.notEqual(run.result.score, 100);
  // 이 결과는 합성 입력에 대한 환산 확인이다. 모델의 채점 일치도에 대한 증거가 아니다.
});

/* ───────────────────── 감사 수정 확인 (D4·D5·D10·D12) ───────────────────── */

test('D5 — 채점 기록에 실제로 보낸 이미지의 해시가 남는다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)] });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  // 가짜 자산이 돌려준 sha256이 그대로 기록되어야 한다. 필드가 없거나 비면 실패한다.
  assert.equal(run.imageHash, 'f4734f7d');
});

test('D5 — 전송 전에 멈춘 결측에는 이미지 해시를 지어내지 않는다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)], hold: true });
  const run = await createGrading(h.deps).runOperationalScoring(request());
  assert.equal(run.result.status, 'missing');
  assert.equal(run.imageHash, '', '열지 않은 이미지의 해시를 만들어 넣지 않는다');
});

test('D10 — 단서가 없으면 서버 예외가 아니라 제어된 결측으로 마감한다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)], cuesMissing: true });
  const run = await createGrading(h.deps).runOperationalScoring(request());

  assert.equal(h.callCount(), 0, '단서 없이 모델을 부르지 않는다');
  assert.equal(run.result.status, 'missing');
  if (run.result.status !== 'missing') return;
  assert.equal(run.result.score, null, '결측은 0점이 아니다');
  assert.equal(run.result.levels, null);
  assert.equal(run.result.reason, 'required_call_failed');
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0].failureReason ?? '', /cues_missing/);
  assert.equal(run.promptHash, '', '보내지 않은 지시문의 해시는 남기지 않는다');
});

test('D10 — 단서 없음이 아닌 레지스트리 오류는 그대로 올린다', async () => {
  const h = harness({ band: 'A', script: [levels(3, 3, null)] });
  const deps = {
    ...h.deps,
    registry: {
      ...h.deps.registry,
      getCues: () => {
        const e = new Error('등록되지 않은 문항') as Error & { code: string };
        e.code = 'unknown_question';
        throw e;
      },
    },
  };
  await assert.rejects(() => createGrading(deps).runOperationalScoring(request()), /등록되지 않은/);
});

test('D12 — 피드백 문구에 자격정보가 섞이면 점수는 그대로 두고 문구만 대체한다', async () => {
  const leaked = 'AIzaSyA1234567890abcdefghijklmnopqrstuvw';
  const draft = {
    feedbackLine1: '이번 문제는 그림에 있는 것을 그대로 설명하는 것이에요',
    feedbackLine2: `노란 세모 블록을 정확히 적었어요 ${leaked}`,
    feedbackLine3: '옆면의 홈도 한 가지 적어 보세요',
    feedbackLine4: '파인, 홈 같은 낱말을 써 볼 수 있어요',
    quote: '노란 세모 블록',
  };
  const h = harness({
    band: 'A',
    script: [levels(3, 3, null, draft)],
    assertNoSecrets: realPrivacy.assertNoSecrets,
  });
  const run = await createGrading(h.deps).runOperationalScoring(request({ wantFeedback: true }));

  assert.equal(run.result.status, 'scored');
  if (run.result.status !== 'scored') return;
  assert.equal(run.result.score, 50, '문구를 대체해도 점수는 바뀌지 않는다');
  assert.equal(run.result.feedbackStatus, 'fallback');
  assert.equal(run.feedback?.text, '표현을 선생님과 함께 확인해 보세요');
  assert.ok(!JSON.stringify(run).includes(leaked), '기록 어디에도 자격정보가 남지 않는다');
});

test('D12 — 온도 설정이 숫자가 아니면 기본값으로 되돌린다', () => {
  assert.equal(resolveModelConfig({ temperature: Number('') }).temperature, 0);
  assert.equal(resolveModelConfig({ temperature: Number('abc') }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: Number(undefined) }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: 0.2 }).temperature, 0.2);
  assert.equal(resolveModelConfig({ temperature: -1 }).temperature, 0.2);
  assert.equal(resolveModelConfig({}).temperature, 0.2);
});

/* ─────────────── 서버 액션 관문의 정적 확인 (D1·D2·D3·D6) ───────────────
 * 이 확인은 실제 모델·Firestore를 부르지 않는다. 서버 액션 파일이 인증 관문을
 * 그대로 갖고 있는지만 본다. 실제 거부 동작은 Emulator 권한 시험에서 확인한다.
 */

const readSource = (relative: string) =>
  readFileSync(resolvePath(process.cwd(), relative), 'utf8');

test('D1 — 감수 플로우가 스스로 연구자 역할과 승인 기록을 확인한다', () => {
  const src = readSource('src/ai/flows/audit-agent.ts');
  assert.match(src, /auth\.requireRole\('researcher'\)/, '플로우 자체에 역할 검사가 있어야 한다');
  assert.match(src, /requireRealDataAuditApproval/, '승인 기록을 서버에서 조회해야 한다');
  // 호출자가 보낸 승인 문자열 세 개만으로 통과시키던 판정이 남아 있으면 안 된다.
  assert.ok(
    !/approval\.approvedBy\s*\|\|\s*!approval\.approvedAt/.test(src),
    '문자열 존재만으로 실데이터를 허용하지 않는다',
  );
});

test('D1 — 승인 기록을 실제로 저장하는 경로가 있다', () => {
  const src = readSource('src/server/auth/audit-actions.ts');
  assert.match(src, /COLLECTIONS\.auditApprovals/);
  assert.match(src, /grantRealDataAuditApproval/);
  assert.match(src, /requireRole\('admin'\)/, '요청자와 승인자를 분리한다');
});

test('D2 — 연습 채점 서버 액션이 차시 개방과 동의를 서버에서 확인한다', () => {
  const src = readSource('src/ai/flows/evaluate-prompt.ts');
  assert.match(src, /assertModeAllowed/, '허용되지 않은 세션의 채점을 막는다');
  assert.match(src, /getLessonStateAction/, '차시 개방을 서버 기록으로 확인한다');
  assert.match(src, /requireActiveResearchConsent/, '미동의·철회자의 전송을 막는다');
});

test('D3 — 감수 경로가 제작 프롬프트를 타입 안전하게 읽는다', () => {
  const src = readSource('src/server/auth/audit-actions.ts');
  assert.match(src, /practiceSourcePromptByLevel/);
  assert.ok(!src.includes('@ts-ignore'), '@ts-ignore로 오류를 가리지 않는다');
  assert.ok(!src.includes('PRACTICE_SOURCE_PROMPTS'), '존재하지 않는 export를 찾지 않는다');
  // 서버 전용 모듈은 함수만 내보낸다(테스트에서 import 하지 않고 export 이름만 확인한다).
  const mod = readSource('src/server/registry/practice-source-prompts.ts');
  assert.match(mod, /export function practiceSourcePromptByLevel/);
});

test('D6 — 감수 모델 ID를 파일에 하드코딩하지 않는다', () => {
  const src = readSource('src/ai/flows/audit-agent.ts');
  assert.match(src, /EVALUATION_MODEL_ID/);
  assert.ok(
    !/model:\s*'googleai\//.test(src),
    '모델 ID는 src/server/config.ts 한곳에서만 정한다',
  );
  // 주석의 모델명과 실제 사용 값이 어긋나 있던 문제도 함께 막는다.
  assert.ok(!src.includes('gemini-2.5-flash'), '주석이 실제와 다른 모델명을 말하지 않는다');
});
