import type { MetadataRoute } from "next";
import { marca } from "@/config/marca";

/*
 * Convenção nativa do Next: este arquivo VIRA o /robots.txt — degrau da
 * plataforma, sem rota à mão. Até 27/08/2026 o caminho devolvia 404 (a página
 * de "não encontramos"), o que na prática liberava tudo e não apontava mapa
 * nenhum. A auditoria de SEO achou; scripts/testar-seo.mjs prende.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      /*
       * O painel é ferramenta logada e a API é máquina falando com máquina —
       * nenhum dos dois tem o que fazer num resultado de busca. `/g/` fica de
       * fora da lista de bloqueio de propósito: galeria pública é do estúdio, e
       * quem decide se ela aparece é a senha e o prazo, não o robots.
       *
       * `/bio/ir` são os redirecionadores da página-ponte do Instagram: cada
       * visita é um clique contado, e robô não clica. A própria `/bio` fica
       * aberta, e o `noindex` dela é o que a tira do Google.
       *
       * `/selo` (o "entregue com" das vitrines) fica ABERTO, ao contrário: é por
       * ele que o robô vai de cada vitrine indexada até a home, e o clique de
       * robô já não conta (`ehRobo`). Fechar aqui cortaria esse caminho.
       */
      disallow: ["/painel", "/api", "/bio/ir"],
    },
    sitemap: `https://${marca.dominio}/sitemap.xml`,
  };
}
