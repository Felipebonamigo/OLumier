# Ligar a cobrança — passo a passo

*A cobrança está **adormecida**: sem `ASAAS_API_KEY` no ambiente, nada é cobrado
e o uso segue liberado. Este documento é o roteiro para quando você quiser ligar.*

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

## Estado de hoje (20/08/2026)

| Item | Situação |
|---|---|
| Webhook e matemática do split | ✅ testado (`scripts/testar-cobranca.mjs`) |
| Criar cliente/assinatura no Asaas | ⚠️ código pronto, **nunca rodou contra a API** |
| CPF/CNPJ do titular | ✅ coletado e validado ao ativar a assinatura |
| Trial vencido / inadimplência travam o envio | ✅ `src/lib/assinatura.ts` |
| Conta do Asaas | usar a **mesma do Atomatiza** (decisão do Felipe) |
| Carteiras dos sócios | ✅ os três têm conta e mandaram o `walletId` (31/08/2026) |
| Base do split | **receita**, decisão do Felipe em 31/08/2026 — ver abaixo |
| Percentuais | 50/25/25 |
| Ambiente | `producao` |
| Variáveis no servidor | ❌ as três `ASAAS_CARTEIRA_*` ainda não foram gravadas |

## O que se divide: receita, não lucro

Até 31/08/2026 o split mandava embora só o **lucro**, e a reserva de custo ficava
na conta principal — que é de onde saem as faturas da Backblaze e da Cloudflare.
O Felipe mudou: divide-se a **receita**, e os sócios acertam o custo entre si por
fora do sistema.

A conta final das duas formas é a mesma, desde que o custo seja rateado nos
mesmos percentuais. **O que muda é quem adianta o dinheiro:** a conta principal
fica zerada e a fatura dos fornecedores cai inteira no cartão de quem opera, que
depois cobra a parte de cada um. Da faixa de 2 TB para cima, 50% da receita é
**menos** que a reserva do plano no pior caso (espaço 100% cheio) — no anual de
10 TB o descoberto de um ano chega a R$ 5.501,75. `scripts/testar-planos.mjs`
mede e imprime esse número a cada execução, de propósito.

Trocar de volta é uma linha: `BASE_DO_SPLIT` em `src/config/socios.ts`.

**Por que a base `receita` vai em percentual e não em valor fixo:** o Asaas valida
o split contra o valor **líquido**, e a taxa depende do meio de pagamento, que o
cliente só escolhe depois. Valor fixo sobre a receita inteira seria chutar a taxa;
chute baixo estoura o líquido, o Asaas bloqueia a cobrança
(`PAYMENT_SPLIT_DIVERGENCE_BLOCK`), dá 2 dias úteis e cancela os splits. Em
percentual quem aplica é o Asaas, sobre o líquido que ele mesmo calculou.
`scripts/testar-split.mjs` prende isso.

**Comportamento enquanto está assim:** o split fica vazio e **100% do valor
permanece na conta principal**. Nenhuma cobrança falha por causa disso — foi
escrito assim de propósito, porque cobrança que quebra por configuração
incompleta é muito pior que dinheiro parado esperando distribuição.

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

## Passo 4 — Webhook no painel do Asaas

Adicionar uma URL **nova** (sem mexer na que o Atomatiza já usa):

- URL: `https://olumier.com.br/api/asaas/webhook`
- Token: o mesmo do `ASAAS_WEBHOOK_TOKEN`
- Eventos: pagamento confirmado/recebido, vencido, estornado, assinatura removida

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
