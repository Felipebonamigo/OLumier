import { buscarEstudio, enderecoDaVitrine } from "@/lib/vitrine";

export const dynamic = "force-dynamic";

/**
 * O `/sitemap.xml` DO ENDEREÇO do estúdio — o proxy reescreve `/sitemap.xml`
 * para cá. Irmão de `regras-para-robos`, ao lado.
 *
 * Uma URL só: a vitrine, no endereço CANÔNICO (`enderecoDaVitrine`). As
 * galerias ficam de fora pela mesma razão que ficam fora do sitemap da casa:
 * são entregas pessoais, com `noindex`, e sitemap é a lista do que MERECE
 * ranquear — listar página que pede para não ser indexada é mandar dois
 * recados opostos ao mesmo robô.
 *
 * Endereço de domínio é só letra, número, ponto e hífen (a própria validação
 * de `normalizarDominio` garante), então nada aqui precisa de escape de XML.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ estudio: string }> }) {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  if (!t) return new Response("Não encontrado\n", { status: 404 });

  const corpo = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `<url><loc>${enderecoDaVitrine(t)}/</loc></url>`,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(corpo, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
