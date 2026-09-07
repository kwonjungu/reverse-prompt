/**
 * route 단계의 모드 차단.
 *
 * 설계서 §4·수용시험 7 대응. 화면에서 버튼을 숨기는 것은 차단이 아니므로
 * route·페이지·server action·API가 모두 같은 표(isModeAllowed)로 거부한다.
 * 이 미들웨어는 그 가운데 route 단계를 맡는다.
 *
 * 한계를 분명히 해 둔다. edge에서는 서버 저장소를 조회할 수 없어 세션 성격을
 * 쿠키 힌트로만 읽는다. 힌트를 지우면 여기서는 통과할 수 있으나, 페이지·server
 * action·API가 @/server/auth로 다시 판정하므로 실제 활동은 그대로 막힌다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { modeForPath } from '@/server/lessons/mode-policy';
import { isModeAllowed } from '@/lib/research/session-modes';
import { DEFAULT_SESSION_TYPE, SESSION_HINT_COOKIE, parseSessionHint } from '@/server/lessons/session-cookie';

export function middleware(request: NextRequest) {
  const mode = modeForPath(request.nextUrl.pathname);
  if (!mode) return NextResponse.next();

  const hint = parseSessionHint(request.cookies.get(SESSION_HINT_COOKIE)?.value);
  const sessionType = hint?.sessionType ?? DEFAULT_SESSION_TYPE;

  if (isModeAllowed(sessionType, mode)) return NextResponse.next();

  // API 요청은 그대로 거절하고, 화면 요청은 홈으로 돌려보내며 사유를 남긴다.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ allowed: false, mode }, { status: 403 });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/';
  url.searchParams.set('blocked', mode);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/game/:path*',
    '/time-attack/:path*',
    '/admin/:path*',
    '/assessment/:path*',
    '/practice/:path*',
    '/guide/:path*',
    '/api/audit/:path*',
    '/api/generate/:path*',
  ],
};
