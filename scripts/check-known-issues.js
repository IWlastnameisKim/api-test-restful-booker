// Newman JSON 리포트와 데이터 파일을 비교해, 실패를 "알려진 결함"과 "새 실패"로 나눈다.
//
// 사용법:
//   node scripts/check-known-issues.js --report reports/data.json --data data/booking-cases.json
//   node scripts/check-known-issues.js --report reports/data-patch.json --data data/patch-cases.json --targets "PATCH,수정 후 재조회"
//
// --targets: 판정 대상 요청 이름(쉼표 구분). 이 밖의 요청(토큰 발급, 예약 생성, 정리 등)에서 실패하면
//            결함이 아니라 테스트 준비 실패로 보고 무조건 실패 처리한다. 생략하면 모든 요청이 판정 대상.
//
// 종료 코드: 새 실패, 준비 실패, 실행되지 않은 행, 실행 오류가 하나라도 있으면 1. 알려진 결함의 실패만 있으면 0.

const fs = require("fs");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const reportPath = arg("report");
const dataPath = arg("data");
const targets = arg("targets") ? arg("targets").split(",").map((s) => s.trim()) : null;
if (!reportPath || !dataPath) {
  console.error("사용법: node scripts/check-known-issues.js --report <newman json> --data <데이터 파일> [--targets \"요청1,요청2\"]");
  process.exit(2);
}

const run = JSON.parse(fs.readFileSync(reportPath, "utf8")).run;
const rows = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const problems = []; // 결함과 무관하게 실행을 실패로 만드는 문제

// 1. 반복 횟수가 데이터 행 수와 같은지 (데이터 없이 실행되거나 폴더 지정이 틀린 경우)
const iterations = run.stats.iterations.total;
if (iterations !== rows.length) {
  problems.push(`반복 횟수 ${iterations}회가 데이터 행 수 ${rows.length}개와 다름`);
}

// 2. 검증 실패가 아닌 오류 (요청 실패, 스크립트 오류 등)
for (const f of run.failures || []) {
  if (f.error && f.error.name !== "AssertionError") {
    const it = f.cursor ? f.cursor.iteration + 1 : "?";
    problems.push(`${it}행 실행 오류 (${f.error.name}): ${f.error.message}`);
  }
}

// 3. 행별 실패 assertion 모으기
const byRow = rows.map(() => ({ target: [], setup: [], ran: false }));
for (const ex of run.executions || []) {
  const i = ex.cursor.iteration;
  if (!byRow[i]) continue;
  byRow[i].ran = true;
  const item = ex.item.name;
  for (const a of ex.assertions || []) {
    if (!a.error) continue;
    const isTarget = !targets || targets.includes(item);
    byRow[i][isTarget ? "target" : "setup"].push(`${item}: ${a.assertion}`);
  }
}

// 4. 분류
const result = rows.map((row, i) => {
  const { target, setup, ran } = byRow[i];
  let status;
  if (!ran) status = "NOT_RUN";
  else if (setup.length) status = "SETUP_FAIL";
  else if (target.length) status = row.knownIssue ? "KNOWN_FAIL" : "NEW_FAIL";
  else status = row.knownIssue ? "FIXED?" : "PASS";
  return { id: row.id || `${i + 1}행`, case: row.case, knownIssue: row.knownIssue || "", status, failed: [...setup, ...target] };
});

const count = (s) => result.filter((r) => r.status === s).length;
const summary = {
  PASS: count("PASS"),
  KNOWN_FAIL: count("KNOWN_FAIL"),
  "FIXED?": count("FIXED?"),
  NEW_FAIL: count("NEW_FAIL"),
  SETUP_FAIL: count("SETUP_FAIL"),
  NOT_RUN: count("NOT_RUN"),
};

// 5. 출력
const label = {
  PASS: "통과",
  KNOWN_FAIL: "알려진 결함 (기록만)",
  "FIXED?": "알려진 결함인데 통과 → 수정됐는지 확인하고 knownIssue 제거",
  NEW_FAIL: "새 실패 → 확인 필요",
  SETUP_FAIL: "테스트 준비 실패 (토큰·예약 생성 등) → 확인 필요",
  NOT_RUN: "실행되지 않은 행 → 폴더·데이터 파일 지정 확인",
};
console.log(`\n=== known issue 비교: ${dataPath} ===`);
for (const r of result.filter((r) => r.status !== "PASS" && r.status !== "KNOWN_FAIL")) {
  console.log(`[${r.status}] ${r.id} ${r.case}${r.knownIssue ? ` (knownIssue: ${r.knownIssue})` : ""}`);
  for (const f of r.failed) console.log(`    - ${f}`);
}
for (const p of problems) console.log(`[ERROR] ${p}`);
for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(11)} ${String(v).padStart(3)}  ${label[k]}`);

// GitHub Actions: 실행 화면에 요약 표와 경고 표시
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### known issue 비교: \`${dataPath}\``,
    "",
    "| 분류 | 건수 | 의미 |",
    "| --- | --- | --- |",
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} | ${label[k]} |`),
    "",
  ];
  const notable = result.filter((r) => !["PASS", "KNOWN_FAIL"].includes(r.status));
  if (notable.length) {
    lines.push("| ID | 케이스 | 분류 | knownIssue |", "| --- | --- | --- | --- |");
    for (const r of notable) lines.push(`| ${r.id} | ${r.case} | ${r.status} | ${r.knownIssue} |`);
  }
  for (const p of problems) lines.push("", `- 오류: ${p}`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
if (process.env.GITHUB_ACTIONS) {
  for (const r of result) {
    if (["NEW_FAIL", "SETUP_FAIL", "NOT_RUN"].includes(r.status)) console.log(`::error::${r.status} ${r.id} ${r.case}`);
    if (r.status === "FIXED?") console.log(`::warning::${r.id} ${r.case} - knownIssue ${r.knownIssue}가 통과함. 수정 여부 확인`);
  }
  for (const p of problems) console.log(`::error::${p}`);
}

process.exit(summary.NEW_FAIL || summary.SETUP_FAIL || summary.NOT_RUN || problems.length ? 1 : 0);
