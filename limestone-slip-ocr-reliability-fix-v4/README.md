# Limestone Slip OCR Reliability Fix v4

## 적용 기준

- v3 커밋 `a7b994b`가 적용된 `GS Shift Log` 저장소
- 기존 OCR 관련 3개 파일만 수정
  - `functions/api/limestone-slip-ocr.js`
  - `index.html`
  - `script.js`

## 수정 내용

1. 세로사진의 기존 좌상단 `72% × 56%` 고정 크롭을 넓혀 숫자와 `kg`가 경계에 걸리지 않게 했습니다.
2. 중량표를 더 크게 보여주는 타이트 크롭을 추가했습니다.
3. 서버는 타이트 크롭을 먼저 판독하고 실패 시 넓은 크롭으로 재판독합니다.
4. AI가 유효하지 않은 JSON이나 `ROW1=44300` 형식으로 응답해도 중량값을 복구합니다.
5. 총중량과 공차중량만 읽힌 경우에도 기존 산식 검증 후 실중량을 확정합니다.
6. `script.js` 캐시 버전을 `20260811-limestone-slip-ocr-v4`로 변경합니다.

## 적용 전 검사

```powershell
git apply --ignore-space-change --check `
  '.\limestone-slip-ocr-reliability-fix-v4.patch'
```

## 적용

```powershell
git apply --ignore-space-change `
  '.\limestone-slip-ocr-reliability-fix-v4.patch'
```

## 검증

```powershell
git diff --check -- `
  '.\functions\api\limestone-slip-ocr.js' `
  '.\index.html' `
  '.\script.js'

node --check '.\functions\api\limestone-slip-ocr.js'
node --check '.\script.js'
```

대표 테스트값 `44,300 / 13,700 / 30,600kg`, 쉼표·점 구분자, 비엄격 JSON, 행 기반 응답, 부분 인식, 산식 불일치 차단을 검증했습니다.
