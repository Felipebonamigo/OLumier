import { marca } from "@/config/marca";
import { ESPACOS, formatarGb, formatarReais } from "@/config/planos";

/**
 * O `/llms.txt` — o resumo da casa para buscador de IA (29/09/2026).
 *
 * A auditoria de prontidão para buscadores de resposta (ChatGPT, Claude,
 * Perplexity) achou tudo liberado no `robots.txt` e nenhum `/llms.txt`: o robô
 * entra, mas tem de adivinhar o que o site é a partir de uma home cheia de
 * galerias de exemplo.
 *
 * NADA aqui é texto de venda novo, e é de propósito: o que se promete em
 * público é decisão da camada estratégica (`docs/estrategia-de-marca.md`). Este
 * arquivo só junta o que já está publicado — o nome, a assinatura e a descrição
 * de `marca.ts`, o piso de preço que a home mostra, as páginas e o contato — e
 * sai daqueles arquivos, então muda sozinho quando eles mudarem. Vídeo e
 * domínio próprio não aparecem enquanto `config/lancamentos.ts` não os liberar.
 */
export const dynamic = "force-static";

export function GET() {
  const raiz = `https://${marca.dominio}`;
  const piso = ESPACOS[0];
  const corpo = [
    `# ${marca.nome}`,
    "",
    `> ${marca.tagline}. ${marca.descricao}`,
    "",
    `${marca.nome} é uma plataforma brasileira de galerias de entrega: o fotógrafo sobe o trabalho, ` +
      "personaliza a galeria com a marca do estúdio e manda um link para o cliente, que abre no " +
      "celular sem criar conta.",
    "",
    "## Páginas",
    "",
    `- [Início](${raiz}/): o produto, os planos e as perguntas frequentes`,
    `- [Segurança e backup](${raiz}/seguranca): onde os arquivos ficam e o que protege cada entrega`,
    `- [Criar conta](${raiz}/cadastrar): teste grátis, sem cartão`,
    `- [Termos de Uso](${raiz}/termos)`,
    `- [Política de Privacidade](${raiz}/privacidade)`,
    "",
    "## Preço",
    "",
    `A partir de ${formatarReais(piso.precoCentavos)} por mês, no plano de ${formatarGb(piso.gb)}, ` +
      "em reais. O plano é o espaço: nenhum recurso fica atrás de um plano maior.",
    "",
    "## Contato",
    "",
    `- WhatsApp: ${marca.whatsappLink}`,
    "",
  ].join("\n");
  return new Response(corpo, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
