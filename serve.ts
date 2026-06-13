import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

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

const send = async (res: any, status: number, file: string) => {
  const body = await readFile(file);
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
};

const server = createServer(async (req, res) => {
  // 경로 정규화 (디렉터리 탈출 방지)
  let path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  if (path === "/" || path === "") path = "/index.html";
  // 확장자 없는 /slug → /slug.html
  if (!extname(path)) path += ".html";

  try {
    await send(res, 200, join(OUT, path));
  } catch {
    try {
      await send(res, 404, join(OUT, "404.html"));
    } catch {
      res.writeHead(404).end("Not Found");
    }
  }
});

server.listen(PORT, () => console.log(`serving ${OUT}/ → http://localhost:${PORT}`));
