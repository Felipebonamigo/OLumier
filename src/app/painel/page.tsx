import type { Metadata } from "next";
import Link from "next/link";
import { sessaoAtual } from "@/lib/auth";
import { listarGalerias, listarLixeira, formatarBytes, PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { Lixeira } from "@/components/lixeira";
import { diasAteArquivar } from "@/config/prazos";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Galerias" };
export const dynamic = "force-dynamic";

const formatarData = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : null;

function Etiqueta({ galeria }: { galeria: { publicada: boolean; estado: string; expira_em: Date | null } }) {
  if (galeria.estado === "arquivada") {
    return (
      <span className="rounded-full border border-linha px-2 py-0.5 text-[11px] text-texto-faint">
        no cofre
      </span>
    );
  }

  // Avisa antes de vencer: descobrir que a galeria saiu do ar pelo cliente
  // reclamando seria o pior jeito de saber.
  const dias = diasAteArquivar(galeria.expira_em);
  if (dias !== null && dias <= 30) {
    return (
      <span className="rounded-full border border-alerta/40 bg-alerta/10 px-2 py-0.5 text-[11px] text-alerta">
        {dias > 0 ? `cofre em ${dias}d` : "vence hoje"}
      </span>
    );
  }
  return galeria.publicada ? (
    <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] text-ok">
      publicada
    </span>
  ) : (
    <span className="rounded-full border border-linha px-2 py-0.5 text-[11px] text-texto-faint">
      rascunho
    </span>
  );
}

export default async function PainelPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const galerias = await listarGalerias(tenantId);
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
        <ul className="mt-8 grid gap-3">
          {galerias.map((g) => (
            <li key={g.id}>
              <Link
                href={`/painel/galerias/${g.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-linha bg-carbon px-5 py-4 transition hover:border-linha-forte hover:bg-carbon-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{g.titulo}</span>
                    <Etiqueta galeria={g} />
                  </span>
                  <span className="mt-0.5 block text-xs text-texto-faint">
                    {[formatarData(g.data_evento), g.subtitulo].filter(Boolean).join(" · ") ||
                      "sem data"}
                  </span>
                </span>
                <span className="text-right text-xs text-texto-soft tabular-nums">
                  <span className="block">
                    {g.total_medias ?? 0} {g.total_medias === 1 ? "arquivo" : "arquivos"}
                  </span>
                  <span className="block text-texto-faint">{formatarBytes(g.bytes_total)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
