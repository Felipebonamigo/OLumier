/**
 * Salvar fotos no celular.
 *
 * A dor real: no iPhone, um download normal vai para o app Arquivos, não para o
 * rolo da câmera — e o convidado acha que "não baixou". Nenhum site consegue
 * gravar direto nas Fotos: o navegador não dá essa permissão a ninguém (o
 * Pixieset sofre do mesmo).
 *
 * No iPhone, o que dá para fazer é abrir o menu NATIVO de compartilhamento com
 * o arquivo já em mãos. Ali existe "Salvar N imagens", que grava nas Fotos.
 *
 * No Android, não: o Chrome recusa o menu com mais de 10 arquivos e o menu dele
 * nem tem "salvar na galeria". Lá a foto vai por download comum, para a pasta
 * Download — que a Galeria e o Google Fotos mostram. Ver `lib/modo-de-entrega.ts`.
 *
 * Roda no cliente; não importar em código de servidor.
 */
import type { ModoDeEntrega } from "./modo-de-entrega";

/**
 * Quantas fotos cabem num único menu de compartilhamento sem travar o celular.
 *
 * ── DE 20 PARA 40, COM MEDIÇÃO (10/09/2026) ──────────────────────────────
 *
 * A medição, no banco de produção em 10/09/2026 (3.929 fotos de galerias
 * publicadas): média 3,05 MB por foto, mediana 1,95 MB, p90 7,08 MB, p99
 * 14,13 MB, maior arquivo 21,41 MB, zero vídeos. Com 20 por lote, a média real
 * ocupava 61 MB de um orçamento de 150 MB. Com 40 o pico de memória NÃO muda,
 * porque quem manda continua sendo `ORCAMENTO_LOTE`.
 *
 * `testar-salvar-mobile.mjs` prende a regra de que 40 × 3,05 MB tem de caber
 * nos 150 MB do orçamento. Subir mais exige medir num iPhone de verdade: o
 * WebKit copia o lote ao abrir o menu, e ninguém mediu onde a aba cai.
 *
 * Quando o aparelho não aguenta, o menu recusa com "Abort due to error while
 * reading files." — e `entregarTudo` reparte o lote ao meio, num toque novo.
 */
export const LOTE_MAXIMO = 40;

/**
 * Teto de MEMÓRIA por lote, e por arquivo.
 *
 * Contar arquivos não basta: para abrir o menu nativo é preciso ter os arquivos
 * carregados como Blob, ou seja, na memória. Um único vídeo de casamento passa
 * de 5 GB e derrubaria a aba do celular na hora.
 *
 * Arquivo acima do teto individual nem tenta o menu: vai pelo download comum,
 * que o navegador transmite direto para o disco sem passar pela memória.
 */
export const ORCAMENTO_LOTE = 150 * 1024 * 1024;
export const LIMITE_POR_ARQUIVO = 80 * 1024 * 1024;

/**
 * O QUE FICA REGISTRADO NA ATIVIDADE quando uma entrega em lote acontece.
 *
 * "Baixou tudo" é prova de entrega: é o que o fotógrafo lê quando o cliente
 * diz que não recebeu. Se baixar UMA pasta contasse como baixar tudo, a
 * Atividade afirmaria que o casal levou o casamento inteiro quando levou a
 * cerimônia.
 *
 * Decide pelo TAMANHO DO PEDIDO, e não pelo botão clicado: numa galeria de um
 * capítulo só, baixar "Cerimônia" é baixar a galeria. Número subestimado é
 * lacuna, número inflado é mentira.
 */
export function acaoDeEntrega(pedidas: number, totalDaGaleria: number) {
  return pedidas >= totalDaGaleria ? "baixou_tudo" : "baixou";
}

/** Uma foto da lista de entrega — ver `api/g/[id]/lista`. */
export interface FotoParaEntregar {
  id: string;
  /** O nome com que o arquivo chega, já com o capítulo quando cabe. */
  nome: string;
  bytes: number;
}

/**
 * Divide a lista em lotes que cabem na memória, e separa o que é grande demais
 * para o menu nativo. `teto` desce quando o aparelho já recusou um lote.
 */
