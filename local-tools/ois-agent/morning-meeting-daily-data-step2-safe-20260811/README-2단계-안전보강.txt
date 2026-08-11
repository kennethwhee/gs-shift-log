GS Shift Log 오전회의 일일 DATA 미리보기 2단계 안전 보강본
============================================================

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
5. 자동자료 미리보기에 다음 값을 모두 표시
   - 태양광 일일 발전량
   - 발전량 / 수전량 / 송전량
   - 저압·고압·총·평균 증기 판매량
   - 1·2호기·총 증기생산량과 판매율
   - 하수슬러지 실제 입고내역·총량·차량 수
   - 유기성 Day Silo / Storage A / Storage B / 합계
6. 유기성 사일로 값은 소수점 6자리 보존
7. 공용 버튼명을 OIS 자동자료 다시 조회 → 자동자료 다시 조회로 변경

화면 구성
- 기존 Silo Level 카드 유지
- 전력 현황 카드
- 증기 생산·판매 전체 폭 카드
- 하수슬러지 입고 카드
- 유기성 사일로 카드
- 모바일은 기존 CSS 규칙에 따라 한 열로 표시

적용 전 필수 기준
- 1단계 적용 후 ois-login.js SHA256
  F486C4506D8430697CC64F3490BC3CAA68FFEDD08F2CB88E4FC5CCE317C8E3B9
- 허용되는 script.js SHA256
  85DD91348910E379D20C6A3212F32E12822CD39C0EBDD16379D19C55DC89D028
  A286C8679B84C2E734CAD4ED8DE61BA4EB1FA9435D2730189E243BCBD9DBB199
- 전체 파일뿐 아니라 오전회의 교체 대상 두 구간의 원본 SHA256도 일치해야 함

실행
프로젝트 최상위 폴더에서 아래처럼 실행한다.

node ".\local-tools\ois-agent\morning-meeting-daily-data-step2-safe-20260811\apply-step2-safe.js" "."

정상 적용 결과
- Status       : OK
- AgentBefore  : F486C4506D8430697CC64F3490BC3CAA68FFEDD08F2CB88E4FC5CCE317C8E3B9
- AgentLength  : 289121
- AgentSHA256  : CA0DC1916C4EFA4D3C1EF947D26BC9FC5DA9E9121E76FAD3D0B3595DAEF3608B
- ScriptBefore : A286C8679B84C2E734CAD4ED8DE61BA4EB1FA9435D2730189E243BCBD9DBB199
- ScriptLength와 ScriptSHA256은 사용자 현재본의 보존된 후속 수정에 따라 출력값 확인
- APIChange    : NONE

안전장치
- 전체 기준 해시가 다르면 쓰기 전에 중단
- 오전회의 교체 대상 두 구간의 원본 해시가 다르면 쓰기 전에 중단
- 줄바꿈 형식이 섞인 파일이면 다른 구간의 바이트 변경을 막기 위해 쓰기 전에 중단
- 모든 교체 앵커가 정확히 한 곳인지 검사
- 두 JavaScript 파일 문법을 쓰기 전에 검사
- 두 원본 파일을 타임스탬프 백업한 뒤 적용
- 파일 쓰기 후 실제 바이트 해시를 다시 검사
- 적용 도중 쓰기 실패 시 백업에서 자동 복구
