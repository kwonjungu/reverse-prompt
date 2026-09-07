/**
 * 검사 응답 제출 API.
 *
 * 같은 submissionId로 다시 오면 최초 값을 바꾸지 않고 거절 기록만 남긴다.
 * 더블클릭·네트워크 재시도가 모두 이 경로로 모이므로 이중 저장이 생기지 않는다.
 *
 * 응답에 점수·피드백이 없다. 채점은 수집이 끝난 뒤 별도 작업이 한다.
 * 클라이언트가 보낸 밴드·이미지·시점·점수는 받지 않는다.
 */

import { NextResponse } from 'next/server';
import { submitAssessmentResponse } from '@/server/assessment/actions';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { stored: false, duplicate: false, message: '다시 눌러 주세요.' },
      { status: 400, headers: noStore }
    );
  }

  const input = body as Record<string, unknown>;
  const submissionId = typeof input.submissionId === 'string' ? input.submissionId : '';
  const questionId = typeof input.questionId === 'string' ? input.questionId : '';
  const text = typeof input.text === 'string' ? input.text : '';

  if (!submissionId || !questionId) {
    return NextResponse.json(
      { stored: false, duplicate: false, message: '다시 눌러 주세요.' },
      { status: 400, headers: noStore }
    );
  }

  try {
    const result = await submitAssessmentResponse({ submissionId, questionId, text });
    return NextResponse.json(result, { headers: noStore });
  } catch {
    // 저장 실패를 성공 화면으로 표시하지 않는다.
    return NextResponse.json(
      { stored: false, duplicate: false, message: '아직 저장되지 않았어요. 다시 눌러 주세요.' },
      { status: 500, headers: noStore }
    );
  }
}
