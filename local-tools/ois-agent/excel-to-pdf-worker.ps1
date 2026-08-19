$ErrorActionPreference = 'Stop'

$utf8NoBom =
    New-Object System.Text.UTF8Encoding($false)

[Console]::InputEncoding =
    $utf8NoBom

[Console]::OutputEncoding =
    $utf8NoBom

$script:excel =
    $null

$script:workbooks =
    $null


function Write-WorkerResponse {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Payload
    )

    $json =
        $Payload |
        ConvertTo-Json `
            -Compress `
            -Depth 8

    [Console]::Out.WriteLine(
        $json
    )

    [Console]::Out.Flush()
}


function Release-ComObjectSafely {
    param(
        $Value
    )

    if (
        $null -eq $Value
    ) {
        return
    }

    try {
        if (
            [System.Runtime.InteropServices.Marshal]::IsComObject(
                $Value
            )
        ) {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject(
                $Value
            )
        }
    }
    catch {}
}


function Stop-ExcelApplication {
    if (
        $script:workbooks
    ) {
        Release-ComObjectSafely `
            $script:workbooks

        $script:workbooks =
            $null
    }

    if (
        $script:excel
    ) {
        try {
            $script:excel.Quit()
        }
        catch {}

        Release-ComObjectSafely `
            $script:excel

        $script:excel =
            $null
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}


function Start-ExcelApplication {
    $stopwatch =
        [System.Diagnostics.Stopwatch]::StartNew()

    $script:excel =
        New-Object `
            -ComObject Excel.Application

    $script:excel.Visible =
        $false

    $script:excel.DisplayAlerts =
        $false

    $script:excel.AskToUpdateLinks =
        $false

    $script:workbooks =
        $script:excel.Workbooks

    $stopwatch.Stop()

    return [int64]$stopwatch.ElapsedMilliseconds
}


function Test-ExcelApplication {
    if (
        $null -eq $script:excel -or
        $null -eq $script:workbooks
    ) {
        return $false
    }

    try {
        $null =
            $script:excel.Version

        return $true
    }
    catch {
        return $false
    }
}


function Ensure-ExcelApplication {
    if (
        Test-ExcelApplication
    ) {
        return [int64]0
    }

    Stop-ExcelApplication

    return Start-ExcelApplication
}


function Convert-WorkbookToPdf {
    param(
        [Parameter(Mandatory = $true)]
        $Command
    )

    $requestId =
        [string]$Command.id

    $workbook =
        $null

    $worksheets =
        $null

    $sheet =
        $null

    $stopwatch =
        [System.Diagnostics.Stopwatch]::StartNew()

    try {
        [void](
            Ensure-ExcelApplication
        )

        $inputPath =
            [System.IO.Path]::GetFullPath(
                [string]$Command.inputPath
            )

        $outputPath =
            [System.IO.Path]::GetFullPath(
                [string]$Command.outputPath
            )

        $sheetName =
            [string]$Command.sheetName

        if (
            -not (
                Test-Path `
                    -LiteralPath $inputPath
            )
        ) {
            throw "Excel ?뚯씪??李얠쓣 ???놁뒿?덈떎: $inputPath"
        }

        if (
            [string]::IsNullOrWhiteSpace(
                $sheetName
            )
        ) {
            throw 'Excel ?쒗듃紐낆씠 鍮꾩뼱 ?덉뒿?덈떎.'
        }

        $outputDirectory =
            [System.IO.Path]::GetDirectoryName(
                $outputPath
            )

        if (
            $outputDirectory -and
            -not (
                Test-Path `
                    -LiteralPath $outputDirectory
            )
        ) {
            New-Item `
                -ItemType Directory `
                -Path $outputDirectory `
                -Force |
                Out-Null
        }

        if (
            Test-Path `
                -LiteralPath $outputPath
        ) {
            Remove-Item `
                -LiteralPath $outputPath `
                -Force
        }

        $workbook =
            $script:workbooks.Open(
                $inputPath,
                0,
                $true
            )

        $worksheets =
            $workbook.Worksheets

        $sheet =
            $worksheets.Item(
                $sheetName
            )

        # 0 = xlTypePDF
        # 湲곗〈 Excel ?몄뇙?곸뿭 / ?섏씠吏 ?ㅼ젙??洹몃?濡??ъ슜?쒕떎.
        $sheet.ExportAsFixedFormat(
            0,
            $outputPath,
            0,
            $true,
            $false
        )

        if (
            -not (
                Test-Path `
                    -LiteralPath $outputPath
            )
        ) {
            throw 'PDF ?뚯씪???앹꽦?섏? ?딆븯?듬땲??'
        }

        $pdf =
            Get-Item `
                -LiteralPath $outputPath

        $stopwatch.Stop()

        Write-WorkerResponse (
            [PSCustomObject]@{
                type = 'result'
                id = $requestId
                ok = $true
                sheetName = $sheetName
                size = [int64]$pdf.Length
                durationMs = [int64]$stopwatch.ElapsedMilliseconds
            }
        )
    }
    catch {
        $stopwatch.Stop()

        Write-WorkerResponse (
            [PSCustomObject]@{
                type = 'result'
                id = $requestId
                ok = $false
                error = $_.Exception.Message
                durationMs = [int64]$stopwatch.ElapsedMilliseconds
            }
        )
    }
    finally {
        if (
            $workbook
        ) {
            try {
                $workbook.Close(
                    $false
                )
            }
            catch {}
        }

        if (
            $sheet
        ) {
            Release-ComObjectSafely `
                $sheet
        }

        if (
            $worksheets
        ) {
            Release-ComObjectSafely `
                $worksheets
        }

        if (
            $workbook
        ) {
            Release-ComObjectSafely `
                $workbook
        }
    }
}


$workerExitCode =
    0

try {
    $startupMs =
        Start-ExcelApplication

    Write-WorkerResponse (
        [PSCustomObject]@{
            type = 'ready'
            ok = $true
            startupMs = [int64]$startupMs
        }
    )

    while (
        $true
    ) {
        $line =
            [Console]::In.ReadLine()

        if (
            $null -eq $line
        ) {
            break
        }

        if (
            [string]::IsNullOrWhiteSpace(
                $line
            )
        ) {
            continue
        }

        $requestId =
            ''

        try {
            $command =
                $line |
                ConvertFrom-Json

            $requestId =
                [string]$command.id

            $commandType =
                [string]$command.type

            if (
                $commandType -eq
                    'convert'
            ) {
                Convert-WorkbookToPdf `
                    -Command $command

                continue
            }

            if (
                $commandType -eq
                    'ping'
            ) {
                Write-WorkerResponse (
                    [PSCustomObject]@{
                        type = 'result'
                        id = $requestId
                        ok = $true
                        pong = $true
                    }
                )

                continue
            }

            throw "吏?먰븯吏 ?딅뒗 Worker 紐낅졊?낅땲?? $commandType"
        }
        catch {
            Write-WorkerResponse (
                [PSCustomObject]@{
                    type = 'result'
                    id = $requestId
                    ok = $false
                    error = $_.Exception.Message
                }
            )
        }
    }
}
catch {
    $workerExitCode =
        1

    try {
        Write-WorkerResponse (
            [PSCustomObject]@{
                type = 'fatal'
                ok = $false
                error = $_.Exception.Message
            }
        )
    }
    catch {}
}
finally {
    Stop-ExcelApplication
}

exit $workerExitCode