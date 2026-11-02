// 테스트 케이스 문서(docs/Restful-booker_API_테스트케이스.xlsx) 생성기
//
// 입력: data/booking-cases.json, data/patch-cases.json  (케이스 원본: id, case, purpose, expectedStatus, knownIssue, note, body)
//       data/defects.json                              (결함 목록)
//       reports/data.json, reports/data-patch.json      (Newman JSON 리포트: 실제 Status, 저장값, PASS/FAIL)
// 사용: npm run test:data && npm run test:data-patch && npm run docs:testcase
//
// 실제 결과는 리포트에서 계산하므로 손으로 고칠 칸이 없다. 바꾸고 싶은 내용은 데이터 파일이나 defects.json에서 고친다.

const fs = require("fs");
const ExcelJS = require("exceljs");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const post = read("data/booking-cases.json");
const patch = read("data/patch-cases.json");
const defects = read("data/defects.json");
const repPost = read("reports/data.json").run;
const repPatch = read("reports/data-patch.json").run;
const OUT = "docs/Restful-booker_API_테스트케이스.xlsx";

// ---------- 리포트 해석 ----------
for (const [name, rows, rep] of [["data", post, repPost], ["data-patch", patch, repPatch]]) {
  if (rep.stats.iterations.total !== rows.length) {
    console.error(`리포트 ${name}.json의 반복 횟수(${rep.stats.iterations.total})가 데이터 행 수(${rows.length})와 다릅니다. 테스트를 다시 실행하세요.`);
    process.exit(1);
  }
}
const bodyOf = (ex) => {
  const text = Buffer.from(ex.response.stream.data).toString();
  try { return JSON.parse(text); } catch { return text.slice(0, 80); }
};
const byIter = (run) => {
  const out = {};
  for (const ex of run.executions) (out[ex.cursor.iteration] ??= {})[ex.item.name] = ex;
  return out;
};
const flat = (b) => {
  const o = {};
  for (const [k, v] of Object.entries(b || {})) {
    if (k === "bookingdates" && v && typeof v === "object") Object.assign(o, v);
    else o[k] = v;
  }
  return o;
};
const show = (v) => JSON.stringify(v);
const diff = (a, b) => {
  const fa = flat(a), fb = flat(b), NONE = "(없음)";
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])]
    .map((k) => [k, k in fa ? fa[k] : NONE, k in fb ? fb[k] : NONE])
    .filter(([, x, y]) => show(x) !== show(y));
};
const failedIn = (...exs) => exs.some((e) => (e.assertions || []).some((a) => a.error));
const CLASS = { "[정상]": "정상", "[전체]": "정상 수정", "[단일]": "정상 수정", "[경계]": "경계값", "[타입]": "타입 검증",
                "[필수값]": "필수값 검증", "[날짜]": "날짜 검증", "[추가]": "요청 형식 검증" };
const classify = (c) => {
  for (const [k, v] of Object.entries(CLASS)) if (c.startsWith(k)) return [v, c.slice(k.length).trim()];
  return ["기타", c];
};

// ---------- 데이터셋 행 ----------
const itPost = byIter(repPost);
const postRows = post.map((row, i) => {
  const ex = itPost[i]["booking - 입력값 검증"];
  const code = ex.response.code, resp = bodyOf(ex), ok = row.expectedStatus === 200;
  let actual;
  if (code === 200 && typeof resp === "object") {
    const d = diff(row.body, resp.booking);
    actual = d.length ? d.map(([k, a, b]) => `${k}: 보냄 ${show(a)} → 저장 ${show(b)}`).join("\n") : "보낸 값 그대로 저장";
    if (!ok) actual = `bookingid 발급 (예약 생성됨)\n${actual}`;
  } else actual = `에러 응답: ${typeof resp === "string" ? resp : show(resp)}`;
  const [d4, d5] = classify(row.case);
  return [row.id, "BKG-POST", d4, d5, row.case, row.purpose, JSON.stringify(row.body, null, 2), row.expectedStatus,
          ok ? "bookingid 발급, booking = 보낸 값" : "에러 응답, 예약 미생성", "-",
          code, actual, failedIn(ex) ? "FAIL" : "PASS", row.knownIssue || "", row.note || "", i + 1];
});

