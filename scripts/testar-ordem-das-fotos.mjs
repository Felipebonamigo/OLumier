#!/usr/bin/env node
/**
 * ORDENAR AS FOTOS DE UM CAPÍTULO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-ordem-das-fotos.mjs
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "adicionar um sistema de controle das fotos em cada capítulo. Para
 * além de ter a funcionalidade de mover de um capítulo pro outro, poder
 * organizar por ordem de upload/adição // por ordem cronológica // por nome
 * A-Z // por nome Z-A".
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. As quatro ordens fazem o que o nome diz.
 * 2. O A→Z é NATURAL: foto_2 antes de foto_10. É a mesma regra do envio, e a
 *    razão de a ordenação acontecer em JavaScript e não num `order by`.
 * 3. A cronológica usa a data da CÂMERA e cai na de envio onde ela falta —
 *    dizendo quantas caíram, em vez de fingir que valeu para todas.
 * 4. Ordenar um capítulo não mexe na ordem de outro.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const { criarSecao, ordenarFotosDaSecao } = await import("../src/lib/secoes.ts");

const g = await galeriaDaRodada(db, { nome: "ordem", medias: 0, publicada: true });
const cerimonia = await criarSecao(g.id, g.estudio.id, "Cerimônia");
const festa = await criarSecao(g.id, g.estudio.id, "Festa");

/**
 * Põe uma foto no capítulo.
 *
 * `criado_em` é a ordem de ENVIO e `tirada_em` a da câmera — os dois são
 * cravados aqui de propósito, e DESENCONTRADOS: é o caso real do casamento com
 * dois fotógrafos, onde a pasta que subiu depois tem fotos mais antigas.
 */
let n = 0;
const por = async (secaoId, nome, envio, camera) => {
  const { rows } = await db.query(
    `insert into medias (galeria_id, tenant_id, secao_id, chave, nome_original, tipo, mime,
                         bytes, ordem, pronto, criado_em, tirada_em)
     values ($1,$2,$3,$4,$5,'foto','image/jpeg',1000,$6,true,$7,$8) returning id`,
    [g.id, g.estudio.id, secaoId, `x/${g.id}/${n}.jpg`, nome, n++, envio, camera],
  );
  return rows[0].id;
};

const ordemAgora = async (secaoId) =>
  (
    await db.query(
      "select nome_original from medias where galeria_id = $1 and secao_id = $2 order by ordem, criado_em",
      [g.id, secaoId],
    )
  ).rows.map((r) => r.nome_original);

const D = (iso) => new Date(iso);

/* Enviadas em ordem alfabética; a câmera diz outra coisa. */
await por(cerimonia.id, "foto_10.jpg", D("2026-09-15T10:00:00Z"), D("2026-09-14T18:40:00Z"));
await por(cerimonia.id, "foto_2.jpg", D("2026-09-15T10:01:00Z"), D("2026-09-14T18:10:00Z"));
await por(cerimonia.id, "DSC_0001.jpg", D("2026-09-15T10:02:00Z"), D("2026-09-14T18:25:00Z"));
await por(festa.id, "festa_a.jpg", D("2026-09-15T11:00:00Z"), D("2026-09-14T23:00:00Z"));
await por(festa.id, "festa_b.jpg", D("2026-09-15T11:01:00Z"), D("2026-09-14T22:00:00Z"));

console.log("\nA ordem das fotos do capítulo:\n");

