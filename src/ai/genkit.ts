import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit AI 설정 파일.
 * API 키는 환경 변수(GOOGLE_GENAI_API_KEY 또는 GEMINI_API_KEY)에서 읽어옵니다.
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
  model: 'googleai/gemini-2.5-flash',
});
