'use server';
/**
 * @fileOverview A tool for translating text to a target language.
 *
 * - translateText - A function that translates text.
 * - TranslateTextInput - The input type for the translateText function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const TranslateTextInputSchema = z.object({
  text: z.string().describe('The text to translate.'),
  targetLanguage: z.string().describe("The target language to translate the text into (e.g., 'en', 'ko')."),
});
export type TranslateTextInput = z.infer<typeof TranslateTextInputSchema>;

const translateTextTool = ai.defineTool(
  {
    name: 'translateText',
    description: 'Translates text to a specified target language.',
    inputSchema: TranslateTextInputSchema,
    outputSchema: z.string(),
  },
  async ({ text, targetLanguage }) => {
    const llmResponse = await ai.generate({
      prompt: `Translate the following text to ${targetLanguage}:\n\n${text}`,
      config: {
        temperature: 0, // Be deterministic for translation
      },
    });
    return llmResponse.text;
  }
);

export async function translateText(input: TranslateTextInput): Promise<string> {
    return translateTextTool(input);
}
