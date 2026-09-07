/**
 * 공통 루브릭 v7 — 단일 버전 리소스
 *
 * 논문 대응: <표 Ⅲ-4> AI·교사 공통 5수준 루브릭과 환산 규칙 (원문 `공통루브릭_v7.md`)
 *
 * AI 지시문, 교사 화면, 내보내기 문서는 모두 이 파일 하나에서 생성한다.
 * 사람이 사본을 손으로 옮겨 적어 동기화하는 구조를 만들지 않는다.
 * 수준 문언은 원문 그대로이며 요약·의역하지 않는다.
 *
 * 문항별 단서·경계·앵커는 이 파일에 두지 않는다. 검사 문항의 단서는 비공개 자산이므로
 * 서버 전용 레지스트리(`src/server/registry`)에서 조회해 채점 시점에만 주입한다.
 */

import type { Band } from '@/lib/scoring';

/** 공통 문언의 버전. 단서 버전(cueVersion)과는 별개로 관리한다. */
export const RUBRIC_VERSION = 'v7';

export type RubricAxisId = 'object' | 'specificity' | 'contextB' | 'contextC';

export interface RubricAxis {
  id: RubricAxisId;
  /** 표 제목. 원문 표의 열 이름을 그대로 쓴다. */
  title: string;
  /** 이 축이 무엇을 보는지. 원문 2문단에서 옮긴다. */
  scope: string;
  /** 수준 5 → 1 순서. 원문 표의 문언 그대로. */
  levels: { level: 5 | 4 | 3 | 2 | 1; text: string }[];
}

const OBJECT_AXIS: RubricAxis = {
  id: 'object',
  title: '대상 완전성',
  scope: '대상의 명칭·핵심 대상의 누락·수량을 평가한다.',
  levels: [
    { level: 5, text: '사전 명세의 핵심 대상을 모두 정확히 지칭하고 필요한 수량을 밝혀 대상을 구별한다.' },
    { level: 4, text: '핵심 대상을 모두 지칭하나 한 명칭이 포괄적이거나 필수 수량이 불명확하다.' },
    { level: 3, text: '핵심 대상 일부를 정확히 지칭하나 주요 누락 또는 복수의 포괄적 명칭이 있다.' },
    { level: 2, text: '관련 대상은 언급하지만 핵심 대상의 식별이 대부분 부정확하다.' },
    { level: 1, text: '대상에 관한 유효한 정보를 제시하지 못하거나 내용이 이미지와 무관하다.' },
  ],
};

const SPECIFICITY_AXIS: RubricAxis = {
  id: 'specificity',
  title: '시각적 구체성',
  scope: '대상에 귀속되는 색·형태·크기·질감·정적인 자세를 평가한다.',
  levels: [
    { level: 5, text: '문항별 필수 속성을 모두 정확히 기술하고 각 속성의 대상 귀속이 명확하다.' },
    { level: 4, text: '필수 속성 대부분을 기술하나 일부가 누락되거나 대상 귀속이 불명확하다.' },
    { level: 3, text: '필수 속성 일부를 정확히 기술하지만 대상을 구별하기에는 정보가 부족하다.' },
    { level: 2, text: '막연한 수식 또는 관련성이 약한 속성만 제시하여 대상 구별에 거의 기여하지 못한다.' },
    { level: 1, text: '유효한 속성 진술이 없거나 속성 진술이 전부 이미지와 무관하다.' },
  ],
};

const CONTEXT_C_AXIS: RubricAxis = {
  id: 'contextC',
  title: '맥락·분위기(C밴드)',
  scope: '장소·시간·동작·대상 간 공간 관계·분위기를 평가한다.',
  levels: [
    { level: 5, text: '문항별 필수 장소·시간·동작·관계 단서를 연결하고 시각 근거에 부합하는 분위기를 진술한다.' },
    { level: 4, text: '맥락 단서 대부분을 연결하나 일부 누락이 있거나 분위기와 시각 근거의 연결이 약하다.' },
    { level: 3, text: '일부 맥락 단서를 정확히 제시하지만 장면 관계나 분위기의 연결이 충분하지 않다.' },
    { level: 2, text: '배경 또는 상황을 막연히 언급하지만 장면을 특정할 정보가 거의 없다.' },
    { level: 1, text: '유효한 배경·상황 진술이 없거나 내용이 이미지와 무관하다.' },
  ],
};

