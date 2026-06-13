# wiki

빌드 도구·트랜스파일러 없이 **Node + Markdown** 만으로 동작하는 미니멀 정적 위키.
Node 25의 TypeScript 타입 스트리핑을 사용하므로 `.ts`를 그대로 실행합니다.

## 사용법

```bash
npm install      # marked 하나만 설치
npm run build    # content/*.md → dist/*.html
npm run serve    # dist/ 를 http://localhost:3000 으로 서빙
npm run dev      # build + serve
```

## 구조

| 경로 | 역할 |
|---|---|
| `content/*.md` | 글 (파일명 = URL slug, 첫 `# 제목` = 페이지 제목) |
| `content/topics.json` | 사이드바 노출 순서 (선택, 없으면 알파벳순) |
| `public/*` | 정적 자산 (`style.css` 등) → `dist/`로 복사 |
| `build.ts` | Markdown → 정적 HTML 생성기 |
| `serve.ts` | 의존성 0 미리보기 서버 |
| `dist/` | 빌드 결과물 (정적 호스팅 대상) |

## 새 글 추가

`content/` 에 `.md` 파일을 만들고 첫 줄에 `# 제목`을 쓰면 끝.
순서를 지정하려면 `content/topics.json` 배열에 slug를 추가.

## 배포

`dist/` 는 순수 정적 파일이므로 Cloudflare Pages·Vercel·Netlify·GitHub Pages 등
어떤 정적 호스팅에도 그대로 올릴 수 있습니다 (런타임 서버 불필요).
