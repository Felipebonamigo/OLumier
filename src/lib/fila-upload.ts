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

/**
 * Processa a lista com no máximo `limite` tarefas simultâneas.
 *
 * Quando uma tarefa falha, os outros trabalhadores PARAM e são esperados antes
 * do erro subir. Antes não era assim: o `Promise.all` rejeitava na hora e os
 * demais seguiam consumindo a fila sem ninguém esperando por eles — continuavam
 * enviando partes de um upload já dado como perdido, e se um deles falhasse
 * depois virava rejeição não tratada, que no navegador aparece como erro solto
 * no console e no Node derruba o processo.
 */
export async function emParalelo<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T, indice: number) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  let falha: unknown = null;

  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      if (falha) return; // outro trabalhador já falhou: não começar mais nada
      const i = proximo++;
      try {
        await tarefa(itens[i], i);
      } catch (e) {
        // Guarda o PRIMEIRO erro: é o que explica a causa. Os seguintes
        // costumam ser consequência (conexão já caiu, envio já abortado).
        falha ??= e;
        return;
      }
    }
  });

  // allSettled, não all: espera todos terminarem antes de propagar, para não
  // deixar requisição em voo depois que quem chamou já desistiu.
  await Promise.allSettled(trabalhadores);
  if (falha) throw falha;
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
 * Arquivo mais o caminho de onde ele veio — é o caminho que vira capítulo.
 *
 * Precisa andar ao lado do `File` porque as duas formas de mandar uma pasta
 * guardam o caminho em lugares diferentes, e uma delas não guarda:
 *
 *   <input webkitdirectory> → `File.webkitRelativePath` vem preenchido
 *   arrastar a pasta        → `File` vem SEM caminho; ele está na entrada
 *
 * Perder o caminho aqui é perder a organização que o fotógrafo já fez no disco.
 */
export interface ArquivoComCaminho {
  arquivo: File;
  /** "Casamento/Cerimônia/foto.jpg" — relativo ao que foi solto na tela. */
  caminho: string;
}

/** Caminho de um arquivo vindo do `<input>`; cai no nome quando não há pasta. */
export function comCaminhoDoInput(f: File): ArquivoComCaminho {
  return { arquivo: f, caminho: f.webkitRelativePath || f.name };
}

/**
 * Extrai os arquivos de uma pasta arrastada.
 *
 * Arrastar pasta não entrega `files` — entrega "entradas" que precisam ser
 * percorridas uma a uma, inclusive as subpastas (fotógrafo costuma separar em
 * "Cerimônia", "Festa"…).
 */
export async function arquivosDeArrasto(dt: DataTransfer): Promise<ArquivoComCaminho[]> {
  const entradas = [...dt.items]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter(Boolean) as FileSystemEntry[];

  // Navegador sem suporte a pasta: usa a lista simples de arquivos.
  if (entradas.length === 0) {
    return [...dt.files].filter(arquivoAceito).map(comCaminhoDoInput);
  }

  const achados: ArquivoComCaminho[] = [];
  const percorrer = async (entrada: FileSystemEntry): Promise<void> => {
    if (entrada.isFile) {
      const f = await new Promise<File | null>((res) =>
        (entrada as FileSystemFileEntry).file(res, () => res(null)),
      );
      /* `fullPath` é o único lugar onde o caminho existe neste fluxo: o `File`
       * que a entrada devolve vem com `webkitRelativePath` vazio. */
      if (f && arquivoAceito(f)) achados.push({ arquivo: f, caminho: entrada.fullPath || f.name });
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

/** Compara como o fotógrafo espera: foto_2 antes de foto_10. */
const colador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Ordena como o fotógrafo espera: foto_2 antes de foto_10. */
export function ordenarNatural(arquivos: File[]): File[] {
  return [...arquivos].sort((a, b) => colador.compare(a.name, b.name));
}

/**
 * Ordena pelo CAMINHO, não pelo nome.
 *
 * Com pastas, o caminho carrega a ordem certa de graça: "01 Making Of/x.jpg"
 * vem antes de "02 Cerimônia/a.jpg" mesmo com "a" < "x". Ordenar só pelo nome
 * embaralharia os capítulos entre si e a galeria sairia com a festa no meio da
 * cerimônia.
 */
export function ordenarNaturalPorCaminho(itens: ArquivoComCaminho[]): ArquivoComCaminho[] {
  return [...itens].sort((a, b) => colador.compare(a.caminho, b.caminho));
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
