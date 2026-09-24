# 구조 정리 V12 · 2026-09-25

기준 커밋: `97260eb98bcbe1b27328445d81c7c3a1989a4e0e`. 사용자 운영 PC는 원격으로 실행하지 않았습니다.

## 이번 변경

- 이미 공개 빌드에서 제외되고 현재 화면·검사에서 참조하지 않는 구버전 파일 18개를 제거했습니다. 삭제 목록은 아래에 있습니다.
- PC `script.js`와 모바일 `mobile-runtime-v14.js`에서 뒤쪽의 같은 이름 선언에 가려진 전역 함수 선언을 각각 7개 제거했습니다. 활성 선언, 대입 형태의 후속 확장 코드와 실행 문장은 보존했습니다.
- 구문 분석으로 정리 전의 유효 프로그램과 정리 후의 모든 문장·함수 본문이 같은지 비교했습니다. 삭제한 선언에는 별도 실행 부작용이 없습니다.
- 두 화면의 스크립트 주소를 갱신했습니다. 모바일 preload와 실행 주소도 동일하게 유지합니다.
- 해시로 검증하는 두 기간 조회 PowerShell 파일에 CRLF 체크아웃 규칙을 추가했습니다. 기존 파일의 검증을 느슨하게 하거나 해시를 바꾸지 않았습니다.
- 핵심 보강 검사와 전체 과거 검사를 구분해서 실행할 수 있는 `scripts/test-project.mjs`를 추가했습니다.

전체 소스 감소량(새 문서·검사 파일 제외): 2,231,358바이트. 구버전 18개는 이미 웹 배포에서 제외되어 있었으므로, 이를 제거한 크기가 그대로 웹 전송 절감량인 것은 아닙니다.

## 검증 범위

| 검사 | 결과 |
| --- | --- |
| 앞선 핵심 보강 + 이번 정리, 7개 검사 파일 | 123개 통과 / 실패 0 / 건너뜀 0 |
| 전체 Node 검사, 변경 전 168개 파일 | 1,866개 중 1,742 통과 / 123 실패 / 1 건너뜀 |
| 전체 Node 검사, 변경 후 169개 파일 | 1,882개 중 1,758 통과 / 123 실패 / 1 건너뜀 |
| 변경 전후 실패 비교 | 실패한 파일·검사명이 모두 같음, 신규 실패 0 |
| 전역 선언 구문 비교 | PC·모바일 모두 나머지 구문 동일 |
| 공개 웹 빌드 | 177개 파일, 참조 검사 통과 |
| 새 체크아웃 | core.autocrlf=false / true / input 모두 실제 고정 해시와 일치 |

전체 검사 결과는 Node 24.19.0/Linux에서, PowerShell 파일을 실제 고정 해시에 맞는 CRLF로 준비한 동일 조건끼리 비교했습니다. 원래 LF 체크아웃에서는 해시 불일치로 추가 실패·타임아웃이 발생했습니다. 새 속성 파일은 이후 체크아웃을 고정하며 실행 중인 Agent를 수정하거나 재시작하지 않습니다.

기존 실패 123건은 해결 완료로 처리하지 않았습니다. 구버전 화면 문구·버전 주소·고정 해시, 부족한 DOM 모형, 날짜가 고정된 시험 데이터가 포함됩니다. UI 복원·조회·취소 흐름의 실패는 최신 동작을 재현해서 원인을 별도로 확정해야 합니다. 건너뜀 1건은 이 검사 실행의 PowerShell 환경 탐지 때문입니다.

이 패키지는 실행 중인 Agent, V10 컴파일 복구 파일, DB/R2, Excel 원본, 사용자 작업 기록을 변경하지 않습니다. 실제 PDF 출력과 회사 PC에서의 실패·취소·Excel 정리 검증은 별도입니다.

## 제거한 구버전 파일

- `mobile-app/mobile-runtime-v13.js`
- `maintenance/cofiring-detail-compact-v5-r1.js`
- `maintenance/morning-meeting-organic-silo-dataparc.css`
- `maintenance/cofiring-shared-settings-horizontal-v2.js`
- `maintenance/cofiring-detail-compact-v4.css`
- `maintenance/cofiring-closed-organic-autosave-v1.js`
- `maintenance/cofiring-section-header-align-v1.css`
- `maintenance/cofiring-detail-redesign-v6.js`
- `maintenance/cofiring-shared-settings-horizontal-v3.css`
- `maintenance/cofiring-detail-compact-v5-r1.css`
- `maintenance/cofiring-shared-settings-horizontal-v1.css`
- `maintenance/cofiring-shared-settings-horizontal-v1.js`
- `maintenance/cofiring-detail-compact-v2.css`
- `maintenance/cofiring-detail-compact-v3.css`
- `maintenance/cofiring-shared-settings-horizontal-v2.css`
- `maintenance/cofiring-detail-redesign-v6-r1.js`
- `maintenance/cofiring-shared-settings-horizontal-v3.js`
- `maintenance/cofiring-draft.css`

