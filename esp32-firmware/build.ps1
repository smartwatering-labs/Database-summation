[CmdletBinding()]
param(
    [string]$ArduinoCli = '',
    [switch]$Upload,
    [string]$Port = '',
    [switch]$ListPorts,
    [switch]$Clean
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
$arguments = @('compile', '--fqbn', $board, '--jobs', '4', '--build-path', $buildPath, '--output-dir', $outputPath)
if ($Clean) { $arguments += '--clean' }
function Get-SourceHashes {
    $hashes = [ordered]@{}
    foreach ($sourceFile in (Get-ChildItem -LiteralPath $sketchPath -Recurse -File | Where-Object { $_.Extension -in @('.ino','.h','.cpp') -and !$_.FullName.StartsWith((Join-Path $sketchPath 'build')) } | Sort-Object FullName)) {
        $relativePath = $sourceFile.FullName.Substring($projectRoot.Length + 1).Replace('\','/')
        $hashes[$relativePath] = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile.FullName).Hash
    }
    return $hashes
}
$sourceHashes = Get-SourceHashes
# Arduino-ESP32 3.3.7+ requires the NimBLE initialization fix in 2.3.8+.
$installedNimble = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Arduino/libraries/NimBLE-Arduino'
$projectNimble = Join-Path $PSScriptRoot '.pio/libdeps/esp32-c3-devkitm-1/NimBLE-Arduino'
$selectedNimble = $null
$nimbleVersion = $null
foreach ($candidate in @($installedNimble, $projectNimble)) {
    $properties = Join-Path $candidate 'library.properties'
    if (!(Test-Path -LiteralPath $properties)) { continue }
    $versionMatch = [regex]::Match((Get-Content -LiteralPath $properties -Raw), '(?m)^version=([0-9.]+)')
    if ($versionMatch.Success -and [version]$versionMatch.Groups[1].Value -ge [version]'2.4.0') {
        $selectedNimble = $candidate
        $nimbleVersion = $versionMatch.Groups[1].Value
        break
    }
}
if (!$selectedNimble) { throw 'Install NimBLE-Arduino 2.4.0 or later in Arduino Library Manager for the server-start API and Arduino-ESP32 3.3.10 initialization compatibility.' }
$arguments += @('--library', $selectedNimble)
Write-Host "NimBLE-Arduino: $nimbleVersion ($selectedNimble)"
$dependencyStamp = Join-Path $buildPath 'sws-nimble.txt'
$dependencyFingerprint = "$selectedNimble|$nimbleVersion"
$previousFingerprint = if (Test-Path -LiteralPath $dependencyStamp) { (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() } else { '' }
if ($previousFingerprint -ne $dependencyFingerprint) {
    # Dependency files from a previous library location can leave a stale sketch object.
    foreach ($cacheFile in @('sketch/ble_oled_pairing.ino.cpp.o', 'sketch/ble_oled_pairing.ino.cpp.d', 'sketch/objs.a')) {
        $cachePath = Join-Path $buildPath $cacheFile
        if (Test-Path -LiteralPath $cachePath) { Remove-Item -LiteralPath $cachePath -Force }
    }
}
$arguments += $sketchPath
Write-Host "Arduino CLI: $ArduinoCli"
Write-Host "Building ESP32-C3 firmware. Outputs: $outputPath"
& $ArduinoCli @arguments
if ($LASTEXITCODE -ne 0) { throw 'Firmware build failed. Check the board package and the three libraries listed in README.md.' }
Set-Content -LiteralPath $dependencyStamp -Value $dependencyFingerprint -Encoding UTF8
$binaryPath = Join-Path $outputPath 'ble_oled_pairing.ino.bin'
if (!(Test-Path -LiteralPath $binaryPath)) { throw "Expected firmware binary was not created: $binaryPath" }
$afterHashes = Get-SourceHashes
if (($sourceHashes | ConvertTo-Json -Compress) -ne ($afterHashes | ConvertTo-Json -Compress)) { throw 'Source files changed during compilation; rebuild before publishing the manifest.' }
$manifest = [ordered]@{
    firmwareVersion = ([regex]::Match((Get-Content -LiteralPath (Join-Path $sketchPath 'include/sws_core.h') -Raw),'FW_VERSION="([^"]+)"')).Groups[1].Value
    protocol = 'SWS-BLE 1.0'
    board = $board
    arduinoEsp32 = '3.3.10'
    nimbleArduino = $nimbleVersion
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