export function montarLotes<T extends { bytes: number }>(
  arquivos: T[],
  teto = LOTE_MAXIMO,
): { lotes: T[][]; grandes: T[] } {
  const grandes = arquivos.filter((a) => a.bytes > LIMITE_POR_ARQUIVO);
  const cabem = arquivos.filter((a) => a.bytes <= LIMITE_POR_ARQUIVO);

  const lotes: T[][] = [];
  let atual: T[] = [];
  let soma = 0;

  for (const a of cabem) {
    const estouraria = soma + a.bytes > ORCAMENTO_LOTE || atual.length >= teto;
    if (atual.length > 0 && estouraria) {
      lotes.push(atual);
      atual = [];
      soma = 0;
    }
    atual.push(a);
    soma += a.bytes;
  }
  if (atual.length > 0) lotes.push(atual);

  return { lotes, grandes };
}

/** Quantos toques a entrega pelo menu vai pedir — dito antes de começar. */
export function partesPrevistas(fotos: { bytes: number }[]): number {
  return montarLotes(fotos).lotes.length;
}

/** "6,4 GB", "915 MB" — em unidades de 1000, como o próprio celular mostra. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  }
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** O navegador sabe compartilhar ARQUIVO (não só link)? */
export function podeCompartilharArquivos(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    const teste = new File([new Blob(["x"])], "t.jpg", { type: "image/jpeg" });
    return navigator.canShare({ files: [teste] });
  } catch {
    return false;
  }
}

/**
 * Como ESTE aparelho recebe as fotos. O servidor chuta pelo user-agent
 * (`modoPeloUserAgent`); aqui a resposta vem de recurso e de tela de toque.
 */
export function modoDeEntrega(): ModoDeEntrega {
  if (typeof navigator === "undefined") return "computador";
  // Ponteiro grosso = dedo. Notebook com tela sensível não tem UA de celular.
  const toque = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (!toque) return "computador";

  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "download";

  /* iPadOS 13+ manda o MESMO user-agent do Safari do Mac. O que o denuncia é a
     tela de toque — Mac nenhum tem mais de um ponto. */
  const ipadComCaraDeMac = /macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if ((/iphone|ipad|ipod/i.test(ua) || ipadComCaraDeMac) && podeCompartilharArquivos()) {
    return "menu";
  }
  /* iPhone sem Web Share de arquivo (iOS < 15): download solto vai para o
     Arquivos com um diálogo por foto — o zip é menos pior. */
  return "computador";
}

/** Busca o original para a memória. Lança em qualquer falha — quem chama decide. */
export async function buscarFoto(url: string, sinal?: AbortSignal): Promise<Blob> {
  const r = await fetch(url, { signal: sinal });
  if (!r.ok) throw new Error(`não consegui buscar a foto (HTTP ${r.status})`);
  return r.blob();
}

/**
 * - `salvou`         — o menu nativo abriu e a pessoa concluiu
 * - `cancelou`       — fechou o menu; NÃO é erro
 * - `falhou-leitura` — o aparelho não conseguiu ler os arquivos (memória)
 * - `sem-suporte`    — navegador não compartilha arquivo; cai no download comum
 * - `expirou`        — o navegador recusou o menu (gesto expirado ou lista longa)
 * - `sem-acesso`     — não consegui buscar o arquivo (CORS ou rede)
 */
export type ResultadoSalvar =
  | "salvou"
  | "cancelou"
  | "falhou-leitura"
  | "sem-suporte"
  | "expirou"
  | "sem-acesso";

/**
 * Abre o menu com o que JÁ está na memória. Precisa ser chamada de dentro de um
 * gesto do usuário.
 *
 * ── UMA CHAMADA POR TOQUE, E NUNCA DUAS (16/09/2026) ─────────────────────
 *
 * Aqui morava uma "partição ao meio": quando a lista era recusada, partia e
 * chamava `share()` de novo. Nos dois motores a ativação do toque é consumida
 * na PRIMEIRA chamada (Navigator.cpp:183 no WebKit, navigator_share.cc:258 no
 * Blink), então a segunda era sempre recusada — e o lote inteiro caía no
 * download um a um. E ela nem disparava: `canShare()` não confere quantidade
 * nem tamanho em navegador nenhum. Quem reparte agora é `entregarTudo`, e cada
 * metade ganha o seu próprio toque.
 *
 * O WebKit usa o mesmo AbortError para "fechou o menu" e para "não consegui ler
 * os arquivos" (ShareDataReader.cpp). O segundo é memória, e tratá-lo como
 * cancelamento fazia a entrega parar muda.
 */