`scripts/build-web.mjs`의 구버전 경로 차단 목록은 그대로 두어, 삭제한 경로가 다시 화면에서 참조되면 빌드가 실패하게 했습니다. 과거 검사에서 참조하는 나머지 구버전 소스 6개는 유지했습니다.

## 남은 실패 목록

아래는 검사 파일별 실패 수입니다. 운영 장애 수를 뜻하지 않으며, 현재 동작에 맞춰 원인 확인이 필요합니다.

| 검사 파일 | 실패 수 |
| --- | ---: |
| `auxiliary-material-edit-validation-v1.test.mjs` | 1 |
| `blower-all-status-dashboard-v1.test.mjs` | 1 |
| `blower-cleanup-exit-race-v2.test.mjs` | 1 |
| `blower-fbhe-vibration-shadow.test.mjs` | 1 |
| `blower-mobile-refresh-hide-only-v1.test.mjs` | 1 |
| `blower-nativeom-temp-v14.test.cjs` | 1 |
| `blower-runtime-pilot-frontend.test.mjs` | 3 |
| `blower-startup-overlap-v13.test.cjs` | 1 |
| `cofiring-api-build-fingerprint-v1.test.cjs` | 1 |
| `cofiring-cache-v6.test.cjs` | 1 |
| `cofiring-click-timing-ui-v1.test.cjs` | 10 |
| `cofiring-closed-detail-operator-v1.test.cjs` | 3 |
| `cofiring-closed-detail-operator-v2.test.cjs` | 4 |
| `cofiring-closed-detail-operator-v3.test.cjs` | 3 |
| `cofiring-closed-detail-operator-v4.test.cjs` | 5 |
| `cofiring-closed-detail-operator-v5.test.cjs` | 3 |
| `cofiring-closed-detail-operator-v6.test.cjs` | 4 |
| `cofiring-closed-detail-operator-v7.test.cjs` | 2 |
| `cofiring-daily-date-v1.test.cjs` | 7 |
| `cofiring-development-label.test.cjs` | 1 |
| `cofiring-full-day-readiness-v1.test.cjs` | 2 |
| `cofiring-live-api.test.mjs` | 1 |
| `cofiring-organic-equal-split-v1.test.cjs` | 1 |
| `cofiring-organic-inventory-boundary-contract-v2.test.cjs` | 2 |
| `cofiring-organic-inventory-usage-v1.test.cjs` | 1 |
| `cofiring-organic-midnight-compact-v1.test.cjs` | 1 |
| `cofiring-organic-source-decouple-v1.test.cjs` | 3 |
| `cofiring-period-manual-api.test.mjs` | 1 |
| `cofiring-period-v5.test.cjs` | 5 |
| `cofiring-range-deadline-ui-v1.test.cjs` | 13 |
| `cofiring-saved-reopen-ui-v1.test.cjs` | 12 |
| `cofiring-startup-preservation.test.cjs` | 2 |
| `daily-data-open-workbook.test.mjs` | 4 |
| `morning-meeting-auto-history-blank-restore-v1.test.mjs` | 1 |
| `morning-meeting-cofiring-coal-review-popup-v4.test.cjs` | 1 |
| `morning-meeting-cofiring-coal-review-popup-v5.test.cjs` | 1 |
| `morning-meeting-cofiring-coal-review-popup-v6.test.cjs` | 1 |
| `morning-meeting-cofiring-max-review-center-v1.test.cjs` | 1 |
| `morning-meeting-query-sources.test.mjs` | 5 |
| `morning-meeting-selected-date-reset-v1.test.mjs` | 4 |
| `organic-silo-frontend.test.mjs` | 2 |
| `solid-fuel-record-single-row-fit-v1.test.cjs` | 1 |
| `solid-fuel-record-single-row-v1.test.cjs` | 2 |
| `solid-fuel-record-single-row-width-tune-v1.test.cjs` | 2 |

## 다음 검토 순서

1. 조회 결과 복원·기간 전환·저장 흐름의 기존 실패를 현재 UI와 같은 DOM/자료 조건으로 재현합니다. 구버전 문자열 검사와 실제 동작 오류를 구분합니다.
2. 메인 JS/CSS의 기능별 분리와 누적 화면 보정 코드를 단계적으로 통합합니다. 같은 역할의 코드라도 실행 순서·이벤트·선택자 의존성을 확인한 뒤 변경합니다.
3. 추적 중인 node_modules·과거 백업·진단 산출물을 Git에서 분리하는 절차를 마련합니다. 운영 PC의 실행 파일·원본 자료를 지우지 않도록 작업합니다.
4. 새 환경 설치, 현재 DB 구조와 마이그레이션, PDF·조회 취소·실패 후 정리 및 복구를 검증합니다.

## 로컬 명령

```powershell
node scripts/test-project.mjs --review
node scripts/test-project.mjs --all
node scripts/build-web.mjs --out=web-dist-review-v12
```

전체 검사는 남은 실패 때문에 0이 아닌 종료 코드를 반환합니다. 통과한 검사만 골라 전체 완료로 표시하지 않습니다.
