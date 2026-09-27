/**
 * 연습 모드 문항의 공개 정보 — practice·guide 화면이 공유한다.
 *
 * 이미지는 사전 제작·검수한 정적 파일(public/questions/L01.jpg ~ L36.jpg)을 쓴다.
 * 실행 중 생성하지 않으므로 학습자에게는 검수된 이미지만 제시된다.
 *
 * 이 파일은 클라이언트 컴포넌트에서 import 되므로 클라이언트 번들과 소스맵에
 * 그대로 실려 나간다. 따라서 이미지 제작 프롬프트(sourcePrompt)와 채점 단서는
 * 여기에 두지 않는다. 제작 프롬프트는 서버 전용
 * src/server/registry/practice-source-prompts.ts로 옮겼고, 채점 단서는 저장소에
 * 커밋하지 않는 비공개 단서 팩에서 서버가 읽는다.
 *
 * 6단계와 문항 배치(논문 v12) — 정의는 src/lib/stages.ts 하나에 있다.
 *   1 도구와 작성 방식 이해  L01–L06
 *   2 대상과 수량            L07–L12
 *   3 특징 구체화            L19–L24
 *   4 관계 표현              L13–L18
 *   5 피드백 검토와 재작성   L25–L30
 *   6 종합 작성              L31–L36
 * 문항 ID와 이미지는 그대로다. PRACTICE_QUESTIONS는 위 제시 순서(order)로 정렬되어 있다.
 * 밴드는 문항 번호로 정한다(A=L01–12, B=L13–24, C=L25–36, src/lib/scoring.ts의 bandOf).
 *
 * 문항을 고치면 public/questions/ 이미지와 서버의 제작 프롬프트 목록도 함께 갱신할 것.
 */

import { reviewedHintOf, type PracticeHint } from './practice-hints';
import { chasiOfLevel, presentationOrderOf } from './stages';

export type PracticeQuestion = {
  /** 문항 번호(1~36). 문항 ID L01~L36과 밴드의 기준 */
  level: number;
  /** 단계(1~6) */
  chasi: number;
  /** 제시 순서(1~36). 학생 화면은 이 순서로 푼다. */
  order: number;
  koreanTitle: string;
  /** 단계 공통 안내. 게임·시간 제한·연수 화면과, 검수 전 연습 화면이 쓴다. */
  rubric: string;
  /**
   * 이 문항의 힌트(목표 + 확인 질문). 연구자 검수를 마친 것만 들어가고, 아니면 null이다.
   * 연습 화면은 이것을 먼저 쓰고 null이면 rubric(단계 공통 안내)으로 대신한다.
   */
  hint: PracticeHint | null;
  imageUrl: string;
};

/**
 * 단계 공통 안내. 단계의 이름과 목적에 맞춘다. 정답 값(대상 이름·색 이름·개수)은 말하지 않는다.
 * 2·3·4단계는 각각 대상·특징·관계 영역에 초점을 둔다. 채점은 모든 단계에서 세 영역을 기록한다.
 */
const GUIDE: Record<number, string> = {
  1: `AI에게 그림을 글로 설명하는 방법을 익히는 단계예요.

무엇이 있는지, 어떻게 생겼는지 써 봐요. 둘 이상이 있으면 서로 어디에 있는지도 써요. 내고 나면 피드백을 읽고 다시 써 볼 수 있어요.`,
  2: `무엇이 몇 개 있는지에 집중하는 단계예요.

그림에 있는 것을 빠짐없이, 몇 개인지까지 분명하게 써 봐요. 이름이 헷갈리면 더 알맞은 이름을 찾아봐요.`,
  3: `생김새에 집중하는 단계예요.

색·모양·겉모습(매끈한지, 거친지 등)을 쓸 때 그것이 어느 것의 것인지 드러나게 써 봐요.`,
  4: `어디에서 무엇을 하고 있는지에 집중하는 단계예요.

장소와 하고 있는 일, 서로 어디에 있는지를 써 봐요.`,
  5: `피드백을 읽고 고쳐 쓰는 단계예요.

먼저 써서 내고, 피드백을 그림과 견주어 보고 맞는 것만 받아들여 고쳐 써요. 언제인지 알 수 있다면 써도 좋고, 분위기를 쓸 때는 무엇을 보고 그렇게 느꼈는지도 써요.`,
  6: `지금까지 배운 것을 모두 담는 단계예요.

무엇이 몇 개 있는지, 색과 모양은 어느 것의 것인지, 어디에서 무엇을 하고 있는지를 빠짐없이 써 봐요.`,
};

