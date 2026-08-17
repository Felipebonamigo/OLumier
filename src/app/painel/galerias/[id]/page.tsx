import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { formatarBytes, type Galeria } from "@/lib/tenants";
import { apagarGaleriaAction } from "../../actions";

export const metadata: Metadata = { title: "Galeria" };
export const dynamic = "force-dynamic";

export default async function GaleriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // no Next 16 params é Promise
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  // O tenant_id no where é a autorização: id de outro estúdio simplesmente não existe aqui.
  const galeria = await consultarUm<Galeria>(
    "select * from galerias where id = $1 and tenant_id = $2",
    [id, tenantId],
  );
  if (!galeria) notFound();

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{galeria.titulo}</h1>
          <p className="mt-1 text-sm text-texto-soft">
            {[dataEvento, galeria.subtitulo].filter(Boolean).join(" · ") || "sem data definida"}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs ${
            galeria.publicada
              ? "border-ok/40 bg-ok/10 text-ok"
              : "border-linha text-texto-faint"
          }`}
        >
          {galeria.publicada ? "publicada" : "rascunho"}
        </span>
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { rotulo: "Arquivos", valor: "0" },
          { rotulo: "Espaço", valor: formatarBytes(galeria.bytes_total) },
          { rotulo: "Endereço", valor: `/${galeria.slug}` },
        ].map((item) => (
          <div key={item.rotulo} className="rounded-xl border border-linha bg-carbon px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
              {item.rotulo}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium">{item.valor}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 rounded-xl border border-dashed border-linha-forte bg-carbon px-6 py-12 text-center">
        <p className="text-base font-medium">O envio de fotos e vídeos entra aqui</p>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm text-texto-soft">
          É o próximo passo: os arquivos vão direto do seu navegador para o armazenamento, sem
          passar pelo servidor — por isso aguentam um filme inteiro sem travar.
        </p>
      </section>

      <section className="mt-10 border-t border-linha pt-6">
        <h2 className="text-sm font-semibold">Apagar galeria</h2>
        <p className="mt-1 max-w-[52ch] text-xs text-texto-faint">
          Remove a galeria e todos os arquivos dela. Não dá para desfazer.
        </p>
        <form action={apagarGaleriaAction} className="mt-3">
          <input type="hidden" name="galeria_id" value={galeria.id} />
          <button
            type="submit"
            className="rounded-lg border border-erro/40 px-4 py-2 text-sm text-erro transition hover:bg-erro/10"
          >
            Apagar “{galeria.titulo}”
          </button>
        </form>
      </section>
    </main>
  );
}
