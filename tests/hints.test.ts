/**
 * 문항별 힌트(논문 v12-2, 목표 + 확인 질문) 규칙 시험.
 *
 *   1. L01~L36 모두 초안이 있다. 목표 = 공통 문장 + 단계별 둘째 문장(A2)
 *   2. 확인 질문은 규칙대로 만든다 — 단계 초점 영역이 맨 앞(2단계 대상·3단계 특징·4단계 관계),
 *      3단계 특징 질문은 겉모습까지(A3), 관계 질문은 문항별 예외 목록(A4), C밴드 선택 안내는 맨 뒤에 하나만
 *   3. 관계가 기본으로 해당 없음인 문항(대상 하나인 A밴드 L01–L04·L06·L08·L11, 장소 없는 L20·L23)은
 *      학생 화면에서 관계 질문이 빠지고 채점의 판정 영역도 해당 없음이다. 단서 팩이 있으면 단서 팩이 우선한다(A5)
 *   4. 힌트는 정답 값(숫자·색 이름·개수·그림 제목의 낱말)과 특정 부위를 적지 않는다 — 36문항 전수(A6)
 *   5. 검수를 마치지 않은 힌트는 학생 화면(PRACTICE_QUESTIONS.hint)에 나가지 않는다(A1)
 *   6. withoutAreas는 그 영역의 질문만 뺀다
 *   7. 예전 초안 문구(그림의 부위를 짚는 문장)는 학생 번들 파일에도, 공개 저장소의 검수 스크립트·검수표에도 남지 않는다
 *      (예전 초안은 연구자 비공개 hint-review-notes.json에만 있다. RESEARCH_ASSET_DIR에 그 파일이 있으면 문장 단위로 대조한다)
 *   8. 검수표 문서가 원본과 어긋나지 않고, 맨 위에 문항 ID를 넣는 방법이 있다
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  HINT_C_OPTIONAL,
  HINT_CHECK,
  HINT_GOAL,
  PRACTICE_HINTS,
  REVIEWED_QUESTIONS,
  STAGE_GOAL,
  buildHintChecks,
  hintGoalOf,
  reviewedHintOf,
  screenHintOf,
  withoutAreas,
  type PracticeHint,
} from '../src/lib/practice-hints';
import {
  RELATION_NOT_APPLICABLE_QUESTIONS,
  STILL_SCENE_QUESTIONS,
  defaultNotApplicableAreas,
} from '../src/lib/question-areas';
import { applicabilityOf, buildEvaluationPrompt } from '../src/lib/evaluation-prompt';
import { PRACTICE_QUESTIONS } from '../src/lib/questions';
import { AREA_IDS, bandOf } from '../src/lib/scoring';
import { chasiOfLevel, stageFocusArea } from '../src/lib/stages';

const IDS = Array.from({ length: 36 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`);
const levelOf = (id: string) => Number(id.slice(1));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const idOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/** 힌트에 들어간 모든 문장 */
const textsOf = (hint: PracticeHint) => [hint.goal, ...hint.checks.map((c) => c.text)];

/** 관계가 기본으로 해당 없음: 대상 하나인 A밴드 그림 + 장소를 알 수 없는 L20·L23 */
const RELATION_NA = ['L01', 'L02', 'L03', 'L04', 'L06', 'L08', 'L11', 'L20', 'L23'];
/** 행동이 없는 사물·풍경(관계 질문 = 놓인 모양). L20·L23은 관계 해당 없음이라 넣지 않는다. */
const STILL = ['L22', 'L24', 'L25', 'L28', 'L30'];

