import "server-only";
import type { Metadata } from "next";
import { urlDeLeitura } from "./r2";

/**
 * O ÍCONE DA ABA nas páginas do estúdio: a logo dele, ou nenhum.
 *
 * ── POR QUE NÃO O NOSSO (26/09/2026) ──────────────────────────────────────
 *
 * Sem isto, a vitrine e a galeria herdam o `icon.svg` do layout raiz — o átomo
 * da plataforma. No subdomínio do estúdio o pedido nem chegava a ele: o proxy
 * reescrevia `/icon.svg` como se fosse o endereço de uma galeria, e cada visita
 * pagava uma renderização inteira da rota de galeria, com consulta ao banco,
 * para devolver um 404. A aba ficava sem ícone por acidente.
 *
 * Consertar só o proxy poria o átomo na aba de toda entrega — a marca do
 * fornecedor na frente da do estúdio, que é justamente o que a galeria existe
 * para não fazer. Então a página diz o que quer: a logo do estúdio quando ela
 * aparece na página, e lista vazia quando não — e lista vazia, para o Next,
 * quer dizer "não pendure o ícone do layout".
 *
 * A logo mora num bucket sem endereço público, então vai com link assinado, da
 * mesma validade que a página usa para desenhá-la.
 */
export async function iconeDoEstudio(logoChave: string | null): Promise<Metadata["icons"]> {
  if (logoChave) {
    try {
      return { icon: await urlDeLeitura(logoChave, 6 * 3600) };
    } catch {
      /* Assinar não depende de rede, mas depende de credencial configurada. Sem
         ela, a aba fica sem ícone — metadado nunca derruba a página. */
    }
  }
  return { icon: [] };
}
