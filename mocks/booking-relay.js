// 예약 API 중계 서버 (booking-relay)
//
// 09-Service-Cases에서 "서비스가 예약 API를 호출했는가"를 확인하기 위한 테스트 도구입니다.
// reservation-service와 예약 API(Restful-booker) 사이에 두고, 받은 요청을 그대로 예약 API에 전달하면서
// 호출 내역을 기록합니다. 서비스는 평소처럼 동작하고, 테스트는 기록을 조회해 호출 건수를 확인합니다.
//
//   테스트 → reservation-service (케이스용, 3102) → 중계 서버 (3101) → Restful-booker (3001)
//
// 관리 경로 (예약 API 경로와 겹치지 않도록 /_relay 아래에 둠)
//   GET    /_relay/calls   기록 조회   200 [{ method, path, body, status, ms, at }]
//   DELETE /_relay/calls   기록 초기화 204
//   그 밖의 요청은 모두 예약 API로 전달하고 기록합니다.
//
// 실행: npm run relay
//   = node mocks/booking-relay.js --port 3101 --target http://localhost:3001
//   두 값 모두 필수입니다. 빠지면 엉뚱한 곳으로 전달하지 않도록 시작하지 않습니다.
//
// Node.js 기본 모듈만 사용합니다 (추가 설치 없음).

const http = require("http");

// ---------- 설정 읽기 ----------

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const portRaw = arg("port");
const targetRaw = arg("target");
const configErrors = [];
if (!/^\d+$/.test(portRaw || "") || Number(portRaw) <= 0) configErrors.push(`--port: "${portRaw ?? ""}"는 양의 정수여야 함`);
let target;
try {
  target = new URL(targetRaw);
  if (!/^https?:$/.test(target.protocol)) throw new Error();
} catch {
  configErrors.push(`--target: "${targetRaw ?? ""}"는 http:// 또는 https:// 주소여야 함`);
}
if (configErrors.length) {
  console.error("[설정 오류] 중계 서버를 시작하지 않습니다.");
  for (const e of configErrors) console.error(`  - ${e}`);
  console.error("사용법: node mocks/booking-relay.js --port 3101 --target http://localhost:3001");
  process.exit(1);
}
const PORT = Number(portRaw);
const TARGET = targetRaw.replace(/\/$/, "");

// ---------- 호출 기록 ----------

let calls = [];

// 전달하지 않는 헤더: 연결마다 다시 정해지는 값 (fetch가 새로 붙임)
const HOP_BY_HOP = ["host", "connection", "content-length", "transfer-encoding", "keep-alive"];

async function forward(req, raw) {
  const started = Date.now();
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.includes(k)) headers[k] = v;

  let body = raw;
  try { body = raw ? JSON.parse(raw) : undefined; } catch { /* JSON이 아니면 글자 그대로 기록 */ }
  const call = { method: req.method, path: req.url, body, status: null, ms: null, at: new Date().toISOString() };
  calls.push(call);

  try {
    const res = await fetch(`${TARGET}${req.url}`, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) || !raw ? undefined : raw,
    });
    const text = await res.text();
    call.status = res.status;
    call.ms = Date.now() - started;
    console.log(`[중계] ${req.method} ${req.url} → ${res.status} (${call.ms}ms)`);
    const contentType = res.headers.get("content-type");
    return [res.status, contentType ? { "Content-Type": contentType } : {}, text];
  } catch (err) {
    call.ms = Date.now() - started;
    console.log(`[중계] ${req.method} ${req.url} → 예약 API 연결 실패 (${err.message})`);
    return [502, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "RELAY_TARGET_UNAVAILABLE" })];
  }
}

// ---------- 서버 ----------

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;

  const [path] = req.url.split("?");
  if (path === "/_relay/calls" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(calls));
  }
  if (path === "/_relay/calls" && req.method === "DELETE") {
    calls = [];
    res.writeHead(204);
    return res.end();
  }
  if (path.startsWith("/_relay/")) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "NO_ROUTE", method: req.method, path }));
  }

  const [status, headers, text] = await forward(req, raw);
  res.writeHead(status, headers);
  res.end(text);
});

server.listen(PORT, () => {
  console.log(`중계 서버 실행 중: http://localhost:${PORT} → ${TARGET}`);
  console.log("기록 조회 GET /_relay/calls, 초기화 DELETE /_relay/calls\n");
});
