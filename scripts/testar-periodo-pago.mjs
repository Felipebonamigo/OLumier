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
 */
import { readFileSync } from "node:fs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { situacaoDoTenant, fimDoPeriodoPago, efeitoDoEvento } from "../src/lib/assinatura.ts";

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
  // O Asaas manda os DOIS para a mesma cobrança. Por isso o período conta a
  // partir de agora, e não soma ao que já havia: dois eventos do mesmo
  // pagamento não podem valer dois meses.
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
  if (!/fimDoPeriodoPago\(\s*tenant\.ciclo_cobranca/.test(fonte)) {
    throw new Error("o período não é mais contado pelo ciclo do estúdio");
  }
  return "anual compra doze meses de ponta a ponta";
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