await etapa("ordem de envio", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "envio");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["foto_10.jpg", "foto_2.jpg", "DSC_0001.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

await etapa("nome A → Z, e é NATURAL: foto_2 antes de foto_10", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["DSC_0001.jpg", "foto_2.jpg", "foto_10.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

/**
 * ── A COLORIDA ANTES DA SUA VARIANTE EM PB (25/09/2026) ────────────────────
 *
 * Juan, numa galeria de verdade: "nas horizontais, a preto e branco tá na
 * frente" — e ele já tinha clicado "reordenar por nome A-Z" antes de
 * reclamar, sem efeito nenhum, porque a galeria JÁ estava nessa ordem desde
 * o envio. A causa mora em `lib/ordem-natural.ts` — o nome inteiro, com
 * extensão, faz o sufixo "-PB" vencer o "." da colorida na comparação. Este
 * teste é o mesmo defeito, mas pela AÇÃO do painel, e não só a função pura.
 */
await etapa("a colorida vem antes da sua variante em preto-e-branco", async () => {
  const pb = await criarSecao(g.id, g.estudio.id, "PB");
  await por(pb.id, "sirius-jugusw-1070-pb.jpg", D("2026-09-15T13:01:00Z"), null);
  await por(pb.id, "sirius-jugusw-1070.jpg", D("2026-09-15T13:00:00Z"), null);

  await ordenarFotosDaSecao(g.id, g.estudio.id, pb.id, "nome");
  const lida = await ordemAgora(pb.id);
  const esperada = ["sirius-jugusw-1070.jpg", "sirius-jugusw-1070-pb.jpg"];
  if (lida.join() !== esperada.join()) {
    throw new Error(`veio ${lida.join(", ")} — a PB saiu antes da colorida`);
  }
  return lida.join(" · ");
});

await etapa("nome Z → A", async () => {
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome-invertido");
  const lida = await ordemAgora(cerimonia.id);
  const esperada = ["foto_10.jpg", "foto_2.jpg", "DSC_0001.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  return lida.join(" · ");
});

/**
 * ── O EMPATE (25/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "as fotos não estão ficando em ordem de A-Z. A foto seguinte tem que
 * estar logo depois da foto anterior."
 *
 * Duas fotos com o MESMO nome empatam no `Intl.Collator` — e elas existem: a
 * entrega da Júlia tinha `sirius-jugusw-1070.jpg` duas vezes, que é a razão de
 * o zip precisar do `nomeUnico` e a tela precisar do `AvisoDeRepetidas`. O
 * `sort` do JavaScript é estável, então o par sai na ordem em que ENTROU, e a
 * consulta não pedia ordem nenhuma: sem `order by`, quem decide é o PLANO.
 *
 * ── COMO A ARMADILHA É ARMADA, E POR QUE ASSIM ────────────────────────────
 *
 * A primeira versão desta etapa inseria o par ao contrário no disco e passou
 * COM o defeito: existe `idx_medias_galeria on medias(galeria_id, ordem)`, o
 * plano varreu o índice e devolveu na ordem certa por sorte. Sorte não é
 * contrato — numa galeria de 4.577 fotos o mesmo `where` vira varredura da
 * tabela, e aí a ordem é a do disco.
 *
 * Então o par empata também em `ordem`, e o índice deixa de desempatar. Isso
 * não é caso de laboratório: é o estrago do defeito de 18/09 (migração 038),
 * quando vários arquivos liam o mesmo `max(ordem)` e nasciam na mesma posição.
 * As galerias que o Juan subiu antes daquele dia ainda têm essas linhas.
 */
await etapa("duas fotos de MESMO nome saem na ordem do envio, não na do disco", async () => {
  const empate = await criarSecao(g.id, g.estudio.id, "Empate");
  const poe = async (marca, envio) =>
    (
      await db.query(
        `insert into medias (galeria_id, tenant_id, secao_id, chave, nome_original, tipo, mime,
                             bytes, ordem, pronto, criado_em)
         values ($1,$2,$3,$4,'sirius-jugusw-1070.jpg','foto','image/jpeg',1000,7,true,$5)
         returning id`,
        [g.id, g.estudio.id, empate.id, `x/${g.id}/empate-${marca}.jpg`, envio],
      )
    ).rows[0].id;

  /* A SEGUNDA do envio entra primeiro no disco — é o que a etapa precisa ter
     para morder, e é o que o banco devolve quando ninguém pede ordem. */
  const segunda = await poe("b", D("2026-09-15T12:01:00Z"));
  const primeira = await poe("a", D("2026-09-15T12:00:00Z"));

  const cru = (
    await db.query("select id from medias where galeria_id = $1 and secao_id = $2", [g.id, empate.id])
  ).rows.map((r) => r.id);
  if (cru[0] !== segunda) {
    throw new Error(
      "a armadilha não armou: sem pedir ordem, o banco já devolveu a certa — " +
        "a etapa passaria com defeito e tudo, que é o erro que ela existe para não repetir",
    );
  }

  await ordenarFotosDaSecao(g.id, g.estudio.id, empate.id, "nome");
  const lida = (
    await db.query("select id from medias where secao_id = $1 order by ordem, criado_em", [
      empate.id,
    ])
  ).rows.map((r) => r.id);

  if (lida[0] !== primeira) {
    throw new Error("o empate saiu na ordem do disco: a cópia que subiu depois foi para a frente");
  }
  return "o par de mesmo nome manteve a sequência do envio";
});

await etapa("cronológica usa a data da CÂMERA, não a do envio", async () => {
  const r = await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "cronologica");
  const lida = await ordemAgora(cerimonia.id);
  /* Pelo envio seria foto_10, foto_2, DSC_0001. Pela câmera é outra coisa — e é
     essa diferença que o recurso existe para resolver. */
  const esperada = ["foto_2.jpg", "DSC_0001.jpg", "foto_10.jpg"];
  if (lida.join() !== esperada.join()) throw new Error(`veio ${lida.join(", ")}`);
  if (r.semData !== 0) throw new Error(`disse que ${r.semData} estavam sem data`);
  return lida.join(" · ");
});

await etapa("foto sem data da câmera cai no envio, e a tela é avisada", async () => {
  /* Toda foto enviada antes da migração 035 está assim, e vídeo nunca terá. */
  await por(cerimonia.id, "sem_exif.jpg", D("2026-09-15T10:03:00Z"), null);
  const r = await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "cronologica");
  if (r.semData !== 1) throw new Error(`contou ${r.semData} sem data, esperava 1`);
  if (r.quantas !== 4) throw new Error(`ordenou ${r.quantas}`);
  const lida = await ordemAgora(cerimonia.id);
  if (lida.length !== 4) throw new Error("perdeu foto no caminho");
  return `${r.semData} de ${r.quantas} pela data de envio`;
});

await etapa("ordenar um capítulo não mexe no outro", async () => {
  const antes = await ordemAgora(festa.id);
  await ordenarFotosDaSecao(g.id, g.estudio.id, cerimonia.id, "nome");
  const depois = await ordemAgora(festa.id);
  if (antes.join() !== depois.join()) throw new Error(`a Festa virou ${depois.join(", ")}`);
  return "Festa intacta";
});

await etapa("a galeria continua agrupando por capítulo depois de renumerar", async () => {
  /* A renumeração põe as fotos de cada capítulo em 0..N-1, então os números se
     repetem entre capítulos. A galeria pública ordena por CAPÍTULO antes de
     `ordem` — se essa consulta mudar, a entrega embaralha e este passo cai. */
  const { listarMediasPublicas } = await import("../src/lib/galerias-publicas.ts");
  const todas = await listarMediasPublicas(g.id);
  const secoes = todas.map((m) => m.secao_id);
  const blocos = secoes.filter((s, i) => i === 0 || s !== secoes[i - 1]);
  if (new Set(blocos).size !== blocos.length) {
    throw new Error("as fotos de um capítulo apareceram em dois blocos separados");
  }
  return `${blocos.length} blocos, um por capítulo`;
});

/*
 * ── A DATA PRECISA CHEGAR AO BANCO ────────────────────────────────────────
 *
 * As etapas acima provam a ORDENAÇÃO com `tirada_em` já gravado. Faltava a
 * outra metade: o caminho do navegador até a coluna.
 *
 * Ela quase não existiu. O envio lia a data do EXIF e não a punha no corpo do
 * pedido — o `lerAparencia` do lint acusou um `tiradaEm` calculado e nunca
 * usado. O efeito seria silencioso e caro: a coluna ficaria NULA em tudo, a
 * ordem cronológica cairia na de envio para todas as fotos, e a tela avisaria
 * "600 de 600 sem data da câmera" sem ninguém entender por quê.
 *
 * Por isso o teste olha os DOIS lados do fio, e não só a ponta que ele
 * exercita: o cliente tem de mandar, e a rota tem de gravar.
 */
await etapa("o envio manda a data do EXIF no pedido", async () => {
  const fs = await import("node:fs/promises");
  const envio = await fs.readFile("src/components/envio-em-curso.tsx", "utf8");
  if (!/tiradaEm:\s*tiradaEm\?\.toISOString\(\)/.test(envio)) {
    throw new Error("o corpo do /upload não leva `tiradaEm` — a coluna ficaria nula em tudo");
  }
  if (!/dataDaFoto\(tarefa\.arquivo\)/.test(envio)) {
    throw new Error("o envio não lê mais o EXIF");
  }
  return "lido e enviado";
});

await etapa("a rota grava a data, e recusa texto inválido", async () => {
  const fs = await import("node:fs/promises");
  const rota = await fs.readFile("src/app/api/galerias/[id]/upload/route.ts", "utf8");
  if (!/tiradaEm:\s*dataValida\(corpo\.tiradaEm\)/.test(rota)) {
    throw new Error("a rota não passa a data para `criarMediaPendente`");
  }
  const medias = await fs.readFile("src/lib/medias.ts", "utf8");
  if (!/tirada_em/.test(medias)) throw new Error("o insert não tem a coluna");
  return "gravada pela rota";
});

await etapa("a coluna aceita a data e devolve o que recebeu", async () => {
  /* Ida e volta pelo banco: fuso, tipo e precisão. Um `timestamptz` lido como
     texto ou um `Date` inválido apareceriam aqui, e não na tela do fotógrafo. */
  const { criarMediaPendente } = await import("../src/lib/medias.ts");
  const quando = new Date("2026-09-14T18:32:07.000Z");
  const m = await criarMediaPendente({
    galeriaId: g.id,
    tenantId: g.estudio.id,
    chave: `x/${g.id}/exif.jpg`,
    nomeOriginal: "exif.jpg",
    tipo: "foto",
    mime: "image/jpeg",
    bytes: 1000,
    tiradaEm: quando,
  });
  try {
    const { rows } = await db.query("select tirada_em from medias where id = $1", [m.id]);
    if (!rows[0].tirada_em) throw new Error("gravou nulo");
    if (rows[0].tirada_em.getTime() !== quando.getTime()) {
      throw new Error(`voltou ${rows[0].tirada_em.toISOString()}`);
    }
    return quando.toISOString();
  } finally {
    await db.query("delete from medias where id = $1", [m.id]);
  }
});

await etapa("galeria de outro estúdio é recusada", async () => {
  const r = await ordenarFotosDaSecao(g.id, "00000000-0000-0000-0000-000000000000", cerimonia.id, "nome");
  if (r.ok) throw new Error("ordenou a galeria alheia");
  return "recusado";
});

/*
 * ── O CONTROLE PRECISA ESTAR NA TELA, E NÃO SÓ FUNCIONAR (17/09/2026) ─────
 *
 * Felipe, olhando uma galeria com seis capítulos: "a opção ordenar ficou só em
 * um capítulo". Estava certo — o `select` sumia com menos de duas fotos.
 *
 * O argumento de esconder era razoável sobre a AÇÃO (ordenar zero fotos não faz
 * nada) e errado sobre a TELA, por dois motivos:
 *
 *   1. capítulo nasce vazio. O caminho normal é criar Making Of, Cerimônia e
 *      Festa e só DEPOIS mandar as fotos — na hora de conhecer a tela o recurso
 *      não está lá, e quem não o viu no começo não o procura depois.
 *   2. a linha some, o espaço não: sem o select, os botões escorregam para a
 *      esquerda e nenhuma coluna bate com a de cima.
 *
 * Por isso a etapa vai ao HTML do painel em vez de conferir a ação: o defeito
 * era de presença, e presença não se prova chamando função.
 */
await etapa("o ordenar aparece em TODO capítulo, apagado quando não há o que ordenar", async () => {
  /* Um capítulo CLARAMENTE vazio, criado aqui: os outros dois trocaram de mãos
     ao longo do arquivo e o total deles não é contrato desta etapa. */
  const vazioDeVerdade = await criarSecao(g.id, g.estudio.id, "Recepção");
  const { rows: contagem } = await db.query(
    `select s.nome, count(m.id)::int total
       from secoes s left join medias m on m.secao_id = s.id
      where s.galeria_id = $1 group by s.nome order by s.nome`,
    [g.id],
  );
  const cheia = contagem.find((c) => c.total >= 2);
  if (!cheia) throw new Error(`nenhum capítulo com 2+ fotos: ${JSON.stringify(contagem)}`);

  const cookie = cookieDeSessao(g.tenant_id);
  const html = await (
    await fetch(`${BASE}/painel/galerias/${g.id}/fotos`, { headers: { cookie }, cache: "no-store" })
  ).text();

  /* A âncora é o `aria-label`, que nomeia o capítulo: é o que liga cada select
     à sua linha sem depender da ordem em que eles saem no HTML. */
  const tagDoSelect = (nome) =>
    html.match(new RegExp(`<select[^>]*aria-label="Ordenar as fotos de ${nome}"[^>]*>`))?.[0] ?? null;

  const cheio = tagDoSelect(cheia.nome);
  const vazio = tagDoSelect("Recepção");

  if (!cheio) throw new Error("o capítulo COM fotos não tem o menu de ordenar");
  if (!vazio) {
    throw new Error(
      "o capítulo VAZIO não tem o menu de ordenar — é o defeito de 17/09/2026: " +
        "some justamente de quem ainda vai receber fotos, e torce a lista inteira",
    );
  }
  /*
   * O ATRIBUTO, não a palavra: a classe do select tem `disabled:opacity-50`, e
   * um `\bdisabled\b` casa com ela — `\b` trata `:` como fronteira. A primeira
   * versão desta etapa reprovou o capítulo CHEIO por isso, acusando um defeito
   * que era da expressão regular.
   */
  const apagado = (tag) => /\sdisabled(=|\s|>|$)/.test(tag);
  if (apagado(cheio)) throw new Error(`o capítulo com fotos veio apagado: ${cheio.slice(0, 120)}`);
  if (!apagado(vazio)) {
    throw new Error("o capítulo vazio veio com o menu ativo — ordenar zero fotos não faz nada");
  }
  void vazioDeVerdade;
  return `"${cheia.nome}" (${cheia.total} fotos) ativo, "Recepção" (0) apagado`;
});

/**
 * ── SEM CAPÍTULO, O A-Z TEM DE ESTAR ESCRITO NA TELA (25/09/2026) ─────────
 *
 * Esta é a TERCEIRA vez que o mesmo controle some da vista do Juan:
 *
 *   18/09  "não tem botão pra reorganizar a ordem das fotos. Essa opção só
 *           aparece quando tem capítulos" — a lista inteira vivia no `else`
 *           do "Nenhum capítulo ainda".
 *   23/09  "quando tá sem capítulo não tem onde reorganizar as fotos por nome
 *           A-Z" — a lista já aparecia, dentro de um cartão chamado
 *           "Capítulos", abaixo de uma caixa que anuncia que não há nenhum.
 *   25/09  "cade a opção de reorganizar as fotos por nome A-Z. Quando não tem
 *           capítulo" — o cartão já se chamava "Ordem das fotos", e o controle
 *           era um `select` cinza escrito "ordenar…", encostado na borda.
 *
 * Duas correções mexeram em ONDE ele mora, e nenhuma das duas teve teste — por
 * isso as duas puderam "passar" com o fotógrafo ainda sem achar nada. O que
 * este teste prende não é a existência da ação (as etapas acima já fazem
 * isso): é a PALAVRA na tela. "Nome A → Z" tem que estar legível sem abrir
 * menu nenhum, porque é literalmente o que ele procura.
 */
await etapa("sem capítulo, 'Nome A → Z' está escrito na tela, e não dentro de um menu", async () => {
  const solta = await galeriaDaRodada(db, { nome: "sem-capitulo", medias: 4, publicada: true });
  const cookie = cookieDeSessao(solta.tenant_id);
  const html = await (
    await fetch(`${BASE}/painel/galerias/${solta.id}/fotos`, {
      headers: { cookie },
      cache: "no-store",
    })
  ).text();

  if (!/<h2[^>]*>Ordem das fotos<\/h2>/.test(html)) {
    throw new Error("o cartão não se chama 'Ordem das fotos' — voltou a ser sobre capítulos");
  }

  /* Fora de `<option>`: dentro do menu fechado a palavra existe e não se lê,
     que era exatamente o defeito de 25/09. */
  const semOpcoes = html.replace(/<option\b[\s\S]*?<\/option>/g, "");
  for (const rotulo of ["Nome A → Z", "Nome Z → A", "Ordem de envio", "Data da foto"]) {
    if (!semOpcoes.includes(rotulo)) {
      throw new Error(`"${rotulo}" não aparece na tela fora de um <option> — só dentro do menu`);
    }
  }

  /* E clicável: de nada adianta estar escrito e vir apagado. */
  const botao = semOpcoes.match(/<button[^>]*>\s*Nome A → Z\s*<\/button>/);
  if (!botao) throw new Error("'Nome A → Z' está escrito, mas não é um botão");
  if (/\sdisabled(=|\s|>|$)/.test(botao[0])) {
    throw new Error("o botão 'Nome A → Z' veio apagado numa galeria com 4 fotos");
  }
  return "os quatro critérios legíveis, sem abrir menu";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a ordem das fotos tem problema" : "\n✓ ordem das fotos ok");
process.exit(falhou ? 1 : 0);
