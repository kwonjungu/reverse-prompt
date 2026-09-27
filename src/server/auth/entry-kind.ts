/**
 * 입장 화면이 어떤 칸을 보여 줄지 정하는 반 종류 조회(99-1 B5) — 순수 함수.
 *
 * 연구 수업이면 참가 번호 칸을 바로 보이고, 출석 번호 칸은 일반 수업에서만 보인다.
 * 반 종류는 **반이 열려 있고 비밀번호가 맞을 때만** 알려 준다. 없는 반·닫힌 반·틀린 비밀번호는 모두 'unknown'이라
 * 입장 거절 문구와 같이 어느 수업 번호가 실제로 있는지 드러내지 않는다(비밀번호 없는 반은 입장으로도 이미 드러난다).
 * 저장소 조회와 해시 대조는 부르는 쪽(auth.lookupClassEntryKind)이 주입한다.
 */

export type EntryKind = 'research' | 'general' | 'unknown';

export async function entryKindOf(
  classData: Record<string, unknown> | null,
  entryPassword: string,
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
): Promise<EntryKind> {
  if (!classData || classData.active !== true) return 'unknown';
  const hash = classData.entryPassword;
  if (typeof hash === 'string' && hash) {
    if (!entryPassword) return 'unknown';
    let ok = false;
    try {
      ok = await verifyPassword(entryPassword, hash);
    } catch {
      ok = false;
    }
    if (!ok) return 'unknown';
  }
  return classData.sessionType === 'research_practice' || classData.sessionType === 'research_assessment'
    ? 'research'
    : 'general';
}