test('목표 = 공통 문장 + 단계별 둘째 문장(A2)', () => {
  assert.deepEqual(Object.keys(PRACTICE_HINTS).sort(), IDS);
  assert.equal(HINT_GOAL, '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.');
  assert.deepEqual({ ...STAGE_GOAL }, {
    1: '쓴 다음에는 받은 피드백을 읽어 봐요.',
    2: '이번에는 무엇이 몇 개인지를 가장 정확하게 써요.',
    3: '이번에는 생김새가 어느 것의 것인지 드러나게 써요.',
    4: '이번에는 어디에서 무엇을 하고 있는지를 꼭 써요.',
    5: '피드백을 그림과 견주어 보고 맞는 것만 받아들여 고쳐 써요.',
    6: '세 가지(무엇이 몇 개·생김새·어디에서 무엇을)를 모두 담아 써요.',
  });
  for (const id of IDS) {
    const draft = PRACTICE_HINTS[id];
    const chasi = chasiOfLevel(levelOf(id));
    assert.ok(chasi, id);
    assert.equal(draft.goal, `${HINT_GOAL} ${STAGE_GOAL[chasi]}`, id);
    assert.equal(draft.goal, hintGoalOf(levelOf(id)), id);
    assert.equal(typeof draft.reviewed, 'boolean', id);
  }
  // 단계와 문항 배치: 3단계는 L19–L24, 4단계는 L13–L18
  assert.ok(PRACTICE_HINTS.L19.goal.endsWith(STAGE_GOAL[3]));
  assert.ok(PRACTICE_HINTS.L13.goal.endsWith(STAGE_GOAL[4]));
  assert.ok(PRACTICE_HINTS.L07.goal.endsWith(STAGE_GOAL[2]));
  assert.ok(PRACTICE_HINTS.L36.goal.endsWith(STAGE_GOAL[6]));
});

test('확인 질문 문구는 정해진 문장뿐이다(A3·A4)', () => {
  assert.equal(HINT_CHECK.object, '무엇이 몇 개 있는지 빠짐없이 썼나요?');
  assert.equal(HINT_CHECK.feature, '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?');
  assert.equal(HINT_CHECK.featureStage3, '색·모양·겉모습(매끈한지, 거친지 등)이 어느 것의 것인지 알 수 있게 썼나요?');
  assert.equal(HINT_CHECK.relationA, '서로 어디에 있는지(위·아래·옆·안) 썼나요?');
  assert.equal(HINT_CHECK.relationStill, '무엇이 어디에 어떻게 놓여 있는지 썼나요?');
  assert.equal(HINT_CHECK.relationBC, '어디에서 무엇을 하고 있는지 썼나요?');
  assert.equal(
    HINT_C_OPTIONAL,
    '언제인지 알 수 있다면 써도 좋아요. 분위기를 쓸 때는 무엇을 보고 그렇게 느꼈는지도 써요.'
  );
  const allowed = new Set<string>([...Object.values(HINT_CHECK), HINT_C_OPTIONAL]);
  for (const id of IDS) {
    for (const c of PRACTICE_HINTS[id].checks) assert.ok(allowed.has(c.text), `${id}에 정해지지 않은 문장: ${c.text}`);
  }
});

test('특징 질문: 3단계(L19–L24)만 겉모습까지 묻는다(A3)', () => {
  for (const id of IDS) {
    const feature = PRACTICE_HINTS[id].checks.find((c) => c.area === 'feature')?.text;
    const stage3 = chasiOfLevel(levelOf(id)) === 3;
    assert.equal(feature, stage3 ? HINT_CHECK.featureStage3 : HINT_CHECK.feature, id);
  }
  for (const level of range(19, 24)) assert.equal(chasiOfLevel(level), 3);
});

