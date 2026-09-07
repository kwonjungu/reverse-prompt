/**
 * 학생 세션 토큰 갱신.
 *
 * 폐기된 세션은 갱신하지 않는다. 동의가 철회되었으면 갱신 시점에 연구ID를 떼어
 * 새 전송·추가 채점 작업을 막는다. 기존 자료는 이 경로에서 지우지 않는다.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/server/auth';
import { SESSION_HINT_COOKIE, SESSION_TOKEN_COOKIE } from '@/server/lessons/session-cookie';
import { authErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const issued = await auth.refreshStudentSession();
    const response = NextResponse.json({
      sessionType: issued.claims.sessionType,
      researchCollectionEnabled: issued.claims.researchId !== null,
      expiresAt: new Date(issued.claims.exp).toISOString(),
    });
    response.cookies.set(SESSION_TOKEN_COOKIE, issued.token, issued.cookieOptions);
    response.cookies.set(SESSION_HINT_COOKIE, issued.hint, {
      ...issued.cookieOptions,
      httpOnly: false,
    });
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
