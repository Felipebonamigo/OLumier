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
 * O endereço do estúdio (siriusfotografia.olumier.com.br) é uma origem
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

/*
 * ── "BAIXAR TUDO" NO CELULAR (05/09/2026) ─────────────────────────────────
 *
 * O Juan tentou baixar tudo no celular, não veio nada — e a aba Atividade
 * marcou 1 download. Duas coisas erradas de uma vez, e a segunda é a pior: a
 * Atividade é PROVA DE ENTREGA para o fotógrafo ("o casal baixou dia tal"). Um
 * número que sobe quando nada foi entregue não é um número impreciso, é uma
 * prova falsa — e ela aparece justamente na conversa em que o cliente diz que
 * não recebeu.
 *
 * Daí `entregarTudo` existir como função pura, fora do componente: o desfecho
 * ("quantos saíram, a pessoa cancelou?") passa a ser algo que se pergunta num
 * teste, em vez de um efeito colateral no meio de um `onClick`.
 */
console.log("\nBaixar tudo — o que conta como entregue:\n");

{
  const ok = (nome, cond, extra) => {
    if (!cond) falhou = true;
    console.log(`  ${cond ? "✓" : "✗"} ${nome}${extra ? ` — ${extra}` : ""}`);
  };

  const fotos = Array.from({ length: 5 }, (_, i) => arq(`f${i}.jpg`, 2));

  /** Bancada: conta o que foi baixado e quanto se esperou entre um e outro. */
  function bancada(resultadoDoMenu) {
    const baixados = [];
    const esperas = [];
    return {
      baixados,
      esperas,
      ganchos: {
        salvarLote: async () =>
          typeof resultadoDoMenu === "function" ? resultadoDoMenu() : resultadoDoMenu,
        baixar: (url, nome) => baixados.push(nome),
        esperar: async (ms) => void esperas.push(ms),
      },
    };
  }

  // 1. O caso do Juan: a pessoa fecha o menu. Nada saiu.
  {
    const b = bancada("cancelou");
    const r = await mod.entregarTudo(fotos, { peloMenu: true, ...b.ganchos });
    ok("fechar o menu não entrega nada", r.entregues === 0 && r.cancelado === true,
      `entregues=${r.entregues}`);
    ok("e não dispara download nenhum por baixo", b.baixados.length === 0);
  }

  // 2. Salvou de verdade.
  {
    const b = bancada("salvou");
    const r = await mod.entregarTudo(fotos, { peloMenu: true, ...b.ganchos });
    ok("menu concluído entrega as fotos do lote", r.entregues === fotos.length,
      `entregues=${r.entregues}`);
  }

  // 3. O menu falhou: cai no download comum — mas ESPAÇADO.
  //    Vinte cliques de download disparados juntos são ignorados pelo
  //    navegador; é a mesma razão pela qual o caminho do computador já
  //    espera entre um e outro. Sem a espera, "não veio nada" no celular.
  {
    const b = bancada("sem-acesso");
    const r = await mod.entregarTudo(fotos, { peloMenu: true, ...b.ganchos });
    ok("menu recusado cai no download comum", b.baixados.length === fotos.length);
    ok(
      "com pausa entre um download e o outro",
      b.esperas.filter((ms) => ms > 0).length >= fotos.length - 1,
      `${b.esperas.length} pausas`,
    );
    ok("e diz onde as fotos foram parar", Boolean(r.aviso), r.aviso ?? "sem aviso");
  }

  // 4. Lista vazia: galeria com download bloqueado devolve zero links.
  {
    const b = bancada("salvou");
    const r = await mod.entregarTudo([], { peloMenu: true, ...b.ganchos });
    ok("lista vazia não entrega nada", r.entregues === 0 && !r.cancelado);
  }

  // 5. Computador: um download atrás do outro, espaçados.
  {
    const b = bancada("sem-suporte");
    const r = await mod.entregarTudo(fotos, { peloMenu: false, ...b.ganchos });
    ok("no computador baixa todas em sequência", r.entregues === fotos.length);
    ok("também espaçadas", b.esperas.filter((ms) => ms > 0).length >= fotos.length - 1);
  }
}

/*
 * A MESMA prova falsa existia numa foto só, a uma linha de distância: o
 * registro vinha antes de abrir o menu, então fechar o menu contava um
 * download. Ninguém reclamou dessa ainda — e é justamente por isso que ela
 * entra junto, enquanto o defeito está identificado.
 */
{
  const casos = [
    ["cancelou", false],
    ["salvou", true],
    ["expirou", true],
    ["sem-acesso", true],
    ["sem-suporte", true],
  ];
  for (const [r, esperado] of casos) {
    const veio = mod.entregouUmaFoto(r);
    const ok = veio === esperado;
    if (!ok) falhou = true;
    console.log(
      `  ${ok ? "✓" : "✗"} "${r}" ${esperado ? "conta" : "NÃO conta"} como foto entregue`,
    );
  }
}

