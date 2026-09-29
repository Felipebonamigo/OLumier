import "server-only";
import { consultar } from "@/lib/db";
import { FOTOS_PADRAO, type FotosDaHome } from "@/config/home-demonstracao";
import { mesclarFotosDaHome, type LinhaFotoDaHome } from "@/lib/fotos-da-home-regras";

/**
 * As fotos da página inicial: o padrão do repositório com as trocas do admin
 * por cima (ver `mesclarFotosDaHome`).
 *
 * NUNCA LANÇA. A home é a página que decide se o fotógrafo fica, e ela não
 * pode cair porque o banco demorou — nem no `next build`, que a pré-desenha e
 * pode rodar antes de a migração 043 existir no banco dele. Sem banco, a home
 * sai com as fotos padrão; na próxima regeneração, com as do admin.
 */
export async function fotosDaHome(): Promise<FotosDaHome> {
  try {
    const linhas = await consultar<LinhaFotoDaHome>(
      `select lugar, chave, chave_miniatura, largura, altura, descricao, foco_x, foco_y
         from fotos_da_home`,
    );
    return mesclarFotosDaHome(FOTOS_PADRAO, linhas);
  } catch (e) {
    console.error("[home] fotos do admin indisponíveis, usando as padrão:", e);
    return FOTOS_PADRAO;
  }
}

/** A troca de cada lugar, para a tela do admin dizer quando e quem trocou. */
export interface TrocaDaFotoDaHome {
  lugar: string;
  trocada_em: Date;
  quem: string | null;
}

export async function trocasDaHome(): Promise<TrocaDaFotoDaHome[]> {
  return consultar<TrocaDaFotoDaHome>(
    `select f.lugar, f.trocada_em, t.email as quem
       from fotos_da_home f
       left join tenants t on t.id = f.trocada_por`,
  );
}
