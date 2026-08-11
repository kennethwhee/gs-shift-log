# 석회석 모바일 사용량 모니터링 전용 + PC 수정·삭제 권한 패치 v2

기준 소스: `origin/main` 커밋 `fe4194be23d020fbef7bdc894aba830986455158`

## 적용 범위

- 모바일(화면 폭 768px 이하)의 **석회석 > 사용량 계산** 화면을 조회 전용으로 전환합니다.
- 모바일에서 시작·종료 재고 직접 입력, OIS 조회 요청, 기간 전체 계산·저장 실행을 숨기고 실행도 차단합니다.
- 모바일에서 석회석 입고기록의 수정·삭제 버튼을 숨깁니다.
- 날짜 이동, 입고량 새로고침, 저장된 일일 사용량과 기간별 저장 내역 조회는 유지합니다.
- PC(769px 이상)에서는 로그인한 모든 직원에게 석회석 입고기록 수정·삭제 버튼을 표시합니다.
- 서버에서도 로그인한 모든 직원의 수정·삭제를 허용합니다.
- 동시 수정 충돌 방지를 위한 `revision` 검사는 그대로 유지합니다.
- 변경 파일은 `index.html`, `script.js`, `style.css`, `functions/api/limestone-receipts.js` 4개입니다.

## 적용 전 확인

기존 `limestone-mobile-usage-monitor-only-v1` 폴더는 그대로 두어도 됩니다. v1 패치를 **압축만 풀고 아직 적용하지 않았다면**, 아래 v2만 적용하세요. v2에는 v1 내용이 모두 포함되어 있습니다.

## 적용 방법 (PowerShell)

프로젝트 폴더에서 아래 명령을 그대로 실행합니다. 압축 해제 폴더 뒤에 `(1)`, `(2)`가 붙어도 자동으로 가장 최근 v2 폴더를 찾습니다.

```powershell
$repo = "C:\Users\GSENR\Desktop\gs-shift-log"

$patchFolder = Get-ChildItem `
  -LiteralPath "$repo\local-tools" `
  -Directory |
  Where-Object {
    $_.Name -like 'limestone-mobile-usage-monitor-only-v2*'
  } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $patchFolder) {
  throw 'local-tools에서 limestone-mobile-usage-monitor-only-v2 폴더를 찾지 못했습니다.'
}

$patch = Join-Path `
  $patchFolder.FullName `
  'limestone-mobile-usage-monitor-only-v2.patch'

Set-Location $repo
git status --short
git apply --check -- $patch
```

`git apply --check`가 아무 메시지 없이 끝나면 적용할 수 있습니다.

```powershell
git apply -- $patch

node --check '.\script.js'
node --check '.\functions\api\limestone-receipts.js'

git diff --check -- `
  '.\index.html' `
  '.\script.js' `
  '.\style.css' `
  '.\functions\api\limestone-receipts.js'

git diff --stat -- `
  '.\index.html' `
  '.\script.js' `
  '.\style.css' `
  '.\functions\api\limestone-receipts.js'
```

## 확인 항목

1. 모바일 `석회석 > 사용량 계산`에서 시작·종료 재고는 값만 보이고 입력할 수 없습니다.
2. 모바일에서 OIS 조회와 `기간 전체 계산 및 저장` 버튼이 보이지 않습니다.
3. 모바일에서 석회석 입고기록의 수정·삭제 버튼이 보이지 않습니다.
4. 모바일 날짜 이동·입고량 새로고침·저장된 기간 내역 조회는 작동합니다.
5. PC에서 일반 직원으로 로그인해도 입고기록의 수정·삭제 버튼이 보입니다.
6. PC 일반 직원 계정에서 수정·삭제가 실제로 완료됩니다.
7. PC 최고관리자 계정도 기존처럼 수정·삭제할 수 있습니다.

## 검토 후 커밋

네 파일만 선택해 커밋합니다.

```powershell
git add -- `
  '.\index.html' `
  '.\script.js' `
  '.\style.css' `
  '.\functions\api\limestone-receipts.js'

git diff --cached --check
git status --short

git commit -m "모바일 석회석 조회 전용 및 수정 삭제 권한 개선"
```

## 적용 취소

아직 커밋하지 않았다면 먼저 역적용 가능 여부를 확인한 뒤 취소할 수 있습니다.

```powershell
git apply -R --check -- $patch
git apply -R -- $patch
```

> `git apply --check`가 실패하면 강제로 적용하지 마세요. v1을 이미 적용했거나 현재 로컬 소스가 기준 커밋과 달라졌을 수 있으므로 오류 내용을 확인한 뒤 병합해야 합니다.
