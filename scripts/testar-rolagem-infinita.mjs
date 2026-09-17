#!/usr/bin/env node
/**
 * A rolagem infinita não pode fazer foto sumir. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-rolagem-infinita.mjs
 *
 * ── O DEFEITO (17/09/2026) ────────────────────────────────────────────────
 *
 * Juan, rolando o Making Of de um casamento entregue: "to descendo as fotos do
 * making of e buga, vai para as fotos da decoração e diminui a página do making
 * of".
 *
 * Numa galeria acima do teto de uma tela, quando a segunda parte chegava o
 * cliente RECALCULAVA os capítulos do zero, perguntando `it.secaoId === c.id`.
 * As fotos da rota `/mais` traziam `secaoId`; as do documento inicial, não. No
 * instante da primeira carga, as 600 primeiras deixavam de pertencer a capítulo
 * nenhum e sumiam.
 *
 * Medido num navegador de verdade: 601 imagens viravam 121, cinco capítulos
 * viravam dois, e a página caía de 192.661 px para 42.275.
 *
 * ── POR QUE A BATERIA INTEIRA PASSOU POR CIMA DISSO ──────────────────────
 *
 * Havia teste da rota `/mais` e teste da página. Cada um de um lado, os dois
 * verdes. O defeito morava na COSTURA — no contrato entre o que a página manda
 * e o que o cliente precisa —, e costura não aparece testando as pontas.
 *
 * Por isso as duas etapas daqui: uma pergunta se as duas fontes de foto falam a
 * mesma língua, e a outra exercita a junção com o campo FALTANDO, que é a
 * condição exata do defeito.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { capitulosComOsExtras } from "../src/lib/capitulos-da-rolagem.ts";
import { FOTOS_POR_TELA } from "../src/config/fatia-galeria.ts";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("A rolagem infinita não perde foto\n");

/* ── 1. A JUNÇÃO, COM O CAMPO FALTANDO ───────────────────────────────────── */

/*
 * A condição exata do defeito: as fotos iniciais SEM `secaoId`. Antes, isto
 * devolvia capítulos vazios e a galeria sumia. A função não tem como fazer
 * isso agora — ela nem olha para as fotos que já estavam lá.
 */
await etapa("foto que já está na tela não sai dela, nem sem secaoId", () => {
  const capitulos = [
    { id: "cap-a", indices: [0, 1, 2] },
    { id: "cap-b", indices: [3, 4] },
  ];
  const extras = [{ secaoId: "cap-b" }, { secaoId: "cap-a" }];
  const depois = capitulosComOsExtras(capitulos, 5, extras);

  const antesTotal = capitulos.reduce((n, c) => n + c.indices.length, 0);
  const depoisTotal = depois.reduce((n, c) => n + c.indices.length, 0);
  if (depoisTotal !== antesTotal + extras.length) {
    throw new Error(`eram ${antesTotal} + ${extras.length}, ficaram ${depoisTotal}`);
  }
  for (const c of capitulos) {
    const novo = depois.find((d) => d.id === c.id);
    for (const i of c.indices) {
      if (!novo.indices.includes(i)) throw new Error(`o índice ${i} sumiu de ${c.id}`);
    }
  }
  const a = depois.find((d) => d.id === "cap-a").indices;
  const b = depois.find((d) => d.id === "cap-b").indices;
  if (JSON.stringify(a) !== "[0,1,2,6]") throw new Error(`cap-a ficou ${JSON.stringify(a)}`);
  if (JSON.stringify(b) !== "[3,4,5]") throw new Error(`cap-b ficou ${JSON.stringify(b)}`);
  return "os índices do servidor ficam onde estavam";
});

await etapa("sem fotos novas, os capítulos são os MESMOS objetos", () => {
  const capitulos = [{ id: "a", indices: [0] }];
  if (capitulosComOsExtras(capitulos, 1, []) !== capitulos) {
    throw new Error("devolveu outra lista — o React redesenharia a galeria à toa");
  }
  const so = capitulosComOsExtras(capitulos, 1, [{ secaoId: "outro" }]);
  if (so[0] !== capitulos[0]) {
    throw new Error("trocou um capítulo que não recebeu foto nenhuma");
  }
  return "só troca quem recebeu foto";
});

await etapa("foto sem capítulo cai no balde das soltas", () => {
  const capitulos = [{ id: "sem-capitulo", indices: [] }, { id: "cap-a", indices: [] }];
  const d = capitulosComOsExtras(capitulos, 0, [{ secaoId: null }, { secaoId: "cap-a" }, {}]);
  const soltas = d.find((c) => c.id === "sem-capitulo").indices;
  if (JSON.stringify(soltas) !== "[0,2]") throw new Error(`soltas ficaram ${JSON.stringify(soltas)}`);
  return "null e ausente contam como solta";
});

/* ── 2. A COSTURA: AS DUAS FONTES FALAM A MESMA LÍNGUA? ──────────────────── */

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const g = await galeriaDaRodada(db, { nome: "rolagem", medias: 0, publicada: true });
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

