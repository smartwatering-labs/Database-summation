$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $PSScriptRoot 'render\计划'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open((Join-Path $taskRoot '可行性复核与实施计划.docx'), $false, $true)
    try {
        $doc.Repaginate()
        Write-Output ('Pages=' + $doc.ComputeStatistics(2))
        $doc.ExportAsFixedFormat((Join-Path $outDir '计划.pdf'), 17)
    } finally {
        $doc.Close(0)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)
    }
} finally {
    if ($null -ne $word) {
        $word.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
}
