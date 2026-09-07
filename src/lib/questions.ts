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
 * 차시와 밴드 (논문 <표 III-5> 밴드 전환의 확정 명세)
 *   1차시 Lv.1~6   이름 + 기본 색·모양   A밴드
 *   2차시 Lv.7~12  크기·개수로 좁히기    A밴드
 *   3차시 Lv.13~18 배경·행동             B밴드
 *   4차시 Lv.19~24 질감·자세             B밴드
 *   5차시 Lv.25~30 시간대·분위기          C밴드
 *   6차시 Lv.31~36 3축 종합              C밴드
 *
 * 문항을 고치면 public/questions/ 이미지와 서버의 제작 프롬프트 목록도 함께 갱신할 것.
 */

export type PracticeQuestion = {
  level: number;
  chasi: number;
  koreanTitle: string;
  rubric: string;
  imageUrl: string;
};

/**
 * 차시별 학생 안내.
 *
 * 1차시는 대상 축과 구체성 축을 함께 채점하는 A밴드이므로 이름만 쓰게 하지 않고
 * 눈에 보이는 기본 색·모양을 함께 쓰게 한다. 4분 도입에 맞춰 기본 색과 기본 형태로
 * 한정하고, 전문적인 질감·재질은 4차시에서 다루므로 여기서 요구하지 않는다.
 * 2차시는 1차시와 겹치지 않도록 크기·개수로 그림을 하나로 좁히는 역할만 맡는다.
 */
const GUIDE: Record<number, string> = {
  1: `이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?

이름과 눈에 보이는 색·모양을 함께 써 봐요. 빨강·노랑·초록 같은 기본 색과 동그라미·네모·길쭉함 같은 기본 모양이면 충분해요. 예) '빨간 동그란 사과'

만져 본 느낌이나 무엇으로 만들었는지는 아직 쓰지 않아도 돼요.`,
  2: `눈을 감고도 떠올릴 수 있게, 그림 하나로 좁혀 봐요.

1차시에서 쓴 색과 모양에 크기와 개수를 더해 주세요. '크다'보다 무엇보다 더 큰지, 몇 개인지를 쓰면 그림이 하나로 정해져요. 예) '큰 주황 공 하나와 작은 주황 공 두 개'`,
  3: `어디에서 무엇을 하고 있는지까지 써 봐요.

대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요.`,
  4: `만져 본 느낌과 자세까지 말해 봐요.

반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요.`,
  5: `언제인지, 어떤 느낌인지 담아 써 봐요.

분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요.`,
  6: `지금까지 배운 것을 모두 넣어 써 봐요.

무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!`,
};

const raw: { level: number; chasi: number; koreanTitle: string }[] = [
  { level:  1, chasi: 1, koreanTitle: "빨간 사과 한 개" },
  { level:  2, chasi: 1, koreanTitle: "접힌 노란 우산" },
  { level:  3, chasi: 1, koreanTitle: "갈색 가죽 축구공" },
  { level:  4, chasi: 1, koreanTitle: "파란 물뿌리개" },
  { level:  5, chasi: 1, koreanTitle: "초록 선인장 화분" },
  { level:  6, chasi: 1, koreanTitle: "은색 열쇠 하나" },
  { level:  7, chasi: 2, koreanTitle: "크기가 다른 주황색 공 세 개" },
  { level:  8, chasi: 2, koreanTitle: "줄무늬 머그컵 하나" },
  { level:  9, chasi: 2, koreanTitle: "길쭉한 초록 병과 짧은 갈색 병" },
  { level: 10, chasi: 2, koreanTitle: "별 모양 쿠키 다섯 개" },
  { level: 11, chasi: 2, koreanTitle: "커다란 보라색 나비 한 마리" },
  { level: 12, chasi: 2, koreanTitle: "크고 작은 회색 돌 네 개" },
  { level: 13, chasi: 3, koreanTitle: "잔디밭에서 뛰는 갈색 강아지" },
  { level: 14, chasi: 3, koreanTitle: "나뭇가지에 앉은 파란 새" },
  { level: 15, chasi: 3, koreanTitle: "헤엄치는 주황색 물고기" },
  { level: 16, chasi: 3, koreanTitle: "책상에 앉아 책을 읽는 아이" },
  { level: 17, chasi: 3, koreanTitle: "공중으로 뛰어오르는 회색 고양이" },
  { level: 18, chasi: 3, koreanTitle: "우산을 쓰고 걷는 아이" },
  { level: 19, chasi: 4, koreanTitle: "웅크리고 자는 흰 고양이" },
  { level: 20, chasi: 4, koreanTitle: "반질반질한 금속 주전자" },
  { level: 21, chasi: 4, koreanTitle: "무릎을 굽히고 앉은 아이" },
  { level: 22, chasi: 4, koreanTitle: "거친 나무껍질의 나무 밑동" },
  { level: 23, chasi: 4, koreanTitle: "구겨진 종이비행기" },
  { level: 24, chasi: 4, koreanTitle: "젖어서 축 늘어진 수건" },
  { level: 25, chasi: 5, koreanTitle: "노을 지는 저녁 바닷가" },
  { level: 26, chasi: 5, koreanTitle: "비 오는 날 창가" },
  { level: 27, chasi: 5, koreanTitle: "눈 내리는 밤 가로등 아래" },
  { level: 28, chasi: 5, koreanTitle: "아침 햇살이 드는 교실" },
  { level: 29, chasi: 5, koreanTitle: "안개 낀 이른 아침 숲길" },
  { level: 30, chasi: 5, koreanTitle: "해 질 무렵 텅 빈 놀이터" },
  { level: 31, chasi: 6, koreanTitle: "저녁 공원 벤치의 아이와 강아지" },
  { level: 32, chasi: 6, koreanTitle: "비 오는 날 우산을 나눠 쓴 두 아이" },
  { level: 33, chasi: 6, koreanTitle: "아침 부엌의 아이" },
  { level: 34, chasi: 6, koreanTitle: "눈사람을 만드는 두 아이" },
  { level: 35, chasi: 6, koreanTitle: "오후 도서관의 아이" },
  { level: 36, chasi: 6, koreanTitle: "노을 지는 운동장의 아이" },
];

export const PRACTICE_QUESTIONS: PracticeQuestion[] = raw.map((q) => ({
  level: q.level,
  chasi: q.chasi,
  koreanTitle: q.koreanTitle,
  rubric: GUIDE[q.chasi],
  imageUrl: `/questions/L${String(q.level).padStart(2, '0')}.jpg`,
}));

/** 차시별 문항 구간. 프로그램 운영과 분석에서 함께 쓴다. */
export const CHASI_RANGE: Record<number, [number, number]> = {
  1: [1, 6], 2: [7, 12], 3: [13, 18], 4: [19, 24], 5: [25, 30], 6: [31, 36],
};
