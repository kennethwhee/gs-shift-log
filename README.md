# 석회석 전표 OCR 안정화 패치 v3

수정 대상은 아래 세 파일의 관련 함수·섹션뿐입니다.

- `functions/api/limestone-slip-ocr.js`
- `script.js`
- `index.html`

핵심 수정:

- 재판독에서 읽은 값을 상단·중단·하단 행에 고정해 부분 인식값이 사라지지 않도록 수정
- `44,300 - 13,700 = 30,600 kg` 계산 검증 지원
- 서로 다른 두 번의 판독 결과를 합쳐 세 중량을 검증
- 실패 시 화면에 실제로 읽은 총중량·공차중량·실중량 표시
- `script.js` 캐시 버전을 변경해 iPhone Safari의 구형 스크립트 재사용 방지

프로젝트 폴더에서 먼저 확인합니다.

```powershell
git apply --check .\limestone-slip-ocr-reliability-fix-v3.patch
```

오류가 없으면 적용합니다.

```powershell
git apply .\limestone-slip-ocr-reliability-fix-v3.patch
node --check .\script.js
node --check .\functions\api\limestone-slip-ocr.js
git diff --check
```
