/**
 * 연구자 검수용 힌트 표를 만든다(논문 v12-2: 목표 + 확인 질문).
 *
 *   npm run hints:table            → docs/practice-hints-review.md 를 다시 쓴다
 *   node --import tsx scripts/print-practice-hints.mjs --stdout   → 화면에만 찍는다
 *
 * 표의 원본은 src/lib/practice-hints.ts 하나다. 새 힌트 문구는 이 스크립트가 따로 들고 있지 않는다.
 * 여기에는 A밴드(L01–L12) 관계 판단(해당 없음인지)만 문항 ID로 둔다.
 *
 * 그림을 묘사한 자료(예전 문항별 힌트 초안, A밴드 관계 판단의 까닭, 그림 확인 메모)는 정답 단서가 될 수 있어
 * 공개 저장소에 두지 않는다. 연구자가 비공개로 보관하는 hint-review-notes.json에 있고,
 *   node --import tsx scripts/print-practice-hints.mjs --private <그 파일이 있는 폴더>
 * 로 돌리면 참고 열이 붙은 비공개 검수표(practice-hints-review-private.md)를 그 폴더에 따로 쓴다.
 * 공개 검수표(docs/practice-hints-review.md)에는 어떤 경우에도 그 자료를 싣지 않는다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// tsx가 .ts를 CommonJS로 읽으므로 이름 있는 import 대신 모듈 전체를 받아 꺼낸다.
const pick = (mod) => mod.default ?? mod;
const { PRACTICE_HINTS, HINT_GOAL, HINT_CHECK, HINT_C_OPTIONAL, STAGE_GOAL } = pick(
  await import('../src/lib/practice-hints.ts')
);
const { RELATION_NOT_APPLICABLE_QUESTIONS, STILL_SCENE_QUESTIONS, defaultNotApplicableAreas } = pick(
  await import('../src/lib/question-areas.ts')
);
const { PRACTICE_QUESTIONS } = pick(await import('../src/lib/questions.ts'));
const { AREA_LABEL, bandOf } = pick(await import('../src/lib/scoring.ts'));
const { STAGES, STAGE_TITLE, stageFocusArea } = pick(await import('../src/lib/stages.ts'));

/**
 * A밴드(L01–L12) 관계 판단 — "서로 어디에 있는지"는 대상이 둘 이상일 때만 뜻이 있다.
 * 그림(public/questions/L01~L12.jpg)을 직접 보고 나눴다. 까닭은 비공개 hint-review-notes.json(aRelationWhy)에 있다.
 * 해당 없음 목록은 src/lib/question-areas.ts의 RELATION_NOT_APPLICABLE_QUESTIONS와 같아야 한다(아래에서 확인한다).
 */
const A_RELATION_NA = ['L01', 'L02', 'L03', 'L04', 'L06', 'L08', 'L11'];
const A_RELATION_APPLIES = ['L05', 'L07', 'L09', 'L10', 'L12'];

/** --private <폴더>: 비공개 참고 자료를 읽어 참고 열이 붙은 검수표를 그 폴더에 따로 쓴다. */
const privateAt = process.argv.indexOf('--private');
const privateDir = privateAt >= 0 ? process.argv[privateAt + 1] : '';
if (privateAt >= 0 && !privateDir) throw new Error('--private 뒤에 hint-review-notes.json이 있는 폴더를 적는다');
const PRIVATE = privateDir
  ? (() => {
      const file = path.join(privateDir, 'hint-review-notes.json');
      if (!existsSync(file)) throw new Error(`비공개 참고 자료가 없다: ${file}`);
      return JSON.parse(readFileSync(file, 'utf8'));
    })()
  : null;

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

/** 확인 질문 칸 — 순서대로, 단계 초점 영역은 굵게 '초점'으로 표시. 기본 해당 없음 영역은 취소선과 표시 */
function renderChecks(checks, focus, skip) {
  return checks
    .map((c, i) => {
      const n = CIRCLED[i] ?? `${i + 1}.`;
      if (c.area === null) return `${n} (선택) ${escapeCell(c.text)}`;
      const label = AREA_LABEL[c.area];
      const tag = c.area === focus ? `**[${label}·초점]**` : `[${label}]`;
      if (skip.includes(c.area)) return `${n} ${tag} ~~${escapeCell(c.text)}~~ (기본 해당 없음 — 화면에서 빠짐)`;
      return `${n} ${tag} ${escapeCell(c.text)}`;
    })
    .join('<br>');
}

function renderMemo(id, withPrivate) {
  const parts = [];
  const why = withPrivate ? PRIVATE.aRelationWhy?.[id] : '';
  const tail = why ? ` — ${why}` : '';
  if (A_RELATION_NA.includes(id)) parts.push(`**관계: 기본 해당 없음**${tail}`);
  if (A_RELATION_APPLIES.includes(id)) parts.push(`관계: 판정 거리 있음${tail}`);
  if (STILL_SCENE_QUESTIONS.includes(id)) parts.push('관계 질문: 놓인 모양(물건·풍경).');
  if (id === 'L20' || id === 'L23') parts.push('**관계: 기본 해당 없음** — 추상 도형 배경이라 장소를 알 수 없음(단서 팩이 있으면 단서 팩이 우선).');
  if (withPrivate && PRIVATE.notes?.[id]) parts.push(PRIVATE.notes[id]);
  return escapeCell(parts.join(' / '));
}

