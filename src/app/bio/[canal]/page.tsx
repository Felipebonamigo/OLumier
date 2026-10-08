import { notFound, redirect } from "next/navigation";
import { canalDaBio } from "@/config/bio";
import { METADADOS_DA_BIO, PaginaDaBio } from "../pagina";

/**
 * O ENDEREÇO LIMPO DE CADA CANAL — `/bio/instagram`.
 *
 * É a página de `/bio` com a origem já dita pelo endereço, para o link do perfil
 * não precisar carregar `?utm_source=…` (o Juan achou feio, 08/10/2026). Os
 * canais moram em `config/bio.ts`.
 *
 * `/bio/ir` (sem o produto) cai aqui também, porque `ir` só é rota quando vem
 * seguido do destino: volta para a página em vez de dar 404 num link digitado
 * pela metade. Canal que não existe também volta para `/bio` — um erro de
 * digitação no link da bio não pode virar página de erro para quem veio do
 * Instagram.
 */
export const metadata = METADADOS_DA_BIO;

export default async function BioDoCanalPage({
  params,
  searchParams,
}: {
  params: Promise<{ canal: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { canal } = await params;
  if (!canalDaBio(canal)) {
    if (canal.length > 40) notFound();
    redirect("/bio");
  }
  return <PaginaDaBio searchParams={searchParams} canal={canal} />;
}
