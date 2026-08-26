import type { Metadata } from "next";
import { Montserrat, Cormorant_Garamond, Great_Vibes } from "next/font/google";
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
        className={`${montserrat.variable} ${cormorant.variable} ${greatVibes.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
