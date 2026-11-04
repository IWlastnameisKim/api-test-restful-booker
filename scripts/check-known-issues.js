// Newman JSON 리포트를 알려진 결함 목록과 비교해, 실패를 "알려진 결함"과 "새 실패"로 나눈다.
// 새 실패나 준비 실패가 있으면 그 부분만 한 번 더 실행해서, 일시적인 환경 문제인지 확인한다.
//
// 1) 데이터 기반 테스트 (행 단위 판정): 데이터 파일의 knownIssue 필드를 기준으로 한다.
//   node scripts/check-known-issues.js --report reports/data.json --data data/booking-cases.json
//   node scripts/check-known-issues.js --report reports/data-patch.json --data data/patch-cases.json --targets "PATCH,수정 후 재조회"
//   --targets: 판정 대상 요청 이름(쉼표 구분). 이 밖의 요청(토큰 발급, 예약 생성, 정리 등)에서 실패하면
//              결함이 아니라 테스트 준비 실패(SETUP_FAIL)로 본다. 생략하면 모든 요청이 판정 대상.
//
// 2) 일반 테스트 (태그 단위 판정): 테스트 이름에 들어 있는 결함 태그([Bug-1] 등)를 기준으로 한다.
//   node scripts/check-known-issues.js --report reports/regression.json --known data/regression-known-issues.json
//   node scripts/check-known-issues.js --report reports/smoke.json          (--known 생략: 알려진 결함 없음)
//   목록에 있는 태그가 붙은 테스트의 실패만 알려진 결함으로 보고, 그 밖의 실패는 모두 새 실패로 본다.
//
// 재실행: NEW_FAIL, SETUP_FAIL이 있으면 그 부분만 한 번 더 실행한다.
//   - 데이터 기반: 실패한 행만 골라 다시 실행
//   - 일반 테스트: 처음 실행한 폴더 전체를 다시 실행 (요청끼리 값을 주고받기 때문)
//   재실행에서 예상대로 나오면 RETRY_OK(일시적인 환경 문제로 판단, 경고만), 또 실패하면 원래 상태를 유지한다.
//   재실행에는 첫 실행 리포트에 들어 있는 컬렉션·환경(baseUrl 등)과 실행한 폴더를 그대로 사용한다.
//   재실행 리포트: <리포트 이름>-retry.html / -retry.json
//   --no-retry: 재실행하지 않고 첫 실행 결과로만 판정
//
// 종료 코드: 새 실패, 준비 실패, 실행되지 않은 케이스, 실행 오류가 하나라도 남아 있으면 1.
//           알려진 결함의 실패, 재실행으로 통과한 실패(RETRY_OK)만 있으면 0.