const itPatch = byIter(repPatch);
const patchRows = patch.map((row, i) => {
  const exs = itPatch[i];
  const created = bodyOf(exs["PATCH 용 예약생성"]);
  const original = typeof created === "object" ? created.booking : {};
  const pex = exs["PATCH"], gex = exs["수정 후 재조회"];
  const saved = bodyOf(gex), sent = row.body;
  let expSaved, expResp, actual;
  if (row.expectedStatus === 200) {
    const exp = { ...original, ...sent };
    if (sent.bookingdates && typeof sent.bookingdates === "object") exp.bookingdates = { ...original.bookingdates, ...sent.bookingdates };
    expSaved = Object.entries(flat(sent)).map(([k, v]) => `${k} = ${show(v)}`).join(", ") + "로 변경\n나머지 필드는 원본 유지";
    expResp = "수정된 booking 반환";
    const d = diff(exp, typeof saved === "object" ? saved : {});
    actual = d.length ? d.map(([k, a, b]) => `${k}: 기대 ${show(a)} → 저장 ${show(b)}`).join("\n") : "기대와 동일";
  } else {
    expSaved = "원본과 동일 (모든 필드 변경 없음)";
    expResp = "에러 응답 (수정되지 않음)";
    const d = diff(original, typeof saved === "object" ? saved : {});
    actual = d.length ? d.map(([k, a, b]) => `${k}: 원본 ${show(a)} → 저장 ${show(b)}`).join("\n") : "원본 유지";
  }
  const [d4, d5] = classify(row.case);
  return [row.id, "BKG-PATCH", d4, d5, row.case, row.purpose, JSON.stringify(sent, null, 2), row.expectedStatus, expResp, expSaved,
          pex.response.code, actual, failedIn(pex, gex) ? "FAIL" : "PASS", row.knownIssue || "", row.note || "", i + 1];
});

// 일관성 확인: knownIssue 있는 행 = FAIL, 없는 행 = PASS (비교 스크립트의 NEW_FAIL 0과 같은 조건)
const ids = new Set(defects.map((d) => d.id));
const problems = [];
for (const r of [...postRows, ...patchRows]) {
  if ((r[12] === "FAIL") !== Boolean(r[13])) problems.push(`${r[0]}: 결과 ${r[12]}, knownIssue "${r[13]}"`);
  if (r[13] && !ids.has(r[13])) problems.push(`${r[0]}: knownIssue ${r[13]}가 data/defects.json에 없음`);
}
if (problems.length) {
  console.error("문서를 만들기 전에 확인이 필요합니다 (NEW_FAIL이나 FIXED?가 남아 있음):\n  " + problems.join("\n  "));
  process.exit(1);
}

