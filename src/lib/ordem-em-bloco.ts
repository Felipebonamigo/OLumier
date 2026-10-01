/**
 * MOVER VÁRIAS FOTOS DE UMA VEZ — a regra, sem banco e sem tela (01/10/2026).
 *
 * Vitória Cocolichio: "na hora de organizar as fotos adicionadas, seria legal
 * poder selecionar e arrastar todas de uma vez pra um determinado ponto. Eu
 * gosto de selecionar minhas favoritas e colocar como as primeiras da galeria
 * — mas tentei selecionar todas que eu queria e quando arrastei só deu pra
 * fazer de uma em uma."
 *
 * O arrastar de UMA foto (`moverMediaNaOrdem`) continua como era. Com várias
 * marcadas, elas andam juntas:
 *
 *   - vão para ANTES da foto onde foram soltas — sempre antes, nos dois
 *     sentidos. A pré-visualização mostra o lugar exato enquanto o dedo anda,
 *     e uma regra só é a que a pessoa aprende sem ler;
 *   - "inicio" e "fim" são os botões da barra de seleção: o pedido da Vitória
 *     inteiro num clique, e o caminho de quem está no celular, onde não existe
 *     arrastar;
 *   - entre elas, a ordem que já tinham na galeria — marcar a 40 antes da 3
 *     não inverte as duas.
 *
 * Pura, e usada dos DOIS lados: a tela desenha a pré-visualização com ela e o
 * servidor grava com ela. Se as duas contas divergissem, as fotos pulariam de
 * lugar ao recarregar. `scripts/testar-arrastar-fotos.mjs` cobre.
 */
export type DestinoDoBloco = string | "inicio" | "fim";

export function moverBloco(ordem: string[], bloco: string[], destino: DestinoDoBloco): string[] {
  const noBloco = new Set(bloco);
  const doBloco = ordem.filter((id) => noBloco.has(id));
  if (doBloco.length === 0) return ordem;
  /* Soltou em cima de uma das próprias marcadas: não há "antes dela" que faça
     sentido para o grupo, e mexer seria surpresa. */
  if (destino !== "inicio" && destino !== "fim" && noBloco.has(destino)) return ordem;

  const resto = ordem.filter((id) => !noBloco.has(id));
  let onde: number;
  if (destino === "inicio") onde = 0;
  else if (destino === "fim") onde = resto.length;
  else {
    onde = resto.indexOf(destino);
    if (onde < 0) return ordem;
  }
  return [...resto.slice(0, onde), ...doBloco, ...resto.slice(onde)];
}
