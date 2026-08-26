#!/usr/bin/env node
/**
 * Testa o montador de planos — agora de DUAS peças, não três.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-planos.mjs
 *
 * Por que existe: o plano é montado (tipo de trabalho + tamanho do espaço), e
 * nenhuma montagem pode sair com preço abaixo do custo nem com reserva maior
 * que o preço — os dois jeitos de a cobrança sangrar em silêncio.
 *
 * Prende também o que NÃO pode mudar: id gravado no banco tem de continuar
 * valendo pelo menos o MESMO espaço de antes. Um id que muda de significado
 * encolhe o espaço de quem já pagou, sem aviso e sem erro.
 *
 * ── A UNIFICAÇÃO DE 25/08/2026 ────────────────────────────────────────────
 * O cofre deixou de ser peça de preço. Com tudo no B2, o GB no ar e o GB
 * arquivado custam exatamente o mesmo (a franquia de egress de 3× cobre o
 * download nos casos reais), então cobrar 36% menos pelo byte parado virou
 * desconto sem lastro. Agora é um espaço só, e arquivar é comportamento
 * incluso. Este arquivo prende as duas metades disso: que a peça sumiu, e que
 * ninguém que já assinou perdeu espaço nem pagou mais caro.
 */
import {
  SEGMENTOS,
  ESPACOS,
  montar,
  idDaMontagem,
  planoPorId,
  custoTetoCentavos,
  custoEspacoCentavos,
  planos,
  todasAsMontagens,
} from "../src/config/planos.ts";
import { lucroCentavos, FOLGA_ESPACO, TAXA_COBRANCA } from "../src/config/socios.ts";

/*
 * A reserva da montagem. Mesma regra do socios.ts, refeita aqui de propósito:
 * se a de lá mudar sem ninguém pensar na grade, este teste conta a diferença.
 */
const reserva = (m) => Math.round(custoEspacoCentavos(m) * FOLGA_ESPACO) + TAXA_COBRANCA;

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

await etapa("tamanhos de espaço em ordem crescente", () => {
  if (ESPACOS.length < 4) throw new Error("poucas faixas de espaço");
  for (let i = 1; i < ESPACOS.length; i++) {
    if (ESPACOS[i].gb <= ESPACOS[i - 1].gb) throw new Error("gb fora de ordem");
    if (ESPACOS[i].precoCentavos <= ESPACOS[i - 1].precoCentavos) {
      throw new Error("preço não cresce junto com o espaço");
    }
  }
  return `${ESPACOS.length} faixas, ${ESPACOS[0].gb} GB a ${ESPACOS.at(-1).gb} GB`;
});

/*
 * A escada tem de ficar mais barata por GB a cada degrau — é o que empurra o
 * cliente para a faixa maior, que custa proporcionalmente menos para nós. Uma
 * inversão aqui (degrau maior com R$/GB pior) é erro de digitação em dinheiro.
 */
await etapa("o GB fica mais barato a cada degrau", () => {
  let anterior = Infinity;
  for (const e of ESPACOS) {
    const porGb = e.precoCentavos / e.gb;
    if (porGb >= anterior) throw new Error(`${e.gb} GB não barateia o GB (${porGb.toFixed(3)})`);
    anterior = porGb;
  }
  const primeiro = ESPACOS[0], ultimo = ESPACOS.at(-1);
  return `R$ ${(primeiro.precoCentavos / primeiro.gb / 100).toFixed(3)}/GB → R$ ${(ultimo.precoCentavos / ultimo.gb / 100).toFixed(3)}/GB`;
});

/*
 * A peça de cofre não pode voltar por descuido. Se alguém reintroduzir uma
 * grade separada para o arquivo, o desconto sem lastro volta junto — e com ele
 * a recusa de arquivamento que este trabalho removeu.
 */
await etapa("não existe mais peça de cofre", async () => {
  const mod = await import("../src/config/planos.ts");
  if ("COFRES" in mod) throw new Error("COFRES voltou a existir");
  if ("GALERIAS" in mod) throw new Error("GALERIAS deveria ter virado ESPACOS");
  const p = montar({ segmento: "foto", espacoGb: 1000 });
  if ("cofreGb" in p) throw new Error("Plano ainda carrega cofreGb");
});

console.log("\nmontagem");

await etapa("preço é o da faixa escolhida", () => {
  const e = ESPACOS.find((x) => x.gb === 1000);
  const p = montar({ segmento: "filme", espacoGb: 1000 });
  igual(p.precoCentavos, e.precoCentavos, "preço da faixa");
  igual(p.quotaGb, 1000, "quota");
});

/*
 * A promessa comercial que nos separa do Pixieset: lá vídeo é cobrado por HORA
 * (US$ 5/h extra, e só em HD). Aqui vídeo é só espaço. Se algum dia alguém
 * puser um adicional por segmento, este teste cai e a promessa da home vira
 * mentira antes de ir pro ar.
 */