const rows = PRACTICE_QUESTIONS.map((q) => {
  const id = `L${String(q.level).padStart(2, '0')}`;
  const draft = PRACTICE_HINTS[id];
  if (!draft) throw new Error(`힌트 초안이 없는 문항: ${id}`);
  const focus = stageFocusArea(q.chasi);
  return {
    id,
    stage: `${q.chasi} · ${STAGE_TITLE[q.chasi]}`,
    band: bandOf(q.level),
    goal: draft.goal,
    checks: renderChecks(draft.checks, focus, defaultNotApplicableAreas(id)),
    reviewed: draft.reviewed,
    legacy: PRIVATE?.legacy?.[id] ?? '',
    memo: renderMemo(id, false),
    privateMemo: PRIVATE ? renderMemo(id, true) : '',
  };
});

if (PRIVATE) {
  const missingLegacy = rows.filter((r) => !r.legacy).map((r) => r.id);
  if (missingLegacy.length) throw new Error(`예전 초안이 없는 문항: ${missingLegacy.join(', ')}`);
}

const reviewedIds = rows.filter((r) => r.reviewed).map((r) => r.id);
const naCandidates = A_RELATION_NA;
const naA = RELATION_NOT_APPLICABLE_QUESTIONS.filter((id) => Number(id.slice(1)) <= 12);
if (naCandidates.join(',') !== naA.join(',')) {
  throw new Error(`A_RELATION_NA의 해당 없음(${naCandidates.join(',')})이 RELATION_NOT_APPLICABLE_QUESTIONS의 A밴드와 다르다`);
}
const relationApplies = A_RELATION_APPLIES;
const stageLine = (s) => {
  const ids = s.levels.map((l) => `L${String(l).padStart(2, '0')}`);
  const focus = s.focus ? `${AREA_LABEL[s.focus]} 질문을 맨 앞에` : '대상 → 특징 → 관계';
  return `| ${s.chasi} | ${s.title} | ${ids[0]}–${ids[ids.length - 1]} | ${focus} |`;
};

