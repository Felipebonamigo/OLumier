import type { Metadata } from "next";
import Link from "next/link";
import { FormNovaGaleria } from "./form";

export const metadata: Metadata = { title: "Nova galeria" };

export default function NovaGaleriaPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Nova galeria</h1>
      <p className="mt-1 text-sm text-texto-soft">
        Depois de criar, você sobe as fotos e o filme — e define a senha do cliente.
      </p>

      <FormNovaGaleria />
    </main>
  );
}
