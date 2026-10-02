/**
 * IMPORTAR O ACERVO: uma pasta (ou uma pilha de ZIPs) vira VÁRIAS galerias.
 *
 * ── O PEDIDO (30/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "o usuário que tem umas 80 galerias vai ter que baixar 80 zips e
 * abrir 80 coisas diferentes, é muito trabalhoso". E depois: "criar várias
 * galerias de uma vez, apenas colocando a pasta, e o nome da galeria que quer
 * salvar, com a data opcional".
 *
 * Quem chega de outra plataforma já tem o acervo organizado — uma pasta por
 * cliente, ou um ZIP por coleção. Este módulo lê essa organização e propõe as
 * galerias; a tela mostra a proposta para a pessoa corrigir nome e data antes
 * de criar qualquer coisa.
 *
 * Só lógica, sem rede e sem React: roda no navegador e no teste
 * (`scripts/testar-importacao.mjs`).
 *
 * ── AS DUAS REGRAS QUE DECIDEM TUDO ───────────────────────────────────────
 *
 *   PASTA → uma subpasta, uma galeria. Selecionar "Clientes 2025" com "Ana e
 *   Pedro/" e "Bia e Caio/" dentro dá duas galerias. O que estiver mais fundo
 *   ("Ana e Pedro/01 Making Of/") vira capítulo, pela mesma regra do envio
 *   comum (`capitulos-pasta.ts`).
 *
 *   ZIP → um ZIP, uma galeria. É o formato em que as plataformas entregam uma
 *   coleção, e as pastas de dentro (os "sets" do Pixieset) viram capítulos.
 *
 * A ambiguidade que não dá para resolver sozinho: quem seleciona a pasta de UM
 * casamento, com os capítulos dentro, recebe uma galeria por capítulo. A tela
 * oferece "é uma galeria só" para esse caso (`modo: "uma"`).
 *
 * E a regra que resolve o ZIP dividido em partes: LINHAS COM O MESMO NOME VIRAM
 * UMA GALERIA SÓ. As plataformas quebram coleção grande em vários ZIPs; o
 * nome sugerido já sai sem o "part 2", e a pessoa pode juntar à mão, dando o
 * mesmo nome a duas linhas.
 */

import { mesmaCoisa } from "./capitulos-pasta";
import { reconhecerArquivo } from "./tipos-de-arquivo";
import { itemAceito, tamanhoDe, type ArquivoComCaminho } from "./fila-upload";
import type { EntradaDoZip } from "./zip-leitor";

export interface FonteDeImportacao {
  /** Estável entre renderizações — é a chave da linha na tela. */
  id: string;
  origem: "pasta" | "zip";
  /** O que a pessoa reconhece do disco: "Ana e Pedro/" ou "ana-e-pedro.zip". */
  rotulo: string;
  nomeSugerido: string;
  /** "2025-03-14", quando o nome da pasta trazia a data. */
  dataSugerida: string | null;
  /** Caminho RELATIVO À FONTE: "01 Making Of/IMG_1.jpg", ou só "IMG_1.jpg". */
  itens: ArquivoComCaminho[];
  bytes: number;
}

/** "/Clientes/Ana/x.jpg" e "Clientes/Ana/x.jpg" são o mesmo caminho. */
function segmentos(caminho: string): string[] {
  return caminho.split("/").filter(Boolean);
}

/* ── A DATA NO NOME DA PASTA ─────────────────────────────────────────────── */

const DATA_ANO_PRIMEIRO = /^(\d{4})[-_. ]?(\d{2})[-_. ]?(\d{2})$/;
const DATA_DIA_PRIMEIRO = /^(\d{2})[-_. ](\d{2})[-_. ](\d{4})$/;

