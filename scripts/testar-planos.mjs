#!/usr/bin/env node
/**
 * Testa o montador de planos — o "quebra-cabeça".
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-planos.mjs
 *
 * Por que existe: o plano deixou de ser uma lista fixa de seis e virou peças
 * que o fotógrafo combina (tipo de trabalho + tamanho da galeria + cofre).
 * Combinação é multiplicação: são dezenas de montagens possíveis, e nenhuma
 * pode sair com preço abaixo do custo nem com reserva maior que o preço —
 * os dois jeitos de a cobrança sangrar em silêncio.
 *
 * Prende também o que NÃO pode mudar: id antigo gravado no banco tem de
 * continuar valendo a MESMA quota de antes. Um id que muda de significado
 * encolhe o espaço de quem já pagou, sem aviso e sem erro.
 */
import {
  SEGMENTOS,
  GALERIAS,
  COFRES,
  montar,
  idDaMontagem,
  planoPorId,
  custoTetoCentavos,
  planos,
  todasAsMontagens,
} from "../src/config/planos.ts";
import { lucroCentavos, RESERVA_POR_PLANO } from "../src/config/socios.ts";

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

console.log("as peças");

await etapa("três tipos de trabalho", () => {
  igual(SEGMENTOS.length, 3, "quantidade de segmentos");
  const ids = SEGMENTOS.map((s) => s.id).sort().join(",");
  igual(ids, "ambos,filme,foto", "ids dos segmentos");
});

await etapa("tamanhos de galeria em ordem crescente", () => {
  if (GALERIAS.length < 4) throw new Error("poucas faixas de galeria");
  for (let i = 1; i < GALERIAS.length; i++) {
    if (GALERIAS[i].gb <= GALERIAS[i - 1].gb) throw new Error("gb fora de ordem");
    if (GALERIAS[i].precoCentavos <= GALERIAS[i - 1].precoCentavos) {
      throw new Error("preço não cresce junto com o espaço");
    }
  }
  return `${GALERIAS.length} faixas, ${GALERIAS[0].gb} GB a ${GALERIAS.at(-1).gb} GB`;
});

await etapa("cofre é opcional e mais barato por GB que a galeria", () => {
  const galeria1tb = GALERIAS.find((g) => g.gb === 1000);
  const cofre1tb = COFRES.find((c) => c.gb === 1000);
  if (!galeria1tb || !cofre1tb) throw new Error("falta a faixa de 1 TB para comparar");
  if (cofre1tb.precoCentavos >= galeria1tb.precoCentavos) {
    throw new Error("cofre não pode custar o mesmo que espaço no ar");
  }
  return `1 TB: galeria ${galeria1tb.precoCentavos / 100} vs cofre ${cofre1tb.precoCentavos / 100}`;
});

console.log("\nmontagem");

await etapa("preço é a soma das peças", () => {
  const g = GALERIAS.find((x) => x.gb === 1000);
  const c = COFRES.find((x) => x.gb === 3000);
  const p = montar({ segmento: "filme", galeriaGb: 1000, cofreGb: 3000 });
  igual(p.precoCentavos, g.precoCentavos + c.precoCentavos, "soma galeria+cofre");
});

await etapa("sem cofre paga só a galeria", () => {
  const g = GALERIAS.find((x) => x.gb === 500);
  const p = montar({ segmento: "foto", galeriaGb: 500, cofreGb: 0 });
  igual(p.precoCentavos, g.precoCentavos, "preço sem cofre");
  igual(p.cofreGb, 0, "cofre zerado");
});

/*
 * A promessa comercial que nos separa do Pixieset: lá vídeo é cobrado por HORA
 * (US$ 5/h extra, e só em HD). Aqui vídeo é só espaço. Se algum dia alguém
 * puser um adicional por segmento, este teste cai e a promessa da home vira
 * mentira antes de ir pro ar.
 */
await etapa("vídeo não custa mais caro que foto", () => {
  for (const g of GALERIAS) {
    const foto = montar({ segmento: "foto", galeriaGb: g.gb, cofreGb: 0 });
    const filme = montar({ segmento: "filme", galeriaGb: g.gb, cofreGb: 0 });
    const ambos = montar({ segmento: "ambos", galeriaGb: g.gb, cofreGb: 0 });
    igual(filme.precoCentavos, foto.precoCentavos, `preço de filme em ${g.gb} GB`);
    igual(ambos.precoCentavos, foto.precoCentavos, `preço de ambos em ${g.gb} GB`);
  }
});

await etapa("id da montagem faz ida e volta", () => {
  const m = { segmento: "ambos", galeriaGb: 2000, cofreGb: 5000 };
  const id = idDaMontagem(m);
  const p = planoPorId(id);
  if (!p) throw new Error(`planoPorId não reconheceu "${id}"`);
  igual(p.segmento, m.segmento, "segmento");
  igual(p.quotaGb, m.galeriaGb, "galeria");
  igual(p.cofreGb, m.cofreGb, "cofre");
  igual(p.id, id, "id estável");
  return id;
});