test('관계 질문: A밴드는 공간, 물건·풍경은 놓인 모양, 사람·동물은 장소·행동(A4)', () => {
  assert.deepEqual([...STILL_SCENE_QUESTIONS], STILL);
  for (const id of IDS) {
    const level = levelOf(id);
    const relation = PRACTICE_HINTS[id].checks.find((c) => c.area === 'relation')?.text;
    if (bandOf(level) === 'A') assert.equal(relation, HINT_CHECK.relationA, id);
    else if (STILL.includes(id)) assert.equal(relation, HINT_CHECK.relationStill, id);
    else assert.equal(relation, HINT_CHECK.relationBC, id);
  }
  // 학생 화면에서 실제로 보이는 관계 질문(기본값 기준)
  const onScreen = (id: string) =>
    withoutAreas(PRACTICE_HINTS[id], defaultNotApplicableAreas(id)).checks.find((c) => c.area === 'relation')?.text;
  for (const id of ['L22', 'L24', 'L25', 'L28', 'L30']) assert.equal(onScreen(id), HINT_CHECK.relationStill, id);
  for (const id of ['L13', 'L19', 'L21', 'L26', 'L29', 'L31', 'L36']) assert.equal(onScreen(id), HINT_CHECK.relationBC, id);
  for (const id of ['L05', 'L07', 'L09', 'L10', 'L12']) assert.equal(onScreen(id), HINT_CHECK.relationA, id);
  for (const level of range(1, 12)) assert.equal(bandOf(level), 'A');
  for (const level of range(13, 24)) assert.equal(bandOf(level), 'B');
  for (const level of range(25, 36)) assert.equal(bandOf(level), 'C');
});

test('관계 기본 해당 없음 문항은 화면에서 관계 질문이 빠지고 채점도 해당 없음 — 단서 팩이 우선(A5)', () => {
  assert.deepEqual([...RELATION_NOT_APPLICABLE_QUESTIONS], RELATION_NA);
  for (const id of IDS) {
    const na = RELATION_NA.includes(id);
    assert.deepEqual(defaultNotApplicableAreas(id), na ? ['relation'] : [], id);
    // 초안에는 세 영역이 모두 있다(단서 팩이 관계를 요구하면 나가야 하므로).
    const draftAreas = PRACTICE_HINTS[id].checks.filter((c) => c.area !== null).map((c) => c.area);
    assert.deepEqual([...draftAreas].sort(), [...AREA_IDS].sort(), id);
    // 서버 값이 없을 때(기본 목록)와 서버가 기본 목록을 보냈을 때 모두 관계 질문이 빠진다.
    const shown = withoutAreas(PRACTICE_HINTS[id], defaultNotApplicableAreas(id));
    assert.equal(shown.checks.some((c) => c.area === 'relation'), !na, id);
    // 단서 팩이 없으면(일반 체험) 관계는 코드가 해당 없음으로 둔다.
    assert.equal(applicabilityOf(null, id).relation, na ? false : null, id);
  }
  // 단서 팩이 있으면 단서 팩이 우선한다: 필수 관계가 있으면 판정, 비면 해당 없음.
  const cues = {
    coreObjects: ['대상'],
    requiredAttributes: ['속성'],
    requiredContext: ['관계'],
    acceptedExpressions: [],
    notRequired: [],
    contradictions: [],
    anchors: {},
  };
  assert.equal(applicabilityOf(cues, 'L20').relation, true);
  assert.equal(applicabilityOf({ ...cues, requiredContext: [] }, 'L22').relation, false);
  assert.equal(applicabilityOf(cues, 'L05').relation, true);
  assert.equal(applicabilityOf(cues).relation, true);
  // 지시문에도 관계 해당 없음이 들어간다(단서 팩 없음 + 기본 목록).
  const prompt = buildEvaluationPrompt({ band: 'A', studentPrompt: '사과', cues: null, noCuePolicy: 'common_only', questionId: 'L01' });
  assert.match(prompt, /관계\(relation\): 이 과제는 요구하지 않는다/);
  const b = buildEvaluationPrompt({ band: 'B', studentPrompt: '주전자', cues: null, noCuePolicy: 'common_only', questionId: 'L23' });
  assert.match(b, /관계\(relation\): 이 과제는 요구하지 않는다/);
  const other = buildEvaluationPrompt({ band: 'A', studentPrompt: '공', cues: null, noCuePolicy: 'common_only', questionId: 'L07' });
  assert.doesNotMatch(other, /관계\(relation\): 이 과제는 요구하지 않는다/);
});

