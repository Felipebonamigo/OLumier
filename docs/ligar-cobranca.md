# Ligar a cobrança — passo a passo

> ✅ **Ligada de verdade em 29/09/2026** (pelo Felipe, no servidor). O que este
> documento afirmava desde 01/09 não era verdade: faltava `ASAAS_API_KEY` no
> `.env.production`, e a Conta dizia "A cobrança ainda não foi ligada nesta
> instalação". As carteiras e o webhook estavam como descritos abaixo.
>
> **Como foi ligada — e a armadilha do `$`:**
>
> 1. Antes, as contas que não pagam viraram `cortesia` (Felipe; Carol, Sirius e
>    Tedesco já eram). Sem isso, teste vencido trava no instante em que a
>    cobrança liga.
> 2. A chave é a MESMA do Atomatiza (decisão registrada), copiada de
>    `/opt/atomatiza-secrets.env` para `/opt/fotonio-shared/.env.production`,
>    com `ASAAS_AMBIENTE=producao`. Cópia do arquivo anterior:
>    `/opt/fotonio-shared/.env.production.antes-da-cobranca`.
> 3. **Todo `$` da chave vai escapado como `\$`.** A chave de produção do Asaas
>    começa com `$aact_…`, e o Next, ao ler o `.env.production`, trata
>    `$palavra` como variável e a troca por vazio — mesmo entre aspas simples.
>    Copiada crua, a chave chega ao app vazia ou quebrada, e a Conta continua
>    dizendo "não foi ligada". Foi o que aconteceu na primeira tentativa. No
>    Atomatiza não acontece porque lá os segredos entram pelo systemd.
>
>    ```
>    sed -i '/^ASAAS_API_KEY=/d; /^ASAAS_AMBIENTE=/d' /opt/fotonio-shared/.env.production
>    grep '^ASAAS_API_KEY=' /opt/atomatiza-secrets.env | sed 's/\$/\\$/g' >> /opt/fotonio-shared/.env.production
>    echo 'ASAAS_AMBIENTE=producao' >> /opt/fotonio-shared/.env.production
>    systemctl restart fotonio
>    ```
>
>    Efeito colateral conhecido: os scripts do servidor, que carregam o mesmo
>    arquivo com `node --env-file`, leem a chave COM a barra (`\$aact…`). Hoje
>    eles só conferem se a chave existe (`asaasConfigurado`), então funcionam.
>    Desde 30/09/2026 quem fala com a API tira a barra sozinho
>    (`chaveDoAsaas` em `src/lib/asaas.ts`) — foi o que travou a primeira
>    rodada de `scripts/conferir-pagamentos.mjs` no servidor.
>
> Com a cobrança ligada: teste vencido não envia mais (`situacaoDoTenant`), a
> galeria dele sai do ar 15 dias depois (`galeriasNoAr`), e a limpeza de testes
> abandonados passa a avisar e, aos 60 dias, apagar (`lib/testes-abandonados.ts`).
> Desligada, desde 29/09 nenhuma galeria sai do ar por teste vencido.

*A cobrança está **ligada em produção** desde 29/09/2026 (ver acima — o
"01/09" que estava aqui valia para as carteiras e o webhook, não para a chave),
com split para as três carteiras. Nenhum cliente pagante existe ainda, então
nada foi cobrado nem distribuído até agora. Este documento descreve como está e
por quê.*

> ⚠️ **Correção de 20/08/2026.** Este documento dizia "pronto e testado" e estava
> errado, de um jeito que só apareceria no pior momento: o `scripts/testar-cobranca.mjs`
> nunca chamou a API do Asaas — ele dispara eventos no nosso próprio webhook e
> confere a matemática do split. O caminho de SAÍDA (criar cliente e assinatura)
> tinha zero cobertura, e estava quebrado: ninguém coletava CPF/CNPJ, que o Asaas
> exige. Dava para cumprir o checklist inteiro abaixo e a cobrança continuar no
> chão. **Corrigido**: `db/migracoes/006-documento.sql`, `src/lib/documento.ts` e
> o campo na tela de Conta. Ainda assim, o passo do sandbox continua obrigatório —
> a criação de assinatura só terá sido provada de verdade quando rodar contra a
> API real.

