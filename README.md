# 나는 프롬프트 마스터 (Prompt Master)

초등학생을 위한 AI 프롬프트 엔지니어링 학습 웹앱.

- **학생 페이지:** `/` (학급 코드 + 출석 번호로 입장)
- **교사 대시보드:** `/teacher`

## 기술 스택

- Next.js 15 (App Router, Turbopack)
- Genkit + Gemini 1.5 Flash
- Firebase (Firestore + Anonymous Auth)
- shadcn/ui + Tailwind CSS

## 로컬 실행

```bash
git clone https://github.com/<user>/promptgrader.git
cd promptgrader
npm install

# 환경 변수 설정
cp .env.example .env.local
# .env.local 열어서 본인 키 채우기
#  - GOOGLE_GENAI_API_KEY: https://aistudio.google.com/app/apikey
#  - NEXT_PUBLIC_FIREBASE_*: Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → 구성

npm run dev   # http://localhost:9002
```

AI 플로우(Genkit)를 별도로 띄우려면:

```bash
npm run genkit:dev
```

## 호스팅 (Firebase App Hosting)

1. Firebase 콘솔에서 App Hosting 백엔드를 만들고 이 GitHub repo 연결
2. **Secret/환경 변수** 탭에서 아래 키 등록:
   - `GOOGLE_GENAI_API_KEY` (Secret)
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
3. main 브랜치에 푸시하면 자동 배포

## 환경 변수 목록

`.env.example` 참고. `NEXT_PUBLIC_*`는 클라이언트 번들에 인라인되므로 진짜 secret이 아니어야 함. 서버 전용 키는 `GOOGLE_GENAI_API_KEY` 등 접두어 없는 변수로.