await etapa("vídeo não custa mais caro que foto", () => {
  for (const e of ESPACOS) {
    const foto = montar({ segmento: "foto", espacoGb: e.gb });
    const filme = montar({ segmento: "filme", espacoGb: e.gb });
    const ambos = montar({ segmento: "ambos", espacoGb: e.gb });
    igual(filme.precoCentavos, foto.precoCentavos, `preço de filme em ${e.gb} GB`);
    igual(ambos.precoCentavos, foto.precoCentavos, `preço de ambos em ${e.gb} GB`);
  }
});

await etapa("id da montagem faz ida e volta", () => {
  const m = { segmento: "ambos", espacoGb: 2000 };
  const id = idDaMontagem(m);
  const p = planoPorId(id);
  if (!p) throw new Error(`planoPorId não reconheceu "${id}"`);
  igual(p.segmento, m.segmento, "segmento");
  igual(p.quotaGb, m.espacoGb, "espaço");
  igual(p.id, id, "id estável");
  return id;
});

await etapa("id inventado é recusado", () => {
  for (const ruim of ["g:foto:999", "g:banana:100", "g:foto", "", "g::100"]) {
    if (planoPorId(ruim)) throw new Error(`deveria recusar "${ruim}"`);
  }
});

console.log("\nnão quebrar quem já pagou");

/*
 * Ids gravados em `tenants.plano_id`. Duas gerações:
 *   - os seis nomeados, de antes do quebra-cabeça
 *   - os montados de TRÊS peças (`g:seg:galeria:cofre`), que existiram entre
 *     24/08 e a unificação — inclusive o do único estúdio em produção
 *
 * Nos dois casos a regra é a mesma: a quota nova é a SOMA do que ele tinha
 * (galeria + cofre), e o preço fica congelado. Somar nunca encolhe o espaço de
 * ninguém, e congelar o preço garante que a unificação não vire aumento pelas
 * costas. Ninguém novo recebe estes ids — eles só resolvem para trás.
 */
const LEGADOS = {
  "foto-100": { quotaGb: 600, precoCentavos: 9900 },
  "foto-200": { quotaGb: 1200, precoCentavos: 12900 },
  "foto-500": { quotaGb: 2500, precoCentavos: 17900 },
  "filme-1000": { quotaGb: 4000, precoCentavos: 24900 },
  "filme-2000": { quotaGb: 7000, precoCentavos: 34900 },
  "filme-5000": { quotaGb: 15000, precoCentavos: 69900 },
};

await etapa("id antigo nomeado vale galeria + cofre somados", () => {
  for (const [id, esperado] of Object.entries(LEGADOS)) {
    const p = planoPorId(id);
    if (!p) throw new Error(`id antigo "${id}" deixou de existir`);
    igual(p.quotaGb, esperado.quotaGb, `${id}: quota`);
    igual(p.precoCentavos, esperado.precoCentavos, `${id}: preço`);
  }
  return `${Object.keys(LEGADOS).length} ids preservados`;
});

/*
 * O estúdio que está em produção hoje usa `g:foto:250:1000`. Se este id parar
 * de resolver, a conta dele quebra na próxima leitura de plano; se resolver
 * para menos de 1250 GB, ele perde espaço calado na próxima sincronização.
 */
await etapa("id montado de três peças vira espaço somado, sem mudar de preço", () => {
  const p = planoPorId("g:foto:250:1000");
  if (!p) throw new Error("g:foto:250:1000 deixou de resolver — é o plano do estúdio em produção");
  igual(p.quotaGb, 1250, "quota somada");
  igual(p.precoCentavos, 16800, "preço congelado (79 + 89)");
  igual(p.segmento, "foto", "segmento");
});

await etapa("qualquer id de três peças resolve pela soma", () => {
  for (const [id, gb] of [["g:filme:1000:3000", 4000], ["g:ambos:2000:5000", 7000], ["g:foto:100:0", 100]]) {
    const p = planoPorId(id);
    if (!p) throw new Error(`${id} não resolve`);
    igual(p.quotaGb, gb, `${id}: quota`);
  }
});

console.log("\ndinheiro");

/*
 * O piso de PREÇO: nenhuma faixa pode sair abaixo do custo com a folga
 * cambial, senão a grade nasce errada e o erro só aparece na fatura.
 */
await etapa("nenhuma montagem sai abaixo do custo + folga", () => {
  let pior = null;
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const lucro = p.precoCentavos - reserva(m);
    if (lucro <= 0) {
      throw new Error(`${p.id}: reserva ${reserva(m) / 100} engole o preço ${p.precoCentavos / 100}`);
    }
    if (!pior || lucro < pior.lucro) pior = { id: p.id, lucro };
  }
  return `pior lucro: ${pior.id} com R$ ${(pior.lucro / 100).toFixed(2)}`;
});

/*
 * A reserva é o que FICA na conta para pagar os fornecedores; o split manda
 * embora o resto. Onde nem o preço inteiro cobrisse o custo, o único
 * comportamento aceitável seria reter tudo — e a etapa seguinte exige que isso
 * não esteja acontecendo em faixa nenhuma.
 */
