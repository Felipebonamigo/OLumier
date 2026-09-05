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
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SEGMENTOS,
  ESPACOS,
  TB_ADICIONAL_CENTAVOS,
  montar,
  idDaMontagem,
  planoPorId,
  custoArmazenamentoTetoCentavos,
  custoArmazenamentoCentavos,
  planos,
  todasAsMontagens,
  precoDoCicloCentavos,
  MESES_PAGOS_NO_ANO,
} from "../src/config/planos.ts";
import {
  lucroCentavos,
  montarFatias,
  SOCIOS,
  FOLGA_ESPACO,
  taxaCobrancaCentavos,
  BASE_DO_SPLIT,
  RATEIO_DO_CUSTO,
} from "../src/config/socios.ts";

/*
 * A reserva da montagem. Mesma regra do socios.ts, refeita aqui de propósito:
 * se a de lá mudar sem ninguém pensar na grade, este teste conta a diferença.
 */
const reserva = (m) =>
  Math.round(custoArmazenamentoCentavos(m) * FOLGA_ESPACO) +
  taxaCobrancaCentavos(montar(m).precoCentavos);

const RAIZ = path.resolve(import.meta.dirname, "..");

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
 * ── A ESCADA DE TB É CONTÍNUA E LINEAR (05/09/2026) ───────────────────────
 *
 * O Felipe: "eu havia solicitado para mudar os planos, deixando apenas 3 e
 * depois plano adicional por 1TB". O seletor da home mostrava as sete faixas;
 * passa a mostrar três mais um passo de "+1 TB".
 *
 * O passo só é honesto se a tabela tiver TODOS os teras. Antes ela pulava
 * 3 → 5 → 10: apertar "+1 TB" a partir de 3 daria 5, e a conta na tela não
 * bateria com o que a pessoa clicou. Estas duas etapas prendem as duas metades
 * da promessa "cada TB a mais custa R$ 80": nenhum buraco, e o mesmo degrau em
 * todos os passos.
 *
 * Nenhum preço existente mudou para isso — 2, 3, 5 e 10 TB já eram
 * exatamente 1 TB + N × R$ 80. O que faltava eram os degraus do meio.
 */
etapa("acima de 1 TB não há buraco na escada", () => {
  const teras = ESPACOS.filter((e) => e.gb >= 1000).sort((a, b) => a.gb - b.gb);
  for (let i = 1; i < teras.length; i++) {
    if (teras[i].gb - teras[i - 1].gb !== 1000) {
      throw new Error(
        `de ${teras[i - 1].gb / 1000} TB pula para ${teras[i].gb / 1000} TB — "+1 TB" não teria onde pousar`,
      );
    }
  }
  return `${teras[0].gb / 1000} a ${teras.at(-1).gb / 1000} TB, de 1 em 1`;
});

etapa("cada TB a mais custa o MESMO, em toda a escada", () => {
  const teras = ESPACOS.filter((e) => e.gb >= 1000).sort((a, b) => a.gb - b.gb);
  for (let i = 1; i < teras.length; i++) {
    const passo = teras[i].precoCentavos - teras[i - 1].precoCentavos;
    if (passo !== TB_ADICIONAL_CENTAVOS) {
      throw new Error(
        `de ${teras[i - 1].gb / 1000} para ${teras[i].gb / 1000} TB o passo é ${passo} e não ${TB_ADICIONAL_CENTAVOS}`,
      );
    }
  }
  return `R$ ${(TB_ADICIONAL_CENTAVOS / 100).toFixed(2)} por TB, em ${teras.length - 1} passos`;
});

