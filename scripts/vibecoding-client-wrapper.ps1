$clientJs = "C:\vibecoding-app\client\client.js"
$pidFile = "$env:TEMP\vibecoding-client-pid.txt"

$failCount = 0
$maxBackoff = 60

while ($true) {
    if (Test-Path $pidFile) {
        $oldPid = Get-Content $pidFile -Raw
        if ($oldPid -match '^\d+$') {
            taskkill /PID $oldPid /F 2>$null
            Start-Sleep -Seconds 2
        }
    }

    Write-Host "[vibecoding] Starting client..."
    $p = Start-Process -FilePath node -ArgumentList $clientJs -WindowStyle Hidden -PassThru
    $p.Id | Set-Content $pidFile
    Write-Host "[vibecoding] Client started (PID $($p.Id))"

    $p.WaitForExit()
    $code = $p.ExitCode

    if ($code -eq 0) {
        $failCount = 0
        Write-Host "[vibecoding] Client exited normally, restarting in 5s..."
        Start-Sleep -Seconds 5
    } else {
        $failCount++
        $delay = [Math]::Min(5 * $failCount, $maxBackoff)
        Write-Host "[vibecoding] Client crashed (code $code), restarting in ${delay}s (attempt $failCount)..."
        Start-Sleep -Seconds $delay
    }
}