## Estado de hoje (05/09/2026)

| Item | Situação |
|---|---|
| Webhook e matemática do split | ✅ testado (`scripts/testar-cobranca.mjs`) |
| Criar cliente/assinatura no Asaas | ✅ provado no sandbox (`scripts/ensaio-cartao-sandbox.mjs`, 05/09/2026) |
| Cartão salvo e captura automática | ✅ provado: cartão fica com token, e assinatura com o token nasce CONFIRMED sem abrir fatura |
| Webhook | ✅ URL, 9 eventos e **token** conferidos em 05/09/2026 |
| Assinaturas reais | ❌ **zero** — nada foi cobrado ainda |
| CPF/CNPJ do titular | ✅ coletado e validado ao ativar a assinatura |
| Trial vencido / inadimplência travam o envio | ✅ `src/lib/assinatura.ts` |
| Conta do Asaas | usar a **mesma do Atomatiza** (decisão do Felipe) |
| Carteiras dos sócios | ✅ os três têm conta e mandaram o `walletId` (31/08/2026) |
| Base do split | **lucro** — a reserva de custo sai antes, ver abaixo |
| Percentuais | 50/25/25 do lucro |
| Rateio do custo | **proporcional** desde 29/09/2026 — o custo sai na mesma proporção, e o lucro fecha em 50/25/25 (até então era `igual`, em terços) |
| Caixa da operação | **conta principal** (decisão do Felipe, 01/09/2026) — `ASAAS_CARTEIRA_OPERACAO` fica vazia |
| Ambiente | `producao` |
| Variáveis no servidor | ✅ as três `ASAAS_CARTEIRA_*` gravadas em 01/09/2026, split conferido no ar |

## Como o dinheiro é dividido

Decisão do Felipe em 29/09/2026, perguntado se o 50/25/25 era do lucro ou da
receita: **do lucro.** O custo de armazenamento (com a folga cambial) e a taxa
do Asaas ficam na conta principal; o que sobra é dividido **50% Felipe, 25%
Carol, 25% Sirius** — cada um banca o custo na mesma proporção da sua fatia.

Por plano, sem combo (o que cada um recebe por cobrança):

| Plano | Preço | Felipe | Carol | Sirius |
|---|---|---|---|---|
| 250 GB mensal | R$ 49,99 | R$ 16,54 | R$ 8,27 | R$ 8,27 |
| 500 GB mensal | R$ 79,99 | R$ 23,63 | R$ 11,81 | R$ 11,81 |
| 1 TB mensal | R$ 119,99 | R$ 28,13 | R$ 14,05 | R$ 14,05 |
| 250 GB anual | R$ 499,90 | R$ 152,75 | R$ 76,35 | R$ 76,35 |
| 500 GB anual | R$ 799,90 | R$ 208,76 | R$ 104,38 | R$ 104,38 |
| 1 TB anual | R$ 1.199,90 | R$ 223,97 | R$ 111,93 | R$ 111,93 |

A reserva de custo sai antes e fica parada na conta principal até a fatura da
Backblaze e da Cloudflare chegar. Ninguém adianta dinheiro e ninguém cobra
ninguém. Com o combo, o desconto da Galeria sai do lucro, e os três o absorvem
na mesma proporção (1 TB anual com o combo Estúdio: R$ 102,70 / R$ 51,30 /
R$ 51,30).

### Como era até 29/09/2026: o custo em terços

O acordo de 01/09 dizia "o custo todo dividido em 3 partes iguais, e o lucro
50/25/25" — o que, na conta, não fecha: com o custo em terços, cada um recebia
`fatia × líquido − custo ÷ 3`, e o lucro saía 68/16/16 no plano de 1 TB mensal.
Nas faixas de margem curta a parte da Carol e do Sirius ficava negativa, travava
em zero e o Felipe cobria a diferença (o anual de 1 TB com combo Estúdio, e os
anuais de 5 e 10 TB). Nenhuma assinatura existia quando mudou.

Em 31/08/2026 o Felipe chegou a pedir a divisão da receita cheia, com o custo
acertado por fora. Ficou um dia assim e voltou: da faixa de 2 TB para cima, no
pior caso (espaço 100% cheio), metade da receita é **menos** que a reserva do
plano — num ano de 10 TB o descoberto chegaria a **R$ 5.501,75**, adiantados por
quem opera. `scripts/testar-planos.mjs` continua medindo esse número quando a
base é `receita`.

