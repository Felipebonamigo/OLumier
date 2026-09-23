#!/usr/bin/env node
/**
 * Testa como as fotos saem da galeria para o celular. Uso:
 *   node --experimental-strip-types scripts/testar-salvar-mobile.mjs
 *
 * Simula os navegadores reais (iPhone, Android, computador) sem um celular na
 * mão. O que está em jogo: a foto terminar onde a pessoa procura — o app Fotos
 * no iPhone, a Galeria no Android — e a Atividade só contar o que saiu.
 *
 * ── O QUE MUDOU EM 16/09/2026, E POR QUÊ ──────────────────────────────────
 *
 * Uma pesquisa no código-fonte do Chromium e do WebKit desmontou três
 * premissas deste arquivo:
 *
 *   1. O Chrome do Android RECUSA `share()` com mais de 10 arquivos ou mais de
 *      50 MB (navigator_share.cc: kMaxSharedFileCount = 10), e recusa DEPOIS
 *      de gastar o toque. `canShare()` não confere nada disso. Nossos lotes
 *      eram de 40: no Android o menu nunca abriu — toda entrega caía no
 *      download um a um. E o menu do Android nem tem "salvar na galeria".
 *   2. A "partição ao meio" chamava `share()` duas vezes num toque só. A
 *      segunda é sempre recusada (a ativação já foi consumida, nos dois
 *      motores), e o lote inteiro caía no download de novo.
 *   3. O teste que prendia a partição simulava um navegador que não existe:
 *      `canShare` falso acima do teto e `share` que não gasta o toque.
 *
 * Daí o Android passar a BAIXAR (a foto vai para a pasta Download, que a
 * Galeria e o Google Fotos mostram), o iPhone continuar no menu com um toque
 * por lote, e a entrega inteira virar uma função pura com bancada.
 */

const cenarios = [
  { nome: "iPhone (Safari)", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", toque: true, share: true, pontos: 5, esperado: "menu" },
  { nome: "Android (Chrome)", ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", toque: true, share: true, pontos: 5, esperado: "download" },
  { nome: "iPad mini (UA de iPad)", ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", toque: true, share: true, pontos: 5, esperado: "menu" },
  /* iPadOS 13+ manda o MESMO user-agent do Safari do Mac (WebKit, 20/12/2019).
     O que denuncia o iPad é ter tela de toque. Antes caía no zip. */
  { nome: "iPad (UA de Mac)", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", toque: true, share: true, pontos: 5, esperado: "menu" },
  { nome: "Mac de verdade", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", toque: false, share: true, pontos: 0, esperado: "computador" },
  { nome: "Desktop Chrome", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", toque: false, share: false, pontos: 0, esperado: "computador" },
  /* Android antigo sem Web Share: baixar direto nunca dependeu do menu. */
  { nome: "Android antigo sem Web Share", ua: "Mozilla/5.0 (Linux; Android 9) Mobile Safari/537.36", toque: true, share: false, pontos: 5, esperado: "download" },
  /* iPhone sem Web Share de arquivo (iOS < 15): download solto vai para o
     Arquivos com um diálogo por foto — o zip é menos pior. */
  { nome: "iPhone antigo sem Web Share", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", toque: true, share: false, pontos: 5, esperado: "computador" },
  { nome: "Notebook com tela sensível", ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", toque: true, share: true, pontos: 10, esperado: "computador" },
];

function montarAmbiente({ ua, toque, share, pontos = 0 }) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {
    userAgent: ua,
    maxTouchPoints: pontos,
    canShare: share ? (dados) => Boolean(dados?.files?.length) : undefined,
    share: async () => {},
  } });
  globalThis.matchMedia = (q) => ({ matches: q.includes("coarse") ? toque : false });
  globalThis.File = class {
    constructor(partes, nome, opcoes) {
      this.name = nome;
      this.type = opcoes?.type ?? "";
      this.partes = partes;
    }
  };
  globalThis.Blob = class {};
}
globalThis.DOMException = class DOMException extends Error {};
const recusa = (name, message = name) =>
  Object.assign(new globalThis.DOMException(message), { name, message });

const mod = await import("../src/lib/salvar-client.ts");
const { modoPeloUserAgent } = await import("../src/lib/modo-de-entrega.ts");

let falhou = false;
const ok = (nome, cond, extra) => {
  if (!cond) falhou = true;
  console.log(`  ${cond ? "✓" : "✗"} ${nome}${extra ? ` — ${extra}` : ""}`);
};

console.log("Como cada aparelho recebe as fotos:\n");
for (const c of cenarios) {
  montarAmbiente(c);
  const obtido = mod.modoDeEntrega();
  ok(`${c.nome.padEnd(30)} → ${obtido}`, obtido === c.esperado, obtido === c.esperado ? "" : `esperava ${c.esperado}`);
}

console.log("\nO palpite do servidor pela primeira pintura:\n");
/* O servidor só tem o user-agent. Errar aqui faz o botão piscar de um rótulo
   para outro ao abrir; o navegador corrige, mas o palpite comum tem de acertar. */
for (const [ua, esperado, nome] of [
  [cenarios[0].ua, "menu", "iPhone"],
  [cenarios[1].ua, "download", "Android"],
  [cenarios[2].ua, "menu", "iPad mini"],
  [cenarios[5].ua, "computador", "Desktop"],
  ["", "computador", "sem user-agent"],
]) {
  const obtido = modoPeloUserAgent(ua);
  ok(`${nome.padEnd(16)} → ${obtido}`, obtido === esperado);
}

console.log("\nUma foto pelo menu do iPhone:\n");

montarAmbiente(cenarios[0]);
globalThis.fetch = async () => ({ ok: true, blob: async () => ({ type: "image/jpeg" }) });
globalThis.navigator.share = async () => {
  throw recusa("AbortError", "Share canceled");
};
ok('fechar o menu devolve "cancelou" (não vira erro na tela)',
  (await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }])) === "cancelou");

/*
 * O WebKit usa o MESMO AbortError para "a pessoa fechou" e para "não consegui
 * ler os arquivos" (ShareDataReader.cpp: "Abort due to error while reading
 * files."). O segundo é memória: o lote era grande demais para o aparelho.
 * Tratado como cancelamento, a entrega parava muda — a pessoa achava que tinha
 * fechado alguma coisa sem querer.
 */
globalThis.navigator.share = async () => {
  throw recusa("AbortError", "Abort due to error while reading files.");
};
ok('falha ao ler os arquivos devolve "falhou-leitura", e não "cancelou"',
  (await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }])) === "falhou-leitura");

