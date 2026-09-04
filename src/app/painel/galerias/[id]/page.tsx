import { redirect } from "next/navigation";

/**
 * O endereço da galeria abre em FOTOS.
 *
 * ── POR QUE ESTA PÁGINA VIROU UM REDIRECIONAMENTO (04/09/2026) ─────────────
 *
 * Ela empilhava onze seções, e o sócio resumiu: "a organização da criação da
 * galeria está confusa". Virou quatro abas com menu lateral — fotos, design,
 * entrega, atividade —, cada uma com rota e carga próprias.
 *
 * O redirecionamento existe porque o endereço antigo está em toda parte: no
 * favorito do fotógrafo, na aba aberta há dias, no link que ele mandou para o
 * sócio. Transformar isso em 404 seria cobrar da pessoa o preço de uma
 * reorganização que ela não pediu.
 *
 * FOTOS é o destino porque é o trabalho: subir e organizar. As outras três são
 * decisões sobre um trabalho que já existe.
 *
 * A autorização não some com a página: ela está no `layout.tsx` ao lado e em
 * cada uma das quatro rotas — ver `lib/galeria-painel.ts`.
 */
export default async function GaleriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // no Next 16 params é Promise
  redirect(`/painel/galerias/${id}/fotos`);
}