const raw: { level: number; koreanTitle: string }[] = [
  { level:  1, koreanTitle: "빨간 사과 한 개" },
  { level:  2, koreanTitle: "접힌 노란 우산" },
  { level:  3, koreanTitle: "흰색과 검은색 축구공" },
  { level:  4, koreanTitle: "파란 물뿌리개" },
  { level:  5, koreanTitle: "초록 선인장 화분" },
  { level:  6, koreanTitle: "은색 열쇠 하나" },
  { level:  7, koreanTitle: "크기가 다른 주황색 공 세 개" },
  { level:  8, koreanTitle: "빨간색과 흰색 줄무늬 머그컵 하나" },
  { level:  9, koreanTitle: "길쭉한 초록 병과 짧은 갈색 병" },
  { level: 10, koreanTitle: "별 모양 쿠키 다섯 개" },
  { level: 11, koreanTitle: "커다란 보라색 나비 한 마리" },
  { level: 12, koreanTitle: "크기가 다른 회색 조약돌 네 개" },
  { level: 13, koreanTitle: "잔디밭에서 뛰는 갈색 강아지" },
  { level: 14, koreanTitle: "나뭇가지에 앉은 파란 새" },
  { level: 15, koreanTitle: "물풀 사이를 헤엄치는 주황색 물고기" },
  { level: 16, koreanTitle: "책상에 앉아 책을 읽는 아이" },
  { level: 17, koreanTitle: "정원 울타리로 뛰어오르는 회색 고양이" },
  { level: 18, koreanTitle: "우산을 쓰고 걷는 아이" },
  { level: 19, koreanTitle: "웅크리고 자는 흰 고양이" },
  { level: 20, koreanTitle: "반질반질한 금속 주전자" },
  { level: 21, koreanTitle: "무릎을 굽히고 앉은 아이" },
  { level: 22, koreanTitle: "거친 나무껍질의 나무 밑동" },
  { level: 23, koreanTitle: "구겨진 종이비행기" },
  { level: 24, koreanTitle: "젖어서 축 늘어진 수건" },
  { level: 25, koreanTitle: "노을 지는 저녁 바닷가" },
  { level: 26, koreanTitle: "비 오는 날 창가" },
  { level: 27, koreanTitle: "눈 내리는 밤 가로등 아래의 아이" },
  { level: 28, koreanTitle: "햇살이 드는 빈 교실" },
  { level: 29, koreanTitle: "안개 낀 이른 아침 숲길" },
  { level: 30, koreanTitle: "해 질 무렵 텅 빈 놀이터" },
  { level: 31, koreanTitle: "저녁 공원 벤치의 아이와 강아지" },
  { level: 32, koreanTitle: "비 오는 날 우산을 나눠 쓴 두 아이" },
  { level: 33, koreanTitle: "아침 부엌의 아이" },
  { level: 34, koreanTitle: "눈사람을 만드는 두 아이" },
  { level: 35, koreanTitle: "오후 도서관의 아이" },
  { level: 36, koreanTitle: "노을 지는 운동장의 아이" },
];

const questionIdOf = (level: number) => `L${String(level).padStart(2, '0')}`;

export const PRACTICE_QUESTIONS: PracticeQuestion[] = raw
  .map((q) => {
    const chasi = chasiOfLevel(q.level);
    const order = presentationOrderOf(q.level);
    if (chasi === null || order === null) throw new Error(`단계가 정해지지 않은 문항: ${q.level}`);
    return {
      level: q.level,
      chasi,
      order,
      koreanTitle: q.koreanTitle,
      rubric: GUIDE[chasi],
      hint: reviewedHintOf(questionIdOf(q.level)),
      imageUrl: `/questions/${questionIdOf(q.level)}.jpg`,
    };
  })
  .sort((a, b) => a.order - b.order);
