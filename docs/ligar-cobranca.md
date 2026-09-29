# Ligar a cobrança — passo a passo

*A cobrança está **ligada em produção** desde 01/09/2026, com split para as três
carteiras. Nenhum cliente pagante existe ainda, então nada foi cobrado nem
distribuído até agora. Este documento descreve como está e por quê.*

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
| Rateio do custo | **igual** — o custo todo dividido em 3 partes iguais (acordo de 01/09/2026) |
| Caixa da operação | **conta principal** (decisão do Felipe, 01/09/2026) — `ASAAS_CARTEIRA_OPERACAO` fica vazia |
| Ambiente | `producao` |
| Variáveis no servidor | ✅ as três `ASAAS_CARTEIRA_*` gravadas em 01/09/2026, split conferido no ar |

## Como o dinheiro é dividido

O acordo, nas palavras do Felipe em 01/09/2026: **o custo todo é dividido em 3
partes iguais, e o lucro é 50/25/25.**

Em conta, cada sócio recebe `fatia × líquido − custo ÷ 3`. Com R$ 1.000 de
receita e R$ 529 de custo:

| | recebe |
|---|---|
| Felipe | R$ 323,67 |
| Carol | R$ 73,67 |
| Sirius | R$ 73,67 |
| **soma** | **R$ 471,00** (o lucro inteiro) |

A reserva de custo sai antes e fica parada na conta principal até a fatura da
Backblaze e da Cloudflare chegar. Ninguém adianta dinheiro e ninguém cobra
ninguém.

### O que isso faz com a divisão do lucro

Com o custo em partes iguais, **o lucro deixa de sair 50/25/25**. No exemplo
acima o Felipe fica com 68,7% do lucro, e cada um dos outros com 15,6% — porque
ele banca um terço de um custo que a fatia dele geraria em metade. É consequência
aritmética do acordo, não defeito. Quem quiser 50/25/25 do lucro precisa do
rateio `proporcional`, que é uma palavra em `RATEIO_DO_CUSTO`.

### Onde o acordo encosta no limite

Quando o custo passa de **75% da receita**, um terço dele fica maior que a fatia
de quem tem 25% — ou seja, a Carol e o Sirius deveriam PAGAR. Split negativo não
existe, então a fatia deles trava em zero e o que sobra vai para o Felipe (nunca
para a reserva: essa é intocável).

Acontece em seis planos, todos anuais: 5 TB e 10 TB nos três segmentos. Num anual
de 10 TB (R$ 7.999,90) a Carol e o Sirius ficam com **zero** e o Felipe com
R$ 840,82. `scripts/testar-planos.mjs` lista esses planos a cada execução, para
a consequência não sumir de vista.

Em 31/08/2026 o Felipe pediu a divisão da receita cheia, com o custo acertado por
fora. Ficou um dia assim e voltou, por causa deste número: da faixa de 2 TB para
cima, no pior caso (espaço 100% cheio), metade da receita é **menos** que a
reserva do plano — e num ano de 10 TB o descoberto chega a **R$ 5.501,75**,
adiantados por quem opera. `scripts/testar-planos.mjs` continua medindo e
imprimindo esse número quando a base é `receita`, para a conta não sumir junto
com a decisão.

Trocar de volta é uma palavra: `BASE_DO_SPLIT` em `src/config/socios.ts`.

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
fora, uma vez por mês** — R$ 43,11 para cada um, com a lista de três. Nenhum
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

## O combo com o Atomatiza (28/09/2026)

Quem assina a Galeria Átomo **e** o Atomatiza com o mesmo CPF/CNPJ paga menos
pelos dois. Decisão do Felipe: o desconto é dividido **meio a meio** entre as
plataformas, cada uma baixa a **sua** assinatura na **sua** metade, e divide com
os sócios pela própria regra — aqui o split já sai do preço que a assinatura
cobra, então nada muda nele. Quem já tem um e assina o outro paga o mesmo combo.

| Galeria | + Solo | + Equipe | + Estúdio |
|---|---|---|---|
| 250 GB (R$ 49,99) | −R$ 9,99 → **R$ 40,00** | −R$ 9,99 → **R$ 40,00** | −R$ 19,99 → **R$ 30,00** |
| 500 GB (R$ 79,99) | −R$ 9,99 → **R$ 70,00** | −R$ 14,99 → **R$ 65,00** | −R$ 24,99 → **R$ 55,00** |
| 1 TB+ (R$ 119,99…) | −R$ 14,99 | −R$ 14,99 | −R$ 24,99 |

A outra metade (R$ 10, 15, 20 ou 25) sai do Atomatiza, que fecha em ,90. Acima
de 1 TB vale a linha de 1 TB. No anual, o desconto é de dez mensalidades, como o
próprio preço. Planos antigos (ids nomeados e de três peças) não entram: o
preço deles é de outra época.

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
× 20/30 = **R$ 20,00**. No anual, a fração é do ano. Com o combo, os dois
preços entram com o combo — a diferença é só a dos planos.

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
| `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` | `ativo` | agora + 1 mês (ou + **12** se anual) |
| `PAYMENT_OVERDUE` | `inadimplente` | intocado |
| `PAYMENT_DELETED` / `SUBSCRIPTION_DELETED` | `cancelado` | **intocado** — o dinheiro ficou conosco |
| `PAYMENT_REFUNDED` / `PAYMENT_CHARGEBACK_REQUESTED` | `cancelado` | **null** — o dinheiro voltou |
| cancelamento pelo painel | `cancelado` | **intocado** |

Três detalhes que não são óbvios:

- **O anual compra 12 meses, não 10.** O desconto está no preço (paga 10, leva
  12). Se o período seguisse a fatura, todo estúdio anual ficaria dois meses
  descoberto por ano — e descobriria justamente ao cancelar.
- **O período conta a partir de agora, não soma.** O Asaas manda
  `PAYMENT_CONFIRMED` *e* `PAYMENT_RECEIVED` para a mesma cobrança; somar daria
  dois meses por um pagamento.
- **Inadimplência não olha `pago_ate`.** É outra régua, e ainda não foi
  decidida: a cobrança em aberto é a do período seguinte.

Regra em `src/lib/assinatura.ts` (`fimDoPeriodoPago`, `efeitoDoEvento`), coluna
na migração `021-periodo-pago.sql`, prova em:

```bash
node --env-file=.env.local --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-periodo-pago.mjs
```

**O que ainda NÃO existe:** reembolso proporcional. Quem cancela recebe o
serviço até o fim do período, não o dinheiro de volta — que é o padrão de
mercado, mas é uma escolha, não um acidente.
