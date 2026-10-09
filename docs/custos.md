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

## 9. Mês a mês — a memória dos números (09/10/2026)

Felipe, olhando a Administração: *"aqui vamos separar por mês as contas também,
para termos o controle dos custos, gastos, etc."* O bloco Dinheiro mostrava o
mês de HOJE; no dia 1º o número de ontem sumia, e "quanto custou setembro?" não
tinha resposta. O Caixa dos sócios separa o **dinheiro que caiu** por mês, lendo
o Asaas — mas o que o Asaas não sabe (quantas contas pagavam, quanto espaço
estava guardado, quanto era o custo fixo) só existia como retrato do dia.

Agora a Administração tem o bloco **Mês a mês**: uma linha por mês, doze meses,
do mais novo para o mais antigo.

| Coluna | De onde vem | Exatidão |
|---|---|---|
| Novas | `tenants.criado_em`, mês de Brasília | **exata** em todo mês |
| Total | contas criadas até o fim do mês | **exata** em todo mês |
| Pagando, Em teste, Inadimpl., Cancel. | o fechamento gravado | só onde há registro |
| Receita, Guardado, Fixo, Resultado | o fechamento gravado — as mesmas funções do bloco Dinheiro | só onde há registro |
| Caixa → | link para `/painel/admin/caixa?mes=AAAA-MM` | o recebido de verdade, do Asaas |

**O que "sem registro" quer dizer.** O banco guarda o status de HOJE, não o de
julho: não dá para saber quantas contas pagavam em julho. Reconstruir daria um
número que passaria por medido. Então os meses anteriores à primeira gravação
mostram "sem registro" (travessão), nunca zero e nunca estimativa — a nota da
tabela diz desde quando há. É a mesma regra deste documento: onde não se
mediu, está escrito que não se mediu.

**Como a memória é feita** (`fechamentos_mensais`, migração 068):

- O temporizador diário que já roda às 04:50 (`limpar-lixeira.mjs --aplicar`)
  regrava a linha do mês **corrente**. No último dia do mês ela fica com o
  retrato da madrugada dele; no dia 1º a escrita passa para a linha seguinte e a
  anterior nunca mais é tocada (`gravarFechamentoDoMes` só escreve no mês de
  hoje). Mora no script que já roda porque o deploy não instala unidade nova do
  systemd — um `.timer` novo ficaria no repositório sem nunca rodar.
- O mês em andamento mostra os números **de agora**; cada mês fechado, o último
  retrato gravado nele, com a data da gravação embaixo — para ninguém tomar por
  número de fim de mês o retrato de uma semana antes.
- A primeira linha só nasce na próxima madrugada depois da publicação. Para não
  esperar, no servidor:
  `node --env-file=/opt/fotonio/.env.production --experimental-strip-types --import /opt/fotonio/scripts/registrar-ts.mjs /opt/fotonio/scripts/limpar-lixeira.mjs --aplicar`
  (roda também a limpeza do dia, que é o que o temporizador faz de qualquer jeito).

**O que NÃO está aqui.** O recebido do Asaas por mês (é o Caixa, e é a fonte);
o custo da saída de dados (§2, não medido); e a mudança de preço de um plano
dentro do mês (a receita é a recorrente de cada retrato). O custo fixo vem da
lista do Caixa **no dia da gravação** — mudar a lista muda os meses seguintes,
nunca os fechados, e é isso que deixa ver o custo mudar ao longo do tempo.

Arquivos: `src/lib/fechamento-mensal-regras.ts` (regras puras),
`src/lib/fechamento-mensal.ts` (banco), `src/components/admin-mes-a-mes.tsx`
(a tabela), `scripts/testar-fechamento-mensal.mjs`.

---

## O que eu faria primeiro

1. **A conta de egress do B2** (§2). É o único custo que pode crescer com o uso
   sem ninguém notar, e os dados para medir já estão no banco. Enquanto não for
   medido, "a franquia de 3× cobre" é uma hipótese de agosto.
2. **A faixa do Resend contra a fila** (§5). O recurso é de hoje; a hora de
   olhar é antes de a primeira safra de lembretes vencer, não depois.
3. O resto é custo fixo e já conhecido.
