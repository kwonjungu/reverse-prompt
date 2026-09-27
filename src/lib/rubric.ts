/**
 * 공통 루브릭 v12-2 — 단일 버전 리소스(3영역 4수준)
 *
 * 논문 v12의 공통 루브릭. AI 지시문·교사 화면·내보내기 문서는 모두 이 파일 하나에서 만든다.
 * 수준 문언과 운영 규칙은 연구자가 준 문장을 그대로 두며 요약·의역하지 않는다.
 * 사람이 사본을 손으로 옮겨 적어 동기화하는 구조를 만들지 않는다.
 *
 * 문항별 필수 정보(핵심 대상·필수 속성·필수 관계·앵커)는 여기 두지 않는다. 비공개 단서 팩에서
 * 서버가 읽어 채점 시점에만 넣는다(src/server/registry).
 *
 * 옛 공통 루브릭 v7(5수준·100점 환산)은 src/lib/legacy-v7/rubric.ts에 있고 게임·타임어택만 쓴다.
 */

import type { AreaId, Band } from '@/lib/scoring';

/** 공통 문언의 버전. 저장 문서의 rubricVersion에 그대로 남는다. */
export const RUBRIC_VERSION = 'v12-2';

export interface RubricArea {
  id: AreaId;
  /** 영역 이름(표 제목) */
  title: string;
  /** 학생 화면에 쓰는 짧은 이름 */
  short: string;
  /** 수준 4 → 1 순서. 원문 그대로. */
  levels: { level: 4 | 3 | 2 | 1; text: string }[];
}

const OBJECT_AREA: RubricArea = {
  id: 'object',
  title: '대상의 명확성',
  short: '대상',
  levels: [
    { level: 4, text: '필수 정보표의 핵심 대상을 모두 구별해 표현하고 필요한 수량을 분명히 제시' },
    { level: 3, text: '핵심 대상은 모두 있으나 한 대상의 명칭이 포괄적이거나 수량이 불분명' },
    { level: 2, text: '핵심 대상 일부만 있거나 여러 대상 구별이 어려움' },
    { level: 1, text: '핵심 대상을 식별할 유효한 정보가 없거나 그림과 무관' },
  ],
};

const FEATURE_AREA: RubricArea = {
  id: 'feature',
  title: '특징의 구체성',
  short: '특징',
  levels: [
    { level: 4, text: '필수 속성을 모두 정확히 표현하고 각 속성이 어느 대상의 것인지 분명' },
    { level: 3, text: '대체로 정확하나 한 속성이 빠지거나 대상 연결이 불분명' },
    { level: 2, text: '일부 속성만 있거나 핵심 속성이 잘못 연결됨' },
    { level: 1, text: '유효한 필수 속성이 없거나 모두 그림과 맞지 않음' },
  ],
};

const RELATION_AREA: RubricArea = {
  id: 'relation',
  title: '관계의 명확성',
  short: '관계',
  levels: [
    { level: 4, text: '필수 정보표의 장소·행동·공간 관계를 정확히 연결해 장면이 분명' },
    { level: 3, text: '대체로 드러나나 한 관계가 빠지거나 참여 대상이 불분명' },
    { level: 2, text: '핵심 관계가 빠지거나 방향·행동 연결이 그림과 다름' },
    { level: 1, text: '유효한 관계 정보가 없거나 모두 무관' },
  ],
};

export const RUBRIC_AREAS: readonly RubricArea[] = [OBJECT_AREA, FEATURE_AREA, RELATION_AREA];

/**
 * 운영 규칙. 연구자가 준 문장 그대로. AI 지시문·교사 화면·내보내기가 모두 이 배열을 쓴다.
 * 논문 부록의 규칙 번호와의 대응: 1=K01(수량은 대상 영역), 2=K02(분위기·시간대 선택), 3=K03(이름=형태),
 * 4=K06(겹치면 낮은 수준), 5=K05(대상 누락·증거 부족), 6=맞춤법·띄어쓰기·시간 제외, 7=관계 범위, 8=해당 없음(K04).
 * K07은 논문 v12-2에서 삭제된 규칙이다. 지시문에 넣지 않는다.
 */