const lines = [
  '# 연습 문항 힌트 검수표',
  '',
  '> 이 파일은 `npm run hints:table`(scripts/print-practice-hints.mjs)로 만든다. 손으로 고치지 않는다.',
  '> 힌트 문구의 원본은 `src/lib/practice-hints.ts` 하나이며, 36문항 모두 같은 규칙으로 만든다(문항별로 손으로 쓰지 않는다).',
  '',
  `검수 완료 ${reviewedIds.length}/${rows.length}${reviewedIds.length ? ` (${reviewedIds.join(', ')})` : ''}.`,
  '',
  '## 승인하는 방법 — 문항 ID를 넣는다',
  '',
  '1. 아래 표에서 문항의 목표·확인 질문을 실제 그림(`public/questions/Lxx.jpg`)과 견주어 본다.',
  '2. 승인할 문항 ID를 `src/lib/practice-hints.ts`의 `REVIEWED_QUESTIONS`에 더한다(넣은 문항만 학생 화면에 나간다).',
  '',
  '   ```ts',
  "   export const REVIEWED_QUESTIONS: readonly string[] = ['L01', 'L02'];",
  '   ```',
  '',
  '3. `npm run hints:table`로 이 표를 다시 만들고 `npm test`를 돌린다(`tests/hints.test.ts`가 표와 원본이 맞는지 본다).',
  '4. 커밋해 `main`에 올린다. 36개를 모두 켠 미리 보기 판은 별도 브랜치에만 둔다(`main`에 올리지 않는다).',
  '',
  '- **`REVIEWED_QUESTIONS`에 들어간 문항의 힌트만 학생 화면에 나간다.** 들어가기 전에는 단계 공통 안내(`src/lib/questions.ts`의 `GUIDE`)가 나간다.',
  '- 문구 자체를 바꾸려면 `HINT_GOAL`·`STAGE_GOAL`·`HINT_CHECK`·`HINT_C_OPTIONAL`을 고친다. 36문항에 함께 바뀐다.',
  '- 관계 질문의 문항별 예외와 관계 해당 없음 문항은 `src/lib/question-areas.ts` 한 곳에서 정한다.',
  '- 그 밖에 그림에 맞지 않는 영역 질문이 있으면 비공개 단서 팩(`RESEARCH_ASSET_DIR/cue-pack.json`)에서 그 영역을 해당 없음으로 정한다.',
  '  채점에서 그 영역이 해당 없음이 되고 학생 화면에서도 그 질문이 빠진다(`withoutAreas`). 이 표는 단서 팩을 모른다.',
  '- 힌트는 정답 값(대상 이름·색 이름·개수)과 그림의 특정 부위를 말하지 않는다(`tests/hints.test.ts`가 36문항 전부를 본다).',
  '',
  '## 힌트 구성 (루브릭 v12-2)',
  '',
  `- **목표** = 공통 문장 + 단계별 둘째 문장. 공통: ${HINT_GOAL}`,
  ...Object.entries(STAGE_GOAL).map(([chasi, text]) => `  - ${chasi}단계: ${text}`),
  '- **확인 질문**: 영역마다 한 문장, 그 문항에서 판정하는 영역만.',
  `  - 대상: ${HINT_CHECK.object}`,
  `  - 특징(1·2·4·5·6단계): ${HINT_CHECK.feature}`,
  `  - 특징(3단계 L19–L24): ${HINT_CHECK.featureStage3}`,
  `  - 관계(A밴드 L01–L12): ${HINT_CHECK.relationA}`,
  `  - 관계(물건·풍경 ${STILL_SCENE_QUESTIONS.join(', ')}): ${HINT_CHECK.relationStill}`,
  `  - 관계(그 밖의 B·C밴드, 사람·동물): ${HINT_CHECK.relationBC}`,
  `  - 관계 기본 해당 없음(${RELATION_NOT_APPLICABLE_QUESTIONS.join(', ')}): 화면에서 관계 질문이 빠진다. 단서 팩이 있으면 단서 팩이 우선한다`,
  '    (대상이 하나인 A밴드 그림, 장소를 알 수 없는 L20·L23). 표에는 ~~취소선~~으로 남겨 둔다.',
  `  - C밴드(L25–L36) 선택 안내(영역 없음, 맨 뒤): ${HINT_C_OPTIONAL}`,
  '- 단계 초점 영역의 질문을 맨 앞에 둔다. 표의 **[영역·초점]** 표시가 그것이다.',
  '',
  '| 단계 | 이름 | 문항 | 확인 질문 순서 |',
  '|---|---|---|---|',
  ...STAGES.map(stageLine),
  '',
  '밴드는 문항 번호로 정한다(A=L01–L12, B=L13–L24, C=L25–L36). 그래서 4단계(관계, L13–L18)는 B밴드, 3단계(특징, L19–L24)도 B밴드다.',
  '',
  '## A밴드 관계 판단',
  '',
  `A밴드 관계 질문 "${HINT_CHECK.relationA}"는 대상이 둘 이상일 때만 뜻이 있다. 그림을 보고 나눈 결과:`,
  '',
  `- **관계 기본 해당 없음(대상 하나)**: ${naCandidates.join(', ')} — 단서 팩이 없으면 채점에서 관계가 not_applicable이고 화면에 관계 질문이 없다.`,
  `- 관계를 판정할 거리가 있음: ${relationApplies.join(', ')}`,
  '',
  '## 문항별 표 (제시 순서)',
  '',
  '| 문항 | 단계(번호·이름) | 밴드 | 목표 | 확인 질문(순서대로, 초점 영역 표시) | 검수 | 메모 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${escapeCell(r.stage)} | ${r.band} | ${escapeCell(r.goal)} | ${r.checks} | ${r.reviewed ? '✅' : '초안'} | ${r.memo} |`
  ),
  '',
  '예전 문항별 힌트 초안과 그림 확인 메모는 정답 단서가 될 수 있어 이 표에 싣지 않는다(연구자 비공개 보관).',
  '',
];

const text = lines.join('\n');
if (PRIVATE) {
  // 비공개 검수표: 공개 표의 머리 부분 + 참고 열이 붙은 문항별 표. 저장소 밖 폴더에만 쓴다.
  const head = lines.slice(0, lines.indexOf('## 문항별 표 (제시 순서)'));
  const privateText = [
    ...head,
    '## 문항별 표 (비공개 — 공개 저장소에 올리지 않는다)',
    '',
    '| 문항 | 단계(번호·이름) | 밴드 | 목표 | 확인 질문 | 검수 | 예전 초안(참고) | 메모 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${escapeCell(r.stage)} | ${r.band} | ${escapeCell(r.goal)} | ${r.checks} | ${r.reviewed ? '✅' : '초안'} | ${escapeCell(r.legacy)} | ${r.privateMemo} |`
    ),
    '',
    '예전 초안(참고) 열은 논문 v12 1차 문항별 힌트다. 그림의 부위·볼 거리를 짚어 학생 화면에서는 더 쓰지 않는다.',
    '단서 팩의 필수 단서를 정할 때 참고만 한다.',
    '',
  ].join('\n');
  const privateOut = path.join(privateDir, 'practice-hints-review-private.md');
  writeFileSync(privateOut, privateText, 'utf8');
  console.log(`썼다(비공개): ${privateOut}`);
}

if (process.argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  const out = path.join(process.cwd(), 'docs', 'practice-hints-review.md');
  writeFileSync(out, text, 'utf8');
  console.log(`썼다: ${path.relative(process.cwd(), out)} (검수 완료 ${reviewedIds.length}/${rows.length})`);
}
