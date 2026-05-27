'use server';

/**
 * @fileOverview Generates an image from a text prompt using Gemini 2.5 Flash Image.
 *
 * - `generateImage` - A function that generates an image.
 * - `GenerateImageInput` - The input type for the `generateImage` function.
 * - `GenerateImageOutput` - The return type for the `generateImage` function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateImageInputSchema = z.string().describe('The text prompt for image generation.');
export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

const GenerateImageOutputSchema = z.string().describe('The generated image as a data URI.');
export type GenerateImageOutput = z.infer<typeof GenerateImageOutputSchema>;

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
  return generateImageFlow(input);
}

const generateImageFlow = ai.defineFlow(
  {
    name: 'generateImageFlow',
    inputSchema: GenerateImageInputSchema,
    outputSchema: GenerateImageOutputSchema,
    retries: 3,
  },
  async (promptText) => {
    try {
      const { media } = await ai.generate({
        model: 'googleai/gemini-2.5-flash-image',
        prompt: [
          { text: `Generate a high-quality, detailed image of: ${promptText}` }
        ],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      if (!media || !media.url) {
        throw new Error('AI 모델이 이미지를 반환하지 않았습니다. 프롬프트를 조금 더 자세히 작성해 보세요.');
      }

      return media.url;
    } catch (error: any) {
      console.error('Image Generation Error:', error);
      if (error.message?.includes('API_KEY_INVALID')) {
        throw new Error('API 키가 올바르지 않습니다. 관리자에게 문의하세요.');
      }
      throw new Error('이미지 생성 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
    }
  }
);
