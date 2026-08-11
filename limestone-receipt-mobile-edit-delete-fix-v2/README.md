# 석회석 입고기록 모바일 수정·삭제 표시 v2

## 기준

- 최신 `main`: `19a551d`
- 기존 CSS 캐시: `20260811-limestone-slip-preview-large1`

## 변경 파일

- `index.html`
- `style.css`

## 변경 내용

- 모바일 `입고기록 상세` 표에 숨겨져 있던 `관리` 열을 다시 표시합니다.
- 각 기록 오른쪽에 기존 `수정`, `삭제` 버튼을 나란히 표시합니다.
- 모바일 표는 `일자 · 시간 · 호기 · 입고량 · 관리` 5열로 유지합니다.
- 화면 폭 확보를 위해 모바일 상세표의 `당일 누적` 열만 숨깁니다.
- 수정 시 기존 입력창에서 날짜, 시간, 호기, 입고량, 비고를 변경할 수 있습니다.
- 삭제 시 대상 날짜, 호기, 입고량을 보여준 뒤 확인합니다.
- 기존 작성자·관리자 권한과 `revision` 충돌 방지 로직을 그대로 사용합니다.
- OCR, 전표사진 미리보기, 등록 버튼 및 서버 API는 변경하지 않습니다.

## 적용 전 검사

```powershell
git apply --check '.\limestone-receipt-mobile-edit-delete-fix-v2\limestone-receipt-mobile-edit-delete-fix-v2.patch'
```

## 실제 적용

```powershell
git apply '.\limestone-receipt-mobile-edit-delete-fix-v2\limestone-receipt-mobile-edit-delete-fix-v2.patch'
```

## 적용 후 검사

```powershell
git diff --check -- '.\index.html' '.\style.css'
git diff --stat -- '.\index.html' '.\style.css'
```
