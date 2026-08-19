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

$timingLogPath =
    Join-Path `
        ([System.IO.Path]::GetTempPath()) `
        'gs-log-sheet-pdf-excel-timing.log'

$timingStopwatch =
    [System.Diagnostics.Stopwatch]::StartNew()

$timingPreviousMs = 0

function Write-ExcelPdfTiming {
    param(
        [string]$Label
    )

    try {
        $currentMs =
            $timingStopwatch.ElapsedMilliseconds

        $stepMs =
            $currentMs -
            $script:timingPreviousMs

        $script:timingPreviousMs =
            $currentMs

        $line =
            '{0:yyyy-MM-dd HH:mm:ss.fff} | {1} | step={2}ms | total={3}ms | sheet={4}' -f `
                (Get-Date),
                $Label,
                $stepMs,
                $currentMs,
                $SheetName

        Add-Content `
            -LiteralPath $timingLogPath `
            -Value $line `
            -Encoding UTF8
    }
    catch {
        # 진단 로그 오류가 PDF 생성에 영향을 주지 않도록 무시
    }
}

Write-ExcelPdfTiming 'script-start'

try {
    $excel =
        New-Object `
            -ComObject Excel.Application

    Write-ExcelPdfTiming 'excel-application-created'

    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false

    Write-ExcelPdfTiming 'excel-settings-applied'

    $workbook =
        $excel.Workbooks.Open(
            $InputPath,
            0,
            $true
        )

    Write-ExcelPdfTiming 'workbook-opened'

    try {
        $sheet =
            $workbook.Worksheets.Item(
                $SheetName
            )
    }
    catch {
        throw "Excel 시트를 찾을 수 없습니다: $SheetName"
    }

    Write-ExcelPdfTiming 'worksheet-selected'

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

    Write-ExcelPdfTiming 'pdf-exported'

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

    Write-ExcelPdfTiming 'result-ready'

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
    Write-ExcelPdfTiming 'cleanup-start'
    if ($workbook) {
        try {
            $workbook.Close($false)

            Write-ExcelPdfTiming 'workbook-closed'
        }
        catch {}
    }

    if ($excel) {
        try {
            $excel.Quit()

            Write-ExcelPdfTiming 'excel-quit'
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

    Write-ExcelPdfTiming 'cleanup-complete'
}