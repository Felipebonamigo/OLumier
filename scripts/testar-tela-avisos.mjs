#!/usr/bin/env node
/**
 * A tela do canal de avisos, em /painel/conta.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-tela-avisos.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * Por que existe: até aqui o canal de avisos só tinha rota. O estúdio mandava
 * coisa para fora e não havia onde OLHAR — nem para ver o destino, nem para
 * cortar. Uma tela que responde "quem está sendo avisado das minhas entregas?"
 * é, por definição, uma tela que mostra o canal; o passo que importa é o que
 * ela NÃO mostra.
 *
 * A trava principal aqui é o SEGREDO. A página existe para exibir o canal, e o
 * segredo mora na mesma tabela, a uma coluna de distância. Quem mexer nesta
 * tela um dia — para acrescentar um campo, para depurar — passa a um `select *`
 * de distância de imprimi-lo no HTML. Este teste procura o segredo em claro no
 * corpo da resposta, e é a única coisa aqui que separa "tela útil" de
 * "vazamento com carimbo de recurso".
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { estudioDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { registrarCanal, estadoDoCanal } from "../src/lib/avisos.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const estudio = await estudioDaRodada(db);
const vizinho = await segundoEstudioDaRodada(db);

/* Um segredo com cara própria e improvável: procurar por "segredo" no HTML daria
 * falso positivo em qualquer texto da página que use a palavra. */
const SEGREDO = `sO-sEgReDo-DeStE-tEsTe-${Date.now().toString(36)}-nao-pode-aparecer`;
const DESTINO = "https://atomatiza.exemplo.com.br/api/galeria/aviso";

const conta = (cookie) => fetch(`${BASE}/painel/conta`, { headers: { cookie }, redirect: "manual" });

console.log("\nA tela do canal de avisos\n");

await etapa("sem canal, a seção não aparece — recurso que não existe não vira ruído", async () => {
  const r = await conta(cookieDeSessao(estudio.id));
  igual(r.status, 200, "status");
  const html = await r.text();
  if (html.includes("Avisos de entrega")) throw new Error("a seção apareceu sem canal registrado");
  return "página abre normal, sem a seção";
});

await registrarCanal(estudio.id, DESTINO, SEGREDO);

await etapa("com canal, a seção mostra para ONDE está avisando", async () => {
  const html = await (await conta(cookieDeSessao(estudio.id))).text();
  if (!html.includes("Avisos de entrega")) throw new Error("a seção não apareceu");
  if (!html.includes("atomatiza.exemplo.com.br")) throw new Error("não mostrou o destino");
  return "destino na tela";
});

await etapa("O SEGREDO NÃO APARECE NO HTML — a trava desta tela", async () => {
  const html = await (await conta(cookieDeSessao(estudio.id))).text();
  if (html.includes(SEGREDO)) throw new Error("O SEGREDO DO CANAL VAZOU NO HTML DA PÁGINA");
  /* O cifrado também não: ele não abre sozinho, mas é material para quem
   * estiver juntando peças, e não tem por que estar numa página. */
  const { rows } = await db.query("select segredo from avisos where tenant_id = $1", [estudio.id]);
  if (html.includes(rows[0].segredo)) throw new Error("o segredo CIFRADO apareceu no HTML");
  return "nem em claro, nem cifrado";
});

await etapa("o canal de um estúdio não aparece no painel do outro", async () => {
  const html = await (await conta(cookieDeSessao(vizinho.id))).text();
  if (html.includes("Avisos de entrega")) throw new Error("o vizinho viu uma seção que não é dele");
  if (html.includes("atomatiza.exemplo.com.br")) throw new Error("o destino do outro vazou");
  return "o vizinho não vê nada";
});

await etapa("a falha registrada aparece, com o recado de que nada se perdeu", async () => {
  await db.query("update avisos set ultimo_erro = $2 where tenant_id = $1", [
    estudio.id, "502 do destino",
  ]);
  const html = await (await conta(cookieDeSessao(estudio.id))).text();
  if (!html.includes("502 do destino")) throw new Error("não mostrou a falha");
  if (!html.includes("Conferir")) throw new Error("não disse que o botão Conferir resolve");
  return "falha visível e sem susto";
});

await etapa("desligar apaga a linha, e a seção some", async () => {
  /* A ação de servidor não é chamável por fetch daqui — o que dá para provar
   * sem navegador é o efeito dela, que é o `removerCanal` do mesmo módulo. */
  const { removerCanal } = await import("../src/lib/avisos.ts");
  await removerCanal(estudio.id);
  igual(await estadoDoCanal(estudio.id), null, "estado depois de desligar");
  const html = await (await conta(cookieDeSessao(estudio.id))).text();
  if (html.includes("Avisos de entrega")) throw new Error("a seção continuou na tela");
  return "linha apagada e seção fora";
});

await etapa("estadoDoCanal nunca devolve o segredo, nem como campo escondido", async () => {
  await registrarCanal(estudio.id, DESTINO, SEGREDO);
  const estado = await estadoDoCanal(estudio.id);
  const texto = JSON.stringify(estado);
  if (texto.includes(SEGREDO)) throw new Error("o segredo saiu em estadoDoCanal");
  if ("segredo" in estado) throw new Error("estadoDoCanal tem campo `segredo`");
  return `campos: ${Object.keys(estado).join(", ")}`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ tela do canal de avisos com falha\n" : "\n✓ tela do canal de avisos ok\n");
process.exit(falhou ? 1 : 0);
