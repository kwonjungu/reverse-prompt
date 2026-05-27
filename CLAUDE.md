# PromptGrader (reverse-prompt) — 개발 메모

초등학생용 AI 프롬프트 엔지니어링 학습 웹앱. 그림을 보고 한국어로 설명을 적으면 Gemini가 채점·피드백.

## 실행

```bash
npm install
npm run dev           # http://localhost:9002 (Turbopack)
npm run build         # 프로덕션 빌드 (Vercel과 동일 환경 검증용)
npm run typecheck     # tsc --noEmit
npm run genkit:dev    # Genkit 플로우 격리 실행 (선택)
```

## 배포

- **호스팅**: Vercel (자동 배포 — `main` 푸시하면 빌드)
- **GitHub**: https://github.com/kwonjungu/reverse-prompt
- **Firebase 프로젝트**: `promptgrader` (NOT `promptgrader-jun` — 옛 config.ts 잔재였음)
- **Firestore**: 프로덕션 모드 + 학교 내부용 임시 규칙 (`allow read, write: if true`)
- **Firestore 리전**: asia-northeast3 (서울)

## 환경 변수 (Vercel 대시보드에서 등록)

| 키 | 용도 | 비고 |
|---|---|---|
| `GOOGLE_GENAI_API_KEY` | Genkit Gemini 호출 (서버) | 누락 시 `genkit.ts`에서 throw |
| `GEMINI_API_KEY`, `GEMINI_API_KEYS` | 대체/풀 키 (현재 미사용) | `.env` 잔재 |
| `NEXT_PUBLIC_FIREBASE_*` 6개 | Firebase 클라이언트 SDK | apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId |
| `NEIS_API_KEY` | 학교 검색 호출 한도 ↑ | 선택. 없어도 동작하지만 throttle 됨. 키 발급: https://open.neis.go.kr/portal/myPage/actKeyPage.do |

`.env`는 gitignore. `.env.example`이 템플릿.

## 아키텍처

- **Next.js 15.3.8** App Router + Turbopack + React 18.3
- **Genkit 1.27** + `@genkit-ai/google-genai` (서버 액션)
- **Firebase 11.9** 클라이언트 SDK만 (Anonymous Auth는 코드상 호출 X, Firestore만 사용)
- **shadcn/ui** + Tailwind CSS

### 디렉토리

```
src/
  app/
    page.tsx              # 학교 검색 + 학년/반/번호 입장 폼
    practice/page.tsx     # 연습 모드 (Firestore 저장 O)
    game/page.tsx         # 5문제 게임 (한 세션 결과 일괄 저장)
    time-attack/page.tsx  # 시간 제한 (한 세션 결과 일괄 저장)
    teacher/page.tsx      # 학급 코드로 결과 조회 (탭: 연습/시험)
    guide/page.tsx        # 설명 모드 (정적 콘텐츠)
  ai/
    genkit.ts             # Genkit 초기화 (기본 모델: gemini-2.5-flash)
    flows/
      evaluate-prompt.ts  # 학생 프롬프트 채점 (gemini-2.5-flash, temp 0.5)
      generate-image.ts   # 이미지 생성 (gemini-2.5-flash-image)
      suggest-prompt-improvements.ts
    tools/translate.ts
  firebase/               # 클라이언트 Firestore 훅 (useFirestore, useCollection, useDoc)
  lib/
    image-prompt.ts       # buildImagePrompt() — 이미지 생성 풀 프롬프트 단일 진실
    school-search.ts      # NEIS Open API (서버 액션)
    utils.ts              # cn() 등
  components/
    school-picker.tsx     # 디바운스 typeahead 학교 검색
    ui/                   # shadcn 컴포넌트
```

## Firestore 스키마

학급 코드 포맷: **`{NEIS_schoolCode}_{grade}-{class}`** (예: `7531234_3-2`)

```
classes/
  {classCode}/
    submissions/{auto}            # 게임·시간제한 결과 (세션당 1 doc)
      attendanceNumber: string
      nickname: string
      mode: "game" | "time-attack"
      averageScore: number
      createdAt: serverTimestamp
      results: Array<{
        questionIndex: number
        originalPrompt: string    # buildImagePrompt 풀 텍스트
        studentPrompt: string
        score: number
        feedback: string
      }>

    practice_attempts/{auto}      # 연습 모드 (도전 1회당 1 doc)
      attendanceNumber: string
      questionIndex: number
      originalPrompt: string      # buildImagePrompt 풀 텍스트
      studentPrompt: string
      score: number
      feedback: string
      createdAt: serverTimestamp
```

교사 페이지는 `practice_attempts`를 학생→문제→시간순으로 그룹화해서 차수별 변화 표시 (점수 변화량 뱃지 +N/-N).

## 중요한 결정과 함정

### 1) "원본 프롬프트"는 wrapper 포함한 풀 텍스트
`questions[].dataAiHint`는 주제(`"a cute puppy, white background"`)일 뿐, 실제로 Gemini에 전송되는 건 `buildImagePrompt()`가 만드는 `"Generate a high-quality, detailed image of: ${subject}"`. Firestore `originalPrompt`에는 후자 저장 — 교사 대시보드에 진짜 프롬프트가 보이게.

