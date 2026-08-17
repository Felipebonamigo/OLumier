# Abre o túnel SSH para o Postgres do VPS.
#
# O Postgres do servidor escuta SÓ em localhost (de propósito — porta 5432 aberta
# na internet é varrida por bots o dia inteiro). Então, para desenvolver da sua
# máquina, o acesso passa por dentro do SSH: a porta 5433 daqui vira a 5432 de lá.
#
# Uso:  .\tunel.ps1        (deixe esta janela aberta enquanto programa)

$ErrorActionPreference = "Stop"

$emUso = Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
if ($emUso) {
    Write-Host "O tunel ja esta no ar (porta 5433 em uso)." -ForegroundColor Yellow
    exit 0
}

Write-Host "Abrindo tunel: localhost:5433 -> VPS:5432 ..." -ForegroundColor Cyan
Write-Host "Deixe esta janela aberta. Ctrl+C encerra." -ForegroundColor DarkGray
ssh -N -L 5433:127.0.0.1:5432 root@179.197.233.184
