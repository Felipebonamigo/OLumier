/**
 * QUE ARQUIVO É ESTE, E COM QUE MIME ELE DEVE SUBIR.
 *
 * Módulo compartilhado, sem `server-only`, de propósito: a MESMA pergunta é
 * feita nos dois lados da rede. O servidor a usa para aceitar ou recusar o
 * envio e para assinar a URL; o navegador a usa para decidir se gera pôster de
 * vídeo ou miniatura de foto.
 *
 * Isto morava em `lib/medias.ts`, que é `server-only` — então o navegador não
 * podia perguntar, e respondia sozinho olhando `File.type`. Foi assim que o
 * vídeo do Juan subiu sem capa em 29/09/2026: com o mime vazio (o que o
 * sistema dá para muito `.mov`, e para todo `.heic` no Windows), o gerador não
 * reconhecia o vídeo e devolvia nada — o ladrilho vazio com o botão de play do
 * print dele. Duas regras para a mesma pergunta é como os dois lados discordam.
 *
 * `lib/medias.ts` reexporta daqui: nenhum chamador antigo precisou mudar.
 */

export const TIPOS_ACEITOS: Record<string, "foto" | "video"> = {
  "image/jpeg": "foto",
  "image/png": "foto",
  "image/webp": "foto",
  "image/avif": "foto",
  "image/heic": "foto",
  "image/heif": "foto",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

/**
 * O MIME QUE A EXTENSÃO DENUNCIA, quando o navegador não sabe dizer.
 *
 * ── DE ONDE VEIO (29/09/2026) ─────────────────────────────────────────────
 *
 * A Carol tentou subir uma galeria nova e recebeu "0 de 74 — 33 com erro", e
 * subindo. Nada no servidor: a recusa era 415, resposta esperada, não exceção.
 *
 * A causa é o Windows. `File.type` sai do registro do sistema, e o Windows não
 * traz mime para `.heic`/`.heif` sem a extensão da Microsoft instalada — o
 * navegador manda string VAZIA. O servidor lia só o mime, não achava no mapa e
 * recusava TODOS os arquivos, com uma mensagem que culpa o arquivo ("tipo não
 * aceito") por uma lacuna do sistema operacional. E a zona de envio anuncia
 * HEIC na própria tela: o produto prometia o que recusava.
 *
 * O nome do arquivo é a única pista que sempre chega. Ele não vale MAIS que o
 * mime — vale QUANDO o mime não diz nada.
 */
const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * O que este arquivo é, e com que mime ele deve subir.
 *
 * A ORDEM É A REGRA: mime conhecido manda, porque é o único dos dois que o
 * navegador de fato conferiu; a extensão só entra quando ele não reconheceu
 * nada. Sem mime E sem extensão conhecida, a recusa é a de sempre — a saída
 * pela extensão não pode virar porta dos fundos.
 *
 * Devolve TAMBÉM o mime resolvido porque a URL de envio é assinada com ele: se
 * o servidor assinar com `image/heic` e o navegador mandar o cabeçalho vazio, o
 * armazém recusa a assinatura. Os dois lados têm de dizer a mesma coisa.
 */
export function reconhecerArquivo(
  nome: string,
  mime: string,
): { tipo: "foto" | "video"; mime: string } | null {
  const doMime = TIPOS_ACEITOS[mime];
  if (doMime) return { tipo: doMime, mime };

  const extensao = nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const daExtensao = extensao ? MIME_POR_EXTENSAO[extensao] : undefined;
  if (!daExtensao) return null;
  return { tipo: TIPOS_ACEITOS[daExtensao], mime: daExtensao };
}
