import type { Tema } from "./aparencia";

/**
 * FOTOS FALSAS PARA A PRÉVIA DO FOTÓGRAFO.
 *
 * A prévia mostrava "As fotos ainda estão sendo preparadas" enquanto a galeria
 * estivesse vazia — que é exatamente quando o fotógrafo está escolhendo a
 * aparência. Ele ajustava capa, tipografia, grade e densidade olhando para uma
 * frase cinza, e só descobria o resultado depois de subir o casamento inteiro.
 *
 * ── POR QUE SVG EMBUTIDO, E NÃO FOTO DE VERDADE ───────────────────────────
 * Foto de banco de imagens custaria licença, peso e uma requisição de rede
 * dentro da página do cliente. Estas são geradas como `data:` URI: não saem do
 * documento, não têm licença e não podem falhar em carregar.
 *
 * As PROPORÇÕES é que importam. A grade em "colunas" corta em alturas
 * variadas, a "editorial" intercala destaques — com seis retângulos idênticos
 * nenhum dos dois eixos mostraria o que faz. Por isso a lista mistura retrato,
 * paisagem e quadrado, na ordem em que um casamento costuma sair.
 *
 * As cores seguem o TEMA escolhido, senão a prévia mentiria no eixo mais
 * visível de todos: um cinza neutro sobre fundo creme parece sujo, e o
 * fotógrafo culparia o tema.
 */

/** Proporções reais de câmera, na ordem em que um casamento costuma sair. */
const CENAS = [
  { nome: "making-of.jpg", largura: 1600, altura: 2400, tom: 0.14 },
  { nome: "detalhes.jpg", largura: 2400, altura: 1600, tom: 0.2 },
  { nome: "cerimonia.jpg", largura: 1800, altura: 1800, tom: 0.11 },
  { nome: "votos.jpg", largura: 1600, altura: 2400, tom: 0.24 },
  { nome: "saida.jpg", largura: 2400, altura: 1350, tom: 0.17 },
  { nome: "retratos.jpg", largura: 1700, altura: 2200, tom: 0.09 },
  { nome: "festa.jpg", largura: 2400, altura: 1600, tom: 0.22 },
  { nome: "ultima-danca.jpg", largura: 1800, altura: 2400, tom: 0.13 },
] as const;

/** O par de tons de cada tema — claro o bastante para ler como foto, não como buraco. */
const TONS: Record<Tema, [string, string]> = {
  noite: ["#1b2029", "#2f3946"],
  claro: ["#dfe3ea", "#c7cdd8"],
  creme: ["#e6dfd0", "#d3c9b4"],
};

/**
 * Um retângulo com gradiente diagonal e um vinco claro atravessando.
 *
 * O vinco não é enfeite: sem nenhuma variação interna, o olho lê "caixa
 * vazia" em vez de "foto", e a prévia deixa de parecer uma galeria.
 */
function svg(largura: number, altura: number, [a, b]: [string, string], tom: number): string {
  const bruto = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
</linearGradient></defs>
<rect width="${largura}" height="${altura}" fill="url(#g)"/>
<path d="M 0 ${Math.round(altura * (0.55 + tom))} L ${largura} ${Math.round(altura * (0.3 + tom))} L ${largura} ${altura} L 0 ${altura} Z" fill="#ffffff" opacity="${(tom * 0.5).toFixed(3)}"/>
<circle cx="${Math.round(largura * 0.72)}" cy="${Math.round(altura * 0.24)}" r="${Math.round(Math.min(largura, altura) * 0.06)}" fill="#ffffff" opacity="${(tom * 0.9).toFixed(3)}"/>
</svg>`;
  /* `encodeURIComponent` e não base64: o SVG fica legível no inspetor, o
   * data: URI sai menor, e não há binário para o navegador decodificar. */
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bruto)}`;
}

export interface FotoDemonstracao {
  id: string;
  nome: string;
  tipo: "foto";
  bytes: number;
  largura: number;
  altura: number;
  url: string;
  urlGrande: string;
  secaoId: null;
}

/**
 * As fotos de mentira, já no formato que a galeria consome.
 *
 * O `id` começa com `demo:` de propósito. Ele nunca chega ao banco — a prévia
 * não deixa favoritar nem baixar —, mas se um dia chegar, um id que não é UUID
 * falha alto em vez de gravar lixo silenciosamente numa galeria de verdade.
 */
export function fotosDeDemonstracao(tema: Tema): FotoDemonstracao[] {
  const tons = TONS[tema];
  return CENAS.map((c, i) => {
    const imagem = svg(c.largura, c.altura, tons, c.tom);
    return {
      id: `demo:${i}`,
      nome: c.nome,
      tipo: "foto" as const,
      bytes: 0,
      largura: c.largura,
      altura: c.altura,
      url: imagem,
      urlGrande: imagem,
      secaoId: null,
    };
  });
}
