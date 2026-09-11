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

/**
 * Quantas fotos cabem num único menu de compartilhamento sem travar o celular.
 *
 * ── DE 20 PARA 40, COM MEDIÇÃO (10/09/2026) ──────────────────────────────
 *
 * O 20 nasceu com este arquivo, antes de existir orçamento de memória, e nunca
 * foi medido em aparelho nenhum — o documento de design de antes dizia "~30",
 * o código entregou 20, e ninguém escreveu por quê. Enquanto isso, era ELE quem
 * cortava o lote na quase totalidade das galerias reais, e não a memória.
 *
 * A medição, no banco de produção em 10/09/2026 (3.929 fotos de galerias
 * publicadas): média 3,05 MB por foto, mediana 1,95 MB, p90 7,08 MB, p99
 * 14,13 MB, maior arquivo 21,41 MB, zero vídeos. Com 20 por lote, a média real
 * ocupa 61 MB de um orçamento de 150 MB — 41% dele. O limite era de mentira.
 *
 * O que isso custava ao cliente: a maior galeria em produção (1.401 fotos)
 * pedia 71 toques para vir inteira pelo menu nativo. Com 40, são 36 — e o pico
 * de memória NÃO muda, porque quem manda continua sendo `ORCAMENTO_LOTE`: uma
 * galeria de fotos pesadas é cortada antes de chegar a 40, como sempre foi.
 *
 * O teto de 40 não é redondo por acaso: `testar-salvar-mobile.mjs` prende a
 * regra de que 40 × 3,05 MB tem de caber nos 150 MB do orçamento. Subir mais
 * exige medir de novo o acervo, ou o teto volta a prometer memória que não há.
 *
 * O que ainda não foi medido é quantos arquivos o menu nativo aceita de uma vez
 * — e por isso `compartilharPreparado` parte a lista ao meio quando o aparelho
 * recusa, em vez de desistir do menu. É o que torna este número seguro sem um
 * celular na mão.
 */
export const LOTE_MAXIMO = 40;

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

/**
 * O QUE FICA REGISTRADO NA ATIVIDADE quando uma entrega em lote acontece.
 *
 * Nasceu com o download por pasta (10/09/2026). "Baixou tudo" é prova de
 * entrega: é o que o fotógrafo lê quando o cliente diz que não recebeu. Se
 * baixar UMA pasta contasse como baixar tudo, a Atividade afirmaria que o casal
 * levou o casamento inteiro quando ele levou a cerimônia — a mesma família do
 * defeito de 05/09, em que o clique contava como entrega.
 *
 * Decide pelo TAMANHO DO PEDIDO, e não pelo botão clicado: numa galeria de um
 * capítulo só, baixar "Cerimônia" é baixar a galeria, e dizer o contrário seria
 * a mesma imprecisão ao contrário.
 *
 * Uma pasta vira um "baixou" comum. É menos do que aconteceu — 42 fotos viram
 * um evento — e é de propósito: número subestimado é lacuna, número inflado é
 * mentira.
 */
export function acaoDeEntrega(pedidas: number, totalDaGaleria: number) {
  return pedidas >= totalDaGaleria ? "baixou_tudo" : "baixou";
}

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
/**
 * ── AS DUAS METADES, E POR QUE ELAS SE SEPARARAM (10/09/2026) ─────────────
 *
 * Juan, com o print do iPhone: "cada um desses pop ups que eu cliquei em
 * 'baixar' vieram direto pra galeria. Mas tive que fazer manualmente esse
 * clique. Pra altas quantidades não tem como."
 *
 * Ele viu o plano B funcionando como escrito: o Safari recusou o menu por
 * gesto expirado e a entrega caiu no download um a um — um diálogo por foto.
 * Com 12 fotos são 12 toques; com 200, ele tem razão, não tem como.
 *
 * A causa não é o menu, é o RELÓGIO: `share()` precisa ser chamado logo depois
 * do toque, e buscar vinte fotos numa rede de celular passa dessa janela. O
 * comentário aqui embaixo concluía "não há como segurar o gesto durante um
 * await" — verdade — e parava aí. A saída é não segurar o gesto: é pedir OUTRO.
 *
 * `prepararLote` faz a parte lenta (buscar) e `compartilharPreparado` faz a
 * parte que exige gesto (abrir o menu). Entre as duas, a tela mostra um botão;
 * o toque nele é um gesto novo, e os arquivos já estão na memória. Doze toques
 * viram dois.
 *
 * `salvarNoCelular` continua existindo e faz as duas em sequência — é o caminho
 * de UMA foto, onde a busca é rápida e o gesto costuma sobreviver.
 */
