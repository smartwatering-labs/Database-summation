[CmdletBinding()]
param([string]$Compiler = '', [string]$ArduinoJsonInclude = '')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (!$Compiler) {
    $restoredCompiler = Join-Path $projectRoot '.tools/native-gcc/bin/g++.exe'
    $Compiler = if (Test-Path -LiteralPath $restoredCompiler) { $restoredCompiler } else { Join-Path $projectRoot '.tools/pio-core/packages/toolchain-gccmingw32/bin/g++.exe' }
}
if (!$ArduinoJsonInclude) { $ArduinoJsonInclude = Join-Path $projectRoot '.pio/libdeps/esp32-c3-devkitm-1/ArduinoJson/src' }
if (!(Test-Path -LiteralPath $Compiler)) { throw 'Install MinGW g++ and pass -Compiler, or use the project-local PlatformIO toolchain-gccmingw32.' }
if (!(Test-Path (Join-Path $ArduinoJsonInclude 'ArduinoJson.h'))) { throw 'Pass -ArduinoJsonInclude pointing to ArduinoJson 7.4.2/src.' }
$outputPath = Join-Path $projectRoot '.tools/firmware-harness.exe'
New-Item -ItemType Directory -Force (Split-Path $outputPath) | Out-Null
$originalPath = $env:Path
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$testTemp = Join-Path $projectRoot '.tools/tmp'
New-Item -ItemType Directory -Force $testTemp | Out-Null
try {
    $env:Path = "$(Split-Path $Compiler);$originalPath"
    $env:TEMP = $testTemp
    $env:TMP = $testTemp
    & $Compiler -std=c++14 -O1 -static -I $ArduinoJsonInclude (Join-Path $PSScriptRoot 'firmware-harness.cpp') -lbcrypt -o $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Native firmware harness compilation failed.' }
    $runtimeOutput = Join-Path $projectRoot '.tools/runtime-tests.exe'
    & $Compiler -std=c++14 -O1 -static (Join-Path $PSScriptRoot 'runtime.test.cpp') -o $runtimeOutput
    if ($LASTEXITCODE -ne 0) { throw 'Runtime tests compilation failed.' }
    & $runtimeOutput
    if ($LASTEXITCODE -ne 0) { throw 'Runtime control tests failed.' }
    & node --test (Join-Path $PSScriptRoot 'firmware.test.mjs') (Join-Path $projectRoot '../prototype/tests/protocol.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Firmware/browser protocol tests failed.' }
} finally { $env:Path = $originalPath; $env:TEMP = $originalTemp; $env:TMP = $originalTmp }
