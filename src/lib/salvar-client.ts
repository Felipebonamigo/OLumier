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
     * estúdio (siriusfotografia.olumier.com.br) é uma origem diferente do
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

/**
 * O desfecho de UMA foto conta como entrega?
 *
 * Só "cancelou" não conta — a pessoa viu o menu e fechou, e nada saiu. Os
 * outros três desfechos ruins ("sem-suporte", "expirou", "sem-acesso") caem no
 * download comum, que entrega; contá-los é a mesma régua do computador.
 *
 * Existe como função, e não como um `!==` solto no componente, porque é uma
 * regra sobre a PROVA DE ENTREGA do fotógrafo — e regra que sustenta prova
 * merece um teste com nome.
 */
export const entregouUmaFoto = (r: ResultadoSalvar): boolean => r !== "cancelou";

/**
 * A pausa entre um download e o outro.
 *
 * Navegador ignora downloads disparados todos juntos — no computador ele
 * pergunta "permitir vários downloads?" e no celular simplesmente descarta os
 * seguintes. 700 ms é o intervalo que o caminho do computador já usava desde
 * sempre; o que faltava era o caminho do CELULAR usar o mesmo quando cai no
 * download comum, que é exatamente onde "não veio nada" nascia.
 */
export const PAUSA_ENTRE_DOWNLOADS = 700;

export interface DesfechoEntrega {
  /** Arquivos efetivamente passados adiante. Zero é uma resposta legítima. */
  entregues: number;
  /** A pessoa fechou o menu nativo. Não é erro, e não é entrega. */
  cancelado: boolean;
  /** O que dizer na tela, ou `null` quando não há o que dizer. */
  aviso: string | null;
}

export interface GanchosDeEntrega {
  /** true no celular com menu nativo; false no computador. */
  peloMenu: boolean;
  salvarLote: (lote: ArquivoParaSalvar[]) => Promise<ResultadoSalvar>;
  baixar: (url: string, nome: string) => void;
  esperar: (ms: number) => Promise<void>;
  aoProgredir?: (feitos: number) => void;
}

/**
 * Entrega a galeria inteira, e DIZ o que aconteceu.
 *
 * ── POR QUE ISTO SAIU DE DENTRO DO COMPONENTE (05/09/2026) ─────────────────
 *
 * O Juan tentou baixar tudo no celular, não veio nada, e a aba Atividade marcou
 * 1 download. O registro ficava logo depois de assinar as URLs — ou seja,
 * contava o CLIQUE. E a Atividade é PROVA DE ENTREGA para o fotógrafo: um
 * número que sobe quando nada saiu não é impreciso, é falso, e aparece
 * justamente na conversa em que o cliente diz que não recebeu.
 *
 * Aqui a pergunta "quantos saíram?" tem resposta, e ela pode ser zero: menu
 * fechado é zero, lista vazia é zero. Quem chama decide o que fazer com isso —
 * e é assim que o registro passa a depender do desfecho em vez do clique.
 *
 * O que esta função NÃO promete: que o arquivo chegou ao disco. Download comum
 * é disparar e soltar; ninguém, em nenhum navegador, avisa o site que o
 * arquivo terminou. `entregues` conta o que foi passado adiante, que é o
 * máximo que dá para afirmar com honestidade — a mesma régua do download de
 * uma foto só.
 */
export async function entregarTudo(
  arquivos: ArquivoParaSalvar[],
  ganchos: GanchosDeEntrega,
): Promise<DesfechoEntrega> {
  const { peloMenu, salvarLote, baixar, esperar, aoProgredir } = ganchos;
  if (arquivos.length === 0) return { entregues: 0, cancelado: false, aviso: null };

  let entregues = 0;
  const avancar = (n: number) => {
    entregues += n;
    aoProgredir?.(entregues);
  };

  /* Um atrás do outro, com pausa entre eles. A pausa vem DEPOIS de cada
     arquivo, inclusive do último: 700 ms a mais no fim custam menos que um
     caso especial que ninguém revisita. */
  const baixarEmSequencia = async (lista: ArquivoParaSalvar[]) => {
    for (const a of lista) {
      baixar(a.url, a.nome);
      avancar(1);
      await esperar(PAUSA_ENTRE_DOWNLOADS);
    }
  };

  if (!peloMenu) {
    await baixarEmSequencia(arquivos);
    return { entregues, cancelado: false, aviso: null };
  }

  const { lotes, grandes } = montarLotes(arquivos);
  await baixarEmSequencia(grandes);

  let aviso: string | null = grandes.length > 0 ? AVISO_ARQUIVOS : null;

  for (const lote of lotes) {
    const r = await salvarLote(lote);

    // Fechou o menu: entende-se como "chega", e não como erro. O que já saiu
    // continua contando; o que viria depois, não.
    if (r === "cancelou") return { entregues, cancelado: true, aviso };

    if (r === "salvou") {
      avancar(lote.length);
      continue;
    }

    /*
     * "sem-suporte", "expirou" ou "sem-acesso": o menu nativo não rolou, e as
     * fotos não podem simplesmente não vir. Vão pelo download comum — e o
     * aviso deixou de ser exclusivo do "expirou": antes, quem batia em CORS
     * via o contador chegar ao fim e NADA acontecer, sem uma palavra. Era o
     * "não deu" do Juan, dito pela tela em silêncio.
     */
    await baixarEmSequencia(lote);
    aviso = AVISO_ARQUIVOS;
  }

  return { entregues, cancelado: false, aviso };
}

/* Uma frase só para os três desfechos que caem no download comum: o lugar onde
   o arquivo termina é o mesmo, e é essa a dúvida de quem está com o celular na
   mão. */
const AVISO_ARQUIVOS = "baixadas — procure em Arquivos ou Downloads";

/** Download clássico, para computador. */
export function baixarNoComputador(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
