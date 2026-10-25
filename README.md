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
- **GitHub Actions**: push 시 자동 실행, 리포트 보관
- **Dependabot**: npm 패키지·액션 버전 업데이트 PR 자동 생성

## 프로젝트 구조

```
api-test-restful-booker/
 ├─ .github/
 │   ├─ workflows/
 │   │   └─ api-test.yml                         # CI: smoke / regression job
 │   └─ dependabot.yml                           # 의존성 업데이트 설정
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
| 04-CleanUp | 정리와 삭제 검증 | 예약 삭제 → 삭제 후 조회(404) |
| 05-Regression-Delete | 회귀 테스트 | 이미 삭제된 예약 재삭제. 삭제 이후에 실행되어야 해서 CleanUp 뒤에 위치 |

### 실행 그룹

폴더를 조합해 두 가지로 나누어 실행합니다. 두 그룹 모두 `01-Setup`을 포함하는데, Newman은 매번 빈 `token`·`bookingid`에서 시작하기 때문입니다.

| 그룹 | 폴더 | 목적 | 실패 시 |
| --- | --- | --- | --- |
| smoke | 01-Setup, 02-Flow, 04-CleanUp | 정상 기능 동작 확인 | 파이프라인 실패 (진짜 문제) |
| regression | 01-Setup, 03-Regression, 04-CleanUp, 05-Regression-Delete | 알려진 결함 추적 | 기록만, 파이프라인은 통과 |

## 실행 방법

```bash
# 의존성 설치 (package-lock.json의 버전 그대로)
npm ci

# 정상 흐름만
npm run test:smoke

# 알려진 결함 회귀 테스트
npm run test:regression

# 둘 다 (smoke 성공 시 regression 이어서 실행)
npm run test:api
```

각 스크립트는 `newman run`에 `--folder`로 실행 그룹을 지정하고, 터미널 출력과 HTML 리포트를 함께 생성합니다.

| 스크립트 | 리포트 |
| --- | --- |
| `test:smoke` | `reports/smoke.html` |
| `test:regression` | `reports/regression.html` |

리포트의 Failed Tests 탭에서 실패 상세(기대값 vs 실제값)를, Total Requests 탭의 Console Log에서 스크립트가 남긴 기록(보낸 값과 저장된 값 등)을 확인할 수 있습니다.

## CI (GitHub Actions)

`main`에 push하거나 Actions 탭에서 수동 실행(`workflow_dispatch`)하면 `.github/workflows/api-test.yml`이 두 job을 병렬로 실행합니다.

| job | 실행 | 설정 |
| --- | --- | --- |
| smoke | `npm run test:smoke` | 실패하면 워크플로 실패 |
| regression | `npm run test:regression` | `continue-on-error: true`. 알려진 결함으로 job은 실패로 표시되지만 워크플로는 통과 |

- 두 job 모두 `if: always()`로 테스트가 실패해도 리포트를 Artifacts(`smoke-report`, `regression-report`)로 업로드합니다.
- `npm ci`와 `package-lock.json`으로 로컬과 CI가 같은 버전으로 실행되며, `setup-node`의 `cache: npm`으로 설치 시간을 줄입니다.
- 버전은 고정하고, 업데이트는 Dependabot PR로 받아 CI 통과를 확인한 뒤 반영합니다.

## 실행 결과

| 그룹 | requests | assertions | 실패 | 결과 |
| --- | --- | --- | --- | --- |
| smoke | 7 | 8 | 0 | 모두 통과 |
| regression | 15 | 15 | 11 | 알려진 결함 11건 |

regression의 실패 11건은 모두 **알려진 결함에 대한 회귀 테스트**입니다(03-Regression 10건 + 재삭제 1건). 통과하는 4건은 Setup의 토큰 발급, `[Bug-1] 로그인 실패 시 토큰 없음`, CleanUp의 삭제와 삭제 후 조회입니다.
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

- [x] GitHub Actions로 push 시 자동 실행 및 리포트 보관
- [x] smoke / regression 분리 실행
- [x] Dependabot으로 의존성 업데이트 자동화
- [ ] 실패 메시지에 테스트 의도 추가 (`pm.expect(값, "설명")`)
- [ ] 로그인 계정 정보를 Environment 변수로 분리
- [ ] 데이터 파일(CSV)로 입력값 조합을 반복 실행하는 데이터 기반 테스트
