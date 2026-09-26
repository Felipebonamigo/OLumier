import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { EditorAparencia } from "@/components/editor-aparencia";
import { padraoDoEstudioLido } from "@/lib/aparencia-galeria";
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
  const versaoDaCapa = createHash("sha256")
    .update(
      [galeria.capa_chave, galeria.capa_media_id, galeria.capa_foco_x, galeria.capa_foco_y].join(
        "|",
      ),
    )
    .digest("hex")
    .slice(0, 8);

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
    />
  );
}
