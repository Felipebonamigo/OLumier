import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { marca } from "@/config/marca";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-sans-app",
  subsets: ["latin"],
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
      <body className={`${montserrat.variable} antialiased`}>{children}</body>
    </html>
  );
}