/*
 * A trava do lado do componente: o registro só pode acontecer DEPOIS de saber
 * o desfecho. Antes, `registrar("baixou_tudo")` ficava logo após assinar as
 * URLs — ou seja, contava o CLIQUE.
 */
{
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const arquivo = path.default.resolve(
    import.meta.dirname,
    "../src/components/galeria-cliente.tsx",
  );
  const fonte = readFileSync(arquivo, "utf8");
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const registro = semComentarios.indexOf('registrar("baixou_tudo")');
  /* A CHAMADA, e não o import: `entregarTudo` aparece primeiro na lista de
     imports, no topo do arquivo, e medir dali não diria nada sobre a ordem. */
  const desfecho = semComentarios.indexOf("entregarTudo(");
  const okOrdem = registro > 0 && desfecho > 0 && registro > desfecho;
  if (!okOrdem) falhou = true;
  console.log(
    `  ${okOrdem ? "✓" : "✗"} a galeria só registra o download DEPOIS de saber o desfecho`,
  );

  /* E só quando alguma coisa saiu. Sem esta condição, cancelar contaria. */
  /*
   * O recorte vai de `entregarTudo(` até a PRÓPRIA chamada de registro, e não
   * até uma distância fixa em caracteres. A versão antiga media 400 caracteres
   * e ficou vermelha em 10/09/2026 quando o `salvarLote` cresceu entre as duas
   * — sem que nada da regra tivesse mudado. Distância em bytes não é a relação
   * que este teste quer prender; "entre uma coisa e a outra" é.
   */
  const trecho = semComentarios.slice(desfecho, registro);
  const okCondicao = /entregues\s*>\s*0/.test(trecho);
  if (!okCondicao) falhou = true;
  console.log(
    `  ${okCondicao ? "✓" : "✗"} e só quando alguma foto foi de fato entregue`,
  );

  /* Uma foto só: o registro não pode estar antes do menu abrir. */
  const umaFoto = semComentarios.match(/async function salvarUm\([\s\S]*?\n  \}/)?.[0] ?? "";
  const okUma =
    umaFoto.includes("entregouUmaFoto") &&
    umaFoto.indexOf("entregouUmaFoto") < umaFoto.lastIndexOf('registrar("baixou"');
  if (!okUma) falhou = true;
  console.log(
    `  ${okUma ? "✓" : "✗"} baixar UMA foto também só conta depois de saber o desfecho`,
  );
}

/*
 * ── O SEGUNDO TOQUE (10/09/2026) ──────────────────────────────────────────
 *
 * Juan, com o print do iPhone: "cada um desses pop ups que eu cliquei em
 * 'baixar' vieram direto pra galeria. Mas tive que fazer manualmente esse
 * clique. Pra altas quantidades não tem como."
 *
 * O que ele viu foi o PLANO B funcionando exatamente como escrito: o Safari
 * recusou o menu nativo por gesto expirado, e a entrega caiu no download um a
 * um — um diálogo de confirmação por foto. Com 12 fotos são 12 toques; com 200,
 * não tem como, e ele está certo.
 *
 * A causa não é o menu: é o RELÓGIO. O Safari exige que `share()` seja chamado
 * logo depois do toque, e buscar vinte fotos numa rede de celular passa dessa
 * janela. O comentário antigo concluía "não há como segurar o gesto durante um
 * await", e isso continua verdade — mas a conclusão seguinte não: em vez de
 * segurar o gesto, dá para pedir OUTRO.
 *
 * Buscar primeiro, e só então oferecer um botão. O toque nesse botão é um gesto
 * novo, e `share()` acontece dentro dele com os arquivos já na memória. Doze
 * toques viram dois.
 *
 * As duas etapas abaixo são as duas metades: preparar não compartilha, e
 * compartilhar não busca.
 */
console.log("\nO segundo toque:\n");

montarAmbiente(cenarios[0]);
globalThis.fetch = async () => ({ ok: true, blob: async () => ({ type: "image/jpeg" }) });

{
  let compartilhou = 0;
  globalThis.navigator.share = async () => void compartilhou++;

  const lista = [
    { url: "http://x/a.jpg", nome: "a.jpg" },
    { url: "http://x/b.jpg", nome: "b.jpg" },
  ];
  const vistos = [];
  const prontos = await mod.prepararLote(lista, (n) => vistos.push(n));

  const okPrep =
    Array.isArray(prontos) && prontos.length === 2 && compartilhou === 0 && vistos.length === 2;
  if (!okPrep) falhou = true;
  console.log(
    `  ${okPrep ? "✓" : "✗"} preparar busca os arquivos e NÃO abre o menu (${compartilhou} chamadas a share)`,
  );

  const r = await mod.compartilharPreparado(prontos);
  const okShare = r === "salvou" && compartilhou === 1;
  if (!okShare) falhou = true;
  console.log(
    `  ${okShare ? "✓" : "✗"} compartilhar o que já está pronto abre o menu uma vez — devolveu "${r}"`,
  );
}

{
  /* E o desfecho ruim continua sendo desfecho, não exceção: se mesmo com o
     gesto novo o navegador recusar, quem chama precisa poder cair no download
     em vez de mostrar vermelho. */
  globalThis.navigator.share = async () => {
    throw Object.assign(new globalThis.DOMException("sem gesto"), { name: "NotAllowedError" });
  };
  const r = await mod.compartilharPreparado([{ nome: "a.jpg" }]);
  const ok = r === "expirou";
  if (!ok) falhou = true;
  console.log(`  ${ok ? "✓" : "✗"} recusa no segundo toque ainda devolve "expirou", sem estourar`);
}

if (falhou) {
  console.error("\n✗ a lógica de salvamento tem problema");
  process.exit(1);
}
console.log("\n✓ salvamento no celular decide certo em todos os navegadores testados");