etapa("a vitrine continua com três, e o seletor com três mais o passo", () => {
  if (planos.length !== 3) throw new Error(`a vitrine tem ${planos.length} planos`);
  const base = ESPACOS.filter((e) => e.gb <= 1000);
  if (base.length !== 3) {
    throw new Error(`${base.length} faixas até 1 TB — o seletor mostra uma por botão`);
  }
  const montador = readFileSync(
    path.join(RAIZ, "src/components/montador-plano.tsx"),
    "utf8",
  );
  if (montador.includes("ESPACOS.map(")) {
    throw new Error("o seletor ainda desenha um botão por faixa da tabela inteira");
  }
  if (!/TB adicional|tera a mais/i.test(montador)) {
    throw new Error("o seletor não oferece o passo de TB adicional");
  }
  return "3 botões + passo";
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
    const custo = custoArmazenamentoTetoCentavos(m);
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
/*
 * ── O ANUAL ───────────────────────────────────────────────────────────────
 *
 * O anual cobra 10 meses e entrega 12. Isso é desconto, e desconto é decisão —
 * o que NÃO pode acontecer é o desconto sair do bolso errado.
 *
 * A armadilha tem nome: a reserva. Ela existe para segurar, na conta, o
 * dinheiro dos fornecedores; o resto o split manda embora na hora. No mensal a
 * reserva cobre um mês, porque um mês é o que foi cobrado. No anual, o estúdio
 * paga uma vez e ocupa o espaço por DOZE meses — se a reserva ainda for de um
 * mês, ou mesmo de dez, o split despacha para as carteiras dos sócios um
 * dinheiro que ainda vai ser gasto em armazenamento.
 *
 * E esse erro não aparece no dia em que acontece. Aparece no décimo primeiro
 * mês, quando a fatura chega e o dinheiro dela já foi dividido — com o cliente
 * em dia e nenhum alarme tocando.
 */
await etapa("o anual custa 10 meses e entrega 12", () => {
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const anual = precoDoCicloCentavos(p.precoCentavos, "anual");
    const esperado = p.precoCentavos * MESES_PAGOS_NO_ANO;
    if (anual !== esperado) {
      throw new Error(`${p.id}: anual ${anual / 100} ≠ ${MESES_PAGOS_NO_ANO}× mensal ${esperado / 100}`);
    }
  }
  return `${MESES_PAGOS_NO_ANO} meses pagos, ${12 - MESES_PAGOS_NO_ANO} de desconto`;
});

await etapa("a reserva do anual cobre DOZE meses de custo, não dez", () => {
  let pior = null;
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const anual = precoDoCicloCentavos(p.precoCentavos, "anual");
    const custoDoAno = custoArmazenamentoTetoCentavos(m) * 12;
    const lucro = lucroCentavos(p.id, anual, "anual");
    const retido = anual - lucro;

    if (lucro > 0 && retido < custoDoAno) {
      throw new Error(
        `${p.id}: no anual fica R$ ${(retido / 100).toFixed(2)} para pagar ` +
          `R$ ${(custoDoAno / 100).toFixed(2)} de armazenamento do ano — o split levaria a diferença`,
      );
    }
    if (!pior || lucro < pior.lucro) pior = { id: p.id, lucro };
  }
  return `pior lucro anual: ${pior.id} com R$ ${(pior.lucro / 100).toFixed(2)}`;
});

await etapa("nenhuma faixa fica sem lucro no anual", () => {
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const anual = precoDoCicloCentavos(p.precoCentavos, "anual");
    if (lucroCentavos(p.id, anual, "anual") <= 0) {
      throw new Error(
        `${p.id}: o anual não libera nada para o split. Ou o desconto é grande demais ` +
          `para esta faixa, ou ela não devia existir no anual — decida, não deixe travar sozinho.`,
      );
    }
  }
});

await etapa("o desconto do ano sai do lucro, nunca da reserva", () => {
  /* Doze mensais e um anual guardam o MESMO espaço pelo mesmo tempo, então
   * retêm o mesmo custo. A diferença entre os dois tem de ser exatamente os
   * dois meses de desconto — se for maior, o anual está retendo de menos. */
  for (const m of todasAsMontagens()) {
    const p = montar(m);
    const anual = precoDoCicloCentavos(p.precoCentavos, "anual");
    const lucroDoAnual = lucroCentavos(p.id, anual, "anual");
    const lucroDe12Mensais = lucroCentavos(p.id, p.precoCentavos) * 12;
    const perdido = lucroDe12Mensais - lucroDoAnual;
    const doisMeses = p.precoCentavos * (12 - MESES_PAGOS_NO_ANO);

    /* Tolerância de 11 taxas de cobrança: o anual cobra UMA vez no ano, o mensal
     * cobra doze — essa economia é real e fica no lucro do anual. */
    /* A taxa deixou de ser fixa (R$ 0,49 + 2,99% no cartão), então a folga é a
       taxa do MENSAL onze vezes — que é o que o anual deixa de pagar. */
    const folga = taxaCobrancaCentavos(p.precoCentavos) * 11;
    if (perdido > doisMeses + 1 || perdido < doisMeses - folga - 1) {
      throw new Error(
        `${p.id}: o anual custa R$ ${(perdido / 100).toFixed(2)} de lucro, e o desconto ` +
          `de ${12 - MESES_PAGOS_NO_ANO} meses vale R$ ${(doisMeses / 100).toFixed(2)}`,
      );
    }
  }
  return "a diferença é o desconto, e só ele";
});

/*
 * A conta certa só vale se QUEM MANDA O DINHEIRO usar ela.
 *
 * `lucroCentavos` pode conhecer o ciclo e `montarFatias` continuar chamando sem
 * ele — e aí o split calcula sobre um preço anual usando reserva de um mês.
 * O split fica gordo, a reserva fica curta, e nada acusa: as duas funções estão
 * "certas" separadas. Esta etapa junta as duas.
 */
