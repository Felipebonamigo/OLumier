"use client";

/**
 * A DATA EM QUE A FOTO FOI TIRADA, lida do EXIF no navegador.
 *
 * ── PARA QUE SERVE ─────────────────────────────────────────────────────────
 *
 * Para a ordenação cronológica dos capítulos (pedido do Felipe, 16/09/2026).
 * Num casamento com dois fotógrafos, nem a ordem de envio nem o nome do arquivo
 * dizem a ordem real: as duas pastas sobem uma depois da outra, e cada câmera
 * numera a própria sequência — `DSC_0001` das duas. O relógio da câmera é a
 * única coisa que sabe, e ele está aqui.
 *
 * ── POR QUE UM LEITOR PRÓPRIO, E NÃO UMA BIBLIOTECA ───────────────────────
 *
 * As bibliotecas de EXIF leem cento e poucos campos — lente, ISO, GPS, perfil
 * de cor — e pesam entre 20 e 60 KB. Daqui só interessa UM campo, e ele está
 * sempre nos primeiros quilobytes do arquivo. Sessenta linhas de leitura de
 * bytes custam menos que a dependência, e não há o que atualizar depois.
 *
 * ── O QUE ESTE MÓDULO NÃO FAZ ─────────────────────────────────────────────
 *
 * Não lê vídeo (a data do filme está no átomo `mvhd` do MP4, outro formato),
 * não lê HEIC (contêiner ISO-BMFF) e não lê PNG. Nos três devolve `null`, e
 * quem ordena cai na data de envio — que é o comportamento anunciado na tela.
 */

/** Quanto do arquivo basta ler. O APP1 é o primeiro segmento depois do SOI. */
const PEDACO = 128 * 1024;

/**
 * `DateTimeOriginal` (tag 0x9003) do EXIF, ou null.
 *
 * Nunca estoura: arquivo truncado, EXIF malformado ou data impossível devolvem
 * null. Uma exceção aqui pararia o envio de uma foto por causa de um
 * cabeçalho torto, que é trocar a entrega inteira por um campo de ordenação.
 */
export async function dataDaFoto(arquivo: File): Promise<Date | null> {
  if (!/^image\/(jpeg|jpg|tiff)$/i.test(arquivo.type)) return null;
  try {
    const buffer = await arquivo.slice(0, PEDACO).arrayBuffer();
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // não é JPEG

    /* Percorre os segmentos até achar o APP1 com a assinatura "Exif\0\0".
       Cada segmento é 0xFF, marcador, tamanho de 2 bytes, conteúdo. */
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marcador = v.getUint8(p + 1);
      /* SOS (0xDA) é o começo dos dados da imagem: daí em diante não há mais
         metadado, e continuar seria interpretar pixel como cabeçalho. */
      if (marcador === 0xda) return null;
      const tamanho = v.getUint16(p + 2);
      if (tamanho < 2) return null;
      if (marcador === 0xe1 && p + 10 <= v.byteLength) {
        const assinatura = String.fromCharCode(
          v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7),
        );
        if (assinatura === "Exif") return lerTiff(v, p + 10);
      }
      p += 2 + tamanho;
    }
    return null;
  } catch {
    return null;
  }
}

/** O bloco TIFF que começa em `base`, onde os ponteiros são relativos a ele. */
function lerTiff(v: DataView, base: number): Date | null {
  if (base + 8 > v.byteLength) return null;
  const ordem = v.getUint16(base);
  /* "II" (0x4949) é little-endian, "MM" (0x4d4d) é big. Câmeras usam os dois:
     Canon e Sony escrevem II, Nikon costuma escrever MM. */
  const le = ordem === 0x4949;
  if (!le && ordem !== 0x4d4d) return null;
  if (v.getUint16(base + 2, le) !== 42) return null;

  const ifd0 = base + v.getUint32(base + 4, le);
  /* 0x8769 aponta o IFD do Exif, onde mora a data que interessa. 0x0132
     (DateTime) fica no IFD0 e é a data de MODIFICAÇÃO — serve de reserva,
     porque em arquivo sem edição as duas são iguais. */
  const exif = lerTag(v, base, ifd0, 0x8769, le);
  const deOndeVier =
    (typeof exif === "number" ? lerData(v, base, base + exif, 0x9003, le) : null) ??
    lerData(v, base, ifd0, 0x0132, le);
  return deOndeVier;
}

/** O valor cru da tag pedida, ou null. Só os tipos que esta leitura usa. */
function lerTag(v: DataView, base: number, ifd: number, alvo: number, le: boolean): number | null {
  if (ifd + 2 > v.byteLength) return null;
  const quantas = v.getUint16(ifd, le);
  for (let i = 0; i < quantas; i++) {
    const campo = ifd + 2 + i * 12;
    if (campo + 12 > v.byteLength) return null;
    if (v.getUint16(campo, le) === alvo) return v.getUint32(campo + 8, le);
  }
  return null;
}

/** A tag ASCII `alvo` do IFD, no formato "YYYY:MM:DD HH:MM:SS". */
function lerData(v: DataView, base: number, ifd: number, alvo: number, le: boolean): Date | null {
  if (ifd + 2 > v.byteLength) return null;
  const quantas = v.getUint16(ifd, le);
  for (let i = 0; i < quantas; i++) {
    const campo = ifd + 2 + i * 12;
    if (campo + 12 > v.byteLength) return null;
    if (v.getUint16(campo, le) !== alvo) continue;

    const tamanho = v.getUint32(campo + 4, le);
    if (tamanho < 19) return null; // "YYYY:MM:DD HH:MM:SS" tem 19
    /* Até 4 bytes o valor cabe no próprio campo; acima disso, o campo guarda um
       deslocamento a partir do início do TIFF. A data tem 20, então é sempre
       deslocamento — mas a conta fica explícita para quem ler. */
    const onde = tamanho > 4 ? base + v.getUint32(campo + 8, le) : campo + 8;
    if (onde + 19 > v.byteLength) return null;

    let texto = "";
    for (let k = 0; k < 19; k++) texto += String.fromCharCode(v.getUint8(onde + k));

    const m = texto.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    const [, ano, mes, dia, hora, min, seg] = m.map(Number);
    /*
     * O EXIF não tem fuso: a câmera grava a hora do relógio dela. Montar como
     * hora LOCAL do navegador é a leitura menos errada — quem ordena é o
     * fotógrafo, na cidade do casamento, e o que importa é a ordem relativa,
     * que não muda com o fuso escolhido.
     */
    const d = new Date(ano, mes - 1, dia, hora, min, seg);
    /* Câmera com relógio zerado grava 1970 ou 0000; data assim ordena tudo para
       o começo e estraga a sequência inteira. */
    if (Number.isNaN(d.getTime()) || ano < 1990 || d.getTime() > Date.now() + 86400000) return null;
    return d;
  }
  return null;
}
