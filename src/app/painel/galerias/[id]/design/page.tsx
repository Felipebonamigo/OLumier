import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { EditorAparencia } from "@/components/editor-aparencia";
import { lerAparencia } from "@/config/aparencia";

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

  return (
    <EditorAparencia
      galeriaId={galeria.id}
      caminhoPublico={`/g/${galeria.estudio_slug}/${galeria.slug}?previa=1`}
      /* Abre no RASCUNHO quando existe: é o trabalho que a pessoa deixou pela
         metade, e perdê-lo foi o defeito de 31/08. */
      inicial={lerAparencia(galeria.aparencia_rascunho ?? galeria.aparencia)}
      publicado={lerAparencia(galeria.aparencia)}
      temFontePropria={Boolean(galeria.estudio_fonte)}
    />
  );
}
