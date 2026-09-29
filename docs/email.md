# E-mail — o que falta ligar, e por quê

Este arquivo existe porque a mesma falta de DNS trava **três** coisas ao mesmo
tempo, e as três parecem problemas separados quando aparecem.

> **Atualização (29/09/2026) — o envio está LIGADO.** O domínio
> `galeriaatomo.com.br` está verificado no Resend, a chave `galeria-atomo-producao`
> está no servidor, e o "esqueci minha senha" chegou de
> `nao-responda@galeriaatomo.com.br` em 28/09. A tabela "O estado de hoje"
> abaixo é de 17/09 e ficou para trás. Com a cobrança ligada no mesmo dia
> (`docs/ligar-cobranca.md`), as duas travas descritas a seguir estão valendo.
>
> **Atualização (28/09/2026) — agora são cinco.** Duas das travas contra a
> conta de teste repetida (migração 045) só funcionam com o envio ligado, e
> ficam **dormindo** até lá — de propósito, para ninguém ser travado por uma
> porta que nós não abrimos:
>
> | Trava | Com o e-mail desligado (hoje) | Ligado |
> |---|---|---|
> | Confirmar o e-mail antes de enviar fotos | conta nova nasce confirmada | nasce pendente; o link sai no cadastro, e o painel mostra o recado com "mandar de novo" |
> | Apagar os arquivos do teste abandonado | **nada é avisado, nada é apagado** | aviso aos 30 dias do vencimento, aviso final aos 53, apaga aos 60 (`src/lib/testes-abandonados.ts`) |
>
> A limpeza também exige a cobrança ligada (`ASAAS_API_KEY`): sem ela ninguém
> tinha como assinar para salvar os arquivos. Ela roda dentro de
> `scripts/limpar-lixeira.mjs` (temporizador `fotonio-lixeira`, 04:50), que
> escreve no journal o que fez. Mais de 20 contas para apagar numa madrugada, e
> ela para sem apagar nenhuma e manda alerta para `ALERTA_EMAIL_DESTINO` —
> conferida a lista, rodar à mão com `--aplicar --liberar-teto`.
>
> O CPF/CNPJ único e o limite de 3 cadastros por IP por dia valem já, com ou
> sem e-mail.

## O estado de hoje (17/09/2026)

| O quê | Estado |
|---|---|
| **Receber** em `contato@galeriaatomo.com.br` | ❌ o domínio não tem MX — a mensagem não chega |
| **Enviar** pelo app (recuperar senha) | ❌ desligado: `galeriaatomo.com.br` não é verificado no Resend |
| **Avisos de operação** (vigia e backup) | ⚠️ funcionam, mas saindo de `contato@atomatiza.com.br`, que é de outro produto |

## O que cada um custa

**Receber.** Até 17/09/2026 o endereço aparecia em oito telas — privacidade,
termos, rodapé, recuperar senha — e nenhuma mensagem chegava a lugar nenhum.
`olumier.com.br` tem MX nulo (`0 .`, RFC 7505, "este domínio não aceita e-mail")
e `galeriaatomo.com.br` não tem MX nenhum. Hoje essas telas mostram WhatsApp e o
endereço saiu de vista, o que para o sangramento — mas não cria a caixa.

**Enviar.** O `src/lib/email.ts` fica desligado de propósito enquanto não houver
`RESEND_API_KEY` e `EMAIL_REMETENTE`, e o remetente **precisa** ser de domínio
verificado: mandar "redefina sua senha do Galeria Átomo" de outro domínio é
exatamente o que um golpe faria. Com ele desligado, a recuperação de senha é
manual — a pessoa chama no WhatsApp e alguém redefine na mão. Funciona com três
estúdios; com trinta, é você acordando de madrugada.

**Avisar.** Os avisos de queda e de backup saem de `contato@atomatiza.com.br`
porque é o único domínio verificado. Funciona, mas um aviso do Galeria Átomo
chegando de outro produto é o tipo de coisa que a pessoa marca como spam.

## O conserto — uma sentada no painel de DNS

Tudo abaixo é no registrador do `galeriaatomo.com.br`. Nada disso é código.

### 1. Receber

Escolha um dos dois. Encaminhamento é mais simples e resolve o caso de uso
(receber o que os clientes escrevem); caixa de verdade só se quiser responder
com esse endereço.

- **Encaminhamento** (a maioria dos registradores brasileiros oferece de graça):
  `contato@galeriaatomo.com.br` → sua caixa pessoal.
- **Caixa de verdade**: aponte os MX do provedor que escolher (Zoho, Google
  Workspace, Fastmail).

Conferir depois:

```bash
dig +short MX galeriaatomo.com.br     # tem de listar algo
```

E o teste que vale mesmo: mandar um e-mail do celular para
`contato@galeriaatomo.com.br` e ver se chega.

### 2. Enviar

No painel do Resend, **Domains → Add Domain → `galeriaatomo.com.br`**. Ele
devolve três registros para pôr no DNS:

| Tipo | Para quê |
|---|---|
| `TXT` (DKIM) | assina as mensagens |
| `MX` + `TXT` (SPF) em `send.` | subdomínio de envio |
| `TXT` (DMARC), opcional | política de quem pode mandar pelo domínio |

⚠️ O MX que o Resend pede fica em um **subdomínio** (`send.galeriaatomo.com.br`)
e **não conflita** com o MX do passo 1, que fica na raiz. Os dois convivem.

Verificado o domínio, em `/opt/fotonio/.env.production`:

```
RESEND_API_KEY=re_...
EMAIL_REMETENTE=contato@galeriaatomo.com.br
```

A chave precisa começar com `re_` — há uma guarda para isso, posta no dia em que
`RESEND_API_KEY=cole_aqui` foi para produção literalmente.

### 3. Provar que funciona

Prefixo certo não prova domínio verificado, nem permissão da chave, nem entrega.
Só um envio real prova, e existe um script para isso:

```bash
cd /opt/fotonio
node --env-file=.env.production --conditions=react-server \
  --experimental-strip-types --import ./scripts/registrar-ts.mjs \
  scripts/provar-email.mjs voce@exemplo.com
```

Ele **manda e-mail de verdade** — por isso não se chama `testar-*` e não entra na
bateria do `npm test`.

### 4. Arrumar as pontas soltas

Com o domínio verificado:

- `ALERTA_EMAIL_DESTINO` em `/opt/atomatiza-secrets.env` — confira para onde os
  avisos vão (ver `docs/operacao.md`). Não pode ser um endereço
  `@galeriaatomo.com.br` antes do passo 1.
- O remetente dos avisos, em `ops/fotonio-vigia.sh` e `ops/fotonio-backup.sh`,
  pode passar de `contato@atomatiza.com.br` para o domínio próprio.
- O `contato@galeriaatomo.com.br` pode voltar às telas, ao lado do WhatsApp. Ele
  continua em `src/config/marca.ts` esperando; o
  `scripts/testar-marca-plataforma.mjs` tem uma etapa que hoje **proíbe** o
  `mailto:` nessas telas, e ela sai junto.

## O que dá para conferir sem sair do repositório

```bash
npm test                      # entre elas, testar-vigia e testar-marca-plataforma
```

Nenhuma delas prova que o e-mail chega — isso é DNS, e teste nenhum aqui alcança.
Elas provam que o código está pronto para quando chegar, e que ninguém voltou a
anunciar um endereço que não recebe.
