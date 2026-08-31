/**
 * Regras da fonte própria do estúdio.
 *
 * Puro de propósito, como `marca-estudio.ts`: nada aqui toca banco, sessão ou
 * bucket, então cada regra se testa sem subir servidor.
 */

/**
 * ── POR QUE A VALIDAÇÃO É PELA ASSINATURA, E NÃO PELO TIPO DECLARADO ───────
 *
 * A logo pôde ser validada por MIME porque navegador nenhum tem dúvida sobre o
 * que é `image/png`. Com fonte é o contrário: `.ttf` e `.otf` chegam do
 * navegador como `application/octet-stream` na maioria das vezes, e o mesmo
 * `application/octet-stream` é o que chega quando a pessoa envia um .zip por
 * engano. Validar por MIME recusaria arquivo bom e aceitaria arquivo qualquer.
 *
 * Formato de fonte tem assinatura nos quatro primeiros bytes, e ela é a
 * verdade — é isso que o navegador vai olhar na hora de desenhar.
 */
export const ASSINATURAS: { hex: string; formato: string; css: string }[] = [
  /* wOF2 — o formato da web: menor, e o único que todo navegador atual lê sem
     ressalva. É para onde a pessoa deveria converter, e é o primeiro da lista
     porque é o que a mensagem de ajuda recomenda. */
  { hex: "774f4632", formato: "WOFF2", css: "woff2" },
  { hex: "774f4646", formato: "WOFF", css: "woff" },
  /* OTTO — OpenType com contornos CFF (o .otf comum de fundição). */
  { hex: "4f54544f", formato: "OTF", css: "opentype" },
  /* 0x00010000 — TrueType. `true` (0x74727565) é a variante antiga do Mac, que
     alguns pacotes de marca ainda carregam. */
  { hex: "00010000", formato: "TTF", css: "truetype" },
  { hex: "74727565", formato: "TTF", css: "truetype" },
];

/** O que o seletor de arquivo oferece. Conveniência, não segurança: quem quiser
 *  burlar troca a extensão — quem decide é a assinatura, no servidor. */
export const EXTENSOES_FONTE = ".woff2,.woff,.otf,.ttf";

/**
 * 3 MB.
 *
 * WOFF2 de uma família fica entre 20 e 200 KB; um OTF cheio, com todos os
 * acentos e alternativas, chega perto de 2 MB. Acima de 3 MB não é fonte de
 * texto: é um pacote inteiro, ou outra coisa com nome de fonte. E cada byte
 * aqui é baixado pelo CELULAR do casal antes de a galeria pintar.
 */
export const LIMITE_FONTE = 3 * 1024 * 1024;

/** Reconhece o formato pelos primeiros bytes. `null` quando não é fonte. */
export function formatoDaFonte(inicio: Uint8Array): { formato: string; css: string } | null {
  if (inicio.length < 4) return null;
  const hex = Buffer.from(inicio.subarray(0, 4)).toString("hex");
  const achado = ASSINATURAS.find((a) => a.hex === hex);
  return achado ? { formato: achado.formato, css: achado.css } : null;
}

/**
 * Motivo para recusar, ou `null` quando está tudo bem.
 *
 * `inicio` é opcional porque a primeira checagem acontece ANTES do envio, com o
 * tamanho que o navegador anunciou — ali dá para poupar a pessoa de esperar um
 * arquivo de 40 MB subir para só então ouvir não. A checagem que vale é a
 * segunda, no servidor, com os bytes que de fato chegaram.
 */
export function recusaDaFonte(bytes: number, inicio?: Uint8Array): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Arquivo vazio.";
  if (bytes > LIMITE_FONTE) {
    return `A fonte passa de ${Math.round(LIMITE_FONTE / 1024 / 1024)} MB. Converta para WOFF2 — fica muito menor e abre mais rápido no celular do seu cliente.`;
  }
  if (inicio && !formatoDaFonte(inicio)) {
    return "Este arquivo não é uma fonte. Aceitamos WOFF2, WOFF, OTF e TTF.";
  }
  return null;
}

/**
 * O nome que aparece no seletor, tirado do nome do arquivo.
 *
 * Sai no HTML da galeria pública dentro de um seletor de fonte, então a peneira
 * não é estética: sem ela, um nome com aspas ou ponto e vírgula deixaria de ser
 * texto e viraria CSS escolhido por quem enviou. Ficam letras, números, espaço
 * e hífen — o suficiente para "Playfair Display" e "Minha-Fonte 2".
 */
export function nomeDaFonte(nomeDoArquivo: string): string {
  const semExtensao = nomeDoArquivo.replace(/\.[a-z0-9]{1,8}$/i, "");
  const limpo = semExtensao
    .replace(/[_]+/g, " ")
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return limpo || "Minha fonte";
}

/**
 * O nome da família dentro do CSS da galeria.
 *
 * Fixo, e não derivado do nome do arquivo, de propósito: é a única string que
 * o `@font-face` e o `font-family` precisam ter em comum, e derivá-la de texto
 * enviado seria repetir o problema que `nomeDaFonte` acabou de resolver, num
 * lugar onde o erro não aparece — a fonte simplesmente não aplicaria.
 */
export const FAMILIA_PROPRIA = "FonteDoEstudio";