globalThis.navigator.share = async () => {
  throw recusa("NotAllowedError");
};
ok('gesto expirado devolve "expirou" (cai no download)',
  (await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }])) === "expirou");

montarAmbiente(cenarios[5]);
ok('navegador sem Web Share devolve "sem-suporte"',
  (await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }])) === "sem-suporte");

montarAmbiente(cenarios[0]);
globalThis.fetch = async () => {
  throw new TypeError("Failed to fetch");
};
ok('arquivo bloqueado por CORS devolve "sem-acesso"',
  (await mod.salvarNoCelular([{ url: "http://x/a.jpg", nome: "a.jpg" }])) === "sem-acesso");

console.log("\nUm toque, um menu:\n");

{
  /* O Chromium de verdade: `canShare` diz sim para qualquer lista, e `share`
     consome a ativação ANTES de conferir o tamanho — a segunda chamada no mesmo
     toque é recusada. É contra ESTE navegador que o código tem de funcionar. */
  montarAmbiente(cenarios[0]);
  const chamadas = [];
  let ativacao = true;
  globalThis.navigator.canShare = () => true;
  globalThis.navigator.share = async ({ files }) => {
    chamadas.push(files.length);
    if (!ativacao) throw recusa("NotAllowedError");
    ativacao = false;
    if (files.length > 10) throw recusa("NotAllowedError", "Permission denied");
  };
  const arquivos = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.jpg` }));
  const r = await mod.compartilharPreparado(arquivos);
  ok("uma lista recusada NÃO vira uma segunda chamada no mesmo toque",
    chamadas.length === 1, `${chamadas.length} chamadas a share, desfecho "${r}"`);
}

console.log("\nLotes por memória:\n");

const MB = 1024 * 1024;
const arq = (nome, mb) => ({ id: nome, url: `http://x/${nome}`, nome, bytes: mb * MB });

{
  const fotos = Array.from({ length: 30 }, (_, i) => arq(`f${i}.jpg`, 8));
  const r1 = mod.montarLotes(fotos);
  const maiorLote = Math.max(...r1.lotes.map((l) => l.reduce((s, a) => s + a.bytes, 0)));
  ok(`30 fotos de 8 MB viram ${r1.lotes.length} lotes, nenhum acima do orçamento`,
    r1.lotes.length > 1 && maiorLote <= mod.ORCAMENTO_LOTE);
  ok("nenhuma foto se perde no caminho", r1.lotes.flat().length + r1.grandes.length === fotos.length);

  const comVideo = [arq("a.jpg", 5), arq("filme.mp4", 5000), arq("b.jpg", 5)];
  const r2 = mod.montarLotes(comVideo);
  ok("vídeo de 5 GB NÃO entra no menu nativo", r2.grandes.length === 1 && r2.grandes[0].nome === "filme.mp4");
  ok("as fotos ao lado do vídeo continuam indo pelo menu", r2.lotes.flat().length === 2);
  ok("lista vazia não gera lote vazio", mod.montarLotes([]).lotes.length === 0);

  /* O teto de contagem não pode PROMETER mais memória do que o orçamento
     aguenta para a foto típica (média de 3,05 MB medida em produção em
     10/09/2026). É o que impede dobrar o número sem medir. */
  const promessa = mod.LOTE_MAXIMO * 3.05 * MB;
  ok(`${mod.LOTE_MAXIMO} fotos típicas cabem no orçamento de ${Math.round(mod.ORCAMENTO_LOTE / MB)} MB`,
    mod.LOTE_MAXIMO > 0 && promessa <= mod.ORCAMENTO_LOTE);
  const pequenas = Array.from({ length: mod.LOTE_MAXIMO + 5 }, (_, i) => arq(`p${i}.jpg`, 1));
  const rp = mod.montarLotes(pequenas);
  ok("com foto pequena quem corta é a contagem", rp.lotes[0].length === mod.LOTE_MAXIMO && rp.lotes.length === 2);
  const rt = mod.montarLotes(pequenas, 10);
  ok("e o teto pode descer quando o aparelho não aguenta", rt.lotes.every((l) => l.length <= 10) && rt.lotes.length === 5);
}

/*
 * ── A ENTREGA INTEIRA, NUMA BANCADA ───────────────────────────────────────
 *
 * `entregarTudo` recebe a lista completa (vinda de `api/g/[id]/lista`) e os
 * ganchos do mundo de fora: assinar links, buscar uma foto, pedir o toque,
 * abrir o menu, baixar, esperar. A bancada troca cada um por um gravador.
 */
const foto = (i, mb = 1) => ({ id: `id-${i}`, nome: `f${i}.jpg`, bytes: mb * MB });
const fotos = (n, mb) => Array.from({ length: n }, (_, i) => foto(i, mb));

function bancada(opcoes = {}) {
  const b = {
    assinados: [],
    buscados: [],
    menus: [],
    baixados: [],
    esperas: [],
    toques: 0,
    entregues: [],
    progressos: [],
    sinaisNaBusca: 0,
  };
  let assinaturasQueFalham = opcoes.assinarFalha ?? 0;
  const falhasDeBusca = new Map(Object.entries(opcoes.falhasDeBusca ?? {}));
  const respostas = [...(opcoes.menu ?? [])];
  b.ganchos = {
    modo: opcoes.modo ?? "menu",
    assinar: async (ids) => {
      b.assinados.push(ids.length);
      if (assinaturasQueFalham !== 0) {
        if (assinaturasQueFalham > 0) assinaturasQueFalham--;
        throw new Error("HTTP 502");
      }
      return new Map(ids.filter((id) => !(opcoes.semLink ?? []).includes(id)).map((id) => [id, `https://balde/${id}`]));
    },
    buscar: async (url, sinal) => {
      b.buscados.push(url);
      if (sinal && "aborted" in sinal) b.sinaisNaBusca++;
      const id = url.split("/").pop();
      const restam = falhasDeBusca.get(id);
      if (restam !== undefined && restam !== 0) {
        if (restam > 0) falhasDeBusca.set(id, restam - 1);
        throw new TypeError("Failed to fetch");
      }
      return { type: "image/jpeg" };
    },
    pedirToque: async () => {
      b.toques++;
      return opcoes.parar?.(b) ? "parar" : "seguir";
    },
    compartilhar: async (arquivos) => {
      b.menus.push(arquivos.length);
      return respostas.length > 0 ? respostas.shift() : (opcoes.menuPadrao ?? "salvou");
    },
    baixar: (url, nome) => b.baixados.push(nome),
    esperar: async (ms) => void b.esperas.push(ms),
    aoProgredir: (p) => b.progressos.push({ ...p }),
    aoEntregar: (ids) => b.entregues.push(...ids),
    jaEntregues: new Set(opcoes.jaEntregues ?? []),
    sinal: {
      get aborted() {
        return opcoes.pararDownload?.(b) ?? false;
      },
    },
  };
  return b;
}

console.log("\nPelo menu do iPhone:\n");

{
  const b = bancada({ menu: ["cancelou"] });
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("fechar o menu não entrega nada", r.entregues === 0 && r.cancelado === true, `entregues=${r.entregues}`);
  ok("e não dispara download nenhum por baixo", b.baixados.length === 0);
}

{
  const b = bancada();
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("menu concluído entrega o lote inteiro", r.entregues === 5 && r.completo, `entregues=${r.entregues}`);
  ok("e guarda o progresso de cada foto entregue", b.entregues.length === 5);
}

{
  /* Assinar a galeria inteira de uma vez fazia os links de 2108 fotos vencerem
     no meio de uma entrega de horas. Agora cada lote assina o seu. */
  const b = bancada();
  await mod.entregarTudo(fotos(90), b.ganchos);
  ok("os links são assinados lote a lote, não todos no começo",
    b.assinados.length === 3 && b.assinados.every((n) => n <= mod.LOTE_MAXIMO), b.assinados.join(" + "));
  ok("um toque por lote", b.toques === 3 && b.menus.join() === "40,40,10", b.menus.join(" + "));
}

{
  /* Recarregar a página no meio recomeçava da foto 1 e duplicava fotos no rolo. */
  const b = bancada({ jaEntregues: ["id-0", "id-1"] });
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("o que já tinha sido salvo antes não é buscado de novo",
    b.buscados.length === 3 && r.entregues === 3 && r.jaTinham === 2 && r.completo,
    `${b.buscados.length} buscadas, ${r.jaTinham} já tinham ido`);
}

{
  const b = bancada();
  await mod.entregarTudo(fotos(90), b.ganchos);
  const feitas = b.progressos.map((p) => p.feitas);
  const nuncaVolta = feitas.every((n, i) => i === 0 || n >= feitas[i - 1]);
  const ultimo = b.progressos.at(-1);
  ok("o contador só anda para frente", nuncaVolta, `${feitas[0]} … ${feitas.at(-1)}`);
  ok("e termina no total, na última parte", ultimo?.feitas === 90 && ultimo?.total === 90 && ultimo?.parte === ultimo?.partes,
    `parte ${ultimo?.parte} de ${ultimo?.partes}`);
}

{
  const b = bancada({ falhasDeBusca: { "id-2": 2 } });
  const r = await mod.entregarTudo(fotos(4), b.ganchos);
  ok("uma foto que falha na busca é tentada de novo antes de desistir",
    r.entregues === 4 && r.falharam.length === 0, `${b.buscados.length} buscas para 4 fotos`);
}

{
  const b = bancada({ falhasDeBusca: { "id-1": -1 } });
  const r = await mod.entregarTudo(fotos(4), b.ganchos);
  ok("uma foto que nunca vem não derruba o lote: as outras vão pelo menu",
    b.menus.join() === "3" && r.entregues === 3 && b.baixados.length === 0, `menu com ${b.menus.join()}`);
  ok("e fica de fora do progresso, para a próxima tentativa buscar só ela",
    r.falharam.join() === "id-1" && !b.entregues.includes("id-1") && !r.completo);
}

{
  /* Nada vem: é o CORS do endereço do estúdio, não a foto. O download comum é
     navegação e não passa por CORS. */
  const todas = Object.fromEntries(fotos(3).map((f) => [f.id, -1]));
  const b = bancada({ falhasDeBusca: todas });
  const r = await mod.entregarTudo(fotos(3), b.ganchos);
  ok("quando nenhuma foto do lote vem, o lote cai no download comum", b.baixados.length === 3 && b.menus.length === 0);
  ok("com pausa entre um e outro", b.esperas.filter((ms) => ms > 0).length >= 2);
  ok("e diz onde as fotos foram parar", Boolean(r.aviso), r.aviso ?? "sem aviso");
}

{
  /* "Não consegui ler os arquivos" é memória. Reabrir com a metade — num toque
     NOVO, porque o de antes já foi gasto — e seguir com lotes menores. */
  const b = bancada({ menu: ["falhou-leitura"] });
  const r = await mod.entregarTudo(fotos(8), b.ganchos);
  ok("falha de leitura reparte o lote e pede um toque para cada metade",
    b.menus.join() === "8,4,4" && b.toques === 3 && r.entregues === 8, b.menus.join(" → "));
}

{
  const b = bancada({ menu: ["expirou"] });
  const r = await mod.entregarTudo(fotos(3), b.ganchos);
  ok("menu recusado depois do toque cai no download comum", b.baixados.length === 3 && r.entregues === 3);
}

{
  const b = bancada({ parar: () => true });
  const r = await mod.entregarTudo(fotos(3), b.ganchos);
  ok("parar na vez do toque encerra sem abrir o menu", r.cancelado && b.menus.length === 0 && r.entregues === 0);
}

{
  /* "parar" tocado enquanto o lote ainda está sendo buscado: sem conferir, a
     entrega só pararia no próximo botão — que ela mesma voltaria a mostrar. */
  const b = bancada({ pararDownload: () => true });
  const r = await mod.entregarTudo(fotos(3), b.ganchos);
  ok("parar enquanto prepara encerra antes de pedir o toque", r.cancelado && b.toques === 0 && b.menus.length === 0);
}

{
  const b = bancada();
  const r = await mod.entregarTudo([], b.ganchos);
  ok("lista vazia não entrega nada", r.entregues === 0 && !r.cancelado);
}

/*
 * ── A FALHA QUE NÃO É CORS (revisão de 16/09/2026) ────────────────────────
 *
 * Os links vêm da nossa própria rota (`/api/g/[id]/urls`), mesma origem: se
 * ela falha, é rede ou servidor reiniciando, nunca o CORS do endereço do
 * estúdio. A primeira versão lia "nenhum link" como CORS e mandava o RESTO da
 * galeria para o download comum — que no iPhone vai para Arquivos —, marcava
 * tudo como entregue e dizia "estão no app Fotos". Uma queda de 1 s no 4G.
 */
{
  const b = bancada({ assinarFalha: 1 });
  const r = await mod.entregarTudo(fotos(200), b.ganchos);
  ok("uma falha ao pedir os links é tentada de novo, e a entrega segue pelo menu",
    b.baixados.length === 0 && b.menus.length > 0 && r.entregues === 200,
    `menus ${b.menus.length}, baixados ${b.baixados.length}`);
}

{
  const b = bancada({ assinarFalha: -1 });
  const r = await mod.entregarTudo(fotos(50), b.ganchos);
  ok("links que nunca vêm param a entrega, sem trocar de caminho",
    b.baixados.length === 0 && r.entregues === 0 && r.parouPorFalha && !r.completo,
    `baixados ${b.baixados.length}, parouPorFalha ${r.parouPorFalha}`);
}

{
  /* Um lote de UMA foto que não vem não prova CORS nenhum. */
  const b = bancada({ falhasDeBusca: { "id-0": -1 } });
  const r = await mod.entregarTudo(fotos(1), b.ganchos);
  ok("uma foto sozinha que não vem fica em falha, não vira download",
    b.baixados.length === 0 && r.falharam.join() === "id-0");
}

{
  /* "parar" durante a busca de um lote de 40 no 4G: sem conferir a cada foto,
     o celular baixava as 40 (120 MB) antes de obedecer. */
  const b = bancada({ pararDownload: (x) => x.buscados.length >= 1 });
  const r = await mod.entregarTudo(fotos(40), b.ganchos);
  ok("parar vale na foto seguinte, não no fim do lote", r.cancelado && b.buscados.length <= 1,
    `${b.buscados.length} buscas depois do parar`);
  ok("e a busca recebe o sinal, para cancelar a que está no meio", b.sinaisNaBusca >= 1);
}

{
  /* O recado final precisa saber POR ONDE as fotos foram: pelo menu (app
     Fotos) ou por download (Arquivos). */
  const peloMenu = await mod.entregarTudo(fotos(5), bancada().ganchos);
  const todas = Object.fromEntries(fotos(3).map((f) => [f.id, -1]));
  const porCors = await mod.entregarTudo(fotos(3), bancada({ falhasDeBusca: todas }).ganchos);
  ok("o desfecho conta quantas foram pelo menu e quantas por download",
    peloMenu.pelaFolha === 5 && peloMenu.porDownload === 0 && porCors.pelaFolha === 0 && porCors.porDownload === 3,
    `menu ${peloMenu.pelaFolha}/${peloMenu.porDownload} · cors ${porCors.pelaFolha}/${porCors.porDownload}`);
}

console.log("\nPor download, no Android:\n");

{
  const b = bancada({ modo: "download" });
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("baixa uma por uma, sem abrir menu nem carregar foto na memória",
    b.baixados.length === 5 && b.menus.length === 0 && b.buscados.length === 0 && r.entregues === 5 && r.completo);
  ok("com pausa entre uma e outra", b.esperas.filter((ms) => ms >= mod.PAUSA_ENTRE_DOWNLOADS).length >= 4);
  ok("sem pedir toque a cada lote", b.toques === 0);
}

{
  const b = bancada({ modo: "download" });
  await mod.entregarTudo(fotos(250), b.ganchos);
  ok("assina em blocos, não a galeria inteira de uma vez",
    b.assinados.length >= 3 && b.assinados.every((n) => n <= 100), b.assinados.join(" + "));
}

{
  const b = bancada({ modo: "download", jaEntregues: ["id-0"], pararDownload: (x) => x.baixados.length >= 2 });
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("retoma de onde parou e para quando a pessoa pede",
    !b.baixados.includes("f0.jpg") && b.baixados.length === 2 && r.cancelado && !r.completo,
    `baixou ${b.baixados.join(", ")}`);
  ok("e o que saiu fica guardado", b.entregues.length === 2);
}

{
  const b = bancada({ modo: "download", semLink: ["id-3"] });
  const r = await mod.entregarTudo(fotos(5), b.ganchos);
  ok("foto sem link assinado vira falha, não some calada", r.falharam.join() === "id-3" && r.entregues === 4);
}

console.log("\nContinuar de onde parou:\n");

{
  const guardado = new Map();
  const armazem = {
    getItem: (k) => guardado.get(k) ?? null,
    setItem: (k, v) => guardado.set(k, v),
    removeItem: (k) => guardado.delete(k),
  };
  const agora = Date.UTC(2026, 8, 16);
  const chave = mod.chaveDoProgresso("gal-1", "cap:festa");
  mod.gravarProgresso(armazem, chave, ["a", "b"], agora);
  const lido = mod.lerProgresso(armazem, chave, agora + 3600_000);
  ok("o que foi gravado volta", lido.size === 2 && lido.has("a") && lido.has("b"));
  ok("outra pasta não herda o progresso desta",
    mod.lerProgresso(armazem, mod.chaveDoProgresso("gal-1", "tudo"), agora).size === 0);
  ok("depois de uma semana, esquece",
    mod.lerProgresso(armazem, chave, agora + 8 * 86400_000).size === 0);
  mod.apagarProgresso(armazem, chave);
  ok("e apagar apaga", mod.lerProgresso(armazem, chave, agora).size === 0);

  /* Aba anônima do Safari e armazenamento bloqueado JOGAM exceção. O progresso
     é conveniência: sem ele a entrega continua, só não retoma. */
  const quebrado = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
  let estourou = false;
  try {
    mod.gravarProgresso(quebrado, chave, ["a"], agora);
    mod.apagarProgresso(quebrado, chave);
    ok("armazenamento bloqueado lê vazio", mod.lerProgresso(quebrado, chave, agora).size === 0);
    ok("e ninguém lê progresso sem armazenamento", mod.lerProgresso(null, chave, agora).size === 0);
  } catch {
    estourou = true;
  }
  ok("sem estourar exceção", !estourou);

  /* Gravar a lista a cada foto seria reescrever 2108 ids 2108 vezes. */
  {
    let escritas = 0;
    let relogio = agora;
    const contado = { ...armazem, setItem: (k, v) => (escritas++, armazem.setItem(k, v)) };
    const g = mod.gravadorDeProgresso(contado, chave, ["x"], () => relogio);
    for (let i = 0; i < 50; i++) g.marcar([`id-${i}`]);
    ok("marcar em rajada grava no máximo uma vez", escritas <= 1, `${escritas} escritas para 50 fotos`);
    relogio += 5000;
    g.marcar(["id-50"]);
    ok("e volta a gravar depois de um tempo", escritas === 2);
    g.gravar();
    const salvo = mod.lerProgresso(armazem, chave, relogio);
    ok("gravar no fim grava tudo, inclusive o que já tinha ido", escritas === 3 && salvo.size === 52 && salvo.has("x"));
  }
}

console.log("\nTela acesa enquanto salva:\n");

{
  montarAmbiente(cenarios[0]);
  const pedidos = [];
  let soltas = 0;
  globalThis.navigator.wakeLock = {
    request: async (tipo) => {
      pedidos.push(tipo);
      return { release: async () => void soltas++ };
    },
  };
  const ouvintes = [];
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (e, fn) => ouvintes.push([e, fn]),
    removeEventListener: (e, fn) => {
      const i = ouvintes.findIndex(([ev, f]) => ev === e && f === fn);
      if (i >= 0) ouvintes.splice(i, 1);
    },
  };
  const trava = mod.travaDeTela();
  await trava.ligar();
  ok("pede para a tela não apagar", pedidos.join() === "screen");
  /* O sistema solta a trava quando a pessoa troca de app; ao voltar, pede de novo. */
  for (const [e, fn] of ouvintes) if (e === "visibilitychange") await fn();
  ok("e pede de novo quando a pessoa volta para a aba", pedidos.length === 2);
  /* Esperando o toque do lote, nada está sendo transferido: a tela pode apagar.
     Sem isto, o celular esquecido na mesa da festa ficava aceso sem fim. */
  await trava.desligar();
  ok("desligar solta a trava e para de ouvir", soltas >= 1 && ouvintes.length === 0);
  for (const [e, fn] of ouvintes) if (e === "visibilitychange") await fn();
  ok("e desligada ela não volta sozinha", pedidos.length === 2);
  await trava.ligar();
  ok("religar pede de novo", pedidos.length === 3);
  await trava.desligar();

  delete globalThis.navigator.wakeLock;
  let estourou = false;
  try {
    const s = mod.travaDeTela();
    await s.ligar();
    await s.desligar();
  } catch {
    estourou = true;
  }
  ok("navegador sem a API não quebra a entrega", !estourou);
}