const { criarSecao } = await import("../src/lib/secoes.ts");
const cap = await criarSecao(g.id, g.estudio.id, "Making Of");
const cap2 = await criarSecao(g.id, g.estudio.id, "Festa");

/* Acima do teto de uma tela: é a única situação em que a rolagem existe. */
const QUANTAS = FOTOS_POR_TELA + 20;
try {
  for (let i = 0; i < QUANTAS; i++) {
    await db.query(
      `insert into medias (galeria_id,tenant_id,secao_id,chave,nome_original,tipo,mime,bytes,largura,altura,ordem,pronto)
       values ($1,$2,$3,$4,$5,'foto','image/jpeg',1000,1200,1800,$6,true)`,
      [g.id, g.estudio.id, i < FOTOS_POR_TELA ? cap.id : cap2.id, `x/${g.id}/${i}.jpg`, `f${i}.jpg`, i],
    );
  }

  await etapa("a página e a rota /mais descrevem a foto do mesmo jeito", async () => {
    const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
    const r = await fetch(`${BASE}/api/g/${g.id}/mais?desde=${FOTOS_POR_TELA}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`a rota /mais respondeu ${r.status}`);
    const { fotos } = await r.json();
    if (!fotos?.length) throw new Error("a rota não devolveu foto nenhuma — a etapa ficaria sem objeto");

    /*
     * O `secaoId` das fotos da ROTA precisa existir também no documento, senão
     * as duas metades da galeria se descrevem diferente — que é exatamente o
     * defeito de 17/09/2026. Procurado no HTML porque é lá que o documento
     * entrega os dados de hidratação.
     */
    if (!fotos[0].secaoId) throw new Error("a rota /mais parou de mandar secaoId");
    if (!html.includes("secaoId")) {
      throw new Error(
        "o documento da galeria não manda secaoId, e a rota manda: as duas metades " +
          "falam línguas diferentes, e a junção perde foto",
      );
    }
    return "as duas mandam secaoId";
  });
  /* ── 3. A SAÍDA DO FIM DO CAPÍTULO ─────────────────────────────────────
   *
   * Felipe: "no fim do capítulo tem que ter um botão: 'próximo capítulo' ou
   * 'continuar'".
   *
   * Vendo UM capítulo, a última foto era um beco: a pessoa rolava, as fotos
   * acabavam, e continuar exigia voltar ao menu lá em cima — num capítulo de
   * 700 fotos, a galeria inteira de volta.
   *
   * A etapa usa a galeria PEQUENA de propósito. Nela não há fatia, e é
   * justamente onde a primeira versão do botão não aparecia: ele saía de
   * `fatia.capituloAtivo`, e `fatia` só existe acima de 600 fotos. O recorte
   * por capítulo existe em qualquer galeria.
   */
  const pequena = await galeriaDaRodada(db, { nome: "saida", medias: 0, publicada: true });
  await db.query("update galerias set senha_hash = null where id = $1", [pequena.id]);
  const c1 = await criarSecao(pequena.id, pequena.estudio.id, "Making Of");
  const c2 = await criarSecao(pequena.id, pequena.estudio.id, "Festa");
  let n = 0;
  for (const c of [c1, c2]) {
    for (let i = 0; i < 4; i++, n++) {
      await db.query(
        `insert into medias (galeria_id,tenant_id,secao_id,chave,nome_original,tipo,mime,bytes,largura,altura,ordem,pronto)
         values ($1,$2,$3,$4,$5,'foto','image/jpeg',1000,1200,1800,$6,true)`,
        [pequena.id, pequena.estudio.id, c.id, `x/${pequena.id}/${n}.jpg`, `f${n}.jpg`, n],
      );
    }
  }
  const pagina = async (consulta) =>
    (await fetch(`${BASE}/g/${pequena.tslug}/${pequena.gslug}${consulta}`, { cache: "no-store" })).text();

  await etapa("no fim de um capítulo há como ir para o próximo", async () => {
    const html = await pagina("?cap=making-of");
    if (!html.includes("Próximo capítulo")) {
      throw new Error("o capítulo termina num beco: nada leva ao seguinte");
    }
    if (!html.includes("Festa")) throw new Error("o botão não nomeia o capítulo de destino");
    return "Próximo capítulo: Festa";
  });

  await etapa("no ÚLTIMO capítulo a saída é a galeria inteira", async () => {
    const html = await pagina("?cap=festa");
    if (html.includes("Próximo capítulo")) {
      throw new Error("ofereceu um próximo capítulo que não existe");
    }
    if (!html.includes("Ver a galeria inteira")) {
      throw new Error("o último capítulo ficou sem saída nenhuma");
    }
    return "volta para a galeria";
  });

  await etapa("na galeria inteira o botão não aparece", async () => {
    const html = await pagina("");
    if (/Próximo capítulo|Ver a galeria inteira/.test(html)) {
      throw new Error("ofereceu saída de capítulo onde os capítulos já emendam um no outro");
    }
    return "a rolagem já faz esse papel";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a rolagem infinita perde foto\n" : "\n✓ a rolagem não perde foto\n");
process.exit(falhou ? 1 : 0);