### 2) 평가 프롬프트 (evaluate-prompt.ts)
- 모델: `gemini-2.5-flash` (1회 ~₩2). pro로 올리지 말 것 (학교 예산).
- 점수 범위 0~100, 100점 금지 규칙 **없음** (사용자 요구로 제거됨).
- 채점 기준 3축: **대상 / 시각 묘사 / 맥락**.
- 피드백 강제 2줄: 단어 인용 칭찬 1줄 + 부족한 축 1개 지적 + 단어 제안 2개.
- "대단해요/감동/최고" 같은 추상 칭찬은 금지로 명시.
- 실패 시 catch가 점수 0 + 에러 메시지 반환 (예전 fallback 85+하드코딩 문구는 제거).

### 3) 학교 검색은 NEIS Open API
- `https://open.neis.go.kr/hub/schoolInfo` (`SCHUL_KND_SC_NM=초등학교` 필터)
- 키 없어도 동작하지만 한 교실(~30명) 동시 입장 시 throttle 가능 → `NEIS_API_KEY` 환경 변수 권장
- 학교 코드는 `SD_SCHUL_CODE` 사용 (시도별 변경 가능성 낮음)

### 4) 인증 없음
- Firebase Auth(Anonymous, Google, 무엇이든) **사용 안 함**. `useUser` 훅은 있지만 어디서도 `signIn*()` 호출 X.
- 학생 식별은 sessionStorage(`classCode`, `school`, `grade`, `classNumber`, `attendanceNumber`)만으로.
- 따라서 Firebase 콘솔의 "승인된 도메인" 등록 불필요.

### 5) Firestore 보안 규칙
현재 `allow read, write: if true` — 학교 내부망용 임시 규칙. 일반 공개 서비스로 돌릴 거면 학교코드+학년+반 기반 토큰 검증 등 필요. 콘솔: https://console.firebase.google.com/project/promptgrader/firestore/rules

### 6) Next 15 호환
- `next.config.ts`의 `serverActions`은 `experimental.serverActions`로 위치 이동 완료.
- 이미지 도메인: `placehold.co` 만 허용 중 — 다른 외부 이미지 추가 시 `remotePatterns` 확장.

## 알려진 한계

- 연습 모드 차수 카운트는 `questionIndex` 기준 — 학생이 "다음 문제"로 넘어갔다 돌아와도 같은 questionIndex면 N차로 누적. 의도된 동작이지만 UI상 명시 X.
- Firestore 규칙이 완전 개방이라 누구나 다른 학급 데이터 조회 가능 (학급 코드만 알면).
- NEIS API는 가끔 한국 외 리전에서 응답 느림.
- 게임/시간제한 모드는 평가 실패해도 0점으로 결과 저장됨 (Firestore에 들어감).
- `package-lock.json` 커밋됨 — npm 사용 가정. yarn/pnpm 쓰면 lockfile 충돌.

## 자주 손볼 만한 곳

| 원하는 변경 | 건드릴 파일 |
|---|---|
| 평가 기준·말투 조정 | `src/ai/flows/evaluate-prompt.ts` 안 프롬프트 텍스트 |
| 연습 문제 추가/수정 | `src/app/practice/page.tsx` 상단 `questions` 배열 |
| 게임 문제 변경 | `src/app/game/page.tsx` 상단 `questions` 배열 |
| 이미지 생성 프롬프트 wrapper | `src/lib/image-prompt.ts` |
| 모델 교체 | `src/ai/genkit.ts` + `src/ai/flows/*.ts` 각 `model:` |
| 교사 대시보드 컬럼 | `src/app/teacher/page.tsx` 의 `<Table>` |

## 복구 기록

이 프로젝트는 Firebase Studio 다운로드 중간에 잘린 zip 12개를 Python `zipfile`로 local-file-header 단위 복구해서 만든 거. `_recover/merged/`가 원본 머지본. 이후 `C:/Users/권준구/projects/promptgrader/`로 정리.

복구 후 추가로 손본 핵심 변경:
- API 키 코드 하드코딩 → 환경 변수
- `gemini-1.5-flash` (deprecated) → `gemini-2.5-flash`
- `.idx/`, `gemini-canvas-prompt.md`, 중복 src 트리 정리
- 학급 코드 → 학교+학년+반+번호 (NEIS 연동)
- 연습 모드 차수별 데이터 수집
- 원본 프롬프트 풀 텍스트 저장

## 자주 쓰는 콘솔 URL

- Firestore 데이터: https://console.firebase.google.com/project/promptgrader/firestore/data
- Firestore 규칙: https://console.firebase.google.com/project/promptgrader/firestore/rules
- Firebase 웹 앱 config: https://console.firebase.google.com/project/promptgrader/settings/general
- Vercel 대시보드: https://vercel.com/dashboard (kwonjungu 계정)
