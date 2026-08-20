#!/usr/bin/env node
/**
 * Testa a decisão "celular ou computador" e o comportamento do salvamento.
 * Uso: node scripts/testar-salvar-mobile.mjs
 *
 * Simula os navegadores reais (iPhone, Android, desktop) sem precisar de um
 * celular na mão. O que está em jogo: mostrar "Salvar no celular" para quem tem
 * o menu nativo, e "Baixar" para quem não tem — errar isso deixa o convidado
 * com a foto no app Arquivos, que é justamente a queixa do Sirius.
 */

const cenarios = [
  { nome: "iPhone (Safari)", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", toque: true, share: true, esperado: true },
  { nome: "Android (Chrome)", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", toque: true, share: true, esperado: true },
  { nome: "iPad", ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", toque: true, share: true, esperado: true },
  { nome: "Desktop Chrome", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", toque: false, share: false, esperado: false },
  { nome: "Celular antigo sem Web Share", ua: "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36", toque: true, share: false, esperado: false },
  { nome: "Notebook com tela sensível", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", toque: true, share: true, esperado: false },
];

function montarAmbiente({ ua, toque, share }) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {
    userAgent: ua,
    canShare: share ? (dados) => Boolean(dados?.files?.length) : undefined,
    share: async () => {},
  } });
  globalThis.matchMedia = (q) => ({ matches: q.includes("coarse") ? toque : false });
  globalThis.File = class {
    constructor(partes, nome, opcoes) {
      this.name = nome;
      this.type = opcoes?.type ?? "";
    }
  };
  globalThis.Blob = class {};
}

const mod = await import("../src/lib/salvar-client.ts");

let falhou = false;
console.log("Decisão de interface por navegador:\n");
for (const c of cenarios) {
  montarAmbiente(c);
  const obtido = mod.deveOferecerSalvar();
  const ok = obtido === c.esperado;
  if (!ok) falhou = true;
  const rotulo = obtido ? "Salvar no celular" : "Baixar";
  console.log(`  ${ok ? "✓" : "✗"} ${c.nome.padEnd(30)} → "${rotulo}"`);
}

console.log("\nComportamento do salvamento:\n");

// Cancelar o menu não é erro
montarAmbiente(cenarios[0]);
globalThis.fetch = async () => ({ ok: true, blob: async () => ({ type: "image/jpeg" }) });
globalThis.navigator.share = async () => {
  const e = new Error("abortado");
  e.name = "AbortError";
  throw Object.assign(e, { constructor: DOMException });
};
globalThis.DOMException = class DOMException extends Error {};
globalThis.navigator.share = async () => {
  throw Object.assign(new globalThis.DOMException("cancelou"), { name: "AbortError" });
};
try {
  const r = await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }]);
  const ok = r === "cancelou";
  if (!ok) falhou = true;
  console.log(`  ${ok ? "✓" : "✗"} fechar o menu devolve "cancelou" (não vira erro na tela)`);
} catch {
  falhou = true;
  console.log("  ✗ fechar o menu virou exceção — apareceria mensagem vermelha ao cliente");
}

// Sem suporte devolve aviso em vez de quebrar
montarAmbiente(cenarios[3]);
const semSuporte = await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }]);
const okSem = semSuporte === "sem-suporte";
if (!okSem) falhou = true;
console.log(`  ${okSem ? "✓" : "✗"} navegador sem Web Share devolve "sem-suporte" (cai no download)`);

/*
 * iPhone recusando o menu por perda do "gesto do usuário".
 *
 * O Safari exige que share() seja chamado logo depois do toque, e baixar vinte
 * fotos numa rede de celular passa dessa janela. Não dá para segurar o gesto
 * durante um await — o que dá é reconhecer a recusa e cair no download comum,
 * em vez de estourar uma exceção que vira mensagem vermelha e deixa o casal sem
 * as fotos.
 */
