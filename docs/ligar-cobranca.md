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
| Carteiras dos sócios | ❌ Carol e Sirius ainda não têm conta no Asaas |
| Percentuais do lucro | ⚠️ 50/25/25 é **proposta**, não acordo |
| Ambiente | `sandbox` (não move dinheiro) |

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

Depois: `systemctl restart fotonio`.

⚠️ Comece com `ASAAS_AMBIENTE=sandbox` e faça uma assinatura de teste antes de
apontar para produção.

## Passo 4 — Webhook no painel do Asaas

Adicionar uma URL **nova** (sem mexer na que o Atomatiza já usa):

- URL: `https://fotonio.com.br/api/asaas/webhook`
- Token: o mesmo do `ASAAS_WEBHOOK_TOKEN`
- Eventos: pagamento confirmado/recebido, vencido, estornado, assinatura removida

## ⚠️ O cuidado que não pode ser esquecido

A conta do Asaas é **compartilhada com o Atomatiza**, que está em produção com
clientes reais pagando. Duas proteções já estão no código:

1. Toda cobrança daqui leva `externalReference` com prefixo `fotonio:`, e o
   webhook **ignora** o que não tiver esse prefixo.
2. O webhook responde **200 mesmo ao ignorar**. Erro faria o Asaas reenviar em
   looping e, após muitas falhas, **suspender a fila da conta inteira** — o que
   derrubaria a cobrança do Atomatiza junto.

Ao configurar o webhook do Fotônio, **não altere nem remova** o do Atomatiza.

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

Reserva por plano em `RESERVA_POR_PLANO` (`src/config/socios.ts`), com folga
proposital: a Cloudflare cobra em dólar e recebemos em real.