await etapa("id inventado é recusado", () => {
  for (const ruim of ["g:foto:999:0", "g:banana:100:0", "g:foto:100", "", "g::100:0"]) {
    if (planoPorId(ruim)) throw new Error(`deveria recusar "${ruim}"`);
  }
});

console.log("\nnão quebrar quem já pagou");

/*
 * Estes seis ids estão gravados em `tenants.plano_id` e no default da coluna.
 * O tamanho que cada um vale é contrato: mudar aqui encolhe a conta de alguém
 * na próxima sincronização de quota, calado.
 */
const LEGADOS = {
  "foto-100": { quotaGb: 100, cofreGb: 500 },
  "foto-200": { quotaGb: 200, cofreGb: 1000 },
  "foto-500": { quotaGb: 500, cofreGb: 2000 },
  "filme-1000": { quotaGb: 1000, cofreGb: 3000 },
  "filme-2000": { quotaGb: 2000, cofreGb: 5000 },
  "filme-5000": { quotaGb: 5000, cofreGb: 10000 },
};

await etapa("id antigo continua valendo o mesmo espaço", () => {
  for (const [id, esperado] of Object.entries(LEGADOS)) {
    const p = planoPorId(id);
    if (!p) throw new Error(`id antigo "${id}" deixou de existir`);
    igual(p.quotaGb, esperado.quotaGb, `${id}: galeria`);
    igual(p.cofreGb, esperado.cofreGb, `${id}: cofre`);
  }
  return `${Object.keys(LEGADOS).length} ids preservados`;
});

console.log("\ndinheiro");

await etapa("nenhuma montagem sai abaixo do custo", () => {
  let pior = null;
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const custo = custoTetoCentavos(m);
    const margem = p.precoCentavos - custo;
    if (margem <= 0) {
      throw new Error(`${p.id} custa ${custo / 100} e vende por ${p.precoCentavos / 100}`);
    }
    if (!pior || margem < pior.margem) pior = { id: p.id, margem };
  }
  return `pior margem: ${pior.id} com R$ ${(pior.margem / 100).toFixed(2)}`;
});

/*
 * A reserva é o que FICA na conta para pagar Cloudflare e Backblaze; o split
 * manda embora o resto. Reserva < custo significaria fatura do cartão sem
 * dinheiro para cobrir; lucro zero significaria sócio recebendo nada.
 */
await etapa("reserva cobre o custo e ainda sobra lucro", () => {
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const custo = custoTetoCentavos(m);
    const lucro = lucroCentavos(p.id, p.precoCentavos);
    const reserva = p.precoCentavos - lucro;
    if (reserva < custo) throw new Error(`${p.id}: reserva ${reserva / 100} < custo ${custo / 100}`);
    if (lucro <= 0) throw new Error(`${p.id}: lucro zerado`);
  }
});

await etapa("id antigo mantém a reserva que já estava na tabela", () => {
  for (const id of Object.keys(LEGADOS)) {
    const p = planoPorId(id);
    const lucro = lucroCentavos(id, p.precoCentavos);
    const reserva = p.precoCentavos - lucro;
    if (RESERVA_POR_PLANO[id] && reserva !== RESERVA_POR_PLANO[id]) {
      throw new Error(`${id}: reserva ${reserva} ≠ tabela ${RESERVA_POR_PLANO[id]}`);
    }
  }
});

console.log("\nposição contra o mercado");

/*
 * Número verificado em 24/08/2026 na página do Pixieset: plano Pro, 1 TB, US$ 24
 * no anual — R$ 132 a 5,50, e ~R$ 140 no cartão do brasileiro com IOF de 3,38%.
 * Nossa faixa de 1 TB precisa caber embaixo disso, senão o fotógrafo que compara
 * lado a lado escolhe eles. Foi exatamente esse buraco que motivou a grade nova.
 */
await etapa("1 TB de galeria fica abaixo do Pixieset Pro com IOF", () => {
  const g = GALERIAS.find((x) => x.gb === 1000);
  if (!g) throw new Error("sumiu a faixa de 1 TB");
  if (g.precoCentavos > 14000) {
    throw new Error(`1 TB a R$ ${g.precoCentavos / 100} perde para o Pro (~R$ 140)`);
  }
  return `R$ ${g.precoCentavos / 100} contra ~R$ 140`;
});

await etapa("combos prontos continuam com cofre maior que a galeria", () => {
  for (const p of planos) {
    if (p.cofreGb <= p.quotaGb) {
      throw new Error(`${p.nome}: cofre ${p.cofreGb} ≤ galeria ${p.quotaGb}`);
    }
  }
  return `${planos.length} combos`;
});

console.log(falhou ? "\n✗ suíte vermelha\n" : "\n✓ planos ok\n");
process.exit(falhou ? 1 : 0);
