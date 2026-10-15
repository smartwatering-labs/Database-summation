$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$renderRoot = Join-Path $PSScriptRoot 'render'
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    foreach ($name in @('硬件1','硬件2','网页1','网页2')) {
        $inputFile = Join-Path $taskRoot ($name + ' 项目背景修订版.docx')
        $outDir = Join-Path $renderRoot $name
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
        $pdfFile = Join-Path $outDir ($name + '.pdf')
        $doc = $word.Documents.Open($inputFile, $false, $true)
        try {
            $doc.Repaginate()
            $pages = $doc.ComputeStatistics(2)
            $doc.ExportAsFixedFormat($pdfFile, 17)
            Write-Output ($name + ' pages=' + $pages)
        } finally {
            $doc.Close(0)
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)
        }
    }
} finally {
    if ($null -ne $word) {
        $word.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
}
