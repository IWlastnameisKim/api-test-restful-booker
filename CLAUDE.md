# CLAUDE.md

이 레포에서 작업할 때 지켜야 할 규칙과 맥락입니다. 사람이 읽는 프로젝트 설명은 README.md에 있습니다.

## 프로젝트

- Restful-booker API를 대상으로 한 Postman/Newman API 테스트 학습 프로젝트입니다. 작성자는 QA 엔지니어이고, 설명은 한국어로 합니다.
- 테스트 코드만 있는 레포입니다. 테스트 대상 서버는 별도 프로젝트입니다.
  - 예약 API: Restful-booker. 공용 서버(`https://restful-booker.herokuapp.com`) 또는 로컬(`~/Desktop/restful-booker`, `npm start`, 포트 3001)
  - 예약 접수 서비스: reservation-service. 별도 레포(`~/Desktop/reservation-service`, `npm start`, 포트 3002, `.env` 필요). 서비스 코드를 이 레포에 넣지 않습니다.
- 테스트는 대상 서버를 주소(`baseUrl`, `serviceUrl`, `relayUrl`, `caseServiceUrl`)로만 호출합니다.
- 테스트 도구인 중계 서버(`mocks/booking-relay.js`)는 이 레포에 둡니다. 서비스 코드와 달리 테스트를 위한 코드이기 때문입니다.

## 파일과 역할

| 파일 | 역할 | 수정 방법 |
| --- | --- | --- |
| `collections/Restful-booker.postman_collection.json` | 요청, 테스트 스크립트, 컬렉션 레벨 스키마 | Postman에서 수정 후 Export, 또는 파일 직접 수정 후 Postman에 Import |
| `env/restful-booker.postman_environment.json` | 공용 서버용 (01~07) | |
| `env/restful-booker-local.postman_environment.json` | 로컬 구성용 (08, 09): baseUrl 3001, serviceUrl 3002, relayUrl 3101, caseServiceUrl 3102 | |
| `data/*.json` | 케이스 원본 (id, case, purpose, expectedStatus, knownIssue, note, body), 결함 목록, regression 알려진 결함 태그 | 직접 수정 |
| `data/service-cases.json` | 09 케이스 원본. 위 필드에 `expectedField`, `rawBody`, `expectedBody` 추가 | 직접 수정 |
| `mocks/booking-relay.js` | 09용 중계 서버. 호출을 기록하면서 예약 API로 그대로 전달 (`/_relay/calls` 조회·초기화) | |
| `scripts/check-known-issues.js` | Newman JSON 리포트를 known issue와 비교해 분류, 실패는 재실행 | |
| `scripts/build-testcase-doc.js` | 데이터 파일 + 결함 목록 + JSON 리포트로 xlsx 생성 | |
| `docs/*.xlsx` | 생성물. **손으로 고치지 않음** | `npm run docs:testcase` |
| `reports/` | 실행 결과. Git 제외 | |

## 명령

```bash
npm ci                       # 의존성 설치 (lock 파일 버전 그대로)
npm run test:smoke           # 01-Setup, 02-Flow, 04-CleanUp
npm run test:regression      # 01, 03, 04, 05 + known issue 태그 판정
npm run test:data            # 06 + data/booking-cases.json
npm run test:data-patch      # 07 + data/patch-cases.json
npm run test:service         # 08, 로컬 구성 (예약 API와 reservation-service를 먼저 실행)
npm run test:service-cases   # 09 + data/service-cases.json (예약 API, 중계 서버, 케이스용 서비스를 먼저 실행)
npm run relay                # 중계 서버 3101 → 3001
npm run docs:testcase        # 테스트 케이스 문서 생성 (test:data, test:data-patch 실행 후)
```

- 09용 케이스 서비스: `cd ~/Desktop/reservation-service && PORT=3102 BOOKING_API_URL=http://localhost:3101 npm start`. 실행할 때 붙인 환경변수가 `.env`보다 우선하므로 서비스 코드와 `.env`는 바꾸지 않습니다.

- Newman은 전역 설치하지 않습니다. `npx newman` 또는 `npm run`으로 실행합니다.
- 대상 서버를 한 번만 바꿀 때: `npx newman run ... --env-var baseUrl=http://localhost:3001`. `npm run test:xxx -- --env-var ...`는 쓰지 않습니다. 모든 스크립트가 `newman ... && node scripts/check-known-issues.js ...` 형태라 `--` 뒤의 값이 Newman이 아니라 node 명령에 붙습니다.
- CI(GitHub Actions)는 smoke, regression, data, data-patch를 공용 서버로 실행합니다. 08·09는 로컬 서버가 여러 개 필요해서 CI에 없습니다.