export async function compartilharPreparado(prontos: File[]): Promise<ResultadoSalvar> {
  if (!podeCompartilharArquivos()) return "sem-suporte";
  if (prontos.length === 0) return "salvou";
  try {
    await navigator.share({ files: prontos });
    return "salvou";
  } catch (e) {
    if (e instanceof DOMException) {
      if (e.name === "AbortError") {
        return /reading files/i.test(e.message) ? "falhou-leitura" : "cancelou";
      }
      if (e.name === "NotAllowedError") return "expirou";
    }
    throw e;
  }
}

/** UMA foto: busca e abre o menu em sequência — a busca é curta e o gesto costuma sobreviver. */
export async function salvarNoCelular(
  arquivos: { url: string; nome: string }[],
): Promise<ResultadoSalvar> {
  if (!podeCompartilharArquivos()) return "sem-suporte";

  const prontos: File[] = [];
  try {
    for (const a of arquivos) {
      const blob = await buscarFoto(a.url);
      prontos.push(new File([blob], a.nome, { type: blob.type || "image/jpeg" }));
    }
  } catch {
    /*
     * A causa mais provável não é rede: é CORS. O endereço do estúdio é uma
     * origem diferente do domínio principal. Quem chama cai no download comum —
     * que funciona, porque é navegação e não passa por CORS.
     */
    return "sem-acesso";
  }

  return compartilharPreparado(prontos);
}

/**
 * O desfecho de UMA foto conta como entrega?
 *
 * Só "cancelou" não conta — a pessoa viu o menu e fechou, e nada saiu. Os
 * outros desfechos ruins caem no download comum, que entrega.
 */
export const entregouUmaFoto = (r: ResultadoSalvar): boolean => r !== "cancelou";

/**
 * A pausa entre um download e o outro.
 *
 * Downloads disparados todos juntos são descartados. Com a pausa, o Chrome do
 * Android pergunta UMA vez "permitir vários downloads?" e, com "Permitir",
 * segue sem perguntar de novo (download_request_limiter.cc).
 */
export const PAUSA_ENTRE_DOWNLOADS = 700;

/** Quantos links se assinam de uma vez no download direto. */
const BLOCO_DE_ASSINATURA = 100;

/** Uma foto que não veio é tentada de novo antes de desistir — rede de salão de festa. */
const ESPERAS_ENTRE_TENTATIVAS = [800, 2400];

export interface ProgressoDaEntrega {
  /** Fotos entregues, contando as de uma entrega anterior que foi retomada. */
  feitas: number;
  total: number;
  /** Lote atual e quantos se preveem (no download direto, sempre 1 de 1). */
  parte: number;
  partes: number;
  fase: "preparando" | "sua-vez" | "baixando";
  /** Quantas fotos do lote atual já estão na memória. */
  preparadas: number;
  doLote: number;
}

export interface GanchosDaEntrega {
  modo: "menu" | "download";
  /** Links do original para estes ids. Id que não volta é foto que não vem. */
  assinar: (ids: string[]) => Promise<Map<string, string>>;
  /** Busca uma foto para a memória. O sinal cancela a busca que está no meio. */
  buscar: (url: string, sinal?: AbortSignal) => Promise<Blob>;
  /** Mostra o botão e espera o toque — é dentro dele que `compartilhar` roda. */
  pedirToque: (p: ProgressoDaEntrega) => Promise<"seguir" | "parar">;
  compartilhar: (arquivos: File[]) => Promise<ResultadoSalvar>;
  baixar: (url: string, nome: string) => void;
  esperar: (ms: number) => Promise<void>;
  aoProgredir?: (p: ProgressoDaEntrega) => void;
  /** Chamado a cada entrega confirmada — é o que permite retomar depois. */
  aoEntregar?: (ids: string[]) => void;
  /** Ids entregues numa tentativa anterior: não são buscados de novo. */
  jaEntregues?: ReadonlySet<string>;
  /** A pessoa pediu para parar: consultado a cada foto e antes de cada toque. */
  sinal?: AbortSignal;
}

