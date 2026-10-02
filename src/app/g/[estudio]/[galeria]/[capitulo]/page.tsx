import type { Metadata } from "next";
import GaleriaPublicaPage, { generateMetadata as metadataDaGaleria } from "../page";
import { secaoPeloApelidoPublica } from "@/lib/secoes-publicas";

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
  const { estudio, galeria, capitulo } = await params;
  /*
   * ── O CARTÃO É DA GALERIA; A ABA, DO CAPÍTULO (01/10/2026) ─────────────
   *
   * Aqui estava escrito "o cartão E o título são os da GALERIA", e a metade do
   * cartão continua certa: quando o casal manda o link no WhatsApp, o cartão
   * tem de dizer o casamento. Ninguém compartilha um capítulo achando que
   * compartilha um capítulo.
   *
   * A metade do TÍTULO estava errada, e o Juan apontou: "ao ir para o próximo
   * capítulo não muda em cima o nome da aba — se está vendo a recepção e vai
   * para a festa, deveria mudar lá em cima". O título da aba não é o que se
   * compartilha: é a orientação de quem está lendo agora, e é o que distingue
   * seis abas abertas. Ali o capítulo é a informação mais útil que existe.
   *
   * As duas saíam da mesma função e por isso andavam juntas. O capítulo entra
   * só no `title`; `openGraph` e `twitter` continuam com o que a galeria
   * monta. `testar-capitulo-na-aba.mjs` prende as duas metades — separá-las é
   * o tipo de coisa que a próxima sessão reunifica "arrumando".
   */
  const daGaleria = await metadataDaGaleria({
    params: Promise.resolve({ estudio, galeria }),
    searchParams: Promise.resolve({}),
  });

  /* O NOME do capítulo, e não o apelido da URL: "recem-casados" é endereço, não
     texto de tela. Capítulo que não existe (link velho, renome, erro de digitação)
     devolve nulo, e aí a aba continua sendo a da galeria — melhor do que repetir
     o que veio de fora. */
  const secao = await secaoPeloApelidoPublica(estudio, galeria, capitulo);
  if (!secao) return daGaleria;

  return { ...daGaleria, title: `${secao} · ${daGaleria.title}` };
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
