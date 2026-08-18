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

export type ResultadoSalvar = "salvou" | "cancelou" | "sem-suporte";

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
  for (const a of arquivos) {
    prontos.push(await baixarComoArquivo(a.url, a.nome));
    aoProgredir?.(prontos.length);
  }

  // Alguns navegadores só aceitam a lista depois de montada; confere de novo.
  if (!navigator.canShare({ files: prontos })) return "sem-suporte";

  try {
    await navigator.share({ files: prontos });
    return "salvou";
  } catch (e) {
    // AbortError = a pessoa fechou o menu. Silêncio é a resposta certa.
    if (e instanceof DOMException && e.name === "AbortError") return "cancelou";
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
