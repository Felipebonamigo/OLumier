# Backup

## Estado

| O que | Protegido? |
|---|---|
| **Banco** (`fotonio`: estúdios, galerias, mídias, seções, acessos) | ✅ dump diário, cópia fora do servidor, restauração ensaiada |
| **Originais** (Backblaze B2, `olumier-arquivos`) | ❌ **cópia única** — o espelho foi removido em 27/08/2026, ver a seção abaixo |
| **Derivadas** (miniatura e preview, Cloudflare R2) | ➖ regeneráveis a partir do original |

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

## O espelho dos arquivos — REMOVIDO em 27/08/2026

Entre 25 e 27/08/2026 cada **original** era copiado para um segundo bucket no
Backblaze (`olumier-espelho`), por um temporizador às 04:10, com purga às 05:20.

O espelho foi **cancelado** junto com a obra da rota B2, em 26/08 — a grade de
preços foi recalculada sem ele (R$ 0,0459/GB, ver `config/planos.ts`). Só que
nada tinha sido desligado: por um dia os dois temporizadores continuaram
copiando e purgando para um espelho que a empresa já havia decidido não ter.

Saíram: `src/lib/espelho.ts`, os scripts `espelhar`/`purgar-espelho`, as
unidades `fotonio-espelho` e `fotonio-purga-espelho`, as variáveis `ESPELHO_*`
e as colunas `medias.espelhado_em` e `medias.espelho_frio_em` (migração
`024-sem-espelho.sql`). `scripts/testar-sem-espelho.mjs` prende a remoção.

**O que isso significa hoje:** os originais têm **uma cópia**, no
`olumier-arquivos`. Não há de onde restaurar um objeto perdido. A página
`/seguranca` diz isso ao cliente com essas palavras.

⚠️ **O bucket `olumier-espelho` continua existindo e NÃO pode ser apagado** —
é onde moram os backups cifrados do banco (`cofre-olumier:banco`). O nome ficou
do espelho; o inquilino de hoje é outro.

## O bucket é próprio desde 25/08/2026

Até então o backup do banco morava numa pasta (`fotonio/`) **dentro do bucket do
Padelizou**, usando a chave de lá — se aquela chave fosse trocada, o backup do
Olumier parava junto, e sem avisar até a próxima falha.

Agora o backup do banco vive no `olumier-espelho`, com chave própria restrita a
esse bucket. O nome do bucket vem do espelho de arquivos que dividia o espaço com
ele até 27/08/2026; hoje o backup é o único inquilino:

| Remote | O quê | Caminho |
|---|---|---|
| `olumier-b2` | conta B2, chave do Olumier | — |
| `cofre-olumier` | crypt sobre o bucket | `cofre-olumier:banco` |

A senha do crypt é **a mesma** de antes, copiada verbatim da configuração: senha
diferente deixaria os backups antigos ilegíveis. Os seis que existiam foram
copiados para o bucket novo e conferidos com `rclone check` (0 diferenças).

O remote antigo `cofre-b2:` continua existindo e apontando para o bucket do
Padelizou — é o backup **daquele** projeto, e não deve ser mexido.

### Object Lock

O bucket nasceu com `isFileLockEnabled: true`, mas **sem retenção padrão** — a
trava existia e não estava sendo aplicada. Corrigido no mesmo dia via API:
`governance`, 30 dias. Arquivo que sobe agora não pode ser apagado antes disso.

⚠️ **A chave do app tem a capacidade `bypassGovernance`**, que a Backblaze
concede por padrão às chaves criadas pela interface. Na prática, uma chave
roubada ainda conseguiria apagar arquivo travado. Fechar isso exige criar a
chave pela API (`b2_create_key`) com a lista de capacidades explícita, sem essa.
Fica anotado: a trava cobre engano e software, mas não cobre chave vazada
enquanto a capacidade estiver lá.
