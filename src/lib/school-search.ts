'use server';

/**
 * NEIS 교육정보 개방 포털 API로 한국 초등학교 검색.
 * 인증키 없이도 동작하지만 운영 환경에선 NEIS_API_KEY 환경 변수에 키를 넣어두면 호출 한도가 늘어남.
 *   - 키 발급: https://open.neis.go.kr/portal/myPage/actKeyPage.do
 */

export type SchoolMatch = {
  code: string;
  name: string;
  region: string;
  address: string;
};

export async function searchSchools(queryStr: string): Promise<SchoolMatch[]> {
  const trimmed = queryStr.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    Type: 'json',
    pSize: '30',
    SCHUL_NM: trimmed,
    SCHUL_KND_SC_NM: '초등학교',
  });

  const apiKey = process.env.NEIS_API_KEY?.trim();
  if (apiKey) params.set('KEY', apiKey);

  try {
    const res = await fetch(`https://open.neis.go.kr/hub/schoolInfo?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('[searchSchools] HTTP', res.status);
      return [];
    }
    const data = await res.json();

    // 정상 응답: { schoolInfo: [{ head: [...] }, { row: [...] }] }
    // 결과 없음: { RESULT: { CODE: "INFO-200", MESSAGE: "..." } }
    const rows = data?.schoolInfo?.[1]?.row;
    if (!Array.isArray(rows)) return [];

    return rows.map((r: any) => ({
      code: String(r.SD_SCHUL_CODE ?? ''),
      name: String(r.SCHUL_NM ?? ''),
      region: String(r.ATPT_OFCDC_SC_NM ?? ''),
      address: String(r.ORG_RDNMA ?? r.ORG_RDNDA ?? ''),
    }));
  } catch (err) {
    console.error('[searchSchools] 호출 실패:', err);
    return [];
  }
}