export const OPERATING_RULES: readonly string[] = [
  '수량은 대상 영역에서만 판단하고 특징 영역에서 다시 감점하지 않는다.',
  '분위기·느낌·시간대는 선택 정보라 필수 채점에서 제외한다(표현은 허용, 유무로 수준을 정하지 않음).',
  "'삼각형', '원'처럼 이름이 곧 형태면 대상 영역, '둥근 접시'의 '둥근'은 특징 영역.",
  '두 수준 기술에 모두 해당하면 낮은 수준. 한 속성 누락(3)과 핵심 속성 오류(2, 속성을 다른 대상에 붙인 경우 포함)가 겹치면 2. 그림과 다른 정보는 빠진 정보보다 무겁게.',
  '핵심 대상이 빠지면 대상 영역에만 대상 누락으로 반영하고, 그 대상의 속성·관계는 증거 부족(evidence_missing)으로 표시한다. 증거 부족은 새 오류로도, 맞은 것으로도 세지 않는다.',
  '그림에 없는 추가 내용은 감점하지 않음. 맞춤법·띄어쓰기·글 길이·작성 시간은 판단하지 않음.',
  '관계 범위: A밴드(Lv.1~12)는 대상 사이 공간 관계, B·C밴드는 장소와 행동이 필수(행동이 없는 사물·풍경은 놓인 곳과 배치). C밴드의 시간대·분위기는 선택 정보.',
  '과제별 필수 정보(비공개 단서 팩)가 요구하지 않는 영역은 not_applicable.',
];

/** 밴드별 관계 영역의 범위. 운영 규칙의 '관계 범위'를 이 문항의 밴드에 맞춰 짚는다. */
export function relationScope(band: Band): string {
  if (band === 'A') return '이 문항은 A밴드다. 관계 영역은 대상 사이의 공간 관계를 본다.';
  if (band === 'B') {
    return '이 문항은 B밴드다. 관계 영역은 장소와 행동을 본다. 둘 다 필수다. 행동이 없는 사물·풍경이면 놓인 곳과 배치를 본다.';
  }
  return '이 문항은 C밴드다. 관계 영역은 장소와 행동을 본다. 행동이 없는 사물·풍경이면 놓인 곳과 배치를 본다. 시간대·분위기는 선택 정보라 없어도 감점하지 않는다.';
}

function renderArea(area: RubricArea): string {
  return [`[${area.short} — ${area.title}]`, ...area.levels.map((l) => `${l.level} ${l.text}`)].join('\n');
}

/** 모델에 보내는 공통 판정 문언. 문항별 필수 정보는 넣지 않는다. */
export function renderForModel(band: Band): string {
  return [
    RUBRIC_AREAS.map(renderArea).join('\n\n'),
    ['[운영 규칙]', ...OPERATING_RULES.map((r) => `- ${r}`)].join('\n'),
    relationScope(band),
  ].join('\n\n');
}

/** 교사 화면용. 같은 문언을 사람이 읽는 형식으로 낸다. */
export function renderForTeacher(band: Band): string {
  const areas = RUBRIC_AREAS.map((a) =>
    [`${a.title}(${a.short})`, ...a.levels.map((l) => `  수준 ${l.level}  ${l.text}`)].join('\n')
  ).join('\n\n');
  return [
    `공통 루브릭 ${RUBRIC_VERSION} — ${band}밴드`,
    '세 영역을 각각 1~4수준으로 판정한다. 과제가 요구하지 않는 영역은 해당 없음(not_applicable)이다.',
    '점수로 환산하지 않고 합산하지 않는다.',
    relationScope(band),
    '',
    areas,
    '',
    '운영 규칙',
    ...OPERATING_RULES.map((r) => `- ${r}`),
    '',
    '문항별 필수 정보(핵심 대상·필수 속성·필수 관계)는 문항 명세를 함께 적용한다.',
  ].join('\n');
}

/** 내보내기 문서(마크다운). 세 영역과 운영 규칙, 버전을 담는다. */
export function renderForExport(): string {
  const table = (a: RubricArea) =>
    [`### ${a.title}(${a.short})`, '', '| 수준 | 기준 |', '|---|---|', ...a.levels.map((l) => `| ${l.level} | ${l.text} |`)].join(
      '\n'
    );
  return [
    `# 공통 루브릭 ${RUBRIC_VERSION}`,
    '',
    '세 영역(대상의 명확성·특징의 구체성·관계의 명확성)을 모든 밴드에서 각각 1~4수준으로 판정한다. ' +
      '과제가 요구하지 않는 영역은 not_applicable이다. 점수로 환산하거나 합산하지 않는다.',
    '',
    '## 영역별 수준',
    '',
    RUBRIC_AREAS.map(table).join('\n\n'),
    '',
    '## 운영 규칙',
    '',
    ...OPERATING_RULES.map((r) => `- ${r}`),
    '',
    '이 문서는 공통 문언만 담으며 문항별 필수 정보·앵커를 포함하지 않는다.',
  ].join('\n');
}

/** 내보내기 묶음에 넣는 루브릭 문서. 파일 이름에 버전을 넣는다. */
export function rubricExportDocument(): {
  filename: string;
  mediaType: string;
  rubricVersion: string;
  content: string;
} {
  return {
    filename: `공통루브릭_${RUBRIC_VERSION}.md`,
    mediaType: 'text/markdown; charset=utf-8',
    rubricVersion: RUBRIC_VERSION,
    content: renderForExport(),
  };
}
