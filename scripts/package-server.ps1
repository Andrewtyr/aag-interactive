param([string]$Destination)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $Destination) {
  $Destination = Join-Path (Split-Path $projectRoot -Parent) ('aag-server-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw "Файл уже существует: $Destination" }

Add-Type -AssemblyName System.IO.Compression
$files = @(
  'package.json', 'package-lock.json', '.dockerignore', 'README.md', 'SERVER-SETUP.md', 'START-HERE.txt', 'docs/PROJECT-STRUCTURE.md',
  'apps/api/package.json', 'apps/web/package.json', 'packages/contracts/package.json',
  'deploy/Dockerfile', 'deploy/compose.yaml', 'deploy/Caddyfile', 'deploy/.env.server.example', 'deploy/README.md', 'deploy/backup-server.sh'
)
foreach ($directory in @('apps/api/src', 'apps/api/config', 'apps/web', 'packages/contracts/src', 'scripts')) {
  $full = Join-Path $projectRoot $directory
  $files += Get-ChildItem -LiteralPath $full -File -Recurse |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]|[\\/]data[\\/]|[\\/]uploads[\\/]|[\\/]backups[\\/]|[\\/]\.env' } |
    ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/') }
}
$archive = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in ($files | Sort-Object -Unique)) {
    $source = Join-Path $projectRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Не найден файл пакета: $relative" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $relative.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }
Write-Output "Архив для сервера: $Destination"
