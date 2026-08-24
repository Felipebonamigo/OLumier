# Backup

## Estado

| O que | Protegido? |
|---|---|
| **Banco** (`fotonio`: estúdios, galerias, mídias, seções, acessos) | ✅ dump diário, cópia fora do servidor, restauração ensaiada |
| **Fotos e vídeos** (Cloudflare R2) | ❌ **cópia única** — ver "O risco que continua aberto" |

## Como funciona

`ops/fotonio-backup.sh` → instalado em `/opt/fotonio-backup.sh`, disparado pelo
`fotonio-backup.timer` às **03:40** (depois do Atomatiza às 03:10, para os dois
não disputarem disco e rede).

1. `pg_dump` do banco inteiro, comprimido
2. **Confere o conteúdo** — tamanho mínimo, 5 tabelas, e os nomes `tenants`,
   `galerias` e `medias` presentes. Um dump que "deu certo" mas veio vazio é
   pior que backup nenhum: dá a sensação de estar protegido.
3. Cópia local em `/opt/fotonio-backups` (7 diários + 4 semanais)
4. **Cópia FORA do servidor**, criptografada, no Backblaze B2 (`cofre-b2:fotonio/banco`)
5. Confere que o arquivo chegou lá — código de saída do rclone não basta
6. Falhou? Sai com erro e manda e-mail (chave do Resend, reaproveitada do Atomatiza)

### Por que a cópia de fora é obrigatória aqui

Diferente do Atomatiza (banco no Supabase), o Postgres do Olumier roda **neste
mesmo VPS**. Dump guardado só aqui é o para-quedas dentro do avião: disco morreu,
morreram os dois juntos. Por isso a falha do B2 é **fatal** no script — sem a
cópia de fora não existe backup, existe a sensação de ter um.

### Por que `pg_dump` 14 e não 17

O servidor tem os dois binários, mas o cluster do Olumier é **14.23**. O `pg_dump`
17 dumparia bem, mas poderia gerar sintaxe que o 14 não restaura — e o dia da
restauração é o pior dia possível para descobrir isso.

## Restaurar

Ensaiado de verdade em 20/08/2026, **a partir do B2** (não da cópia local), com
um registro-isca: a isca voltou com acento intacto, junto com as 5 tabelas, o
trigger `trg_uso` e os 16 índices.

```bash
# 1. Baixar do cofre (descriptografa sozinho)
rclone copy cofre-b2:fotonio/banco /tmp/restaurar --include 'fotonio-*.sql.gz'

# 2. Restaurar num banco NOVO — nunca por cima do de produção
sudo -u postgres psql -tAc 'create database fotonio_restaurado;'
zcat /tmp/restaurar/fotonio-AAAA-MM-DD.sql.gz | sudo -u postgres psql -d fotonio_restaurado

# 3. Conferir antes de trocar qualquer coisa
sudo -u postgres psql -d fotonio_restaurado -c 'select count(*) from tenants;'
```

Só depois de conferir é que se decide promover o banco restaurado.

⚠️ **A chave da criptografia** está em `/root/padelizou-chave-backup.txt` e no
gerenciador de senhas do Felipe. **Sem ela o backup é inútil** — é a troca que a
criptografia impõe.

## O risco que continua aberto

**As fotos são cópia única.** Vivem no R2 e não há segunda cópia em lugar nenhum.
Se o bucket for perdido ou a conta Cloudflare suspensa, as entregas dos clientes
somem — e o banco restaurado vai apontar para arquivos que não existem mais.

Hoje isso é teórico (nenhuma foto real subiu ainda). Deixa de ser no minuto em
que o primeiro casamento entrar. A migração R2 → B2 do "cofre" resolveria os dois
problemas de uma vez (custo e segunda cópia), e continua na fila.

## Detalhe a arrumar quando der

O backup do Olumier mora numa pasta (`fotonio/`) **dentro do bucket do Padelizou**,
porque a chave do B2 existente é dali. Funciona e está separado, mas o certo é um
bucket próprio com chave própria — se a chave do Padelizou for trocada, o backup
do Olumier para junto, e sem avisar até a próxima falha.
