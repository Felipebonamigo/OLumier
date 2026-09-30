"use client";

import { compararNomeNatural } from "@/lib/ordem-natural";

/**
 * Fila de envio em massa.
 *
 * O caso real é o fotógrafo apontando a pasta do casamento com 600 fotos e
 * saindo para tomar café. Três coisas decidem se isso funciona ou vira noite mal
 * dormida: enviar em paralelo (senão leva horas), tentar de novo sozinho (uma
 * queda de rede não pode parar a fila no arquivo 412) e não travar o navegador.
 */

/**
 * Quantos envios ao mesmo tempo.
 *
 * ── DE 3 PARA 6 (30/09/2026) ─────────────────────────────────────────────
 *
 * O Juan, de Portland: "uns 10 minutos pra subir 300 fotos". Medido no
 * navegador com rede de hotel simulada (20 Mbps de subida, 150 ms de
 * latência) e 30 fotos de 24 MP: com 3 de cada vez, 1,48× o mínimo que a
 * banda permite; com 6, 1,29×. Cada arquivo gasta idas e voltas que não são
 * banda (preparar, confirmar, as miniaturas), e com três no ar a subida
 * fica ociosa enquanto elas acontecem. Sem limite de rede, 3 e 6 empatam: aí
 * quem manda é o processador — ver `MINIATURAS_JUNTAS`.
 */
export const PARALELOS = 6;

/**
 * Quantas fotos geram miniatura ao mesmo tempo. Separado de `PARALELOS` de
 * propósito: gerar a miniatura decodifica a foto inteira (24 MP são ~100 MB
 * de memória), e seis de uma vez num notebook modesto ou num iPad é aba que
 * fecha sozinha. A rede aguenta seis; o processador fica em três.
 */
export const MINIATURAS_JUNTAS = 3;

/**
 * Um limitador: no máximo `n` chamadas de `fn` rodando ao mesmo tempo; as
 * outras esperam a vez, na ordem em que chegaram.
 */
export function limitador(n: number) {
  let ativos = 0;
  const fila: Array<() => void> = [];
  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (ativos >= n) await new Promise<void>((vez) => fila.push(vez));
    ativos++;
    try {
      return await fn();
    } finally {
      ativos--;
      fila.shift()?.();
    }
  };
}

/**
 * A espera antes de cada nova tentativa: 2 s, 5 s, 15 s, 30 s, 60 s — quase
 * dois minutos de paciência por arquivo, em vez dos QUATRO SEGUNDOS de antes.
 *
 * ── POR QUE CRESCEU (30/09/2026) ─────────────────────────────────────────
 *
 * A Alícia mandou a foto da tela: três arquivos em "conexão interrompida" e
 * três em "tentando de novo (2)…", todos ao mesmo tempo. O armazém estava
 * aceitando (a conferência de CORS do deploy daquele minuto passou); o que
 * caiu foi a conexão dela. Eram três tentativas com 1 s e 3 s de intervalo:
 * um Wi-Fi que some por cinco segundos — o roteador trocando de canal, o
 * notebook trocando de rede — matava todo arquivo que estava no ar.
 *
 * Crescente de propósito: quando a internet oscila, insistir no mesmo instante
 * só piora. E sem conexão nenhuma a espera nem conta (ver `comRetentativa`).
 *
 * Paciência não bastou: horas depois ela estava em "0 de 38", com o envio ao
 * B2 caindo em TODA tentativa — não era oscilação. Daí o caminho alternativo
 * pelo R2 (`envio-em-curso.tsx`) e o motivo da falha na tela.
 */
export const ESPERAS_ENTRE_TENTATIVAS = [2000, 5000, 15000, 30000, 60000] as const;
/** Tentativas por arquivo antes de desistir. */
export const TENTATIVAS = ESPERAS_ENTRE_TENTATIVAS.length + 1;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O navegador sabe que está sem rede nenhuma? (Fora dele, nunca.) */
const semRede = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Resolve quando a rede volta. */
const aguardarRede = () =>
  new Promise<void>((voltou) => window.addEventListener("online", () => voltou(), { once: true }));