export interface DesfechoEntrega {
  /** Entregues NESTA rodada. Zero é uma resposta legítima. */
  entregues: number;
  /** Já tinham ido numa rodada anterior e foram puladas. */
  jaTinham: number;
  total: number;
  /** A pessoa fechou o menu ou pediu para parar. Não é erro. */
  cancelado: boolean;
  /** Os links não vieram nem tentando de novo — rede ou servidor, não a pessoa. */
  parouPorFalha: boolean;
  /** Ids que não vieram mesmo tentando de novo — ficam para a próxima vez. */
  falharam: string[];
  /** Entregues pelo menu do sistema (app Fotos) e por download (Arquivos). */
  pelaFolha: number;
  porDownload: number;
  /** O que dizer sobre ONDE as fotos foram parar, ou `null`. */
  aviso: string | null;
  /** Todas as fotos do pedido já saíram, nesta rodada ou antes. */
  completo: boolean;
}

/* Uma frase só para os desfechos que caem no download comum: o lugar onde o
   arquivo termina é o mesmo, e é essa a dúvida de quem está com o celular. */
const AVISO_ARQUIVOS = "algumas foram como download — procure em Arquivos ou Downloads";

/**
 * Entrega uma lista inteira ao celular, e DIZ o que aconteceu.
 *
 * ── POR QUE A ORQUESTRAÇÃO MORA AQUI (05/09/2026) ─────────────────────────
 *
 * O Juan tentou baixar tudo no celular, não veio nada, e a aba Atividade marcou
 * 1 download: o registro contava o CLIQUE. Aqui a pergunta "quantos saíram?"
 * tem resposta, e ela pode ser zero. É função pura com ganchos para que
 * `testar-salvar-mobile.mjs` pergunte "e se a pessoa fechar o menu?" sem um
 * celular na mão.
 *
 * ── O QUE MUDOU EM 16/09/2026 ─────────────────────────────────────────────
 *
 *   · a lista vem INTEIRA do servidor, não da fatia da tela;
 *   · cada lote assina os seus links na hora (antes, todos no começo — e numa
 *     entrega de horas os últimos venciam);
 *   · o que já foi entregue antes é pulado: recarregar a página recomeçava da
 *     foto 1 e duplicava fotos no rolo da câmera;
 *   · uma foto que falha é tentada de novo, e se não vier fica de fora sem
 *     derrubar o lote para o download um a um;
 *   · "não consegui ler os arquivos" reparte o lote, com um toque por metade;
 *   · no Android, download direto — ver `lib/modo-de-entrega.ts`.
 *
 * ── LINK QUE NÃO VEM NÃO É CORS (revisão do mesmo dia) ────────────────────
 *
 * Os links vêm da nossa própria rota, mesma origem: se ela falha, é rede ou
 * servidor reiniciando. A primeira versão lia "nenhum link" como o CORS do
 * endereço do estúdio e mandava o RESTO da galeria para o download comum — no
 * iPhone, para o app Arquivos —, marcando tudo como entregue. Agora a
 * assinatura é tentada de novo e, se não vier, a entrega PARA e diz onde. CORS
 * só se conclui com links em mãos e buscas falhando.
 *
 * O que esta função NÃO promete: que o arquivo chegou ao disco. Download comum
 * é disparar e soltar; `entregues` conta o que foi passado adiante.
 */
