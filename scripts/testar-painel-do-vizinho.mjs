#!/usr/bin/env node
/**
 * O painel de um estúdio não mexe na galeria do outro. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-painel-do-vizinho.mjs
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
 *
 * Review do painel pedido em 11/09/2026. A varredura estática saiu limpa — as
 * 36 ações de `app/painel/actions.ts` pedem `exigirTenant` E usam o tenant
 * depois —, e é justamente por isso que ela não basta: ela prova que o id foi
 * PASSADO, não que alguém o usou num `where`. Uma função que recebe `tenantId`
 * e esquece de filtrar por ele passa em qualquer leitura de código.
 *
 * Aqui a pergunta é feita do outro lado: com o tenant do VIZINHO na mão, cada
 * operação destrutiva do painel é chamada contra a galeria alheia, e o que se
 * confere é que nada mudou. É a régua que o produto inteiro apoia — um furo
 * aqui é um fotógrafo apagando, publicando ou renomeando a entrega de outro.
 *
 * As operações escolhidas são as que doem: apagar, arquivar, trocar endereço
 * (que mata o link já entregue ao casal), publicar, mexer em capítulo e ligar
 * reconhecimento facial na galeria dos outros.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

import { apagarGaleria, restaurarGaleria } from "../src/lib/tenants.ts";
import { arquivarAgora, reativar, definirPrazo } from "../src/lib/cofre.ts";
import { trocarEnderecoDaGaleria } from "../src/lib/endereco-galeria.ts";
import { criarSecao, renomearSecao, apagarSecao, listarSecoes } from "../src/lib/secoes.ts";
import { gravarRascunho, publicarAparencia } from "../src/lib/aparencia-galeria.ts";
import { ligarRostos, desligarRostos } from "../src/lib/rostos.ts";

let falhou = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* A galeria de quem trabalha aqui. */
const minha = await galeriaDaRodada(db, { nome: "vizinho", medias: 2, publicada: true });

/* O intruso: um estúdio completo, criado à mão para não depender da fixture —
   ela guarda UM estúdio por execução, e este teste precisa de dois. */
const marca = `intruso-${Date.now()}`;
const { rows: intrusos } = await db.query(
  `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
        values ($1, 'Estúdio Intruso', $2, 'x', 1000000, 'ativo') returning id`,
  [marca, `${marca}@exemplo.com`],
);
const INTRUSO = intrusos[0].id;

/** O estado da galeria que precisa sobreviver a tudo. */
const estado = async () => {
  const { rows } = await db.query(
    `select slug, estado, publicada, apagada_em, expira_em, rostos_ativos,
            aparencia, aparencia_rascunho
       from galerias where id = $1`,
    [minha.id],
  );
  return JSON.stringify(rows[0]);
};

try {
  console.log("Com o tenant do vizinho, contra a galeria alheia\n");

  const secao = await criarSecao(minha.id, minha.estudio.id, "Cerimônia");
  const antes = await estado();
  const secoesAntes = JSON.stringify(await listarSecoes(minha.id));

  /* Cada linha é uma operação do painel chamada com o tenant ERRADO. Nenhuma
     pode lançar: o certo é não fazer nada, em silêncio — quem tenta mexer na
     galeria alheia não merece nem a confirmação de que ela existe. */
  const tentativas = [
    ["apagar a galeria", () => apagarGaleria(INTRUSO, minha.id, null)],
    ["restaurar da lixeira", () => restaurarGaleria(INTRUSO, minha.id, null)],
    ["arquivar no cofre", () => arquivarAgora(minha.id, INTRUSO)],
    ["reativar do cofre", () => reativar(minha.id, INTRUSO)],
    ["trocar o endereço", () => trocarEnderecoDaGaleria(minha.id, INTRUSO, "roubado")],
    ["definir prazo", () => definirPrazo(minha.id, INTRUSO, 6)],
    ["renomear capítulo", () => renomearSecao(secao.id, INTRUSO, "Invadido")],
    ["apagar capítulo", () => apagarSecao(secao.id, INTRUSO)],
    ["gravar rascunho de aparência", () => gravarRascunho(minha.id, INTRUSO, { tema: "noite" })],
    ["publicar aparência", () => publicarAparencia(minha.id, INTRUSO, { tema: "noite" })],
    ["ligar busca por rosto", () => ligarRostos(minha.id, INTRUSO)],
    ["desligar busca por rosto", () => desligarRostos(minha.id, INTRUSO)],
  ];

  for (const [nome, agir] of tentativas) {
    let estourou = null;
    try {
      await agir();
    } catch (e) {
      estourou = e.message;
    }
    const depois = await estado();
    const secoesDepois = JSON.stringify(await listarSecoes(minha.id));

    if (depois !== antes) {
      erro(`${nome}: A GALERIA MUDOU — ${depois}`);
    } else if (secoesDepois !== secoesAntes) {
      erro(`${nome}: os capítulos mudaram — ${secoesDepois}`);
    } else if (estourou) {
      /* Estourar também não serve: a ação do painel devolveria erro 500 em vez
         de simplesmente não fazer nada, e o intruso descobriria que acertou o
         id de uma galeria que existe. */
      erro(`${nome}: estourou em vez de ignorar — ${estourou}`);
    } else {
      ok(`${nome} não faz nada`);
    }
  }

  /* E o dono continua conseguindo — senão o teste acima passaria com uma
     galeria simplesmente quebrada. */
  const r = await renomearSecao(secao.id, minha.estudio.id, "Cerimônia renomeada");
  const nomes = (await listarSecoes(minha.id)).map((s) => s.nome);
  if (nomes.includes("Cerimônia renomeada")) ok("e o DONO continua conseguindo renomear");
  else erro(`o dono não conseguiu renomear (${JSON.stringify(r)}): ${nomes.join(", ")}`);
} finally {
  await db.query("delete from tenants where id = $1", [INTRUSO]);
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ o painel deixa mexer na galeria do vizinho");
  process.exit(1);
}
console.log("\n✓ o painel do vizinho não alcança esta galeria");