/**
 * Tenta de novo com intervalo crescente (`ESPERAS_ENTRE_TENTATIVAS`).
 *
 * Sem rede nenhuma (`navigator.onLine` falso: o Wi-Fi caiu, o cabo saiu), a
 * fila ESPERA a rede voltar em vez de gastar tentativa contra uma parede —
 * quem fechou o notebook no meio do envio e abriu em outro lugar encontra a
 * fila andando, não uma lista vermelha. `onLine` verdadeiro não garante
 * internet (só que há uma rede), então ali vale a espera crescente.
 *
 * Erro marcado `definitivo` (sem espaço, tipo recusado, assinatura vencida)
 * sai na hora: insistir não muda a resposta, e dois minutos de "tentando de
 * novo" escondiam o motivo de quem estava olhando a tela.
 *
 * `aoTentarDeNovo` recebe o erro da tentativa que falhou, para a tela dizer
 * POR QUE está tentando de novo — "tentando de novo (4)…" sozinho, na foto da
 * Alícia, não dizia nada a ela nem a nós.
 *
 * `esperas` existe para o teste não esperar dois minutos de verdade.
 */
export async function comRetentativa<T>(
  tarefa: () => Promise<T>,
  aoTentarDeNovo?: (tentativa: number, semRede: boolean, erro: unknown) => void,
  esperas: readonly number[] = ESPERAS_ENTRE_TENTATIVAS,
): Promise<T> {
  let ultimoErro: unknown;
  const tentativas = esperas.length + 1;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await tarefa();
    } catch (e) {
      ultimoErro = e;
      if (ehDefinitivo(e)) break;
      if (tentativa < tentativas) {
        if (semRede()) {
          aoTentarDeNovo?.(tentativa, true, e);
          await aguardarRede();
          /* A queda de rede não conta como tentativa: quem ficou sem Wi-Fi
             por dez minutos não pode chegar com o arquivo já condenado. */
          tentativa--;
          continue;
        }
        aoTentarDeNovo?.(tentativa, false, e);
        await espera(esperas[tentativa - 1]);
      }
    }
  }
  throw ultimoErro;
}

/** Erro que tentar de novo não resolve. Ver `comRetentativa`. */
export function erroDefinitivo(mensagem: string): Error {
  return Object.assign(new Error(mensagem), { definitivo: true });
}

function ehDefinitivo(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { definitivo?: unknown }).definitivo === true;
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
  return aceitoPeloNome(f) && f.size > 0;
}

/**
 * O mesmo filtro para um item da fila, que pode morar dentro de um ZIP — aí o
 * `File` é um marcador vazio e o tamanho real vem do índice do ZIP.
 *
 * Função separada, e não um segundo parâmetro de `arquivoAceito`, porque ela é
 * passada direto ao `.filter()`: o filtro manda o ÍNDICE como segundo
 * argumento, e o primeiro arquivo da lista seria lido como "tamanho 0".
 */
export function itemAceito(it: ArquivoComCaminho): boolean {
  return aceitoPeloNome(it.arquivo) && tamanhoDe(it) > 0;
}

function aceitoPeloNome(f: File): boolean {
  if (f.name.startsWith(".")) return false; // .DS_Store, Thumbs.db ocultos
  if (f.name.toLowerCase() === "thumbs.db") return false;
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
  /**
   * O arquivo mora DENTRO de um ZIP (importação, ver `lib/importacao.ts`).
   *
   * Aí `arquivo` é só um marcador vazio com o nome: abrir as 3 000 fotos de 80
   * ZIPs de uma vez encheria a memória com os comprimidos. O conteúdo é aberto
   * na vez dele na fila, e o tamanho real vem do índice do ZIP.
   */
  deZip?: { bytes: number; abrir: () => Promise<File> };
}

/** O tamanho real — o do ZIP, quando o arquivo vem de dentro de um. */
export function tamanhoDe(it: ArquivoComCaminho): number {
  return it.deZip?.bytes ?? it.arquivo.size;
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

/**
 * Ordena como o fotógrafo espera: "foto_2" antes de "foto_10", e a colorida
 * antes da sua variante em preto-e-branco. Ver `lib/ordem-natural.ts`.
 */
export function ordenarNatural(arquivos: File[]): File[] {
  return [...arquivos].sort((a, b) => compararNomeNatural(a.name, b.name));
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
  return [...itens].sort((a, b) => compararNomeNatural(a.caminho, b.caminho));
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
