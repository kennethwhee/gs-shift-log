# Limestone Slip OCR Reliability Fix v5

## 적용 기준

- v4가 적용된 `GS Shift Log` 저장소
- `index.html`에서 아래 캐시 버전이 확인되는 상태

```html
script.js?v=20260811-limestone-slip-ocr-v4
```

## 수정 파일

- `functions/api/limestone-slip-ocr.js`
- `index.html`
- `script.js`

## 수정 내용

1. 원본 사진에서 중량 3행의 시간·숫자 열만 직접 한 번 잘라 1차 OCR에 사용합니다.
2. 기존 넓은 크롭은 촬영 위치가 달라졌을 때의 2차 판독 안전망으로 유지합니다.
3. 정상 JSON뿐 아니라 깨진 JSON, `ROW1` 형식, Markdown 표·강조문자, 안전한 숫자 3행 응답도 복구합니다.
4. 단위 없는 숫자 후보는 정확히 3개이면서 중량 문맥 또는 숫자 3행 형식일 때만 산식 검증에 사용합니다.
5. 재판독 프롬프트에서 실제 중량 예시 숫자를 제거해 예시 복사 오인식을 방지합니다.
6. 두 판독값이 충돌하면 임의 선택하지 않습니다. 한쪽만 세 중량 산식 검증을 통과했을 때만 그 값을 채택합니다.
7. 인식 실패 시 화면에 개인정보가 없는 분석코드를 표시해 다음 진단이 가능하도록 합니다.
8. `script.js` 캐시 버전을 `20260811-limestone-slip-ocr-v5`로 변경합니다.

## 검증 결과

- 첨부 원본 사진에서 v5 중량 크롭에 `44,300 / 13,700 / 30,600 kg`가 모두 포함됨
- 로컬 OCR에서 세 값 모두 검출
- JSON·ROW·Markdown·숫자 3행·부분 인식 병합 테스트 통과
- 잡숫자·산식 불일치·두 판독 충돌 자동등록 차단 테스트 통과
- 두 JavaScript 문법검사 통과
- v4 기준 파일에 패치 적용 후 수정본과 바이트 단위 일치 확인

## 적용 전 검사

```powershell
git apply --check `
  '.\limestone-slip-ocr-reliability-fix-v5\limestone-slip-ocr-reliability-fix-v5.patch'
```

## 적용

```powershell
git apply `
  '.\limestone-slip-ocr-reliability-fix-v5\limestone-slip-ocr-reliability-fix-v5.patch'
```

## 적용 후 검사

```powershell
git diff --check -- `
  '.\functions\api\limestone-slip-ocr.js' `
  '.\index.html' `
  '.\script.js'

node --check '.\functions\api\limestone-slip-ocr.js'
node --check '.\script.js'
```
