/**
 * 연습 6단계 배치 테스트(논문 v12) — src/lib/stages.ts, src/lib/questions.ts
 *
 * 문항 ID와 이미지는 그대로 두고 단계(chasi)와 제시 순서만 바뀐다.
 * 밴드(bandOf)는 문항 번호로 정하며 단계와 무관하다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STAGES, STAGE_TITLE, chasiOfLevel, presentationOrderOf, stageFocusArea } from '@/lib/stages';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { bandOf } from '@/lib/scoring';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 요청 B의 배치표 */
const EXPECTED: Array<{ chasi: number; title: string; levels: number[]; focus: string | null }> = [
  { chasi: 1, title: '도구와 작성 방식 이해', levels: range(1, 6), focus: null },
  { chasi: 2, title: '대상과 수량', levels: range(7, 12), focus: 'object' },
  { chasi: 3, title: '특징 구체화', levels: range(19, 24), focus: 'feature' },
  { chasi: 4, title: '관계 표현', levels: range(13, 18), focus: 'relation' },
  { chasi: 5, title: '피드백 검토와 재작성', levels: range(25, 30), focus: null },
  { chasi: 6, title: '종합 작성', levels: range(31, 36), focus: null },
];

test('6단계의 이름·문항·초점 영역이 배치표와 같다', () => {
  assert.equal(STAGES.length, 6);
  for (const want of EXPECTED) {
    const s = STAGES.find((x) => x.chasi === want.chasi);
    assert.ok(s, `단계 ${want.chasi}`);
    assert.equal(s.title, want.title);
    assert.deepEqual(s.levels, want.levels);
    assert.equal(s.focus, want.focus);
    assert.equal(STAGE_TITLE[want.chasi], want.title);
  }
});

test('문항 번호 → 단계: L01–06→1, L07–12→2, L19–24→3, L13–18→4, L25–30→5, L31–36→6', () => {
  const want = (lv: number) => {
    if (lv <= 6) return 1;
    if (lv <= 12) return 2;
    if (lv <= 18) return 4;
    if (lv <= 24) return 3;
    if (lv <= 30) return 5;
    return 6;
  };
  for (let lv = 1; lv <= 36; lv++) assert.equal(chasiOfLevel(lv), want(lv), `L${lv}`);
  // 경계 확인
  assert.equal(chasiOfLevel(12), 2);
  assert.equal(chasiOfLevel(13), 4);
  assert.equal(chasiOfLevel(18), 4);
  assert.equal(chasiOfLevel(19), 3);
  assert.equal(chasiOfLevel(24), 3);
  assert.equal(chasiOfLevel(25), 5);
});

test('없는 문항 번호는 단계·제시 순서가 null이다(지어내지 않는다)', () => {
  for (const lv of [0, 37, -1, 1.5, NaN]) {
    assert.equal(chasiOfLevel(lv), null, String(lv));
    assert.equal(presentationOrderOf(lv), null, String(lv));
  }
});

test('모든 문항이 정확히 한 단계에 한 번씩 들어간다', () => {
  const all = STAGES.flatMap((s) => s.levels);
  assert.equal(all.length, 36);
  assert.deepEqual([...all].sort((a, b) => a - b), range(1, 36));
  for (const s of STAGES) assert.equal(s.levels.length, 6, `단계 ${s.chasi}`);
});

test('제시 순서 — L01..L12, L19..L24, L13..L18, L25..L36', () => {
  const order = [...range(1, 12), ...range(19, 24), ...range(13, 18), ...range(25, 36)];
  order.forEach((lv, i) => assert.equal(presentationOrderOf(lv), i + 1, `L${lv}`));
  // 3단계 문항(L19)이 4단계 문항(L13)보다 먼저 나온다.
  assert.ok((presentationOrderOf(19) as number) < (presentationOrderOf(13) as number));
  assert.ok((presentationOrderOf(24) as number) < (presentationOrderOf(13) as number));
  assert.ok((presentationOrderOf(18) as number) < (presentationOrderOf(25) as number));
});