const CONTEXT_B_AXIS: RubricAxis = {
  id: 'contextB',
  title: '배경·행동(B밴드의 맥락 축)',
  scope: '문항 명세의 장소 단서와 대상의 동작을 평가한다. 분위기는 이 밴드에서 요구하지 않는다.',
  levels: [
    { level: 5, text: '명세의 장소 단서와 대상의 동작을 모두 정확히 연결한다.' },
    { level: 4, text: '장소와 동작을 모두 언급하나 한 요소가 포괄적이거나 연결이 불명확하다.' },
    { level: 3, text: '장소 또는 동작 가운데 하나를 정확히 진술한다.' },
    { level: 2, text: '배경 또는 움직임의 존재만 막연히 언급한다.' },
    { level: 1, text: '유효한 배경·동작 진술이 없다.' },
  ],
};

export const RUBRIC_AXES: Record<RubricAxisId, RubricAxis> = {
  object: OBJECT_AXIS,
  specificity: SPECIFICITY_AXIS,
  contextB: CONTEXT_B_AXIS,
  contextC: CONTEXT_C_AXIS,
};

/** 환산 규칙 문단. 원문 1문단. */
export const CONVERSION_NOTE =
  '공통 루브릭은 축별 1~5수준으로 판정한다. AI와 교사는 같은 문언, 문항별 필수 단서 목록 및 경계 사례를 사용한다. ' +
  '채점자는 수준을 판정하고 점수 환산은 코드로 일괄 수행한다. 축 점수는 (수준−1)/4×축 배점이며, ' +
  '수준 1·2·3·4·5는 각각 배점의 0·25·50·75·100%에 해당한다. A밴드는 대상·구체성 각 50점, ' +
  'B·C밴드는 대상 35점·구체성 35점·맥락 30점이다. 이는 편의적인 합성점수의 가중치이며 심리측정적으로 추정된 요인 부하량이 아니다. ' +
  '서로 다른 가중치로 재계산한 결과는 민감도 분석으로만 제시한다.';

/**
 * 주(註)의 판정 원칙. 원문의 문장을 그대로 쓴다.
 * AI 지시문·교사 화면·내보내기가 모두 이 배열을 쓴다.
 */
export const JUDGMENT_PRINCIPLES: string[] = [
  '같은 단서를 두 축에서 중복 가점하지 않는다.',
  '‘왼쪽에 있는 고양이’의 위치 관계는 맥락, ‘왼쪽 귀가 접힌 고양이’의 외형은 구체성으로 판정한다.',
  'A밴드에서는 장면 관계를 요구하지 않는다.',
  '주요 대상과 필수 속성은 이미지에서 실제로 확인되는 단서로 문항별 사전 확정한다.',
  '원본 이미지 생성 프롬프트는 정답 문장이 아니며, 이미지에 구현되지 않은 요구는 채점 기준에서 제외한다.',
  '동의어와 의미가 분명한 아동 표현을 허용하고, 맞춤법·문장 길이·형용사 개수만으로 가감점하지 않는다.',
  '분위기는 근거가 있는 복수 해석을 허용한다.',
  '‘모두·대부분·일부’의 판정은 문항별 단서 목록과 앵커 응답으로 구체화한다.',
  '이미지와 명백히 모순되는 요소는 해당 축을 한 수준 낮추되 최저 수준은 1이다.',
  '모순의 수와 무관하게 한 응답의 같은 축에서는 한 수준만 감점하며, 이미 그 모순으로 수준 1이 된 축에 중복 감점을 하지 않는다.',
  '기본 수준은 정확한 단서로 정하고 모순 감점의 적용 여부와 근거를 별도로 기록한다.',
  '단순 미확인·주관적 분위기 표현은 명백한 모순과 구분한다.',
  '근거가 부족한 중립적 추가 표현은 가점하지 않는다.',
  '기술 오류·시간 종료 미제출·참여 철회는 수준 1이 아니라 결측으로 구분한다.',
  '유효하게 제출된 비관련 응답은 수준 1로 처리한다.',
];

