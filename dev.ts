import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { extname, join, normalize } from "node:path";
import { build } from "./build.ts";

const OUT = "dist";
const PORT = Number(process.env.PORT) || 3000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// 페이지에 주입할 라이브 리로드 스니펫 (저장 시 브라우저가 알아서 새로고침)
const RELOAD = `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>`;

// SSE 로 연결된 브라우저들
const clients = new Set<any>();
const notify = () => {
  for (const res of clients) res.write("data: reload\n\n");
};

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];

  // 라이브 리로드 채널
  if (url === "/__reload") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  let path = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, "");
  if (path === "/" || path === "") path = "/index.html";
  if (!extname(path)) path += ".html";

  const ext = extname(path);
  try {
    const file = join(OUT, path);
    if (ext === ".html") {
      const html = await readFile(file, "utf8");
      res.writeHead(200, { "content-type": TYPES[".html"] });
      res.end(html.replace("</body>", `${RELOAD}</body>`));
    } else {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
      res.end(body);
    }
  } catch {
    try {
      const html = await readFile(join(OUT, "404.html"), "utf8");
      res.writeHead(404, { "content-type": TYPES[".html"] });
      res.end(html.replace("</body>", `${RELOAD}</body>`));
    } catch {
      res.writeHead(404).end("Not Found");
    }
  }
});

await build();
server.listen(PORT, () => console.log(`dev → http://localhost:${PORT}  (watching content/, public/)`));

// content/, public/ 변경 감지 → 디바운스 후 재빌드 → 브라우저 새로고침
let timer: ReturnType<typeof setTimeout> | undefined;
const onChange = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await build();
      notify();
    } catch (e) {
      console.error("build failed:", e);
    }
  }, 80);
};

for (const dir of ["content", "public"]) {
  try {
    watch(dir, { recursive: true }, onChange);
  } catch {
    /* 디렉터리 없으면 무시 */
  }
}
