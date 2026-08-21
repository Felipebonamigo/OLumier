# Operação

O que roda sozinho no servidor, o que fazer quando algo quebra, e as ferramentas
manuais.

## O que roda sozinho

| Quando | O quê | Log |
|---|---|---|
| a cada 5 min | `fotonio-vigia` — checa saúde, reinicia ou avisa | `/var/log/fotonio-vigia.log` |
| 03:40 | `fotonio-backup` — dump do banco + cópia no B2 | `journalctl -u fotonio-backup` |
| 04:33 | `fotonio-cofre` — arquiva vencidas e solta quota presa | `/var/log/fotonio-cofre.log` |

## Saúde

`GET /api/healthz` responde 200 só quando o app **realmente consegue trabalhar**:
testa o banco com um select e o R2 com um HEAD. Uma rota que dissesse "ok" só
por o processo estar de pé enganaria — o Next continua respondendo com o banco
fora do ar, e a gente descobriria pelo cliente.

```json
{"ok":true,"banco":true,"armazenamento":true}
```

O detalhe do erro fica no log, não na resposta: a rota é pública e mensagem de
falha de banco costuma carregar host e usuário.

### O vigia é mais esperto que "reiniciar sempre"

O vigia do Padelizou reinicia o serviço a cada healthz ruim. Aqui isso estaria
errado na metade dos casos:

- **não respondeu nada** → processo travado, **reinicia** e confere
- **503 com `banco:false`** → o app está de pé, a dependência caiu. Reiniciar não
  conserta Postgres fora do ar; só derruba o processo que ainda servia páginas.
  **Avisa** por e-mail.

Aviso repetido é silenciado por 1h — um problema de madrugada viraria 100 e-mails
e a pessoa acordaria com a caixa entupida em vez de informada.

## Como o deploy funciona

```bash
bash deploy.sh
```

Cada publicação vira uma **release** em `/opt/fotonio-releases/<data>-<sha>`,
construída ao lado enquanto a versão atual continua servindo. Só no fim o link
`/opt/fotonio` passa a apontar para a nova, com uma troca atômica (`ln` ao lado
+ `mv -T`) — um `rm && ln` deixaria uma fresta em que `/opt/fotonio` não existe.

Antes o deploy extraía por cima da pasta viva e rodava `npm ci` ali mesmo: por
um minuto o processo servia uma árvore **sem `node_modules`** e com o `.next`
sendo reescrito por baixo. Quem estivesse usando tomava erro a cada publicação.

O deploy **recusa** quando há migração pendente, quando o build falha, ou quando
o app sobe sem falar com banco e R2.

| Caminho | O que é |
|---|---|
| `/opt/fotonio` | link para a release no ar |
| `/opt/fotonio-releases/` | as 3 últimas releases (as antigas são podadas) |
| `/opt/fotonio-shared/.env.production` | o que persiste entre releases |
| `/opt/fotonio-antes-das-releases/` | a pasta antiga, guardada como rede de segurança |

### Voltar para a release anterior

```bash
ssh root@179.197.233.184 "ls -1t /opt/fotonio-releases/"
ssh root@179.197.233.184 "ln -sfn /opt/fotonio-releases/<a-anterior> /opt/fotonio.novo && mv -Tf /opt/fotonio.novo /opt/fotonio && systemctl restart fotonio"
```

> A pasta `/opt/fotonio-antes-das-releases` (662 MB) é de antes desta mudança e
> pode ser apagada quando você quiser — deixei porque apagar 662 MB de produção
> não é decisão minha.

## Ferramentas manuais

### Alguém perdeu a senha

```bash
node --env-file=.env.production --experimental-strip-types \
     --import ./scripts/registrar-ts.mjs scripts/redefinir-senha.mjs email@do.estudio
```

Sorteia uma senha nova e mostra **uma vez**. Não existe "esqueci minha senha" no
app ainda — ver "O que falta" abaixo.

### Depois de mudar um plano em `planos.ts`