test('screenHintOf: 검수를 마친 힌트만, 서버가 알려 준 해당 없음(없으면 기본 목록)을 빼고 낸다', () => {
  for (const id of IDS) {
    const hint = screenHintOf(id);
    if (!PRACTICE_HINTS[id].reviewed) {
      assert.equal(hint, null, id);
      continue;
    }
    assert.ok(hint);
    assert.equal(hint.checks.some((c) => c.area === 'relation'), !RELATION_NA.includes(id), id);
    // 단서 팩이 관계를 요구해 서버가 빈 목록을 보내면 관계 질문이 나간다.
    assert.ok(screenHintOf(id, [])?.checks.some((c) => c.area === 'relation'), id);
    // 서버가 특징 해당 없음을 알리면 특징 질문이 빠진다.
    assert.equal(screenHintOf(id, ['feature'])?.checks.some((c) => c.area === 'feature'), false, id);
  }
  assert.equal(screenHintOf('L99'), null);
});

test('단계 초점 영역의 질문이 맨 앞이다(2단계 대상·3단계 특징·4단계 관계)', () => {
  const firstArea = (level: number) => PRACTICE_HINTS[idOf(level)].checks[0].area;
  for (const level of range(7, 12)) assert.equal(firstArea(level), 'object', `L${level}(2단계)`);
  for (const level of range(19, 24)) assert.equal(firstArea(level), 'feature', `L${level}(3단계)`);
  for (const level of range(13, 18)) assert.equal(firstArea(level), 'relation', `L${level}(4단계)`);
  // 1·5·6단계는 대상 → 특징 → 관계
  for (const level of [...range(1, 6), ...range(25, 36)]) {
    const areas = PRACTICE_HINTS[idOf(level)].checks.filter((c) => c.area !== null).map((c) => c.area);
    assert.deepEqual(areas, ['object', 'feature', 'relation'], `L${level}`);
    assert.equal(stageFocusArea(chasiOfLevel(level)), null);
  }
  // 초점이 아닌 나머지는 대상 → 특징 → 관계 순서를 지킨다.
  for (const id of IDS) {
    const areas = PRACTICE_HINTS[id].checks.filter((c) => c.area !== null).map((c) => c.area);
    const rest = areas.slice(1);
    const expected = AREA_IDS.filter((a) => a !== areas[0]);
    if (stageFocusArea(chasiOfLevel(levelOf(id)))) assert.deepEqual(rest, expected, id);
  }
  // 초안은 buildHintChecks 한 곳에서 나온다.
  for (const id of IDS) assert.deepEqual(PRACTICE_HINTS[id].checks, buildHintChecks(levelOf(id)), id);
});

test('C밴드만 선택 안내를 맨 뒤에 하나 둔다', () => {
  for (const id of IDS) {
    const checks = PRACTICE_HINTS[id].checks;
    const optional = checks.filter((c) => c.area === null);
    const areaCount = 3;
    if (bandOf(levelOf(id)) === 'C') {
      assert.equal(optional.length, 1, id);
      assert.deepEqual(checks[checks.length - 1], { area: null, text: HINT_C_OPTIONAL }, id);
      assert.match(checks[checks.length - 1].text, /무엇을 보고 그렇게 느꼈는지/);
      assert.equal(checks.length, areaCount + 1, id);
    } else {
      assert.equal(optional.length, 0, `${id}는 C밴드가 아니다`);
      assert.equal(checks.length, areaCount, id);
      for (const t of textsOf(PRACTICE_HINTS[id])) {
        assert.equal(/분위기|언제/.test(t), false, `${id}에 시간대·분위기 안내가 있다`);
      }
    }
  }
});

