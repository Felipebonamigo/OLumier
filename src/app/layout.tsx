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
} from "next/font/google";
import { marca } from "@/config/marca";
import { SCRIPT_TEMA } from "@/config/tema";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans-app",
  subsets: ["latin"],
  display: "swap",
});

// A serifada é usada só no título da galeria pública — a página que o casal vê.
// Ali o tom é de convite, não de painel.
const cormorant = Cormorant_Garamond({
  variable: "--font-serif-app",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
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
]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: {
    default: `${marca.nome} — ${marca.tagline}`,
    template: `%s · ${marca.nome}`,
  },
  description: marca.descricao,
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
