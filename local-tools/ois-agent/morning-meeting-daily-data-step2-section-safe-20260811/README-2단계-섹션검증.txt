GS Shift Log 오전회의 일일 DATA 미리보기 2단계 섹션 검증본
=============================================================

수정 대상
1. local-tools/ois-agent/ois-login.js
2. script.js

수정하지 않는 파일
- functions/api/ois-data-requests.js
- style.css

적용 내용
1. Windows PowerShell 5.1에서 실패한 Normalize-ExcelText 함수 전체 교체
2. 에이전트 표시명을 증기 현황/OIS가 아닌 일일 DATA/Excel로 정리
3. ensureSiloPreviewCard() 전체 교체
4. 기존 steam_status 내부 호환 키를 유지하면서 일일 DATA 클라이언트 섹션 전체 교체
5. 자동자료 미리보기에 전력·증기·하수슬러지·유기성 사일로 값을 모두 표시
6. 유기성 사일로 값은 소수점 6자리 보존
7. 공용 버튼명을 OIS 자동자료 다시 조회 → 자동자료 다시 조회로 변경

검증 방식
- 파일 전체 SHA256은 적용 조건으로 사용하지 않음
- 패치가 소유하는 함수·섹션 3개와 문구 7개의 상태를 각각 검사
- 각 위치는 정확한 설치 전 상태 또는 정확한 설치 후 상태만 허용
- 대상 밖의 석회석·모바일·OCR 등 후속 수정은 그대로 보존
- 대상 위치에 알 수 없는 변경이 있으면 백업·쓰기 전에 중단
- 검사 중 다른 작업이 파일을 변경해도 쓰기 전에 중단
- 적용 전후 JavaScript 문법 검사
- 변경 파일별 원본 백업 및 적용 중 오류 시 자동 복원
- 이미 적용된 항목과 일부 적용된 항목도 안전하게 판별

읽기 전용 검사
프로젝트 최상위 폴더를 두 번째 인수로 지정한다.

node apply-step2-idempotent.js --check "C:\Users\GSENR\Desktop\gs-shift-log"

정상 검사 결과
- Status       : CHECK_OK
- WouldChange  : YES 또는 NO
- Write        : NONE

실제 적용

node apply-step2-idempotent.js "C:\Users\GSENR\Desktop\gs-shift-log"

정상 적용 결과
- Status       : OK
- AgentSHA256  : 적용 후 실제 해시
- ScriptBefore : 적용 직전 script.js 전체 해시
- ScriptSHA256 : 대상 밖 최신 수정을 보존한 적용 후 실제 해시
- APIChange    : NONE

이미 전부 적용된 경우
- Status       : ALREADY_INSTALLED
- Backup       : NONE

정상 기준 구간 SHA256
- Normalize-ExcelText 설치 전
  C9F9277B6A80CE8B9DAD473A54B3A5B805E2B51D7275074D1BA9090DE979768E
- 자동수치 하단 카드 설치 전
  FBACEA13102DED192F0859EC032CA96E25BFDDAADA7B769995E51C26531E7AE2
- 월간 일일DATA 클라이언트 설치 전
  15E301C5852777E1A52B1BD1DA9F4A73FCFB84943FE9FFFD873660FC98401967