export async function entregarTudo(
  fotos: FotoParaEntregar[],
  g: GanchosDaEntrega,
): Promise<DesfechoEntrega> {
  const ja = g.jaEntregues ?? new Set<string>();
  const pendentes = fotos.filter((f) => !ja.has(f.id));
  const total = fotos.length;
  const jaTinham = total - pendentes.length;

  let entregues = 0;
  let pelaFolha = 0;
  let porDownload = 0;
  const falharam: string[] = [];
  let aviso: string | null = null;

  const feitas = () => jaTinham + entregues;
  const fim = (como: "terminou" | "parou" | "falhou"): DesfechoEntrega => ({
    entregues,
    jaTinham,
    total,
    cancelado: como === "parou",
    parouPorFalha: como === "falhou",
    falharam,
    pelaFolha,
    porDownload,
    aviso,
    completo: feitas() === total,
  });
  const entregar = (ids: string[], por: "folha" | "download") => {
    entregues += ids.length;
    if (por === "folha") pelaFolha += ids.length;
    else porDownload += ids.length;
    g.aoEntregar?.(ids);
  };

  /** Assina com novas tentativas. `null` quando nem assim veio. */
  const assinar = async (ids: string[]): Promise<Map<string, string> | null> => {
    for (let tentativa = 0; tentativa <= ESPERAS_ENTRE_TENTATIVAS.length; tentativa++) {
      if (g.sinal?.aborted) return null;
      try {
        return await g.assinar(ids);
      } catch {
        if (tentativa < ESPERAS_ENTRE_TENTATIVAS.length) {
          await g.esperar(ESPERAS_ENTRE_TENTATIVAS[tentativa]);
        }
      }
    }
    return null;
  };
  const parouOuFalhou = () => (g.sinal?.aborted ? "parou" : "falhou");

  /** Download comum, um atrás do outro. */
  const baixarEmSequencia = async (
    lista: FotoParaEntregar[],
    aoBaixar: () => void,
  ): Promise<"terminou" | "parou" | "falhou"> => {
    for (let i = 0; i < lista.length; i += BLOCO_DE_ASSINATURA) {
      const bloco = lista.slice(i, i + BLOCO_DE_ASSINATURA);
      const links = await assinar(bloco.map((f) => f.id));
      if (!links) return parouOuFalhou();
      for (const f of bloco) {
        if (g.sinal?.aborted) return "parou";
        const url = links.get(f.id);
        if (!url) {
          falharam.push(f.id);
          continue;
        }
        g.baixar(url, f.nome);
        entregar([f.id], "download");
        aoBaixar();
        /* A pausa vem DEPOIS de cada arquivo, inclusive do último: 700 ms a
           mais no fim custam menos que um caso especial. */
        await g.esperar(PAUSA_ENTRE_DOWNLOADS);
      }
    }
    return "terminou";
  };

  if (pendentes.length === 0) return fim("terminou");

  /* ── Android: download direto, sem memória e sem toque por lote ───────── */
  if (g.modo === "download") {
    const avisar = () =>
      g.aoProgredir?.({
        feitas: feitas(),
        total,
        parte: 1,
        partes: 1,
        fase: "baixando",
        preparadas: 0,
        doLote: 0,
      });
    avisar();
    return fim(await baixarEmSequencia(pendentes, avisar));
  }

  /* ── iPhone: lotes pelo menu, um toque cada ──────────────────────────── */
  const grandes = pendentes.filter((f) => f.bytes > LIMITE_POR_ARQUIVO);
  let fila = pendentes.filter((f) => f.bytes <= LIMITE_POR_ARQUIVO);
  let teto = LOTE_MAXIMO;
  let parte = 0;

  if (grandes.length > 0) {
    aviso = AVISO_ARQUIVOS;
    const como = await baixarEmSequencia(grandes, () => {});
    if (como !== "terminou") return fim(como);
  }

  while (fila.length > 0) {
    const lote = montarLotes(fila, teto).lotes[0];
    fila = fila.slice(lote.length);
    parte++;
    const partes = parte + montarLotes(fila, teto).lotes.length;
    const avisar = (fase: ProgressoDaEntrega["fase"], preparadas: number) =>
      g.aoProgredir?.({ feitas: feitas(), total, parte, partes, fase, preparadas, doLote: lote.length });
    avisar("preparando", 0);

    const links = await assinar(lote.map((f) => f.id));
    if (!links) return fim(parouOuFalhou());

    const prontos: { foto: FotoParaEntregar; arquivo: File }[] = [];
    /* Só as que tinham link e mesmo assim não vieram — é isso que aponta CORS.
       Id sem link não é bloqueio de acesso: é foto que saiu da galeria. */
    const semVir: FotoParaEntregar[] = [];
    for (const f of lote) {
      if (g.sinal?.aborted) return fim("parou");
      const url = links.get(f.id);
      if (!url) {
        falharam.push(f.id);
        continue;
      }
      let blob: Blob | null = null;
      for (let tentativa = 0; tentativa <= ESPERAS_ENTRE_TENTATIVAS.length && !blob; tentativa++) {
        try {
          blob = await g.buscar(url, g.sinal);
        } catch {
          if (g.sinal?.aborted) return fim("parou");
          if (tentativa < ESPERAS_ENTRE_TENTATIVAS.length) {
            await g.esperar(ESPERAS_ENTRE_TENTATIVAS[tentativa]);
          }
        }
      }
      if (blob) {
        prontos.push({ foto: f, arquivo: new File([blob], f.nome, { type: blob.type || "image/jpeg" }) });
      } else {
        semVir.push(f);
        /* As duas primeiras não vieram e nenhuma veio: não é a foto, é o
           acesso (CORS do endereço do estúdio). Tentar as outras 38 custaria
           dois minutos antes de a pessoa ver qualquer coisa. */
        if (prontos.length === 0 && semVir.length >= 2) break;
      }
      avisar("preparando", prontos.length + semVir.length);
    }

    if (prontos.length === 0 && semVir.length >= 2) {
      /* Nada veio, com os links em mãos. O download comum é navegação e não
         passa por CORS — e o que barrou este lote barraria os próximos, então
         o RESTO vai por ele também. */
      aviso = AVISO_ARQUIVOS;
      const resto = [...lote.filter((f) => !falharam.includes(f.id)), ...fila];
      const avisarDownload = () =>
        g.aoProgredir?.({ feitas: feitas(), total, parte: 1, partes: 1, fase: "baixando", preparadas: 0, doLote: 0 });
      return fim(await baixarEmSequencia(resto, avisarDownload));
    }
    falharam.push(...semVir.map((f) => f.id));
    /* Uma foto sozinha que não veio não prova CORS: fica em falha e a entrega
       segue. Nada para mostrar no menu, nenhum toque a pedir. */
    if (prontos.length === 0) continue;

    /* "parar" tocado enquanto o lote era buscado: sem esta linha, a entrega só
       pararia no próximo botão — que ela mesma mostraria. */
    if (g.sinal?.aborted) return fim("parou");

    if ((await g.pedirToque({ feitas: feitas(), total, parte, partes, fase: "sua-vez", preparadas: prontos.length, doLote: lote.length })) === "parar") {
      return fim("parou");
    }

    let r: ResultadoSalvar;
    try {
      r = await g.compartilhar(prontos.map((p) => p.arquivo));
    } catch {
      r = "expirou";
    }

    if (r === "salvou") {
      entregar(prontos.map((p) => p.foto.id), "folha");
      avisar("preparando", prontos.length);
      continue;
    }
    // Fechou o menu: entende-se como "chega". O que já saiu continua contando.
    if (r === "cancelou") return fim("parou");

    if (r === "falhou-leitura" && prontos.length > 1) {
      /* Memória. Metade do tamanho daqui em diante, e o mesmo lote volta para
         a frente da fila — cada metade com o seu toque. */
      teto = Math.max(1, Math.floor(prontos.length / 2));
      fila = [...prontos.map((p) => p.foto), ...fila];
      parte--;
      continue;
    }

    /* "expirou", "sem-suporte" ou leitura falhando numa foto só: o menu não
       rolou, e as fotos não podem simplesmente não vir. */
    aviso = AVISO_ARQUIVOS;
    const como = await baixarEmSequencia(prontos.map((p) => p.foto), () => {});
    if (como !== "terminou") return fim(como);
  }

  return fim("terminou");
}