export async function prepararLote(
  arquivos: { url: string; nome: string }[],
  aoProgredir?: (baixados: number) => void,
): Promise<File[] | null> {
  const prontos: File[] = [];
  try {
    for (const a of arquivos) {
      prontos.push(await baixarComoArquivo(a.url, a.nome));
      aoProgredir?.(prontos.length);
    }
  } catch {
    /* Ver o comentário de `salvarNoCelular`: a causa provável é CORS, e quem
       chama cai no download comum, que é navegação e não passa por CORS. */
    return null;
  }
  return prontos;
}

/**
 * Abre o menu com o que JÁ está na memória. Precisa ser chamada de dentro de um
 * gesto do usuário — é essa a regra que a separação existe para respeitar.
 */
export async function compartilharPreparado(prontos: File[]): Promise<ResultadoSalvar> {
  if (!podeCompartilharArquivos()) return "sem-suporte";
  return compartilharPartindoSePreciso(prontos);
}

/**
 * O MENU QUE RECUSA LISTA LONGA, E O LOTE QUE SE AJUSTA SOZINHO (10/09/2026).
 *
 * Quantos arquivos o `share` do celular aceita é o único elo desta corrente sem
 * número conhecido: `LOTE_MAXIMO` e `ORCAMENTO_LOTE` têm conta escrita, este
 * não — nem aqui, nem no documento de design, nem em aparelho nenhum. Enquanto
 * o lote era 20 dava para conviver; ao subir o teto, ele passaria a ser o que
 * decide, no escuro. E a recusa é silenciosa e cara: `canShare` devolve false,
 * a entrega desiste do menu e cai em um download por foto — com um diálogo de
 * confirmação cada, que é exatamente a queixa que originou o segundo toque —
 * depois de já ter buscado o lote inteiro e ocupado a memória.
 *
 * A saída não é adivinhar melhor: é PARTIR AO MEIO e tentar de novo. Os
 * arquivos já estão na memória, então partir não custa uma busca sequer, e o
 * mesmo código serve o aparelho que aceita 40 e o que aceita 8.
 *
 * Duas recusas que NÃO se resolvem partindo, e por isso param na hora:
 *   AbortError      a pessoa fechou o menu — reabrir com a metade é insistir;
 *   NotAllowedError o gesto expirou, e a janela do Safari não volta com uma
 *                   lista menor: seriam recusas em série gastando os toques dela.
 *
 * Quando a segunda metade falha depois de a primeira ter ido, o desfecho ruim
 * vence e quem chamou cai no download comum da lista inteira. A primeira metade
 * chega duas vezes — que é o lado seguro de errar numa entrega de fotos.
 */
async function compartilharPartindoSePreciso(files: File[]): Promise<ResultadoSalvar> {
  if (files.length === 0) return "salvou";

  // Alguns navegadores só aceitam a lista depois de montada; confere de novo.
  if (!navigator.canShare({ files })) {
    /* Um arquivo só recusado não é lista longa: é o aparelho não compartilhar
       arquivo nenhum. Partir de novo seria laço infinito. */
    if (files.length === 1) return "sem-suporte";
    const meio = Math.ceil(files.length / 2);
    const primeira = await compartilharPartindoSePreciso(files.slice(0, meio));
    if (primeira !== "salvou") return primeira;
    return compartilharPartindoSePreciso(files.slice(meio));
  }

  try {
    await navigator.share({ files });
    return "salvou";
  } catch (e) {
    if (e instanceof DOMException) {
      // AbortError = a pessoa fechou o menu. Silêncio é a resposta certa.
      if (e.name === "AbortError") return "cancelou";
      if (e.name === "NotAllowedError") return "expirou";
    }
    throw e;
  }
}

export async function salvarNoCelular(
  arquivos: { url: string; nome: string }[],
  aoProgredir?: (baixados: number) => void,
): Promise<ResultadoSalvar> {
  if (!podeCompartilharArquivos()) return "sem-suporte";

  const prontos = await prepararLote(arquivos, aoProgredir);
  if (prontos === null) {
    /*
     * Buscar o arquivo falhou. A causa mais provável não é rede: é CORS.
     * O bucket precisa autorizar a origem que está pedindo, e o endereço do
     * estúdio é uma origem diferente do domínio principal. Quem chama cai no
     * download comum — que funciona, porque é navegação e não passa por CORS.
     */
    return "sem-acesso";
  }

  return compartilharPreparado(prontos);
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