Trocar qualquer uma das duas regras é uma palavra em `src/config/socios.ts`:
`BASE_DO_SPLIT` (lucro ou receita) e `RATEIO_DO_CUSTO` (proporcional ou igual).

### A reserva varia MUITO com o plano

Não é distorção, é o custo real de cada faixa — e foi o que matou a divisão da
receita a percentual fixo: nenhum número único é seguro em 10 TB e justo em
100 GB.

| faixa | reserva | % da receita líquida | Felipe | Carol | Sirius |
|---|---|---|---|---|---|
| 100 GB | R$ 5,96 | 12,7% | 43,7% | 21,8% | 21,8% |
| 500 GB | R$ 29,82 | 27,9% | 36,1% | 18,0% | 18,0% |
| 1 TB | R$ 59,63 | 43,5% | 28,2% | 14,1% | 14,1% |
| 2 TB | R$ 119,27 | 55,0% | 22,5% | 11,3% | 11,3% |
| 10 TB | R$ 596,34 | 74,8% | 12,6% | 6,3% | 6,3% |

Os percentuais são calculados por plano, na criação da assinatura. Cada sócio
recebe sempre a mesma fatia **do lucro**; o que muda de faixa para faixa é quanto
do preço é lucro.

### O caixa da operação (opcional)

Sem `ASAAS_CARTEIRA_OPERACAO`, a reserva fica na conta principal — o Asaas deixa
lá o que não foi distribuído. Funciona, e é o padrão.

Com a variável preenchida, a reserva vira uma **linha com nome** no split: sai da
cobrança na frente dos três, todo mês, para uma conta que não é de ninguém em
particular. A conta é a mesma; o que muda é que ela deixa de depender da palavra
de quem opera — dinheiro parado na conta de um sócio *parece* margem dele.

A reserva usa o pior caso, então ela **sobra** de propósito. O que sobrar no fim
do ano é lucro a distribuir, e isso precisa estar combinado por escrito.

### Por que tudo vai em percentual, e nunca em valor fixo

O Asaas valida o split contra o valor **líquido**, e a taxa depende do meio de
pagamento, que o cliente só escolhe depois (`billingType: "UNDEFINED"`). Valor
fixo seria chutar a taxa; chute baixo estoura o líquido, o Asaas bloqueia a
cobrança (`PAYMENT_SPLIT_DIVERGENCE_BLOCK`), dá 2 dias úteis e cancela os splits.
Em percentual quem aplica é o Asaas, sobre o líquido que ele mesmo calculou.
`scripts/testar-split.mjs` prende isso.

**Sócio sem carteira configurada é pulado**, e a fatia dele fica na conta
principal em vez de virar erro na cobrança — e em vez de ser redistribuída entre
os outros. É de propósito nas duas pontas: cobrança que quebra por configuração
incompleta é pior que dinheiro parado esperando dono, e quem ainda não se
cadastrou continua tendo direito ao que é dele.

## O que o split NÃO cobre

A reserva cobre só o **armazenamento** (Backblaze e Cloudflare) mais a taxa do
Asaas. O custo fixo — DAS-MEI, VPS e domínio, R$ 129,33/mês — **não entra**: ele
não pertence a cobrança nenhuma e não teria como ser rateado por cobrança sem
mudar de valor a cada cliente novo (ver `src/config/custos-fixos.ts`).

Se o acordo entre os sócios divide o custo fixo, ele precisa ser acertado **por
fora, uma vez por mês** — com o lucro em 50/25/25, na mesma proporção:
R$ 64,67 / R$ 32,33 / R$ 32,33. Nenhum
split de pagamento resolve isso, porque o Asaas divide cobrança por cobrança e
não conhece o total do mês.

## Passo 1 — Cada sócio cria conta no Asaas

Carol e Sirius precisam de conta própria (pessoa física ou CNPJ) para receber o
split. Depois de criadas, você pega o **walletId** de cada um no painel do Asaas.

## Passo 2 — Definir os percentuais de verdade

Editar `src/config/socios.ts`. Hoje está:

```ts
{ id: "felipe", percentual: 50 },
{ id: "carol",  percentual: 25 },
{ id: "sirius", percentual: 25 },
```

Precisam somar 100. O teste `scripts/testar-cobranca.mjs` reprova se não somarem.

## Passo 3 — Variáveis no servidor

Em `/opt/fotonio/.env.production`:

```
ASAAS_AMBIENTE=producao
ASAAS_API_KEY=<a chave da conta>
ASAAS_WEBHOOK_TOKEN=<um token que você inventa>
ASAAS_CARTEIRA_FELIPE=<walletId>
ASAAS_CARTEIRA_CAROL=<walletId>
ASAAS_CARTEIRA_SIRIUS=<walletId>
```

Gerar o token com:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

> **`ASAAS_WEBHOOK_TOKEN` é obrigatório.** Sem ele o webhook responde 503 e não
> processa nada. Antes ele era opcional na prática — a checagem era
> `if (esperado && token !== esperado)`, então variável vazia significava porta
> aberta: qualquer POST da internet, sabendo só o uuid do estúdio, marcava a
> conta como ativa ou inadimplente. Hoje a porta fechada é o padrão.

Depois: `systemctl restart fotonio`.

⚠️ Comece com `ASAAS_AMBIENTE=sandbox` e faça uma assinatura de teste antes de
apontar para produção.

## Passo 4 — Webhook no painel do Asaas ✅ feito

Configurado e conferido em 05/09/2026:

- Nome: `galeriaatomo` · id `0d8a68bd-95ef-4a87-af3b-da4ae555ada5`
- URL: `https://galeriaatomo.com.br/api/asaas/webhook`
- Token: o mesmo do `ASAAS_WEBHOOK_TOKEN` do servidor
- 9 eventos · `SEQUENTIALLY` · fila ok · `penalizedRequestsCount: 0`

### O token faltava, e isso era um bloqueio silencioso

Até 05/09 o webhook existia, apontava certo e estava ativo — mas **sem token**. A
rota exige o header `asaas-access-token` e devolvia **401** a toda entrega.

O efeito não seria "webhook falhando": seria **o cliente pagar e continuar
bloqueado**. O cartão é capturado, o dinheiro entra, o Asaas avisa, e o sistema
recusa o aviso — sem ninguém perceber, porque nada na tela diz que um aviso foi
recusado.

E passava do nosso quintal: o Asaas repete entrega que falha e **suspende a fila
da conta** depois de falhas seguidas. A conta é compartilhada com o Atomatiza,
que tem cliente pagando. A primeira assinatura aqui poderia derrubar a cobrança
de lá.

Não tinha mordido só porque ninguém havia pagado ainda.

### Como conferir que o token dos dois lados é o mesmo

O Asaas **nunca devolve** o valor do token — só o booleano `hasAuthToken` no
recurso individual (`GET /v3/webhooks/{id}`; na LISTA nem o booleano aparece,
que foi o que me fez achar que a gravação tinha falhado). Então `hasAuthToken:
true` prova que existe um token, não que é o certo.

A prova de verdade é bater na rota, do próprio servidor:

```bash
T=$(grep -m1 "^ASAAS_WEBHOOK_TOKEN=" /opt/fotonio-shared/.env.production | cut -d= -f2-)
curl -s -o /dev/null -w "sem token:  %{http_code}
" -X POST   -H "Content-Type: application/json"   -d "{\"event\":\"PAYMENT_CONFIRMED\",\"payment\":{\"externalReference\":\"nao-existe:0000\"}}"   https://galeriaatomo.com.br/api/asaas/webhook
curl -s -w "com token:  %{http_code}
" -X POST   -H "Content-Type: application/json" -H "asaas-access-token: $T"   -d "{\"event\":\"PAYMENT_CONFIRMED\",\"payment\":{\"externalReference\":\"nao-existe:0000\"}}"   https://galeriaatomo.com.br/api/asaas/webhook
```

Medido em 05/09/2026: **401** sem token, **200** com token, e o corpo
`{"ok":true,"ignorado":"outro produto"}` — que de quebra prova a proteção do
Atomatiza funcionando, já que a referência não tem o prefixo nosso.

## ⚠️ O cuidado que não pode ser esquecido

