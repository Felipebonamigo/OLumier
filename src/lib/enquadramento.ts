/**
 * Onde a pessoa clicou, em porcentagem DA FOTO.
 *
 * ── O QUADRO NÃO É A FOTO (05/10/2026) ────────────────────────────────────
 *
 * O escolhedor do ponto focal desenha a foto com `object-contain`: ela aparece
 * INTEIRA, e por isso quase nunca preenche o quadro — sobra faixa vazia em
 * cima e embaixo, ou nas laterais. A conta antiga media o clique contra o
 * QUADRO, então todo clique saía deslocado, e quanto mais diferentes as
 * proporções, maior o engano. Uma foto 16:9 num quadro 4:3 perde um oitavo da
 * altura para faixa vazia dos dois lados: clicar no topo da foto gravava 12%,
 * e doze por cento de uma capa é o rosto inteiro de alguém.
 *
 * Isso passava despercebido enquanto o quadro era pequeno (384×224) — o erro
 * cabia dentro do dedo. Aumentar o quadro, que é o pedido do Juan, aumenta o
 * erro junto. Por isso a conta saiu do componente ANTES de o quadro crescer.
 *
 * Clique na faixa vazia devolve `null`: ali não há foto, e puxar para a borda
 * mais próxima gravaria uma decisão que ninguém tomou — e que ninguém teria
 * como descobrir que foi gravada.
 */
export interface CliqueNoQuadro {
  /** O quadro desenhado na tela. */
  quadro: { largura: number; altura: number };
  /** O tamanho natural da foto — é ele que decide onde fica a faixa vazia. */
  foto: { largura: number; altura: number };
  /** O clique, relativo ao canto superior esquerdo do quadro. */
  clique: { x: number; y: number };
}

export function pontoNaFoto({
  quadro,
  foto,
  clique,
}: CliqueNoQuadro): { x: number; y: number } | null {
  if (quadro.largura <= 0 || quadro.altura <= 0) return null;
  /* Sem o tamanho natural não há como saber onde está a faixa vazia — e medir
     contra o quadro seria o defeito antigo voltando pela porta dos fundos. A
     foto ainda não carregou: não gravar nada é melhor que gravar errado. */
  if (foto.largura <= 0 || foto.altura <= 0) return null;

  /* `object-contain` encolhe pelo lado que aperta primeiro. */
  const escala = Math.min(quadro.largura / foto.largura, quadro.altura / foto.altura);
  const desenhada = { largura: foto.largura * escala, altura: foto.altura * escala };
  const sobra = {
    x: (quadro.largura - desenhada.largura) / 2,
    y: (quadro.altura - desenhada.altura) / 2,
  };

  const naFoto = { x: clique.x - sobra.x, y: clique.y - sobra.y };
  if (naFoto.x < 0 || naFoto.y < 0 || naFoto.x > desenhada.largura || naFoto.y > desenhada.altura) {
    return null;
  }

  /* Inteiro porque é o que o banco aceita (migração 031), e porque meio por
     cento de enquadramento não é uma decisão que exista. */
  return {
    x: Math.round((naFoto.x / desenhada.largura) * 100),
    y: Math.round((naFoto.y / desenhada.altura) * 100),
  };
}
