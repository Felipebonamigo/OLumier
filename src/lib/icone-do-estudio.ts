import "server-only";
import type { Metadata } from "next";
import { urlDeLeitura } from "./r2";

/**
 * O ÍCONE DA ABA nas páginas do estúdio: a logo dele, quando houver.
 *
 * ── POR QUE A LOGO (26/09/2026) ───────────────────────────────────────────
 *
 * A vitrine e a galeria herdam o `icon.svg` do layout raiz — o átomo da
 * plataforma. Quando o estúdio tem logo, a aba de cada entrega passa a mostrar
 * a marca DELE: é a estratégia de marca ("a Galeria Átomo fica por trás, a
 * marca do fotógrafo fica na frente") chegando até o canto da aba.
 *
 * ── E SEM LOGO, O FAVICON DE SEMPRE (02/10/2026) ──────────────────────────
 *
 * A primeira versão devolvia "nenhum ícone" para estúdio sem logo, para o átomo
 * não aparecer. O merge com o master trouxe `testar-app-instalado.mjs`, que
 * exige o contrário com razão: a galeria pode não levar o ícone de APP da
 * plataforma (tela de início, manifesto), mas não pode ficar com a aba sem
 * ícone nenhum — aba sem ícone parece página quebrada. Então, sem logo, a
 * página não declara nada e herda o favicon do layout.
 *
 * Devolve um pedaço de metadado para espalhar, e não `icons: undefined`: chave
 * presente com valor vazio é o tipo de detalhe que muda de sentido entre
 * versões do Next.
 *
 * A logo mora num bucket sem endereço público, então vai com link assinado, da
 * mesma validade que a página usa para desenhá-la.
 */
export async function iconeDoEstudio(logoChave: string | null): Promise<Pick<Metadata, "icons">> {
  if (!logoChave) return {};
  try {
    return { icons: { icon: await urlDeLeitura(logoChave, 6 * 3600) } };
  } catch {
    /* Assinar não depende de rede, mas depende de credencial configurada. Sem
       ela, fica o favicon do layout — metadado nunca derruba a página. */
    return {};
  }
}
