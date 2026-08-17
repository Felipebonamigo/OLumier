import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { FormEntrar } from "./form";

export const metadata: Metadata = { title: "Entrar" };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string }>;
}) {
  const { proximo } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Entrar no painel</h1>
      <p className="mt-2 text-sm text-texto-soft">
        Acesse suas galerias e acompanhe o espaço usado.
      </p>

      <FormEntrar proximo={proximo} />

      <p className="mt-8 text-sm text-texto-soft">
        Ainda não tem conta?{" "}
        <Link href="/cadastrar" className="text-luz underline underline-offset-4">
          Criar agora
        </Link>
      </p>
    </main>
  );
}
