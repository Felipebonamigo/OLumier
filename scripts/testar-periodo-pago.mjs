#!/usr/bin/env node
/**
 * O período JÁ PAGO sobrevive ao cancelamento. Uso:
 *   node --env-file=.env.local --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-periodo-pago.mjs
 *
 * O furo que esta suíte fecha: até 26/08/2026 cancelar marcava `status =
 * 'cancelado'` na hora, e o portão de envio recusava no mesmo instante. No
 * mensal isso passava despercebido — o mês cobrado já tinha sido usado. No
 * anual não: o estúdio pagava doze meses de uma vez e, cancelando no segundo,
 * perdia dez meses que estavam pagos. Dinheiro recebido, serviço não entregue.
 *
 * A regra agora tem duas metades e as duas precisam de prova:
 *
 *   1. cancelar PARA A RENOVAÇÃO, não o acesso — o que foi pago fica de pé;
 *   2. estorno e chargeback ZERAM o período — ali o dinheiro voltou, e manter
 *      o acesso seria pagar o disco do bolso.
 *
 * A segunda metade é a que some de vista: é fácil escrever "cancelamento não
 * apaga o período" e deixar o estorno cair no mesmo caminho por descuido.
 *
 * E uma terceira, de 29/09/2026: no CARTÃO o Asaas avisa duas vezes, com um
 * mês entre os avisos — PAYMENT_CONFIRMED na aprovação, PAYMENT_RECEIVED 32
 * dias depois, quando o dinheiro cai. Contado a partir do aviso, o segundo
 * dava quase um mês a mais a quem cancelou; e, como também marcava `ativo`,
 * devolvia o envio para sempre a quem já não tinha assinatura nenhuma.
 */
import { readFileSync } from "node:fs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import {
  situacaoDoTenant,
  fimDoPeriodoPago,
  efeitoDoEvento,
  pagoAteDepoisDoAviso,
} from "../src/lib/assinatura.ts";

exigirBancoDeTeste();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, oque) => {
  if (a !== b) {
    throw new Error(`${oque}: esperava ${JSON.stringify(String(b))}, veio ${JSON.stringify(String(a))}`);
  }
};

const ONTEM = new Date(Date.now() - 24 * 3600 * 1000);
const AMANHA = new Date(Date.now() + 24 * 3600 * 1000);
const LIGADA = true;
const DESLIGADA = false;

console.log("\nQuanto tempo cada pagamento compra:\n");

await etapa("mensal compra um mês", () => {
  const pago = new Date("2026-03-10T12:00:00Z");
  const fim = fimDoPeriodoPago("mensal", pago);
  igual(fim.toISOString(), new Date("2026-04-10T12:00:00Z").toISOString(), "um mês");
});

await etapa("anual compra DOZE meses, não os dez que a fatura cobra", () => {
  // O desconto anual está no PREÇO (paga 10, leva 12). Se o período pago
  // seguisse a fatura, o estúdio anual ficaria dois meses sem cobertura todo
  // ano — e descobriria justamente ao cancelar.
  const pago = new Date("2026-03-10T12:00:00Z");
  const fim = fimDoPeriodoPago("anual", pago);
  igual(fim.toISOString(), new Date("2027-03-10T12:00:00Z").toISOString(), "doze meses");
});

await etapa("ciclo desconhecido compra um mês, nunca um ano", () => {
  // Errar para o lado curto aqui custa dias de acesso; errar para o longo
  // custa um ano de disco pago do bolso.
  igual(
    fimDoPeriodoPago("semestral", new Date("2026-03-10T12:00:00Z")).toISOString(),
    new Date("2026-04-10T12:00:00Z").toISOString(),
    "cai em mensal",
  );
});

console.log("\nO portão respeita o que já foi pago:\n");

await etapa("cancelado DENTRO do período pago continua enviando", () => {
  const s = situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: AMANHA }, LIGADA);
  igual(s.podeEnviar, true, "envio liberado");
});

await etapa("e a tela diz até quando, em vez de deixar a pessoa adivinhar", () => {
  const s = situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: AMANHA }, LIGADA);
  if (!s.aviso) throw new Error("cancelado com período vivo não avisa que tem prazo");
  if (!/\d{2}\/\d{2}\/\d{4}/.test(s.aviso)) {
    throw new Error(`o aviso não traz a data: ${s.aviso}`);
  }
  return s.aviso;
});

await etapa("cancelado com o período VENCIDO para de enviar", () => {
  const s = situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: ONTEM }, LIGADA);
  igual(s.podeEnviar, false, "envio travado");
  igual(s.motivo, "cancelado", "motivo");
});

