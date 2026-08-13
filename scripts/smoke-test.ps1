# ============================================================
#  MasterCards — smoke test de la API de Apps Script
#  Uso:  powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
#  Comprueba que el despliegue web responde con el formato
#  esperado por app.js, sin tocar datos reales.
# ============================================================

$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '..\app.js'
$src = Get-Content -LiteralPath $app -Raw

# Extrae la URL real desde app.js (fuente única de verdad)
$mUrl = [regex]::Match($src, "SCRIPT_URL:\s*'([^']+)'")
$mCid = [regex]::Match($src, "GOOGLE_CLIENT_ID:\s*'([^']+)'")
if (-not $mUrl.Success) { Write-Host 'No se pudo leer SCRIPT_URL de app.js' -ForegroundColor Red; exit 1 }
$URL = $mUrl.Groups[1].Value
$CID = if ($mCid.Success) { $mCid.Groups[1].Value } else { '' }

Write-Host "Endpoint : $URL"
Write-Host "ClientID : $CID"
Write-Host ''

$ok = $true
function Check([string]$name, [bool]$cond, [string]$detail) {
  if ($cond) { Write-Host ("  OK   " + $name) -ForegroundColor Green }
  else { $script:ok = $false; Write-Host ("  FAIL " + $name + "  ->  " + $detail) -ForegroundColor Red }
}

# 1) GET raíz sin parámetros -> error JSON estructurado (BAD_REQUEST)
Write-Host '1) GET raiz (sin parametros)'
try {
  $resp = Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 30
  $j = $resp.Content | ConvertFrom-Json
  Check 'HTTP 200' ($resp.StatusCode -eq 200) $resp.StatusCode
  Check 'JSON con ok:false' ($j.ok -eq $false) $resp.Content
  Check 'error=BAD_REQUEST' ($j.error -eq 'BAD_REQUEST') $resp.Content
  Check 'mensaje de error no vacio' (-not [string]::IsNullOrEmpty($j.message)) $resp.Content
} catch { Check 'GET raiz responde JSON' $false $_.Exception.Message }

# 2) GET pull con token inválido -> AUTH_FAILED
Write-Host '2) GET pull (email + token invalido)'
try {
  $u = $URL + '?email=smoke@example.com&token=smoke-invalido'
  $j = Invoke-RestMethod -Uri $u -TimeoutSec 30
  Check 'responde AUTH_FAILED' ($j.error -eq 'AUTH_FAILED') ($j | ConvertTo-Json -Compress)
} catch { Check 'GET pull AUTH_FAILED' $false $_.Exception.Message }

# 3) POST texto plano con token inválido -> AUTH_FAILED
#    Apps Script redirige (302) la primera petición y crea una cookie de sesión;
#    como el navegador, usamos la MISMA sesión (cookie) para el POST posterior.
Write-Host '3) POST (token invalido, texto plano)'
try {
  $sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod -Uri $URL -WebSession $sess -TimeoutSec 30 | Out-Null # warmup (302 + cookie)
  $body = '{"token":"smoke-invalido","syncOperations":[]}'
  $j = Invoke-RestMethod -Uri $URL -Method Post -Body $body `
    -ContentType 'text/plain;charset=utf-8' -WebSession $sess -TimeoutSec 30
  Check 'responde AUTH_FAILED' ($j.error -eq 'AUTH_FAILED') ($j | ConvertTo-Json -Compress)
} catch { Check 'POST AUTH_FAILED' $false $_.Exception.Message }

# 4) GET share_id con id inexistente -> error JSON estructurado
Write-Host '4) GET share (id inexistente)'
try {
  $j = Invoke-RestMethod -Uri ($URL + '?share_id=smoke-inexistente') -TimeoutSec 30
  Check 'responde ok:false' ($j.ok -eq $false) ($j | ConvertTo-Json -Compress)
  Check 'incluye mensaje de error' (-not [string]::IsNullOrEmpty($j.error)) ($j | ConvertTo-Json -Compress)
} catch { Check 'GET share JSON' $false $_.Exception.Message }

Write-Host ''
if ($ok) { Write-Host 'Smoke test OK' -ForegroundColor Green; exit 0 }
else     { Write-Host 'Smoke test con fallos' -ForegroundColor Red; exit 1 }
