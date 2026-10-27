param([Parameter(Mandatory=$true)][string]$SourcePath, [Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference = 'Stop'
$existing = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$app = $null
$presentation = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $app.AutomationSecurity = 3
  $presentation = $app.Presentations.Open($SourcePath, -1, 0, 0)
  $count = $presentation.Slides.Count
  if ($count -lt 1 -or $count -gt 100) { throw 'Нужно от 1 до 100 слайдов.' }
  $width = 1600
  $height = [int][Math]::Round($width * $presentation.PageSetup.SlideHeight / $presentation.PageSetup.SlideWidth)
  for ($i = 1; $i -le $count; $i++) {
    $presentation.Slides.Item($i).Export((Join-Path $OutputDir "slide-$i.png"), 'PNG', $width, $height)
  }
  Write-Output $count
} finally {
  if ($presentation) { $presentation.Close() }
  if ($app -and -not $existing) { $app.Quit() }
}
