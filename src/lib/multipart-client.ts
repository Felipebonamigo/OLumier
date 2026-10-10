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
        /* Definitivo para a PARTE (insistir não faz o cabeçalho aparecer) e
           marcado `semEtag` para quem enviou o arquivo poder voltar ao PUT
           único — ver `enviarEmPartes`. */
        return reject(
          Object.assign(new Error("o armazenamento não devolveu o ETag da parte"), {
            definitivo: true,
            semEtag: true,
          }),
        );
      }
      resolve(etag);
    });
    xhr.addEventListener("error", () => reject(new Error("conexão interrompida")));
    xhr.addEventListener("abort", () => reject(new Error("envio cancelado")));
    xhr.send(pedaco);
  });
}

/**
 * Por que um envio em partes caiu, para quem chamou decidir o que fazer.
 *
 * - `semEtag`: o CORS do bucket não expõe o ETag, e nenhuma parte vai fechar.
 *   Abaixo de 5 GB o arquivo cabe no PUT único, e a fila volta ao caminho de
 *   antes em vez de falhar — ver `envio-em-curso.tsx`.
 * - `reabrir`: o envio deste `mediaId` não existe mais (o fechamento falhou e
 *   o servidor apagou a mídia). Insistir com o mesmo id é 404 para sempre; a
 *   próxima tentativa precisa preparar de novo.
 *
 * Nenhum dos dois é `definitivo`: a retentativa do arquivo tem de continuar.
 */
export type FalhaDasPartes = Error & { semEtag?: boolean; reabrir?: boolean };

function falha(mensagem: string, marca: { semEtag?: boolean; reabrir?: boolean }): FalhaDasPartes {
  return Object.assign(new Error(mensagem), marca);
}

export async function enviarEmPartes(
  mediaId: string,
  arquivo: File,
  tamanhoParte: number,
  aoProgredir: (pct: number) => void,
  /*
   * As partes que JÁ SUBIRAM numa tentativa anterior deste mesmo envio.
   *
   * Até aqui, uma parte que esgotasse as retentativas derrubava o envio, e a
   * tentativa seguinte do arquivo recomeçava da parte 1. Quem chama guarda
   * este mapa entre as tentativas (e o esvazia quando o envio é reaberto), e
   * as partes prontas não sobem de novo: o upload continua aberto no armazém
   * até ser fechado ou abortado.
   */
  prontas: Map<number, string> = new Map(),
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
      /* 404: o envio não está mais aberto. Definitivo para a parte — a
         retentativa dela não traria o envio de volta. */
      if (r.status === 404) {
        const perdido = falha(e.erro ?? "o envio em partes não está mais aberto", { reabrir: true });
        throw Object.assign(perdido, { definitivo: true });
      }
      throw new Error(e.erro ?? "não consegui preparar as partes");
    }
    const { urls } = (await r.json()) as { urls: { numero: number; url: string }[] };
    for (const u of urls) urlPorNumero.set(u.numero, u.url);
    lotesPedidos.add(lote);
  };

  const tamanhoDa = (numero: number) =>
    Math.min(numero * tamanhoParte, arquivo.size) - (numero - 1) * tamanhoParte;
  const faltam = numeros.filter((n) => !prontas.has(n));
  let bytesEnviados = numeros.filter((n) => prontas.has(n)).reduce((soma, n) => soma + tamanhoDa(n), 0);
  if (bytesEnviados > 0) aoProgredir(Math.min(99, Math.round((bytesEnviados / arquivo.size) * 100)));

  try {
    await emParalelo(faltam, PARTES_PARALELAS, async (numero) => {
      const inicio = (numero - 1) * tamanhoParte;
      const pedaco = arquivo.slice(inicio, Math.min(inicio + tamanhoParte, arquivo.size));
      await pedirLote(numero);

      const avancar = (delta: number) => {
        bytesEnviados += delta;
        aoProgredir(Math.min(99, Math.round((bytesEnviados / arquivo.size) * 100)));
      };

      // Retentativa por PARTE: uma queda de rede reenvia uma parte, não o filme todo.
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
      prontas.set(numero, etag);
    });
  } catch (e) {
    /* As duas marcas valem para o ARQUIVO, e lá não podem chegar como
       `definitivo` — senão a fila desistiria do arquivo na hora, e o que se
       quer é voltar ao PUT único ou preparar de novo. */
    const marca = e as FalhaDasPartes;
    if (marca?.semEtag || marca?.reabrir) {
      throw falha(marca.message, { semEtag: marca.semEtag, reabrir: marca.reabrir });
    }
    throw e;
  }

  const enviadas: ParteEnviada[] = numeros
    .filter((n) => prontas.has(n))
    .map((numero) => ({ numero, etag: prontas.get(numero)! }));
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
    const mensagem = e.erro ?? "não consegui finalizar o envio";
    /* 507: o filme montado não coube no plano — o servidor já apagou, e
       insistir dá a mesma resposta. 5xx: a remontagem falhou e a rota apagou a
       mídia; a próxima tentativa prepara de novo. O resto (404 incluído) segue
       como erro comum: um 404 aqui pode ser o fechamento que DEU CERTO e cuja
       resposta se perdeu, e preparar de novo subiria o filme em dobro. */
    if (fim.status === 507) throw Object.assign(new Error(mensagem), { definitivo: true });
    if (fim.status >= 500) throw falha(mensagem, { reabrir: true });
    throw new Error(mensagem);
  }
  aoProgredir(100);
}

/** Cancela um envio em partes, liberando o espaço já ocupado no armazenamento. */
export async function abortarEnvio(mediaId: string) {
  await fetch(`/api/medias/${mediaId}/partes`, { method: "DELETE" }).catch(() => {});
}
