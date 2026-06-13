import { readFile, readdir, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { marked } from "marked";

const CONTENT = "content";
const PUBLIC = "public";
const OUT = "dist";

// 배포 하위 경로 (예: GitHub 프로젝트 페이지 → "/wiki"). 로컬은 빈 문자열.
// 끝 슬래시는 제거해 `${BASE}/foo` 형태로 항상 일관되게 사용.
const BASE = (process.env.BASE ?? "").replace(/\/$/, "");

type Topic = { slug: string; title: string; html: string };

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 본문 첫 번째 `# 제목` 줄을 페이지 제목으로 사용 (없으면 slug)
const titleOf = (md: string, slug: string) =>
  md.match(/^#\s+(.+?)\s*$/m)?.[1] ?? slug;

// content/topics.json 이 있으면 그 순서대로, 없으면 알파벳순 정렬
async function order(slugs: string[]): Promise<string[]> {
  const path = `${CONTENT}/topics.json`;
  if (!existsSync(path)) return [...slugs].sort();
  const wanted: string[] = JSON.parse(await readFile(path, "utf8"));
  const known = new Set(slugs);
  const ordered = wanted.filter((s) => known.has(s));
  const rest = slugs.filter((s) => !wanted.includes(s)).sort();
  return [...ordered, ...rest];
}

function layout(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
	<title>${escape(title)}</title>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width">
	<link rel="stylesheet" href="${BASE}/style.css">
</head>
<body>
	<header>
		<a id="home-link" href="${BASE}/"><img src="${BASE}/logo.png" alt="home"></a>
	</header>
	<main>${body}</main>
</body>
</html>
`;
}

export async function build() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const files = existsSync(CONTENT)
    ? (await readdir(CONTENT)).filter((f) => f.endsWith(".md"))
    : [];

  // index.md 는 홈 전용 → 토픽 목록에서 제외
  const slugs = files.map((f) => f.replace(/\.md$/, "")).filter((s) => s !== "index");
  const sorted = await order(slugs);

  const topics: Topic[] = [];
  for (const slug of sorted) {
    const md = await readFile(`${CONTENT}/${slug}.md`, "utf8");
    topics.push({
      slug,
      title: titleOf(md, slug),
      html: await marked.parse(md),
    });
  }

  // 토픽 페이지 (본문 첫 `# 제목`이 그대로 main h1 이 됨)
  for (const t of topics) {
    await writeFile(`${OUT}/${t.slug}.html`, layout(t.title, t.html));
  }

  // 홈 — content/index.md 를 본문으로 사용하고 Topics 목록을 끼워넣음
  const list = `<h2>Topics</h2>\n<ul>${topics
    .map((t) => `<li><a href="${BASE}/${t.slug}">${escape(t.title)}</a></li>`)
    .join("")}</ul>`;

  let homeTitle = "wiki";
  let homeBody: string;
  if (existsSync(`${CONTENT}/index.md`)) {
    const md = await readFile(`${CONTENT}/index.md`, "utf8");
    homeTitle = titleOf(md, "wiki");
    const rendered = await marked.parse(md);
    // `<!-- topics -->` 자리에 목록 삽입, 없으면 본문 끝에 추가
    homeBody = rendered.includes("<!-- topics -->")
      ? rendered.replace("<!-- topics -->", list)
      : `${rendered}\n${list}`;
  } else {
    homeBody = `<h1>wiki</h1>\n<p>Markdown으로 작성하는 미니멀 위키입니다.</p>\n${list}`;
  }
  await writeFile(`${OUT}/index.html`, layout(homeTitle, homeBody));

  // 404
  await writeFile(
    `${OUT}/404.html`,
    layout("Not Found", "<h1>404</h1>\n<p>페이지를 찾을 수 없습니다.</p>"),
  );

  // 정적 자산 복사 (public/* → dist/)
  if (existsSync(PUBLIC)) await cp(PUBLIC, OUT, { recursive: true });

  console.log(`built ${topics.length} topic(s) → ${OUT}/`);
}

// `node build.ts` 로 직접 실행할 때만 빌드 (dev.ts 에서 import 시에는 실행 안 함)
if (import.meta.main) await build();
