import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "1206";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// 설문 문항 (오은혜, 최윤정, 신태섭, 2022 - 성인 사회정서역량 척도)
const QUESTIONS = [
  "내가 어떤 기분을 느끼는지 잘 알아차리는 편이다.",
  "내 주변 사람들은 나를 좋아한다고 생각한다.",
  "나는 어려운 일이 생겼을 때 긍정적으로 생각한다.",
  "나는 스트레스를 받았을 때 해결할 수 있는 방법이 있다.",
  "나는 다른 사람의 마음을 잘 이해한다.",
  "내 주변 사람이 화를 내거나 슬퍼할 때 상대의 기분을 이해하려고 노력한다.",
  "나는 친구를 잘 사귄다.",
  "나는 다른 사람에게 일어난 일에 관심이 있다.",
  "나는 나의 일을 방해하는 주변 사람에게 화내지 않는 태도로 멈추라고 말할 수 있다.",
  "나는 내가 결정한 일의 결과가 좋지 않아도 인정할 수 있다.",
];
const MAX_SCORE = QUESTIONS.length * 5;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readResponses() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeResponses(list) {
  ensureStore();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE); // 원자적 쓰기(중간 중단 시 손상 방지)
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("payload too large"));
      resolve(data);
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  // 경로 traversal 방지
  const safePath = path
    .normalize(rel)
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<h1>404 Not Found</h1>");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "GET" && url === "/api/questions") {
    return sendJson(res, 200, { questions: QUESTIONS, maxScore: MAX_SCORE });
  }

  if (method === "POST" && url === "/api/submit") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const affiliation = String(payload.affiliation || "").trim();
      const name = String(payload.name || "").trim();
      const answers = payload.answers;

      if (!affiliation || !name) {
        return sendJson(res, 400, { error: "소속과 이름을 모두 입력해 주세요." });
      }
      if (
        !Array.isArray(answers) ||
        answers.length !== QUESTIONS.length ||
        !answers.every((a) => Number.isInteger(a) && a >= 1 && a <= 5)
      ) {
        return sendJson(res, 400, {
          error: "모든 문항에 1~5점으로 응답해 주세요.",
        });
      }

      const total = answers.reduce((s, a) => s + a, 0);
      const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        affiliation,
        name,
        answers,
        total,
        createdAt: new Date().toISOString(),
      };

      const list = readResponses();
      list.push(record);
      writeResponses(list);

      return sendJson(res, 200, {
        total,
        maxScore: MAX_SCORE,
        name,
        affiliation,
      });
    } catch (err) {
      return sendJson(res, 400, { error: "요청을 처리할 수 없습니다." });
    }
  }

  if (method === "POST" && url === "/api/admin/stats") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      if (String(payload.password || "") !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "암호가 올바르지 않습니다." });
      }

      const list = readResponses();
      const count = list.length;

      const individuals = list.map((r) => ({
        affiliation: r.affiliation,
        name: r.name,
        total: r.total,
        createdAt: r.createdAt,
      }));

      const averageTotal =
        count > 0
          ? Math.round((list.reduce((s, r) => s + r.total, 0) / count) * 100) /
            100
          : 0;

      const perQuestion = QUESTIONS.map((text, qi) => {
        const dist = [0, 0, 0, 0, 0];
        let sum = 0;
        for (const r of list) {
          const v = r.answers?.[qi];
          if (Number.isInteger(v) && v >= 1 && v <= 5) {
            dist[v - 1] += 1;
            sum += v;
          }
        }
        const avg = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
        return { index: qi, text, average: avg, distribution: dist };
      });

      return sendJson(res, 200, {
        count,
        maxScore: MAX_SCORE,
        averageTotal,
        individuals,
        perQuestion,
      });
    } catch (err) {
      return sendJson(res, 400, { error: "요청을 처리할 수 없습니다." });
    }
  }

  if (method === "POST" && url === "/api/admin/reset") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      if (String(payload.password || "") !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "암호가 올바르지 않습니다." });
      }
      writeResponses([]);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: "요청을 처리할 수 없습니다." });
    }
  }

  if (method === "GET") {
    return serveStatic(req, res, url);
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  ensureStore();
  console.log(`성인 사회정서역량 테스트 서버 실행 중: http://localhost:${PORT}`);
});
