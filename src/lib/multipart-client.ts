"use client";

import { comRetentativa, emParalelo } from "./fila-upload";

/**
 * Envio de arquivo grande em partes, no navegador.
 *
 * Filme de casamento em 4K passa fácil de 5 GB, que é o teto de um envio único.
 * Aqui o arquivo é fatiado e cada pedaço sobe com sua própria URL assinada; no
 * fim, o servidor manda o armazenamento remontar tudo na ordem.
 *
 * Duas vantagens além do tamanho: uma parte que falha é reenviada sozinha (em
 * vez de perder 20 GB já enviados), e várias partes sobem ao mesmo tempo,
 * usando melhor a banda de subida.
 */

/** Quantas partes sobem simultaneamente. */
const PARTES_PARALELAS = 3;
/** Quantas URLs assinadas pedimos por vez — o servidor limita a 100. */
const LOTE_URLS = 50;

export interface ParteEnviada {
  numero: number;
  etag: string;
}

function enviarParte(
  url: string,
  pedaco: Blob,
  aoProgredir: (bytes: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    let jaContado = 0;
    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      // Reporta o avanço desta parte, não o total — quem soma é quem chamou.
      aoProgredir(e.loaded - jaContado);
      jaContado = e.loaded;
    });
    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`parte recusada (HTTP ${xhr.status})`));
      }
      /*
       * O ETag identifica a parte e é obrigatório para remontar o arquivo.
       * Só conseguimos lê-lo porque o CORS do bucket expõe esse cabeçalho —
       * sem `ExposeHeaders: ETag`, ele vem vazio e o envio nunca fecha.
       */
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        return reject(new Error("o armazenamento não devolveu o ETag da parte"));
      }
      resolve(etag);
    });
    xhr.addEventListener("error", () => reject(new Error("conexão interrompida")));
    xhr.addEventListener("abort", () => reject(new Error("envio cancelado")));
    xhr.send(pedaco);
  });
}

export async function enviarEmPartes(
  mediaId: string,
  arquivo: File,
  tamanhoParte: number,
  aoProgredir: (pct: number) => void,
): Promise<void> {
  const total = Math.ceil(arquivo.size / tamanhoParte);
  const numeros = Array.from({ length: total }, (_, i) => i + 1);

  /*
   * As URLs são pedidas SOB DEMANDA, não todas no começo.
   *
   * Pedir em lotes já era melhor que assinar 400 de uma vez, mas ainda buscava
   * tudo antes de enviar o primeiro byte — e as assinadas vencem em 6 horas. Um
   * filme de 40 GB numa conexão de casamento leva mais que isso, então as
   * primeiras partes venciam antes de chegar a vez delas e o envio morria já no
   * fim, com quase tudo enviado. O pior momento possível.
   *
   * Agora cada lote é buscado quando a primeira parte dele vai subir, e uma URL
   * recusada é renovada em vez de derrubar o envio.
   */
  const urlPorNumero = new Map<number, string>();
  const lotesPedidos = new Set<number>();

  const pedirLote = async (numero: number, renovar = false) => {
    const lote = Math.floor((numero - 1) / LOTE_URLS);
    if (lotesPedidos.has(lote) && !renovar) return;
    const inicio = lote * LOTE_URLS;
    const desteLote = numeros.slice(inicio, inicio + LOTE_URLS);

    const r = await fetch(`/api/medias/${mediaId}/partes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numeros: desteLote }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.erro ?? "não consegui preparar as partes");
    }
    const { urls } = (await r.json()) as { urls: { numero: number; url: string }[] };
    for (const u of urls) urlPorNumero.set(u.numero, u.url);
    lotesPedidos.add(lote);
  };

  const enviadas: ParteEnviada[] = [];
  let bytesEnviados = 0;

  await emParalelo(numeros, PARTES_PARALELAS, async (numero) => {
    const inicio = (numero - 1) * tamanhoParte;
    const pedaco = arquivo.slice(inicio, Math.min(inicio + tamanhoParte, arquivo.size));
    await pedirLote(numero);

    const avancar = (delta: number) => {
      bytesEnviados += delta;
      aoProgredir(Math.min(99, Math.round((bytesEnviados / arquivo.size) * 100)));
    };

    // Retentativa por PARTE: uma queda de rede reenvia 100 MB, não o filme todo.
    const etag = await comRetentativa(async () => {
      const url = urlPorNumero.get(numero);
      if (!url) throw new Error(`faltou a URL da parte ${numero}`);
      try {
        return await enviarParte(url, pedaco, avancar);
      } catch (e) {
        /*
         * 403 aqui quer dizer assinatura vencida, e insistir com a MESMA URL
         * falharia para sempre. Renovar o lote e deixar a retentativa seguir é
         * o que salva um envio longo que já está quase no fim.
         */
        if (e instanceof Error && e.message.includes("403")) {
          await pedirLote(numero, true);
        }
        throw e;
      }
    });
    enviadas.push({ numero, etag });
  });

  if (enviadas.length !== total) {
    throw new Error(`faltaram partes (${enviadas.length} de ${total})`);
  }

  const fim = await fetch(`/api/medias/${mediaId}/partes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partes: enviadas }),
  });
  if (!fim.ok) {
    const e = await fim.json().catch(() => ({}));
    throw new Error(e.erro ?? "não consegui finalizar o envio");
  }
  aoProgredir(100);
}

/** Cancela um envio em partes, liberando o espaço já ocupado no armazenamento. */
export async function abortarEnvio(mediaId: string) {
  await fetch(`/api/medias/${mediaId}/partes`, { method: "DELETE" }).catch(() => {});
}