A conta do Asaas é **compartilhada com o Atomatiza**, que está em produção com
clientes reais pagando. Duas proteções já estão no código:

1. Toda cobrança daqui leva `externalReference` com prefixo `olumier:`, e o
   webhook **ignora** o que não tiver esse prefixo. O prefixo é o da segunda
   marca, não o da atual: mudá-lo hoje deixaria órfã toda assinatura já criada,
   porque o valor fica gravado na assinatura lá no Asaas. Ver `PREFIXO` em
   `src/lib/asaas.ts`.
2. O webhook responde **200 mesmo ao ignorar**. Erro faria o Asaas reenviar em
   looping e, após muitas falhas, **suspender a fila da conta inteira** — o que
   derrubaria a cobrança do Atomatiza junto.

Ao configurar o webhook do Olumier, **não altere nem remova** o do Atomatiza.

## O combo com o Atomatiza (28/09/2026; divisão proporcional desde 29/09)

Quem assina a Galeria Átomo **e** o Atomatiza com o mesmo CPF/CNPJ paga menos
pelos dois. Cada plataforma baixa a **sua** assinatura na **sua** parte do
desconto, e divide com os sócios pela própria regra — aqui o split já sai do
preço que a assinatura cobra, então nada muda nele. Quem já tem um e assina o
outro paga o mesmo combo.

**Como o desconto se divide (29/09/2026).** Não é mais meio a meio em reais.
Felipe: "a receita é dividida [pela] porcentagem respectiva do pacote de cada
sistema, porque um pode ser bem mais caro que o outro, por exemplo se a
galeria for de 5 TB e o atomatiza o pacote solo". Meio a meio, o Solo cedia
25% do preço e os 5 TB só 3%. Agora cada lado cede a **mesma porcentagem do seu
preço de tabela**, e a receita do combo fica na proporção dos dois pacotes. O
total do pacote é o aprovado:

| Pacote (desconto do pacote) | Galeria | Atomatiza | Total | Cada um cede |
|---|---|---|---|---|
| 250 GB + Solo (R$ 19,99) | R$ 40,90 | R$ 49,00 | **R$ 89,90** | 18,2% |
| 500 GB + Equipe (R$ 29,99) | R$ 65,87 | R$ 74,03 | **R$ 139,90** | 17,7% |
| 1 TB + Estúdio (R$ 49,99) | R$ 101,24 | R$ 168,66 | **R$ 269,90** | 15,6% |
| 5 TB + Solo (R$ 29,99) | R$ 413,59 | R$ 56,31 | **R$ 469,90** | 6,0% |

O desconto do pacote por par está em `DESCONTO_DO_PACOTE` (`src/config/combo.ts`);
acima de 1 TB vale a linha de 1 TB. A régua da proporção são os preços de
**tabela** dos dois (`PRECO_DE_TABELA_ATOMATIZA` aqui, a cópia de `ESPACOS` lá),
e não os preços vivos, para as duas plataformas chegarem à mesma conta sem se
consultar. No anual, o desconto é de dez mensalidades, como o próprio preço.
Planos antigos (ids nomeados e de três peças) não entram: o preço deles é de
outra época. Quem assinou no dia da divisão meio a meio é trazido à
proporcional pela própria conferência.

**Como um enxerga o outro.** A conta do Asaas é a mesma, então não há chamada
de um sistema para o outro nem segredo novo: cada lado procura, pelo CPF/CNPJ,
a assinatura do outro (`externalReference` com `atz:sub:` lá, `olumier:`
aqui) e lê o plano na **descrição** dela — "Atomatiza — plano equipe" lá,
"Galeria Átomo — Foto · 500 GB" aqui. As descrições e a tabela são **contrato
entre os dois repositórios**: mudou aqui, mude lá (`src/config/combo.ts` aqui,
`src/lib/combo.ts` lá).

**Quando vale.** A assinatura do outro lado tem de estar viva, **já paga ao
menos uma vez** e **sem cobrança vencida**. O combo começa quando as duas estão
pagas e dura enquanto as duas estão em dia.

**Quando é conferido** (`recalcularCombo`, em `src/lib/combo.ts`):

