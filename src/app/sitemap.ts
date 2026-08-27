import type { MetadataRoute } from "next";
import { marca } from "@/config/marca";

/*
 * Convenção nativa do Next: este arquivo VIRA o /sitemap.xml.
 *
 * Só o que merece ranquear. Sitemap não é menu: /entrar, /cadastrar e
 * /recuperar são porta, não conteúdo — quem procura "galeria de entrega para
 * fotógrafos" tem que cair na home, não numa tela de login. E as galerias dos
 * estúdios não entram porque não são nossas: cada uma vive no subdomínio do
 * estúdio, com senha e prazo decididos por ele.
 *
 * O domínio sai de `marca.dominio` — na próxima troca de marca o sitemap
 * acompanha sozinho, como o resto da fase 2.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const raiz = `https://${marca.dominio}`;
  return [
    { url: `${raiz}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${raiz}/seguranca`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${raiz}/termos`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${raiz}/privacidade`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