/*
 * 정답 값·특정 부위 전수 점검(A6). 36문항의 힌트 문장 전부를 36개 그림 제목의 낱말 전부와 견준다
 * (다른 문항의 정답이 섞여도 잡는다).
 *   - 제목의 낱말: 제목을 띄어 쓴 조각과 그 조각에서 조사를 뗀 것(두 글자 이상)
 *   - 숫자, 색 이름, 수량 표현(한·두·세… + 개·마리·명 등), 그림의 부위·자리를 가리키는 낱말
 * 예외는 셋뿐이다.
 *   - '모양'은 특징 영역을 가리키는 일반 낱말이다(L10 제목 '별 모양'의 정답은 '별').
 *   - 괄호 속 보기 목록 '(위·아래·옆·안)'·'(매끈한지, 거친지 등)'은 여러 보기를 함께 묻는 것이라
 *     그림에 무엇이 있는지 알려 주지 않는다(L27 제목의 '아래', L22 제목의 '거친'과 글자만 겹친다).
 *   - 6단계 목표의 '세 가지'는 세 영역을 가리킨다(수량 표현 규칙에 걸리지 않는다).
 */
const GENERIC_WORDS = new Set(['모양']);
const OPTION_LISTS = ['(위·아래·옆·안)', '(매끈한지, 거친지 등)'];
const PARTICLES = /(에서|에게|으로|에|을|를|의|이|가|은|는|과|와|도)$/;
const TITLE_WORDS = (() => {
  const words = new Set<string>();
  for (const q of PRACTICE_QUESTIONS) {
    for (const token of q.koreanTitle.split(/\s+/)) {
      for (const w of [token, token.replace(PARTICLES, '')]) if (w.length >= 2 && !GENERIC_WORDS.has(w)) words.add(w);
    }
  }
  return [...words];
})();
const COLORS = [
  '빨간', '빨강', '노란', '노랑', '파란', '파랑', '초록', '녹색', '갈색', '주황', '보라', '회색',
  '흰', '하얀', '검은', '검정', '까만', '은색', '금색', '분홍', '하늘색',
];
const COUNT_WORDS = ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '두 아이', '한 쌍'];
const COUNT_PATTERN = /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(개|마리|명|켤레|쌍|장|권|송이|그루|대|조각)/;
const PART_WORDS = [
  '손잡이', '꼭지', '뚜껑', '주둥이', '날개', '다리', '꼬리', '머리', '가시', '뿌리', '톱니', '고리', '무늬',
  '바퀴', '몸통', '창문', '창밖', '하늘', '바닥', '배경', '발밑', '식탁', '부분', '꿰맨',
  '위쪽', '아래쪽', '가운데', '왼쪽', '오른쪽', '뒤쪽', '앞쪽', '구석', '귀퉁이',
];

test('힌트는 정답 값과 특정 부위를 적지 않는다 — 36문항 전수(A6)', () => {
  assert.ok(TITLE_WORDS.length > 60, '제목 낱말을 제대로 모으지 못했다');
  let checked = 0;
  for (const id of IDS) {
    for (const raw of textsOf(PRACTICE_HINTS[id])) {
      checked += 1;
      const t = OPTION_LISTS.reduce((acc, list) => acc.split(list).join(''), raw);
      assert.equal(/[0-9０-９]/.test(t), false, `${id}에 숫자가 있다: ${raw}`);
      assert.equal(COUNT_PATTERN.test(t), false, `${id}에 수량 표현이 있다: ${raw}`);
      for (const word of [...COLORS, ...COUNT_WORDS, ...PART_WORDS, ...TITLE_WORDS]) {
        assert.equal(t.includes(word), false, `${id}에 "${word}"가 있다: ${raw}`);
      }
    }
  }
  assert.ok(checked >= 36 * 3, `확인한 문장 수가 모자란다: ${checked}`);
  // 예외로 둔 보기 목록은 정해진 문장에만 있다.
  assert.ok(HINT_CHECK.relationA.includes(OPTION_LISTS[0]));
  assert.ok(HINT_CHECK.featureStage3.includes(OPTION_LISTS[1]));
  // 수량 규칙이 제 구실을 하는지(보기)
  assert.ok(COUNT_PATTERN.test('사과 두 개'));
  assert.equal(COUNT_PATTERN.test(STAGE_GOAL[6]), false);
});

