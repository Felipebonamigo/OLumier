# Os custos do sistema — o que está medido e o que não está

*Levantado em 02/10/2026, a pedido do Juan: "verificar todos os custos que faltam
dos sistemas".*

> **O que este documento é.** Um inventário das superfícies que custam dinheiro,
> com o estado de cada uma: **medido** (o número está no código, com teste),
> **conhecido** (sabemos o preço, mas nada no sistema o confere) ou **não
> medido** (ninguém sabe o volume).
>
> **O que ele não é.** Não há aqui um número inventado. Onde o volume não foi
> medido, está escrito "não medido" e o que precisa ser feito para medir — e não
> uma estimativa que vira verdade por repetição.

---

## 1. Armazenamento — **medido**

O único custo que entra no preço, e o único com teste.

| Item | Onde está | Valor |
|---|---|---|
| Original (Backblaze B2) | `src/config/planos.ts` | R$ 0,0382/GB/mês |
| Derivada (Cloudflare R2) | idem, somado | total R$ 0,0459/GB/mês |
| Piso do TB adicional | `scripts/testar-planos.mjs` | R$ 59,63/TB cheio |

O teste prende duas coisas: que o R$/GB **cai** a cada degrau (inversão ali é
erro de digitação em dinheiro) e que o adicional de R$ 80,00/TB não desce abaixo
do custo. Ver `docs/arquitetura-armazenamento.md` para por que tudo pesado vive
no B2.

## 2. Saída de dados (egress) — **conhecido, não medido**

A entrega É download: o casal baixa o casamento inteiro, às vezes em dois
aparelhos.

- **R2**: egress gratuito. É o motivo de as derivadas (miniatura, prévia,
  pôster, capa) viverem lá — e de a galeria pública servir só derivada.
- **B2**: franquia de 3× o armazenado por mês; acima disso é pago. O raciocínio
  está em `docs/arquitetura-armazenamento.md`: "a franquia de 3× cobre a entrega
  nos casos reais".

**O que falta:** nada no sistema soma os bytes que saíram do B2 por mês. O que
existe é `acessos` com `acao in ('baixou','baixou_tudo')` e `medias.bytes` —
então o número é calculável, e não calculado. Uma conta mensal por estúdio
responderia "algum cliente passa de 3×?" e hoje a resposta é um palpite.

## 3. O servidor de ZIP — **conhecido**

VPS próprio (`ZIP_SERVIDOR_URL`, ver `docs/servidor-zip.md`). Custo fixo
mensal, independente de uso. É o que torna o "baixar tudo" possível sem passar
os bytes pelo app.

## 4. O VPS principal — **conhecido**

Hostinger KVM2: app, Postgres, Caddy e os temporizadores. Custo fixo. Ver
`docs/operacao.md`.

## 5. E-mail (Resend) — **conhecido, e o volume acabou de mudar**

`RESEND_API_KEY` + `EMAIL_REMETENTE`. Até 01/10/2026 o e-mail era só
transacional e raro: confirmação de endereço, recuperação de senha, avisos de
pagamento e de saída.

**A migração 059 mudou a ordem de grandeza.** Cada galeria com lembretes
ligados passa a gerar, por destinatário:

| e-mail | quando |
|---|---|
| entrega | no dia em que o fotógrafo manda |
| dia do evento | na data do evento, se ainda estiver à frente |
| feedback | 90 dias depois da entrega |
| relembrar | 182 dias depois do evento |
| um ano | 364 dias depois do evento |

São até **5 e-mails por destinatário por galeria**, e o campo aceita até
`MAX_DESTINATARIOS = 10`. Uma galeria no limite agenda 50 e-mails espalhados por
um ano.

**O que falta:** conferir a faixa gratuita do plano atual do Resend contra o
volume projetado. A conta é fácil e os dados existem:

```sql
select count(*) from emails_da_galeria where enviado_em is null;
select agendado_para, count(*) from emails_da_galeria
 where enviado_em is null group by 1 order by 1;
```

O script diário manda no máximo 200 por rodada (`pendentesParaEnviar`, limite
200) — então um acúmulo grande aparece como fila crescendo, e não como fatura
surpresa. Mas nada avisa ninguém hoje: é um `select`, não um alerta.

## 6. Asaas — **conhecido**

Taxa por cobrança, com split para os sócios. Fora do escopo deste repositório;
ver a `ligar-cobranca.md` e o painel do Asaas.

## 7. Reconhecimento facial — **sem custo externo**

Roda no servidor com modelos locais (`scripts/copiar-modelos-rosto.mjs`). Custa
CPU do VPS que já existe, e não API de terceiro. As constantes medidas estão no
código desde 03/09/2026.

## 8. Domínios e TLS — **conhecido**

`galeriaatomo.com.br` e `olumier.com.br` no Registro.br; certificados pelo Caddy
(Let's Encrypt, sem custo). Domínio próprio de estúdio não gera custo nosso —
o DNS é do cliente.

---

## O que eu faria primeiro

1. **A conta de egress do B2** (§2). É o único custo que pode crescer com o uso
   sem ninguém notar, e os dados para medir já estão no banco. Enquanto não for
   medido, "a franquia de 3× cobre" é uma hipótese de agosto.
2. **A faixa do Resend contra a fila** (§5). O recurso é de hoje; a hora de
   olhar é antes de a primeira safra de lembretes vencer, não depois.
3. O resto é custo fixo e já conhecido.
