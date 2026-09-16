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
 * O que fazer antes de pegar o próximo item.
 *
 * `esperar` é o que separa PAUSAR de PARAR, e a diferença importa para quem
 * está com 519 fotos na fila: pausado, o trabalhador fica no portão e o índice
 * não anda — retomar continua de onde estava. Parado, os trabalhadores saem e
 * o que não subiu não sobe.
 */
export type Portao = () => Promise<"seguir" | "esperar" | "parar">;

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
  /* Sem portão a fila corre como sempre correu — nenhum chamador antigo muda. */
  portao?: Portao,
): Promise<void> {
  let proximo = 0;
  let falha: unknown = null;
  let parado = false;

  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      if (falha || parado) return; // outro trabalhador já falhou ou alguém parou
      if (portao) {
        /* O laço é a pausa: enquanto o portão disser "esperar", ninguém pega
           item nenhum. 120 ms é o intervalo entre olhadas — rápido o bastante
           para o botão parecer instantâneo, devagar o bastante para não custar
           nada enquanto a pessoa está em outra aba. */
        let ordem = await portao();
        while (ordem === "esperar") {
          await new Promise((r) => setTimeout(r, 120));
          ordem = await portao();
        }
        if (ordem === "parar") {
          parado = true;
          return;
        }
        /* Confere o fim OUTRA vez: o `while` lá em cima leu `proximo` antes da
           espera, e com dois trabalhadores parados no mesmo portão os dois
           passariam com o índice já no fim — o segundo chamaria a tarefa com
           `undefined`. Daqui até o `proximo++` não há await, então a leitura e
           o incremento são indivisíveis. */
        if (proximo >= itens.length) return;
      }
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

/**
 * Como `emParalelo`, mas a lista pode CRESCER enquanto a fila corre.
 *
 * ── O PEDIDO (16/09/2026) ────────────────────────────────────────────────
 *
 * Felipe: "não consigo enviar simultaneamente fotos para making of, cerimônia,
 * decoração, etc. Tenho que esperar subir as fotos de um dos capítulos pra
 * depois conseguir continuar subindo nos outros."
 *
 * O seletor de capítulo ficava desabilitado durante o envio, e não era
 * capricho: `emParalelo` recebe um ARRAY PRONTO. Chamar o envio duas vezes
 * criava duas corridas independentes — o dobro dos envios simultâneos que a
 * rede aguenta, e a primeira a terminar apagava o "enviando…" da outra.
 *
 * Aqui os trabalhadores pedem o próximo item a uma FUNÇÃO em vez de andar por
 * um índice. Quem enfileira um segundo lote no meio do primeiro só empurra
 * itens para o fim da lista: os mesmos três trabalhadores os pegam quando
 * chegarem neles, e continua existindo uma corrida só.
 *
 * ── FALHA NÃO PARA OS OUTROS, AO CONTRÁRIO DE `emParalelo` ───────────────
 *
 * Lá, um erro derruba a corrida inteira — é o certo quando a lista é um lote
 * indivisível. Aqui a lista é a fila do dia: uma foto corrompida no meio de 600
 * não pode levar junto as 400 que faltam, e cada tarefa já marca o próprio erro
 * na linha dela.
 */
export async function emParaleloDeFila<T>(
  proximo: () => T | null,
  limite: number,
  tarefa: (item: T) => Promise<void>,
  portao?: Portao,
): Promise<void> {
  let parado = false;

  const trabalhadores = Array.from({ length: Math.max(1, limite) }, async () => {
    for (;;) {
      if (parado) return;
      if (portao) {
        let ordem = await portao();
        while (ordem === "esperar") {
          await new Promise((r) => setTimeout(r, 120));
          ordem = await portao();
        }
        if (ordem === "parar") {
          parado = true;
          return;
        }
      }
      /* `proximo()` é síncrono de propósito: entre perguntar e receber não pode
         caber um await, senão dois trabalhadores levam o mesmo item. */
      const item = proximo();
      if (item === null) return;
      try {
        await tarefa(item);
      } catch {
        /* A tarefa é quem sabe marcar o próprio erro na linha da fila. Aqui só
           não se pode deixar a rejeição solta, que no navegador vira erro no
           console e derruba o trabalhador antes da hora. */
      }
    }
  });

  await Promise.allSettled(trabalhadores);
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

/**
 * Separa o que já existe na galeria do que é novo, pelo NOME do arquivo.
 *
 * ── POR QUE PELO NOME, E NÃO PELO CONTEÚDO ────────────────────────────────
 *
 * Comparar conteúdo seria mais exato e é a resposta errada aqui: para saber que
 * dois arquivos são iguais é preciso LER os dois, e a metade que está no bucket
 * custa banda e dinheiro para ser lida de volta. O nome resolve o caso real —
 * a pessoa arrasta a mesma pasta duas vezes, ou arrasta de novo depois de um
 * envio interrompido, e o exportador do Lightroom nomeia em sequência.
 *
 * Sem diferenciar maiúscula de minúscula porque o Windows e o macOS também não:
 * `IMG_01.JPG` e `img_01.jpg` não coexistem no disco de onde a pasta saiu.
 *
 * A segunda cópia DENTRO da mesma leva também conta como repetida. É o caso de
 * quem arrasta a pasta com uma subpasta "selecionadas" dentro: os mesmos
 * arquivos aparecem duas vezes e subiriam os dois.
 */
export function separarRepetidos<T extends { arquivo: { name: string } }>(
  itens: T[],
  jaNaGaleria: Iterable<string>,
): { novos: T[]; repetidos: T[] } {
  const vistos = new Set<string>();
  for (const nome of jaNaGaleria) vistos.add(nome.toLowerCase());

  const novos: T[] = [];
  const repetidos: T[] = [];
  for (const item of itens) {
    const chave = item.arquivo.name.toLowerCase();
    if (vistos.has(chave)) repetidos.push(item);
    else {
      vistos.add(chave);
      novos.push(item);
    }
  }
  return { novos, repetidos };
}
