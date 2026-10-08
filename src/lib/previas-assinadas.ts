import "server-only";
import { consultar } from "./db";
import { armazemDe, urlDaDerivada } from "./armazem";

/** Quantas prévias por pedido: a foto aberta, as vizinhas, e só. */
export const LOTE_DE_PREVIAS = 8;

/** O que o navegador desenha sem ajuda. HEIC e RAW ficam de fora, de propósito. */
const DESENHA_SOZINHO = /^image\/(jpeg|png|webp|gif|avif)$/i;

/**
 * OS ENDEREÇOS DA FOTO AMPLIADA, na aba Fotos (08/10/2026).
 *
 * Pedido de uma aluna: "poder ampliar/abrir a foto enquanto estou organizando a
 * galeria — às vezes preciso ver o rosto do convidado pra botar no lugar certo,
 * ver algum detalhe, escolher as melhores". A miniatura da grade tem 640 px e é
 * pequena de propósito (25/09/2026: "tá quase uma visualização de galeria");
 * olhar o rosto de alguém pede mais.
 *
 * A PRÉVIA, e não o original: é a mesma imagem de 2048 px que o casal vê na
 * galeria — larga o bastante para conferir um rosto ou um detalhe, e leve para
 * abrir em meio segundo. Abrir o original (muitas vezes 20 MB, às vezes RAW)
 * faria cada passada de foto em foto esperar um download.
 *
 * Sem prévia (a foto subiu antes das derivadas, ou o navegador do envio não
 * soube gerá-la), cai no original SE o navegador sabe desenhá-lo. Um HEIC não
 * sabe — o `<img>` ficaria quebrado —, e então não volta endereço nenhum: quem
 * pediu continua com a miniatura, que é a verdade que existe.
 *
 * Só fotos desta galeria e deste estúdio: o id vem do navegador, e a condição
 * do estúdio no WHERE é a tranca de sempre.
 */
export async function enderecosDasPrevias(
  galeriaId: string,
  tenantId: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const linhas = await consultar<{
    id: string;
    chave: string;
    chave_preview: string | null;
    chave_thumb: string | null;
    mime: string;
    armazem: string | null;
  }>(
    `select id, chave, chave_preview, chave_thumb, mime, armazem from medias
      where galeria_id = $1 and tenant_id = $2 and id = any($3::uuid[])
        and pronto and tipo = 'foto'`,
    [galeriaId, tenantId, ids.slice(0, LOTE_DE_PREVIAS)],
  );

  const pares = await Promise.all(
    linhas.map(async (l) => {
      if (!l.chave_preview && !DESENHA_SOZINHO.test(l.mime)) return null;
      const url = await urlDaDerivada(l.chave_preview, l.chave, armazemDe(l.armazem), 3600);
      return [l.id, url] as const;
    }),
  );
  return Object.fromEntries(pares.filter((p): p is readonly [string, string] => p !== null));
}
