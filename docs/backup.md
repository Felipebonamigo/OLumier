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

## O espelho dos arquivos

O banco tem backup desde sempre; os arquivos passaram a ter em 25/08/2026.

Antes, foto e vídeo viviam **só no R2**: uma cópia, um fornecedor, uma conta.
Disco não é o risco — a Cloudflare declara durabilidade de onze noves. O risco é
a **conta**: suspensão, cartão recusado, chave vazada com permissão de apagar,
engano humano. Qualquer um leva as entregas de todos os clientes de uma vez, e o
banco restaurado passa a apontar para arquivos que não existem mais.

O espelho copia cada **original** para o Backblaze B2, num bucket com credencial
própria. Miniatura e preview ficam de fora de propósito: são geradas no navegador
e a galeria cai para o original sozinha se sumirem.

| | Onde | Quando |
|---|---|---|
| Banco | dump cifrado no B2 | 03:40 |
| **Arquivos** | **espelho no B2** | **04:10** |
| Cofre (galerias vencidas) | move dentro do R2 | 04:33 |

```bash
# o que ainda está com uma cópia só (não copia nada)
node --env-file=.env.production --experimental-strip-types \
     --import ./scripts/registrar-ts.mjs scripts/espelhar.mjs

# copiar
node ... scripts/espelhar.mjs --aplicar --limite=2000
```

A passada é noturna, não no momento do upload: espelhar durante o envio faria o
fotógrafo esperar a cópia de um vídeo de 30 GB para ver "pronto", e uma queda do
B2 viraria falha de upload. O preço é a janela — arquivo enviado às 10h fica com
cópia única até a madrugada. É aceitável porque o risco coberto não escolhe hora,
e fechar a janela custaria upload travado todo dia.

### Ligar o espelho

Precisa de bucket e chave **próprios** — não reaproveitar a chave do Padelizou,
que é justamente o acoplamento que este trabalho remove.

1. Backblaze → **Buckets** → *Create a Bucket*: nome `olumier-espelho`, privado.
2. Anotar o **Endpoint** que aparece no bucket (`s3.us-east-005.backblazeb2.com`
   ou a região que sair) e a região embutida nele.
3. **Application Keys** → *Add a New Application Key*, restrita a esse bucket,
   com permissão de leitura e escrita.
4. Pôr no `/opt/fotonio-shared/.env.production` (e no `.env.local` para testar):

   ```
   ESPELHO_ENDPOINT=https://s3.us-east-005.backblazeb2.com
   ESPELHO_ACCESS_KEY_ID=...
   ESPELHO_SECRET_ACCESS_KEY=...
   ESPELHO_BUCKET=olumier-espelho
   ESPELHO_REGIAO=us-east-005
   ```

5. Instalar o temporizador:

   ```bash
   scp ops/fotonio-espelho.{service,timer} root@SERVIDOR:/etc/systemd/system/
   ssh root@SERVIDOR 'systemctl daemon-reload && systemctl enable --now fotonio-espelho.timer'
   ```

Sem essas variáveis o sistema roda igual, só sem segunda cópia — e o
`scripts/espelhar.mjs` recusa dizendo exatamente o que falta.

### Onde o objeto fica

A chave do espelho é **derivada** da chave de origem: `espelho/<chave original>`.
Nunca sorteada, e sem índice à parte — no dia de restaurar, o banco tem em mãos
só a chave original, e uma correspondência que dependa de outra tabela é uma
correspondência que pode se perder justamente no desastre.

### Apagar não apaga do espelho

Quando o fotógrafo apaga uma foto, o objeto sai do R2 e **fica** no espelho. É de
propósito: apagar dos dois lugares ao mesmo tempo transformaria um clique errado
em perda definitiva. A limpeza do que sobra é do `scripts/varrer-orfaos.mjs`,
rodado à mão e com conferência.

## O bucket é próprio desde 25/08/2026

Até então o backup do banco morava numa pasta (`fotonio/`) **dentro do bucket do
Padelizou**, usando a chave de lá — se aquela chave fosse trocada, o backup do
Olumier parava junto, e sem avisar até a próxima falha.

Agora banco e espelho vivem no `olumier-espelho`, com chave própria restrita a
esse bucket:

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
