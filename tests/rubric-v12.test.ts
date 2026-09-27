/**
 * 공통 루브릭 v12-2 단일 리소스 테스트 — src/lib/rubric.ts
 *
 * 수준 문언과 운영 규칙은 연구자가 준 문장 그대로여야 한다(요약·의역 금지).
 * 여기 적은 문장이 바뀌면 이 테스트가 깨지도록 원문을 그대로 고정한다.
 * AI 지시문·교사 화면·내보내기 문서가 모두 같은 원본에서 나오는지도 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPERATING_RULES,
  RUBRIC_AREAS,
  RUBRIC_VERSION,
  relationScope,
  renderForExport,
  renderForModel,
  renderForTeacher,
  rubricExportDocument,
} from '@/lib/rubric';
import { AREA_IDS, AREA_LABEL, type Band } from '@/lib/scoring';

const BANDS: Band[] = ['A', 'B', 'C'];

/** 연구자가 준 원문(3영역 × 4수준). 수준 4 → 1 순서. */
const EXPECTED_LEVELS: Record<string, { title: string; short: string; texts: [string, string, string, string] }> = {
  object: {
    title: '대상의 명확성',
    short: '대상',
    texts: [
      '필수 정보표의 핵심 대상을 모두 구별해 표현하고 필요한 수량을 분명히 제시',
      '핵심 대상은 모두 있으나 한 대상의 명칭이 포괄적이거나 수량이 불분명',
      '핵심 대상 일부만 있거나 여러 대상 구별이 어려움',
      '핵심 대상을 식별할 유효한 정보가 없거나 그림과 무관',
    ],
  },
  feature: {
    title: '특징의 구체성',
    short: '특징',
    texts: [
      '필수 속성을 모두 정확히 표현하고 각 속성이 어느 대상의 것인지 분명',
      '대체로 정확하나 한 속성이 빠지거나 대상 연결이 불분명',
      '일부 속성만 있거나 핵심 속성이 잘못 연결됨',
      '유효한 필수 속성이 없거나 모두 그림과 맞지 않음',
    ],
  },
  relation: {
    title: '관계의 명확성',
    short: '관계',
    texts: [
      '필수 정보표의 장소·행동·공간 관계를 정확히 연결해 장면이 분명',
      '대체로 드러나나 한 관계가 빠지거나 참여 대상이 불분명',
      '핵심 관계가 빠지거나 방향·행동 연결이 그림과 다름',
      '유효한 관계 정보가 없거나 모두 무관',
    ],
  },
};

/** 운영 규칙 원문 */
const EXPECTED_RULES = [
  '수량은 대상 영역에서만 판단하고 특징 영역에서 다시 감점하지 않는다.',
  '분위기·느낌은 필수 채점에서 제외한다(표현은 허용, 유무로 수준을 정하지 않음).',
  "'삼각형', '원'처럼 이름이 곧 형태면 대상 영역, '둥근 접시'의 '둥근'은 특징 영역.",
  '두 수준 기술에 모두 해당하면 낮은 수준. 그림과 다른 정보는 빠진 정보보다 무겁게.',
  '핵심 대상이 빠지면 대상 영역만 감점하고, 그 대상의 속성·관계는 evidence_missing으로 표시(새 오류로 세지 않음).',
  '그림에 없는 추가 내용은 감점하지 않음. 맞춤법·띄어쓰기·글 길이·작성 시간은 판단하지 않음.',
  '관계 범위: A밴드(Lv.1~12)는 대상 사이 공간 관계, B·C밴드는 장소와 행동이 필수. C밴드의 시간대·분위기는 선택 정보.',
  '과제별 필수 정보(비공개 단서 팩)가 요구하지 않는 영역은 not_applicable.',
];

/** 옛 v7(5수준·100점 환산)의 흔적. 새 공통 문언에는 없어야 한다. */
const LEGACY_WORDING = ['100점', '배점', '5수준', '수준 5', '총점', '환산 점수', 'objectLevel', 'specificityLevel', 'contextLevel'];

/* ────────────────────────── 버전·구조 ────────────────────────── */

test('공통 루브릭 버전은 v12-2다', () => {
  assert.equal(RUBRIC_VERSION, 'v12-2');
});

test('영역은 3개(대상·특징·관계)이고 순서는 AREA_IDS와 같다', () => {
  assert.equal(RUBRIC_AREAS.length, 3);
  assert.deepEqual(
    RUBRIC_AREAS.map((a) => a.id),
    [...AREA_IDS]
  );
  for (const a of RUBRIC_AREAS) {
    assert.equal(a.short, AREA_LABEL[a.id], '학생 화면의 짧은 이름과 같다');
  }
});