/**
 * O recado do painel quando a entrega termina — ou para. Uma função, e não um
 * ternário no componente, porque a revisão de 16/09/2026 achou dois recados
 * mentindo: "1 foto não veio — buscar só ela" com 2069 ainda por ir, e "estão no
 * app Fotos" com tudo tendo ido por download para o Arquivos.
 */
export function recadoDoFim(d: DesfechoEntrega, modo: "menu" | "download"): string | null {
  const foram = d.jaTinham + d.entregues;
  const naoVieram = d.falharam.length;
  const faltaSo = (n: number) =>
    `${n} ${n === 1 ? "foto não veio" : "fotos não vieram"} — toque em salvar de novo para buscar só ${n === 1 ? "ela" : "elas"}`;

  if (d.parouPorFalha) {
    return `a conexão caiu: parou em ${foram} de ${d.total} — toque em salvar de novo para continuar de onde parou`;
  }
  if (d.cancelado) {
    if (foram === 0) return null;
    const ressalva = naoVieram > 0 ? ` (${naoVieram} não vieram)` : "";
    return `parou em ${foram} de ${d.total}${ressalva} — toque em salvar de novo para continuar de onde parou`;
  }
  if (naoVieram > 0 && foram + naoVieram === d.total) return faltaSo(naoVieram);
  if (!d.completo) {
    return foram > 0
      ? `parou em ${foram} de ${d.total} — toque em salvar de novo para continuar de onde parou`
      : null;
  }

  if (modo === "download") {
    return `Pronto: ${d.total} fotos baixadas ✓ — estão na pasta Download (no Google Fotos, em Coleções › No dispositivo)`;
  }
  const onde =
    d.porDownload === 0
      ? "estão no app Fotos"
      : d.pelaFolha === 0
        ? "foram como download — estão no app Arquivos, em Downloads"
        : `${d.pelaFolha} no app Fotos e ${d.porDownload} como download, no app Arquivos`;
  return `Pronto: ${d.total} fotos salvas ✓ — ${onde}`;
}

