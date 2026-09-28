#!/usr/bin/env node
/**
 * Testa QUEM BAIXOU, quantas vezes cada foto, e a ordem "mais baixadas".
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-quem-baixou.mjs
 *
 * ── DE ONDE VEIO (23/09/2026) ─────────────────────────────────────────────
 *
 * Juan, com a foto da tela de Atividade do Pixieset: "gostaria de saber quem
 * está baixando. Quais fotos estão sendo baixadas. Existe alguma forma de fazer
 * isso?" A nossa tela mostrava "41 downloads" e mais nada.
 *
 * Felipe decidiu o preço disso para o convidado: "quando for baixar pedir nome
 * e email opcional, pelo menos um dos dois para baixar a primeira vez, e ai
 * contabiliza quem baixou e o numero de downloads de cada foto, fazer tambem
 * uma ordenação por mais baixadas".
 *
 * O que este teste prende:
 *   1. a pessoa pode ser só um nome, só um e-mail, ou os dois — e nunca nada;
 *   2. o mesmo nome (ou o mesmo e-mail) não abre uma pessoa nova a cada vez;
 *   3. quem baixa com o e-mail que já usou para favoritar é a MESMA pessoa;
 *   4. o download guarda quem, qual foto e quando;
 *   5. a lista não esconde download anônimo nem de foto apagada — senão ela
 *      discorda do contador que está logo acima dela na tela;
 *   6. a contagem por foto ignora o zip da galeria inteira;
 *   7. "mais baixadas" ordena por isso, e desempata por nome.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import {
  pessoaPorNomeOuEmail,
  pessoaPorEmail,
  comoChamar,
  alternarDaPessoa,
} from "../src/lib/favoritas.ts";
import {
  registrarAcesso,
  listarDownloads,
  downloadsPorFoto,
  resumoAcessos,
} from "../src/lib/galerias-publicas.ts";
import { ordenarFotosDaSecao } from "../src/lib/secoes.ts";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const g = await galeriaDaRodada(db, { nome: "quem-baixou", medias: 4, publicada: true });
const { rows: fotos } = await db.query(
  "select id, nome_original from medias where galeria_id = $1 order by ordem",
  [g.id],
);

try {
  console.log("quem é a pessoa");

  await etapa("só o nome basta", async () => {
    const p = await pessoaPorNomeOuEmail(g.id, { nome: "Tia Marta" });
    if (!p) throw new Error("recusou um nome");
    igual(p.email, null, "e-mail");
    igual(p.nome, "Tia Marta", "nome");
    igual(comoChamar(p), "Tia Marta", "como chamar");
  });

  await etapa("só o e-mail basta", async () => {
    const p = await pessoaPorNomeOuEmail(g.id, { email: "noiva@exemplo.test" });
    if (!p) throw new Error("recusou um e-mail");
    igual(p.email, "noiva@exemplo.test", "e-mail");
    igual(comoChamar(p), "noiva@exemplo.test", "como chamar sem nome");
  });

  await etapa("nem nome nem e-mail é recusado", async () => {
    for (const nada of [{}, { nome: "   " }, { email: "" }, { nome: null, email: null }]) {
      if (await pessoaPorNomeOuEmail(g.id, nada)) {
        throw new Error(`aceitou ${JSON.stringify(nada)}`);
      }
    }
    return "4 entradas";
  });

  /* O ponto do índice parcial da migração 040: "Tia Marta" baixando cinco fotos
     é UMA pessoa, e não cinco linhas na tela do fotógrafo. */
  await etapa("o mesmo nome é sempre a mesma pessoa", async () => {
    const a = await pessoaPorNomeOuEmail(g.id, { nome: "Tia Marta" });
    const b = await pessoaPorNomeOuEmail(g.id, { nome: "  tia marta  " });
    igual(b.id, a.id, "id da segunda vez");
    const { rows } = await db.query(
      "select count(*)::int as n from pessoas_da_galeria where galeria_id = $1 and email is null",
      [g.id],
    );
    igual(rows[0].n, 1, "linhas sem e-mail");
  });

  /*
   * A costura com as favoritas. Quem já se identificou para escolher uma foto
   * NÃO pode virar uma segunda pessoa ao baixar — o fotógrafo veria a noiva
   * duas vezes na mesma tela.
   */
  await etapa("quem favoritou e depois baixa é a mesma pessoa", async () => {
    const naFavorita = await pessoaPorEmail(g.id, "noiva@exemplo.test", "Noiva");
    await alternarDaPessoa(g.id, fotos[0].id, naFavorita.id);
    const noDownload = await pessoaPorNomeOuEmail(g.id, { email: "NOIVA@exemplo.test" });
    igual(noDownload.id, naFavorita.id, "id ao baixar");
    igual(noDownload.nome, "Noiva", "o nome dado antes não se perde");
  });

  console.log("\no download guarda quem, o quê e quando");

  const marta = await pessoaPorNomeOuEmail(g.id, { nome: "Tia Marta" });
  const noiva = await pessoaPorNomeOuEmail(g.id, { email: "noiva@exemplo.test" });

  await etapa("o registro sai com dono, foto e horário", async () => {
    await registrarAcesso({ galeriaId: g.id, mediaId: fotos[0].id, acao: "baixou", pessoaId: marta.id });
    const linhas = await listarDownloads(g.id);
    igual(linhas.length, 1, "linhas");
    igual(linhas[0].nome, "Tia Marta", "quem");
    igual(linhas[0].media_id, fotos[0].id, "qual foto");
    igual(linhas[0].nome_original, fotos[0].nome_original, "nome do arquivo");
    if (!(linhas[0].quando instanceof Date)) throw new Error("sem horário");
  });

  await etapa("a mais recente vem primeiro", async () => {
    await registrarAcesso({ galeriaId: g.id, mediaId: fotos[1].id, acao: "baixou", pessoaId: noiva.id });
    const linhas = await listarDownloads(g.id);
    igual(linhas[0].media_id, fotos[1].id, "primeira da lista");
  });

  /*
   * A LISTA NÃO PODE ESCONDER NADA — é o que a mantém coerente com o contador
   * de downloads logo acima dela na tela. Entre dois números nossos que
   * discordam, o fotógrafo acredita no menor e conclui que perdeu registro.
   */
  await etapa("download anônimo aparece, e não some", async () => {
    await registrarAcesso({ galeriaId: g.id, mediaId: fotos[2].id, acao: "baixou" });
    const linhas = await listarDownloads(g.id);
    const anonima = linhas.find((l) => l.media_id === fotos[2].id);
    if (!anonima) throw new Error("a linha sem dono sumiu da lista");
    igual(anonima.nome, null, "nome");
    igual(anonima.email, null, "e-mail");
  });

  await etapa("o zip da galeria inteira aparece, mesmo sem foto", async () => {
    await registrarAcesso({ galeriaId: g.id, acao: "baixou_tudo", pessoaId: noiva.id });
    const linhas = await listarDownloads(g.id);
    const zip = linhas.find((l) => l.acao === "baixou_tudo");
    if (!zip) throw new Error("o baixar-tudo sumiu da lista");
    igual(zip.media_id, null, "media_id do zip");
  });

  await etapa("a lista bate com o contador da tela", async () => {
    const resumo = await resumoAcessos(g.id);
    const linhas = await listarDownloads(g.id);
    igual(linhas.length, resumo.downloads, "linhas da lista vs contador");
    return `${linhas.length} de cada lado`;
  });

  await etapa("foto apagada não apaga o registro de quem a baixou", async () => {
    const antes = (await listarDownloads(g.id)).length;
    await db.query("delete from medias where id = $1", [fotos[2].id]);
    const linhas = await listarDownloads(g.id);
    igual(linhas.length, antes, "linhas depois de apagar a foto");
    const orfa = linhas.find((l) => l.media_id === null && l.acao === "baixou");
    if (!orfa) throw new Error("a linha da foto apagada sumiu");
    igual(orfa.nome_original, null, "nome do arquivo apagado");
  });

  console.log("\nquantas vezes cada foto");

  await etapa("conta por foto, e o zip fica de fora", async () => {
    /* Mais dois downloads da foto 1: ela passa a ser a mais baixada. */
    await registrarAcesso({ galeriaId: g.id, mediaId: fotos[1].id, acao: "baixou", pessoaId: marta.id });
    await registrarAcesso({ galeriaId: g.id, mediaId: fotos[1].id, acao: "baixou" });
    const mapa = await downloadsPorFoto(g.id);
    igual(mapa.get(fotos[1].id), 3, "downloads da foto 1");
    igual(mapa.get(fotos[0].id), 1, "downloads da foto 0");
    igual(mapa.get(fotos[3].id), undefined, "foto nunca baixada");
    /* O `baixou_tudo` não tem media_id, então não pode ter entrado em ninguém. */
    const soma = [...mapa.values()].reduce((a, b) => a + b, 0);
    igual(soma, 4, "soma das contagens por foto");
    return `${mapa.size} fotos com download`;
  });

  console.log("\na ordem 'mais baixadas'");

  await etapa("ordena pela contagem, da maior para a menor", async () => {
    const r = await ordenarFotosDaSecao(g.id, g.tenant_id, null, "mais-baixadas");
    if (!r.ok) throw new Error("a ordenação foi recusada");
    const { rows } = await db.query(
      "select id, ordem from medias where galeria_id = $1 order by ordem",
      [g.id],
    );
    igual(rows[0].id, fotos[1].id, "primeira (3 downloads)");
    igual(rows[1].id, fotos[0].id, "segunda (1 download)");
    return `${rows.length} fotos`;
  });

  /*
   * O desempate. Numa galeria recém-entregue TODAS têm zero downloads — sem
   * desempate a ordem viria do banco, que não promete nenhuma, e clicar em
   * "mais baixadas" embaralharia a galeria sem motivo.
   */
  await etapa("com todas empatadas em zero, o nome desempata", async () => {
    const g2 = await galeriaDaRodada(db, { nome: "sem-download", medias: 5, publicada: true });
    const { rows: originais } = await db.query(
      "select id, nome_original from medias where galeria_id = $1",
      [g2.id],
    );
    /*
     * ── O EMBARALHO É O QUE FAZ ESTE TESTE VALER ─────────────────────────
     *
     * A consulta de `ordenarFotosDaSecao` não tem `order by`: ela pega as
     * linhas na ordem em que o Postgres as tem, que é a de inserção — e a
     * fixture insere em ordem alfabética. Com a entrada já ordenada o teste
     * passava COM e SEM o desempate, porque `Array.sort` é estável e preservava
     * o que já estava certo. Conferido: tirando o `|| colador.compare(...)` de
     * `secoes.ts`, a primeira versão deste teste ficava verde.
     *
     * Renomear é o jeito que não depende de o Postgres mover linha: a primeira
     * inserida vira "z", a última vira "v". A ordem física passa a ser o
     * inverso do alfabeto, e só o desempate produz o alfabeto na saída.
     */
    const letras = ["z", "y", "x", "w", "v"];
    for (let i = 0; i < originais.length; i++) {
      await db.query("update medias set nome_original = $1 where id = $2", [
        `${letras[i] ?? `l${i}`}.jpg`,
        originais[i].id,
      ]);
    }

    await ordenarFotosDaSecao(g2.id, g2.tenant_id, null, "mais-baixadas");
    const { rows: a } = await db.query(
      "select nome_original from medias where galeria_id = $1 order by ordem",
      [g2.id],
    );
    await ordenarFotosDaSecao(g2.id, g2.tenant_id, null, "mais-baixadas");
    const { rows: b } = await db.query(
      "select nome_original from medias where galeria_id = $1 order by ordem",
      [g2.id],
    );
    const nomes = a.map((r) => r.nome_original);
    if (nomes.join() !== b.map((r) => r.nome_original).join()) {
      throw new Error("duas ordenações seguidas deram ordens diferentes");
    }
    const alfabetica = [...nomes].sort((x, y) => x.localeCompare(y));
    if (nomes.join() !== alfabetica.join()) {
      throw new Error(`empatadas não saíram por nome: ${nomes.join(", ")}`);
    }
    return `${nomes.length} empatadas, estáveis e por nome`;
  });

  await etapa("a galeria de outro estúdio não pode ser ordenada", async () => {
    const r = await ordenarFotosDaSecao(g.id, "00000000-0000-4000-8000-000000000000", null, "mais-baixadas");
    igual(r.ok, false, "ok");
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ quem baixou tem problema\n" : "\n✓ quem baixou ok\n");
process.exit(falhou ? 1 : 0);
