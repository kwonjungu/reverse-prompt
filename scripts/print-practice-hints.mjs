/**
 * 연구자 검수용 힌트 표를 만든다(논문 v12-2: 목표 + 확인 질문).
 *
 *   npm run hints:table            → docs/practice-hints-review.md 를 다시 쓴다
 *   node --import tsx scripts/print-practice-hints.mjs --stdout   → 화면에만 찍는다
 *
 * 표의 원본은 src/lib/practice-hints.ts 하나다. 새 힌트 문구는 이 스크립트가 따로 들고 있지 않는다.
 * 여기에만 두는 것은 세 가지이며, 모두 학생 화면 코드에 싣지 않으려고 이 파일에 둔다
 * (그림에 무엇이 있는지·어느 부위를 볼지 적혀 있어 정답 단서가 될 수 있다).
 *   - LEGACY_DRAFTS  예전(논문 v12 1차) 문항별 힌트 초안. 검수표의 참고 열로만 쓴다. 문구를 고치지 않는다.
 *   - A_RELATION     A밴드(L01–L12) 관계 질문이 그 그림에 맞는지 그림을 보고 적은 판단
 *   - NOTES          그림을 직접 보고 남긴 검수 메모
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

// tsx가 .ts를 CommonJS로 읽으므로 이름 있는 import 대신 모듈 전체를 받아 꺼낸다.
const pick = (mod) => mod.default ?? mod;
const { PRACTICE_HINTS, HINT_GOAL, HINT_CHECK, HINT_C_OPTIONAL } = pick(await import('../src/lib/practice-hints.ts'));
const { PRACTICE_QUESTIONS } = pick(await import('../src/lib/questions.ts'));
const { AREA_LABEL, bandOf } = pick(await import('../src/lib/scoring.ts'));
const { STAGES, STAGE_TITLE, stageFocusArea } = pick(await import('../src/lib/stages.ts'));

/**
 * 예전(논문 v12 1차) 문항별 힌트 초안. 학생 화면에는 더 쓰지 않고 검수표의 참고 열로만 남긴다.
 * 그림을 보고 쓴 문구라 특정 부위·볼 거리를 짚는다. 새 힌트(목표 + 확인 질문)는 정답 값·부위를 말하지 않는다.
 * 문구는 옛 src/lib/practice-hints.ts에서 그대로 옮겼다(고치지 않는다).
 */
