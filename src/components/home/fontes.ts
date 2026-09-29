import { Bricolage_Grotesque, Inter } from "next/font/google";

/**
 * AS FONTES DA HOME — e só da home.
 *
 * O briefing pede "tipografia contemporânea e segura" e evita "serifa clássica
 * em excesso" (§2, §3). A casa usava Cormorant nos títulos, que é justamente a
 * serifada clássica do código de casamento premium que a estratégia quer
 * deixar para trás como identidade dominante.
 *
 *   Bricolage Grotesque  títulos. Grotesca com eixo óptico: nos tamanhos
 *                        grandes ganha desenho e personalidade, e não lê como
 *                        o sans genérico de SaaS.
 *   Inter                texto e interface. Legível em qualquer tela, neutra
 *                        o bastante para as fotos falarem mais alto.
 *
 * ⚠️ ESCOLHA PROVISÓRIA de direção de arte, tomada pelo lado técnico para a
 * página existir. A decisão é da camada estratégica — trocar é mudar as duas
 * famílias aqui; o resto da home lê as variáveis.
 *
 * Declaradas aqui, e não no layout, porque só a home as usa: a galeria do
 * cliente e o painel não baixam um byte a mais por causa delas.
 */
export const fonteTitulo = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-home-titulo",
  display: "swap",
});

export const fonteTexto = Inter({
  subsets: ["latin"],
  variable: "--font-home-texto",
  display: "swap",
});