- ao criar a assinatura e ao trocar de plano, aqui;
- a cada evento do Atomatiza que chega no nosso webhook (a conta é a mesma, e
  ele já chegava — era só ignorado); a conferência roda **depois** da resposta,
  com `after()`, para não segurar a fila sequencial da conta;
- a cada pagamento nosso — a rede de segurança para um aviso perdido.

**O que a conferência não faz:** mexer em valor que não é um dos que este
sistema grava (mudado à mão no Asaas — ela avisa no log e deixa); mexer na
fatura já emitida quando o preço **sobe** (quem cancelou o Atomatiza volta ao
cheio no ciclo seguinte; quando o preço baixa, a fatura aberta baixa junto); e
devolver erro ao Asaas por causa do combo.

A coluna `tenants.combo_atomatiza` (migração 045) guarda só o que a última
conferência achou, para a tela de Conta. A verdade é o Asaas. Cada troca de
valor fica no registro de eventos como `assinatura.combo`.

```bash
node --env-file=.env.local --conditions=react-server --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-combo.mjs
```

## Trocar de plano no meio do período (28/09/2026)

Felipe: "se o usuário quiser aumentar o pacote da galeria, não cobre
novamente, apenas a diferença". Até aqui a troca só mudava o valor da
assinatura: o período já pago seguia sem cobrança nenhuma, e no anual isso era
até um ano de espaço maior pelo preço do menor.

| Troca | O que acontece |
|---|---|
| Subiu, com período pago | Espaço novo na hora. Cobra **só a diferença**, proporcional ao que falta do período. Da próxima fatura em diante, o preço novo. |
| Subiu, sem nada pago (teste, fatura em aberto) | Nenhuma cobrança à parte: a fatura que vai vencer já sai com o preço novo. |
| Diferença abaixo de R$ 5,00 | Não é cobrada (é o mínimo do Asaas). Fica registrada como absorvida. |
| Desceu | Nada volta; o preço menor vale da próxima fatura. |
| Desceu e subiu de novo no mesmo período | Não cobra outra vez: a base é o maior plano já pago no período (`tenants.plano_do_periodo`, migração 046). |

Exemplo: 250 GB → 500 GB com 20 de 30 dias pela frente = (R$ 79,99 − R$ 49,99)
× 20/30 = **R$ 20,00**. No anual, a fração é do ano.

**No pacote dos dois.** Com o combo, os dois preços entram com o combo — a
diferença é a dos planos, com o desconto de cada um. Trocar de plano muda o par,
e com ele a parte do desconto do OUTRO lado; o outro sistema se ajusta sozinho
quando o aviso da cobrança da diferença chega no webhook dele (a conta é a
mesma). O Atomatiza tem a mesma regra na troca de faixa (Solo, Equipe,
Estúdio), e o aviso da diferença de lá (`atz:dif:`) ajusta o combo aqui. Sem
cobrança de diferença (teste, abaixo de R$ 5, descida), o outro lado se acerta
no próximo pagamento — ou na hora, se o webhook dos dois tiver o evento
`SUBSCRIPTION_UPDATED` ligado no painel do Asaas.

**Onde a diferença é cobrada.** No cartão que a assinatura já guardou
(`creditCardToken`, com o IP de quem clicou, como o Asaas exige). Sem cartão,
ou se ele recusar, vira fatura com Pix, boleto e cartão, vencendo em 3 dias, e
aparece na Conta até ser paga. Se nem a fatura puder ser criada, a assinatura
volta ao valor antigo e nada muda. A tela mostra o valor antes do clique, e o
servidor recusa se ele tiver mudado desde então.

**O split da diferença** reserva só o custo do espaço A MAIS pelos meses que
faltam (`lucroDaDiferencaCentavos`, em `config/socios.ts`) e divide o resto
pela regra de sempre.

**No webhook**, a diferença tem referência própria
(`olumier:<estúdio>:diferenca:<quando>`) e **não renova o período pago** — se
renovasse, pagar R$ 20 de diferença daria um mês, ou um ano no anual, a partir
daquele dia. Vencida sem pagar, a conta fica em atraso como numa mensalidade;
paga, volta a ativa.

Regra em `src/config/troca-de-plano.ts`, fluxo em `src/lib/troca-de-plano.ts`,
prova em:

