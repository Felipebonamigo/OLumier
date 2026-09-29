#!/usr/bin/env node
/**
 * Testa a FONTE e a COR das letrinhas da capa. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-letrinhas-da-capa.mjs
 *
 * ── DE ONDE VEIO (23/09/2026) ─────────────────────────────────────────────
 *
 * Juan, com a foto da capa "Danielle e Sérgio": "as fontes dessas outras
 * letrinhas não tem como trocar", e querem trocar. Felipe, logo em seguida:
 * "e a cor também".
 *
 * Medido no navegador antes de mexer, na capa jornal com `tipografia: bodoni`:
 * o título saía em Bodoni Moda e a sobrancelha, a data, a assinatura e o botão
 * saíam TODOS em `ui-monospace`. A causa era o `font-mono` escrito nas cinco
 * tags de `galeria-capa.tsx` — classe na própria tag ganha da fonte herdada do
 * corpo, então nem `tipografia` nem `fonteTexto` alcançavam nada disso.
 *
 * O que este teste prende:
 *   1. o padrão é `mono` — galeria entregue não muda de cara sozinha;
 *   2. `titulo` acompanha o eixo do título, e `texto` o do corpo;
 *   3. lixo no banco vira `mono`, e não uma capa sem fonte;
 *   4. a cor das letrinhas é lida, validada e NÃO vaza para o resto da galeria;
 *   5. os dez modelos continuam em `mono` — sem isso, toda galeria que hoje
 *      casa com um modelo pararia de casar, e o editor deixaria de dizer
 *      "no ar: Convite" para quem está em Convite.
 */
import {
  OPCOES,
  PRESETS,
  APARENCIA_PADRAO,
  FONTES_TITULO,
  FONTES_TEXTO,
  fonteDoDetalhe,
  lerAparencia,
  variaveisDoTema,
  presetEquivalente,
} from "../src/config/aparencia.ts";

