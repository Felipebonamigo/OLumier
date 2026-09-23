import type { Metadata } from "next";
import {
  Montserrat,
  Cormorant_Garamond,
  Great_Vibes,
  Playfair_Display,
  Lora,
  Jost,
  Raleway,
  Parisienne,
  Petit_Formal_Script,
  EB_Garamond,
  Libre_Baskerville,
  Bodoni_Moda,
  Josefin_Sans,
  Work_Sans,
  Outfit,
  Dancing_Script,
  Sacramento,
  Italianno,
  Cinzel,
  Marcellus,
  Tenor_Sans,
} from "next/font/google";
import { marca } from "@/config/marca";
import { SCRIPT_TEMA } from "@/config/tema";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans-app",
  subsets: ["latin"],
  display: "swap",
});

/*
 * A serifada é usada só no título da galeria pública — a página que o casal vê.
 * Ali o tom é de convite, não de painel.
 *
 * ── SEM `weight`, DE PROPÓSITO (16/09/2026) ──────────────────────────────
 *
 * Eram três arquivos estáticos: 400, 600 e 700. Felipe, olhando o eixo de
 * grossura: "a normal pra fina não muda nada, só muda da normal para forte".
 * Ele estava certo, e a causa estava aqui: "Fina" pede 300, e 300 não estava
 * entre os três — o navegador escolhe o mais próximo que EXISTE, que era o 400
 * da "Normal". O eixo tinha três botões e duas respostas.
 *
 * Omitir `weight` faz o `next/font` servir a versão VARIÁVEL da família, cujo
 * eixo vai de 300 a 700. Além de devolver a resposta que faltava, troca três
 * arquivos por um: a galeria baixa menos do que baixava antes, não mais.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-serif-app",
  subsets: ["latin"],
  display: "swap",
});

// Usada só na tipografia "manuscrita" das galerias — clima de convite de casamento.
const greatVibes = Great_Vibes({
  variable: "--font-script-app",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

/*
 * ── AS FONTES QUE O FOTÓGRAFO PODE ESCOLHER ───────────────────────────────
 *
 * As três acima são da CASA: a interface inteira as usa, então valem o
 * pré-carregamento. As seis abaixo existem só para o eixo de tipografia da
 * galeria, e cada estúdio usa UMA.
 *
 * `preload: false` em todas elas, e isso não é detalhe de performance — é o
 * argumento do produto. A galeria do casal abre rápido porque carrega miniatura
 * de dezenas de KB em vez dos megabytes que o concorrente serve; pré-carregar
 * nove fontes numa página que usa uma jogaria isso fora numa linha.
 *
 * Sem `preload`, o navegador só busca o arquivo quando encontra um elemento que
 * pede aquela família. Na galeria isso é exatamente a fonte escolhida. No
 * painel, onde o seletor mostra cada nome desenhado na própria fonte, todas
 * descem — e ali tudo bem: é a página do fotógrafo, e ver a fonte é o objetivo.
 *
 * `scripts/testar-aparencia.mjs` recusa uma fonte oferecida sem carregar aqui,
 * e recusa uma fonte de galeria sem `preload: false`.
 */
