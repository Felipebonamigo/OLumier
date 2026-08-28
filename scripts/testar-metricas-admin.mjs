#!/usr/bin/env node
/**
 * Testa as contas do painel de administração. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-metricas-admin.mjs
 *
 * Suíte PURA: sem banco, sem servidor, sem rede. As funções recebem as linhas
 * já lidas e devolvem números — o que permite testar o caso que nunca aparece
 * no banco de desenvolvimento (o inadimplente, o cancelado que ainda ocupa
 * disco, o trial com plano de 10 TB).
 *
 * Por que ela existe separada de `testar-admin.mjs`: aquela prende o PORTÃO —
 * quem entra. Esta prende os NÚMEROS — e são números de dinheiro, lidos para
 * decidir preço e para responder "o negócio se paga?". Errar aqui não vaza
 * nada; leva a decidir errado, que é pior de descobrir.
 */
import {
  mensalEquivalenteCentavos,
  receitaMensalCentavos,
  bytesGuardados,
  quotaVendidaBytes,
  custoDoGuardadoCentavos,
  contagemPorStatus,
  trialsVencendo,
  novosDesde,
  resumoDaPlataforma,
} from "../src/lib/metricas-admin.ts";
import { MESES_PAGOS_NO_ANO, planoPorId, GB } from "../src/config/planos.ts";
import { TETO_TRIAL_BYTES } from "../src/config/trial.ts";

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/** Linha no formato que a consulta do painel devolve. Bytes em texto, como o pg entrega. */
const AGORA = new Date("2026-08-28T12:00:00Z");
const dias = (n) => new Date(AGORA.getTime() + n * 86_400_000);
const bytes = (gb) => String(BigInt(gb) * BigInt(GB));

function estudio(over = {}) {
  return {
    status: "ativo",
    plano_id: "g:foto:1000",
    ciclo_cobranca: "mensal",
    quota_bytes: bytes(1000),
    bytes_no_ar: bytes(0),
    bytes_no_cofre: bytes(0),
    criado_em: dias(-100),
    trial_ate: null,
    ...over,
  };
}

const PRECO_1TB = planoPorId("g:foto:1000").precoCentavos;

console.log("o valor mensal de cada ciclo");

await etapa("mensal vale o preço da faixa", () => {
  igual(mensalEquivalenteCentavos(PRECO_1TB, "mensal"), PRECO_1TB, "mensal");
});

/*
 * O anual cobra dez meses e entrega doze. Somar o preço cheio ao MRR contaria
 * como receita de UM mês o dinheiro de doze — e o painel diria que a
 * plataforma fatura o dobro do que fatura, no mês em que alguém assinar anual.
 */
await etapa("anual vale dez doze avos — não o preço cheio", () => {
  const esperado = Math.round((PRECO_1TB * MESES_PAGOS_NO_ANO) / 12);
  igual(mensalEquivalenteCentavos(PRECO_1TB, "anual"), esperado, "anual");
  if (mensalEquivalenteCentavos(PRECO_1TB, "anual") >= PRECO_1TB) {
    throw new Error("o anual ficou maior ou igual ao mensal");
  }
});

await etapa("ciclo desconhecido cai em mensal", () => {
  igual(mensalEquivalenteCentavos(PRECO_1TB, "semestral"), PRECO_1TB, "lixo");
  igual(mensalEquivalenteCentavos(PRECO_1TB, null), PRECO_1TB, "nulo");
});

console.log("\na receita");

/*
 * O CASO QUE INFLA O NÚMERO: o inadimplente. Ele tem plano, tem assinatura, e
 * NÃO pagou. Contá-lo transforma o painel numa promessa em vez de um extrato.
 */
await etapa("só quem está ativo entra na receita", () => {
  const linhas = [
    estudio({ status: "ativo" }),
    estudio({ status: "trial" }),
    estudio({ status: "inadimplente" }),
    estudio({ status: "cancelado" }),
  ];
  igual(receitaMensalCentavos(linhas), PRECO_1TB, "só um ativo");
});

await etapa("soma ativos de ciclos diferentes", () => {
  const linhas = [
    estudio({ status: "ativo", ciclo_cobranca: "mensal" }),
    estudio({ status: "ativo", ciclo_cobranca: "anual" }),
  ];
  const esperado = PRECO_1TB + Math.round((PRECO_1TB * MESES_PAGOS_NO_ANO) / 12);
  igual(receitaMensalCentavos(linhas), esperado, "soma");
});

await etapa("plano desconhecido não derruba a conta", () => {
  igual(receitaMensalCentavos([estudio({ plano_id: "plano-que-nao-existe" })]), 0, "vale zero");
});

console.log("\no espaço");