import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
let falhou = false;
function etapa(nome, fn) {
  try {
    const detalhe = fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("o padrão não mexe em ninguém");

etapa("o eixo nasce em `mono`", () => {
  igual(APARENCIA_PADRAO.fonteDetalhe, "mono", "padrão");
});

/*
 * A prova de compatibilidade que importa. Este objeto é o que está gravado nas
 * galerias de antes de 23/09/2026: não existe `fonteDetalhe` nenhum ali.
 */
etapa("galeria gravada antes do eixo lê como `mono`", () => {
  const antiga = lerAparencia({ capa: "jornal", tema: "claro", tipografia: "bodoni" });
  igual(antiga.fonteDetalhe, "mono", "fonteDetalhe de galeria antiga");
  igual(fonteDoDetalhe(antiga), null, "fonte resolvida");
});

/* `null` é o contrato com o componente: significa "deixa a classe `font-mono`
   onde está". Devolver a pilha do mono aqui obrigaria a reescrevê-la igual, e
   duas cópias de uma pilha de fontes é uma para divergir. */
etapa("`mono` devolve null, e não uma pilha de fontes", () => {
  igual(fonteDoDetalhe(lerAparencia({ fonteDetalhe: "mono" })), null, "mono");
});

console.log("\nas letrinhas acompanham o eixo que a pessoa escolheu");

etapa("`titulo` acompanha a tipografia — em todas as famílias do catálogo", () => {
  for (const { id } of OPCOES.tipografia) {
    const a = lerAparencia({ tipografia: id, fonteDetalhe: "titulo" });
    igual(fonteDoDetalhe(a), FONTES_TITULO[id], `fonte de detalhe com título ${id}`);
  }
  return `${OPCOES.tipografia.length} famílias`;
});

etapa("`texto` acompanha a fonte do corpo, inclusive a do estúdio", () => {
  for (const { id } of OPCOES.fonteTexto) {
    const a = lerAparencia({ fonteTexto: id, fonteDetalhe: "texto" });
    igual(fonteDoDetalhe(a), FONTES_TEXTO[id], `fonte de detalhe com corpo ${id}`);
  }
  /* O caso que motivou o eixo `fonteTexto` lá atrás: título na fonte do
     estúdio. Aqui ele tem de chegar nas letrinhas também. */
  const propria = lerAparencia({ tipografia: "propria", fonteDetalhe: "titulo" });
  if (!fonteDoDetalhe(propria).includes("FonteDoEstudio")) {
    throw new Error("a fonte enviada pelo estúdio não chegou nas letrinhas");
  }
  return "padrão, própria e a do estúdio pelo título";
});

etapa("os três caminhos dão respostas DIFERENTES entre si", () => {
  /* Sem isto o teste passaria com um `fonteDoDetalhe` que devolvesse sempre a
     mesma coisa — que é exatamente o defeito que o eixo veio consertar. */
  const base = { tipografia: "bodoni", fonteTexto: "padrao" };
  const mono = fonteDoDetalhe(lerAparencia({ ...base, fonteDetalhe: "mono" }));
  const titulo = fonteDoDetalhe(lerAparencia({ ...base, fonteDetalhe: "titulo" }));
  const texto = fonteDoDetalhe(lerAparencia({ ...base, fonteDetalhe: "texto" }));
  if (mono === titulo || titulo === texto || mono === texto) {
    throw new Error(`dois caminhos deram a mesma fonte: ${mono} / ${titulo} / ${texto}`);
  }
  return `${titulo.split(",")[0]} ≠ ${texto.split(",")[0]}`;
});

console.log("\nlixo no banco não desenha capa quebrada");

etapa("valor desconhecido, número, nulo e objeto viram `mono`", () => {
  for (const lixo of ["arial", "", 7, null, {}, [], true, "MONO"]) {
    const a = lerAparencia({ fonteDetalhe: lixo });
    igual(a.fonteDetalhe, "mono", `fonteDetalhe com ${JSON.stringify(lixo)}`);
  }
  return "8 entradas";
});

console.log("\na cor das letrinhas");

etapa("um #rrggbb é aceito", () => {
  const a = lerAparencia({ cores: { detalhe: "#b45733" } });
  igual(a.cores?.detalhe, "#b45733", "cor de detalhe");
});

etapa("MAIÚSCULA vira minúscula, e o resto é recusado", () => {
  igual(lerAparencia({ cores: { detalhe: "#B45733" } }).cores?.detalhe, "#b45733", "caixa");
  for (const lixo of ["red", "#fff", "#b4573", "rgb(1,2,3)", 5, null, "#gggggg"]) {
    const a = lerAparencia({ cores: { detalhe: lixo } });
    if (a.cores?.detalhe !== undefined) {
      throw new Error(`aceitou ${JSON.stringify(lixo)} como cor`);
    }
  }
  return "7 entradas recusadas";
});

/*
 * O TESTE QUE IMPEDE A COR DE VAZAR.
 *
 * `--g-suave` e `--g-tenue` pintam a galeria INTEIRA — legenda de foto, nome de
 * capítulo, rodapé, a barra de capítulos. A cor das letrinhas é da capa e de
 * mais nada; se ela escapasse para essas variáveis, escolher um tom para a data
 * repintaria a galeria toda, e ninguém teria pedido isso.
 */
etapa("a cor das letrinhas NÃO mexe nas variáveis do tema", () => {
  const sem = variaveisDoTema(lerAparencia({ tema: "claro" }));
  const com = variaveisDoTema(lerAparencia({ tema: "claro", cores: { detalhe: "#b45733" } }));
  for (const chave of Object.keys(sem)) {
    igual(com[chave], sem[chave], `${chave} mudou por causa da cor das letrinhas`);
  }
  if (Object.values(com).some((v) => String(v).includes("b45733"))) {
    throw new Error("a cor das letrinhas apareceu numa variável do tema");
  }
  return `${Object.keys(sem).length} variáveis intactas`;
});

etapa("as três cores da paleta continuam derivando o resto", () => {
  /* A cor das letrinhas não pode ter quebrado o que já existia: mexer no texto
     ainda tem de mover `--g-suave` e `--g-tenue` junto. */
  const a = variaveisDoTema(lerAparencia({ tema: "claro", cores: { texto: "#102030" } }));
  const b = variaveisDoTema(lerAparencia({ tema: "claro" }));
  if (a["--g-suave"] === b["--g-suave"] || a["--g-tenue"] === b["--g-tenue"]) {
    throw new Error("a cor do texto parou de derivar os tons suave e tênue");
  }
});

console.log("\na cor do título");

/*
 * Felipe, 28/09/2026: "o título de uma cor e o restante dos textos em um tom
 * mais escuro". A mesma natureza da cor das letrinhas: pinta o nome na capa e
 * mais nada.
 */
etapa("a cor do título é lida e validada como as outras", () => {
  igual(lerAparencia({ cores: { titulo: "#7A5C3E" } }).cores?.titulo, "#7a5c3e", "cor do título");
  for (const lixo of ["navy", "#abc", "#7a5c3", "url(x)", 0, null]) {
    if (lerAparencia({ cores: { titulo: lixo } }).cores?.titulo !== undefined) {
      throw new Error(`aceitou ${JSON.stringify(lixo)} como cor do título`);
    }
  }
});

etapa("a cor do título NÃO mexe nas variáveis do tema", () => {
  /* O texto continua escuro enquanto o título muda: é esse o pedido. Se a cor
     do título entrasse na derivação, o texto mudaria junto. */
  const sem = variaveisDoTema(lerAparencia({ tema: "claro", cores: { texto: "#1f1f1f" } }));
  const com = variaveisDoTema(
    lerAparencia({ tema: "claro", cores: { texto: "#1f1f1f", titulo: "#7a5c3e" } }),
  );
  for (const chave of Object.keys(sem)) igual(com[chave], sem[chave], `${chave} mudou por causa da cor do título`);
});

etapa("a capa pinta o NOME com ela, e só quando ela existe", () => {
  const capa = readFileSync(path.join(RAIZ, "src/components/galeria-capa.tsx"), "utf8");
  /* `TagDoTitulo` é o `<h1>` da galeria (um `<p>` só quando a capa é
     ilustração na home) — o elemento que carrega o nome, nos dois casos. */
  const h1 = capa.slice(capa.indexOf("<TagDoTitulo"), capa.indexOf("</TagDoTitulo>"));
  if (!h1 || !/corTitulo \? \{ color: corTitulo \}/.test(h1)) {
    throw new Error("o título da capa não usa a cor do título");
  }
  if (!/const corTitulo = aparencia\.cores\?\.titulo/.test(capa)) {
    throw new Error("a capa não lê `cores.titulo`");
  }
});

console.log("\nos modelos prontos");

/*
 * Se um modelo saísse de `mono`, toda galeria que hoje casa com ele pararia de
 * casar — porque a galeria gravada lê `mono` pelo padrão — e o editor deixaria
 * de dizer "no ar: Convite" para quem está em Convite.
 */
etapa("os dez modelos estão em `mono`, e continuam reconhecíveis", () => {
  for (const p of PRESETS) {
    igual(p.aparencia.fonteDetalhe, "mono", `modelo ${p.id}`);
    const gravada = lerAparencia(p.aparencia);
    igual(presetEquivalente(gravada), p.id, `modelo ${p.id} deixou de ser reconhecido`);
  }
  return `${PRESETS.length} modelos`;
});

etapa("a tela oferece as três opções, e `mono` é a primeira", () => {
  const ids = OPCOES.fonteDetalhe.map((o) => o.id);
  igual(ids.join(","), "mono,titulo,texto", "opções da tela");
  /* Cada opção precisa de nome e de explicação: a lista é lida por quem não
     sabe o que é "monoespaçada". */
  for (const o of OPCOES.fonteDetalhe) {
    if (!o.nome || !o.desc) throw new Error(`a opção ${o.id} está sem nome ou sem descrição`);
  }
});

console.log(falhou ? "\n✗ as letrinhas da capa têm problema\n" : "\n✓ letrinhas da capa ok\n");
process.exit(falhou ? 1 : 0);