/** 밴드별로 적용하는 축. A밴드는 맥락 축을 적용하지 않는다. */
export function axesForBand(band: Band): RubricAxis[] {
  if (band === 'A') return [OBJECT_AXIS, SPECIFICITY_AXIS];
  return [OBJECT_AXIS, SPECIFICITY_AXIS, band === 'B' ? CONTEXT_B_AXIS : CONTEXT_C_AXIS];
}

/** 밴드별 맥락 축 적용 여부 안내. 지시문과 교사 화면이 함께 쓴다. */
export function contextNote(band: Band): string {
  return band === 'A'
    ? '이 문항은 맥락 축을 적용하지 않는다. contextLevel은 null로 반환한다. 0으로 채우지 않는다.'
    : '세 축을 모두 판정한다. contextLevel은 1~5의 정수여야 한다.';
}

/** 한 축을 모델 지시문 형식으로 렌더링한다. AXIS_* 상수는 모두 이 함수에서 파생한다. */
export function renderAxisForModel(axis: RubricAxis, ordinal: number): string {
  const head = `[축 ${ordinal} ${axis.title}] ${axis.scope}`;
  const body = axis.levels.map((l) => `${l.level} ${l.text}`).join('\n');
  return `${head}\n${body}`;
}

/** 모델에 보내는 공통 판정 문언. 문항별 단서는 여기에 넣지 않는다. */
export function renderForModel(band: Band): string {
  const axes = axesForBand(band)
    .map((axis, i) => renderAxisForModel(axis, i + 1))
    .join('\n\n');
  const principles = ['[공통 판정 원칙]', ...JUDGMENT_PRINCIPLES].join('\n');
  return `${axes}\n\n${principles}\n\n${contextNote(band)}`;
}

/** 교사 화면용. 같은 문언을 사람이 읽는 형식으로 낸다. */
export function renderForTeacher(band: Band): string {
  const weightLine =
    band === 'A'
      ? '배점: 대상 완전성 50 / 시각적 구체성 50. 맥락 축은 적용하지 않는다(0점이 아니라 미적용).'
      : '배점: 대상 완전성 35 / 시각적 구체성 35 / 맥락 축 30.';
  const axes = axesForBand(band)
    .map((axis) => {
      const rows = axis.levels.map((l) => `  수준 ${l.level}  ${l.text}`).join('\n');
      return `${axis.title} — ${axis.scope}\n${rows}`;
    })
    .join('\n\n');
  const principles = JUDGMENT_PRINCIPLES.map((p) => `- ${p}`).join('\n');
  return [
    `공통 루브릭 ${RUBRIC_VERSION} — ${band}밴드`,
    weightLine,
    '',
    axes,
    '',
    '판정 원칙',
    principles,
    '',
    '문항별 단서 목록과 수준 경계는 문항 명세를 함께 적용한다.',
  ].join('\n');
}

/** 내보내기 문서(마크다운). 세 밴드의 축을 모두 담고 버전을 명시한다. */
export function renderForExport(): string {
  const table = (axis: RubricAxis) =>
    [
      `### ${axis.title}`,
      '',
      axis.scope,
      '',
      '| 수준 | 문언 |',
      '|---|---|',
      ...axis.levels.map((l) => `| ${l.level} | ${l.text} |`),
    ].join('\n');
  return [
    `# 공통 루브릭 ${RUBRIC_VERSION}`,
    '',
    CONVERSION_NOTE,
    '',
    '## 축별 수준 문언',
    '',
    table(OBJECT_AXIS),
    '',
    table(SPECIFICITY_AXIS),
    '',
    table(CONTEXT_C_AXIS),
    '',
    table(CONTEXT_B_AXIS),
    '',
    '## 판정 원칙',
    '',
    ...JUDGMENT_PRINCIPLES.map((p) => `- ${p}`),
    '',
    '문항별 단서와 수준 경계는 문항 명세를 함께 적용한다. 이 문서는 공통 문언만 담으며 문항별 단서·앵커를 포함하지 않는다.',
  ].join('\n');
}
