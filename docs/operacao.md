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

## Ferramentas manuais

### Alguém perdeu a senha

```bash
node --env-file=.env.production --experimental-strip-types \
     --import ./scripts/registrar-ts.mjs scripts/redefinir-senha.mjs email@do.estudio
```

Sorteia uma senha nova e mostra **uma vez**. Não existe "esqueci minha senha" no
app ainda — ver "O que falta" abaixo.

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

## O que falta

- **"Esqueci minha senha" self-service** — depende de um remetente verificado no
  Resend para `fotonio.com.br`. A chave atual é restrita a envio e só tem
  remetente do Atomatiza; mandar "redefina sua senha do Fotônio" de um endereço
  `@atomatiza.com.br` pareceria golpe.
- **Bucket próprio no B2 para o backup** — hoje mora numa pasta dentro do bucket
  do Padelizou, porque a chave existente é dali. Se aquela chave for trocada, o
  backup do Fotônio para junto e só descobriríamos na próxima falha.
