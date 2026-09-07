/**
 * 문항 열기 API.
 *
 * 시작 시각은 서버가 정한다. 이미 열려 있는 문항은 시작 시각을 다시 쓰지 않으므로
 * 새로고침·재접속으로 제한시간이 늘어나지 않는다.
 * 클라이언트가 시작 시각이나 제한시간을 보내지 않는다.
 */

import { NextResponse } from 'next/server';
import { startAssessmentItem } from '@/server/assessment/actions';
import { findForbiddenPayloadKeys } from '@/server/assessment/session';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(request: Request) {
  // 요청의 questionId는 참고 값일 뿐이며, 실제로 열 문항은 서버가 정한다.
  let questionId: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    questionId = typeof body.questionId === 'string' && body.questionId ? body.questionId : null;
  } catch {
    questionId = null;
  }

  try {
    const state = await startAssessmentItem(questionId);
    const leaked = findForbiddenPayloadKeys(state);
    if (leaked.length) {
      return NextResponse.json({ ok: false, message: null, items: [] }, { status: 500, headers: noStore });
    }
    return NextResponse.json(state, { headers: noStore });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: '잠시 뒤에 다시 시도해 주세요.',
        items: [],
        phase: null,
        nextQuestionId: null,
        serverNow: Date.now(),
      },
      { status: 401, headers: noStore }
    );
  }
}
