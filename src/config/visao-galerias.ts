/**
 * AS FORMAS DE VER AS GALERIAS NO PAINEL (30/09/2026).
 *
 * Felipe, com a foto do painel de um estúdio com 18 galerias em cartões quase
 * iguais: "usuário reclamou que está se confundindo para visualizar as
 * galerias, vamos criar novas formas de visualização, e aí cada usuário
 * escolhe lá em cima como quer ver". Pediu três — a atual, lista e miniaturas
 * com a capa — e mais uma à escolha.
 *
 * A quarta é POR MÊS: fotógrafo lembra de um trabalho pela época ("o
 * casamento de setembro"), e 18 cartões seguidos não dizem onde setembro
 * acaba. A lista já vem na ordem do evento (`listarGalerias`), então agrupar
 * é só pôr um título onde o mês muda.
 *
 * A escolha mora num COOKIE, e não no banco: é preferência de tela — quem usa
 * o celular pode querer capas, e o computador, lista. E o servidor lê o
 * cookie antes de desenhar, então a página já nasce na forma escolhida, sem
 * piscar a forma padrão primeiro.
 *
 * Pura: `scripts/testar-visao-galerias.mjs` cobre sem servidor.
 */

export const VISOES = [
  { id: "cartoes", nome: "Cartões" },
  { id: "lista", nome: "Lista" },
  { id: "capas", nome: "Capas" },
  { id: "mes", nome: "Por mês" },
] as const;

export type Visao = (typeof VISOES)[number]["id"];

export const VISAO_PADRAO: Visao = "cartoes";

export const COOKIE_VISAO = "visao_galerias";

/** Guarda a escolha por um ano, só no painel. Roda no navegador. */
export function guardarVisao(v: Visao): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_VISAO}=${v}; path=/painel; max-age=31536000; samesite=lax`;
}

/** O cookie como veio — lixo e valor antigo caem na forma de sempre. */
export function lerVisao(valor: string | null | undefined): Visao {
  return VISOES.some((v) => v.id === valor) ? (valor as Visao) : VISAO_PADRAO;
}

/**
 * Os grupos da visão "por mês", na ordem em que as galerias chegaram. Um mês
 * que reaparece depois de outro (não deveria, a lista vem ordenada) vira um
 * grupo novo em vez de puxar a galeria para trás — a ordem da tela é a do
 * servidor, sempre.
 */
export function agruparPorMes<T extends { mes: string }>(itens: T[]): { mes: string; itens: T[] }[] {
  const grupos: { mes: string; itens: T[] }[] = [];
  for (const item of itens) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.mes === item.mes) ultimo.itens.push(item);
    else grupos.push({ mes: item.mes, itens: [item] });
  }
  return grupos;
}
