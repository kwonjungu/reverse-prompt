/**
 * 이미지 생성 시 Gemini에 실제로 전송되는 풀 프롬프트를 만드는 단일 진실 공급원.
 * generateImage()와 교사 대시보드 저장 로직이 동일한 텍스트를 참조하게 함.
 */
export function buildImagePrompt(subject: string): string {
  return (
    `Generate a high-quality image of: ${subject}. ` +
    `Render ONLY what is explicitly described above. ` +
    `Do NOT add clothing, accessories, scarves, collars, hats, or any props not mentioned. ` +
    `Do NOT add text, watermarks, or extra objects. ` +
    `Keep the composition clean and simple.`
  );
}
