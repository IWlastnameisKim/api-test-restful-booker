# api-test-restful-booker

Postman과 Newman으로 구성한 REST API 테스트 프로젝트입니다.
공개 연습용 API인 [Restful-booker](https://restful-booker.herokuapp.com/apidoc/index.html)를 대상으로 정상 흐름 검증과 회귀 테스트를 작성하고, 터미널에서 실행해 HTML 리포트를 생성합니다.

## 목적

- REST API의 요청·응답 구조, 상태 코드, 인증 방식을 직접 다루며 API 테스트를 학습
- 탐색적 테스트로 찾은 결함을 **회귀 테스트**로 자동화
- GUI(Postman 앱) 없이 파일과 명령어만으로 실행되는 구조를 만들어, **폐쇄망·CI 환경**에서도 동일하게 실행할 수 있도록 구성

## 테스트 대상

| 항목 | 내용 |
| --- | --- |
| API | Restful-booker (호텔 예약 CRUD API) |
| 특징 | 토큰 인증, 생성·조회·수정·삭제 제공. 학습용으로 의도적인 결함이 포함됨 |
| 데이터 | 10분마다 초기 상태로 리셋 |

## 기술 스택

- **Postman**: 요청 작성, 테스트 스크립트(JavaScript), Environment 변수, Collection Runner
- **Newman**: Postman 컬렉션을 터미널에서 실행
- **newman-reporter-htmlextra**: HTML 리포트 생성
- **Node.js / npm**

## 프로젝트 구조

```
api-test-restful-booker/
 ├─ collections/
 │   └─ Restful-booker.postman_collection.json   # 요청과 테스트 스크립트
 ├─ env/
 │   └─ restful-booker.postman_environment.json  # baseUrl, token, bookingid
 ├─ reports/                                     # 실행 시 생성되는 HTML 리포트 (Git 제외)
 ├─ package.json
 └─ README.md
```

## 컬렉션 구성

요청은 폴더 순서대로 실행되며, 앞 단계에서 저장한 값을 다음 단계가 사용합니다.

| 폴더 | 역할 | 내용 |
| --- | --- | --- |
| 01-Setup | 테스트 준비 | 토큰 발급, 예약 생성 후 `token`·`bookingid`를 Environment에 자동 저장 |
| 02-Flow | 정상 흐름 검증 | 예약 조회 → 수정 → 재조회로 변경 내용이 실제 저장됐는지 확인 |
| 03-Regression | 회귀 테스트 | 발견한 결함 10건. 올바른 동작(명세)을 기대값으로 작성 |
| 04-CleanUp | 정리와 삭제 검증 | 예약 삭제 → 삭제 후 조회(404) → 재삭제 |

## 실행 방법

```bash
# 의존성 설치
npm install

# 테스트 실행 (터미널 출력 + HTML 리포트)
npm run test:api
```

`test:api`는 아래 명령과 같습니다.

```bash
newman run collections/Restful-booker.postman_collection.json \
  -e env/restful-booker.postman_environment.json \
  -r cli,htmlextra \
  --reporter-htmlextra-export reports/report.html \
  --reporter-htmlextra-logs
```

실행 후 `reports/report.html`을 브라우저로 열면 요청별 결과, 실패 상세(기대값 vs 실제값), 스크립트의 console 기록을 확인할 수 있습니다.

## 실행 결과

| 항목 | 실행 | 실패 |
| --- | --- | --- |
| requests | 18 | 0 |
| test-scripts | 18 | 0 |
| assertions | 20 | 11 |

실패 11건은 모두 **알려진 결함에 대한 회귀 테스트**입니다(03-Regression 10건 + 재삭제 1건). Setup, Flow, CleanUp의 정상 동작 검증은 모두 통과합니다.
결함이 수정되면 해당 테스트가 PASS로 바뀌고, 다시 FAIL이 되면 결함이 재발한 것으로 판단합니다.

## 발견한 결함

| 번호 | 요청 | 입력 | 기대 | 실제 | 심각도 |
| --- | --- | --- | --- | --- | --- |
| Bug-1 | `POST /auth` | 틀린 비밀번호 | 401 | 200 + `Bad credentials` | 중 |
| Bug-2 | `POST /booking` | 음수 가격 | 400 | 200, 음수로 저장 | 상 |
| Bug-3 | `PATCH /booking/{id}` | 음수 가격 | 400 | 200, 음수로 저장 | 상 |
| Bug-4 | `PATCH /booking/{id}` | 인증 토큰 없음 | 401 | 403 | 중 |
| Bug-5 | `POST /booking` | 필수값(firstname) 누락 | 400 | 500 | 중 |
| Bug-6 | `POST /booking` | 체크아웃이 체크인보다 이전 | 400 | 200, 그대로 저장 | 상 |
| Bug-7 | `POST /booking` | 체크인에 날짜가 아닌 값 | 400 | 200, `0NaN-aN-aN`으로 저장 | 상 |
| Bug-8 | `GET /booking?checkin=zz` | 잘못된 날짜 조건 | 400 | 500 | 중 |
| Bug-9 | `GET /booking?checkin=zz` | 에러 응답 형식 | JSON | `text/plain` | 하 |
| Bug-10 | `POST /booking` | 가격 `"11ㅁㅁㅁ1"` | 400 | 200, `11`로 잘려 저장 | 상 |
| 재삭제 | `DELETE /booking/{id}` | 이미 삭제된 예약 | 404 | 405 | 하 |

**추가 관찰**

- 삭제 성공 응답이 `201 Created`로 반환됨 (삭제에 대해 "생성됨"을 의미하는 코드)
- 날짜 입력 시 `2026/11/01` 형식도 `2026-11-01`로 변환되어 저장됨 (명세 외 형식 허용, 정책 확인 필요)
- 목록 검색 시 이름의 대소문자를 구분함 (정책 확인 필요)

## 테스트 설계 원칙

- **기대값은 명세 기준**: 현재 서버 동작이 아니라 올바른 동작을 기대값으로 작성해, 결함을 정상으로 고정하지 않도록 함
- **수정 후에도 유효한 테스트**: "결함이 고쳐지면 이 테스트는 PASS가 되는가?"를 기준으로 작성. 판정은 상태 코드로 하고, 응답 바디는 성공(200)일 때만 파싱
- **판정과 기록의 분리**: 판정은 `pm.test` 안의 검증문으로, 실제 저장된 값 등 증거는 `pm.test` 밖의 `console.log`로 기록
- **한 요청에 한 가지 원인**: 테스트할 조건 하나만 바꾸고 나머지는 정상값으로 유지
- **방어적 스크립트**: 토큰·bookingid는 응답이 성공이고 값의 타입이 맞을 때만 저장. 실패 응답이 기존 값을 덮어쓰지 않도록 함
- **부작용 검증**: 상태 코드만이 아니라 재조회로 실제 저장 여부를 확인 (수정 후 재조회, 삭제 후 조회)

## 향후 계획

- [ ] GitHub Actions로 push 시 자동 실행 및 리포트 보관
- [ ] 실패 메시지에 테스트 의도 추가 (`pm.expect(값, "설명")`)
- [ ] 로그인 계정 정보를 Environment 변수로 분리
- [ ] 데이터 파일(CSV)로 입력값 조합을 반복 실행하는 데이터 기반 테스트
