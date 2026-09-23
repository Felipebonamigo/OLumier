import type { Metadata } from "next";
import GaleriaPublicaPage, { generateMetadata as metadataDaGaleria } from "../page";

/**
 * O CAPÍTULO COMO PEDAÇO DO CAMINHO.
 *
 * ── DE ONDE VEIO (21/09/2026) ─────────────────────────────────────────────
 *
 * Juan, com o link na mão: "se os noivos forem mandar pra alguém, provavelmente
 * vão copiar e enviar. Daí vai ficar esse link cheio de coisa —
 * `?previa=1&cap=cerimonia`. Olha que feio."
 *
 * Ele está certo sobre o que importa: o link É o produto na mão do casal. Agora
 * o capítulo se escreve como uma pasta:
 *
 *     /g/sirius-fotografia/julia-gustavo-wedding/cerimonia
 *
 * ── POR QUE ESTE ARQUIVO CHAMA A PÁGINA EM VEZ DE REPETI-LA ──────────────
 *
 * Porque é a MESMA tela: mesmo acesso, mesma senha, mesma capa, mesmos menus,
 * mesma rolagem infinita — 800 linhas que já existem ao lado. Duplicá-las para
 * mudar de onde vem uma palavra é criar duas galerias que precisam ser
 * consertadas juntas para sempre, e a segunda é a que ninguém lembra.
 *
 * Extrair tudo para um terceiro módulo seria o caminho de livro, e move 800
 * linhas num dia em que a galeria de um cliente está no ar. Este arquivo
 * empresta o capítulo à consulta e entrega a decisão para quem já sabe tomá-la.
 *
 * ── O `?cap=` CONTINUA VALENDO ────────────────────────────────────────────
 *
 * Link já mandado não quebra: a página segue lendo `cap` da consulta, e é de lá
 * que este aqui o injeta. Mesmo raciocínio da migração 030, dos endereços
 * antigos — quem recebeu um link ontem não tem como saber que ele mudou.
 */
type Props = {
  params: Promise<{ estudio: string; galeria: string; capitulo: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio, galeria } = await params;
  /* O cartão e o título são os da GALERIA: é ela que a pessoa está
     compartilhando, e o capítulo é onde ela abriu. */
  return metadataDaGaleria({
    params: Promise.resolve({ estudio, galeria }),
    searchParams: Promise.resolve({}),
  });
}

export default async function CapituloDaGaleria({ params, searchParams }: Props) {
  const { estudio, galeria, capitulo } = await params;
  const busca = await searchParams;
  return GaleriaPublicaPage({
    params: Promise.resolve({ estudio, galeria }),
    /* O caminho vence a consulta: `/…/cerimonia?cap=festa` abre a cerimônia,
       que é o que o endereço na barra diz. */
    searchParams: Promise.resolve({ ...busca, cap: capitulo }),
  });
}
