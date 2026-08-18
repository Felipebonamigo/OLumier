import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { formatarBytes, type Galeria } from "@/lib/tenants";
import { listarMedias } from "@/lib/medias";
import { urlDeLeitura } from "@/lib/r2";
import { resumoAcessos } from "@/lib/galerias-publicas";
import { EnviarArquivos } from "@/components/enviar-arquivos";
import { GradeMedias, type MediaExibida } from "@/components/grade-medias";
import { PublicarGaleria } from "@/components/publicar-galeria";
import { EditorAparencia } from "@/components/editor-aparencia";
import { EditorSecoes } from "@/components/editor-secoes";
import { listarSecoes } from "@/lib/secoes";
import { lerAparencia } from "@/config/aparencia";
import { apagarGaleriaAction } from "../../actions";

export const metadata: Metadata = { title: "Galeria" };
export const dynamic = "force-dynamic";

export default async function GaleriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // no Next 16 params é Promise
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  // O tenant_id no where é a autorização: id de outro estúdio simplesmente não existe aqui.
  const galeria = await consultarUm<Galeria & { estudio_slug: string }>(
    `select g.*, t.slug as estudio_slug
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2`,
    [id, tenantId],
  );
  if (!galeria) notFound();

  const medias = await listarMedias(galeria.id);
  const acessos = await resumoAcessos(galeria.id);
  const secoes = await listarSecoes(galeria.id);

  // URLs assinadas com validade curta: o objeto no bucket nunca fica público.
  // Aqui também usamos a miniatura — o painel de quem tem 600 fotos precisa abrir rápido.
  const exibidas: MediaExibida[] = await Promise.all(
    medias.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      tipo: m.tipo,
      bytes: Number(m.bytes),
      secaoId: m.secao_id,
      url: await urlDeLeitura(m.chave_thumb ?? m.chave, 3600),
    })),
  );

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  const fotos = medias.filter((m) => m.tipo === "foto").length;
  const videos = medias.length - fotos;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
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
            galeria.publicada ? "border-ok/40 bg-ok/10 text-ok" : "border-linha text-texto-faint"
          }`}
        >
          {galeria.publicada ? "publicada" : "rascunho"}
        </span>
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {
            rotulo: "Arquivos",
            valor: `${fotos} ${fotos === 1 ? "foto" : "fotos"}${videos ? ` · ${videos} vídeo${videos > 1 ? "s" : ""}` : ""}`,
          },
          { rotulo: "Espaço", valor: formatarBytes(galeria.bytes_total) },
          {
            rotulo: "Acessos do cliente",
            valor: acessos
              ? `${acessos.aberturas} ${acessos.aberturas === 1 ? "abertura" : "aberturas"} · ${acessos.downloads} download${acessos.downloads === 1 ? "" : "s"}`
              : "—",
          },
        ].map((item) => (
          <div key={item.rotulo} className="rounded-xl border border-linha bg-carbon px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
              {item.rotulo}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium">{item.valor}</dd>
          </div>
        ))}
      </dl>

      <PublicarGaleria
        galeriaId={galeria.id}
        caminho={`/g/${galeria.estudio_slug}/${galeria.slug}`}
        publicada={galeria.publicada}
        temSenha={Boolean(galeria.senha_hash)}
        permiteDownload={galeria.permite_download}
      />

      <EditorAparencia
        galeriaId={galeria.id}
        caminhoPublico={`/g/${galeria.estudio_slug}/${galeria.slug}`}
        inicial={lerAparencia(galeria.aparencia)}
      />

      <EditorSecoes
        galeriaId={galeria.id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome, total: s.total ?? 0 }))}
        semCapitulo={medias.filter((m) => !m.secao_id).length}
      />

      <EnviarArquivos
        galeriaId={galeria.id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
      />
      <GradeMedias
        medias={exibidas}
        galeriaId={galeria.id}
        capaId={galeria.capa_media_id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
      />

      <section className="mt-12 border-t border-linha pt-6">
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