/**
 * Quantos toques a entrega pelo menu vai pedir, pela conta que `montarLotes`
 * vai fazer: o lote fecha em 40 fotos OU no orçamento de memória. "Um toque a
 * cada 40 fotos" prometia 53 toques a quem tinha fotos de 8 MB e ia fazer 118.
 */
export function toquesPrevistos(quantas: number, bytes: number): number {
  if (quantas <= 0) return 0;
  const media = bytes / quantas;
  const porLote = Math.max(1, Math.min(LOTE_MAXIMO, Math.floor(ORCAMENTO_LOTE / Math.max(1, media))));
  return Math.ceil(quantas / porLote);
}

/**
 * O escopo do progresso das favoritas, sem o e-mail em texto: a chave fica no
 * armazenamento do aparelho — às vezes o tablet de um parente — por dias.
 * FNV-1a de 32 bits: não é segredo, é só não deixar o endereço legível.
 */
export function escopoDasFavoritas(email: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `favoritas:${h.toString(16).padStart(8, "0")}`;
}

/*
 * ── CONTINUAR DE ONDE PAROU ───────────────────────────────────────────────
 *
 * Uma entrega de 2108 fotos pelo iPhone são 53 toques. Recarregar a página no
 * meio — o Safari faz isso sozinho quando a pessoa troca de app — recomeçava
 * da foto 1 e duplicava no rolo tudo o que já tinha ido.
 *
 * Mora no `localStorage` do aparelho: é conveniência de quem está salvando, não
 * dado da galeria. Aba anônima e armazenamento bloqueado jogam exceção; aí a
 * entrega continua, só não retoma.
 */
export const PROGRESSO_VALE_POR = 7 * 24 * 3600 * 1000;

type Armazem = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const chaveDoProgresso = (galeriaId: string, escopo: string) =>
  `olumier:entrega:${galeriaId}:${escopo}`;