```bash
node --env-file=.env.production --experimental-strip-types \
     --import ./scripts/registrar-ts.mjs scripts/sincronizar-quotas.mjs           # previsão
node ... scripts/sincronizar-quotas.mjs --aplicar                                  # aplica
```

As quotas moram no banco em bytes, mas a fonte da verdade é `src/config/planos.ts`.
Conta já criada não muda sozinha quando o plano cresce — este script alinha.
Estúdio com `plano_id` que não existe mais é **pulado**, nunca reduzido: inventar
quota ali poderia tirar espaço de alguém sem querer.

### O CORS do bucket

O navegador fala direto com o bucket, que é outro domínio. A política de origens
permitidas mora na Cloudflare (R2 → bucket → Configurações → Política de CORS) e
inclui **`https://*.fotonio.com.br`** — sem esse curinga, cada estúdio novo
nasceria com o "salvar no celular" quebrado e ninguém perceberia, porque o
download no computador continua funcionando.

Para conferir do jeito que o navegador vê, sem precisar de token de admin:

```bash
node --env-file=.env.local scripts/testar-cors.mjs
```

Já roda dentro do `npm test`. Para reaplicar a política é preciso um token
"Admin Read & Write" — a chave do app é de objeto e recebe `AccessDenied`. Veja
o cabeçalho de `scripts/configurar-cors.mjs`.

### Arquivo pago que ninguém referencia

```bash
node --env-file=.env.production --experimental-strip-types \
     --import ./scripts/registrar-ts.mjs scripts/varrer-orfaos.mjs
```

Compara bucket × banco. **Só relata**; para apagar de verdade, `--apagar`.
Objeto sem linha em `medias` é invisível — não aparece no painel, não conta na
quota — e continua sendo cobrado todo mês.

## Testes

```bash
npm test
```

Roda as 15 suítes. As que dependem do servidor de desenvolvimento são **puladas**
(não reprovadas) quando ele está fora, para não confundir "não rodou" com
"quebrou".

⚠️ Os testes **publicam galeria, removem senha e apagam mídia**. Por isso
`scripts/guarda-producao.mjs` recusa qualquer banco que não termine em `_dev` ou
`_teste`. Para forçar: `PERMITIR_PRODUCAO=1` — e pense duas vezes.

### O resolvedor de imports

`--import ./scripts/registrar-ts.mjs` ensina o Node a achar `./db` como `./db.ts`
e a traduzir o atalho `@/`. Sem isso, nenhum script conseguia importar nada de
`src/lib` — e o que é difícil de testar acaba não sendo testado.

## Uma decisão que ficou pendente de propósito

**A tabela `acessos` não tem política de retenção.** Ela cresce com as entregas,
e o motivo de eu não ter cortado é honesto: o painel mostra "N aberturas · M
downloads" contando essas linhas, e apagar as antigas faria o número **cair
sozinho** — o fotógrafo veria a prova de entrega dele encolher sem explicação.

O crescimento já foi muito reduzido: até 20/08/2026 cada clique numa foto
gravava uma linha `abriu`, então um convidado que passasse por 200 fotos somava
200 aberturas (e inflava o contador que o fotógrafo lê como prova). Agora só a
abertura da página conta; vídeo ainda registra `assistiu`, que é raro e
deliberado.

Quando isso virar problema de verdade, o caminho é guardar um agregado por
galeria e só então poder descartar o detalhe — não o contrário.

## O que falta

- **"Esqueci minha senha" self-service** — depende de um remetente verificado no
  Resend para `fotonio.com.br`. A chave atual é restrita a envio e só tem
  remetente do Atomatiza; mandar "redefina sua senha do Fotônio" de um endereço
  `@atomatiza.com.br` pareceria golpe.
- **Bucket próprio no B2 para o backup** — hoje mora numa pasta dentro do bucket
  do Padelizou, porque a chave existente é dali. Se aquela chave for trocada, o
  backup do Fotônio para junto e só descobriríamos na próxima falha.
