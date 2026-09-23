import { zipEmFluxo, tamanhoDoZip, type ArquivoDoZip } from "../src/lib/zip-em-fluxo.ts";
import type { ArquivoDoManifesto, Manifesto } from "../src/lib/zip-remoto.ts";
import { CONFIG } from "./config.ts";

/**
 * O MONTADOR: transforma um manifesto num fluxo de bytes de ZIP.
 *
 * O escritor do formato é o mesmo do app (`lib/zip-em-fluxo.ts`) — um ZIP que
 * o servidor monta e outro que a reserva do VPS monta têm de abrir igual, e a
 * forma de garantir isso é ser o mesmo código.
 *
 * O que este arquivo acrescenta é o jeito de BUSCAR cada original:
 *
 *   · com nova tentativa: uma foto que falha no meio não derruba um ZIP de
 *     20 GB. Três tentativas, com espera crescente;
 *   · com URL renovada: as URLs assinadas valem 6 h, e um ZIP grande numa
 *     conexão lenta pode passar disso. Um 403 no meio pede o manifesto de novo;
 *   · com busca à frente: o B2 está a ~150-220 ms daqui, e cada foto é um
 *     pedido novo. Abrir as próximas N enquanto a atual é escrita é o que faz
 *     um ZIP de 3 000 fotos de 3 MB não gastar metade do tempo esperando.
 */

const TENTATIVAS = 3;
const ESPERAS_MS = [1_000, 4_000];

/** Um original aberto — o corpo ainda não foi lido. */
interface Aberto {
  corpo: AsyncIterable<Uint8Array>;
  status: number;
}

async function abrir(url: string, tamanho: number): Promise<Aberto> {
  /* Tempo para os CABEÇALHOS chegarem; o corpo é regulado pelo consumo. */
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok || !r.body) {
    await r.body?.cancel().catch(() => {});
    return { corpo: (async function* () {})(), status: r.status };
  }
  const declarado = Number(r.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > 0 && declarado !== tamanho) {
    await r.body.cancel().catch(() => {});
    throw new Error(`o armazém diz ${declarado} bytes, o banco diz ${tamanho}`);
  }
  return { corpo: r.body as unknown as AsyncIterable<Uint8Array>, status: r.status };
}

export interface FonteDeUrls {
  /** Chamado quando uma URL venceu no meio da montagem: devolve o manifesto renovado. */
  renovar: () => Promise<Manifesto>;
}

/**
 * Cada arquivo do manifesto, como `zipEmFluxo` quer — com as buscas à frente.
 *
 * A "janela" é uma lista de promessas de abertura: quando a foto i entra na
 * vez, as fotos i+1..i+N já foram pedidas. Se uma abertura à frente falhar, o
 * erro só é visto na vez dela, e a nova tentativa acontece ali.
 */
export function arquivosDoManifesto(manifesto: Manifesto, fonte: FonteDeUrls): ArquivoDoZip[] {
  let urls = manifesto.arquivos.map((a) => a.url ?? "");
  const janela = new Map<number, Promise<Aberto>>();

  const pedir = (i: number) => {
    if (!janela.has(i) && i < urls.length) {
      const p = abrir(urls[i], manifesto.arquivos[i].tamanho);
      p.catch(() => {}); // a rejeição é tratada na vez dele
      janela.set(i, p);
    }
  };

  async function renovarUrls() {
    const novo = await fonte.renovar();
    urls = novo.arquivos.map((a) => a.url ?? "");
    janela.clear();
  }

  return manifesto.arquivos.map((a: ArquivoDoManifesto, i: number) => ({
    nome: a.nome,
    tamanho: a.tamanho,
    abrir: async function* () {
      for (let tentativa = 1; ; tentativa++) {
        pedir(i);
        for (let j = 1; j <= CONFIG.buscasParalelas; j++) pedir(i + j);
        try {
          const aberto = await janela.get(i)!;
          janela.delete(i);
          if (aberto.status === 403 || aberto.status === 401) {
            /* A URL venceu — 6 h se passaram. Renova todas e tenta de novo,
               sem gastar uma das tentativas: não foi falha, foi o tempo. */
            await renovarUrls();
            tentativa--;
            continue;
          }
          if (aberto.status !== 200) throw new Error(`HTTP ${aberto.status}`);
          for await (const pedaco of aberto.corpo) yield pedaco;
          return;
        } catch (e) {
          janela.delete(i);
          if (tentativa >= TENTATIVAS) {
            throw new Error(`"${a.nome}" não veio depois de ${TENTATIVAS} tentativas: ${(e as Error).message}`);
          }
          await new Promise((r) => setTimeout(r, ESPERAS_MS[tentativa - 1] ?? 4_000));
        }
      }
    },
  }));
}

export function tamanhoDoManifesto(manifesto: Manifesto): number {
  return tamanhoDoZip(manifesto.arquivos.map((a) => ({ nome: a.nome, tamanho: a.tamanho, abrir: vazio })));
}

async function* vazio(): AsyncIterable<Uint8Array> {}

export function fluxoDoManifesto(manifesto: Manifesto, fonte: FonteDeUrls): AsyncGenerator<Uint8Array> {
  return zipEmFluxo(arquivosDoManifesto(manifesto, fonte));
}