```bash
node --env-file=.env.local --conditions=react-server --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-troca-de-plano.mjs
```

## Como conferir depois de ligar

```bash
node --env-file=.env.local scripts/testar-cobranca.mjs
```

E na tela `/painel/conta` aparece um aviso enquanto a divisão entre sócios estiver
incompleta, dizendo quem está sem carteira.

## Onde o dinheiro cai

```
Cliente paga → Asaas desconta a taxa
             → split envia o LUCRO de cada sócio
             → o que SOBRA fica na conta = reserva de custo
                (é dela que sai a fatura de Cloudflare, Backblaze e VPS)
```

Reserva por plano em `reservaDoPlano` (`src/config/socios.ts`), calculada do
espaço contratado e com folga
proposital: a Cloudflare cobra em dólar e recebemos em real.

## Cancelar para a renovação, não o acesso

O estúdio que cancela **continua enviando até o fim do período que já pagou**.
Quem paga anual desembolsa doze meses de uma vez; cortar o envio no ato seria
ficar com dinheiro de serviço não entregue.

A conta mora na coluna `tenants.pago_ate` — "até quando o dinheiro que já
entrou cobre o serviço". Quem escreve nela:

| Evento | `status` | `pago_ate` |
|---|---|---|
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | `ativo` | dia da confirmação + 1 mês (ou + **12** se anual) |
| `PAYMENT_RECEIVED` de cobrança já contada | **intocado** | **intocado** |
| `PAYMENT_OVERDUE` | `inadimplente` | intocado |
| `PAYMENT_DELETED` / `SUBSCRIPTION_DELETED` | `cancelado` | **intocado** — o dinheiro ficou conosco |
| `PAYMENT_REFUNDED` / `PAYMENT_CHARGEBACK_REQUESTED` | `cancelado` | **null** — o dinheiro voltou |
| cancelamento pelo painel | `cancelado` | **intocado** |

Quatro detalhes que não são óbvios:

- **O anual compra 12 meses, não 10.** O desconto está no preço (paga 10, leva
  12). Se o período seguisse a fatura, todo estúdio anual ficaria dois meses
  descoberto por ano — e descobriria justamente ao cancelar.
- **O período conta do dia da confirmação, não soma e não conta do aviso.** O
  Asaas manda `PAYMENT_CONFIRMED` *e* `PAYMENT_RECEIVED` para a mesma cobrança;
  somar daria dois meses por um pagamento. E no **cartão** os dois chegam com
  **32 dias** de distância (confirmado na aprovação, recebido quando o dinheiro
  cai — boleto: dias; Pix: só o recebido). Até 29/09/2026 o período contava do
  momento do aviso, e o recebido tardio dava quase um mês a mais — e marcava
  `ativo` de novo quem tinha cancelado, com envio liberado para sempre e sem
  assinatura. Agora a conta sai de `payment.confirmedDate`, igual nos dois
  avisos (começo do dia em Brasília; sem data no corpo, o momento do aviso).
- **O recebido só vale se comprar tempo novo.** Se o fim que ele daria não passa
  do `pago_ate` atual, é repetição de cobrança já contada e o estúdio fica
  intocado — nem status. O confirmado sempre vale, mas nunca encolhe o período.
  Limite conhecido: pagar, cancelar e reassinar pagando no Pix **no mesmo dia**
  deixa o estúdio `cancelado` até a mensalidade seguinte (o Pix novo dá o mesmo
  fim e parece repetição). Se acontecer, a saída é guardar o `payment.id` já
  contado. Regra em `pagoAteDepoisDoAviso`.
- **Inadimplência não olha `pago_ate`.** É outra régua, e ainda não foi
  decidida: a cobrança em aberto é a do período seguinte.

Regra em `src/lib/assinatura.ts` (`fimDoPeriodoPago`, `pagoAteDepoisDoAviso`,
`efeitoDoEvento`), coluna
na migração `021-periodo-pago.sql`, prova em:

```bash
node --env-file=.env.local --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-periodo-pago.mjs
```

**O que ainda NÃO existe:** reembolso proporcional. Quem cancela recebe o
serviço até o fim do período, não o dinheiro de volta — que é o padrão de
mercado, mas é uma escolha, não um acidente.