await etapa("a reserva que fica cobre o custo de cada montagem", () => {
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const custo = custoTetoCentavos(m);
    const lucro = lucroCentavos(p.id, p.precoCentavos);
    const retido = p.precoCentavos - lucro;
    if (lucro > 0 && retido < custo) {
      throw new Error(`${p.id}: reserva ${retido / 100} < custo ${custo / 100}`);
    }
  }
  return `${todasAsMontagens().length} montagens conferidas`;
});

/*
 * O CUSTO QUE O CÓDIGO CONTA TEM DE SER O QUE A FATURA COBRA.
 *
 * Fixado em número, e não derivado das constantes, de propósito: um teste que
 * refaz a mesma conta do código concorda com ele até quando os dois estão
 * errados. Este aqui é o valor conferido na página dos fornecedores, e
 * discordar dele é o sintoma de que a arquitetura mudou e a régua não.
 *
 * Original no Backblaze B2 (R$ 0,0382/GB) mais a fatia de derivada que fica na
 * Cloudflare — miniatura e preview são 9,3% dos bytes do original no PIOR
 * perfil medido (fotos leves de 3 MB). O pior perfil, e não o típico de 2,7%,
 * porque isto alimenta uma RESERVA: reserva é proteção, e proteção se calcula
 * pelo caso ruim.
 */
await etapa("o custo por GB é o que a fatura cobra", () => {
  const porGb = custoEspacoCentavos({ segmento: "foto", espacoGb: 1000 }) / 1000;
  if (Math.abs(porGb - 4.587) > 0.01) {
    throw new Error(
      `o código conta R$ ${(porGb / 100).toFixed(4)}/GB — a fatura cobra R$ 0,0459 ` +
        `(B2 R$ 0,0382 + 9,3% de derivada no R2)`,
    );
  }
  return `R$ ${(porGb / 100).toFixed(4)}/GB`;
});

/*
 * TODA FAIXA TEM DE LIBERAR DINHEIRO PARA O SPLIT.
 *
 * Entre 25 e 26/08/2026 nenhuma faixa de 1 TB para cima liberava um centavo. A
 * reserva era calculada numa rota que tinha deixado de existir — tudo no R2
 * mais um espelho CHEIO no B2, R$ 0,1207/GB — enquanto o original já nascia no
 * B2 e o espelho tinha sido cancelado. Três vezes o custo real.
 *
 * Reter 100% foi a proteção CERTA enquanto a obra não saía: distribuir lucro
 * calculado numa rota barata que ainda não existia seria pagar sócio com
 * dinheiro da fatura. O que não pode é a proteção continuar ligada depois que o
 * motivo acabou — o sócio não recebe, e nada na tela diz por quê.
 *
 * Este teste é o alarme dessa segunda metade: no dia em que o custo voltar a
 * engolir o preço, ele fica vermelho e obriga a decisão a ser tomada por gente,
 * em vez de o dinheiro parar sozinho e em silêncio.
 */
await etapa("toda faixa libera lucro para o split", () => {
  const travadas = [];
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    if (lucroCentavos(p.id, p.precoCentavos) <= 0) travadas.push(p.id);
  }
  if (travadas.length > 0) {
    throw new Error(
      `${travadas.length} montagem(ns) retêm 100% e não repassam nada: ${travadas.slice(0, 4).join(", ")}` +
        (travadas.length > 4 ? " …" : ""),
    );
  }
  return `${todasAsMontagens().length} montagens, todas repassando`;
});

console.log("\nposição contra o mercado");

/*
 * Número verificado em 25/08/2026 na página do Pixieset: plano Pro, 1 TB, US$ 24
 * no anual — R$ 132 a 5,50, e ~R$ 135 no cartão do brasileiro com IOF de 2,38%.
 * Nossa faixa de 1 TB precisa caber perto disso, senão o fotógrafo que compara
 * lado a lado escolhe eles — e lá o vídeo é 1 h em HD, aqui é ilimitado em 4K.
 */
await etapa("1 TB fica no páreo com o Pixieset Pro", () => {
  const e = ESPACOS.find((x) => x.gb === 1000);
  if (!e) throw new Error("sumiu a faixa de 1 TB");
  if (e.precoCentavos > 14000) {
    throw new Error(`1 TB a R$ ${e.precoCentavos / 100} perde para o Pro (~R$ 135)`);
  }
  return `R$ ${e.precoCentavos / 100} contra ~R$ 135`;
});

await etapa("existe um combo em destaque para a home", () => {
  const destaque = planos.filter((p) => p.destaque);
  igual(destaque.length, 1, "quantidade de destaques");
  return `${destaque[0].nome} — R$ ${destaque[0].precoCentavos / 100}`;
});

console.log(falhou ? "\n✗ suíte vermelha\n" : "\n✓ planos ok\n");
process.exit(falhou ? 1 : 0);
