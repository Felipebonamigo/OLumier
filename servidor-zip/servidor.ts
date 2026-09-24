import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { conferirPedidoAssinado, type Manifesto } from "../src/lib/zip-remoto.ts";
import { dispositionSegura } from "../src/lib/disposition.ts";
import { CONFIG, conferirConfig } from "./config.ts";
import { intervaloDoRange } from "./range.ts";
import { buscarManifesto, PedidoRecusado, relatar } from "./app.ts";
import { fluxoDoManifesto, tamanhoDoManifesto } from "./montador.ts";
import {
  abrirEspaco,
  iniciarMontagem,
  lerDoDisco,
  montagemEmAndamento,
  montagensAtivas,
  prepararDisco,
  prontoNoDisco,
  varrer,
  type Montagem,
} from "./cache.ts";

/**
 * O SERVIDOR DE ZIP — a máquina que entrega os arquivos grandes.
 *
 *   GET  /z/<pedidoId>.<assinatura>   o ZIP de um pedido (aceita Range)
 *   HEAD /z/<pedidoId>.<assinatura>   só os cabeçalhos
 *   GET  /saude                       para o vigia
 *
 * Node puro, sem framework: são duas rotas, e o que importa aqui é o fluxo de
 * bytes, não o roteamento. Roda com `node --experimental-strip-types`, e por
 * isso importa o código compartilhado com o app pelo caminho relativo, com a
 * extensão `.ts` — não há bundler nem alias.
 *
 * ── O QUE ESTA MÁQUINA NÃO TEM ────────────────────────────────────────────
 *
 * Banco, credencial de bucket, cookie de sessão. Tudo que ela sabe vem do
 * manifesto que o app entrega para um pedido assinado, e tudo que ela conta
 * de volta vai pelo relato. Perder este servidor perde ZIPs guardados, que se
 * montam de novo; trocá-lo é apontar duas variáveis para outra máquina. É de
 * propósito que ele seja descartável — ver docs/servidor-zip.md.
 *
 * ── TRÊS CAMINHOS PARA UM PEDIDO ──────────────────────────────────────────
 *
 *   1. guardável e já pronto no disco → serve do disco, com Range
 *   2. guardável e ainda não → monta UMA vez para o disco, e serve enquanto
 *      monta (quem chega junto lê o mesmo arquivo crescendo)
 *   3. não guardável (favoritas, recorte) → monta em fluxo direto para quem
 *      pediu, sem tocar o disco; é pequeno e de uma pessoa só
 */

const faltas = conferirConfig();
if (faltas.length > 0) {
  console.error(`faltam no ambiente: ${faltas.join(", ")}`);
  process.exit(1);
}

function responderTexto(res: ServerResponse, status: number, texto: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(texto);
}

/**
 * Escreve um fluxo na resposta respeitando a contrapressão do socket: um
 * cliente lento não faz o servidor acumular memória. Devolve quantos bytes
 * saíram, e se o fluxo chegou ao fim.
 */
async function escoar(res: ServerResponse, fluxo: AsyncIterable<Uint8Array>): Promise<{ bytes: number; completo: boolean }> {
  let bytes = 0;
  for await (const pedaco of fluxo) {
    if (res.destroyed) return { bytes, completo: false };
    if (!res.write(pedaco)) {
      await new Promise<void>((r) => {
        const fim = () => {
          res.off("drain", fim);
          res.off("close", fim);
          r();
        };
        res.on("drain", fim);
        res.on("close", fim);
      });
      if (res.destroyed) return { bytes, completo: false };
    }
    bytes += pedaco.length;
  }
  return { bytes, completo: true };
}

async function servirDoDisco(
  req: IncomingMessage,
  res: ServerResponse,
  manifesto: Manifesto,
  chave: string,
  tamanho: number,
  montagem: Montagem | null,
  doCache: boolean,
) {
  const intervalo = intervaloDoRange(req.headers.range, tamanho);
  const [inicio, fim] = intervalo ?? [0, tamanho - 1];
  const cabecalhos: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": dispositionSegura(manifesto.nomeDoZip),
    "Content-Length": String(fim - inicio + 1),
    "Accept-Ranges": "bytes",
    ETag: `"${chave}"`,
    "Cache-Control": "private, no-store",
  };
  if (intervalo) cabecalhos["Content-Range"] = `bytes ${inicio}-${fim}/${tamanho}`;
  res.writeHead(intervalo ? 206 : 200, cabecalhos);
  if (req.method === "HEAD") return void res.end();

  const comeco = Date.now();
  let saida = { bytes: 0, completo: false };
  try {
    saida = await escoar(res, lerDoDisco(chave, montagem, inicio, fim));
    res.end();
  } catch (e) {
    console.error(`falha servindo ${chave}:`, (e as Error).message);
    res.destroy();
  }
  void relatar({
    pedidoId: manifesto.pedidoId,
    evento: saida.completo ? "servido" : "abortado",
    bytes: saida.bytes,
    doCache,
    duracaoMs: Date.now() - comeco,
  });
}

async function servirEmFluxo(req: IncomingMessage, res: ServerResponse, manifesto: Manifesto) {
  const tamanho = tamanhoDoManifesto(manifesto);
  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": dispositionSegura(manifesto.nomeDoZip),
    "Content-Length": String(tamanho),
    "Cache-Control": "private, no-store",
  });
  if (req.method === "HEAD") return void res.end();

  const comeco = Date.now();
  const fluxo = fluxoDoManifesto(manifesto, { renovar: () => buscarManifesto(manifesto.pedidoId, true) });
  let saida = { bytes: 0, completo: false };
  try {
    saida = await escoar(res, fluxo);
    res.end();
  } catch (e) {
    console.error(`falha montando em fluxo ${manifesto.pedidoId}:`, (e as Error).message);
    res.destroy();
  } finally {
    await fluxo.return(undefined).catch(() => {});
  }
  const duracaoMs = Date.now() - comeco;
  /* Em fluxo, cada download É uma montagem: leu o armazém. */
  void relatar({ pedidoId: manifesto.pedidoId, evento: "montado", bytes: saida.bytes, doCache: false, duracaoMs });
  void relatar({
    pedidoId: manifesto.pedidoId,
    evento: saida.completo ? "servido" : "abortado",
    bytes: saida.bytes,
    doCache: false,
    duracaoMs,
  });
}

