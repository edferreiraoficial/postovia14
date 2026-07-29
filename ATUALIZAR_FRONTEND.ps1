$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
npm --prefix frontend install --registry=https://registry.npmjs.org
npm run build
Write-Host 'Frontend atualizado com sucesso.' -ForegroundColor Green
