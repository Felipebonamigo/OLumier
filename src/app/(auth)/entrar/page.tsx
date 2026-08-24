import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { emailConfigurado } from "@/lib/email";
import { FormEntrar } from "./form";

export const metadata: Metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string; senha_redefinida?: string }>;
}) {
  const { proximo, senha_redefinida } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Entrar no painel</h1>
      <p className="mt-2 text-sm text-texto-soft">
        Acesse suas galerias e acompanhe o espaço usado.
      </p>

      {/* Vem do redirecionamento depois de redefinir. Confirma o que acabou de
          acontecer: sem isto a pessoa cai numa tela de login igual à de antes e
          fica sem saber se a troca valeu. */}
      {senha_redefinida ? (
        <p
          role="status"
          className="mt-6 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2.5 text-sm text-ok"
        >
          Senha alterada. Entre com a nova.
        </p>
      ) : null}

      <FormEntrar proximo={proximo} />

      {/* Só aparece quando o envio de e-mail está ligado — um link que leva a
          um caminho sem saída é pior que link nenhum. */}
      {emailConfigurado() ? (
        <p className="mt-4 text-sm">
          <Link href="/recuperar" className="text-texto-soft underline underline-offset-4 hover:text-texto">
            Esqueci minha senha
          </Link>
        </p>
      ) : null}

      <p className="mt-8 text-sm text-texto-soft">
        Ainda não tem conta?{" "}
        <Link href="/cadastrar" className="text-acento underline underline-offset-4">
          Criar agora
        </Link>
      </p>
    </main>
  );
}
