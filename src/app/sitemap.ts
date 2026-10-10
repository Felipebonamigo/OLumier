import type { MetadataRoute } from "next";
import { marca } from "@/config/marca";
import { vitrinesParaOSitemap } from "@/lib/vitrine";

/*
 * Convenção nativa do Next: este arquivo VIRA o /sitemap.xml.
 *
 * Só o que merece ranquear. Sitemap não é menu: /entrar, /cadastrar e
 * /recuperar são porta, não conteúdo — quem procura "galeria de entrega para
 * fotógrafos" tem que cair na home, não numa tela de login. E as galerias dos
 * estúdios não entram: são entregas pessoais, com `noindex`.
 *
 * As VITRINES entram (10/10/2026), no endereço do estúdio — a regra de quais,
 * e por que o Google aceita outro host aqui, está em `vitrinesParaOSitemap`.
 * Cada vitrine indexada é uma página com o nome do fotógrafo e um selo que
 * leva à casa.
 *
 * Por pedido, e não no build: a lista muda a cada galeria publicada, e o build
 * não tem banco. Se o banco falhar, sai a parte da casa — um sitemap pela
 * metade é melhor que um erro 500 no arquivo que o Google lê.
 *
 * O domínio sai de `marca.dominio` — na próxima troca de marca o sitemap
 * acompanha sozinho, como o resto da fase 2.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const raiz = `https://${marca.dominio}`;
  const casa: MetadataRoute.Sitemap = [
    { url: `${raiz}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${raiz}/seguranca`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${raiz}/termos`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${raiz}/privacidade`, changeFrequency: "yearly", priority: 0.3 },
  ];

  let vitrines: Awaited<ReturnType<typeof vitrinesParaOSitemap>> = [];
  try {
    vitrines = await vitrinesParaOSitemap();
  } catch (e) {
    console.error("[sitemap] vitrines fora desta vez:", e instanceof Error ? e.message : e);
  }

  return [
    ...casa,
    ...vitrines.map((v) => ({
      url: `https://${v.slug}.${marca.dominio}/`,
      lastModified: v.atualizada,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
