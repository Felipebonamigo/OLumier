import type { Metadata } from "next";
import Link from "next/link";
import { sessaoAtual } from "@/lib/auth";
import { listarGalerias, listarLixeira, formatarBytes, PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { Lixeira } from "@/components/lixeira";
import { ListaGalerias } from "@/components/lista-galerias";
import { buscarTenantPorId } from "@/lib/tenants";
import { diasAteArquivar } from "@/config/prazos";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Galerias" };
export const dynamic = "force-dynamic";

const formatarData = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : null;

export default async function PainelPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const galerias = await listarGalerias(tenantId);
  /* O slug do estúdio entra por causa do atalho "copiar link": o endereço do
     cliente é /g/{estudio}/{galeria}, e sem a primeira metade o botão copiaria
     um link quebrado. Uma consulta a mais nesta página, não por galeria. */
  const estudio = await buscarTenantPorId(tenantId);
  const lixeira = await listarLixeira(tenantId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Galerias</h1>
          <p className="mt-1 text-sm text-texto-soft">
            {galerias.length === 0
              ? "Nenhuma galeria ainda."
              : `${galerias.length} ${galerias.length === 1 ? "galeria" : "galerias"}`}
          </p>
        </div>
        <Link
          href="/painel/galerias/nova"
          className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
        >
          Nova galeria
        </Link>
      </div>

      {galerias.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-linha-forte bg-carbon px-6 py-14 text-center">
          <p className="text-base font-medium">Crie sua primeira galeria</p>
          <p className="mx-auto mt-2 max-w-[42ch] text-sm text-texto-soft">
            Uma galeria é uma entrega — um casamento, um ensaio. Você sobe as fotos e o filme, e
            manda um único link para o cliente.
          </p>
          <Link
            href="/painel/galerias/nova"
            className="mt-6 inline-block rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Nova galeria
          </Link>
        </div>
      ) : (
        <ListaGalerias
          galerias={galerias.map((g) => ({
            id: g.id,
            titulo: g.titulo,
            subtitulo: g.subtitulo,
            slug: g.slug,
            estudioSlug: estudio?.slug ?? "",
            publicada: g.publicada,
            estado: g.estado,
            diasAteCofre: diasAteArquivar(g.expira_em),
            dataFormatada: formatarData(g.data_evento),
            arquivos: g.total_medias ?? 0,
            tamanho: formatarBytes(g.bytes_total),
          }))}
        />
      )}

      {/*
       * A lixeira só aparece quando tem algo dentro. Uma seção vazia permanente
       * ensinaria o fotógrafo a ignorar aquele canto da tela — e é justamente
       * onde ele vai precisar olhar no dia em que apagar a galeria errada.
       */}
      <Lixeira
        prazoDias={PRAZO_LIXEIRA_DIAS}
        itens={lixeira.map((g) => ({
          id: g.id,
          titulo: g.titulo,
          arquivos: g.total_medias ?? 0,
          diasRestantes: g.dias_restantes,
        }))}
      />
    </main>
  );
}
