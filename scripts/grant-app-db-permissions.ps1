param(
  [switch]$DryRun
)

$scriptPath = Join-Path $PSScriptRoot "grant-app-db-permissions.mjs"
$arguments = @($scriptPath)
if ($DryRun) { $arguments += "--dry-run" }
& node @arguments
exit $LASTEXITCODE