// ---------- 엑셀 작성 ----------
const F = "Arial";
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HEAD = fill("FFD9E1F2"), SUB = fill("FFF2F2F2"), GREEN = fill("FFE2EFDA"), YELLOW = fill("FFFFF2CC"), ORANGE = fill("FFFCE4D6"), GRAY = fill("FFEDEDED");
const thin = { style: "thin", color: { argb: "FF999999" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

const wb = new ExcelJS.Workbook();
const wsS = wb.addWorksheet("현황");

function table(ws, header, rows, { widths, center = [], mono = [], fills = [] }) {
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.eachRow((row, rn) => row.eachCell({ includeEmpty: true }, (cell, cn) => {
    if (cn > header.length) return;
    cell.border = BORDER;
    if (rn === 1) {
      cell.font = { name: F, size: 10, bold: true }; cell.fill = HEAD;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    } else {
      cell.font = mono.includes(cn) ? { name: "Courier New", size: 9 } : { name: F, size: 10 };
      cell.alignment = { vertical: "top", wrapText: true, horizontal: center.includes(cn) ? "center" : "left" };
    }
  }));
  for (const [a, b, f] of fills) for (let c = a; c <= b; c++) ws.getRow(1).getCell(c).fill = f;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
}

// 템플릿
const wsT = wb.addWorksheet("템플릿");
table(wsT, ["템플릿 ID", "대상", "테스트 목적", "사전조건", "Method", "Endpoint", "Headers", "Request Body", "판정 기준 (응답)", "검증 요청",
            "판정 기준 (저장값)", "데이터 파일", "데이터셋 시트", "케이스 수", "Postman 위치", "Before request", "After response", "실행 명령"], [
  ["BKG-POST", "예약 생성 (POST)", "예약 생성 시 필드별 입력값 검증이 명세대로 동작하는지 확인",
   "1. baseUrl 접근 가능\n2. 인증 불필요 (예약 생성은 토큰 없이 가능)", "POST", "{{baseUrl}}/booking",
   "Content-Type: application/json\nAccept: application/json", "{{requestBody}}\n= 데이터셋의 입력 body",
   "상태 코드 == 데이터셋의 기대 Status\n200이면 응답이 schema.bookingCreated와 일치", "없음 (응답만 판정)", "-",
   "data/booking-cases.json", "예약생성_데이터", { formula: "COUNTA(예약생성_데이터!$A$2:$A$500)" },
   "06-Data-Driven > booking - 입력값 검증",
   "행의 body → JSON.stringify → requestBody 변수 저장. 데이터 없이 실행되면 안내 로그",
   "상태 코드 == expectedStatus 판정. 다르면 보낸 body와 응답 전체를 로그로 기록\n200이면 응답 스키마(schema.bookingCreated) 검증",
   "npm run test:data"],
  ["BKG-PATCH", "부분 수정 (PATCH)", "부분 수정 시 보낸 필드만 바뀌고, 잘못된 입력은 거절되어 원본이 유지되는지 확인",
   "1. POST /auth로 토큰 발급 ({{username}} / {{password}})\n2. POST /booking으로 행마다 새 예약 생성 후 bookingid 확보\n" +
   "   - 원본: firstname POST, lastname PATCH, totalprice 2300, depositpaid false, checkin 2018-01-01, checkout 2019-01-01, additionalneeds Breakfast",
   "PATCH", "{{baseUrl}}/booking/{{bookingid}}", "Cookie: token={{token}}\nContent-Type: application/json\nAccept: application/json",
   "{{requestBody}}\n= 데이터셋의 입력 body", "상태 코드 == 데이터셋의 기대 Status\n200이면 응답이 schema.booking과 일치",
   "GET {{baseUrl}}/booking/{{bookingid}}",
   "기대 200: 원본에 보낸 필드를 덮어쓴 값 == 저장값 (bookingdates는 안쪽 필드까지 합침)\n기대 400: 원본 == 저장값",
   "data/patch-cases.json", "부분수정_데이터", { formula: "COUNTA(부분수정_데이터!$A$2:$A$500)" },
   "07-Data-Driven-Patch > Auth → PATCH 용 예약생성 → PATCH → 수정 후 재조회 → 예약 삭제 (정리)",
   "예약생성: originalBooking 비움\nPATCH: 행의 body → JSON.stringify → requestBody 변수 저장",
   "Auth: 토큰 발급 판정, 응답 스키마(schema.auth) 검증\n예약생성: 상태 200 판정, 응답 스키마(schema.bookingCreated) 검증, bookingid·원본 저장\n" +
   "PATCH: 상태 코드 == expectedStatus, 200이면 응답 스키마(schema.booking) 검증\n재조회: 판정 기준(저장값)대로 비교, 응답 스키마(schema.booking) 검증\n예약 삭제: 상태 200·201·204 판정",
   "npm run test:data-patch"],
], { widths: [12, 16, 30, 44, 8, 30, 30, 22, 30, 30, 44, 22, 16, 9, 34, 40, 52, 20], center: [1, 5, 14], mono: [8],
     fills: [[5, 8, GREEN], [9, 11, YELLOW], [12, 18, GRAY]] });
[2, 3].forEach((r) => (wsT.getRow(r).height = 130));

// 데이터셋
const D_HEAD = ["ID", "템플릿", "분류", "대상", "케이스", "테스트 목적", "입력 body", "기대 Status", "기대 Response",
                "기대 저장값", "실제 Status", "실제 Response / 저장값", "결과", "결함 ID", "비고", "데이터 행"];
function dataset(name, rows) {
  const ws = wb.addWorksheet(name);
  table(ws, D_HEAD, rows, { widths: [15, 11, 13, 22, 32, 42, 36, 10, 26, 36, 10, 38, 9, 9, 32, 9],
    center: [2, 8, 11, 13, 14, 16], mono: [7], fills: [[7, 10, YELLOW], [11, 15, ORANGE]] });
  const n = rows.length + 1;
  for (let r = 2; r <= n; r++) ws.getCell(`M${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"PASS,FAIL,BLOCK,N/A,Not Tested"'] };
  ws.addConditionalFormatting({ ref: `M2:M${n}`, rules: [
    { type: "cellIs", operator: "equal", formulae: ['"PASS"'], style: { font: { color: { argb: "FF1E7B34" }, bold: true } } },
    { type: "cellIs", operator: "equal", formulae: ['"FAIL"'], style: { font: { color: { argb: "FFC00000" }, bold: true } } } ] });
  ws.autoFilter = `A1:P${n}`;
  return n;
}
const nP = dataset("예약생성_데이터", postRows);
const nU = dataset("부분수정_데이터", patchRows);

// 결함목록
const wsD = wb.addWorksheet("결함목록");
table(wsD, ["결함 ID", "API", "내용", "관련 케이스", "심각도", "상태"],
  defects.map((d) => [d.id, d.api, d.summary, d.cases, d.severity, d.status]),
  { widths: [10, 22, 64, 36, 12, 10], center: [1, 5, 6] });
const nD = defects.length + 1;
for (let r = 2; r <= nD; r++) {
  wsD.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"상,중,하,정책 확인"'] };
  wsD.getCell(`F${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Open,Fixed,Closed"'] };
}

// 현황
const runDate = new Date(repPatch.timings.started).toLocaleDateString("sv-SE");
const put = (addr, v, { bold = false, size = 10, f, align } = {}) => {
  const c = wsS.getCell(addr); c.value = v; c.font = { name: F, size, bold };
  if (f) c.fill = f;
  if (align) c.alignment = { horizontal: align, vertical: "middle" };
  return c;
};
put("A1", "Restful-booker API 테스트 케이스 · 테스트 현황 보고서", { bold: true, size: 13 });
put("A3", "1. 개요", { bold: true });
const info = [["구분", "내용"], ["프로젝트 명", "Restful-booker API 테스트 (학습용)"],
  ["대상 API", "https://restful-booker.herokuapp.com/apidoc/index.html  ({{baseUrl}} = https://restful-booker.herokuapp.com)"],
  ["저장소", "https://github.com/IWlastnameisKim/api-test-restful-booker"],
  ["테스트 방식", "Postman + Newman 데이터 기반 테스트. 공통 절차는 템플릿 시트, 입력값은 데이터셋 시트"],
  ["생성 방법", "npm run docs:testcase. 케이스는 data/*.json, 결함은 data/defects.json, 실제 결과는 reports/*.json에서 생성 (손으로 고치지 않음)"],
  ["케이스 설계", "경계값 중심. 가격 -1 / 0 / 1, 숙박 기간 0박 / 1박, 날짜 평년·윤년 2월 29일, 이름 빈 문자열 / 1글자"],
  ["테스트 실행일", runDate], ["문서 생성일", new Date().toLocaleDateString("sv-SE")], ["QA 담당자", "InWon Kim"]];
info.forEach(([a, b], k) => {
  const r = 4 + k;
  put(`A${r}`, a, { bold: k === 0, f: k === 0 ? HEAD : SUB });
  put(`B${r}`, b, { bold: k === 0, f: k === 0 ? HEAD : undefined });
  wsS.mergeCells(`B${r}:J${r}`);
});
const r0 = 4 + info.length + 1;
put(`A${r0}`, "2. 템플릿별 테스트 현황", { bold: true });
const heads = ["NO", "템플릿", "전체 Case", "PASS", "FAIL", "BLOCK", "Not Tested", "N/A", "진행률", "성공률"];
const cellRow = (r, vals, { bold = false, f } = {}) => vals.forEach((v, j) => {
  const c = wsS.getRow(r).getCell(j + 1); c.value = v; c.font = { name: F, size: 10, bold }; c.border = BORDER;
  c.alignment = { horizontal: "center", wrapText: true }; if (f) c.fill = f; if (j >= 8 && r > r0 + 1) c.numFmt = "0.00%";
});
cellRow(r0 + 1, heads, { bold: true, f: HEAD });
[[1, "BKG-POST (예약 생성)", "예약생성_데이터", nP], [2, "BKG-PATCH (부분 수정)", "부분수정_데이터", nU]].forEach(([no, label, sh, n], k) => {
  const r = r0 + 2 + k, rng = `${sh}!$M$2:$M$${n}`;
  cellRow(r, [no, label, { formula: `COUNTA(${sh}!$A$2:$A$${n})` }, { formula: `COUNTIF(${rng},"PASS")` }, { formula: `COUNTIF(${rng},"FAIL")` },
    { formula: `COUNTIF(${rng},"BLOCK")` }, { formula: `COUNTIF(${rng},"Not Tested")+COUNTBLANK(${rng})` }, { formula: `COUNTIF(${rng},"N/A")` },
    { formula: `IF(C${r}=0,0,(C${r}-G${r})/C${r})` }, { formula: `IF((C${r}-G${r}-H${r})=0,0,D${r}/(C${r}-G${r}-H${r}))` }]);
});
const rt = r0 + 4;
cellRow(rt, ["", "총계", ..."CDEFGH".split("").map((c) => ({ formula: `SUM(${c}${r0 + 2}:${c}${rt - 1})` })),
  { formula: `IF(C${rt}=0,0,(C${rt}-G${rt})/C${rt})` }, { formula: `IF((C${rt}-G${rt}-H${rt})=0,0,D${rt}/(C${rt}-G${rt}-H${rt}))` }], { bold: true, f: SUB });
put(`A${rt + 1}`, "진행률 = (전체 - Not Tested) / 전체 · 성공률 = PASS / (전체 - Not Tested - N/A). FAIL은 모두 알려진 결함(knownIssue)이며 새 실패는 0건");
wsS.mergeCells(`A${rt + 1}:J${rt + 1}`);
const r1 = rt + 3;
put(`A${r1}`, "3. 결함 현황 (심각도별, regression 포함)", { bold: true });
cellRow(r1 + 1, ["심각도", "전체 건수", "조치 완료 (Fixed/Closed)", "미조치 (Open)"], { bold: true, f: HEAD });
["상", "중", "하", "정책 확인"].forEach((sev, k) => {
  const r = r1 + 2 + k, E = `결함목록!$E$2:$E$${nD}`, S = `결함목록!$F$2:$F$${nD}`;
  cellRow(r, [sev, { formula: `COUNTIF(${E},A${r})` }, { formula: `COUNTIFS(${E},A${r},${S},"Fixed")+COUNTIFS(${E},A${r},${S},"Closed")` },
              { formula: `COUNTIFS(${E},A${r},${S},"Open")` }]);
});
const rs = r1 + 6;
cellRow(rs, ["총계", { formula: `SUM(B${r1 + 2}:B${rs - 1})` }, { formula: `SUM(C${r1 + 2}:C${rs - 1})` }, { formula: `SUM(D${r1 + 2}:D${rs - 1})` }], { bold: true, f: SUB });
const r3 = rs + 2;
put(`A${r3}`, "4. 문서 구성과 항목 정의", { bold: true });
[["항목", "설명"],
 ["템플릿 시트", "data-driven 테스트 1개 = 템플릿 1행. 공통 사전조건, 요청, 판정 기준, 데이터 파일, 자동화 위치를 한 번만 기재"],
 ["데이터셋 시트", "데이터 파일 1행 = 케이스 1행. 행마다 다른 입력·기대·실제·결과만 기재"],
 ["ID", "데이터 파일의 id. 테스트 이름에 표시되어 Newman 리포트와 연결. 삭제한 ID는 재사용하지 않음 (BKG-PATCH-020 결번)"],
 ["분류 / 대상", "케이스 이름의 [접두어]에서 분류를 정하고, 나머지를 대상으로 표시"],
 ["실제 Status / Response", "Newman JSON 리포트에서 가져온 응답 코드와, 보낸 값·원본 대비 달라진 저장값"],
 ["결함 ID / 비고", "데이터 파일의 knownIssue / note"],
 ["케이스 추가 순서", "1. 데이터 파일에 행 추가 → 2. 실행 (새 행이 실패하면 NEW_FAIL) → 3. 결함 판단 후 knownIssue 기입 → 4. npm run docs:testcase"],
].forEach(([a, b], k) => {
  const r = r3 + 1 + k;
  put(`A${r}`, a, { bold: k === 0, f: k === 0 ? HEAD : SUB }).alignment = { wrapText: true, vertical: "middle" };
  put(`B${r}`, b, { bold: k === 0, f: k === 0 ? HEAD : undefined });
  wsS.mergeCells(`B${r}:J${r}`);
});
wsS.getColumn(1).width = 30; wsS.getColumn(2).width = 22;
for (let c = 3; c <= 10; c++) wsS.getColumn(c).width = 13;

wb.xlsx.writeFile(OUT).then(() => {
  const pass = (rows) => rows.filter((r) => r[12] === "PASS").length;
  console.log(`${OUT} 생성 완료`);
  console.log(`  POST  ${postRows.length}건 (PASS ${pass(postRows)}, FAIL ${postRows.length - pass(postRows)})`);
  console.log(`  PATCH ${patchRows.length}건 (PASS ${pass(patchRows)}, FAIL ${patchRows.length - pass(patchRows)})`);
  console.log(`  결함 ${defects.length}건, 테스트 실행일 ${runDate}`);
});
