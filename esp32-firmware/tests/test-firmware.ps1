[CmdletBinding()]
param([string]$Compiler = '', [string]$ArduinoJsonInclude = '')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (!$Compiler) { $Compiler = Join-Path $projectRoot '.tools/pio-core/packages/toolchain-gccmingw32/bin/g++.exe' }
if (!$ArduinoJsonInclude) { $ArduinoJsonInclude = Join-Path $projectRoot '.pio/libdeps/esp32-c3-devkitm-1/ArduinoJson/src' }
if (!(Test-Path -LiteralPath $Compiler)) { throw 'Install MinGW g++ and pass -Compiler, or use the project-local PlatformIO toolchain-gccmingw32.' }
if (!(Test-Path (Join-Path $ArduinoJsonInclude 'ArduinoJson.h'))) { throw 'Pass -ArduinoJsonInclude pointing to ArduinoJson 7.4.2/src.' }
$outputPath = Join-Path $projectRoot '.tools/firmware-harness.exe'
New-Item -ItemType Directory -Force (Split-Path $outputPath) | Out-Null
$originalPath = $env:Path
try {
    $env:Path = "$(Split-Path $Compiler);$originalPath"
    & $Compiler -std=c++14 -O1 -static -I $ArduinoJsonInclude (Join-Path $PSScriptRoot 'firmware-harness.cpp') -lbcrypt -o $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Native firmware harness compilation failed.' }
    & node --test (Join-Path $PSScriptRoot 'firmware.test.mjs') (Join-Path $projectRoot '../prototype/tests/protocol.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Firmware/browser protocol tests failed.' }
} finally { $env:Path = $originalPath }
