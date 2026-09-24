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

## 검토 진행 상황

인증·계정, 혼소율 계산·마감, Blower 이력, 계정 화면과 혼소율 화면을 단계별로 보강했습니다.
구조 정리 V12에서는 사용하지 않는 구버전 브라우저 파일 18개와 PC·모바일의 중복 전역 선언
각 7개를 제거했습니다. 남은 선언과 실행 문장은 유지합니다.
전체 검토가 끝났다는 의미는 아닙니다. [최초 검토](docs/review-2026-09-24.md)와
[구조 정리·남은 작업](docs/review-structure-v12-2026-09-25.md)을 확인하세요.

### 로컬 검증

Node.js 24 기준입니다. 아래 검사는 운영 API·DB·Excel을 호출하지 않는 로컬 검사입니다.
추가 npm 설치 없이 실행할 수 있습니다.

```powershell
# 이번 정리와 앞선 핵심 보강 사항: project-*.test.mjs 중 지정된 7개 파일
node scripts/test-project.mjs --review

# tests/의 모든 *.test.js / *.test.mjs / *.test.cjs 검사
node scripts/test-project.mjs --all
```

두 명령은 범위가 다릅니다. 전체 검사는 실패를 숨기지 않고 실패 종료 코드를 반환합니다.
V12 검토 시 기존 실패 123건과 PowerShell 환경 관련 건너뜀 1건이 남아 있으며,
구버전 문구·고정 해시·DOM 모형·현재 동작과 기대값의 차이를 추가로 검토해야 합니다.
실제 Windows Excel·DataPARC·PDF 검증은 별도입니다.

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
24개 구버전 브라우저 경로를 웹 출력에서 제외합니다. 이 중 참조가 없는 18개 소스는 V12에서
제거했고, 과거 검사에서 사용하는 6개 소스는 유지합니다. 빌드는 제거된 경로가 다시
참조되어도 실패하도록 계속 확인합니다.

### 운영 구성 주의점

- 기존 D1/R2 바인딩과 환경변수를 보존하세요. `schema.sql`은 현재 API와 불일치하므로
  신규 DB 초기화나 운영 DB 갱신 명령으로 사용하면 안 됩니다.
- 직원 변경은 유효한 최고관리자 세션이 필요합니다. PC/모바일 인증 헤더도 함께 수정했습니다.
- 최초 관리자 생성은 32자 이상의 `USER_SETUP_KEY`와 일치하는 `X-Setup-Key`가 있어야 합니다.
  기존 관리자 계정이 있는 운영 환경에서는 이 생성 기능을 사용할 필요가 없습니다.
- 혼소율 Worker·Controller·Agent는 파일 해시가 연결돼 있으므로 한 묶음으로 유지하세요.
  두 기간 조회 PowerShell 파일은 `.gitattributes`로 CRLF 체크아웃을 고정합니다.
  무결성 검사는 계속 실제 파일 SHA-256을 엄격하게 비교합니다.
- Windows Excel/NativeOM/DataPARC 실행, 회사 네트워크, AhnLab 검사 및 배포 후 화면 검증은
  이 Linux 검토 환경에서 수행하지 않았습니다.
