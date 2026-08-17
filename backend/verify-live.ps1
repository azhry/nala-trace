$ErrorActionPreference = 'Stop'

$baseUrl = if ([string]::IsNullOrWhiteSpace($env:NALA_TRACE_URL)) { 'http://127.0.0.1:3003' } else { $env:NALA_TRACE_URL.TrimEnd('/') }
$apiKey = [string]$env:CODEX_TRACE_API_TOKEN
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'CODEX_TRACE_API_TOKEN is required; create a real Nala Labs API key and set it in this shell.'
}

function Invoke-CurlJson {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Url,
        [string]$Body,
        [switch]$WithAPIKey
    )

    $arguments = @('-sS', '-X', $Method, '-H', 'Accept: application/json')
    if ($WithAPIKey) {
        $arguments += @('-H', "X-Nala-Labs-API-Key: $apiKey")
    }
    if ($null -ne $Body) {
        $arguments += @('-H', 'Content-Type: application/json', '--data-raw', $Body)
    }
    $output = & curl.exe @arguments $Url
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed for $Method $Url"
    }
    return ($output -join "`n") | ConvertFrom-Json
}

$health = Invoke-CurlJson -Method 'GET' -Url "$baseUrl/healthz"
if ($health.status -ne 'ok') {
    throw "health status was '$($health.status)', expected 'ok'"
}
foreach ($dependency in @('casdoor', 'vault', 'postgresql', 'mongodb', 'redis', 'kafka')) {
    if ($health.dependencies.$dependency.status -ne 'ok') {
        throw "dependency '$dependency' was not healthy"
    }
}

$sessionId = "curl-live-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$event = @{ session_id = $sessionId; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
$ingest = Invoke-CurlJson -Method 'POST' -Url "$baseUrl/ingest" -Body $event -WithAPIKey
if ($ingest.accepted -ne $true) {
    throw 'ingest did not return accepted=true'
}

$sessions = Invoke-CurlJson -Method 'GET' -Url "$baseUrl/sessions?limit=10" -WithAPIKey
$session = @($sessions.sessions) | Where-Object { $_.session_id -eq $sessionId } | Select-Object -First 1
if ($null -eq $session) {
    throw "session '$sessionId' was not returned by the owner-scoped sessions endpoint"
}
if ([string]::IsNullOrWhiteSpace($session.user_id)) {
    throw "session '$sessionId' did not contain the resolved Nala Labs owner user_id"
}

[pscustomobject]@{
    health = 'ok'
    dependencies = 'casdoor,vault,postgresql,mongodb,redis,kafka'
    ingest = 'accepted'
    session_id = $session.session_id
    owner_user_id_present = $true
} | ConvertTo-Json -Compress