console.log("\nBaixar no computador, pelo celular:\n");

{
  montarAmbiente(cenarios[0]);
  let enviado = null;
  globalThis.navigator.share = async (d) => void (enviado = d);
  const r = await mod.enviarParaOComputador("https://galeria.exemplo/g/estudio/casamento", "Ana & Kaio");
  ok("abre o menu com o LINK da galeria, sem arquivo nenhum",
    r === "compartilhou" && enviado?.url === "https://galeria.exemplo/g/estudio/casamento" && !enviado?.files);
  ok("e diz o que fazer lá", /computador/i.test(enviado?.text ?? "") && /zip/i.test(enviado?.text ?? ""), enviado?.text);

  globalThis.navigator.share = async () => {
    throw recusa("AbortError", "Share canceled");
  };
  ok("fechar o menu não é erro", (await mod.enviarParaOComputador("https://x/g", "t")) === "cancelou");

  montarAmbiente(cenarios[5]);
  delete globalThis.navigator.share;
  let copiado = null;
  globalThis.navigator.clipboard = { writeText: async (t) => void (copiado = t) };
  ok("sem menu, copia o link", (await mod.enviarParaOComputador("https://x/g", "t")) === "copiou" && copiado === "https://x/g");

  delete globalThis.navigator.clipboard;
  ok("sem menu nem área de transferência, diz que não deu", (await mod.enviarParaOComputador("https://x/g", "t")) === "falhou");
}

