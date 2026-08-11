# 석회석 전표 미리보기 확대 패치 v1

## 변경 대상

- `style.css`
- `index.html`

## 변경 내용

- 모바일 전표 미리보기 높이를 `clamp(135px, 22dvh, 200px)`에서 `clamp(220px, 38dvh, 300px)`로 확대
- 전표 전체가 잘리지 않도록 기존 `object-fit: contain` 유지
- 작은 화면에서는 사진·인식 결과 본문만 세로 스크롤되며 하단 등록 버튼은 그대로 고정
- iPhone Safari가 새 CSS를 즉시 불러오도록 CSS 캐시 버전 갱신

## 적용

프로젝트 최상위 폴더에서 실행합니다.

```powershell
git apply --check '.\limestone-slip-preview-large-fix-v1.patch'
git apply '.\limestone-slip-preview-large-fix-v1.patch'
```

## 검사

```powershell
git diff --check -- '.\style.css' '.\index.html'
```
