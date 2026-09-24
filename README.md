# GS Shift Log

GS 포천그린에너지 교대근무 업무일지와 설비운영 지원 시스템입니다.
웹 화면·Cloudflare Pages Functions·D1/R2·회사 PC의 OIS/Excel Agent로 구성됩니다.
이 저장소에는 Facility Navigator 자체 소스가 아니라 점검 결과 연동 API가 포함되어 있습니다.

## 구조

| 위치 | 역할 |
| --- | --- |
| `index.html`, `script.js`, `style.css` | PC 업무일지·효율팀 메인 화면 |
| `mobile/`, `mobile-app/` | 모바일 로그인 및 모바일 화면 |
| `functions/api/` | 인증, 업무일지, 점검, 효율팀, Agent 요청 API |
| `functions/_shared/` | 공용 서버 로직 |
| `maintenance/`, `efficiency/`, `inspection-logs/` | 기능별 화면·계산·점검 모듈 |
| `local-tools/ois-agent/` | 사내 Windows OIS·Excel·DataPARC·PDF 연동 |
| `tests/` | 로컬 자동검증·과거 패치 검증 |
| `scripts/build-web.mjs` | 공개 웹 파일만 별도 출력하는 빌드 도구 |

## 2026-09-24 검토본

검토 기준은 사용자가 제공한 ZIP의 작업 파일입니다. 1차 수정은 관리자 인증,
혼소율 빈값 처리, 기간 조회 규칙 일치, Excel PID 변수 및 배포 파일 분리에 한정합니다.
운영 검증이 완료된 최종 배포본이라는 의미는 아닙니다.
자세한 문제·수정 범위·남은 검증은 [검토 보고서](docs/review-2026-09-24.md)를 확인하세요.

### 로컬 검증

검증 환경: Node.js 24.19.0. 추가 npm 설치 없이 다음 검사를 실행합니다.

```powershell
node --test tests/project-hardening-v1.test.mjs
```

이 검사는 로컬 SQLite와 합성 데이터만 사용하며 운영 API·DB·Excel을 호출하지 않습니다.
전체 과거 테스트에는 구버전 UI, 고정 해시, 미완성 DOM 모형에 의한 실패가 남아 있습니다.

### 웹 배포 파일 생성

```powershell
node scripts/build-web.mjs
```

새 `web-dist` 디렉터리가 생성됩니다. 기존 출력 디렉터리는 덮어쓰지 않습니다.
재검증할 때는 `--out=web-dist-review-2`처럼 새 이름을 지정하세요.
Cloudflare Pages의 Build command는 `node scripts/build-web.mjs`, Build output directory는
`web-dist`로 설정하는 구성을 검토합니다. 실제 클라우드 설정은 이 도구가 바꾸지 않습니다.
`functions/`는 프로젝트 루트에 남겨 Pages가 서버 코드로 처리하게 해야 합니다.
`web-dist`만 정적 사이트로 올리면 로그인과 API가 동작하지 않습니다.

백업·로컬 Agent·실제 설정·세션·진단로그·테스트·과거 패치는 웹 출력에 넣지 않습니다.
23개 구버전 브라우저 파일도 웹 출력에서 제외합니다. 소스와 과거 검증 이력은 보존합니다.

### 운영 구성 주의점

- 기존 D1/R2 바인딩과 환경변수를 보존하세요. `schema.sql`은 현재 API와 불일치하므로
  신규 DB 초기화나 운영 DB 갱신 명령으로 사용하면 안 됩니다.
- 직원 변경은 유효한 최고관리자 세션이 필요합니다. PC/모바일 인증 헤더도 함께 수정했습니다.
- 최초 관리자 생성은 32자 이상의 `USER_SETUP_KEY`와 일치하는 `X-Setup-Key`가 있어야 합니다.
  기존 관리자 계정이 있는 운영 환경에서는 이 생성 기능을 사용할 필요가 없습니다.
- 혼소율 Worker·Controller·Agent는 파일 해시가 연결돼 있으므로 한 묶음으로 유지하세요.
  Git 줄바꿈 변환 이후에도 실제 파일 SHA-256을 검증해야 합니다.
- Windows Excel/NativeOM/DataPARC 실행, 회사 네트워크, AhnLab 검사 및 배포 후 화면 검증은
  이 Linux 검토 환경에서 수행하지 않았습니다.
