/**
 * 인증 API 경로가 공유하는 오류 변환.
 * 오류 본문에 원문 입력·토큰·자격정보를 넣지 않는다.
 */

import { NextResponse } from 'next/server';
import { AuthError } from '@/server/auth/contract';

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    const status =
      error.code === 'unauthenticated' ? 401 : error.code === 'forbidden' ? 403 : 503;
    return NextResponse.json({ error: error.code, message: error.message }, { status });
  }
  // 예기치 못한 오류의 상세는 서버 로그에만 남기고 응답에는 넣지 않는다.
  console.error('[api/auth] 처리 실패');
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}