montarAmbiente(cenarios[0]);
globalThis.fetch = async () => ({ ok: true, blob: async () => ({ type: "image/jpeg" }) });
globalThis.navigator.share = async () => {
  throw Object.assign(new globalThis.DOMException("sem gesto"), { name: "NotAllowedError" });
};
try {
  const r = await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }]);
  const ok = r === "expirou";
  if (!ok) falhou = true;
  console.log(`  ${ok ? "✓" : "✗"} iPhone recusando por gesto expirado devolve "expirou" (cai no download)`);
} catch {
  falhou = true;
  console.log('  ✗ "gesto expirado" virou exceção — o cliente veria erro e ficaria sem a foto');
}

/*
 * Arquivo inacessível — na prática, CORS.
 *
 * O endereço do estúdio (siriusfotografia.fotonio.com.br) é uma origem
 * diferente do domínio principal; se o bucket não autorizar, o fetch morre.
 * O download comum continua funcionando porque é navegação, não fetch.
 */
montarAmbiente(cenarios[0]);
globalThis.fetch = async () => {
  throw new TypeError("Failed to fetch");
};
const semAcesso = await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }]);
const okAcesso = semAcesso === "sem-acesso";
if (!okAcesso) falhou = true;
console.log(`  ${okAcesso ? "✓" : "✗"} arquivo bloqueado por CORS devolve "sem-acesso" (cai no download)`);

console.log("\nLotes por memória (o que impede o celular de travar):\n");

const MB = 1024 * 1024;
const arq = (nome, mb) => ({ url: `http://x/${nome}`, nome, bytes: mb * MB });

{
  const ok = (nome, cond) => {
    if (!cond) falhou = true;
    console.log(`  ${cond ? "✓" : "✗"} ${nome}`);
  };

  // 30 fotos de 8 MB = 240 MB: não pode ir tudo num lote só.
  const fotos = Array.from({ length: 30 }, (_, i) => arq(`f${i}.jpg`, 8));
  const r1 = mod.montarLotes(fotos);
  const maiorLote = Math.max(...r1.lotes.map((l) => l.reduce((s, a) => s + a.bytes, 0)));
  ok(
    `30 fotos de 8 MB viram ${r1.lotes.length} lotes, nenhum acima do orçamento`,
    r1.lotes.length > 1 && maiorLote <= mod.ORCAMENTO_LOTE,
  );
  ok(
    "nenhuma foto se perde no caminho",
    r1.lotes.flat().length + r1.grandes.length === fotos.length,
  );

  // O caso que derrubava o aparelho: um vídeo de casamento.
  const comVideo = [arq("a.jpg", 5), arq("filme.mp4", 5000), arq("b.jpg", 5)];
  const r2 = mod.montarLotes(comVideo);
  ok(
    "vídeo de 5 GB NÃO entra no menu nativo (iria inteiro para a memória)",
    r2.grandes.length === 1 && r2.grandes[0].nome === "filme.mp4",
  );
  ok(
    "as fotos ao lado do vídeo continuam indo pelo menu",
    r2.lotes.flat().length === 2,
  );

  // Um arquivo sozinho acima do orçamento não pode gerar lote vazio nem sumir.
  const r3 = mod.montarLotes([arq("grande.jpg", 120)]);
  ok(
    "arquivo entre o teto individual e o orçamento vira lote próprio",
    r3.grandes.length === 1 || (r3.lotes.length === 1 && r3.lotes[0].length === 1),
  );

  ok("lista vazia não gera lote vazio", mod.montarLotes([]).lotes.length === 0);
}

// Lote respeita o máximo
const okLote = mod.LOTE_MAXIMO > 0 && mod.LOTE_MAXIMO <= 30;
if (!okLote) falhou = true;
console.log(`  ${okLote ? "✓" : "✗"} lote de ${mod.LOTE_MAXIMO} fotos por vez (memória do celular)`);

if (falhou) {
  console.error("\n✗ a lógica de salvamento tem problema");
  process.exit(1);
}
console.log("\n✓ salvamento no celular decide certo em todos os navegadores testados");
