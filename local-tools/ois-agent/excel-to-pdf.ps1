param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$SheetName
)

$ErrorActionPreference = 'Stop'

$InputPath = [System.IO.Path]::GetFullPath($InputPath)
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Excel 파일을 찾을 수 없습니다: $InputPath"
}

$outputDirectory =
    [System.IO.Path]::GetDirectoryName(
        $OutputPath
    )

if (
    $outputDirectory -and
    -not (Test-Path -LiteralPath $outputDirectory)
) {
    New-Item `
        -ItemType Directory `
        -Path $outputDirectory `
        -Force |
        Out-Null
}

$excel = $null
$workbook = $null
$sheet = $null

try {
    $excel =
        New-Object `
            -ComObject Excel.Application

    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    $workbook =
        $excel.Workbooks.Open(
            $InputPath,
            0,
            $true
        )

    try {
        $sheet =
            $workbook.Worksheets.Item(
                $SheetName
            )
    }
    catch {
        throw "Excel 시트를 찾을 수 없습니다: $SheetName"
    }

    if (
        Test-Path -LiteralPath $OutputPath
    ) {
        Remove-Item `
            -LiteralPath $OutputPath `
            -Force
    }

    # 0 = xlTypePDF
    #
    # IgnorePrintAreas = false
    # → Excel 원본의 PrintArea / 페이지 나누기 /
    #   여백 / 방향 / FitToPages 설정을 그대로 사용
    $sheet.ExportAsFixedFormat(
        0,
        $OutputPath,
        0,
        $true,
        $false
    )

    if (
        -not (
            Test-Path -LiteralPath $OutputPath
        )
    ) {
        throw 'PDF 파일이 생성되지 않았습니다.'
    }

    $pdf =
        Get-Item `
            -LiteralPath $OutputPath

    Write-Output (
        [PSCustomObject]@{
            ok = $true
            sheetName = $SheetName
            inputPath = $InputPath
            outputPath = $pdf.FullName
            size = $pdf.Length
        } |
        ConvertTo-Json `
            -Compress
    )
}
finally {
    if ($workbook) {
        try {
            $workbook.Close($false)
        }
        catch {}
    }

    if ($excel) {
        try {
            $excel.Quit()
        }
        catch {}
    }

    if ($sheet) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject(
            $sheet
        )
    }

    if ($workbook) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject(
            $workbook
        )
    }

    if ($excel) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject(
            $excel
        )
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}