test('단계 초점 영역 — 2 대상, 3 특징, 4 관계, 1·5·6과 알 수 없는 단계는 null', () => {
  assert.equal(stageFocusArea(1), null);
  assert.equal(stageFocusArea(2), 'object');
  assert.equal(stageFocusArea(3), 'feature');
  assert.equal(stageFocusArea(4), 'relation');
  assert.equal(stageFocusArea(5), null);
  assert.equal(stageFocusArea(6), null);
  assert.equal(stageFocusArea(0), null);
  assert.equal(stageFocusArea(7), null);
  assert.equal(stageFocusArea(null), null);
  assert.equal(stageFocusArea(undefined), null);
});

test('밴드는 단계와 무관하게 문항 번호로 정한다 — A=L01–12, B=L13–24, C=L25–36', () => {
  for (let lv = 1; lv <= 36; lv++) {
    assert.equal(bandOf(lv), lv <= 12 ? 'A' : lv <= 24 ? 'B' : 'C', `L${lv}`);
  }
  // 3단계(L19–24)와 4단계(L13–18)는 모두 B밴드다.
  for (const lv of STAGES.find((s) => s.chasi === 3)!.levels) assert.equal(bandOf(lv), 'B');
  for (const lv of STAGES.find((s) => s.chasi === 4)!.levels) assert.equal(bandOf(lv), 'B');
  for (const lv of STAGES.find((s) => s.chasi === 5)!.levels) assert.equal(bandOf(lv), 'C');
  // D1: 밴드 A = 1·2단계, B = 3·4단계, C = 5·6단계
  const bandOfStage = (chasi: number) => new Set(STAGES.find((s) => s.chasi === chasi)!.levels.map(bandOf));
  assert.deepEqual([...bandOfStage(1)], ['A']);
  assert.deepEqual([...bandOfStage(2)], ['A']);
  assert.deepEqual([...bandOfStage(3)], ['B']);
  assert.deepEqual([...bandOfStage(4)], ['B']);
  assert.deepEqual([...bandOfStage(5)], ['C']);
  assert.deepEqual([...bandOfStage(6)], ['C']);
});

test('PRACTICE_QUESTIONS — 36문항이 제시 순서로 정렬되고 단계·이미지·ID는 문항 번호를 따른다', () => {
  assert.equal(PRACTICE_QUESTIONS.length, 36);
  PRACTICE_QUESTIONS.forEach((q, i) => {
    assert.equal(q.order, i + 1);
    assert.equal(q.order, presentationOrderOf(q.level));
    assert.equal(q.chasi, chasiOfLevel(q.level));
    // 이미지 파일은 문항 번호 그대로다(단계가 바뀌어도 이미지를 옮기지 않는다).
    assert.equal(q.imageUrl, `/questions/L${String(q.level).padStart(2, '0')}.jpg`);
    assert.ok(q.rubric.length > 0, '단계 공통 안내');
  });
  assert.deepEqual(
    PRACTICE_QUESTIONS.map((q) => q.level),
    [...range(1, 12), ...range(19, 24), ...range(13, 18), ...range(25, 36)]
  );
  // 같은 단계는 같은 공통 안내를 쓴다.
  for (const s of STAGES) {
    const guides = new Set(PRACTICE_QUESTIONS.filter((q) => q.chasi === s.chasi).map((q) => q.rubric));
    assert.equal(guides.size, 1, `단계 ${s.chasi}`);
  }
});

test('단계 공통 안내에 정답 값(개수 숫자)이나 점수 문언이 없다', () => {
  for (const q of PRACTICE_QUESTIONS) {
    assert.ok(!/\d/.test(q.rubric), `L${q.level}: 숫자가 없어야 한다`);
    assert.ok(!/점수|100점|배점/.test(q.rubric), `L${q.level}`);
  }
});
