/**
 * 문항별 힌트(논문 v12, 목표 + 확인 질문) 규칙 시험.
 *
 *   1. L01~L36 모두 초안이 있고 다른 문항 ID는 없다. 목표는 공통 문장 하나다
 *   2. 확인 질문은 규칙대로 만든다 — 단계 초점 영역이 맨 앞(2단계 대상·3단계 특징·4단계 관계),
 *      관계 질문은 A밴드와 B·C밴드가 다르고, C밴드 선택 안내(area: null)는 맨 뒤에 하나만
 *   3. 힌트는 정답 값(숫자·색 이름·개수)을 적지 않는다
 *   4. 검수를 마치지 않은 힌트는 학생 화면(PRACTICE_QUESTIONS.hint)에 나가지 않는다
 *   5. withoutAreas는 그 영역의 질문만 뺀다
 *   6. 예전 초안 문구(그림의 부위를 짚는 문장)는 학생 번들 파일에 남지 않는다
 *   7. 검수표 문서가 원본과 어긋나지 않는다
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  HINT_C_OPTIONAL,
  HINT_CHECK,
  HINT_GOAL,
  PRACTICE_HINTS,
  REVIEWED_QUESTIONS,
  buildHintChecks,
  reviewedHintOf,
  withoutAreas,
  type PracticeHint,
} from '../src/lib/practice-hints';
import { PRACTICE_QUESTIONS } from '../src/lib/questions';
import { AREA_IDS, bandOf } from '../src/lib/scoring';
import { chasiOfLevel, stageFocusArea } from '../src/lib/stages';

const IDS = Array.from({ length: 36 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`);
const levelOf = (id: string) => Number(id.slice(1));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const idOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/** 힌트에 들어간 모든 문장 */
const textsOf = (hint: PracticeHint) => [hint.goal, ...hint.checks.map((c) => c.text)];

test('36개 문항 모두 초안이 있고 목표는 공통 문장이다', () => {
  assert.deepEqual(Object.keys(PRACTICE_HINTS).sort(), IDS);
  assert.equal(HINT_GOAL, '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.');
  for (const id of IDS) {
    const draft = PRACTICE_HINTS[id];
    assert.equal(draft.goal, HINT_GOAL, id);
    assert.equal(typeof draft.reviewed, 'boolean', id);
    assert.ok(draft.checks.length >= 3, `${id} 확인 질문이 모자란다`);
  }
});