const fs = require("fs");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const reportPath = arg("report");
const dataPath = arg("data");
const knownPath = arg("known");
const targets = arg("targets") ? arg("targets").split(",").map((s) => s.trim()) : null;
const noRetry = process.argv.includes("--no-retry");
if (!reportPath) {
  console.error("사용법: node scripts/check-known-issues.js --report <newman json> [--data <데이터 파일> [--targets \"요청1,요청2\"] | --known <알려진 결함 목록>] [--no-retry]");
  process.exit(2);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const OK_ON_RETRY = ["PASS", "KNOWN_FAIL", "FIXED?"]; // 재실행에서 이렇게 나오면 예상대로 동작한 것
const RETRY_TARGET = ["NEW_FAIL", "SETUP_FAIL"]; // 재실행 대상

// ---------- 판정: 데이터 기반 (행 단위) ----------
function judgeData(run, rows) {
  const problems = [];
  if (run.stats.iterations.total !== rows.length) {
    problems.push(`반복 횟수 ${run.stats.iterations.total}회가 데이터 행 수 ${rows.length}개와 다름`);
  }
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
  // 검증 실패가 아닌 오류(연결 실패, 스크립트 오류 등): 몇 번째 행인지 알면 그 행의 준비 실패로 본다
  for (const f of run.failures || []) {
    if (!f.error || f.error.name === "AssertionError") continue;
    const i = f.cursor ? f.cursor.iteration : undefined;
    const msg = `${(f.source && f.source.name) || "?"}: 실행 오류 (${f.error.name}) ${f.error.message}`;
    if (byRow[i]) byRow[i].setup.push(msg);
    else problems.push(msg);
  }
  const result = rows.map((row, i) => {
    const { target, setup, ran } = byRow[i];
    let status;
    if (!ran) status = "NOT_RUN";
    else if (setup.length) status = "SETUP_FAIL";
    else if (target.length) status = row.knownIssue ? "KNOWN_FAIL" : "NEW_FAIL";
    else status = row.knownIssue ? "FIXED?" : "PASS";
    return { key: row.id || `${i + 1}행`, index: i, id: row.id || `${i + 1}행`, case: row.case, knownIssue: row.knownIssue || "", status, failed: [...setup, ...target] };
  });
  return { result, problems };
}

// ---------- 판정: 일반 테스트 (태그 단위) ----------
function judgeTags(run, known) {
  const assertions = [];
  for (const ex of run.executions || []) {
    for (const a of ex.assertions || []) assertions.push({ item: ex.item.name, name: a.assertion, failed: !!a.error });
  }
  const tagOf = (name) => known.find((k) => name.includes(k.tag));

  const result = known.map((k) => {
    const mine = assertions.filter((a) => a.name.includes(k.tag));
    const failed = mine.filter((a) => a.failed).map((a) => `${a.item}: ${a.name}`);
    let status;
    if (!mine.length) status = "NOT_RUN";
    else status = failed.length ? "KNOWN_FAIL" : "FIXED?";
    return { key: k.tag, id: k.knownIssue, case: k.case || k.tag, knownIssue: k.knownIssue, status, failed };
  });
  // 알려진 결함 태그가 없는 테스트: 통과는 PASS, 실패는 NEW_FAIL
  for (const a of assertions.filter((a) => !tagOf(a.name))) {
    result.push({ key: `${a.item}|${a.name}`, id: a.item, case: a.name, knownIssue: "", status: a.failed ? "NEW_FAIL" : "PASS", failed: a.failed ? [`${a.item}: ${a.name}`] : [] });
  }
  // 검증 실패가 아닌 오류: 요청 단위의 새 실패로 본다
  for (const f of run.failures || []) {
    if (!f.error || f.error.name === "AssertionError") continue;
    const item = (f.source && f.source.name) || "?";
    result.push({ key: `${item}|실행 오류`, id: item, case: `실행 오류 (${f.error.name})`, knownIssue: "", status: "NEW_FAIL", failed: [`${item}: ${f.error.message}`] });
  }
  return { result, problems: [] };
}

function judge(run, rows) {
  if (dataPath) return judgeData(run, rows);
  return judgeTags(run, knownPath ? readJson(knownPath) : []);
}

// ---------- 재실행 ----------
// 첫 실행에서 실제로 실행된 최상위 폴더를 실행 순서대로 찾는다 (newman --folder와 같은 값)
function foldersOf(report) {
  const owner = new Map();
  const walk = (items, top) => {
    for (const it of items || []) {
      const t = top || it.name;
      owner.set(it.id, t);
      if (it.item) walk(it.item, t);
    }
  };
  walk(report.collection.item, null);
  const folders = [];
  for (const ex of report.run.executions || []) {
    const f = owner.get(ex.item.id);
    if (f && !folders.includes(f)) folders.push(f);
  }
  return folders;
}

function rerun(report, iterationData) {
  const newman = require("newman");
  const base = reportPath.replace(/\.json$/, "");
  const options = {
    collection: report.collection,
    environment: report.environment, // 첫 실행의 환경 그대로 (--env-var로 바꾼 baseUrl 포함)
    folder: foldersOf(report),
    reporters: ["cli", "htmlextra", "json"],
    reporter: {
      htmlextra: { export: `${base}-retry.html`, logs: true },
      json: { export: `${base}-retry.json` },
    },
  };
  if (iterationData) options.iterationData = iterationData;
  console.log(`\n=== 재실행: 폴더 ${options.folder.join(", ")}${iterationData ? `, ${iterationData.length}행` : ""} ===`);
  return new Promise((resolve) => {
    newman.run(options, (err) => {
      if (err) return resolve({ error: err.message });
      resolve({ run: readJson(`${base}-retry.json`).run });
    });
  });
}

// ---------- 출력 ----------
const label = {
  PASS: "통과",
  KNOWN_FAIL: "알려진 결함 (기록만)",
  "FIXED?": "알려진 결함인데 통과 → 수정됐는지 확인하고 알려진 결함 목록에서 제거",
  RETRY_OK: "1차 실패 → 재실행에서 예상대로 동작 (일시적인 환경 문제로 판단, 반복되면 확인)",
  NEW_FAIL: "새 실패 → 확인 필요",
  SETUP_FAIL: "테스트 준비 실패 (토큰·예약 생성 등) → 확인 필요",
  NOT_RUN: "실행되지 않은 케이스 → 폴더·데이터 파일·테스트 이름 확인",
};
const FAILING = ["NEW_FAIL", "SETUP_FAIL", "NOT_RUN"];

function print(source, result, problems) {
  const count = (s) => result.filter((r) => r.status === s).length;
  const summary = Object.fromEntries(Object.keys(label).map((k) => [k, count(k)]));
  const notable = result.filter((r) => !["PASS", "KNOWN_FAIL"].includes(r.status));
  const history = (r) => (r.firstStatus ? ` (1차 ${r.firstStatus} → 재실행 ${r.retryStatus})` : "");

  console.log(`\n=== known issue 비교: ${source} ===`);
  for (const r of notable) {
    console.log(`[${r.status}] ${r.id} ${r.case}${r.knownIssue ? ` (knownIssue: ${r.knownIssue})` : ""}${history(r)}`);
    for (const f of r.failed) console.log(`    - ${r.firstStatus ? "1차: " : ""}${f}`);
    for (const f of r.retryFailed || []) console.log(`    - 재실행: ${f}`);
  }
  for (const p of problems) console.log(`[ERROR] ${p}`);
  for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(11)} ${String(v).padStart(3)}  ${label[k]}`);

  // GitHub Actions: 실행 화면에 요약 표와 경고 표시
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `### known issue 비교: \`${source}\``,
      "",
      "| 분류 | 건수 | 의미 |",
      "| --- | --- | --- |",
      ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v} | ${label[k]} |`),
      "",
    ];
    if (notable.length) {
      lines.push("| ID | 케이스 | 분류 | 1차 → 재실행 | knownIssue |", "| --- | --- | --- | --- | --- |");
      for (const r of notable) lines.push(`| ${r.id} | ${r.case} | ${r.status} | ${r.firstStatus ? `${r.firstStatus} → ${r.retryStatus}` : ""} | ${r.knownIssue} |`);
    }
    for (const p of problems) lines.push("", `- 오류: ${p}`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  }
  if (process.env.GITHUB_ACTIONS) {
    for (const r of result) {
      if (FAILING.includes(r.status)) console.log(`::error::${r.status} ${r.id} ${r.case}${history(r)}`);
      if (r.status === "RETRY_OK") console.log(`::warning::RETRY_OK ${r.id} ${r.case} - 1차 ${r.firstStatus}, 재실행 ${r.retryStatus}. 일시적인 환경 문제로 판단 (재실행 리포트 확인)`);
      if (r.status === "FIXED?") console.log(`::warning::${r.id} ${r.case} - knownIssue ${r.knownIssue}가 통과함. 수정 여부 확인`);
    }
    for (const p of problems) console.log(`::error::${p}`);
  }
  return summary;
}

// ---------- 실행 ----------
(async () => {
  const report = readJson(reportPath);
  const rows = dataPath ? readJson(dataPath) : null;
  const source = dataPath || knownPath || reportPath;
  const { result, problems } = judge(report.run, rows);

  const candidates = result.filter((r) => RETRY_TARGET.includes(r.status));
  // 반복 횟수 불일치처럼 실행 구성 자체가 틀린 경우는 다시 돌려도 같으므로 재실행하지 않는다
  if (candidates.length && !noRetry && !problems.length) {
    const retryRows = dataPath ? candidates.map((r) => rows[r.index]) : null;
    const retried = await rerun(report, retryRows);
    let retryResult = [];
    let retryProblems = [];
    if (retried.error) retryProblems = [`재실행 실패: ${retried.error}`];
    else ({ result: retryResult, problems: retryProblems } = judge(retried.run, retryRows));
    const byKey = new Map(retryResult.map((r) => [r.key, r]));
    // 일반 테스트의 "실행 오류"는 오류가 없으면 결과에 남지 않으므로, 그 요청이 재실행에서 실행됐다면 통과로 본다
    const ranItems = new Set(retried.run ? retried.run.executions.map((ex) => ex.item.name) : []);
    for (const r of candidates) {
      let again = byKey.get(r.key);
      if (!again && r.key.endsWith("|실행 오류") && ranItems.has(r.id)) again = { status: "PASS", failed: [] };
      r.firstStatus = r.status;
      r.retryStatus = again ? again.status : "NOT_RUN";
      if (again && !retryProblems.length && OK_ON_RETRY.includes(again.status)) r.status = "RETRY_OK";
      else r.retryFailed = again ? again.failed : ["재실행 결과에 없음"];
    }
    for (const p of retryProblems) problems.push(`재실행: ${p}`);
  }

  const summary = print(source, result, problems);
  process.exit(FAILING.some((s) => summary[s]) || problems.length ? 1 : 0);
})();