test('검수를 마치지 않은 힌트는 학생 화면에 나가지 않는다', () => {
  assert.equal(PRACTICE_QUESTIONS.length, 36);
  for (const q of PRACTICE_QUESTIONS) {
    const id = idOf(q.level);
    const draft = PRACTICE_HINTS[id];
    assert.equal(draft.reviewed, REVIEWED_QUESTIONS.includes(id), id);
    if (!draft.reviewed) {
      assert.equal(q.hint, null, `${id} 초안이 화면에 나간다`);
      assert.equal(reviewedHintOf(id), null, id);
    } else {
      assert.deepEqual(q.hint, { goal: draft.goal, checks: draft.checks });
      // 화면에 나가는 힌트에는 검수 표시가 실리지 않는다.
      assert.equal('reviewed' in (q.hint ?? {}), false);
    }
    // 단계 공통 안내는 그대로 남아 대체 문구로 쓰인다.
    assert.ok(q.rubric.length > 0);
  }
  assert.equal(reviewedHintOf('L99'), null);
  assert.equal(reviewedHintOf(''), null);
});

test('withoutAreas는 그 영역의 질문만 뺀다', () => {
  const c = PRACTICE_HINTS.L31; // C밴드, 6단계
  const noRelation = withoutAreas(c, ['relation']);
  assert.equal(noRelation.goal, c.goal);
  assert.deepEqual(noRelation.checks, c.checks.filter((x) => x.area !== 'relation'));
  assert.deepEqual(noRelation.checks.map((x) => x.area), ['object', 'feature', null]);
  // 영역에 딸리지 않은 C밴드 선택 안내는 남는다.
  assert.equal(noRelation.checks[noRelation.checks.length - 1].text, HINT_C_OPTIONAL);

  const b = PRACTICE_HINTS.L13; // B밴드, 4단계 — 관계가 맨 앞
  assert.deepEqual(withoutAreas(b, ['feature']).checks.map((x) => x.area), ['relation', 'object']);
  assert.deepEqual(withoutAreas(b, ['feature', 'relation']).checks.map((x) => x.area), ['object']);

  const a = PRACTICE_HINTS.L01;
  assert.deepEqual(withoutAreas(a, []).checks, a.checks);
  assert.deepEqual(withoutAreas(a, ['relation']).checks.map((x) => x.area), ['object', 'feature']);
  // 원본은 바뀌지 않는다.
  assert.deepEqual(a.checks.map((x) => x.area), ['object', 'feature', 'relation']);

  assert.deepEqual(PRACTICE_HINTS.L31.checks.map((x) => x.area), ['object', 'feature', 'relation', null]);
});

test('예전 초안 문구는 학생 번들 파일(practice-hints.ts)과 공개 검수 자료에 남지 않는다', () => {
  const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n');
  const src = read('src', 'lib', 'practice-hints.ts');
  const script = read('scripts', 'print-practice-hints.mjs');
  const doc = read('docs', 'practice-hints-review.md');
  for (const [where, text] of [['practice-hints.ts', src], ['print-practice-hints.mjs', script], ['practice-hints-review.md', doc]]) {
    assert.equal(text.includes('살펴봐요'), false, `${where}에 예전 초안의 "살펴봐요"가 남아 있다`);
  }
  // 그림 묘사 자료는 공개 스크립트에 상수로 두지 않는다(비공개 hint-review-notes.json에서만 읽는다).
  assert.doesNotMatch(script, /const (LEGACY_DRAFTS|NOTES|LEGACY_MOOD) =/, '검수 스크립트에 그림 묘사 자료가 남아 있다');
  assert.equal(doc.includes('예전 초안(참고)'), false, '공개 검수표에 예전 초안 열이 남아 있다');

  // 연구자 컴퓨터에 비공개 자료가 있으면 예전 초안 36개의 문장이 공개 파일 어디에도 없는지 대조한다.
  const dir = process.env.RESEARCH_ASSET_DIR?.trim();
  const file = dir ? path.join(dir, 'hint-review-notes.json') : '';
  if (!file || !existsSync(file)) return;
  const legacy: Record<string, string> = JSON.parse(readFileSync(file, 'utf8')).legacy ?? {};
  assert.deepEqual(Object.keys(legacy), IDS, '비공개 예전 초안이 36개가 아니다');
  for (const [id, body] of Object.entries(legacy)) {
    for (const sentence of body.split(/(?<=\.)\s+/)) {
      for (const [where, text] of [['practice-hints.ts', src], ['print-practice-hints.mjs', script], ['practice-hints-review.md', doc]]) {
        assert.equal(text.includes(sentence), false, `${where}에 ${id} 예전 문장이 남아 있다: ${sentence}`);
      }
    }
  }
});

