$ErrorActionPreference = 'Stop'
$Projeto = 'E:\postovia14'
$Patch = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host 'Aplicando patch Financeiro Geral Nº Lanc/T...' -ForegroundColor Cyan
Copy-Item "$Patch\index.js" "$Projeto\index.js" -Force
Copy-Item "$Patch\frontend\src\pages\admin\FinanceiroGeralAdminPage.tsx" "$Projeto\frontend\src\pages\admin\FinanceiroGeralAdminPage.tsx" -Force
Copy-Item "$Patch\frontend\src\index.css" "$Projeto\frontend\src\index.css" -Force
Set-Location "$Projeto\frontend"
if (!(Test-Path '.\node_modules\vite\bin\vite.js')) { npm install }
npm run build
Set-Location $Projeto
Remove-Item '.\docs' -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item '.\frontend\dist' '.\docs' -Recurse -Force
Write-Host 'Patch aplicado e frontend recompilado. Reinicie o Node/PM2 e use Ctrl+F5.' -ForegroundColor Green