await etapa("cancelado sem nada pago para de enviar na hora", () => {
  // Quem cancelou ainda no trial não comprou período nenhum.
  const s = situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: null }, LIGADA);
  igual(s.podeEnviar, false, "envio travado");
});

await etapa("período pago NÃO ressuscita quem está inadimplente", () => {
  // De propósito: inadimplência é outra régua, e ninguém decidiu essa ainda.
  // A cobrança em aberto é justamente a do período que viria A SEGUIR.
  const s = situacaoDoTenant({ status: "inadimplente", trial_ate: null, pago_ate: AMANHA }, LIGADA);
  igual(s.podeEnviar, false, "continua travado");
});

await etapa("com a cobrança desligada nada muda", () => {
  igual(
    situacaoDoTenant({ status: "cancelado", trial_ate: null, pago_ate: null }, DESLIGADA).podeEnviar,
    true,
    "desligada",
  );
});

console.log("\nCada evento do Asaas cai no balde certo:\n");

await etapa("pagamento confirmado e recebido compram período", () => {
  // O Asaas manda os DOIS para a mesma cobrança (menos no Pix, que só manda o
  // recebido). Quanto cada um compra é `pagoAteDepoisDoAviso` — ver abaixo.
  igual(efeitoDoEvento("PAYMENT_CONFIRMED"), "pagou", "confirmado");
  igual(efeitoDoEvento("PAYMENT_RECEIVED"), "pagou", "recebido");
});

await etapa("assinatura apagada CANCELA — e cancelar preserva o período", () => {
  igual(efeitoDoEvento("SUBSCRIPTION_DELETED"), "cancelou", "assinatura apagada");
  igual(efeitoDoEvento("PAYMENT_DELETED"), "cancelou", "cobranca apagada");
});

await etapa("estorno e chargeback ESTORNAM — o dinheiro voltou", () => {
  // Este é o par que some de vista: os quatro moravam no mesmo conjunto
  // "ACABOU". Deixá-los juntos daria acesso pago a quem pediu o dinheiro de
  // volta, e o disco continuaria correndo por nossa conta.
  igual(efeitoDoEvento("PAYMENT_REFUNDED"), "estornou", "estorno");
  igual(efeitoDoEvento("PAYMENT_CHARGEBACK_REQUESTED"), "estornou", "chargeback");
});

await etapa("vencimento é atraso, não fim", () => {
  igual(efeitoDoEvento("PAYMENT_OVERDUE"), "atrasou", "vencido");
});

await etapa("evento que não conhecemos não faz nada", () => {
  igual(efeitoDoEvento("PAYMENT_ANTICIPATED"), null, "desconhecido");
  igual(efeitoDoEvento(""), null, "vazio");
});

console.log("\nDois avisos da mesma cobrança compram UM período:\n");

/*
 * O fluxo de cada forma de pagamento, pela documentação do Asaas ("Webhook
 * para cobranças", conferida em 29/09/2026):
 *
 *   cartão de crédito  CONFIRMED → (32 dias) → RECEIVED
 *   cartão de débito   CONFIRMED → (3 dias)  → RECEIVED
 *   boleto             CONFIRMED → (compensação) → RECEIVED
 *   Pix                RECEIVED, e só
 *
 * `confirmedDate` vem nos dois avisos com o mesmo dia; `null` de volta quer
 * dizer "este aviso não muda nada".
 */
const DIA = 24 * 3600 * 1000;
const DIA_0 = new Date("2026-09-29T15:00:00-03:00");
const DATAS_DO_DIA_0 = {
  confirmedDate: "2026-09-29",
  paymentDate: "2026-09-29",
  clientPaymentDate: "2026-09-29",
};
const CARTAO = { billingType: "CREDIT_CARD", ...DATAS_DO_DIA_0 };
const PIX = { billingType: "PIX", ...DATAS_DO_DIA_0 };
// O começo de 29/10 em Brasília: um mês depois do DIA da confirmação.
const UM_MES_DEPOIS = "2026-10-29T03:00:00.000Z";
const iso = (d) => (d ? d.toISOString() : d);

await etapa("cartão: o RECEIVED 32 dias depois não compra outro período", () => {
  const confirmado = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", CARTAO, "mensal", null, DIA_0);
  const recebido = pagoAteDepoisDoAviso(
    "PAYMENT_RECEIVED",
    CARTAO,
    "mensal",
    confirmado,
    new Date(DIA_0.getTime() + 32 * DIA),
  );
  igual(iso(recebido), null, "o RECEIVED da mesma cobrança");
  igual(iso(confirmado), UM_MES_DEPOIS, "o CONFIRMED compra um mês");
  return "pago_ate fica no dia da aprovação + 1 mês";
});