## 반드시 지킬 것

### Postman Export 후 커밋 전 확인

Postman 계정에 예전 컬렉션이 동기화돼 있으면, Export한 파일이 **이미 커밋한 변경을 되돌립니다.** 실제로 두 번 발생했습니다(03에 지운 Bug-2·3·5·6·7·10 재등장, 05의 `[Bug-11]` 태그 소실, 07 `depositpaid: false` → `true`, 스키마 `minLength` 소실, 08 요청 이름 되돌아감).

- Export한 컬렉션은 커밋 전에 `git diff`로 **작업하지 않은 폴더에 변경이 없는지** 확인합니다. 있으면 커밋된 버전을 기준으로 이번 작업분만 합칩니다.
- 파일을 직접 고쳤다면 Postman에서 기존 컬렉션을 지우고 레포 파일을 Import해 양쪽을 맞춥니다.
- regression으로 확인: KNOWN_FAIL 5, NEW_FAIL 0, NOT_RUN 0이어야 합니다. NOT_RUN Bug-11이나 NEW_FAIL [Bug-2] 등이 보이면 예전 컬렉션입니다.

### Environment

- Postman의 Current value는 Export되지 않습니다. 공유해야 할 값(baseUrl, serviceUrl)은 Initial value(Persist)로 저장하거나 파일을 직접 고칩니다. Export 후 파일 값을 확인합니다.
- `token`, `bookingid`는 파일에서 빈 값으로 둡니다.
- 교차 검증은 서비스가 호출하는 예약 API와 **같은 주소**를 조회해야 합니다. 08은 반드시 `restful-booker-local`로 실행합니다.

### 커밋

- `git add .` 대신 파일을 지정합니다. 
- 커밋과 push는 작성자가 직접 합니다.

## 테스트 작성 규칙

### known issue

- 테스트는 기대값(명세) 기준으로 작성하고, 결함 때문에 실패하는 케이스는 데이터 행의 `knownIssue`(06, 07) 또는 테스트 이름의 결함 태그 + `data/regression-known-issues.json`(03, 05)으로 표시합니다.
- 분류: PASS, KNOWN_FAIL, FIXED?(경고), RETRY_OK(경고), NEW_FAIL, SETUP_FAIL, NOT_RUN. NEW_FAIL·SETUP_FAIL은 한 번 재실행해 통과하면 RETRY_OK입니다.
- 결함이 수정되면 테스트는 그대로 두고 `knownIssue`만 지웁니다.

### 케이스 데이터

- 케이스 ID는 다시 쓰지 않습니다. 삭제한 ID는 결번으로 둡니다(예: BKG-PATCH-020). 의미가 바뀌는 수정은 삭제 후 새 ID로 추가합니다.
- 입력값은 동등 분할 대표값보다 경계값 중심으로 설계합니다(가격 -1/0/1, 숙박 0박/1박, 이름 빈 값/1글자, 윤년).
- 케이스를 추가·수정·삭제하면: 데이터 파일 수정 → 실행해 분류 확인 → 필요하면 `defects.json`과 `knownIssue` 갱신 → `npm run docs:testcase` → 함께 커밋.

### 스크립트

- 모든 요청에 최소한 상태 코드 검사를 둡니다. 테스트가 없으면 404도 통과로 보입니다.
- 응답 스키마는 컬렉션 Before request에 정의하고 `pm.variables.set("schema.xxx", JSON.stringify(...))`로 등록합니다. 요청은 성공 응답일 때만 `pm.response.to.have.jsonSchema(JSON.parse(pm.variables.get("schema.xxx")))`로 검사합니다.
- 스키마는 서비스마다 명세 기준으로 따로 작성합니다. 중첩되거나 반복되는 부분은 조각(`date`, `name`, `guest`, `stay`)으로 나눠 조립합니다. 컬렉션 스크립트는 하나의 범위라 `const` 이름이 겹치면 전체가 멈춥니다.
- 스키마를 만들거나 고치면 일부러 틀리게 바꿔 실패하는지 확인합니다. 괄호 위치나 오타는 오류 없이 검사만 사라지게 합니다.
- 실패한 응답에서 다음 요청용 값을 저장하지 않습니다. 실패하면 이전 값을 `unset`합니다.
- 요청 사이에 넘기는 값은 Postman 변수(`pm.variables` 또는 `pm.environment`)에 문자열로 담고, 꺼낸 뒤 `JSON.parse`합니다. `pm.variables`는 한 번의 실행(Runner, Newman) 동안만 유지되므로 요청을 하나씩 Send할 때는 값이 이어지지 않습니다.
- 보낸 body는 `pm.variables.replaceIn(pm.request.body.raw)`로 `{{변수}}`를 치환한 뒤 씁니다.
- 테스트 데이터에는 실행마다 고유한 값(`SVC-${Date.now()}` 등)을 넣어 다른 데이터와 구분합니다.