test('각 영역은 4수준(4 → 1)이며 수준 문언은 원문 그대로다', () => {
  for (const a of RUBRIC_AREAS) {
    const want = EXPECTED_LEVELS[a.id];
    assert.ok(want, a.id);
    assert.equal(a.title, want.title);
    assert.equal(a.short, want.short);
    assert.deepEqual(
      a.levels.map((l) => l.level),
      [4, 3, 2, 1]
    );
    assert.deepEqual(
      a.levels.map((l) => l.text),
      want.texts
    );
    for (const l of a.levels) {
      assert.equal(l.text, l.text.trim(), '앞뒤 공백 없이');
      assert.ok(l.text.length > 0);
    }
  }
});

test('운영 규칙은 8개이며 원문 그대로다', () => {
  assert.deepEqual([...OPERATING_RULES], EXPECTED_RULES);
});

test('관계 범위는 밴드마다 다르다 — A 공간 관계, B·C 장소와 행동, C 시간대·분위기 선택', () => {
  assert.ok(relationScope('A').includes('A밴드'));
  assert.ok(relationScope('A').includes('공간 관계'));
  assert.ok(relationScope('B').includes('장소와 행동'));
  assert.ok(relationScope('B').includes('필수'));
  assert.ok(relationScope('C').includes('장소와 행동'));
  assert.ok(relationScope('C').includes('선택 정보'));
  assert.ok(!relationScope('A').includes('장소와 행동'));
  assert.notEqual(relationScope('B'), relationScope('C'));
});

/* ────────────────────────── 한 원본에서 세 형식으로 ────────────────────────── */

function assertContainsAll(text: string, where: string) {
  for (const a of RUBRIC_AREAS) {
    assert.ok(text.includes(a.title), `${where}: ${a.title}`);
    for (const l of a.levels) assert.ok(text.includes(l.text), `${where}: ${a.id} 수준 ${l.level}`);
  }
  for (const r of OPERATING_RULES) assert.ok(text.includes(r), `${where}: 운영 규칙 '${r}'`);
}

function assertNoLegacy(text: string, where: string) {
  for (const w of LEGACY_WORDING) assert.ok(!text.includes(w), `${where}에 옛 v7 문언 '${w}'가 없어야 한다`);
}

test('renderForModel — 세 영역 × 4수준, 운영 규칙, 밴드별 관계 범위를 모두 담는다', () => {
  for (const b of BANDS) {
    const text = renderForModel(b);
    assertContainsAll(text, `renderForModel(${b})`);
    assert.ok(text.includes(relationScope(b)));
    assertNoLegacy(text, `renderForModel(${b})`);
    // 다른 밴드의 관계 범위 문장을 섞지 않는다.
    for (const other of BANDS.filter((x) => x !== b)) {
      assert.ok(!text.includes(relationScope(other)), `${b}에 ${other} 범위가 섞이면 안 된다`);
    }
  }
});

test('renderForTeacher — 버전 v12-2, 세 영역 × 4수준, 운영 규칙, 점수로 환산하지 않는다는 안내', () => {
  for (const b of BANDS) {
    const text = renderForTeacher(b);
    assert.ok(text.includes('v12-2'), '버전');
    assert.ok(text.includes(`${b}밴드`));
    assertContainsAll(text, `renderForTeacher(${b})`);
    assert.ok(text.includes('not_applicable'));
    assert.ok(text.includes('점수로 환산하지 않고 합산하지 않는다'));
    assertNoLegacy(text, `renderForTeacher(${b})`);
  }
});

test('renderForExport — 버전 v12-2, 영역별 표, 운영 규칙, 문항별 단서는 담지 않는다', () => {
  const text = renderForExport();
  assert.ok(text.includes('v12-2'));
  assert.ok(text.startsWith('# 공통 루브릭 v12-2'));
  assertContainsAll(text, 'renderForExport');
  for (const a of RUBRIC_AREAS) {
    for (const l of a.levels) assert.ok(text.includes(`| ${l.level} | ${l.text} |`), `표 행 ${a.id} ${l.level}`);
  }
  assert.ok(text.includes('점수로 환산하거나 합산하지 않는다'));
  assert.ok(text.includes('문항별 필수 정보·앵커를 포함하지 않는다'));
  assertNoLegacy(text, 'renderForExport');
});

test('rubricExportDocument — 파일 이름과 기록에 버전을 넣는다', () => {
  const doc = rubricExportDocument();
  assert.equal(doc.rubricVersion, 'v12-2');
  assert.equal(doc.filename, '공통루브릭_v12-2.md');
  assert.match(doc.mediaType, /^text\/markdown/);
  assert.equal(doc.content, renderForExport());
});

test('세 형식 모두 원본 문장을 한 번씩만 담는다(사본 문언을 따로 두지 않는다)', () => {
  const firstText = RUBRIC_AREAS[0].levels[0].text;
  const count = (s: string, sub: string) => s.split(sub).length - 1;
  assert.equal(count(renderForModel('A'), firstText), 1);
  assert.equal(count(renderForTeacher('A'), firstText), 1);
  assert.equal(count(renderForExport(), firstText), 1);
});
