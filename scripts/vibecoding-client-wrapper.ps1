$clientJs = "C:\vibecoding-app\client\client.js"
$pidFile = "$env:TEMP\vibecoding-client-pid.txt"

while ($true) {
    if (Test-Path $pidFile) {
        $oldPid = Get-Content $pidFile -Raw
        if ($oldPid -match '^\d+$') {
            Get-Process -Id $oldPid -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq "node" } | Stop-Process -Force
        }
    }

    Write-Output "[vibecoding] Starting client..."
    $p = Start-Process -FilePath node -ArgumentList $clientJs -WindowStyle Hidden -PassThru
    $p.Id | Set-Content $pidFile
    Write-Output "[vibecoding] Client started (PID $($p.Id))"

    $p.WaitForExit()
    Write-Output "[vibecoding] Client exited (code $($p.ExitCode)), restarting in 5s..."
    Start-Sleep -Seconds 5
}