console.log("\nO tamanho dito antes de começar:\n");

ok("6,4 GB", mod.tamanhoLegivel(6.4 * 1000 ** 3) === "6,4 GB", mod.tamanhoLegivel(6.4 * 1000 ** 3));
ok("915 MB", mod.tamanhoLegivel(915 * 1000 ** 2) === "915 MB", mod.tamanhoLegivel(915 * 1000 ** 2));
ok("partes previstas = lotes do menu", mod.partesPrevistas(fotos(90)) === 3);
/* O menu dizia "um toque a cada 40 fotos", mas o lote também fecha em 150 MB:
   com foto de 8 MB são 18 por lote, e a conta de quem lia dava metade. */
ok("toques previstos, pela contagem", mod.toquesPrevistos(2108, 6.4 * 1000 ** 3) === 53,
  String(mod.toquesPrevistos(2108, 6.4 * 1000 ** 3)));
/* 150 MB / 8 MB = 18 fotos por lote (montarLotes fecha antes de estourar), e
   2108 / 18 = 118 toques — a mesma conta que a entrega vai fazer. */
ok("toques previstos, pela memória", mod.toquesPrevistos(2108, 2108 * 8 * MB) === 118,
  String(mod.toquesPrevistos(2108, 2108 * 8 * MB)));