const LEGACY_MOOD = '분위기를 쓴다면 무엇을 보고 그렇게 느꼈는지도 써요.';
const LEGACY_DRAFTS = {
  L01: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 어떤 색이고 어떤 모양인지도 함께 써요. 위쪽에 붙은 작은 부분도 살펴봐요.',
  L02: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 어떤 색인지, 펼쳐져 있는지 접혀 있는지도 함께 써요. 손잡이 쪽도 살펴봐요.',
  L03: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 어떤 색이고 어떤 모양인지도 함께 써요. 가운데를 꿰맨 줄은 어떤 색인지도 살펴봐요.',
  L04: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 어떤 색이고 어떤 모양인지도 함께 써요. 길게 뻗은 부분과 손잡이도 살펴봐요.',
  L05: '무엇이 무엇에 담겨 있는지 써 봐요. 담긴 것과 담은 것이 각각 어떤 색이고 어떤 모양인지도 함께 써요.',
  L06: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 어떤 색인지, 위쪽 머리 부분은 어떤 모양인지도 함께 써요.',
  L07: '무엇이 몇 개 있는지 써 봐요. 어떤 색인지, 크기가 서로 어떻게 다른지도 함께 써요.',
  L08: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 겉에 어떤 무늬가 있는지, 그 무늬에 어떤 색들이 있는지도 함께 써요.',
  L09: '무엇이 몇 개 있는지 써 봐요. 각각 어떤 색인지, 키와 굵기가 서로 어떻게 다른지도 함께 써요.',
  L10: '무엇이 몇 개 있는지 세어 봐요. 어떤 모양이고 어떤 색인지도 함께 써요.',
  L11: '무엇이 몇 마리 있는지 써 봐요. 어떤 색이고 어떤 모양인지, 그림 안에서 얼마나 크게 보이는지도 함께 써요.',
  L12: '무엇이 몇 개 있는지 세어 봐요. 어떤 색인지, 크기와 모양이 서로 어떻게 다른지도 함께 써요.',
  L13: '어떤 동물이 몇 마리 있는지, 어떤 색인지 써 봐요. 그 동물이 무엇을 하고 있는지, 어디에 있는지도 함께 써요.',
  L14: '어떤 동물이 몇 마리 있는지, 어떤 색인지 써 봐요. 무엇 위에서 무엇을 하고 있는지도 함께 써요.',
  L15: '어떤 동물이 몇 마리 있는지, 어떤 색인지 써 봐요. 무엇을 하고 있는지, 어떤 곳에 있는지도 함께 써요. 곁에 있는 것도 살펴봐요.',
  L16: '사람이 몇 명 있는지, 무엇을 하고 있는지 써 봐요. 어떤 자세인지, 옷은 어떤 색인지도 함께 써요. 곁에 있는 가구와 물건도 살펴봐요.',
  L17: '어떤 동물이 몇 마리 있는지, 어떤 색인지 써 봐요. 몸과 다리가 어떤지 보고 무엇을 하고 있는지 써요. 뒤쪽 배경은 어떤 색인지도 살펴봐요.',
  L18: '사람이 몇 명 있는지, 무엇을 하고 있는지 써 봐요. 날씨가 어떤지, 무엇을 입고 무엇을 들고 있는지, 각각 어떤 색인지도 함께 써요.',
  L19: '어떤 동물이 몇 마리 있는지, 어떤 색인지 써 봐요. 어떤 자세로 무엇을 하고 있는지, 무엇 위에 있는지도 함께 써요.',
  L20: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 몸통과 손잡이가 각각 어떤 색이고 어떤 모양인지, 무엇 위에 놓여 있는지도 함께 써요.',
  L21: '사람이 몇 명 있는지, 어떤 자세로 무엇을 하고 있는지 써 봐요. 어디에 있는지, 옷과 신발은 어떤 색인지도 함께 써요.',
  L22: '그림 가운데에 무엇이 있는지, 어떤 색인지 써 봐요. 아래쪽은 어떤 모양인지, 주변 땅과 뒤쪽에 무엇이 있는지도 함께 써요.',
  L23: '그림 속 물건이 무엇이고 몇 개인지 써 봐요. 무엇으로 만들었는지, 겉이 반듯한지 아닌지도 함께 써요. 뒤쪽 배경에 어떤 색과 모양이 있는지도 살펴봐요.',
  L24: '그림 속 물건이 무엇이고 어떤 색인지 써 봐요. 어디에 어떤 상태로 있는지, 그 아래 바닥에는 무엇이 있는지도 함께 써요. 여기가 어떤 곳인지도 살펴봐요.',
  L25: `여기가 어떤 곳인지, 하루 중 언제쯤인지 써 봐요. 하늘과 물이 어떤 색인지, 모래 위와 물가에 무엇이 몇 개 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L26: `창밖 날씨가 어떤지, 창가에 무엇이 몇 개 있는지 써 봐요. 창가의 동물은 어떤 색이고 무엇을 하고 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L27: `하루 중 언제인지, 날씨가 어떤지 써 봐요. 무엇이 빛을 비추고 있는지, 사람이 몇 명이고 무엇을 하고 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L28: `여기가 어떤 곳인지, 사람이 있는지 써 봐요. 빛이 어디로 들어오는지 보고 하루 중 언제쯤인지, 무엇이 놓여 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L29: `여기가 어떤 곳인지, 하루 중 언제쯤인지 써 봐요. 멀리까지 또렷하게 보이는지, 길 위에 어떤 동물이 몇 마리 있고 무엇을 하는지도 함께 써요. ${LEGACY_MOOD}`,
  L30: `여기가 어떤 곳인지, 하늘 색을 보고 하루 중 언제쯤인지 써 봐요. 무엇들이 놓여 있는지, 사람이 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L31: `사람과 동물이 각각 몇인지, 어디에서 무엇을 하고 있는지 써 봐요. 하늘을 보고 하루 중 언제쯤인지, 발밑에 무엇이 놓여 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L32: `사람이 몇 명인지, 함께 무엇을 하고 있는지 써 봐요. 날씨가 어떤지, 각자 무엇을 입었는지, 바닥에 무엇이 있는지도 써요. 하늘 색과 창문 불빛을 보고 언제쯤인지 생각해 봐요. ${LEGACY_MOOD}`,
  L33: `사람이 몇 명인지, 어디에서 무엇을 하고 있는지 써 봐요. 창으로 들어오는 빛을 보고 하루 중 언제쯤인지, 식탁 위에 무엇이 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L34: `사람이 몇 명인지, 함께 무엇을 하고 있는지 써 봐요. 날씨와 계절이 어떤지, 각자 어떤 색 옷을 입었는지, 주변에 무엇이 있는지도 써요. 하늘 색을 보고 언제쯤인지 생각해 봐요. ${LEGACY_MOOD}`,
  L35: `여기가 어떤 곳인지, 사람이 몇 명이고 어떤 자세로 무엇을 하고 있는지 써 봐요. 창밖 빛을 보고 하루 중 언제쯤인지, 바닥에 무엇이 있는지도 함께 써요. ${LEGACY_MOOD}`,
  L36: `여기가 어떤 곳인지, 하늘을 보고 하루 중 언제쯤인지 써 봐요. 사람이 몇 명이고 무엇을 들고 있는지, 주변 바닥에 무엇이 놓여 있는지도 함께 써요. ${LEGACY_MOOD}`,
};

/**
 * A밴드(L01–L12) 관계 질문 점검 — "서로 어디에 있는지(위·아래·왼쪽·오른쪽)"는 대상이 둘 이상일 때만 뜻이 있다.
 * 그림(public/questions/L01~L12.jpg)을 직접 보고 적었다. 힌트 문구는 바꾸지 않는다.
 * 'na'는 단서 팩에서 관계를 not_applicable로 둘 후보, 'applies'는 관계를 판정할 거리가 있는 문항이다.
 * 단서 팩에서 not_applicable로 정하면 서버가 알려 준 대로 학생 화면에서 관계 질문이 빠진다(withoutAreas).
 */
const A_RELATION = {
  L01: { verdict: 'na', why: '흰 바탕에 대상 하나뿐(꼭지는 대상의 한 부분).' },
  L02: { verdict: 'na', why: '흰 바탕에 대상 하나뿐. 가로로 누운 방향은 관계보다 특징(모양)에 가깝다.' },
  L03: { verdict: 'na', why: '흰 바탕에 대상 하나뿐(꿰맨 끈은 대상의 한 부분).' },
  L04: { verdict: 'na', why: '흰 바탕에 대상 하나뿐(주둥이·손잡이는 대상의 부분).' },
  L05: { verdict: 'applies', why: '선인장이 화분에 심겨 있음(담긴 것과 담은 것의 위·아래·안 관계).' },
  L06: { verdict: 'na', why: '흰 바탕에 대상 하나뿐(고리 구멍·톱니는 대상의 부분).' },
  L07: { verdict: 'applies', why: '공 세 개가 한 줄로 놓임(왼쪽부터 큰 것에서 작은 것 순서).' },
  L08: { verdict: 'na', why: '단색 바탕에 대상 하나뿐. 손잡이가 오른쪽에 달린 것은 부분의 위치(특징)에 가깝다.' },
  L09: { verdict: 'applies', why: '병 두 개가 나란히 놓임(왼쪽 길쭉한 병, 오른쪽 짧은 병).' },
  L10: { verdict: 'applies', why: '쿠키 다섯 개가 네 귀퉁이와 가운데에 흩어져 놓임(주사위 다섯 눈 배치).' },
  L11: { verdict: 'na', why: '대상 하나가 그림을 가득 채움.' },
  L12: { verdict: 'applies', why: '돌 네 개가 그림 아래쪽에 한 줄로 놓임(왼쪽부터 작은 것·중간·큰 것·납작한 판).' },
};

/** 그림을 직접 보고 남긴 검수 메모. 판단이 필요한 곳만 적는다. */
const NOTES = {
  L03: '제목은 "축구공"이나 그림은 가운데를 끈으로 꿰맨 갈색 가죽 공(흔한 축구공 무늬가 아님). 대상 이름으로 무엇까지 인정할지 단서 팩에서 정할 것.',
  L05: '선인장과 화분 두 대상. 흰 점(가시) 있음.',
  L11: '날개를 편 나비 한 마리가 그림을 가득 채움. "날개"라는 말은 예전 초안에서도 뺐음(대상 추측 단서).',
  L12: '돌 네 개 가운데 하나는 납작한 판 모양이라 모양 차이도 볼 거리.',
  L17: '왼쪽 위 노란 원(해로 볼 수 있음). B밴드라 시간대는 요구하지 않음.',
  L19: '이제 3단계(특징). 예전 4차시 공통 안내가 요구하던 "질감"은 새 확인 질문(색과 모양)에 없음. 털의 질감을 특징 영역 필수 단서로 둘지 단서 팩에서 결정.',
  L20: '반짝이는 금속 겉면(질감)을 특징 단서로 둘지 L19와 함께 결정. 검은 손잡이·뚜껑 꼭지. 행동하는 대상이 없음 — 관계 질문("무엇을 하고 있는지")은 놓인 곳(파란 바닥면·노란 배경)으로만 판정될 것. 관계 단서를 놓인 곳으로 둘지 결정.',
  L21: '두 팔로 무릎을 감싸고 앉은 자세.',
  L22: '행동이 없는 문항. 배경(풀밭·덤불·하늘)과 뿌리 모양이 볼 거리. 관계는 장소(풀밭)만 판정할 거리 — 관계 단서를 장소로만 둘지 결정.',
  L23: '배경은 장소가 아니라 파란 네모와 노란 원. 줄 공책 종이. 행동·장소가 없어 관계 질문("어디에서 무엇을")이 맞지 않음 — 단서 팩에서 관계를 not_applicable로 정할지, 배경 도형과의 앞뒤로 판정할지 결정.',
  L24: '장소는 욕실(욕조·타일). 수건이 고리에 걸려 물이 떨어져 바닥에 고임. 행동 대신 상태(걸려 있음·물이 떨어짐)를 관계로 볼지 결정.',
  L26: '비 오는 날 창가. 시간대(낮)를 그림만으로 단정하기 어려움(예전 초안은 날씨로 안내함). C밴드 선택 안내가 "언제인지 알 수 있다면"이라 시간대를 필수 단서로 두지 말 것.',
  L27: '제목에 없지만 아이 두 명과 벤치가 있음. 밤·눈.',
  L28: '빈 교실, 왼쪽 창으로 햇빛. 아침인지 그림만으로 단정은 어려움(예전 초안은 빛을 근거로 쓰라고만 안내). 사람이 없어 관계 질문의 "무엇을 하고 있는지"는 판정할 거리가 없음 — 관계 단서를 장소·놓인 곳으로 둘지 결정.',
  L29: '안개 낀 숲길에 토끼 한 마리, 오른쪽에 버섯·통나무.',
  L30: '해 질 무렵 빈 놀이터. 그네·미끄럼틀·흔들 말·모래밭. 사람이 없어 관계는 놓인 곳으로만 판정할 거리 — L28과 함께 결정.',
  L32: '시간대 단정 어려움(분홍빛 하늘·불 켜진 창문). 예전 초안은 근거를 보고 생각하라고만 안내. 시간대를 필수 단서로 두지 말 것.',
  L34: '시간대 단정 어려움(연분홍 하늘). 제목은 "오후". 예전 초안은 근거를 보고 생각하라고만 안내. 시간대를 필수 단서로 두지 말 것.',
  L35: '창밖 빛만으로 아침·오후 구분이 어려움. 제목은 "오후". 시간대를 필수 단서로 두지 말 것.',
};

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

/** 확인 질문 칸 — 순서대로, 단계 초점 영역은 굵게 '초점'으로 표시 */
function renderChecks(checks, focus) {
  return checks
    .map((c, i) => {
      const n = CIRCLED[i] ?? `${i + 1}.`;
      if (c.area === null) return `${n} (선택) ${escapeCell(c.text)}`;
      const label = AREA_LABEL[c.area];
      const tag = c.area === focus ? `**[${label}·초점]**` : `[${label}]`;
      return `${n} ${tag} ${escapeCell(c.text)}`;
    })
    .join('<br>');
}

function renderMemo(id) {
  const parts = [];
  const rel = A_RELATION[id];
  if (rel) {
    parts.push(
      rel.verdict === 'na'
        ? `**관계: not_applicable 후보** — ${rel.why} 단서 팩에서 관계를 not_applicable로 정할지 결정.`
        : `관계: 판정 거리 있음 — ${rel.why}`
    );
  }
  if (NOTES[id]) parts.push(NOTES[id]);
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
    checks: renderChecks(draft.checks, focus),
    reviewed: draft.reviewed,
    legacy: LEGACY_DRAFTS[id] ?? '',
    memo: renderMemo(id),
  };
});

const missingLegacy = rows.filter((r) => !r.legacy).map((r) => r.id);
if (missingLegacy.length) throw new Error(`예전 초안이 없는 문항: ${missingLegacy.join(', ')}`);

const reviewedIds = rows.filter((r) => r.reviewed).map((r) => r.id);
const naCandidates = Object.entries(A_RELATION).filter(([, v]) => v.verdict === 'na').map(([id]) => id);
const relationApplies = Object.entries(A_RELATION).filter(([, v]) => v.verdict === 'applies').map(([id]) => id);
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
  '## 승인하는 방법',
  '',
  '1. 아래 표에서 문항의 확인 질문을 실제 그림(`public/questions/Lxx.jpg`)과 견주어 본다.',
  '2. 그림에 맞지 않는 영역 질문이 있으면(예: 대상이 하나뿐인 그림의 관계 질문) **문구를 고치지 말고**',
  '   비공개 단서 팩(`RESEARCH_ASSET_DIR/cue-pack.json`)에서 그 영역을 `not_applicable`로 정한다.',
  '   그러면 채점에서 그 영역이 해당 없음이 되고, 학생 화면에서도 그 질문이 빠진다(`withoutAreas`).',
  '   이 표는 단서 팩을 모르므로 세 영역 질문을 모두 보여 준다.',
  '3. 승인할 문항 ID를 `src/lib/practice-hints.ts`의 `REVIEWED_QUESTIONS`에 더한다.',
  '',
  '   ```ts',
  "   export const REVIEWED_QUESTIONS: readonly string[] = ['L01', 'L02'];",
  '   ```',
  '',
  '4. `npm run hints:table`로 이 표를 다시 만들고 `npm test`를 돌린다(`tests/hints.test.ts`가 표와 원본이 맞는지 본다).',
  '',
  '- **`REVIEWED_QUESTIONS`에 들어간 문항의 힌트만 학생 화면에 나간다.** 들어가기 전에는 단계 공통 안내(`src/lib/questions.ts`의 `GUIDE`)가 나간다.',
  '- 문구 자체를 바꾸려면 `HINT_GOAL`·`HINT_CHECK`·`HINT_C_OPTIONAL`을 고친다. 36문항에 함께 바뀐다.',
  '- 힌트는 정답 값(대상 이름·색 이름·개수)과 그림의 특정 부위를 말하지 않는다(`tests/hints.test.ts`가 숫자·색·개수 낱말을 막는다).',
  '',
  '## 힌트 구성 (루브릭 v12-2)',
  '',
  `- **목표(공통)**: ${HINT_GOAL}`,
  '- **확인 질문**: 영역마다 한 문장, 그 문항에서 판정하는 영역만.',
  `  - 대상: ${HINT_CHECK.object}`,
  `  - 특징: ${HINT_CHECK.feature}`,
  `  - 관계(A밴드 L01–L12): ${HINT_CHECK.relationA}`,
  `  - 관계(B·C밴드 L13–L36): ${HINT_CHECK.relationBC}`,
  `  - C밴드(L25–L36) 선택 안내(영역 없음, 맨 뒤): ${HINT_C_OPTIONAL}`,
  '- 단계 초점 영역의 질문을 맨 앞에 둔다. 표의 **[영역·초점]** 표시가 그것이다.',
  '',
  '| 단계 | 이름 | 문항 | 확인 질문 순서 |',
  '|---|---|---|---|',
  ...STAGES.map(stageLine),
  '',
  '밴드는 문항 번호로 정한다(A=L01–L12, B=L13–L24, C=L25–L36). 그래서 4단계(관계, L13–L18)는 B밴드, 3단계(특징, L19–L24)도 B밴드다.',
  '',
  '## A밴드 관계 질문 점검',
  '',
  `A밴드 관계 질문 "${HINT_CHECK.relationA}"는 대상이 둘 이상일 때만 뜻이 있다. 그림을 보고 나눈 결과(메모 열에 까닭):`,
  '',
  `- **not_applicable 후보(대상 하나)**: ${naCandidates.join(', ')} — 단서 팩에서 관계를 not_applicable로 정할지 결정.`,
  `- 관계를 판정할 거리가 있음: ${relationApplies.join(', ')}`,
  '- 1단계(L01–L06)는 대부분 대상이 하나다. 단서 팩에서 정하지 않으면 학생은 관계 질문을 그대로 본다.',
  '- B·C밴드에서도 행동하는 대상이 없는 그림(L20·L22·L23·L24·L28·L30)은 관계 질문 "무엇을 하고 있는지"가 맞지 않는다. 메모 열 참고.',
  '',
  '## 문항별 표 (제시 순서)',
  '',
  '| 문항 | 단계(번호·이름) | 밴드 | 목표 | 확인 질문(순서대로, 초점 영역 표시) | 검수 | 예전 초안(참고) | 메모 |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.id} | ${escapeCell(r.stage)} | ${r.band} | ${escapeCell(r.goal)} | ${r.checks} | ${r.reviewed ? '✅' : '초안'} | ${escapeCell(r.legacy)} | ${r.memo} |`
  ),
  '',
  '예전 초안(참고) 열은 논문 v12 1차 문항별 힌트다. 그림의 부위·볼 거리를 짚어 학생 화면에서는 더 쓰지 않는다.',
  '단서 팩의 필수 단서를 정할 때 참고만 한다.',
  '',
];

const text = lines.join('\n');
if (process.argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  const out = path.join(process.cwd(), 'docs', 'practice-hints-review.md');
  writeFileSync(out, text, 'utf8');
  console.log(`썼다: ${path.relative(process.cwd(), out)} (검수 완료 ${reviewedIds.length}/${rows.length})`);
}
