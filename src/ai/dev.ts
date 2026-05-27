import { config } from 'dotenv';
config();

import '@/ai/flows/suggest-prompt-improvements.ts';
import '@/ai/flows/evaluate-prompt.ts';
import '@/ai/flows/generate-image.ts';
import '@/ai/tools/translate.ts';