await etapa("anual no cartão: o RECEIVED também não empurra o ano", () => {
  const confirmado = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", CARTAO, "anual", null, DIA_0);
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_RECEIVED", CARTAO, "anual", confirmado, new Date(DIA_0.getTime() + 32 * DIA))),
    null,
    "o RECEIVED da mesma cobrança",
  );
  igual(iso(confirmado), "2027-09-29T03:00:00.000Z", "o CONFIRMED compra doze meses");
});

await etapa("boleto: a compensação dias depois também não conta de novo", () => {
  const boleto = { billingType: "BOLETO", ...DATAS_DO_DIA_0 };
  const confirmado = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", boleto, "mensal", null, DIA_0);
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_RECEIVED", boleto, "mensal", confirmado, new Date(DIA_0.getTime() + 2 * DIA))),
    null,
    "o RECEIVED da mesma cobrança",
  );
});

await etapa("Pix: só vem o RECEIVED, e ele compra o período", () => {
  igual(iso(pagoAteDepoisDoAviso("PAYMENT_RECEIVED", PIX, "mensal", null, DIA_0)), UM_MES_DEPOIS, "Pix");
});

await etapa("Pix: a mensalidade seguinte renova — o RECEIVED não virou sempre-ignorado", () => {
  // O outro lado do conserto: se o RECEIVED que compra tempo novo também fosse
  // descartado, quem paga no Pix nunca mais renovaria.
  const mes2 = { billingType: "PIX", confirmedDate: "2026-10-29", paymentDate: "2026-10-29", clientPaymentDate: "2026-10-29" };
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_RECEIVED", mes2, "mensal", new Date(UM_MES_DEPOIS), new Date(DIA_0.getTime() + 30 * DIA))),
    "2026-11-29T03:00:00.000Z",
    "mês 2",
  );
});

await etapa("o RECEIVED do mês 1 chegando depois do CONFIRMED do mês 2 não encolhe nada", () => {
  // Cartão, com a ordem real: a mensalidade 2 é aprovada no dia 30, o dinheiro
  // da 1 só cai no dia 32. Reescrever o período com o aviso atrasado o levaria
  // de volta ao dia 30 — e quem cancelasse no dia 31 perderia o mês 2 pago.
  const aposMes2 = new Date("2026-11-29T03:00:00.000Z");
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_RECEIVED", CARTAO, "mensal", aposMes2, new Date(DIA_0.getTime() + 32 * DIA))),
    null,
    "aviso atrasado do mês 1",
  );
});

await etapa("o mesmo aviso repetido reescreve o mesmo valor, nunca soma", () => {
  // O Asaas reenvia o evento quando não recebe 200 a tempo.
  const primeiro = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", CARTAO, "mensal", null, DIA_0);
  const repetido = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", CARTAO, "mensal", primeiro, new Date(DIA_0.getTime() + 3600 * 1000));
  igual(iso(repetido), UM_MES_DEPOIS, "reenvio do CONFIRMED");
});

await etapa("um CONFIRMED nunca encolhe o período já pago", () => {
  // Anual rodando até 2027, e uma mensalidade confirmada no meio (voltou para o
  // mensal, reassinou): os meses do anual continuam pagos.
  const anual = new Date("2027-09-29T03:00:00.000Z");
  const mensal = { billingType: "CREDIT_CARD", confirmedDate: "2026-10-10" };
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", mensal, "mensal", anual, new Date("2026-10-10T12:00:00-03:00"))),
    anual.toISOString(),
    "fim do anual",
  );
});

await etapa("sem data no corpo, o período conta do momento do aviso", () => {
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", {}, "mensal", null, DIA_0)),
    "2026-10-29T18:00:00.000Z",
    "sem data",
  );
  igual(
    iso(pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", undefined, "mensal", null, DIA_0)),
    "2026-10-29T18:00:00.000Z",
    "sem payment",
  );
});

await etapa("data fora do formato não vira data inválida", () => {
  // Invalid Date no UPDATE seria erro 500 — e o Asaas reenviaria em looping
  // até suspender a fila da conta, a do Atomatiza junto.
  const r = pagoAteDepoisDoAviso("PAYMENT_CONFIRMED", { confirmedDate: "29/09/2026" }, "mensal", null, DIA_0);
  igual(iso(r), "2026-10-29T18:00:00.000Z", "cai no momento do aviso");
});

