import type { Metadata } from "next";
import { Montserrat, Cormorant_Garamond } from "next/font/google";
import { marca } from "@/config/marca";
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
      <body className={`${montserrat.variable} ${cormorant.variable} antialiased`}>{children}</body>
    </html>
  );
}
