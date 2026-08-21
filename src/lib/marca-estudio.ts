/**
 * Regras da marca do estúdio — o que o cliente final vê na capa.
 *
 * Puro de propósito: nada aqui toca banco, sessão ou bucket, então dá para
 * testar cada regra sem subir servidor. (Não confundir com `src/config/marca.ts`,
 * que é a marca do Fotônio; esta aqui é a marca de cada fotógrafo.)
 */
import { TEMAS } from "@/config/aparencia";

/** Tipos que o navegador desenha em <img> sem surpresa. */
export const TIPOS_LOGO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/*
 * SVG fica de fora de propósito.
 *
 * Seria o formato ideal para logo — vetor, nítido em qualquer tamanho — mas um
 * SVG é um documento, não uma imagem: pode conter script e referência externa.
 * Dentro de <img> o navegador não executa esse script, só que basta alguém um
 * dia abrir o arquivo direto pelo link assinado (ou nós passarmos a embutir o
 * SVG na página para poder colori-lo) para virar execução no nosso domínio.
 * Aceitar depois é fácil; tirar de uma conta que já enviou, não.
 */

/** 2 MB. Logo é marca, não fotografia — acima disso é original mal exportado. */
export const LIMITE_LOGO = 2 * 1024 * 1024;

export const COR_PADRAO = "#f0c268";

/**
 * Aceita #rgb e #rrggbb e devolve sempre #rrggbb minúsculo.
 *
 * A cor entra num `style` e sai no HTML da galeria pública. Sem essa peneira, o
 * campo aceitaria qualquer texto e o que fosse gravado apareceria cru dentro do
 * atributo — um valor como `red;background:url(...)` deixaria de ser uma cor e
 * passaria a ser CSS escolhido por quem preencheu.
 */
export function normalizarCor(bruta: string): string | null {
  const t = bruta.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return null;
}

/**
 * Luminância relativa (WCAG). Serve para a tela avisar quando a cor escolhida
 * some no tema claro ou no escuro — a galeria tem os dois, e uma cor pode ficar
 * perfeita num e invisível no outro.
 */
export function luminancia(cor: string): number {
  const hex = normalizarCor(cor) ?? COR_PADRAO;
  const canal = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

/** Contraste WCAG entre duas cores: 1 (igual) a 21 (preto no branco). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  const [claro, escuro] = x > y ? [x, y] : [y, x];
  return (claro + 0.05) / (escuro + 0.05);
}

/*
 * Os fundos vêm de src/config/aparencia.ts, não de constantes copiadas: repetir
 * "#0d0b09" aqui criaria uma segunda verdade que envelheceria calada no dia em
 * que alguém ajustasse o tema.
 *
 * Hoje a cor do estúdio só é desenhada na vitrine /e/<slug>, que é fixa no tema
 * noite. Mesmo assim conferimos o claro também: no dia em que a cor passar a
 * valer dentro da galeria, o aviso já vai estar certo.
 */
export const FUNDO_ESCURO = TEMAS.noite["--g-fundo"];
export const FUNDO_CLARO = TEMAS.claro["--g-fundo"];

/**
 * Onde essa cor vai sumir. Devolve os fundos em que o contraste fica abaixo de
 * 3:1 — o piso da WCAG para texto grande, que é o caso aqui.
 *
 * Isto AVISA, não bloqueia: é a marca da pessoa, e um estúdio pode legitimamente
 * ter identidade quase preta. Decidir por ela seria pior que mostrar o problema.
 */
export function temasEmQueSome(cor: string): string[] {
  const problemas: string[] = [];
  if (contraste(cor, FUNDO_ESCURO) < 3) problemas.push("escuro");
  if (contraste(cor, FUNDO_CLARO) < 3) problemas.push("claro");
  return problemas;
}

/**
 * O nome aparece na capa e no `alt` da logo. Só corta o excesso e o espaço
 * repetido — nada de tirar caractere: nome de estúdio tem acento, "&", ponto.
 */
export function normalizarNomeEstudio(bruto: string): string | null {
  const t = bruto.replace(/\s+/g, " ").trim().slice(0, 80);
  return t.length >= 2 ? t : null;
}

/** Mensagem única para os dois lados (navegador e servidor) recusarem igual. */
export function recusaDaLogo(mime: string, bytes: number): string | null {
  if (!TIPOS_LOGO[mime]) return "A logo precisa ser PNG, JPG ou WEBP.";
  if (!Number.isFinite(bytes) || bytes <= 0) return "Arquivo vazio ou inválido.";
  if (bytes > LIMITE_LOGO) return "A logo passa de 2 MB. Exporte menor — é marca, não fotografia.";
  return null;
}