test('검수표 문서가 원본 힌트와 어긋나지 않는다', () => {
  // 윈도우에서 받은 저장소는 줄바꿈이 CRLF일 수 있다. 줄 단위 비교 전에 LF로 맞춘다.
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'practice-hints-review.md'), 'utf8').replace(/\r\n/g, '\n');
  const escape = (s: string) => s.replace(/\|/g, '\\|');
  assert.ok(doc.includes(escape(HINT_GOAL)), '검수표에 목표 문장이 없다 — npm run hints:table');
  // 맨 위(첫 표보다 앞)에 문항 ID를 넣는 방법이 있다(A1).
  const howTo = doc.indexOf('## 승인하는 방법');
  assert.ok(howTo > 0 && howTo < doc.indexOf('|'), '검수표 맨 위에 승인 방법이 없다');
  assert.ok(doc.slice(howTo, doc.indexOf('|')).includes('REVIEWED_QUESTIONS'));
  const reviewed = IDS.filter((id) => PRACTICE_HINTS[id].reviewed).length;
  assert.ok(doc.includes(`검수 완료 ${reviewed}/36`), '검수 완료 수가 다르다 — npm run hints:table');
  for (const id of IDS) {
    const row = doc.split('\n').find((line) => line.startsWith(`| ${id} |`));
    assert.ok(row, `${id} 행이 검수표에 없다 — npm run hints:table`);
    assert.ok(row.includes(escape(PRACTICE_HINTS[id].goal)), `${id}의 목표가 검수표와 다르다 — npm run hints:table`);
    let from = 0;
    for (const c of PRACTICE_HINTS[id].checks) {
      const at = row.indexOf(escape(c.text), from);
      assert.ok(at >= 0, `${id}의 확인 질문이 검수표와 다르다(또는 순서가 다르다) — npm run hints:table`);
      from = at + 1;
    }
    assert.equal(row.includes('✅'), PRACTICE_HINTS[id].reviewed, `${id} 검수 표시가 다르다 — npm run hints:table`);
  }
});

test('99-1 C4(번복): 36문항 모두 승인 — 학생 화면에 문항별 힌트가 나가고, 문구는 논문(M02·부록 2)과 글자까지 같다', () => {
  assert.deepEqual([...REVIEWED_QUESTIONS], IDS);
  for (const q of PRACTICE_QUESTIONS) assert.ok(q.hint, `${idOf(q.level)} 힌트가 화면에 나가지 않는다`);
  // 논문 Ⅳ.1 설계 원리 1과 부록 2 마의 문장
  assert.equal(HINT_GOAL, '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.');
  assert.equal(HINT_CHECK.object, '무엇이 몇 개 있는지 빠짐없이 썼나요?');
  assert.equal(HINT_CHECK.feature, '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?');
  assert.equal(HINT_CHECK.relationStill, '무엇이 어디에 어떻게 놓여 있는지 썼나요?');
  // 1단계는 관계를 대상이 둘 이상인 사진에서만 묻는다(Ⅳ.2.가) — 대상 하나인 사진은 기본으로 관계 질문이 없다.
  for (const id of ['L01', 'L02', 'L03', 'L04', 'L06']) {
    assert.equal(screenHintOf(id)?.checks.some((c) => c.area === 'relation'), false, id);
  }
  assert.equal(screenHintOf('L05')?.checks.some((c) => c.area === 'relation'), true, 'L05 선인장과 화분');
});
