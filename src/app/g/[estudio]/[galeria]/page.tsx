import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { marca } from "@/config/marca";
import { urlDeLeitura } from "@/lib/r2";
import {
  buscarGaleriaPublica,
  listarMediasPublicas,
  temAcessoLiberado,
  registrarAcesso,
} from "@/lib/galerias-publicas";
import { GaleriaCliente, type ItemGaleria } from "@/components/galeria-cliente";
import { PortaoDeSenha } from "./portao";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ estudio: string; galeria: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio, galeria } = await params;
  const g = await buscarGaleriaPublica(estudio, galeria);
  if (!g) return { title: "Galeria" };
  return {
    title: `${g.titulo} · ${g.estudio_nome}`,
    // Galeria é pessoal: nunca deve aparecer em busca, mesmo com o link vazado.
    robots: { index: false, follow: false },
  };
}

export default async function GaleriaPublicaPage({ params }: Props) {
  const { estudio, galeria: galeriaSlug } = await params;

  const galeria = await buscarGaleriaPublica(estudio, galeriaSlug);
  if (!galeria) notFound();

  if (galeria.estado === "arquivada") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">{galeria.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">
          Esta galeria está guardada no cofre. Fale com {galeria.estudio_nome} para reativá-la —
          nada foi perdido.
        </p>
      </main>
    );
  }

  if (galeria.expira_em && new Date(galeria.expira_em) < new Date()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">{galeria.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">
          O prazo desta galeria terminou. Fale com {galeria.estudio_nome}.
        </p>
      </main>
    );
  }

  if (galeria.senha_hash && !(await temAcessoLiberado(galeria.id))) {
    return (
      <PortaoDeSenha
        estudio={estudio}
        galeria={galeriaSlug}
        titulo={galeria.titulo}
        nomeEstudio={galeria.estudio_nome}
      />
    );
  }

  const medias = await listarMediasPublicas(galeria.id);

  // URLs assinadas de 6h: o objeto nunca fica público no armazenamento.
  const itens: ItemGaleria[] = await Promise.all(
    medias.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      tipo: m.tipo,
      bytes: Number(m.bytes),
      url: await urlDeLeitura(m.chave, 6 * 3600),
      urlDownload: await urlDeLeitura(m.chave, 6 * 3600, m.nome_original),
    })),
  );

  const cabecalhos = await headers();
  await registrarAcesso({
    galeriaId: galeria.id,
    acao: "abriu",
    ip: cabecalhos.get("x-forwarded-for") ?? cabecalhos.get("x-real-ip"),
    userAgent: cabecalhos.get("user-agent"),
  });

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <main className="min-h-dvh pb-20">
      {/* A marca em destaque é a do fotógrafo. A nossa assina discreta no rodapé. */}
      <header className="border-b border-linha px-6 py-14 text-center">
        <p
          className="font-mono text-[11px] uppercase tracking-[0.3em]"
          style={{ color: galeria.estudio_cor }}
        >
          {galeria.estudio_nome}
        </p>
        <h1 className="mx-auto mt-5 max-w-[18ch] text-balance font-serif text-4xl font-bold tracking-tight sm:text-5xl">
          {galeria.titulo}
        </h1>
        {(dataEvento || galeria.subtitulo) && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-texto-soft">
            {[dataEvento, galeria.subtitulo].filter(Boolean).join(" · ")}
          </p>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {itens.length === 0 ? (
          <p className="py-20 text-center text-sm text-texto-soft">
            As fotos ainda estão sendo preparadas. Volte em breve.
          </p>
        ) : (
          <GaleriaCliente
            itens={itens}
            permiteDownload={galeria.permite_download}
            galeriaId={galeria.id}
          />
        )}
      </div>

      <footer className="mt-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-linha px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-texto-faint">
          <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-linha-forte text-[8px] font-bold text-luz">
            {marca.simbolo}
          </span>
          entregue com {marca.nome}
        </span>
      </footer>
    </main>
  );
}
