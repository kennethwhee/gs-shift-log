# 전체 회귀 V13 R2 — 기존 NativeOM 검사 수정 보존

## R1 적용 중단

사용자 PC에서 `tests/daily-data-open-workbook.test.mjs`가 R1의 검토 기준과 달라 사전검사에서 중단됐다. 해당 실행은 파일 수정·커밋·푸시 전에 멈췄다.

이전 `install-daily-data-multi-nativeom-v2.ps1`의 압축 payload를 복구하고 내부 SHA-256을 검증했다. 이 설치기는 기본 검사 파일을 수정하고 `tests/daily-data-multi-nativeom-v2.test.mjs`를 추가한다. V2는 COM identity, 단일 연결 조기 반환 방지, PID 대체 식별, 복수 연결 검색 검사를 포함한다. R1로 단순 교체하면 일부 기존 검사가 빠질 수 있어 그대로 덮어쓰지 않았다.

## R2 변경

- 기본 검사에 V2의 62개 assertion 문장을 모두 보존하고 R1의 검사와 병합했다.
- 별도 V2 검사에도 기존 38개 assertion 문장을 모두 보존했다.
- 기존 열린 통합문서 탐색과 이후 추가된 숨김 읽기 전용 폴백을 구분하여 검사한다. 기존 통합문서의 열기·저장·종료 금지는 탐색 구간에서 검증하고, 폴백 소유권·읽기 전용 열기·자신의 창만 정리하는 조건은 별도로 검증한다.
- PowerShell `-STA`는 Windows에서 유지하고 Linux에서는 전달하지 않는다.
- installer와 publisher는 복구해 검토한 V2 파일의 LF/CRLF/BOM 표현 및 기존 R1 파일만 추가로 인식한다. 임의의 내용은 허용하지 않는다. 모르는 변경이면 쓰기 전에 중단하며 실제 SHA-256을 표시한다.
- `daily-data-open-workbook.ps1`, `ois-login.js` 및 실행 중인 Excel/Agent는 수정하지 않는다.

사용자 현재 파일을 직접 읽었다고 주장하지 않는다. 알려진 V2와 같은지 여부는 R2가 사용자 PC에서 사전검사한다. 다른 내용이면 계속 중단한다.

## 검증

기준 main: `6904dc6dae82a19e1a1d23247e732c62395518a3`.

| 검사 | 결과 |
|---|---|
| R2 전체 Node 검사 162개 파일 | 1,902 통과 / 실패 0 / 건너뜀 0 |
| NativeOM 기본·추가 검사 | 16 통과 / 실패 0 / 건너뜀 0 |
| V2 기존 assertion 보존 대조 | 기본 62개 + 추가 38개 모두 유지 |

환경은 Node 24.19.0 / Linux / PowerShell 7.6.6이다. 실제 Windows PowerShell 5.1 및 Excel/DataPARC 조회는 실행하지 않았다.
기존 V13의 혼소율 복원·초기화 오류 수정은 동일하며, R2에서 제품 파일에 추가 변경하지 않았다.

패키지는 59개 대상(검토 파일 47개, 과거 검사 삭제 11개, 로더 URL 수정 1개)을 검사·백업한다. 설치/원복 및 Git 반영 검증 결과는 패키지 `VERIFICATION.json`과 `evidence/`에 포함한다.
