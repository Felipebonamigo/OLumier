import type { Metadata } from "next";
import Link from "next/link";
import { MarcaLockup } from "@/components/marca-tile";
import { FormCadastrar } from "./form";

export const metadata: Metadata = { title: "Criar conta" };

export default function CadastrarPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-10 self-start">
        <MarcaLockup />
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Criar sua conta</h1>
      <p className="mt-2 text-sm text-texto-soft">
        Suas galerias, com a sua marca. Sem limite de downloads.
      </p>

      <FormCadastrar />

      <p className="mt-8 text-sm text-texto-soft">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-luz underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </main>
  );
}