await etapa("o split do anual respeita a base declarada", () => {
  /* Carteiras de mentira só para as fatias existirem: sem carteira o sócio é
   * pulado, e o teste mediria uma lista vazia achando que passou. */
  const salvas = SOCIOS.map((s) => [s.variavelCarteira, process.env[s.variavelCarteira]]);
  for (const s of SOCIOS) process.env[s.variavelCarteira] = `carteira-de-teste-${s.id}`;

  try {
    let piorDescoberto = 0;
    const zerados = [];

    for (const m of todasAsMontagens()) {
      const p = montar(m);
      const anual = precoDoCicloCentavos(p.precoCentavos, "anual");
      const fatias = montarFatias(p.id, anual, "anual");
      /*
       * Com o custo em TERÇOS, sócio de 25% pode ficar de fora: quando o custo
       * passa de 75% da receita, o terço dele é maior que a fatia, e ele
       * deveria PAGAR — coisa que um split não sabe fazer, então a fatia dele
       * trava em zero. Não é defeito, é o acordo encostando no limite; o teste
       * anota QUAIS planos fazem isso, porque é informação de negócio.
       */
      if (fatias.length !== SOCIOS.length) {
        if (RATEIO_DO_CUSTO !== "igual") {
          throw new Error(`${p.id}: esperava ${SOCIOS.length} fatias, vieram ${fatias.length}`);
        }
        zerados.push(p.id);
      }
      const enviado = fatias.reduce((s, f) => s + f.centavos, 0);
      const custoDoAno = custoArmazenamentoTetoCentavos(m) * 12;

      /*
       * DIVIDINDO A RECEITA, A RESERVA DEIXA DE EXISTIR — de propósito.
       *
       * Até 31/08/2026 esta etapa exigia que o split nunca passasse do lucro,
       * porque o que ficava na conta era o dinheiro do fornecedor. O Felipe
       * mudou a base para `receita`, com o custo acertado entre os sócios por
       * fora, e essa exigência virou a descrição de um mundo que não existe
       * mais.
       *
       * Ela não foi apagada, foi VIRADA: em `receita` a conta fica zerada e a
       * fatura sai do bolso de quem opera. O teste passa a medir e a IMPRIMIR
       * o tamanho desse descoberto, para a consequência da decisão continuar
       * visível em vez de sumir junto com a regra antiga.
       */
      if (BASE_DO_SPLIT === "receita") {
        piorDescoberto = Math.max(piorDescoberto, custoDoAno - (anual - enviado));
        continue;
      }

      const lucro = lucroCentavos(p.id, anual, "anual");
      if (enviado > lucro) {
        throw new Error(
          `${p.id}: o split manda R$ ${(enviado / 100).toFixed(2)} e o lucro do ano ` +
            `é R$ ${(lucro / 100).toFixed(2)} — a diferença sai da reserva do fornecedor`,
        );
      }
      if (anual - enviado < custoDoAno) {
        throw new Error(
          `${p.id}: depois do split ficam R$ ${((anual - enviado) / 100).toFixed(2)} na conta ` +
            `para pagar R$ ${(custoDoAno / 100).toFixed(2)} de armazenamento do ano`,
        );
      }
    }

    if (BASE_DO_SPLIT === "receita") {
      return (
        `base receita — a conta fica zerada; maior descoberto de um ano: ` +
        `R$ ${(piorDescoberto / 100).toFixed(2)}, que sai do caixa de quem opera`
      );
    }
    const total = todasAsMontagens().length;
    return zerados.length
      ? `${total} montagens, split dentro do lucro · em ${zerados.length} delas quem tem 25% ` +
          `fica com zero no anual (o terço do custo passa da fatia): ${zerados.join(", ")}`
      : `${total} montagens, split dentro do lucro`;
  } finally {
    for (const [chave, valor] of salvas) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
});

await etapa("o custo por GB é o que a fatura cobra", () => {
  const porGb = custoArmazenamentoCentavos({ segmento: "foto", espacoGb: 1000 }) / 1000;
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
/*
 * ── OS CENTAVOS SÃO DECISÃO, NÃO SOBRA ────────────────────────────────────
 *
 * Toda faixa termina em 99 centavos. Duas razões, e a segunda é a que pesa:
 *
 *   1. R$ 49,99 lê mais barato que R$ 50,00 — psicologia de preço batida, e
 *      que funciona.
 *   2. O ANUAL cobra dez mensalidades. Noventa e nove centavos viram
 *      R$ 9,90 a mais em cada plano por ano, sem que ninguém perceba diferença
 *      na mensalidade. É receita que aparece só na soma.
 *
 * Sem esta etapa, a próxima faixa acrescentada à grade sairia em ,00 e
 * quebraria o padrão em silêncio — e num lugar onde ninguém relê.
 */
await etapa("toda faixa termina em 99 centavos", () => {
  const fora = ESPACOS.filter((e) => e.precoCentavos % 100 !== 99);
  if (fora.length) {
    throw new Error(
      `fora do padrão: ${fora.map((e) => `${e.gb}GB=R$${(e.precoCentavos / 100).toFixed(2)}`).join(", ")}`,
    );
  }
  return `${ESPACOS.length} faixas`;
});

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

/*
 * ── A GRADE DE 04/09/2026, E O QUE ELA PRENDE ─────────────────────────────
 *
 * O sócio propôs três planos na vitrine — 250 GB, 500 GB, 1 TB — e "TERA
 * ADICIONAL" vendido à parte. A vitrine mudou; a grade NÃO encolheu, e é isso
 * que as etapas abaixo garantem.
 *
 * As faixas de 2 a 10 TB continuam existindo porque acima de 300 GB nenhum
 * concorrente existe, por nenhum preço (medido em 26/08/2026: Lumi trava em
 * 100 GB, GoFotógrafo em 300 GB). Tirá-las da tabela seria abandonar o único
 * mercado sem briga para caber numa página de vendas mais curta.
 *
 * O "TB adicional" não é produto novo nem coluna nova: é a DIFERENÇA entre
 * degraus vizinhos acima de 1 TB. Mantê-la constante é o que permite dizer
 * "cada TB a mais custa R$ X" sem mentir, e sem inventar uma segunda estrutura
 * de cobrança (quota = plano + N) que exigiria mexer em schema e no Asaas.
 */
await etapa("acima de 1 TB, cada TB a mais custa o MESMO — é o que sustenta o adicional", () => {
  const acima = ESPACOS.filter((e) => e.gb >= 1000).sort((a, b) => a.gb - b.gb);
  const passos = [];
  for (let i = 1; i < acima.length; i++) {
    const tb = (acima[i].gb - acima[i - 1].gb) / 1000;
    passos.push((acima[i].precoCentavos - acima[i - 1].precoCentavos) / tb);
  }
  const distintos = [...new Set(passos)];
  if (distintos.length !== 1) {
    throw new Error(
      `o TB adicional varia: ${passos.map((c) => `R$ ${(c / 100).toFixed(2)}`).join(", ")}`,
    );
  }
  return `R$ ${(distintos[0] / 100).toFixed(2)} por TB`;
});

await etapa("o TB adicional cobre o próprio custo com folga", () => {
  /* O custo de mil GB com o espaço CHEIO, com a mesma folga cambial da reserva.
     Abaixo disto o adicional venderia prejuízo — e prejuízo que cresce com o
     uso, que é o pior tipo. */
  const custoTb = custoArmazenamentoTetoCentavos({ segmento: "foto", espacoGb: 1000 }) * 1.3;
  const acima = ESPACOS.filter((e) => e.gb >= 1000).sort((a, b) => a.gb - b.gb);
  const porTb =
    (acima[1].precoCentavos - acima[0].precoCentavos) / ((acima[1].gb - acima[0].gb) / 1000);
  if (porTb <= custoTb) {
    throw new Error(
      `TB adicional a R$ ${(porTb / 100).toFixed(2)} não cobre o custo de R$ ${(custoTb / 100).toFixed(2)}`,
    );
  }
  return `R$ ${(porTb / 100).toFixed(2)} contra R$ ${(custoTb / 100).toFixed(2)} de custo`;
});

await etapa("a vitrine mostra três planos, e a grade continua indo até 10 TB", () => {
  igual(planos.length, 3, "planos na vitrine");
  const gbs = planos.map((p) => p.quotaGb);
  igual(JSON.stringify(gbs), JSON.stringify([250, 500, 1000]), "quais");
  /* A grade completa é o que o montador oferece — e é onde mora o dinheiro que
     não tem concorrente. */
  if (!ESPACOS.some((e) => e.gb === 10000)) throw new Error("a grade perdeu o topo de 10 TB");
  return `vitrine ${gbs.join("/")} GB · grade até ${Math.max(...ESPACOS.map((e) => e.gb)) / 1000} TB`;
});

await etapa("a entrada de 250 GB é o preço que o sócio pediu", () => {
  const entrada = ESPACOS.sort((a, b) => a.gb - b.gb)[0];
  igual(entrada.gb, 250, "menor faixa");
  igual(entrada.precoCentavos, 4999, "preço da entrada");
  /* A faixa de 100 GB saiu: o GoFotógrafo dá 300 GB mais um CRM inteiro por
     R$ 49,90, e 100 GB pelo mesmo dinheiro perdia em qualquer comparação. */
  if (ESPACOS.some((e) => e.gb === 100)) throw new Error("a faixa de 100 GB voltou");
});

console.log(falhou ? "\n✗ suíte vermelha\n" : "\n✓ planos ok\n");
process.exit(falhou ? 1 : 0);