await etapa("guardado soma o que está no ar e o que está no cofre", () => {
  const linhas = [
    estudio({ bytes_no_ar: bytes(10), bytes_no_cofre: bytes(5) }),
    estudio({ bytes_no_ar: bytes(1), bytes_no_cofre: bytes(0) }),
  ];
  igual(String(bytesGuardados(linhas)), bytes(16), "total");
});

/*
 * O B2 cobra por BYTE GUARDADO, não por status. Quem cancelou e deixou 2 TB
 * parados custa igual a quem paga — e é justamente o custo que ninguém vê
 * chegar. Tirar o cancelado desta soma esconderia a única despesa que cresce
 * sozinha.
 */
await etapa("o custo conta o cancelado, porque a fatura conta", () => {
  const linhas = [estudio({ status: "cancelado", bytes_no_ar: bytes(100) })];
  if (custoDoGuardadoCentavos(linhas) <= 0) {
    throw new Error("cancelado com 100 GB guardados saiu de graça");
  }
});

await etapa("a quota do trial é o teto, não a do plano", () => {
  /* Trial que escolheu 10 TB no cadastro tem quota efetiva de 10 GB. Somar a do
     plano diria que vendemos 10 TB para quem não pagou nada. */
  const linhas = [estudio({ status: "trial", quota_bytes: bytes(10000), trial_ate: dias(5) })];
  igual(String(quotaVendidaBytes(linhas)), String(TETO_TRIAL_BYTES), "quota do trial");
});

await etapa("a quota de quem paga é a do plano", () => {
  igual(String(quotaVendidaBytes([estudio({ quota_bytes: bytes(2000) })])), bytes(2000), "quota");
});

console.log("\nas contagens");

await etapa("agrupa por situação", () => {
  const linhas = [
    estudio({ status: "ativo" }),
    estudio({ status: "ativo" }),
    estudio({ status: "trial", trial_ate: dias(3) }),
    estudio({ status: "cancelado" }),
  ];
  const c = contagemPorStatus(linhas);
  igual(c.ativo, 2, "ativos");
  igual(c.trial, 1, "trials");
  igual(c.cancelado, 1, "cancelados");
  igual(c.inadimplente, 0, "inadimplentes — precisa existir zerado, não sumir");
});

await etapa("trials vencendo conta só os que ainda não venceram", () => {
  const linhas = [
    estudio({ status: "trial", trial_ate: dias(2) }), // dentro
    estudio({ status: "trial", trial_ate: dias(6) }), // dentro
    estudio({ status: "trial", trial_ate: dias(20) }), // fora
    estudio({ status: "trial", trial_ate: dias(-1) }), // já venceu: não está "vencendo"
    estudio({ status: "ativo", trial_ate: dias(2) }), // pagou: não é trial
  ];
  igual(trialsVencendo(linhas, 7, AGORA).length, 2, "vencendo em 7 dias");
});

await etapa("novos desde conta pela data de cadastro", () => {
  const linhas = [
    estudio({ criado_em: dias(-1) }),
    estudio({ criado_em: dias(-29) }),
    estudio({ criado_em: dias(-31) }),
  ];
  igual(novosDesde(linhas, 30, AGORA), 2, "últimos 30 dias");
  igual(novosDesde(linhas, 7, AGORA), 1, "últimos 7 dias");
});

console.log("\no resumo");

await etapa("com a base vazia nenhum número vira NaN nem divide por zero", () => {
  const r = resumoDaPlataforma([], AGORA);
  for (const [chave, valor] of Object.entries(r)) {
    if (typeof valor === "number" && !Number.isFinite(valor)) {
      throw new Error(`${chave} veio ${valor} com a base vazia`);
    }
  }
  igual(r.estudios, 0, "estúdios");
  igual(r.receitaMensalCentavos, 0, "receita");
  igual(r.ocupacao, 0, "ocupação");
});

await etapa("a margem é receita menos custo, e pode ficar negativa", () => {
  /* Um cancelado com 10 TB parados e nenhum pagante: a plataforma perde
     dinheiro, e o painel tem de dizer isso em vez de travar em zero. */
  const r = resumoDaPlataforma([estudio({ status: "cancelado", bytes_no_ar: bytes(10000) })], AGORA);
  if (r.margemMensalCentavos >= 0) throw new Error("margem não ficou negativa");
  igual(r.margemMensalCentavos, r.receitaMensalCentavos - r.custoMensalCentavos, "margem");
});

await etapa("ocupação é o guardado sobre a quota vendida", () => {
  const linhas = [estudio({ quota_bytes: bytes(1000), bytes_no_ar: bytes(250) })];
  const r = resumoDaPlataforma(linhas, AGORA);
  igual(Math.round(r.ocupacao * 100), 25, "porcentagem");
});

if (falhou) {
  console.error("\n✗ as contas do painel de administração têm problema");
  process.exit(1);
}
console.log("\n✓ contas do painel de administração conferem\n");