async function atenderZip(req: IncomingMessage, res: ServerResponse, token: string) {
  const pedidoId = conferirPedidoAssinado(token, CONFIG.segredo);
  if (!pedidoId) return responderTexto(res, 404, "link inválido");

  let manifesto: Manifesto;
  try {
    manifesto = await buscarManifesto(pedidoId, false);
  } catch (e) {
    if (e instanceof PedidoRecusado) return responderTexto(res, e.status, e.message);
    console.error("manifesto:", e);
    return responderTexto(res, 502, "o app não respondeu — tente de novo em instantes");
  }
  if (manifesto.arquivos.length === 0) return responderTexto(res, 404, "nada para baixar");

  const chave = manifesto.chaveDeCache;
  if (!chave) {
    /* Em fluxo a montagem é agora, então as URLs vêm já neste pedido. */
    let comUrls: Manifesto;
    try {
      comUrls = await buscarManifesto(pedidoId, true);
    } catch (e) {
      if (e instanceof PedidoRecusado) return responderTexto(res, e.status, e.message);
      return responderTexto(res, 502, "o app não respondeu — tente de novo em instantes");
    }
    return servirEmFluxo(req, res, comUrls);
  }

  const tamanho = tamanhoDoManifesto(manifesto);

  /* 1. pronto no disco */
  const pronto = await prontoNoDisco(chave);
  if (pronto !== null) {
    if (pronto !== tamanho) {
      /* Não deveria acontecer: chave igual, tamanho diferente. Melhor montar
         de novo do que entregar um arquivo que não bate com o manifesto. */
      console.error(`ZIP guardado ${chave} tem ${pronto} bytes, e o manifesto diz ${tamanho}`);
    } else {
      return servirDoDisco(req, res, manifesto, chave, tamanho, null, true);
    }
  }

  /* 2. alguém já está montando → lê o mesmo arquivo crescendo */
  const andando = montagemEmAndamento(chave);
  if (andando) return servirDoDisco(req, res, manifesto, chave, tamanho, andando, true);

  /* 2'. ninguém está → esta requisição monta, e serve enquanto monta */
  let comUrls: Manifesto;
  try {
    comUrls = await buscarManifesto(pedidoId, true);
  } catch (e) {
    if (e instanceof PedidoRecusado) return responderTexto(res, e.status, e.message);
    return responderTexto(res, 502, "o app não respondeu — tente de novo em instantes");
  }
  /* A lista pode ter mudado entre as duas buscas (foto apagada agora mesmo):
     nesse caso a chave já é outra, e este pedido recomeça do passo 1. */
  if (comUrls.chaveDeCache !== chave) return atenderZip(req, res, token);

  const fluxo = fluxoDoManifesto(comUrls, { renovar: () => buscarManifesto(pedidoId, true) });

  /* 2''. não cabe no disco nem apagando os antigos → entrega em fluxo, sem
     guardar. É o caso de um ZIP maior que o disco: raro, e o download sai. */
  if (!montagemEmAndamento(chave) && !(await abrirEspaco(tamanho))) {
    console.error(`sem espaço para guardar ${chave} (${tamanho} bytes): entregando em fluxo`);
    return servirEmFluxo(req, res, comUrls);
  }

  const montagem =
    montagemEmAndamento(chave) ??
    iniciarMontagem(chave, tamanho, fluxo, ({ ok, bytes, duracaoMs }) => {
      if (ok) void relatar({ pedidoId, evento: "montado", bytes, doCache: false, duracaoMs });
      else console.error(`montagem de ${chave} falhou depois de ${bytes} bytes`);
    });
  return servirDoDisco(req, res, manifesto, chave, tamanho, montagem, false);
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname === "/saude") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return void res.end(JSON.stringify({ ok: true, montagens: montagensAtivas() }));
  }
  const m = /^\/z\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (!m || (req.method !== "GET" && req.method !== "HEAD")) {
    return responderTexto(res, 404, "não encontrado");
  }
  atenderZip(req, res, m[1]).catch((e) => {
    console.error("erro inesperado:", e);
    if (!res.headersSent) responderTexto(res, 500, "erro inesperado");
    else res.destroy();
  });
});

/* Um download de 20 GB numa conexão lenta leva horas: nenhum tempo limite. */
servidor.requestTimeout = 0;
servidor.headersTimeout = 60_000;
servidor.keepAliveTimeout = 30_000;

await prepararDisco();
const primeira = await varrer();
console.log(`disco: ${(primeira.bytesNoDisco / 1024 ** 3).toFixed(1)} GB guardados, ${primeira.apagados} apagado(s)`);
setInterval(() => void varrer().catch((e) => console.error("varredura:", e)), 3600 * 1000).unref();

servidor.listen(CONFIG.porta, "127.0.0.1", () => {
  console.log(`servidor de zip em 127.0.0.1:${CONFIG.porta}, cache em ${CONFIG.cacheDir}`);
});

/* Parar de aceitar, deixar os downloads em andamento terminarem. */
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    console.log(`${sinal}: parando de aceitar; downloads em andamento continuam`);
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 6 * 3600 * 1000).unref();
  });
}
