import { buscarEstudio, enderecoDaVitrine } from "@/lib/vitrine";

export const dynamic = "force-dynamic";

/**
 * O `/robots.txt` DO SUBDOMÍNIO (ou do domínio próprio) do estúdio.
 *
 * O `app/robots.ts` da raiz é o da CASA, e no endereço do estúdio ele nunca
 * respondia: o proxy lia `/robots.txt` como o endereço curto de uma galeria
 * chamada "robots.txt", e o robô recebia a página de 404 depois de uma
 * renderização inteira da rota de galeria, com consulta ao banco. O proxy agora
 * reescreve para cá (26/09/2026).
 *
 * `/g/` e as galerias NÃO entram em `Disallow`, e é de propósito: galeria já
 * sai com `noindex` no `<meta>`, e o robô só lê essa tag se puder abrir a
 * página. Bloquear aqui faria o contrário do pretendido — o Google pode listar
 * endereço bloqueado que alguém linkou, sem ver o `noindex` que o tiraria.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ estudio: string }> }) {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  if (!t) return new Response("Não encontrado\n", { status: 404 });

  const corpo = [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /api",
    "",
    `Sitemap: ${enderecoDaVitrine(t)}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(corpo, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