console.log("\nO cancelamento não pode apagar o período:\n");

await etapa("o UPDATE do cancelamento não escreve em pago_ate", () => {
  // Guarda de código, não de comportamento: a ação é um server action e não dá
  // para chamar de fora sem sessão. O que quebraria o conserto é alguém
  // acrescentar `pago_ate = null` ao UPDATE do cancelamento — e é isso, e só
  // isso, que esta etapa vigia. LER pago_ate ali é legítimo (o recado diz até
  // quando), então procurar a palavra no corpo inteiro acusaria o código certo.
  const fonte = readFileSync("src/app/painel/actions.ts", "utf8");
  const inicio = fonte.indexOf("export async function cancelarAssinaturaAction");
  if (inicio < 0) throw new Error("não achei cancelarAssinaturaAction");
  const corpo = fonte.slice(inicio, fonte.indexOf("\nexport ", inicio + 10));

  const atualiza = corpo.indexOf("update tenants");
  if (atualiza < 0) throw new Error("o cancelamento não atualiza mais o tenant — leia a ação");
  const comando = corpo.slice(atualiza, corpo.indexOf("`", atualiza));
  if (/pago_ate/.test(comando)) {
    throw new Error("o cancelamento voltou a mexer em pago_ate — o período pago some de novo");
  }
  return "o período sobrevive ao cancelamento";
});

await etapa("o webhook conta o período pelo CICLO do estúdio, não por um literal", () => {
  /*
   * `fimDoPeriodoPago` sabe que anual são doze meses, e a etapa acima prende
   * isso. Só que saber não adianta se quem chama passar outra coisa: trocar
   * `tenant.ciclo_cobranca` por "mensal" — ou tirar a coluna do `select` — daria
   * UM mês a quem pagou DOZE, e a diferença só apareceria onze meses depois, num
   * estúdio em dia sendo tratado como vencido.
   *
   * Provado contra o sandbox em 27/08/2026 que o Asaas aceita `cycle: "YEARLY"`
   * e devolve vencimento um ano à frente; o que falta é justamente esta ponta.
   */
  const fonte = readFileSync(
    new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url),
    "utf8",
  );
  if (!/select[^"]*ciclo_cobranca[^"]*from tenants/.test(fonte)) {
    throw new Error("o webhook não busca mais ciclo_cobranca — o anual vira mensal em silêncio");
  }
  if (!/pagoAteDepoisDoAviso\([^)]*tenant\.ciclo_cobranca/.test(fonte)) {
    throw new Error("o período não é mais contado pelo ciclo do estúdio");
  }
  return "anual compra doze meses de ponta a ponta";
});

await etapa("o webhook decide o pagamento pela regra, com o período que já existe", () => {
  /*
   * As etapas de "dois avisos" acima provam a regra; esta prova que o webhook a
   * usa. Voltar a gravar `fimDoPeriodoPago(ciclo, new Date())` direto — o
   * código até 29/09/2026 — faria o RECEIVED do cartão, 32 dias depois,
   * empurrar o período de novo e marcar `ativo` quem já tinha cancelado.
   */
  const fonte = readFileSync(
    new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url),
    "utf8",
  );
  if (!/select[^"]*pago_ate[^"]*from tenants/.test(fonte)) {
    throw new Error("o webhook não lê pago_ate — não tem como saber se o aviso é repetido");
  }
  if (!/pagoAteDepoisDoAviso\(\s*evento,\s*corpo\.payment,[^)]*tenant\.pago_ate/.test(fonte)) {
    throw new Error("o webhook não passa o evento, a cobrança e o pago_ate atual para a regra");
  }
  if (/fimDoPeriodoPago\([^)]*new Date\(\)/.test(fonte)) {
    throw new Error("o webhook voltou a contar o período do momento do aviso");
  }
  return "aviso repetido não muda o estúdio";
});

/*
 * O placar. Sem estas duas linhas o arquivo terminava depois da última etapa e
 * saía com 0 SEMPRE — `testar-tudo.mjs` julga pelo código de saída, então esta
 * suíte entrava verde na bateria mesmo com etapa vermelha. Ficou assim desde que
 * foi escrita; o aviso de "`falhou` atribuído e nunca lido" era o lint dizendo
 * exatamente isso, e ninguém tinha lido o aviso.
 */
console.log(falhou ? "\n✗ o período pago tem problema" : "\n✓ período pago ok");
process.exitCode = falhou ? 1 : 0;
