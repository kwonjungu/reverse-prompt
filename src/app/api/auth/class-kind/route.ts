/**
 * 입장 화면의 반 종류 조회(99-1 B5). 연구 수업이면 참가 번호 칸, 일반 수업이면 출석 번호 칸을 보이게 한다.
 *
 * 반이 열려 있고 비밀번호가 맞을 때만 'research'·'general'을 돌려준다. 그 밖은 모두 'unknown'(상태 200)이라
 * 어느 수업 번호가 있는지 드러내지 않는다. 세션을 만들거나 쿠키를 심지 않는다.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const classResearchId = typeof body.classResearchId === 'string' ? body.classResearchId.trim() : '';
    // 반 입장 비밀번호는 다듬지 않고 그대로 대조한다.
    const entryPassword = typeof body.entryPassword === 'string' ? body.entryPassword : '';
    const kind = classResearchId ? await auth.lookupClassEntryKind({ classResearchId, entryPassword }) : 'unknown';
    return NextResponse.json({ kind });
  } catch {
    return NextResponse.json({ kind: 'unknown' });
  }
}