console.log("\nO recado do fim:\n");

{
  const d = (x) => ({ entregues: 0, jaTinham: 0, total: 0, cancelado: false, falharam: [], aviso: null,
    completo: false, pelaFolha: 0, porDownload: 0, parouPorFalha: false, ...x });
  const pronto = mod.recadoDoFim(d({ entregues: 5, total: 5, completo: true, pelaFolha: 5 }), "menu");
  ok("tudo pelo menu: estão no app Fotos", /Pronto/.test(pronto) && /app Fotos/.test(pronto), pronto);

  const cors = mod.recadoDoFim(d({ entregues: 5, total: 5, completo: true, porDownload: 5 }), "menu");
  ok("tudo por download no iPhone: NÃO diz app Fotos", /Arquivos/.test(cors) && !/app Fotos/.test(cors), cors);

  const misto = mod.recadoDoFim(d({ entregues: 5, total: 5, completo: true, pelaFolha: 3, porDownload: 2 }), "menu");
  ok("misto: diz os dois lugares", /app Fotos/.test(misto) && /Arquivos/.test(misto), misto);

  const android = mod.recadoDoFim(d({ entregues: 5, total: 5, completo: true, porDownload: 5 }), "download");
  ok("Android: pasta Download", /baixadas/.test(android) && /Download/.test(android), android);

  /* A revisão achou: com uma foto falhando e a pessoa parando no lote 2, o
     recado dizia "1 foto não veio — buscar só ela" com 2069 ainda por ir. */
  const parouComFalha = mod.recadoDoFim(
    d({ entregues: 39, total: 2108, cancelado: true, falharam: ["x"], pelaFolha: 39 }), "menu");
  ok("parou no meio com falha: diz quantas foram, não 'só ela'",
    /39 de 2108/.test(parouComFalha) && !/só ela/.test(parouComFalha), parouComFalha);

  const soFalha = mod.recadoDoFim(d({ entregues: 4, total: 5, falharam: ["x"], pelaFolha: 4 }), "menu");
  ok("chegou ao fim com uma falha: aí sim, 'só ela'", /só ela/.test(soFalha), soFalha);

  const rede = mod.recadoDoFim(d({ entregues: 80, total: 200, parouPorFalha: true, pelaFolha: 80 }), "menu");
  ok("parou por falha de rede: diz que caiu e onde parou", /80 de 200/.test(rede) && /conex/.test(rede), rede);

  ok("fechou o menu sem nada ter ido: sem recado", mod.recadoDoFim(d({ total: 10, cancelado: true }), "menu") === null);
}

