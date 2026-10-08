/**
 * COMO CHAMAR O QUE A ENTREGA TEM.
 *
 * ── A QUEIXA (07/10/2026) ─────────────────────────────────────────────────
 *
 * A GM Creative, depois de mandar a galeria para o cliente dela: "sei que a
 * galeria é para fotógrafos... porém, se aparecer fotos ali eles vão confundir
 * muuuito!". O cartão que o cliente recebeu no WhatsApp dizia "Fotos por GM
 * CREATIVE", escrito à mão no código de quando a plataforma só pensava em
 * fotografia. A entrega dela é filme.
 *
 * Felipe, no mesmo dia: "lembre-se, é uma galeria de fotos e vídeos".
 *
 * ── POR QUE NÃO UMA PALAVRA GENÉRICA ──────────────────────────────────────
 *
 * A saída óbvia seria "arquivos", que nunca erra. Mas quem abre esse link é um
 * casal recebendo o próprio casamento, não alguém administrando uma pasta —
 * "arquivos" é o vocabulário de um gerenciador de arquivos, e a estratégia de
 * marca pede o contrário (§14: direta, humana, sem frio corporativo).
 *
 * Então cada caso diz a coisa verdadeira. São três, e são poucos o bastante
 * para caber numa frase.
 *
 * ── E A GALERIA VAZIA NÃO CHUTA ───────────────────────────────────────────
 *
 * Antes do primeiro arquivo não existe verdade a dizer sobre o conteúdo, e
 * cair em "Fotos" ali seria o mesmo defeito, só que mais cedo. O crédito ao
 * estúdio fica, porque esse continua certo.
 */
export interface Conteudo {
  /** Quantas fotos PRONTAS. Mídia no meio do envio não está na galeria para
   *  ninguém — se contasse, a palavra mudaria durante o upload e voltaria
   *  depois. */
  fotos: number;
  /** Quantos vídeos prontos. Um já basta: não existe "pouco vídeo". */
  videos: number;
  estudio: string | null;
}

export function creditoDaEntrega({ fotos, videos, estudio }: Conteudo): string {
  const nome = estudio?.trim();
  /* Sem estúdio não há crédito. O cartão junta os pedaços com " · ", e um
     pedaço vazio viraria um ponto solto no fim da frase. */
  if (!nome) return "";

  const temFoto = fotos > 0;
  const temVideo = videos > 0;

  if (temFoto && temVideo) return `Fotos e vídeos por ${nome}`;
  if (temVideo) return `Vídeos por ${nome}`;
  if (temFoto) return `Fotos por ${nome}`;
  return `Por ${nome}`;
}
