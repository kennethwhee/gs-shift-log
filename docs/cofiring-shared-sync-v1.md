# Co-firing shared sync V1

목적: 오전회의자료와 혼소율 분석 화면이 **동일한 canonical 데이터**를 사용하도록 통합한다.

- 발열량/보정계수 canonical 저장소: `/api/cofiring-calculation-settings` + `cofiring_calculation_settings_history`
  - 오전회의자료의 기존 `/api/morning-meeting-cofiring-settings` 경로는 요청/응답 호환 어댑터로만 남는다.
  - 오전회의자료에서 발열량을 저장해도 canonical history에 새 이력이 추가되므로 혼소율 분석의 **발열량 저장 이력**에 동일하게 나타난다.
  - 생략된 연료와 기존 보정계수는 유지한다. 오전회의의 공통 발열량은 1·2호기에 동일하게 저장한다.
- 혼소 조정 canonical 저장소: `/api/cofiring-period-adjustments`
  - 오전회의자료의 기준일 `YYYY-MM-DD`는 메인 일별 혼소율과 같은 `00:00 -> 다음 날 00:00` 기간으로 매핑한다.
  - 오전회의의 수동 이동/최대혼소/최종값 수정/원복이 메인 혼소율 분석과 같은 revision 및 저장값을 사용한다.
- 각 화면은 열기/조회/계산 시 canonical API를 다시 읽으므로 어느 화면에서 저장했는지와 관계없이 다음 조회부터 동일한 값을 사용한다.
- 기존 Morning Meeting 전용 legacy 테이블은 삭제·초기화·마이그레이션하지 않는다. 이 패치 이후 호환 경로가 더 이상 해당 테이블을 읽거나 쓰지 않는다.
- 혼소율 계산식, DataPARC Worker/Agent, 최종 Excel, TO 전력, Steam OIS, DB reset/migration은 변경하지 않는다.