const playfair = Playfair_Display({
  variable: "--font-titulo-playfair",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const lora = Lora({
  variable: "--font-titulo-lora",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const jost = Jost({
  variable: "--font-titulo-jost",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const raleway = Raleway({
  variable: "--font-titulo-raleway",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const parisienne = Parisienne({
  variable: "--font-titulo-parisienne",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});
const petitFormal = Petit_Formal_Script({
  variable: "--font-titulo-petit",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});

/*
 * ── A SEGUNDA LEVA (27/08/2026) ───────────────────────────────────────────
 *
 * Nove fontes eram pouco: o fotógrafo escolhe a tipografia da entrega dele, e
 * três opções por família viram "nenhuma serve". Vinte e uma é uma lista que
 * dá para percorrer sem cansar — e o seletor agrupa por família justamente
 * para ninguém precisar olhar as vinte e uma.
 *
 * Todas com `preload: false`, pela mesma razão do bloco acima: a galeria do
 * casal baixa UMA fonte, a escolhida. `testar-aparencia.mjs` recusa qualquer
 * uma que escape dessa regra.
 *
 * MAIÚSCULAS é família nova. Cinzel, Marcellus e Tenor Sans são a tipografia de
 * convite de casamento — a que o fotógrafo reconhece do papel, e que não existia
 * em nenhuma das três famílias anteriores.
 */
const ebGaramond = EB_Garamond({
  variable: "--font-titulo-garamond",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const baskerville = Libre_Baskerville({
  variable: "--font-titulo-baskerville",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});
const bodoni = Bodoni_Moda({
  variable: "--font-titulo-bodoni",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const josefin = Josefin_Sans({
  variable: "--font-titulo-josefin",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const workSans = Work_Sans({
  variable: "--font-titulo-work",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const outfit = Outfit({
  variable: "--font-titulo-outfit",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const dancing = Dancing_Script({
  variable: "--font-titulo-dancing",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const sacramento = Sacramento({
  variable: "--font-titulo-sacramento",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});
const italianno = Italianno({
  variable: "--font-titulo-italianno",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});
const cinzel = Cinzel({
  variable: "--font-titulo-cinzel",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});
const marcellus = Marcellus({
  variable: "--font-titulo-marcellus",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});
const tenor = Tenor_Sans({
  variable: "--font-titulo-tenor",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
});

/** Todas as variáveis de fonte, num lugar só — o <body> não precisa saber quantas são. */
const FONTES = [
  montserrat,
  cormorant,
  greatVibes,
  playfair,
  lora,
  jost,
  raleway,
  parisienne,
  petitFormal,
  ebGaramond,
  baskerville,
  bodoni,
  josefin,
  workSans,
  outfit,
  dancing,
  sacramento,
  italianno,
  cinzel,
  marcellus,
  tenor,
]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  /*
   * `metadataBase` é o que torna ABSOLUTA toda URL de metadado — e absoluta não
   * é detalhe: WhatsApp e afins não resolvem caminho relativo em og:image, então
   * sem isto a tag existe e a prévia continua sem imagem, que é o pior estado
   * possível, porque parece feito. O domínio sai de `marca.dominio`: na próxima
   * troca de marca, tudo aqui acompanha sozinho.
   */
  metadataBase: new URL(`https://${marca.dominio}`),
  title: {
    default: `${marca.nome} — ${marca.tagline}`,
    template: `%s · ${marca.nome}`,
  },
  description: marca.descricao,
  /*
   * Open Graph no LAYOUT, de propósito: fotógrafo compartilha link por
   * WhatsApp, e qualquer página desta casa que circular — home, segurança,
   * termos — precisa desdobrar com imagem e título em vez de aparecer pelada.
   * A imagem vem da convenção `opengraph-image.tsx` ao lado; o Next monta a
   * tag sozinho, então aqui só entra o que a imagem não carrega.
   */
  openGraph: {
    type: "website",
    siteName: marca.nome,
    locale: "pt_BR",
    url: "/",
    title: `${marca.nome} — ${marca.tagline}`,
    description: marca.descricao,
  },
  twitter: {
    card: "summary_large_image",
    title: `${marca.nome} — ${marca.tagline}`,
    description: marca.descricao,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      `suppressHydrationWarning` na raiz porque é o script abaixo que escreve
      `data-js` e `data-tema` no <html>, antes de o React existir. Sem isto o
      React compara a raiz com o que ELE renderizou, não encontra os atributos,
      e trata como divergência — em toda página, não só nas de tema.
    */
    <html lang="pt-BR" suppressHydrationWarning>
      {/* O <head> explícito não é decoração: um <script> solto entre <html> e
          <body> é HTML inválido, e o React recusa ("In HTML, <script> cannot be
          a child of <html>") refazendo a árvore no cliente a cada visita. O
          script rodava assim mesmo, e por isso o defeito viveu escondido — o
          tema aplicava certo enquanto a hidratação quebrava em silêncio.
          Ver docs/01-app/02-guides/preventing-flash-before-hydration.md no
          pacote do Next, que descreve exatamente este caso.

          Duas coisas ANTES da primeira pintura.

          A primeira liga o estado "com JavaScript": as entradas de scroll
          (.revelar) só escondem conteúdo sob html[data-js], então sem este
          interruptor um navegador com JS bloqueado veria a página em branco.

          A segunda aplica o tema que a pessoa escolheu. Precisa ser aqui, e
          não num efeito do React: qualquer coisa que espere a hidratação
          pintaria a página no tema errado antes de corrigir. */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.dataset.js="";${SCRIPT_TEMA}`,
          }}
        />
      </head>
      <body
        className={`${FONTES} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
