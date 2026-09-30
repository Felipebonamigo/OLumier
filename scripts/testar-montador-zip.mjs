#!/usr/bin/env node
/**
 * Testa a BUSCA À FRENTE do montador do servidor de ZIP. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs scripts/testar-montador-zip.mjs
 *
 * ── O DEFEITO (30/09/2026) ────────────────────────────────────────────────
 *
 * A busca à frente só ABRIA as próximas fotos: o pedido saía, os cabeçalhos
 * chegavam, e o corpo ficava parado até a vez dela. O ZIP descia do B2 uma
 * foto por vez — 326 KB/s montando contra 2,4 MB/s saindo do disco, na mesma
 * galeria de 527 MB, medido pelo Felipe.
 *
 * ── COMO ISTO PROVA, SEM RELÓGIO ──────────────────────────────────────────
 *
 * Medir tempo com um balde lento seria o teste óbvio, e é o errado: na
 * interface de rede local os buffers do TCP são grandes, o corpo "desce"
 * sozinho mesmo sem ninguém ler, e o defeito passaria. Aqui o `fetch` é
 * trocado por um que devolve corpos PREGUIÇOSOS (`highWaterMark: 0`): cada
 * pedaço só é produzido quando alguém lê. Uma foto só termina de descer se o
 * montador a LEU — que é exatamente a diferença entre abrir e baixar.
 */
process.env.ZIP_BUSCAS_PARALELAS = "3";

const { arquivosDoManifesto } = await import("../servidor-zip/montador.ts");
const { CONFIG } = await import("../servidor-zip/config.ts");

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
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const PEDACO = 1024;
const PEDACOS = 3;
const TAMANHO = PEDACO * PEDACOS;

/**
 * O balde de mentira. `planos[i]` diz o que a foto i faz na primeira busca:
 * "500" responde erro, "curto" manda um pedaço a menos. Da segunda em diante,
 * tudo certo.
 */
