/**
 * 모드 허용 여부 조회.
 *
 * 화면 토글이 아니라 이 판정이 차단의 근거다. 세션 성격은 서버가 정하며
 * 클라이언트가 보낸 세션 값은 쓰지 않는다(설계서 §4, 수용시험 7).
 */

import { NextResponse } from 'next/server';
import { checkModeAction } from '@/server/lessons/actions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const mode = new URL(request.url).searchParams.get('mode') ?? '';
  const result = await checkModeAction(mode);
  return NextResponse.json(result, {
    status: result.allowed ? 200 : 403,
    headers: { 'Cache-Control': 'no-store' },
  });
}
