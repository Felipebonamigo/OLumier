import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { emailConfigurado } from "@/lib/email";
import { marca } from "@/config/marca";
import { FormRecuperar } from "./form";

export const metadata: Metadata = {
  title: "Esqueci minha senha",
  // Página de recuperação não tem por que aparecer em busca.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RecuperarPage() {
  const ligado = emailConfigurado();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Esqueci minha senha</h1>

      {ligado ? (
        <>
          <p className="mt-2 text-sm text-texto-soft">
            Digite o e-mail da conta e mandamos um link para criar uma senha nova.
          </p>
          <FormRecuperar />
        </>
      ) : (
        /*
          Sem remetente verificado, não adianta mostrar o formulário: ele
          aceitaria o e-mail e não mandaria nada. Melhor dizer a verdade e dar o
          caminho que funciona hoje.

          E até 17/09/2026 o "caminho que funciona" era escrever para
          `marca.email` — uma caixa que NÃO RECEBE (ver `config/marca.ts`). Ou
          seja: a tela que existe para ser honesta mandava quem já não consegue
          entrar falar com o vazio. Agora é o WhatsApp, que atende.
        */
        <div className="mt-6 rounded-xl border border-linha bg-carbon p-5 text-sm text-texto-soft">
          <p className="font-medium text-texto">O envio automático ainda não está ligado.</p>
          <p className="mt-2">
            Chame no{" "}
            <a href={marca.whatsappLink} className="text-acento underline underline-offset-4">
              WhatsApp {marca.whatsappVisivel}
            </a>{" "}
            dizendo o e-mail cadastrado, e a senha é redefinida na hora.
          </p>
        </div>
      )}

      <p className="mt-8 text-sm text-texto-soft">
        Lembrou?{" "}
        <Link href="/entrar" className="text-acento underline underline-offset-4">
          Voltar para entrar
        </Link>
      </p>
    </main>
  );
}
