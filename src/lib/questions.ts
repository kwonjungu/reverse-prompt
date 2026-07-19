/**
 * 연습 모드 문제의 단일 진실 공급원 — practice 페이지와 admin 감수 페이지가 공유.
 *
 * 이미지는 사전 생성된 정적 파일(public/questions/)을 사용.
 * dataAiHint는 생성 당시 사용한 프롬프트 기록 — 힌트를 바꾸면
 * scripts/generate-question-images.mjs 목록도 갱신하고 재생성할 것.
 *
 * 난이도:
 *   1~3단계  — 흰 배경, 단일 사물, 색깔·모양만 묘사
 *   4~6단계  — 흰 배경, 캐릭터 표정·특징·동작 추가
 *   7~8단계  — 배경 첫 등장 (단색)
 *   9~11단계 — 배경 + 2~3가지 요소
 *   12~15단계— 복합 씬 (여러 요소 + 분위기)
 *   16~20단계— 복합 씬 심화 (요소 4개 이상 + 시간대·빛·분위기)
 */

export type PracticeQuestion = {
  level: number;
  koreanTitle: string;
  dataAiHint: string;
  rubric: string;
  imageUrl: string;
};

const raw = [
  { level: 1,  koreanTitle: '혀 내민 하얀 강아지',          dataAiHint: 'a small white fluffy puppy sitting, tongue out, plain pure white background, no collar, no accessories, no objects except the puppy', rubric: '이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\n\n색깔은 어떤지, 어떤 자세인지, 어떤 느낌인지 생각나는 대로 써봐요.\n더 자세히 쓸수록 AI가 똑같은 그림을 만들 수 있어요!' },
  { level: 2,  koreanTitle: '초록 꼭지 달린 빨간 사과',      dataAiHint: 'a shiny red apple with a short green stem and one small green leaf, centered on plain pure white background, no other objects', rubric: '이 물건을 눈 감고 머릿속으로 떠올릴 수 있게 설명해봐요.\n\n색깔, 모양, 크기, 어떤 특징이 있는지... 단어를 많이 쓸수록 좋아요!' },
  { level: 3,  koreanTitle: '정면을 바라보는 해바라기',       dataAiHint: 'a single bright yellow sunflower facing forward, thick green stem, plain pure white background, no other flowers, no vase', rubric: '꽃집 주인이 되어 이 꽃을 소개하는 설명을 써봐요.\n\n꽃 색깔, 잎 색깔, 크기, 어떤 방향을 향하는지, 어떤 느낌인지... 꽃을 처음 보는 손님도 바로 알 수 있게!' },
  { level: 4,  koreanTitle: '파란 눈의 은빛 로봇',           dataAiHint: 'a gray humanoid robot with a square silver head, two round blue glowing eyes, rectangular body, standing straight with arms at sides, plain pure white background, no weapons', rubric: '로봇 설계 도면을 글로 그려봐요!\n\n머리 모양, 몸 색깔, 눈 색깔, 팔과 다리 모양, 자세... 부품 하나하나를 써줄수록 정확한 로봇이 만들어져요.' },
  { level: 5,  koreanTitle: '살아 움직이는 초코칩 쿠키',     dataAiHint: 'a round brown chocolate chip cookie character with two large round white cartoon eyes and a big smiling mouth, two short stick arms and two short stick legs, standing pose, plain pure white background', rubric: '이 캐릭터의 프로필을 써봐요!\n\n어떤 음식이 살아났는지, 색깔·모양, 표정, 팔다리는 어떻게 생겼는지... 더 많이 써줄수록 생생한 캐릭터가 나와요.' },
  { level: 6,  koreanTitle: '마이크 잡고 노래하는 흰 고양이', dataAiHint: 'a white cat standing upright on two legs, holding a round black microphone with one paw, mouth open wide singing, plain pure white background, no stage, no crowd', rubric: '음악 방송 해설자가 되어 이 장면을 중계해봐요!\n\n어떤 동물인지, 색깔, 어떤 자세로 서 있는지, 손에 뭘 들고 있는지, 어떤 행동을 하는지... 생생하게 전달해봐요.' },
  { level: 7,  koreanTitle: '하늘색 배경에 날개 달린 분홍 돼지', dataAiHint: 'a pink cartoon pig with two small round white feathered wings on its back, hovering in midair with a big happy smile, solid light sky-blue background, no clouds, no other objects', rubric: '뉴스 기자가 되어 이 신기한 장면을 보도해봐요!\n\n어떤 동물인지, 특별한 신체 부위, 무엇을 하고 있는지, 배경 색깔과 분위기... 시청자가 그림 없이도 상상할 수 있게 써봐요.' },
  { level: 8,  koreanTitle: '별이 가득한 밤하늘의 잠든 달',  dataAiHint: 'a yellow crescent moon shape with two closed eyes and a peaceful sleeping smile, surrounded by five small white stars, solid dark navy blue background, nothing else', rubric: '동화책의 한 페이지를 글로 써봐요!\n\n달의 모양·색깔·표정, 주변에 무엇이 있는지, 하늘 색깔, 어떤 느낌인지... 독자가 삽화 없이도 그릴 수 있게 묘사해봐요.' },
  { level: 9,  koreanTitle: '살아 움직이는 햄버거 캐릭터',   dataAiHint: 'a hamburger with two large round white cartoon eyes and a wide open smiling mouth, two small round legs, standing upright on a simple light yellow background, no extra props', rubric: '이 캐릭터를 처음 만난 탐험가처럼 관찰 일지를 써봐요!\n\n어떤 생물인지, 눈과 표정, 몸의 모양, 어떤 자세인지, 배경은 어떤 색인지... 발견한 것 모두 기록해봐요.' },
  { level: 10, koreanTitle: '안개 낀 초원의 황금뿔 유니콘',  dataAiHint: 'a white horse with a single straight golden horn on its forehead and a long rainbow-colored mane and tail, standing still in a misty light green meadow, soft golden sunlight from above, no riders, no fairies', rubric: '마법의 생물을 목격한 탐험가의 보고서를 써봐요!\n\n어떤 동물인지, 특별한 부위, 털과 갈기 색깔, 어디에 있는지, 어떤 빛·분위기인지... 믿기 어려운 목격담을 자세히 써봐요.' },
  { level: 11, koreanTitle: '마법사 고양이와 빛나는 마법 책', dataAiHint: 'a small orange tabby cat wearing a purple wizard hat and robe, sitting at a wooden desk, holding a wooden wand, a glowing purple open spell book on the desk, simple gray stone wall background behind', rubric: '이 장면을 영화 대본처럼 묘사해봐요!\n\n등장인물이 무엇인지, 입은 옷, 하는 행동, 책상 위 소품들, 배경... 영화 감독이 그림 없이도 촬영할 수 있게 써봐요.' },
  { level: 12, koreanTitle: '우주를 떠다니는 우주비행사',    dataAiHint: 'an astronaut in a white spacesuit floating in outer space, arms stretched out sideways, blue Earth visible in the upper left, white stars scattered on black background, one ringed planet visible in the far right distance', rubric: '우주에서 찍은 사진을 지구 관제센터에 보고하는 전문가가 되어봐요!\n\n우주비행사 복장, 자세, 배경에 보이는 천체들, 위치, 어떤 느낌인지... 빠짐없이 보고해봐요.' },
  { level: 13, koreanTitle: '네온 빛 미래 도시의 밤거리',    dataAiHint: 'a futuristic night city viewed from street level, three flying cars with glowing blue headlights in the sky, tall skyscrapers with pink and cyan neon signs on the sides, dark sky, no people, no animals', rubric: '미래 여행 가이드북의 한 페이지를 써봐요!\n\n어떤 도시인지, 하늘에 무엇이 있는지, 건물 모양과 빛 색깔, 시간대, 전체적인 분위기... 여행자가 가고 싶어지도록 생생하게 써봐요.' },
  { level: 14, koreanTitle: '빛나는 건물과 물고기 떼의 바닷속 도시', dataAiHint: 'an underwater ocean floor scene with round dome-shaped glowing teal buildings, a school of small colorful tropical fish swimming past in the foreground, hazy blue-green water, faint light rays coming from the surface above, no people, no submarines', rubric: '바닷속 세계를 처음 발견한 탐험가의 일기를 써봐요!\n\n어떤 건물들이 있는지, 건물 모양과 색깔, 어떤 생물들이 지나가는지, 물빛, 빛의 방향과 색... 발견한 모든 것을 기록해봐요.' },
  { level: 15, koreanTitle: '수정 구슬이 떠 있는 마법 도서관', dataAiHint: 'a magical fantasy library interior, tall wooden bookshelves on both walls filled with colorful books, five glowing crystal orbs floating in midair at different heights, warm golden lantern light, stone floor, no people', rubric: '마법 도서관에 처음 들어선 주인공의 눈에 보이는 것을 써봐요!\n\n책장 모양과 크기, 떠 있는 빛의 색깔과 개수, 바닥 재질, 전체 공기의 느낌... 그림 속에 있는 것을 빠짐없이 묘사해봐요.' },
  { level: 16, koreanTitle: '눈 내리는 숲속의 통나무집',     dataAiHint: 'a cozy log cabin in a snowy pine forest at dusk, warm yellow light glowing from two square windows, gray smoke rising from a stone chimney, snowflakes falling, no people, no animals', rubric: '겨울 여행 브이로그의 한 장면을 소개해봐요!\n\n집의 재질과 모양, 창문에서 나오는 빛, 굴뚝 연기, 내리는 눈, 시간대와 분위기... 보는 사람이 따뜻해지게 써봐요.' },
  { level: 17, koreanTitle: '사막 한가운데의 오아시스',      dataAiHint: 'a desert oasis with three tall green palm trees beside a small round clear blue pond, golden sand dunes in the background, bright sun in a clear blue sky, no people, no camels', rubric: '사막 탐험가의 발견 보고서를 써봐요!\n\n야자수 개수와 모양, 연못 색깔, 모래 언덕, 하늘과 태양... 오아시스를 처음 발견한 순간을 기록해봐요.' },
  { level: 18, koreanTitle: '하늘을 나는 고래와 열기구들',   dataAiHint: 'a giant blue whale floating in a bright daytime sky among fluffy white clouds, three colorful striped hot air balloons flying nearby, soft warm sunlight, no people visible, no birds', rubric: '꿈에서 본 장면을 일기로 써봐요!\n\n고래 색깔과 크기, 열기구 개수와 무늬, 구름 모양, 빛의 느낌... 꿈같은 장면을 생생하게 남겨봐요.' },
  { level: 19, koreanTitle: '보름달 아래 성탑 위의 아기 용', dataAiHint: 'a small friendly green dragon sitting on the roof of a gray stone castle tower, a red flag on top of the tower, a large full moon and purple night sky behind, scattered white stars, no fire, no knights', rubric: '판타지 소설의 첫 문단을 써봐요!\n\n용의 색깔과 크기, 앉아 있는 곳, 깃발, 달과 밤하늘 색... 독자를 이야기 속으로 끌어들여봐요.' },
  { level: 20, koreanTitle: '로봇들이 장 보는 미래 야시장',  dataAiHint: 'a lively futuristic night market street with three round friendly robots browsing food stalls, colorful paper lanterns strung overhead, white steam rising from food carts, glowing neon shop signs, no humans', rubric: '미래 도시 다큐멘터리 내레이션을 써봐요!\n\n로봇들의 모습과 행동, 가게와 음식, 등불 색깔, 김이 나는 모습, 거리 전체 분위기... 빠짐없이 담아봐요.' },
];

export const PRACTICE_QUESTIONS: PracticeQuestion[] = raw.map(q => ({
  ...q,
  imageUrl: `/questions/practice-${String(q.level).padStart(2, '0')}.jpg`,
}));
