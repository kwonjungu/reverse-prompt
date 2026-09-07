/**
 * 연구 자료 내보내기 — CSV 직렬화
 *
 * 설계서 §7 "내보내기 CSV는 null 유지·수준 소수 유지·기준 버전 포함,
 * 수식 주입 방지와 한글 인코딩을 확인한다."
 *
 * 지키는 규칙
 *  1. 결측(null)은 빈칸이나 0으로 바꾸지 않는다. 따옴표 없는 NA 토큰으로 쓴다.
 *     문자열은 언제나 따옴표로 감싸므로 값이 "NA"인 글자와 결측 NA가 섞이지 않는다.
 *  2. 수준의 반수준(2.5)과 점수의 소수는 반올림하지 않고 그대로 쓴다.
 *  3. 기준 버전(cueVersion·rubricVersion·schemaVersion·codeCommit)을 열로 포함한다.
 *  4. 수식 주입을 막는다. =, +, -, @, 탭, CR로 시작하는 셀 앞에 작은따옴표를 넣는다.
 *  5. 한글은 UTF-8로 쓰되 엑셀이 코드 페이지를 오인하지 않도록 BOM을 앞에 붙인다.
 *
 * 이 모듈은 저장 스키마를 모르는 순수 직렬화 계층이다. 레코드 → 행 변환은
 * records.ts가 맡는다. 개인 식별 값을 여기서 되살리지 않는다.
 */

/** CSV 한 칸에 넣을 수 있는 값. undefined는 결측과 구분하지 않고 NA로 쓴다. */
export type CsvCell = string | number | boolean | null | undefined;

/** 결측 토큰. 빈 문자열·0과 구분하기 위해 따옴표 없이 쓴다. */
export const CSV_NULL_TOKEN = 'NA';

/** 엑셀이 UTF-8을 인식하도록 붙이는 바이트 순서 표식 */
export const CSV_BOM = '﻿';

/** 엑셀·한글 통계 도구가 함께 읽도록 줄바꿈은 CRLF로 쓴다. */
const EOL = '\r\n';

/**
 * 수식 주입 위험 문자로 시작하는지 검사한다.
 * 스프레드시트가 셀을 수식으로 해석하는 선두 문자와, 앞 칸을 밀어내는 탭·CR를 본다.
 */
const INJECTION_PREFIX = /^[=+\-@\t\r]/;

/**
 * 셀 하나를 직렬화한다.
 *  - null·undefined → NA(따옴표 없음)
 *  - number → 반올림 없이 그대로. NaN·Infinity는 유효한 수가 아니므로 결측으로 쓴다.
 *  - boolean → true/false
 *  - string → 언제나 따옴표로 감싸고 내부 따옴표를 두 번 겹친다. 수식 주입은 앞에 ' 를 넣어 막는다.
 */
export function formatCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return CSV_NULL_TOKEN;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return CSV_NULL_TOKEN;
    // 지수 표기로 바뀌면 통계 도구가 문자열로 읽으므로 일반 표기를 유지한다.
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const guarded = INJECTION_PREFIX.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** 헤더 이름도 같은 규칙으로 감싼다. 열 이름에 사용자 입력이 섞여도 안전하다. */
function formatHeaderCell(name: string): string {
  const guarded = INJECTION_PREFIX.test(name) ? `'${name}` : name;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export interface CsvColumn<T> {
  /** 열 이름. 분석 스크립트가 참조하므로 영문 소문자·언더바로 고정한다. */
  key: string;
  /** 행 하나에서 값을 꺼낸다. 없는 값은 null을 돌려주고 0으로 대체하지 않는다. */
  get: (row: T) => CsvCell;
}

/**
 * 행 배열을 CSV 문자열로 만든다. 반환값은 BOM을 포함하므로 그대로 파일에 쓴다.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((c) => formatHeaderCell(c.key)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => formatCsvCell(c.get(row))).join(','));
  }
  return CSV_BOM + lines.join(EOL) + EOL;
}

/**
 * CSV 본문을 UTF-8 바이트로 만든다. 파일로 쓰거나 응답 본문으로 보낼 때 쓴다.
 * 인코딩을 다른 값으로 바꾸지 않는다.
 */
export function toCsvBytes(csv: string): Uint8Array {
  return new TextEncoder().encode(csv);
}

/** 응답 헤더에 쓸 MIME 타입. charset을 UTF-8로 못 박는다. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