console.log("\nO progresso das favoritas no aparelho:\n");

{
  /* A chave do progresso não pode levar o e-mail em texto: fica no
     armazenamento do aparelho — às vezes o tablet de um parente — por dias. */
  const a = mod.escopoDasFavoritas("Noiva@Exemplo.com");
  const b = mod.escopoDasFavoritas("noiva@exemplo.com ");
  ok("a chave não carrega o e-mail", !/@|noiva|exemplo/i.test(a), a);
  ok("e é a mesma com maiúscula e espaço", a === b);
  ok("e muda de pessoa para pessoa", a !== mod.escopoDasFavoritas("noivo@exemplo.com"));
}

console.log("\nO que conta como entregue:\n");

for (const [r, esperado] of [
  ["cancelou", false],
  ["salvou", true],
  ["expirou", true],
  ["sem-acesso", true],
  ["sem-suporte", true],
]) {
  ok(`"${r}" ${esperado ? "conta" : "NÃO conta"} como foto entregue`, mod.entregouUmaFoto(r) === esperado);
}

/*
 * A trava do lado do componente: o registro só pode acontecer DEPOIS de saber
 * o desfecho. Antes de 05/09/2026, `registrar("baixou_tudo")` ficava logo após
 * assinar as URLs — contava o CLIQUE.
 */
{
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const fonte = readFileSync(path.default.resolve(import.meta.dirname, "../src/components/galeria-cliente.tsx"), "utf8");
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const desfecho = semComentarios.indexOf("entregarTudo(");
  const registro = semComentarios.indexOf("registrar(", desfecho);
  ok("a galeria só registra o download DEPOIS de saber o desfecho", desfecho > 0 && registro > desfecho);
  ok("e só quando alguma foto foi de fato entregue",
    /entregues\s*>\s*0/.test(semComentarios.slice(desfecho, registro)));

  const umaFoto = semComentarios.match(/async function salvarUm\([\s\S]*?\n  \}/)?.[0] ?? "";
  ok("baixar UMA foto também só conta depois de saber o desfecho",
    umaFoto.includes("entregouUmaFoto") &&
      umaFoto.indexOf("entregouUmaFoto") < umaFoto.lastIndexOf('registrar("baixou"'));
}

if (falhou) {
  console.error("\n✗ a lógica de salvamento tem problema");
  process.exit(1);
}
console.log("\n✓ salvamento no celular decide certo em todos os navegadores testados");