### 이름

- 같은 데이터가 한 스크립트에서 두 형태로 쓰이면 형태를 이름에 붙입니다(`sentString`, `sentObject`). `json`은 문자열과 객체 양쪽으로 읽혀 쓰지 않습니다.
- 요청과 응답이 함께 나오는 스크립트에서는 출처가 드러나게 짓습니다(`res`: 받은 응답, `saved`: 예약 API에 저장된 값). `body`처럼 양쪽으로 읽히는 이름은 피합니다.
- JavaScript는 camelCase를 씁니다.
- 변수 이름을 바꿀 때 "모두 바꾸기"를 쓰지 않습니다. `pm.request.body`처럼 Postman이 정한 필드까지 바뀝니다.

### 08 서버 간 통신

- 서비스 응답만으로 판단하지 않고, 예약 API를 직접 조회해 필드 매핑대로 저장됐는지 확인합니다(교차 검증).
- 매핑은 `[이름표, 보낸 값, 저장된 값]` 표 하나로 정의하고, 같은 표로 비교 로그와 필드별 `pm.test`를 만듭니다.
- 선택 필드(`request` → `additionalneeds`)는 보낸 경우와 안 보낸 경우 모두 실행해 확인합니다.
- "예약 API를 호출하지 않았다"는 고유값 검색 결과 0건으로 확인하고, 같은 검색으로 정상 예약이 찾아지는지를 먼저 확인합니다.

### 09 서비스 케이스

- 구성: 테스트 → reservation-service 케이스용(3102) → 중계 서버(3101) → Restful-booker(3001). 08용 서비스(3002)와 따로 띄웁니다.
- 한 행: 기록 초기화 → 서비스 예약 요청 → 호출 기록 확인(201이면 `["POST /booking"]`, 400이면 `[]`) → 교차 검증(201 행만) → 예약 정리(예약이 생긴 행만). 건너뛰는 요청은 Before request에서 `pm.execution.skipRequest()`로 처리합니다.
- 판정 대상은 `--targets "서비스 예약 요청,호출 기록 확인,예약 API 교차 검증"`입니다. 기록 초기화와 정리의 실패는 SETUP_FAIL입니다.
- "호출하지 않았다"는 고유값 검색이 아니라 중계 기록 0건으로 확인합니다. 이름 필드가 없는 케이스도 같은 방법으로 확인하기 위해서입니다. 데이터 첫 행(SVC-CASE-001, 기록 1건)이 기록 방식이 동작한다는 대조군이므로 맨 앞에 둡니다.
- 기대값의 근거는 reservation-service README의 "검증 규칙"과 "오류 응답"입니다. 서비스는 규칙을 위에서부터 확인해 처음 걸린 오류 하나만 알려 주므로 `expectedField`도 그 순서로 정합니다. 상위 객체(`guest`, `stay`)가 없으면 첫 하위 필드에서 걸립니다.
- `expectedField`가 없는 400 행은 응답에 `field`가 없어야 합니다(JSON 아님 = `INVALID_JSON`). 오류 종류(`error`) 칸은 두지 않기로 했습니다(작성자 결정).
- 요청 형식 케이스의 기대값(작성자 결정, 명세를 구현에 맞춤): JSON 문법 오류는 400 `INVALID_JSON`(field 없음), body 없음은 400 `VALIDATION_ERROR` + field `body`, JSON 배열(`[]`)은 400 `VALIDATION_ERROR` + 첫 필드 `guest.firstName`. 400으로 거절하면 정상입니다.
- 이름 앞뒤 공백은 Restful-booker가 제거해 저장하는 것을 정상으로 봅니다(작성자 결정). 서비스는 받은 값을 그대로 전달합니다. 저장 과정에서 값이 바뀌는 것이 정상인 행은 데이터에 `expectedBody`(응답·저장값의 기대값)를 두고, 없으면 보낸 `body`가 기대값입니다.
- `rawBody`가 있는 행은 body를 글자 그대로 보냅니다(JSON 아님, body 없음). 없으면 `body`를 `JSON.stringify`합니다.
- 서비스 결함이 생기면 ID는 `S-n`을 씁니다. 현재 등록된 서비스 결함은 없습니다.

## 진행 상황

README의 "향후 계획"이 기준입니다. 08 ①②③④와 09 서비스 케이스(42행)는 완료했습니다. 다음은 중계 서버를 이용한 예약 API 오류 처리(502·503·504) 테스트와 CI 실행입니다.
