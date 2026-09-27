/**
 * 연구자 검수용 힌트 표를 만든다.
 *
 *   npm run hints:table            → docs/practice-hints-review.md 를 다시 쓴다
 *   node --import tsx scripts/print-practice-hints.mjs --stdout   → 화면에만 찍는다
 *
 * 표의 원본은 src/lib/practice-hints.ts 하나다. 이 스크립트는 그것을 읽어 표로 옮길 뿐
 * 문구를 따로 들고 있지 않는다. 아래 NOTES는 검수 메모로, 학생 화면 코드에 싣지 않으려고
 * 여기에만 둔다(그림에 무엇이 있는지 적혀 있어 정답 단서가 될 수 있다).
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

// tsx가 .ts를 CommonJS로 읽으므로 이름 있는 import 대신 모듈 전체를 받아 꺼낸다.
const pick = (mod) => mod.default ?? mod;
const { PRACTICE_HINTS } = pick(await import('../src/lib/practice-hints.ts'));
const { PRACTICE_QUESTIONS } = pick(await import('../src/lib/questions.ts'));
const { bandOf } = pick(await import('../src/lib/scoring.ts'));

/** 그림을 직접 보고 남긴 검수 메모. 판단이 필요한 곳만 적는다. */
const NOTES = {
  L03: '제목은 "축구공"이나 그림은 가운데를 끈으로 꿰맨 갈색 가죽 공(흔한 축구공 무늬가 아님). 대상 이름으로 무엇까지 인정할지 단서 팩에서 정할 것.',
  L05: '선인장과 화분 두 대상. 흰 점(가시) 있음.',
  L11: '날개를 편 나비 한 마리가 그림을 가득 채움. "날개"라는 말은 힌트에서 뺌(대상 추측 단서).',
  L12: '돌 네 개 가운데 하나는 납작한 판 모양이라 모양 차이도 볼 거리.',
  L17: '왼쪽 위 노란 원(해로 볼 수 있음). B밴드라 시간대는 요구하지 않음.',
  L19: '4차시 공통 안내는 "질감"을 요구하지만 v12 B밴드 범위(배경·행동)에 없어 문항 힌트에서 뺌. 질감을 힌트에 넣을지 결정 필요.',
  L20: '반짝이는 금속 겉면(질감)은 L19와 같은 이유로 힌트에서 뺌. 검은 손잡이·뚜껑 꼭지.',
  L21: '두 팔로 무릎을 감싸고 앉은 자세.',
  L22: '행동이 없는 문항. 배경(풀밭·덤불·하늘)과 뿌리 모양이 볼 거리.',
  L23: '배경은 장소가 아니라 파란 네모와 노란 원. 줄 공책 종이.',
  L24: '장소는 욕실(욕조·타일). 물이 떨어져 바닥에 고임.',
  L26: '비 오는 날 창가. 시간대(낮)를 그림만으로 단정하기 어려워 힌트는 날씨로 안내함.',
  L27: '제목에 없지만 아이 두 명과 벤치가 있음. 밤·눈.',
  L28: '빈 교실, 왼쪽 창으로 햇빛. 아침인지 그림만으로 단정은 어려움 — 빛을 근거로 쓰라고만 안내.',
  L29: '안개 낀 숲길에 토끼 한 마리, 오른쪽에 버섯·통나무.',
  L30: '해 질 무렵 빈 놀이터. 그네·미끄럼틀·흔들 말·모래밭.',
  L32: '시간대 단정 어려움(분홍빛 하늘·불 켜진 창문). 근거를 보고 생각하라고만 안내.',
  L34: '시간대 단정 어려움(연분홍 하늘). 제목은 "오후". 근거를 보고 생각하라고만 안내.',
  L35: '창밖 빛만으로 아침·오후 구분이 어려움. 제목은 "오후".',
};

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const rows = PRACTICE_QUESTIONS.map((q) => {
  const id = `L${String(q.level).padStart(2, '0')}`;
  const draft = PRACTICE_HINTS[id] ?? { hint: null, reviewed: false };
  return {
    id,
    chasi: q.chasi,
    band: bandOf(q.level),
    title: q.koreanTitle,
    hint: draft.hint,
    reviewed: draft.reviewed,
    note: NOTES[id] ?? '',
  };
});

const blank = rows.filter((r) => !r.hint).map((r) => r.id);
const reviewed = rows.filter((r) => r.reviewed).length;

const lines = [
  '# 연습 문항 힌트 검수표',
  '',
  '> 이 파일은 `npm run hints:table`로 만든다. 문구를 고칠 때는 `src/lib/practice-hints.ts`를 고치고 다시 만든다.',
  '',
  '- 초안은 실제 그림(`public/questions/L01~L36.jpg`)을 보고 썼다. 제작 프롬프트를 옮기지 않았다.',
  '- 정답 값(색 이름·개수·대상 이름)은 쓰지 않고 무엇을 써야 하는지만 알려 준다.',
  '- 밴드 범위: A는 대상 이름·기본 색·모양·크기·개수, B는 여기에 배경·행동, C는 여기에 시간대. 분위기는 근거와 함께 쓰라고 안내하되 필수가 아니다.',
  '- **검수(`reviewed: true`)를 마친 문항만 학생 화면에 나간다.** 마치기 전에는 차시 공통 안내가 그대로 나간다.',
  `- 검수 완료 ${reviewed}/${rows.length}. 비워 둔 문항: ${blank.length ? blank.join(', ') : '없음(36장 모두 그림을 보고 쓸 수 있었다)'}.`,
  '',
  '| 문항 | 차시 | 밴드 | 제목 | hint | 검수 | 메모 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${r.chasi} | ${r.band} | ${escapeCell(r.title)} | ${escapeCell(r.hint ?? '(비움)')} | ${r.reviewed ? '✅' : '초안'} | ${escapeCell(r.note)} |`
  ),
  '',
];

const text = lines.join('\n');
if (process.argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  const out = path.join(process.cwd(), 'docs', 'practice-hints-review.md');
  writeFileSync(out, text, 'utf8');
  console.log(`썼다: ${path.relative(process.cwd(), out)} (검수 완료 ${reviewed}/${rows.length})`);
}