export function lerProgresso(
  armazem: Armazem | null,
  chave: string,
  agora: number = Date.now(),
): Set<string> {
  if (!armazem) return new Set();
  try {
    const bruto = armazem.getItem(chave);
    if (!bruto) return new Set();
    const dados = JSON.parse(bruto) as { em?: unknown; ids?: unknown };
    if (typeof dados.em !== "number" || agora - dados.em > PROGRESSO_VALE_POR) return new Set();
    if (!Array.isArray(dados.ids)) return new Set();
    return new Set(dados.ids.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function gravarProgresso(
  armazem: Armazem | null,
  chave: string,
  ids: Iterable<string>,
  agora: number,
) {
  if (!armazem) return;
  try {
    armazem.setItem(chave, JSON.stringify({ em: agora, ids: [...ids] }));
  } catch {
    /* Cheio ou bloqueado: a entrega segue sem poder retomar. */
  }
}

/**
 * O progresso de UMA entrega em curso: marca o que saiu e grava sem gravar a
 * cada foto — reescrever uma lista de 2108 ids 2108 vezes travaria a aba. Grava
 * no máximo a cada 1,5 s, e sempre quando `gravar()` é chamado no fim.
 */
export function gravadorDeProgresso(
  armazem: Armazem | null,
  chave: string,
  jaEntregues: Iterable<string>,
  relogio: () => number = Date.now,
) {
  const entregues = new Set(jaEntregues);
  let gravadoEm = -Infinity;
  const gravar = () => {
    const agora = relogio();
    gravarProgresso(armazem, chave, entregues, agora);
    gravadoEm = agora;
  };
  return {
    marcar(ids: string[]) {
      for (const id of ids) entregues.add(id);
      if (relogio() - gravadoEm >= 1500) gravar();
    },
    gravar,
  };
}

export function apagarProgresso(armazem: Armazem | null, chave: string) {
  if (!armazem) return;
  try {
    armazem.removeItem(chave);
  } catch {
    /* idem */
  }
}

/**
 * A tela não apaga enquanto as fotos estão saindo.
 *
 * Com a tela apagada o navegador congela a aba, e a entrega para sem aviso. O
 * sistema solta a trava quando a pessoa troca de app; ao voltar, pede de novo.
 * Safari 16.4+ e Chrome 84+; sem a API, a entrega segue igual.
 *
 * `desligar` enquanto a entrega espera o toque do lote: nada está sendo
 * transferido, e o celular esquecido na mesa da festa ficaria aceso sem fim
 * (achado da revisão de 16/09/2026).
 */
export function travaDeTela() {
  const temApi =
    typeof navigator !== "undefined" && typeof document !== "undefined" && Boolean(navigator.wakeLock);
  let trava: WakeLockSentinel | null = null;
  let ligada = false;

  const pedir = async () => {
    if (!temApi || !ligada) return;
    try {
      trava = await navigator.wakeLock.request("screen");
    } catch {
      trava = null;
    }
  };
  const aoVoltar = async () => {
    if (document.visibilityState === "visible") await pedir();
  };

  return {
    async ligar() {
      if (!temApi || ligada) return;
      ligada = true;
      document.addEventListener("visibilitychange", aoVoltar);
      await pedir();
    },
    async desligar() {
      if (!temApi || !ligada) return;
      ligada = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      try {
        await trava?.release();
      } catch {
        /* já solta */
      }
      trava = null;
    },
  };
}

export type ResultadoDoEnvio = "compartilhou" | "copiou" | "cancelou" | "falhou";

export const TEXTO_PARA_O_COMPUTADOR =
  "Abra este link no computador e clique em ↓ Baixar → Todas as fotos num zip.";

/**
 * "Baixar no computador", tocado no celular: manda o LINK da galeria para a
 * pessoa mesma (WhatsApp, e-mail), sem arquivo nenhum.
 *
 * A galeria inteira de um casamento são gigas — 2108 fotos, ~6,4 GB, passam do
 * iCloud grátis e levam horas pelo menu. No computador é um zip só.
 */
export async function enviarParaOComputador(url: string, titulo: string): Promise<ResultadoDoEnvio> {
  if (typeof navigator === "undefined") return "falhou";
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: titulo, text: TEXTO_PARA_O_COMPUTADOR, url });
      return "compartilhou";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelou";
      /* Outra recusa: tenta copiar. */
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return "copiou";
    }
  } catch {
    /* sem permissão */
  }
  return "falhou";
}

/** Download clássico: um link com `download`, clicado por script. */
export function baixarNoComputador(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
