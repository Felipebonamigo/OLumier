import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { EditorAparencia } from "@/components/editor-aparencia";
import { CapaGaleriaEditor } from "@/components/capa-galeria-editor";
import { lerAparencia } from "@/config/aparencia";
import { consultarUm } from "@/lib/db";
import { urlDeLeitura } from "@/lib/r2";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";

export const metadata: Metadata = { title: "Design da galeria" };
export const dynamic = "force-dynamic";

/**
 * A aba DESIGN — capa, letra, cor e grade, com a prévia ao lado.
 *
 * Não carrega mídia nenhuma: a prévia é a galeria pública de verdade dentro de
 * um iframe, e ela mesma busca as poucas fotos da amostra. Antes da divisão em
 * abas, escolher uma fonte custava carregar a grade inteira do painel junto,
 * porque tudo morava na mesma página.
 */
export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* A tranca é de cada rota, não do layout — ver `lib/galeria-painel.ts`. */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  /*
   * A capa que está valendo, para mostrar na área de escolha.
   *
   * UMA consulta, e só quando não há capa enviada: a aba Design não carrega
   * mídia nenhuma de propósito, e trazer `listarMedias` aqui para achar uma
   * foto desfaria o ganho da divisão em abas. Este `limit 1` pega exatamente a
   * foto que a galeria pública usaria — a marcada como capa, ou a primeira.
   */
  const capaEnviada = galeria.capa_chave;
  const fotoDaCapa = capaEnviada
    ? null
    : await consultarUm<{ chave: string; chave_preview: string | null; armazem: string }>(
        `select chave, chave_preview, armazem
           from medias
          where galeria_id = $1 and pronto and tipo = 'foto'
          order by (id = $2) desc, ordem, criado_em
          limit 1`,
        [galeria.id, galeria.capa_media_id],
      );

  const urlCapa = capaEnviada
    ? await urlDeLeitura(capaEnviada, 3600)
    : fotoDaCapa
      ? await urlDaDerivada(
          fotoDaCapa.chave_preview,
          fotoDaCapa.chave,
          armazemDe(fotoDaCapa.armazem),
          3600,
        )
      : null;

  return (
    <EditorAparencia
      galeriaId={galeria.id}
      slotCapa={
        <CapaGaleriaEditor
          galeriaId={galeria.id}
          urlCapaAtual={urlCapa}
          enviada={Boolean(capaEnviada)}
          focoX={galeria.capa_foco_x}
          focoY={galeria.capa_foco_y}
        />
      }
      caminhoPublico={`/g/${galeria.estudio_slug}/${galeria.slug}?previa=1`}
      /* Abre no RASCUNHO quando existe: é o trabalho que a pessoa deixou pela
         metade, e perdê-lo foi o defeito de 31/08. */
      inicial={lerAparencia(galeria.aparencia_rascunho ?? galeria.aparencia)}
      publicado={lerAparencia(galeria.aparencia)}
      temFontePropria={Boolean(galeria.estudio_fonte)}
    />
  );
}