function dataReal(ano: number, mes: number, dia: number): string | null {
  if (ano < 1990 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null; // 31/02 não existe
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function lerData(texto: string): string | null {
  let m = DATA_ANO_PRIMEIRO.exec(texto);
  if (m) return dataReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = DATA_DIA_PRIMEIRO.exec(texto);
  if (m) return dataReal(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Separa a data do nome: "2025-03-14 Ana e Pedro" → "Ana e Pedro" + 14/03/2025.
 *
 * Fotógrafo que organiza acervo por data põe a data na FRENTE ou no FIM do
 * nome, e é assim que a pasta aparece ordenada no disco. Os formatos são os
 * que o disco aceita — sem barra, que não pode existir em nome de pasta.
 *
 * Só aceita data que existe: "2025 12 40" não vira data nenhuma, e o nome
 * fica inteiro. Errar para menos (sem data) custa um campo em branco que é
 * opcional; errar para mais grava data errada numa entrega.
 */
export function nomeEData(bruto: string): { nome: string; data: string | null } {
  const texto = bruto.trim();
  const SEP = String.raw`\s*[-_.–—]?\s*`;
  const formatos = [
    String.raw`\d{4}[-_.]\d{2}[-_.]\d{2}`,
    String.raw`\d{8}`,
    String.raw`\d{2}[-_.]\d{2}[-_.]\d{4}`,
  ];
  for (const f of formatos) {
    const naFrente = new RegExp(`^(${f})${SEP}(.+)$`).exec(texto);
    if (naFrente) {
      const data = lerData(naFrente[1]);
      if (data) return { nome: naFrente[2].trim(), data };
    }
    const noFim = new RegExp(`^(.+?)${SEP}(${f})$`).exec(texto);
    if (noFim) {
      const data = lerData(noFim[2]);
      if (data) return { nome: noFim[1].trim(), data };
    }
  }
  return { nome: texto, data: null };
}

/**
 * O nome de um ZIP sem a extensão e sem a marca de "parte".
 *
 * Coleção grande sai em vários ZIPs. Tirar o "part 2" é o que faz as partes
 * nascerem com o MESMO nome sugerido — e linhas de mesmo nome viram uma
 * galeria só. As formas cobertas são as de quem numera partes; o "-2" solto
 * fica, porque "Ensaio-2" pode ser mesmo o segundo ensaio.
 *
 * ── O PIXIESET (01/10/2026) ───────────────────────────────────────────────
 *
 * Juan baixou uma galeria grande de lá e veio em três:
 * `miristraidecor-photo-download-1of3.zip`, `-2of3` e `-3of3`. "Como isso
 * influencia no envio de vários zips de uma vez?" Influenciava: nenhuma das
 * formas acima tinha "1of3" sem o "part", e as três viravam três galerias.
 *
 * "1of3" sozinho é seguro de tirar — "N de M" não é nome de ensaio (com dois
 * algarismos no máximo, para "Festa 15 de 2025" ficar inteiro). E o
 * `-photo-download` / `-video-download` que o Pixieset põe em todo ZIP sai
 * junto: é o que faz as fotos e os vídeos da mesma coleção, baixados em ZIPs
 * separados, caírem na MESMA galeria.
 */
export function nomeDoZip(arquivo: string): string {
  return arquivo
    .replace(/\.zip$/i, "")
    .replace(/\s*[-_ ]\s*(part|parte)\s*\d+(\s*(of|de)\s*\d+)?$/i, "")
    .replace(/\s*[-_ ]\s*\d{1,2}\s*(of|de)\s*\d{1,2}$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[-_ ](photo|video)s?[-_ ]download$/i, "")
    .trim();
}

/* ── PASTA → FONTES ──────────────────────────────────────────────────────── */

/**
 * Parte os arquivos de uma pasta em fontes — uma por galeria proposta.
 *
 * `modo: "subpastas"` (o padrão) é o acervo: cada subpasta da pasta escolhida
 * é uma galeria. `modo: "uma"` é a pasta de um casamento só.
 *
 * Os dois jeitos de mandar uma pasta dão caminhos diferentes, como no envio
 * comum: selecionar "Clientes" dá "Clientes/Ana/x.jpg"; arrastar "Ana" e "Bia"
 * juntas dá "/Ana/x.jpg" e "/Bia/y.jpg". Se todos começam pela mesma pasta, ela
 * é a RAIZ e as galerias estão no nível de baixo; se não, as galerias são as
 * pastas do primeiro nível.
 *
 * Arquivo solto na raiz vira uma fonte com o nome da raiz — a pessoa decide se
 * quer essa galeria (normalmente é o caso de ter escolhido a pasta de um
 * casamento só, sem subpastas).
 */
export function fontesDaPasta(
  brutos: ArquivoComCaminho[],
  modo: "subpastas" | "uma" = "subpastas",
): FonteDeImportacao[] {
  const itens = brutos.filter(itemAceito);
  if (itens.length === 0) return [];

  const partidos = itens.map((it) => ({ it, s: segmentos(it.caminho) }));
  const primeiras = new Set(partidos.map((p) => (p.s.length > 1 ? p.s[0] : "")));
  const raiz = primeiras.size === 1 && !primeiras.has("") ? [...primeiras][0] : null;

  if (modo === "uma") {
    const nome = raiz ?? "Nova galeria";
    return [
      fonte("pasta", `pasta:${nome}`, `${nome}/`, nome, partidos.map(({ it, s }) => ({
        ...it,
        caminho: s.slice(raiz ? 1 : 0).join("/"),
      }))),
    ];
  }

  const nivel = raiz ? 1 : 0;
  const grupos = new Map<string, ArquivoComCaminho[]>();
  const ordem: string[] = [];
  for (const { it, s } of partidos) {
    /* Arquivo sem pasta própria no nível das galerias fica com a raiz. */
    const temPasta = s.length > nivel + 1;
    const chave = temPasta ? s[nivel] : (raiz ?? "");
    const resto = s.slice(temPasta ? nivel + 1 : nivel).join("/");
    if (!grupos.has(chave)) {
      grupos.set(chave, []);
      ordem.push(chave);
    }
    grupos.get(chave)!.push({ ...it, caminho: resto });
  }

  return ordem.map((chave) =>
    fonte(
      "pasta",
      `pasta:${chave}`,
      chave ? `${chave}/` : "arquivos soltos",
      chave || "Arquivos soltos",
      grupos.get(chave)!,
    ),
  );
}

function fonte(
  origem: FonteDeImportacao["origem"],
  id: string,
  rotulo: string,
  nomeBruto: string,
  itens: ArquivoComCaminho[],
): FonteDeImportacao {
  const { nome, data } = nomeEData(nomeBruto);
  return {
    id,
    origem,
    rotulo,
    nomeSugerido: nome || nomeBruto,
    dataSugerida: data,
    itens,
    bytes: itens.reduce((s, i) => s + tamanhoDe(i), 0),
  };
}

/* ── ZIP → FONTE ─────────────────────────────────────────────────────────── */

/**
 * Um arquivo de dentro do ZIP, no formato que a fila de envio conhece.
 *
 * O `File` é um marcador vazio com o nome e o tipo; o conteúdo só sai do ZIP
 * na vez dele (`deZip.abrir`). Ver `ArquivoComCaminho.deZip`.
 */
export function arquivoDoZip(e: EntradaDoZip): ArquivoComCaminho {
  const nome = e.caminho.split("/").pop() || e.caminho;
  /* O ZIP não diz o tipo; a extensão diz. Vazio quando não é foto nem vídeo —
     e aí `itemAceito` também recusa pelo nome. */
  const tipo = reconhecerArquivo(nome, "")?.mime ?? "";
  return {
    arquivo: new File([], nome, { type: tipo }),
    caminho: e.caminho,
    deZip: {
      bytes: e.tamanho,
      abrir: async () => new File([await e.abrir()], nome, { type: tipo }),
    },
  };
}

/**
 * Um ZIP vira uma fonte. `indice` separa dois ZIPs de mesmo nome escolhidos
 * juntos (as partes de uma coleção), que continuam sendo linhas distintas.
 *
 * A PASTA DE CIMA, QUANDO TODAS AS ENTRADAS ESTÃO DENTRO DELA, é o próprio
 * nome da coleção — "Ana e Pedro/Cerimônia/x.jpg" num "Ana e Pedro.zip". Sem
 * tirá-la, a galeria nasceria com um capítulo só, chamado igual a ela. Ela sai
 * quando tem o nome do ZIP, ou quando há pastas embaixo dela (aí são elas os
 * capítulos). Um ZIP com uma pasta "Cerimônia" e nada mais fica como está: o
 * capítulo único é o que a pessoa montou.
 */
export function fonteDoZip(
  nomeArquivo: string,
  entradas: EntradaDoZip[],
  indice = 0,
): FonteDeImportacao {
  const nome = nomeDoZip(nomeArquivo);
  const itens = entradas
    .map(arquivoDoZip)
    .filter(itemAceito);

  const partidos = itens.map((it) => segmentos(it.caminho));
  const primeiras = new Set(partidos.map((s) => (s.length > 1 ? s[0] : "")));
  const topo = primeiras.size === 1 && !primeiras.has("") ? [...primeiras][0] : null;
  const tirarTopo =
    topo !== null && (mesmaCoisa(topo, nome) || partidos.some((s) => s.length > 2));

  const relativos = itens.map((it, k) => ({
    ...it,
    caminho: partidos[k].slice(tirarTopo ? 1 : 0).join("/"),
  }));

  return fonte("zip", `zip:${nomeArquivo}#${indice}`, nomeArquivo, nome, relativos);
}

/* ── AS LINHAS DA TELA → AS GALERIAS ─────────────────────────────────────── */

export interface LinhaDeImportacao {
  fonte: FonteDeImportacao;
  titulo: string;
  /** "2025-03-14" ou vazio. */
  data: string;
  incluir: boolean;
}

export interface GaleriaAImportar {
  titulo: string;
  data: string | null;
  /**
   * Prontos para a fila. O caminho ganha um prefixo fixo ("galeria/…") para o
   * leitor de capítulos (`capitulosDaPasta`) enxergar uma raiz comum e tratar
   * a pasta de baixo como capítulo — com duas fontes juntas, os capítulos das
   * duas se somam.
   */
  itens: ArquivoComCaminho[];
  bytes: number;
  /** As linhas que formaram esta galeria — mais de uma quando se juntaram. */
  fontes: string[];
}

/** O prefixo que faz a raiz comum. Um nome fixo, e não o título: título pode ter "/". */
const PREFIXO = "galeria";

/**
 * Junta as linhas incluídas em galerias. Mesmo título (sem acento, sem caixa)
 * é a mesma galeria; a data é a primeira que aparecer.
 */
export function montarGalerias(linhas: LinhaDeImportacao[]): GaleriaAImportar[] {
  const galerias: GaleriaAImportar[] = [];
  for (const l of linhas) {
    const titulo = l.titulo.trim();
    if (!l.incluir || !titulo || l.fonte.itens.length === 0) continue;

    let g = galerias.find((x) => mesmaCoisa(x.titulo, titulo));
    if (!g) {
      g = { titulo, data: null, itens: [], bytes: 0, fontes: [] };
      galerias.push(g);
    }
    g.data ??= l.data.trim() || null;
    g.fontes.push(l.fonte.id);
    g.bytes += l.fonte.bytes;
    for (const it of l.fonte.itens) g.itens.push({ ...it, caminho: `${PREFIXO}/${it.caminho}` });
  }
  return galerias;
}

/** A galeria do estúdio com este título, se houver — para continuar nela. */
export function galeriaDeMesmoNome<T extends { titulo: string }>(
  titulo: string,
  existentes: T[],
): T | undefined {
  return existentes.find((g) => mesmaCoisa(g.titulo, titulo));
}