function balde({ tamanhos, planos = {} }) {
  const estado = { pedidos: new Map(), completos: new Set(), lidos: new Map() };
  const conteudo = (i) => {
    const b = new Uint8Array(tamanhos[i]);
    for (let k = 0; k < b.length; k++) b[k] = (i * 31 + k) % 251;
    return b;
  };
  globalThis.fetch = async (url) => {
    const i = Number(new URL(url).pathname.slice(1));
    const vez = (estado.pedidos.get(i) ?? 0) + 1;
    estado.pedidos.set(i, vez);
    const plano = vez === 1 ? planos[i] : undefined;
    if (plano === "500") return new Response("caiu", { status: 500 });
    const bytes = conteudo(i);
    const corte = plano === "curto" ? bytes.length - PEDACO : bytes.length;
    let pos = 0;
    const corpo = new ReadableStream(
      {
        pull(c) {
          if (pos >= corte) {
            if (vez === estado.pedidos.get(i)) estado.completos.add(i);
            c.close();
            return;
          }
          const fim = Math.min(corte, pos + PEDACO);
          c.enqueue(bytes.slice(pos, fim));
          estado.lidos.set(i, (estado.lidos.get(i) ?? 0) + (fim - pos));
          pos = fim;
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(corpo, { status: 200, headers: { "content-length": String(tamanhos[i]) } });
  };
  return { estado, conteudo };
}

function manifesto(tamanhos) {
  return {
    arquivos: tamanhos.map((t, i) => ({ nome: `foto-${i}.jpg`, tamanho: t, url: `http://balde/${i}` })),
  };
}
const semRenovar = { renovar: async () => { throw new Error("não devia renovar"); } };

console.log("\nmontador do ZIP — a busca à frente\n");

await etapa("a busca à frente BAIXA as próximas fotos, não só abre", async () => {
  const tamanhos = Array(6).fill(TAMANHO);
  const { estado } = balde({ tamanhos });
  const arquivos = arquivosDoManifesto(manifesto(tamanhos), semRenovar);
  const it = arquivos[0].abrir()[Symbol.asyncIterator]();
  await it.next(); // a foto 0 começou a sair
  await espera(50);
  const prontas = [1, 2, 3].filter((i) => estado.completos.has(i));
  if (prontas.length !== 3) {
    throw new Error(`das 3 à frente, só ${prontas.length} desceram inteiras (${[1, 2, 3].map((i) => `${i}: ${estado.lidos.get(i) ?? 0} B`).join(", ")})`);
  }
  if (estado.pedidos.has(4)) throw new Error("pediu além da janela de 3");
  await it.return?.();
  return "as 3 seguintes inteiras enquanto a primeira sai; a 5ª nem foi pedida";
});

await etapa("o teto de memória segura a janela (e a próxima vem sempre)", async () => {
  const antes = CONFIG.memoriaAFrente;
  CONFIG.memoriaAFrente = TAMANHO + TAMANHO / 2; // cabe uma e meia
  try {
    const tamanhos = Array(6).fill(TAMANHO);
    const { estado } = balde({ tamanhos });
    const arquivos = arquivosDoManifesto(manifesto(tamanhos), semRenovar);
    const it = arquivos[0].abrir()[Symbol.asyncIterator]();
    await it.next();
    await espera(50);
    if (!estado.completos.has(1)) throw new Error("a próxima não desceu");
    if (estado.pedidos.has(2)) throw new Error("passou do teto e pediu a terceira");
    await it.return?.();
    return "só a próxima, com o teto de 1,5 foto";
  } finally {
    CONFIG.memoriaAFrente = antes;
  }
});

await etapa("arquivo grande (vídeo) é só aberto à frente, e não conta no teto", async () => {
  const GRANDE = 70 * 1024 * 1024; // acima do teto em memória de 64 MB
  const tamanhos = [TAMANHO, GRANDE, TAMANHO, TAMANHO, TAMANHO];
  const { estado } = balde({ tamanhos });
  const arquivos = arquivosDoManifesto(manifesto(tamanhos), semRenovar);
  const it = arquivos[0].abrir()[Symbol.asyncIterator]();
  await it.next();
  await espera(50);
  if (!estado.pedidos.has(1)) throw new Error("o vídeo nem foi aberto");
  if ((estado.lidos.get(1) ?? 0) > 0) throw new Error(`leu ${estado.lidos.get(1)} B do vídeo antes da vez`);
  if (!estado.completos.has(2) || !estado.completos.has(3)) throw new Error("as fotos depois do vídeo não desceram");
  await it.return?.();
  return "aberto, 0 B lidos; as fotos depois dele desceram";
});

await etapa("o ZIP inteiro sai certo, com erro e corpo cortado na primeira busca", async () => {
  const tamanhos = Array(7).fill(TAMANHO);
  const { estado, conteudo } = balde({ tamanhos, planos: { 2: "500", 4: "curto" } });
  const arquivos = arquivosDoManifesto(manifesto(tamanhos), semRenovar);
  for (let i = 0; i < arquivos.length; i++) {
    const partes = [];
    for await (const p of arquivos[i].abrir()) partes.push(p);
    const veio = Buffer.concat(partes);
    if (!veio.equals(Buffer.from(conteudo(i)))) throw new Error(`a foto ${i} veio diferente (${veio.length} B)`);
  }
  if (estado.pedidos.get(2) !== 2) throw new Error(`a foto do 500 foi pedida ${estado.pedidos.get(2)} vez(es)`);
  if (estado.pedidos.get(4) !== 2) throw new Error(`a foto cortada foi pedida ${estado.pedidos.get(4)} vez(es)`);
  return "7 fotos byte a byte; o 500 e o corte ganharam nova tentativa";
});

console.log(falhou ? "\n✗ a busca à frente tem problema" : "\n✓ a montagem baixa à frente, com teto de memória");
process.exitCode = falhou ? 1 : 0;
