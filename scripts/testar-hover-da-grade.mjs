#!/usr/bin/env node
/**
 * A BORDA QUE ACENDE AO PASSAR O PONTEIRO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-hover-da-grade.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O PEDIDO (05/09/2026) ─────────────────────────────────────────────────
 *
 * Juan, montando a galeria: "Senti falta de eu passar a seta aqui e a bordinha
 * ficar piscando pra mim conforme eu vou passando a seta".
 *
 * Ele estava na GRADE DO PAINEL, escolhendo fotos — não na galeria do cliente.
 * O que faltava era saber qual ladrilho está sob o cursor antes de clicar.
 * Havia reação ao ponteiro, mas era o par de botões capa/remover surgindo no
 * canto: em cima da foto, e não em volta dela. Quem varre a grade com o mouse
 * não acompanha um botão de 11 px aparecendo; acompanha a moldura.
 *
 * Este pedido foi dado como entregue em 05/09 e não estava. Por isso ele tem
 * arquivo próprio: o que se conta como feito precisa ser conferível.
 *
 * ── "PISCANDO" NÃO VIROU PISCA-PISCA ──────────────────────────────────────
 *
 * Uma borda que pulsa sozinha numa grade de 600 fotos é ruído, e ruído que não
 * se pode desligar. O que ele descreve — acompanhar a seta — é atendido por uma
 * moldura que ACENDE no ladrilho sob o ponteiro e apaga ao sair. O verbo dele é
 * de brilho, não de intermitência.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
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

const g = await galeriaDaRodada(db, { nome: "hover-grade", medias: 3 });
const cookie = cookieDeSessao(g.tenant_id);

const abaFotos = async () => {
  const r = await fetch(`${BASE}/painel/galerias/${g.id}/fotos`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`a aba fotos respondeu ${r.status}`);
  return r.text();
};

/** A moldura do ladrilho: a `div` que desenha a borda em volta da foto. */
const molduras = (html) =>
  html.match(/<div class="[^"]*aspect-\[4\/5\][^"]*"/g) ?? [];

console.log("A grade do painel:\n");

const html = await abaFotos();

await etapa("a grade desenha os ladrilhos", () => {
  const m = molduras(html);
  if (m.length === 0) throw new Error("não achei nenhuma moldura de foto na aba fotos");
  return `${m.length} ladrilhos`;
});

await etapa("a moldura acende quando o ponteiro passa", () => {
  const m = molduras(html);
  /* `group-hover` e não `hover`: quem recebe o ponteiro é o ladrilho inteiro
     (o `<li class="group">`), não só a moldura — passar por cima do nome do
     arquivo, embaixo da foto, também tem de acender. */
  const acendem = m.filter((d) => /group-hover:border-/.test(d));
  if (acendem.length === 0) {
    throw new Error("nenhuma moldura muda de borda no hover — é o pedido de 05/09");
  }
  if (acendem.length !== m.length) {
    throw new Error(`${acendem.length} de ${m.length} molduras acendem — sobrou ladrilho mudo`);
  }
  return `${acendem.length} de ${m.length}`;
});

await etapa("a foto marcada como capa continua se distinguindo", async () => {
  /* O hover não pode empatar com o destaque de selecionada: se os dois
     desenharem a mesma borda, varrer a grade com o mouse faz parecer que cada
     foto por onde a seta passa foi selecionada. */
  await db.query("update galerias set capa_media_id = $2 where id = $1", [g.id, g.midias[0].id]);
  const comCapa = await abaFotos();
  const m = molduras(comCapa);
  const selecionadas = m.filter((d) => /\bring-2\b/.test(d) && !/group-hover:ring/.test(d));
  const soHover = m.filter((d) => /group-hover:border-/.test(d) && !/\bring-2\b/.test(d));
  if (selecionadas.length === 0 && soHover.length === m.length) {
    /* Nenhuma selecionada nesta bancada é aceitável — o que não pode é o hover
       usar exatamente o mesmo desenho do selecionado. */
    return "sem seleção na bancada; hover e seleção usam desenhos diferentes";
  }
  for (const d of selecionadas) {
    if (/group-hover:border-acento\b/.test(d) && /border-acento\b/.test(d)) {
      throw new Error("hover e seleção pintam a mesma borda — varrer a grade parece selecionar");
    }
  }
  return `${selecionadas.length} com destaque próprio`;
});

await etapa("no celular a borda não fica presa depois do toque", async () => {
  /*
   * Toque não tem "sair de cima": num aparelho sem ponteiro, uma regra de hover
   * acende no toque e só apaga quando se toca em outro lugar — a pessoa fica com
   * uma foto marcada sem ter marcado nada.
   *
   * Quem resolve isso é o próprio Tailwind, que envolve as regras de hover em
   * `@media (hover: hover)`. Isto aqui confere o CSS COMPILADO, e não a intenção:
   * é a diferença entre "escrevi a classe certa" e "o navegador vai obedecer".
   */
  const folha = html.match(/href="([^"]+\.css[^"]*)"/)?.[1];
  if (!folha) throw new Error("não achei a folha de estilo da página");
  const css = await (await fetch(new URL(folha, BASE), { cache: "no-store" })).text();
  const regra = css.indexOf("group-hover\\:border-acento");
  if (regra === -1) throw new Error("a regra de hover não foi compilada para o CSS");
  /* A media query que vale é a que ABRE antes da regra, mais próxima dela. */
  const antes = css.slice(0, regra);
  const ultimaMedia = antes.lastIndexOf("@media");
  if (ultimaMedia === -1 || !/hover\s*:\s*hover/.test(antes.slice(ultimaMedia, ultimaMedia + 120))) {
    throw new Error("a regra de hover NÃO está dentro de @media (hover: hover)");
  }
  return "@media (hover: hover)";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a grade não responde ao ponteiro" : "\n✓ hover da grade ok");
process.exit(falhou ? 1 : 0);
