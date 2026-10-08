import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { EditorAparencia } from "@/components/editor-aparencia";
import { padraoDoEstudioLido } from "@/lib/aparencia-galeria";
import { estilosDoEstudio } from "@/lib/estilos-do-estudio";
import { CapaGaleriaEditor } from "@/components/capa-galeria-editor";
import { CapaEmVideo } from "@/components/capa-em-video";
import { lerAparencia } from "@/config/aparencia";
import { formatosLiberadosPara } from "@/lib/acesso-formatos";
import { pastasNoDesign, videosNoDesign } from "@/lib/entrega-no-design";
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

  /*
   * A ASSINATURA DA CAPA — oito caracteres que mudam quando a capa muda.
   *
   * A prévia é um iframe, e iframe cujo `src` não mudou não recarrega. O `src`
   * é feito da aparência pendente (`?ap=`), e a capa NÃO mora na aparência:
   * mora nestas quatro colunas. Sem isto, escolher a foto de capa gravava,
   * atualizava a área de escolha ao lado — e deixava a prévia desenhando o
   * documento anterior até alguém recarregar a página na mão. Era o pedido do
   * Juan em 10/09: "a pré visualização já ser a foto que eu escolhi".
   *
   * Só as colunas da capa, e não `atualizado_em`: qualquer gravação mexe na
   * data, e a prévia recarregaria a cada rascunho de aparência salvo — um
   * piscar a mais em cima do que o `?ap=` já faz sozinho.
   *
   * Resumo em vez das colunas cruas porque uma delas é a chave do objeto no
   * armazém, e ela não tem o que fazer numa URL.
   */
  /* A logo do estúdio, para a barrinha de tamanho do editor. A medida pode
     vir nula (logo anterior à migração 052): o editor mede e grava. */
  const estudio = await consultarUm<{
    logo_chave: string | null;
    logo_largura: number | null;
    logo_altura: number | null;
  }>("select logo_chave, logo_largura, logo_altura from tenants where id = $1", [tenantId]);
  const logo = estudio?.logo_chave
    ? {
        url: await urlDeLeitura(estudio.logo_chave, 3600),
        largura: estudio.logo_largura,
        altura: estudio.logo_altura,
      }
    : null;

  /*
   * Os vídeos e as pastas, para o grupo Formato (30/09/2026) — só para quem
   * vê o grupo. Um pôster por vídeo e uma miniatura por capítulo; as fotos de
   * cada pasta vêm só quando ela é aberta. Ver `lib/entrega-no-design.ts`.
   */
  const liberado = await formatosLiberadosPara(galeria.tenant_id);
  const [videos, pastas] = liberado
    ? await Promise.all([videosNoDesign(galeria.id), pastasNoDesign(galeria.id)])
    : [[], []];

  /* O primeiro quadro do clipe da capa em vídeo (Stream), quando há um. */
  const quadroDoClipe =
    liberado && galeria.capa_video_chave && galeria.capa_video_poster_chave
      ? await urlDeLeitura(galeria.capa_video_poster_chave, 3600)
      : null;

  /* O nome de cada vídeo e a capa de cada pasta entram na assinatura: eles
     também gravam fora do `?ap=`, e a prévia tem de recarregar quando mudam. */
  const versaoDaCapa = createHash("sha256")
    .update(
      [
        galeria.capa_chave,
        /* O clipe da capa em vídeo grava fora do `?ap=`, como a capa. */
        galeria.capa_video_chave,
        galeria.capa_media_id,
        galeria.capa_foco_x,
        galeria.capa_foco_y,
        ...videos.map((v) => `${v.id}:${v.titulo ?? ""}`),
        ...pastas.map((p) => `${p.secaoId}:${p.escolhida ? p.capa?.split("?")[0] : ""}`),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 8);

  /*
   * O que a galeria tem, para o grupo Formato poder dizer "pastas sem capítulo
   * vira galeria". Uma consulta de contagem, sem assinar nada — a aba continua
   * sem carregar mídia.
   */
  const conteudo = await consultarUm<{ grupos: number; videos: number; videosSoltos: number; fotos: number }>(
    `select count(distinct coalesce(secao_id::text, '-'))::int as grupos,
            count(*) filter (where tipo = 'video')::int as videos,
            count(*) filter (where tipo = 'video' and secao_id is null)::int as "videosSoltos",
            count(*) filter (where tipo = 'foto')::int as fotos
       from medias where galeria_id = $1 and pronto`,
    [galeria.id],
  );

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
      versaoDaCapa={versaoDaCapa}
      /* Abre no RASCUNHO quando existe: é o trabalho que a pessoa deixou pela
         metade, e perdê-lo foi o defeito de 31/08. */
      inicial={lerAparencia(galeria.aparencia_rascunho ?? galeria.aparencia)}
      publicado={lerAparencia(galeria.aparencia)}
      temFontePropria={Boolean(galeria.estudio_fonte)}
      /* O desenho inteiro, e não só "existe um": a tela mostra o padrão como o
         primeiro cartão de Estilos e deixa aplicá-lo nesta galeria. */
      padraoDoEstudio={await padraoDoEstudioLido(galeria.tenant_id)}
      estilosDoEstudio={await estilosDoEstudio(galeria.tenant_id)}
      conteudo={conteudo}
      formatosLiberados={liberado}
      videos={videos}
      pastas={pastas}
      logo={logo}
      slotClipe={
        liberado ? (
          <CapaEmVideo
            galeriaId={galeria.id}
            quadroAtual={quadroDoClipe}
            capaDoEstilo={lerAparencia(galeria.aparencia_rascunho ?? galeria.aparencia).capaStream === "sala"}
          />
        ) : null
      }
    />
  );
}
