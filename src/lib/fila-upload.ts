"use client";

/**
 * Fila de envio em massa.
 *
 * O caso real é o fotógrafo apontando a pasta do casamento com 600 fotos e
 * saindo para tomar café. Três coisas decidem se isso funciona ou vira noite mal
 * dormida: enviar em paralelo (senão leva horas), tentar de novo sozinho (uma
 * queda de rede não pode parar a fila no arquivo 412) e não travar o navegador.
 */

/** Quantos envios ao mesmo tempo. */
export const PARALELOS = 3;
/** Tentativas por arquivo antes de desistir. */
export const TENTATIVAS = 3;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tenta de novo com intervalo crescente (1s, 3s, 9s).
 *
 * Crescente de propósito: quando a internet oscila, insistir no mesmo instante
 * só piora. Dar um tempo maior a cada tentativa costuma pegar a rede já de volta.
 */
export async function comRetentativa<T>(
  tarefa: () => Promise<T>,
  aoTentarDeNovo?: (tentativa: number) => void,
): Promise<T> {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      return await tarefa();
    } catch (e) {
      ultimoErro = e;
      if (tentativa < TENTATIVAS) {
        aoTentarDeNovo?.(tentativa);
        await espera(1000 * Math.pow(3, tentativa - 1));
      }
    }
  }
  throw ultimoErro;
}

/** Processa a lista com no máximo `limite` tarefas simultâneas. */
export async function emParalelo<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T, indice: number) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      await tarefa(itens[i], i);
    }
  });
  await Promise.all(trabalhadores);
}

const EXTENSOES = /\.(jpe?g|png|webp|avif|heic|heif|mp4|mov|webm)$/i;

/** Ignora o lixo que vem junto quando se arrasta uma pasta inteira. */
export function arquivoAceito(f: File): boolean {
  if (f.name.startsWith(".")) return false; // .DS_Store, Thumbs.db ocultos
  if (f.name.toLowerCase() === "thumbs.db") return false;
  if (f.size === 0) return false;
  return EXTENSOES.test(f.name) || f.type.startsWith("image/") || f.type.startsWith("video/");
}

/**
 * Extrai os arquivos de uma pasta arrastada.
 *
 * Arrastar pasta não entrega `files` — entrega "entradas" que precisam ser
 * percorridas uma a uma, inclusive as subpastas (fotógrafo costuma separar em
 * "Cerimônia", "Festa"…).
 */
export async function arquivosDeArrasto(dt: DataTransfer): Promise<File[]> {
  const entradas = [...dt.items]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter(Boolean) as FileSystemEntry[];

  // Navegador sem suporte a pasta: usa a lista simples de arquivos.
  if (entradas.length === 0) return [...dt.files].filter(arquivoAceito);

  const achados: File[] = [];
  const percorrer = async (entrada: FileSystemEntry): Promise<void> => {
    if (entrada.isFile) {
      const f = await new Promise<File | null>((res) =>
        (entrada as FileSystemFileEntry).file(res, () => res(null)),
      );
      if (f && arquivoAceito(f)) achados.push(f);
      return;
    }
    if (entrada.isDirectory) {
      const leitor = (entrada as FileSystemDirectoryEntry).createReader();
      // readEntries devolve no máximo 100 por chamada — precisa insistir até vir vazio.
      for (;;) {
        const lote = await new Promise<FileSystemEntry[]>((res) =>
          leitor.readEntries(res, () => res([])),
        );
        if (lote.length === 0) break;
        for (const e of lote) await percorrer(e);
      }
    }
  };

  for (const e of entradas) await percorrer(e);
  return achados;
}

/** Ordena como o fotógrafo espera: foto_2 antes de foto_10. */
export function ordenarNatural(arquivos: File[]): File[] {
  const col = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  return [...arquivos].sort((a, b) => col.compare(a.name, b.name));
}

/** Mantém a tela acesa enquanto a fila roda; devolve como soltar. */
export async function manterAcordado(): Promise<() => void> {
  try {
    const wl = await navigator.wakeLock?.request("screen");
    return () => wl?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
