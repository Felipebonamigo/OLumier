import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { marca } from "@/config/marca";

/**
 * Moldura das páginas institucionais (privacidade, termos).
 *
 * Medida de linha curta e tipografia maior de propósito: é texto denso que as
 * pessoas leem com desconfiança, e parágrafo largo demais faz desistir na
 * primeira tela.
 */
export default function InstitucionalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-linha">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Link href="/">
            <MarcaLockup tamanho={40} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[70ch] px-6 py-14 text-[15px] leading-relaxed text-texto-soft [&_a]:text-acento [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-12 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-texto [&_h3]:mt-8 [&_h3]:font-semibold [&_h3]:text-texto [&_li]:mt-1.5 [&_p]:mt-4 [&_strong]:text-texto [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </main>

      <footer className="border-t border-linha px-6 py-10 text-center text-xs text-texto-faint">
        <p>
          <Link href="/seguranca" className="hover:text-texto-soft">
            Segurança
          </Link>
          {" · "}
          <Link href="/privacidade" className="hover:text-texto-soft">
            Privacidade
          </Link>
          {" · "}
          <Link href="/termos" className="hover:text-texto-soft">
            Termos de uso
          </Link>
        </p>
        <p className="mt-2">
          {marca.nome} · {marca.email}
        </p>
      </footer>
    </div>
  );
}
