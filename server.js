import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1206";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = (process.env.SUPABASE_SECRET_KEY || "").trim();
const SUPABASE_TABLE = "responses";
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
const supabase = useSupabase
  ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
  : null;

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

function ensureFileStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function rowToRecord(row) {
  let answers = row.answers;
  if (typeof answers === "string") {
    try {
      answers = JSON.parse(answers);
    } catch {
      answers = [];
    }
  }
  return {
    id: row.id,
    affiliation: row.affiliation || "",
    name: row.name || "",
    answers: Array.isArray(answers) ? answers : [],
    total: Number(row.total) || 0,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

async function listResponses() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[Supabase SELECT 에러]", error);
      throw error;
    }
    return (data || []).map(rowToRecord);
  }
  ensureFileStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function insertResponse(record) {
  if (useSupabase) {
    const { error } = await supabase.from(SUPABASE_TABLE).insert({
      id: record.id,
      affiliation: record.affiliation,
      name: record.name,
      answers: record.answers,
      total: record.total,
      created_at: record.createdAt,
    });
    if (error) {
      console.error("[Supabase INSERT 에러]", error);
      throw error;
    }
    return;
  }
  ensureFileStore();
  const list = await listResponses();
  list.push(record);
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

async function clearResponses() {
  if (useSupabase) {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .delete()
      .neq("id", "__none__");
    if (error) {
      console.error("[Supabase DELETE 에러]", error);
      throw error;
    }
    return;
  }
  ensureFileStore();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, "[]", "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
  let filePath = path.join(
    PUBLIC_DIR,
    safePath === "/" ? "index.html" : safePath
  );
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<h1>404 Not Found</h1>");
      }
      res.writeHead(500);
      return res.end("Internal Server Error");
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === "GET" && url === "/api/questions") {
    return sendJson(res, 200, {
      questions: QUESTIONS,
      maxScore: MAX_SCORE,
    });
  }

  if (method === "POST" && url === "/api/submit") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");

      const affiliation = String(payload.affiliation || "").trim();
      const name = String(payload.name || "").trim();
      const answers = payload.answers;

      if (!affiliation) {
        return sendJson(res, 400, { error: "소속을 입력해 주세요." });
      }
      if (!name) {
        return sendJson(res, 400, { error: "이름을 입력해 주세요." });
      }
      if (
        !Array.isArray(answers) ||
        answers.length !== QUESTIONS.length ||
        !answers.every(
          (a) => Number.isInteger(a) && a >= 1 && a <= 5
        )
      ) {
        return sendJson(res, 400, {
          error: "모든 문항에 1~5점 사이로 응답해 주세요.",
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

      await insertResponse(record);

      return sendJson(res, 200, {
        total,
        maxScore: MAX_SCORE,
        name,
        affiliation,
      });
    } catch (err) {
      console.error("[Submit 처리 중 에러 발생]:", err);
      const msg = err && err.message ? err.message : "요청을 처리할 수 없습니다.";
      return sendJson(res, 400, { error: msg });
    }
  }

  if (method === "POST" && url === "/api/admin/stats") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");

      if (String(payload.password || "") !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "암호가 올바르지 않습니다." });
      }

      const list = await listResponses();
      const count = list.length;

      const individuals = list.map((r) => ({
        affiliation: r.affiliation,
        name: r.name,
        total: r.total,
        createdAt: r.createdAt,
      }));

      let averageTotal = 0;
      if (count > 0) {
        const sum = list.reduce((s, r) => s + (r.total || 0), 0);
        averageTotal = Math.round((sum / count) * 10) / 10;
      }

      const perQuestion = QUESTIONS.map((qText, qIdx) => {
        if (count === 0) {
          return {
            index: qIdx + 1,
            text: qText,
            average: 0,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          };
        }
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sumQ = 0;
        list.forEach((r) => {
          const val = r.answers && r.answers[qIdx] ? r.answers[qIdx] : 0;
          if (dist[val] !== undefined) dist[val] += 1;
          sumQ += val;
        });
        const avgQ = Math.round((sumQ / count) * 10) / 10;
        return {
          index: qIdx + 1,
          text: qText,
          average: avgQ,
          distribution: dist,
        };
      });

      return sendJson(res, 200, {
        count,
        maxScore: MAX_SCORE,
        averageTotal,
        individuals,
        perQuestion,
      });
    } catch (err) {
      console.error("[Stats 처리 중 에러]:", err);
      const msg = err && err.message ? err.message : "요청을 처리할 수 없습니다.";
      return sendJson(res, 400, { error: msg });
    }
  }

  if (method === "POST" && url === "/api/admin/reset") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      if (String(payload.password || "") !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "암호가 올바르지 않습니다." });
      }
      await clearResponses();
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error("[Reset 처리 중 에러]:", err);
      const msg = err && err.message ? err.message : "요청을 처리할 수 없습니다.";
      return sendJson(res, 400, { error: msg });
    }
  }

  if (method === "GET") {
    return serveStatic(req, res, url);
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  if (useSupabase) {
    console.log("데이터 저장: Supabase (영구 보존)");
  } else {
    ensureFileStore();
    console.log(
      "데이터 저장: 로컬 파일 data/responses.json (Supabase 환경변수 미설정)"
    );
  }
  console.log(`성인 사회정서역량 테스트 서버 실행 중: http://localhost:${PORT}`);
});
