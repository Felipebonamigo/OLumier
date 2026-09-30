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
 *     pedido novo. BAIXAR as próximas N enquanto a atual é escrita é o que faz
 *     um ZIP de 3 000 fotos de 3 MB não gastar o tempo esperando.
 *
 * ── ABRIR NÃO É BAIXAR (30/09/2026) ───────────────────────────────────────
 *
 * A busca à frente só ABRIA as próximas fotos: o pedido saía, os cabeçalhos
 * chegavam, e o corpo ficava parado até a vez dela — o TCP não traz mais do
 * que cabe no buffer de uma conexão que ninguém lê (~128 KB). Na prática o
 * ZIP descia do B2 UMA FOTO POR VEZ, atravessando o Atlântico. Medido pelo
 * Felipe na mesma galeria de 527 MB: 326 KB/s no primeiro download (montando)
 * contra 2,4 MB/s no segundo (do disco). A diferença inteira era esta.
 *
 * Agora a foto que cabe na memória é baixada INTEIRA na busca à frente, e N
 * fotos descem ao mesmo tempo. O teto de memória é `CONFIG.memoriaAFrente`;
 * arquivo grande (vídeo) continua só aberto, e desce em fluxo na vez dele.
 */

const TENTATIVAS = 3;
const ESPERAS_MS = [1_000, 4_000];
/** Até este tamanho a foto é lida inteira antes de ir para o ZIP — ver `abrir`. */
const TETO_EM_MEMORIA = 64 * 1024 * 1024;
/** Sem nenhum byte novo por este tempo, a conexão é dada como morta. */
const SEM_NOTICIA_MS = 60_000;

/**
 * Um original buscado. Foto que cabe na memória chega com os `pedacos` —
 * baixada inteira e conferida. Arquivo grande chega com a `resposta` ainda por
 * ler, e desce em fluxo na vez dele.
 *
 * Guarda a RESPOSTA inteira, não só o corpo: o `fetch` do Node cancela a
 * conexão de uma resposta que o coletor de lixo recolhe, e um arquivo aberto à
 * frente fica minutos esperando a vez. Segurar só o `body` deixava a resposta
 * solta, e a foto "chegava com 0 bytes" (visto em produção em 23/09/2026).
 */
interface Aberto {
  status: number;
  pedacos?: Uint8Array[];
  resposta?: Response;
}

async function abrir(url: string, tamanho: number): Promise<Aberto> {
  /*
   * O relógio mede SILÊNCIO, não duração: rearma a cada pedaço que chega. Uma
   * foto que desce devagar mas desce não é cortada; uma conexão parada, é.
   *
   * No arquivo grande ele vale só até os CABEÇALHOS: o corpo fica parado de
   * propósito até a vez dele, que pode demorar minutos — era cortado no meio
   * quando o prazo valia para tudo.
   */
  const controle = new AbortController();
  let relogio = setTimeout(() => controle.abort(), SEM_NOTICIA_MS);
  const rearmar = () => {
    clearTimeout(relogio);
    relogio = setTimeout(() => controle.abort(), SEM_NOTICIA_MS);
  };
  try {
    const r = await fetch(url, { signal: controle.signal });
    if (!r.ok || !r.body) {
      await r.body?.cancel().catch(() => {});
      return { status: r.status };
    }
    const declarado = Number(r.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > 0 && declarado !== tamanho) {
      await r.body.cancel().catch(() => {});
      throw new Error(`o armazém diz ${declarado} bytes, o banco diz ${tamanho}`);
    }
    if (tamanho > TETO_EM_MEMORIA) return { status: r.status, resposta: r };

    /*
     * O que CHEGOU tem de ser o que o banco diz, e a conferência é aqui, antes
     * de qualquer byte ir para o ZIP: `zipEmFluxo` também confere, mas lá já é
     * tarde — o cabeçalho da foto já saiu e o ZIP inteiro morre. Aqui, um
     * corpo vazio ou cortado é só mais uma falha de rede, e ganha nova
     * tentativa na vez da foto.
     */
    const pedacos: Uint8Array[] = [];
    let lidos = 0;
    rearmar();
    for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) {
      lidos += pedaco.length;
      pedacos.push(pedaco);
      rearmar();
    }
    if (lidos !== tamanho) throw new Error(`chegou com ${lidos} bytes, e o banco diz ${tamanho}`);
    return { status: r.status, pedacos };
  } finally {
    clearTimeout(relogio);
  }
}

/** Quanto da memória a busca à frente ocupa se as fotos de i+1 a i+j vierem. */
function naMemoria(arquivos: ArquivoDoManifesto[], i: number, j: number): number {
  let soma = 0;
  for (let k = i + 1; k <= i + j && k < arquivos.length; k++) {
    if (arquivos[k].tamanho <= TETO_EM_MEMORIA) soma += arquivos[k].tamanho;
  }
  return soma;
}

export interface FonteDeUrls {
  /** Chamado quando uma URL venceu no meio da montagem: devolve o manifesto renovado. */
  renovar: () => Promise<Manifesto>;
}

/**
 * Cada arquivo do manifesto, como `zipEmFluxo` quer — com as buscas à frente.
 *
 * A "janela" é uma lista de promessas de busca: quando a foto i entra na vez,
 * as fotos i+1..i+N já estão descendo (ou já desceram). Se uma busca à frente
 * falhar, o erro só é visto na vez dela, e a nova tentativa acontece ali.
 *
 * N é `CONFIG.buscasParalelas`, e para antes se as fotos à frente somarem mais
 * que `CONFIG.memoriaAFrente` — uma sequência de vídeos de 60 MB não pode
 * encher a máquina. A próxima foto é pedida sempre.
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
        for (let j = 1; j <= CONFIG.buscasParalelas; j++) {
          if (j > 1 && naMemoria(manifesto.arquivos, i, j) > CONFIG.memoriaAFrente) break;
          pedir(i + j);
        }
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
          if (aberto.pedacos) {
            for (const pedaco of aberto.pedacos) yield pedaco;
            return;
          }
          /*
           * Arquivo grande: em fluxo. Os bytes já entregues não voltam — se a
           * falha for no meio, o ZIP está perdido de qualquer jeito, e conta
           * com a conferência do escritor. Por isso só vai assim o que não
           * cabe na memória.
           */
          if (!aberto.resposta?.body) throw new Error(`HTTP ${aberto.status} sem corpo`);
          let lidos = 0;
          for await (const pedaco of aberto.resposta.body as unknown as AsyncIterable<Uint8Array>) {
            lidos += pedaco.length;
            yield pedaco;
          }
          if (lidos !== a.tamanho) {
            throw new Error(`chegou com ${lidos} bytes, e o banco diz ${a.tamanho}`);
          }
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
  /* Data fixa por conteúdo: remontar dá os mesmos bytes (ver OpcoesDoZip.data).
     Um app mais velho que não manda a data cai na hora da montagem. */
  const data = manifesto.dataDoConteudo ? new Date(manifesto.dataDoConteudo) : undefined;
  return zipEmFluxo(arquivosDoManifesto(manifesto, fonte), { data });
}
