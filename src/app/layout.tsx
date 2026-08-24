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
    <html lang="pt-BR">
      {/* Duas coisas ANTES da primeira pintura.

          A primeira liga o estado "com JavaScript": as entradas de scroll
          (.revelar) só escondem conteúdo sob html[data-js], então sem este
          interruptor um navegador com JS bloqueado veria a página em branco.

          A segunda aplica o tema que a pessoa escolheu. Precisa ser aqui, e
          não num efeito do React: qualquer coisa que espere a hidratação
          pintaria a página no tema errado antes de corrigir. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.dataset.js="";${SCRIPT_TEMA}`,
        }}
      />
      <body
        className={`${montserrat.variable} ${cormorant.variable} ${greatVibes.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
