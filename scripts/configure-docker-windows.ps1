[CmdletBinding()]
param(
    [string]$OpenClawHome = (Join-Path $env:USERPROFILE ".openclaw"),
    [string]$HermesApiUrl = "",
    [string]$RealtimeBrowserUrl = "ws://127.0.0.1:8591"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $RepoRoot ".env"
$ExamplePath = Join-Path $RepoRoot ".env.example"
$OpenClawHome = [IO.Path]::GetFullPath($OpenClawHome)
$OpenClawConfig = Join-Path $OpenClawHome "openclaw.json"

if (-not (Test-Path -LiteralPath $OpenClawHome -PathType Container)) {
    throw "OpenClaw home was not found: $OpenClawHome"
}
if (-not (Test-Path -LiteralPath $OpenClawConfig -PathType Leaf)) {
    throw "OpenClaw config was not found: $OpenClawConfig"
}
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $EnvPath
}

function Convert-ToComposePath([string]$Path) {
    return ([IO.Path]::GetFullPath($Path)).Replace('\', '/')
}

function Set-DotEnvValue([string]$Key, [string]$Value) {
    $lines = [Collections.Generic.List[string]]::new()
    $lines.AddRange([string[]](Get-Content -LiteralPath $EnvPath))
    $pattern = '^{0}=' -f [Regex]::Escape($Key)
    $replacement = "$Key=$Value"
    $found = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match $pattern) {
            $lines[$index] = $replacement
            $found = $true
        }
    }
    if (-not $found) {
        $lines.Add($replacement)
    }
    [IO.File]::WriteAllLines($EnvPath, $lines, [Text.UTF8Encoding]::new($false))
}

# Docker Desktop runs Linux containers. Disable host-native Linux CLI mounts by
# pointing them at typed placeholders; this prevents a missing Windows source
# from becoming a directory at an executable path inside the container.
$DisabledRoot = Join-Path $RepoRoot ".docker-disabled"
$DisabledDirectories = @(
    "hermes-home", "hermes-uv", "codex-home", "claude-home",
    "opencode-home", "opencode-data", "antigravity-home"
)
$DisabledFiles = @("hermes", "claude", "opencode", "agy")
New-Item -ItemType Directory -Path $DisabledRoot -Force | Out-Null
foreach ($name in $DisabledDirectories) {
    New-Item -ItemType Directory -Path (Join-Path $DisabledRoot $name) -Force | Out-Null
}
foreach ($name in $DisabledFiles) {
    New-Item -ItemType File -Path (Join-Path $DisabledRoot $name) -Force | Out-Null
}

Set-DotEnvValue "VW_OPENCLAW_HOST_PATH" (Convert-ToComposePath $OpenClawHome)
Set-DotEnvValue "VW_GATEWAY_URL" "ws://host.docker.internal:18789"
Set-DotEnvValue "VW_OPENCLAW_BROWSER_TRANSPORT" "proxy"
Set-DotEnvValue "VW_REALTIME_BROWSER_URL" $RealtimeBrowserUrl

Set-DotEnvValue "VW_HERMES_HOST_HOME" (Convert-ToComposePath (Join-Path $DisabledRoot "hermes-home"))
Set-DotEnvValue "VW_HERMES_HOST_BIN" (Convert-ToComposePath (Join-Path $DisabledRoot "hermes"))
Set-DotEnvValue "VW_HERMES_HOST_UV" (Convert-ToComposePath (Join-Path $DisabledRoot "hermes-uv"))
Set-DotEnvValue "VW_CODEX_HOST_HOME" (Convert-ToComposePath (Join-Path $DisabledRoot "codex-home"))
Set-DotEnvValue "VW_CLAUDE_CODE_HOST_HOME" (Convert-ToComposePath (Join-Path $DisabledRoot "claude-home"))
Set-DotEnvValue "VW_CLAUDE_CODE_HOST_BIN" (Convert-ToComposePath (Join-Path $DisabledRoot "claude"))
Set-DotEnvValue "VW_OPENCODE_HOST_HOME" (Convert-ToComposePath (Join-Path $DisabledRoot "opencode-home"))
Set-DotEnvValue "VW_OPENCODE_HOST_DATA" (Convert-ToComposePath (Join-Path $DisabledRoot "opencode-data"))
Set-DotEnvValue "VW_OPENCODE_HOST_BIN" (Convert-ToComposePath (Join-Path $DisabledRoot "opencode"))
Set-DotEnvValue "VW_ANTIGRAVITY_HOST_HOME" (Convert-ToComposePath (Join-Path $DisabledRoot "antigravity-home"))
Set-DotEnvValue "VW_ANTIGRAVITY_HOST_BIN" (Convert-ToComposePath (Join-Path $DisabledRoot "agy"))

Set-DotEnvValue "VW_CODEX_ENABLED" "false"
Set-DotEnvValue "VW_CLAUDE_CODE_ENABLED" "false"
Set-DotEnvValue "VW_OPENCODE_ENABLED" "false"
Set-DotEnvValue "VW_ANTIGRAVITY_ENABLED" "false"

if ($HermesApiUrl) {
    if ($HermesApiUrl -notmatch '^https?://') {
        throw "HermesApiUrl must start with http:// or https://"
    }
    Set-DotEnvValue "VW_HERMES_ENABLED" "true"
    Set-DotEnvValue "VW_HERMES_API_URL" $HermesApiUrl
    Set-DotEnvValue "VW_HERMES_PREFER_API" "true"
    Set-DotEnvValue "VW_HERMES_AUTO_START_PROFILE_APIS" "false"
    Set-DotEnvValue "VW_HERMES_AUTO_START_DEFAULT_API" "false"
} else {
    Set-DotEnvValue "VW_HERMES_ENABLED" "false"
}

Push-Location $RepoRoot
try {
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose config failed"
    }
} finally {
    Pop-Location
}

Write-Host "Windows Docker configuration is ready."
Write-Host "OpenClaw: $OpenClawHome -> /openclaw"
Write-Host "Chat transport: same-origin server proxy (Gateway port 18789 stays private)"
Write-Host "Start with: docker compose up --build -d"
