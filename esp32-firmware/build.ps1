[CmdletBinding()]
param(
    [string]$ArduinoCli = '',
    [switch]$Upload,
    [string]$Port = '',
    [switch]$ListPorts
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$sketchPath = Join-Path $projectRoot 'ble_oled_pairing'
if (!$ArduinoCli) {
    $command = Get-Command arduino-cli -ErrorAction SilentlyContinue
    if ($command) { $ArduinoCli = $command.Source }
    else { $ArduinoCli = Join-Path $env:LOCALAPPDATA 'Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe' }
}
if (!(Test-Path -LiteralPath $ArduinoCli)) {
    throw 'Arduino CLI not found. Install Arduino IDE 2, or pass -ArduinoCli with its full path. See README.md.'
}
if ($ListPorts) { & $ArduinoCli board list; exit $LASTEXITCODE }
if ($Upload -and !$Port) { throw 'Specify the board port explicitly: build.ps1 -Upload -Port COM5' }
$buildPath = Join-Path $projectRoot '.tools/arduino-build-ble-oled-pairing'
$outputPath = Join-Path $PSScriptRoot 'build'
$board = 'esp32:esp32:esp32c3:CDCOnBoot=cdc'
$arguments = @('compile', '--fqbn', $board, '--jobs', '4', '--clean', '--build-path', $buildPath, '--output-dir', $outputPath)
# Keep Arduino IDE's Library Manager as the normal source for ArduinoJson and U8g2.
# NimBLE is supplied from the project cache when it is not installed globally.
$projectNimble = Join-Path $PSScriptRoot '.pio/libdeps/esp32-c3-devkitm-1/NimBLE-Arduino'
if (Test-Path (Join-Path $projectNimble 'library.properties')) {
    $arguments += @('--library', $projectNimble)
}
$arguments += $sketchPath
Write-Host "Arduino CLI: $ArduinoCli"
Write-Host "Building ESP32-C3 firmware. Outputs: $outputPath"
& $ArduinoCli @arguments
if ($LASTEXITCODE -ne 0) { throw 'Firmware build failed. Check the board package and the three libraries listed in README.md.' }
$binaryPath = Join-Path $outputPath 'ble_oled_pairing.ino.bin'
if (!(Test-Path -LiteralPath $binaryPath)) { throw "Expected firmware binary was not created: $binaryPath" }
$sourceHashes = [ordered]@{}
foreach ($relativePath in @('ble_oled_pairing/ble_oled_pairing.ino', 'ble_oled_pairing/include/sws_core.h', 'ble_oled_pairing/include/board_config.h')) {
    $sourceHashes[$relativePath] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $relativePath)).Hash
}
$manifest = [ordered]@{
    firmwareVersion = '3.4.0'
    protocol = 'SWS-BLE 1.0'
    board = $board
    arduinoEsp32 = '3.3.10'
    oled = 'SSD1306 72x40, I2C 0x3C, SDA5 SCL6'
    builtAt = (Get-Date -Format o)
    sourceSha256 = $sourceHashes
    binarySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $binaryPath).Hash
    physicalHardwareVerified = $false
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $outputPath 'manifest.json')
$nestedSketchBuild = Join-Path $sketchPath 'build'
if ((Test-Path -LiteralPath $nestedSketchBuild) -and $nestedSketchBuild.StartsWith($sketchPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $nestedSketchBuild -Recurse -Force
}
if ($Upload) {
    Write-Host "Uploading to explicitly selected port: $Port"
    & $ArduinoCli upload --fqbn $board --port $Port --input-dir $outputPath $sketchPath
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Close Serial Monitor and confirm the board port / boot mode.' }
}
Write-Host 'Done.'
