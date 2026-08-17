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
import { GaleriaCapa } from "@/components/galeria-capa";
import { lerAparencia, TEMAS } from "@/config/aparencia";
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

  /*
   * Três tamanhos por foto, cada um no seu lugar:
   *   grade     → thumb (~50 KB) — é o que faz a galeria abrir rápido
   *   lightbox  → preview (~400 KB) — nítido em tela cheia
   *   download  → original — só quando o cliente pede de fato
   * Derivada nula (vídeo, foto antiga) cai no original, sem quebrar nada.
   */
  const VALIDADE = 6 * 3600;
  const itens: ItemGaleria[] = await Promise.all(
    medias.map(async (m) => {
      const [thumb, preview, download] = await Promise.all([
        urlDeLeitura(m.chave_thumb ?? m.chave, VALIDADE),
        urlDeLeitura(m.chave_preview ?? m.chave, VALIDADE),
        urlDeLeitura(m.chave, VALIDADE, m.nome_original),
      ]);
      return {
        id: m.id,
        nome: m.nome_original,
        tipo: m.tipo,
        bytes: Number(m.bytes),
        largura: m.largura,
        altura: m.altura,
        url: thumb,
        urlGrande: preview,
        urlDownload: download,
      };
    }),
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

  const aparencia = lerAparencia(galeria.aparencia);

  // Capa escolhida pelo fotógrafo; sem escolha, a primeira foto da galeria.
  const capa =
    medias.find((m) => m.id === galeria.capa_media_id && m.tipo === "foto") ??
    medias.find((m) => m.tipo === "foto");
  const urlCapa = capa ? await urlDeLeitura(capa.chave_preview ?? capa.chave, VALIDADE) : null;

  return (
    /*
     * O tema vive em variáveis CSS neste elemento. Assim a galeria pode ser
     * clara enquanto o painel segue escuro, sem um tema brigar com o outro —
     * e trocar de tema é trocar cinco valores, não reescrever componentes.
     */
    <main
      className="min-h-dvh pb-20"
      style={{ ...TEMAS[aparencia.tema], background: "var(--g-fundo)", color: "var(--g-texto)" }}
    >
      {/* A marca em destaque é a do fotógrafo. A nossa assina discreta no rodapé. */}
      <GaleriaCapa
        aparencia={aparencia}
        dados={{
          titulo: galeria.titulo,
          subtitulo: galeria.subtitulo,
          dataFormatada: dataEvento,
          estudio: galeria.estudio_nome,
          urlImagem: urlCapa,
        }}
      />

      <div className="mx-auto max-w-[1500px] px-4 sm:px-6">
        {itens.length === 0 ? (
          <p className="py-20 text-center text-sm" style={{ color: "var(--g-suave)" }}>
            As fotos ainda estão sendo preparadas. Volte em breve.
          </p>
        ) : (
          <GaleriaCliente
            itens={itens}
            permiteDownload={galeria.permite_download}
            galeriaId={galeria.id}
            aparencia={aparencia}
          />
        )}
      </div>

      <footer className="mt-20 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-tenue)" }}
        >
          <span
            className="grid h-4 w-4 place-items-center rounded-[3px] text-[8px] font-bold"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-destaque)" }}
          >
            {marca.simbolo}
          </span>
          entregue com {marca.nome}
        </span>
      </footer>
    </main>
  );
}
