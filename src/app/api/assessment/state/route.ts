/**
 * 검사 상태 조회 API.
 *
 * 남은 시간을 서버가 다시 계산해 돌려준다. 브라우저 시계·localStorage를 쓰지 않으므로
 * 새로고침해도 시간이 초기화되지 않는다.
 *
 * 이 경로는 AI를 부르지 않고, 점수·앵커·단서·모범답을 응답에 담지 않는다.
 * 서버 액션과 같은 판정 함수를 쓰므로 화면을 우회해도 결과가 같다.
 */

import { NextResponse } from 'next/server';
import { getAssessmentState } from '@/server/assessment/actions';
import { findForbiddenPayloadKeys } from '@/server/assessment/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getAssessmentState();
    // API 경로에서도 마지막으로 한 번 더 확인한다. 화면 코드와 별개의 그물이다.
    const leaked = findForbiddenPayloadKeys(state);
    if (leaked.length) {
      return NextResponse.json({ ok: false, message: null, items: [] }, { status: 500 });
    }
    return NextResponse.json(state, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    // 실패 사유를 학생 화면에 구현 용어로 알리지 않는다.
    return NextResponse.json(
      {
        ok: false,
        message: '잠시 뒤에 다시 시도해 주세요.',
        items: [],
        phase: null,
        nextQuestionId: null,
        serverNow: Date.now(),
      },
      { status: 401, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
