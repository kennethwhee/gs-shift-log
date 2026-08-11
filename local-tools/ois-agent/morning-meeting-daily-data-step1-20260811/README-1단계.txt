업무일지 오전회의 일일DATA관리 Excel 연동 1단계
================================================

적용 대상
- local-tools\ois-agent\ois-login.js
- 기준 크기: 339333 bytes
- 기준 SHA256:
  B98BFF19D3FEA3B0A1A8052EE68803B6CD00BAC7927518AB575A9503EC66B0C5

이 패치는 파일 전체를 준비된 최종본으로 덮어쓰지 않습니다.
현재 파일에서 아래 섹션을 정확히 한 곳씩 찾아 교체합니다.

1. DataPARC 증기생산량 정의 → 월간 일일DATA관리 정의
2. 열린 Excel 조회 PowerShell 섹션
3. 기존 DataPARC 증기 누적차 및 OIS 일별 증기판매량 섹션
4. steam_status 콘솔 출력 함수

새 조회 기준
- 조회 대상일의 YY.MM-일일DATA관리.xlsx를 자동 선택
- Plant!F4의 연월과 Plant!F5:AJ5의 일자를 이중 검증
- 1·2호기 생산량: Plant 51·52행
- 태양광/발전/수전/송전: Plant 55·56·58·63행
- 저압/고압증기: Plant 72·73행
- 하수슬러지: Plant 288~297행 합계 및 차량 수
- 유기성 Silo: Data Normalize (2)의 DataPARC 태그 3개

월 경계 예
- 2026-08-31 자료 → 26.08-일일DATA관리.xlsx
- 2026-09-01 자료 → 26.09-일일DATA관리.xlsx

안전장치
- 기준 SHA256이 다르면 적용하지 않음
- OIS 에이전트 실행 중이면 적용하지 않음
- 교체 앵커가 한 곳이 아니면 적용하지 않음
- 후보 파일의 node --check 성공 후에만 실제 파일 교체
- 원본 백업 자동 생성
- 설치 후 node --check 실패 시 백업 자동 복구

1단계에서는 다음 파일을 수정하지 않습니다.
- 최상위 script.js
- functions\api\ois-data-requests.js

API는 steam_status 결과 JSON의 추가 필드를 그대로 D1에 저장하므로
1단계에 별도 DB 변경이 필요하지 않습니다.
