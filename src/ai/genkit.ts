import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';
import {EVALUATION_MODEL_ID} from '@/server/config';

/**
 * @fileOverview Genkit AI 설정 파일.
 * API 키는 환경 변수(GOOGLE_GENAI_API_KEY 또는 GEMINI_API_KEY)에서 읽어옵니다.
 *
 * 기본 모델 ID는 서버 설정 단일 지점(src/server/config.ts)에서 가져옵니다.
 * 여기에 모델명을 새로 적어 넣지 않습니다. 실제 사용 가능한 값인지는 운영자가
 * 착수 검수에서 확인하고 환경 변수로 지정합니다.
 */

const apiKey =
  process.env.GOOGLE_GENAI_API_KEY ||
  process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error(
    'Missing GOOGLE_GENAI_API_KEY (or GEMINI_API_KEY). ' +
    'Set it in .env.local or in your hosting platform environment variables.'
  );
}

export const ai = genkit({
  plugins: [
    googleAI({
      apiKey,
    }),
  ],
  model: EVALUATION_MODEL_ID,
});