test('확인 질문 문구는 정해진 문장뿐이다', () => {
  assert.equal(HINT_CHECK.object, '무엇이 몇 개 있는지 빠짐없이 썼나요?');
  assert.equal(HINT_CHECK.feature, '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?');
  assert.equal(HINT_CHECK.relationA, '서로 어디에 있는지(위·아래·왼쪽·오른쪽) 썼나요?');
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

test('세 영역 질문이 하나씩 있고, 관계 질문은 밴드에 맞는다', () => {
  for (const id of IDS) {
    const level = levelOf(id);
    const checks = PRACTICE_HINTS[id].checks;
    const areaChecks = checks.filter((c) => c.area !== null);
    assert.deepEqual([...areaChecks.map((c) => c.area)].sort(), [...AREA_IDS].sort(), id);
    assert.equal(checks.find((c) => c.area === 'object')?.text, HINT_CHECK.object, id);
    assert.equal(checks.find((c) => c.area === 'feature')?.text, HINT_CHECK.feature, id);
    const relation = checks.find((c) => c.area === 'relation')?.text;
    assert.equal(relation, bandOf(level) === 'A' ? HINT_CHECK.relationA : HINT_CHECK.relationBC, id);
  }
  for (const level of range(1, 12)) assert.equal(bandOf(level), 'A');
  for (const level of range(13, 24)) assert.equal(bandOf(level), 'B');
  for (const level of range(25, 36)) assert.equal(bandOf(level), 'C');
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
    if (bandOf(levelOf(id)) === 'C') {
      assert.equal(optional.length, 1, id);
      assert.deepEqual(checks[checks.length - 1], { area: null, text: HINT_C_OPTIONAL }, id);
      assert.match(checks[checks.length - 1].text, /무엇을 보고 그렇게 느꼈는지/);
      assert.equal(checks.length, 4, id);
    } else {
      assert.equal(optional.length, 0, `${id}는 C밴드가 아니다`);
      assert.equal(checks.length, 3, id);
      for (const t of textsOf(PRACTICE_HINTS[id])) {
        assert.equal(/분위기|언제/.test(t), false, `${id}에 시간대·분위기 안내가 있다`);
      }
    }
  }
});

test('힌트는 정답 값(숫자·색 이름·개수)을 적지 않는다', () => {
  const colors = [
    '빨간', '빨강', '노란', '노랑', '파란', '파랑', '초록', '녹색', '갈색', '주황', '보라', '회색',
    '흰', '하얀', '검은', '검정', '까만', '은색', '금색', '분홍', '하늘색',
  ];
  const counts = [
    '한 개', '두 개', '세 개', '네 개', '다섯', '여섯', '하나', '둘', '셋', '넷',
    '한 마리', '두 마리', '세 마리', '한 명', '두 명', '세 명', '두 아이', '한 켤레', '한 쌍',
  ];
  for (const id of IDS) {
    for (const t of textsOf(PRACTICE_HINTS[id])) {
      assert.equal(/[0-9０-９]/.test(t), false, `${id}에 숫자가 있다: ${t}`);
      for (const word of [...colors, ...counts]) {
        assert.equal(t.includes(word), false, `${id}에 "${word}"가 있다: ${t}`);
      }
    }
  }
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
  assert.equal(noRelation.goal, HINT_GOAL);
  assert.deepEqual(noRelation.checks, c.checks.filter((x) => x.area !== 'relation'));
  assert.deepEqual(noRelation.checks.map((x) => x.area), ['object', 'feature', null]);
  // 영역에 딸리지 않은 C밴드 선택 안내는 남는다.
  assert.equal(noRelation.checks[noRelation.checks.length - 1].text, HINT_C_OPTIONAL);

  const b = PRACTICE_HINTS.L13; // B밴드, 4단계 — 관계가 맨 앞
  assert.deepEqual(withoutAreas(b, ['feature']).checks.map((x) => x.area), ['relation', 'object']);
  assert.deepEqual(withoutAreas(b, ['feature', 'relation']).checks.map((x) => x.area), ['object']);

  const a = PRACTICE_HINTS.L01;
  assert.deepEqual(withoutAreas(a, []).checks, a.checks);
  // 원본은 바뀌지 않는다.
  assert.deepEqual(a.checks.map((x) => x.area), ['object', 'feature', 'relation']);
  assert.deepEqual(PRACTICE_HINTS.L31.checks.map((x) => x.area), ['object', 'feature', 'relation', null]);
});

test('예전 초안 문구는 학생 번들 파일(practice-hints.ts)에 남지 않는다', () => {
  const src = readFileSync(path.join(process.cwd(), 'src', 'lib', 'practice-hints.ts'), 'utf8');
  assert.equal(src.includes('살펴봐요'), false, 'practice-hints.ts에 예전 초안의 "살펴봐요"가 남아 있다');

  // 예전 초안 36개는 검수표 스크립트에만 참고용으로 남는다. 그 문장이 하나도 학생 번들 파일에 없어야 한다.
  const script = readFileSync(path.join(process.cwd(), 'scripts', 'print-practice-hints.mjs'), 'utf8');
  const mood = /const LEGACY_MOOD = '([^']+)';/.exec(script)?.[1];
  assert.ok(mood, '검수표 스크립트에 LEGACY_MOOD가 없다');
  const block = /const LEGACY_DRAFTS = \{\n([\s\S]*?)\n\};/.exec(script)?.[1];
  assert.ok(block, '검수표 스크립트에 LEGACY_DRAFTS가 없다');
  const drafts = [...block.matchAll(/^\s*(L\d{2}): [`'](.+)[`'],$/gm)].map(([, id, body]) => ({
    id,
    text: body.replace('${LEGACY_MOOD}', mood),
  }));
  assert.deepEqual(drafts.map((d) => d.id), IDS, '검수표 스크립트의 예전 초안이 36개가 아니다');
  for (const d of drafts) {
    for (const sentence of d.text.split(/(?<=\.)\s+/)) {
      assert.equal(src.includes(sentence), false, `practice-hints.ts에 ${d.id} 예전 문장이 남아 있다: ${sentence}`);
    }
  }
  assert.ok(drafts[0].text.includes('살펴봐요'));
});

test('검수표 문서가 원본 힌트와 어긋나지 않는다', () => {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'practice-hints-review.md'), 'utf8');
  const escape = (s: string) => s.replace(/\|/g, '\\|');
  assert.ok(doc.includes(escape(HINT_GOAL)), '검수표에 목표 문장이 없다 — npm run hints:table');
  const reviewed = IDS.filter((id) => PRACTICE_HINTS[id].reviewed).length;
  assert.ok(doc.includes(`검수 완료 ${reviewed}/36`), '검수 완료 수가 다르다 — npm run hints:table');
  for (const id of IDS) {
    const row = doc.split('\n').find((line) => line.startsWith(`| ${id} |`));
    assert.ok(row, `${id} 행이 검수표에 없다 — npm run hints:table`);
    let from = 0;
    for (const c of PRACTICE_HINTS[id].checks) {
      const at = row.indexOf(escape(c.text), from);
      assert.ok(at >= 0, `${id}의 확인 질문이 검수표와 다르다(또는 순서가 다르다) — npm run hints:table`);
      from = at + 1;
    }
    assert.equal(row.includes('✅'), PRACTICE_HINTS[id].reviewed, `${id} 검수 표시가 다르다 — npm run hints:table`);
  }
});
