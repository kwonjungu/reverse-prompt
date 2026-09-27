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
import { isLectureBlockedFor, isLecturePath, modeForPath } from '@/server/lessons/mode-policy';
import { isModeAllowed } from '@/lib/research/session-modes';
import { SESSION_HINT_COOKIE, parseSessionHint } from '@/server/lessons/session-cookie';

export function middleware(request: NextRequest) {
  const hint = parseSessionHint(request.cookies.get(SESSION_HINT_COOKIE)?.value);

  // 연수 체험판은 세션 없이 들어오는 경로라 힌트가 없으면 통과시킨다.
  // 연구 세션 힌트가 있으면 막는다(연구 참가 학생이 연구 밖에서 AI 채점 연습을 받지 않게).
  // 연수 server action도 같은 판정을 다시 한다.
  if (isLecturePath(request.nextUrl.pathname)) {
    if (!isLectureBlockedFor(hint?.sessionType)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    url.searchParams.set('blocked', 'lecture');
    return NextResponse.redirect(url);
  }

  const mode = modeForPath(request.nextUrl.pathname);
  if (!mode) return NextResponse.next();

  // 힌트가 없으면 어떤 세션인지 확인할 수 없다. 확인 실패를 허용으로 바꾸지 않는다.
  // 입장하면 /api/auth/session이 힌트를 심으므로, 여기서 막히는 것은 아직 입장하지 않은 요청뿐이다.
  // edge에서는 힌트만 읽으므로 이 판정은 1차 그물이고, server action·API가 다시 판정한다.
  if (hint) {
    if (isModeAllowed(hint.sessionType, mode)) return NextResponse.next();
  }

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
    // /admin(통합 관리 화면)은 관리자 비밀번호 세션으로 막는다. 여기서는 감수 화면만 잡는다.
    '/admin/audit/:path*',
    '/assessment/:path*',
    '/practice/:path*',
    '/guide/:path*',
    '/api/audit/:path*',
    '/api/generate/:path*',
    // 검사 학생용 API(연구자 내려받기 /api/assessment/export는 넣지 않는다).
    '/api/assessment/state/:path*',
    '/api/assessment/start/:path*',
    '/api/assessment/submit/:path*',
    '/api/assessment/failure/:path*',
    // 연수 체험판. 힌트가 없으면 통과하고 연구 세션 힌트만 막는다(위 isLecturePath 분기).
    '/lecture/:path*',
  ],
};
