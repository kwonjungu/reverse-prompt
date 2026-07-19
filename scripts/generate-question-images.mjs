/**
 * 문제 이미지 일괄 사전 생성 스크립트 (Gemini Batch API — 실시간 대비 반값 $0.0195/장)
 *
 * 결과물: public/questions/*.png — 앱은 이 정적 파일만 사용 (런타임 이미지 생성 없음)
 *
 * 사용법:
 *   GEMINI_API_KEY=... node scripts/generate-question-images.mjs           # 배치 제출 + 폴링 + 저장
 *   GEMINI_API_KEY=... node scripts/generate-question-images.mjs --resume batches/XXX  # 기존 배치 이어받기
 *   GEMINI_API_KEY=... node scripts/generate-question-images.mjs --sync    # 배치 대신 즉시 생성 (2배 비용)
 *
 * dataAiHint를 바꾸면 이 파일의 목록도 같이 갱신하고 재실행할 것.
 * 힌트 원본: practice/game/time-attack page.tsx 의 questions 배열.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'questions');
const MODEL = 'gemini-2.5-flash-image';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 또는 GOOGLE_GENAI_API_KEY 필요'); process.exit(1); }

// src/lib/image-prompt.ts buildImagePrompt()와 동일한 wrapper — 변경 시 양쪽 함께
function buildImagePrompt(subject) {
  return (
    `Generate a high-quality image of: ${subject}. ` +
    `Render ONLY what is explicitly described above. ` +
    `Do NOT add clothing, accessories, scarves, collars, hats, or any props not mentioned. ` +
    `Do NOT add text, watermarks, or extra objects. ` +
    `Keep the composition clean and simple.`
  );
}

// key = 저장 파일명 (확장자 제외). ta-03(유니콘)은 game-05와 힌트가 같아 생성 생략(파일 공유).
const ITEMS = [
  // 연습 모드 (레벨 = 파일 번호)
  ['practice-01', 'a small white fluffy puppy sitting, tongue out, plain pure white background, no collar, no accessories, no objects except the puppy'],
  ['practice-02', 'a shiny red apple with a short green stem and one small green leaf, centered on plain pure white background, no other objects'],
  ['practice-03', 'a single bright yellow sunflower facing forward, thick green stem, plain pure white background, no other flowers, no vase'],
  ['practice-04', 'a gray humanoid robot with a square silver head, two round blue glowing eyes, rectangular body, standing straight with arms at sides, plain pure white background, no weapons'],
  ['practice-05', 'a round brown chocolate chip cookie character with two large round white cartoon eyes and a big smiling mouth, two short stick arms and two short stick legs, standing pose, plain pure white background'],
  ['practice-06', 'a white cat standing upright on two legs, holding a round black microphone with one paw, mouth open wide singing, plain pure white background, no stage, no crowd'],
  ['practice-07', 'a pink cartoon pig with two small round white feathered wings on its back, hovering in midair with a big happy smile, solid light sky-blue background, no clouds, no other objects'],
  ['practice-08', 'a yellow crescent moon shape with two closed eyes and a peaceful sleeping smile, surrounded by five small white stars, solid dark navy blue background, nothing else'],
  ['practice-09', 'a hamburger with two large round white cartoon eyes and a wide open smiling mouth, two small round legs, standing upright on a simple light yellow background, no extra props'],
  ['practice-10', 'a white horse with a single straight golden horn on its forehead and a long rainbow-colored mane and tail, standing still in a misty light green meadow, soft golden sunlight from above, no riders, no fairies'],
  ['practice-11', 'a small orange tabby cat wearing a purple wizard hat and robe, sitting at a wooden desk, holding a wooden wand, a glowing purple open spell book on the desk, simple gray stone wall background behind'],
  ['practice-12', 'an astronaut in a white spacesuit floating in outer space, arms stretched out sideways, blue Earth visible in the upper left, white stars scattered on black background, one ringed planet visible in the far right distance'],
  ['practice-13', 'a futuristic night city viewed from street level, three flying cars with glowing blue headlights in the sky, tall skyscrapers with pink and cyan neon signs on the sides, dark sky, no people, no animals'],
  ['practice-14', 'an underwater ocean floor scene with round dome-shaped glowing teal buildings, a school of small colorful tropical fish swimming past in the foreground, hazy blue-green water, faint light rays coming from the surface above, no people, no submarines'],
  ['practice-15', 'a magical fantasy library interior, tall wooden bookshelves on both walls filled with colorful books, five glowing crystal orbs floating in midair at different heights, warm golden lantern light, stone floor, no people'],
  ['practice-16', 'a cozy log cabin in a snowy pine forest at dusk, warm yellow light glowing from two square windows, gray smoke rising from a stone chimney, snowflakes falling, no people, no animals'],
  ['practice-17', 'a desert oasis with three tall green palm trees beside a small round clear blue pond, golden sand dunes in the background, bright sun in a clear blue sky, no people, no camels'],
  ['practice-18', 'a giant blue whale floating in a bright daytime sky among fluffy white clouds, three colorful striped hot air balloons flying nearby, soft warm sunlight, no people visible, no birds'],
  ['practice-19', 'a small friendly green dragon sitting on the roof of a gray stone castle tower, a red flag on top of the tower, a large full moon and purple night sky behind, scattered white stars, no fire, no knights'],
  ['practice-20', 'a lively futuristic night market street with three round friendly robots browsing food stalls, colorful paper lanterns strung overhead, white steam rising from food carts, glowing neon shop signs, no humans'],
  // 게임 모드
  ['game-01', 'a cute puppy with white fur, golden eyes, wagging tail, sitting in a sunny room'],
  ['game-02', 'a bright red shiny apple with a green leaf, on a wooden table, soft morning light'],
  ['game-03', 'a cheerful sunflower with a smiley face, blue sky background, fluffy white clouds'],
  ['game-04', 'a friendly small silver robot waving its hand, white clean background'],
  ['game-05', 'a glowing magical unicorn running through a misty lavender forest at night'],
  ['game-06', 'an orange tabby cat sitting on a wooden windowsill watching rain, raindrops on the window glass, gray sky outside, warm cozy room light inside'],
  ['game-07', 'a small wooden cottage with a red roof in a green meadow under a bright rainbow, colorful wildflowers in the foreground, blue sky with fluffy white clouds'],
  ['game-08', 'a cute brown puppy wearing a small white astronaut helmet floating inside a spaceship cabin, a round window behind showing stars and space'],
  ['game-09', 'a fairy tale castle made of pink and white layered birthday cake, lit candles as towers, a chocolate gate, candy trees around, soft pastel sky'],
  ['game-10', 'a penguin wearing a red knitted scarf ice skating on a frozen lake, snowy pine trees around the lake, soft winter afternoon sunlight'],
  // 타임어택 (ta-03은 game-05 공유)
  ['ta-01', 'a futuristic city with flying cars and towering skyscrapers at night'],
  ['ta-02', 'an astronaut floating in space, stars and planets in the background'],
  ['ta-04', 'an underwater city with glowing buildings and fish swimming by'],
  ['ta-05', 'a robot cat singing on a stage, colorful spotlights, futuristic audience'],
  ['ta-06', 'a hot air balloon festival over rolling green hills at sunrise, many colorful striped balloons floating in an orange and pink sky'],
  ['ta-07', 'a cozy bakery interior with fresh breads and cakes displayed on wooden shelves, warm yellow lighting, a glass display counter'],
  ['ta-08', 'a pirate ship with black sails on stormy ocean waves, dark clouds and lightning in the background, dramatic lighting'],
  // 가이드 예시
  ['guide-example', '수수께끼 같은, 고대의 숲, 빛나는 안개, 거대한 버섯, 귀여운 요정이 날아다니는, 영화 같은 조명, 판타지 아트'],
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...opts,
    headers: { 'x-goog-api-key': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function extractImage(genResponse) {
  const parts = genResponse?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find(p => p.inlineData?.data || p.inline_data?.data);
  if (!img) return null;
  const d = img.inlineData ?? img.inline_data;
  return { data: d.data, mime: d.mimeType ?? d.mime_type ?? 'image/png' };
}

function saveImage(key, image) {
  const file = join(OUT_DIR, `${key}.png`);
  writeFileSync(file, Buffer.from(image.data, 'base64'));
  console.log(`  저장: public/questions/${key}.png (${image.mime})`);
}

async function runSync() {
  for (const [key, hint] of ITEMS) {
    console.log(`생성 중: ${key}`);
    const body = await api(`models/${MODEL}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildImagePrompt(hint) }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    const image = extractImage(body);
    if (!image) { console.error(`  !! ${key}: 이미지 없음 — ${JSON.stringify(body).slice(0, 300)}`); continue; }
    saveImage(key, image);
  }
}

async function submitBatch() {
  const requests = ITEMS.map(([key, hint]) => ({
    request: {
      contents: [{ parts: [{ text: buildImagePrompt(hint) }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    },
    metadata: { key },
  }));
  const op = await api(`models/${MODEL}:batchGenerateContent`, {
    method: 'POST',
    body: JSON.stringify({
      batch: { displayName: 'promptgrader-question-images', inputConfig: { requests: { requests } } },
    }),
  });
  console.log(`배치 제출됨: ${op.name}`);
  return op.name;
}

async function pollAndSave(batchName) {
  const started = Date.now();
  for (;;) {
    const op = await api(batchName);
    const state = op.metadata?.state ?? (op.done ? 'DONE' : 'RUNNING');
    process.stdout.write(`\r상태: ${state} (${Math.round((Date.now() - started) / 1000)}초 경과)   `);
    if (op.done) {
      console.log('');
      if (op.error) throw new Error(`배치 실패: ${JSON.stringify(op.error).slice(0, 400)}`);
      const inlined =
        op.response?.inlinedResponses?.inlinedResponses ??
        op.response?.inlined_responses?.inlined_responses ?? [];
      if (!inlined.length) {
        writeFileSync(join(ROOT, 'batch-debug.json'), JSON.stringify(op, null, 2));
        throw new Error('inlinedResponses 없음 — batch-debug.json 확인');
      }
      let ok = 0;
      inlined.forEach((r, i) => {
        const key = r.metadata?.key ?? ITEMS[i][0];
        if (r.error) { console.error(`  !! ${key}: ${JSON.stringify(r.error).slice(0, 200)}`); return; }
        const image = extractImage(r.response);
        if (!image) { console.error(`  !! ${key}: 응답에 이미지 없음`); return; }
        saveImage(key, image);
        ok++;
      });
      console.log(`완료: ${ok}/${ITEMS.length}장 저장`);
      return;
    }
    if (Date.now() - started > 30 * 60 * 1000) {
      throw new Error(`30분 초과 — 나중에 이어받기: node scripts/generate-question-images.mjs --resume ${batchName}`);
    }
    await sleep(15000);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const args = process.argv.slice(2);
// 이미 생성된 파일은 건너뜀 (--force로 전체 재생성)
// 저장은 .png, 저장소에는 JPEG 압축본(.jpg)을 커밋 — 생성 후 압축 절차는 CLAUDE.md 참고
const alreadyExists = (key) => existsSync(join(OUT_DIR, `${key}.png`)) || existsSync(join(OUT_DIR, `${key}.jpg`));
if (!args.includes('--force') && args[0] !== '--resume') {
  const skipped = ITEMS.filter(([key]) => alreadyExists(key));
  if (skipped.length) console.log(`이미 존재해서 건너뜀: ${skipped.length}장 (${skipped.map(([k]) => k).join(', ')})`);
  const remaining = ITEMS.filter(([key]) => !alreadyExists(key));
  ITEMS.length = 0;
  ITEMS.push(...remaining);
  if (!ITEMS.length) { console.log('생성할 이미지 없음. 끝.'); process.exit(0); }
}
if (args[0] === '--sync') {
  await runSync();
} else if (args[0] === '--resume' && args[1]) {
  await pollAndSave(args[1]);
} else {
  const name = await submitBatch();
  await pollAndSave(name);
}
console.log('끝.');
