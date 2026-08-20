/**
 * Salvar fotos no celular.
 *
 * A dor real: no iPhone, um download normal vai para o app Arquivos, não para o
 * rolo da câmera — e o convidado acha que "não baixou". Nenhum site consegue
 * gravar direto nas Fotos: o navegador não dá essa permissão a ninguém (o
 * Pixieset sofre do mesmo).
 *
 * O que dá para fazer é abrir o menu NATIVO de compartilhamento com o arquivo
 * já em mãos. Ali existe "Salvar imagem", que grava nas Fotos (iPhone) ou na
 * Galeria (Android). É um toque a mais, mas termina no lugar certo.
 *
 * Roda no cliente; não importar em código de servidor.
 */

/** Quantas fotos cabem num único menu de compartilhamento sem travar o celular. */
export const LOTE_MAXIMO = 20;

/**
 * Teto de MEMÓRIA por lote, e por arquivo.
 *
 * Contar arquivos não basta: para abrir o menu nativo é preciso ter os arquivos
 * carregados como Blob, ou seja, na memória. Vinte fotos de 8 MB já são 160 MB;
 * um único vídeo de casamento passa de 5 GB e derrubaria a aba do celular na
 * hora — o casal veria a página morrer no meio do "salvar tudo".
 *
 * Arquivo acima do teto individual nem tenta o menu: vai pelo download comum,
 * que o navegador transmite direto para o disco sem passar pela memória.
 */
export const ORCAMENTO_LOTE = 150 * 1024 * 1024;
export const LIMITE_POR_ARQUIVO = 80 * 1024 * 1024;

export interface ArquivoParaSalvar {
  url: string;
  nome: string;
  bytes: number;
}

/**
 * Divide a lista em lotes que cabem na memória, e separa o que é grande demais
 * para o menu nativo.
 */
export function montarLotes(arquivos: ArquivoParaSalvar[]): {
  lotes: ArquivoParaSalvar[][];
  grandes: ArquivoParaSalvar[];
} {
  const grandes = arquivos.filter((a) => a.bytes > LIMITE_POR_ARQUIVO);
  const cabem = arquivos.filter((a) => a.bytes <= LIMITE_POR_ARQUIVO);

  const lotes: ArquivoParaSalvar[][] = [];
  let atual: ArquivoParaSalvar[] = [];
  let soma = 0;

  for (const a of cabem) {
    const estouraria = soma + a.bytes > ORCAMENTO_LOTE || atual.length >= LOTE_MAXIMO;
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

export function ehCelular(): boolean {
  if (typeof navigator === "undefined") return false;
  // Ponteiro grosso = dedo. Mais confiável que farejar o user agent, e pega
  // tablet Android, iPad em modo desktop e afins.
  const toque = matchMedia("(pointer: coarse)").matches;
  return toque && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
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

/** true quando vale mostrar "Salvar no celular" em vez de "Baixar". */
export function deveOferecerSalvar(): boolean {
  return ehCelular() && podeCompartilharArquivos();
}

async function baixarComoArquivo(url: string, nome: string): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`não consegui buscar a foto (HTTP ${r.status})`);
  const blob = await r.blob();
  return new File([blob], nome, { type: blob.type || "image/jpeg" });
}

/**
 * - `salvou`      — o menu nativo abriu e a pessoa concluiu
 * - `cancelou`    — fechou o menu; NÃO é erro
 * - `sem-suporte` — navegador não compartilha arquivo; cai no download comum
 * - `expirou`     — o navegador recusou o menu por perda do "gesto do usuário"
 * - `sem-acesso`  — não consegui buscar o arquivo (CORS ou rede)
 */
export type ResultadoSalvar = "salvou" | "cancelou" | "sem-suporte" | "expirou" | "sem-acesso";

/**
 * Abre o menu de compartilhamento com as fotos já carregadas.
 * Devolve "cancelou" quando a pessoa fecha o menu — que NÃO é erro e não deve
 * virar mensagem vermelha na tela.
 */
export async function salvarNoCelular(
  arquivos: { url: string; nome: string }[],
  aoProgredir?: (baixados: number) => void,
): Promise<ResultadoSalvar> {
  if (!podeCompartilharArquivos()) return "sem-suporte";

  const prontos: File[] = [];
  try {
    for (const a of arquivos) {
      prontos.push(await baixarComoArquivo(a.url, a.nome));
      aoProgredir?.(prontos.length);
    }
  } catch {
    /*
     * Buscar o arquivo falhou. A causa mais provável não é rede: é CORS.
     * O bucket precisa autorizar a origem que está pedindo, e o endereço do
     * estúdio (siriusfotografia.fotonio.com.br) é uma origem diferente do
     * domínio principal. Quem chama cai no download comum — que funciona,
     * porque é navegação e não passa por CORS.
     */
    return "sem-acesso";
  }

  // Alguns navegadores só aceitam a lista depois de montada; confere de novo.
  if (!navigator.canShare({ files: prontos })) return "sem-suporte";

  try {
    await navigator.share({ files: prontos });
    return "salvou";
  } catch (e) {
    if (e instanceof DOMException) {
      // AbortError = a pessoa fechou o menu. Silêncio é a resposta certa.
      if (e.name === "AbortError") return "cancelou";
      /*
       * NotAllowedError = o navegador não considera mais que houve um gesto do
       * usuário. Acontece no iPhone: o Safari exige que `share()` seja chamado
       * logo depois do toque, e baixar vinte fotos numa rede de celular leva
       * mais tempo que essa janela. Não há como segurar o gesto durante um
       * await — então o certo é reconhecer, cair no download comum e dizer a
       * verdade em vez de mostrar um erro sem explicação.
       */
      if (e.name === "NotAllowedError") return "expirou";
    }
    throw e;
  }
}

/** Download clássico, para computador. */
export function baixarNoComputador(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
