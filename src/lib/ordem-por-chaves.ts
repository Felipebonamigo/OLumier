/**
 * ORDENAR UMA TABELA PELAS CHAVES DE CADA LINHA (13/10/2026).
 *
 * Felipe, com o print da tabela de estúdios (44 linhas): "está bem bugado para
 * mexer aqui e reordenar". Cada clique num cabeçalho era um link para a MESMA
 * página com outro `?ordem=`: o servidor refazia a Administração inteira — uma
 * dúzia de consultas, para mudar a ordem de uma tabela — e o navegador pulava
 * para a âncora. Com a tabela rolada até o meio, o clique fazia nada por
 * alguns segundos e depois jogava a página para outro lugar.
 *
 * Agora a ordem é feita NO NAVEGADOR, sobre chaves que o servidor já mandou
 * junto de cada linha. Este módulo é a regra, sem nenhuma dependência: o
 * servidor a usa para a primeira ordem (o link `?ordem=…` continua valendo, e
 * sem JavaScript também), o navegador a usa a cada clique, e as duas leem o
 * mesmo código — então nunca discordam sobre quem vem primeiro.
 *
 * Pura: `scripts/testar-ordem-dos-estudios.mjs` cobre sem servidor.
 */

export type Sentido = "asc" | "desc";
export type Valor = string | number | null;

export interface OrdemDaTabela {
  coluna: string;
  sentido: Sentido;
}

/**
 * Ordena uma CÓPIA. `chaves[coluna]` nula (data vazia, "sem registro") vai
 * sempre para o fim, nos dois sentidos: em "mais antigo primeiro" ela não é o
 * mais antigo — é o que não tem data nenhuma, e no topo esconderia quem tem.
 * Empate mantém a ordem de chegada.
 */
export function ordenarPorChaves<T extends { chaves: Record<string, Valor> }>(
  itens: readonly T[],
  ordem: OrdemDaTabela,
): T[] {
  const fator = ordem.sentido === "asc" ? 1 : -1;
  return itens
    .map((item, i) => ({ item, i, v: item.chaves[ordem.coluna] ?? null }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) {
        if (a.v === b.v) return a.i - b.i;
        return a.v === null ? 1 : -1;
      }
      const c =
        typeof a.v === "string" && typeof b.v === "string"
          ? a.v.localeCompare(b.v, "pt-BR", { sensitivity: "base" })
          : Number(a.v) - Number(b.v);
      return c === 0 ? a.i - b.i : c * fator;
    })
    .map((x) => x.item);
}

/**
 * A ordem depois de clicar no cabeçalho de `colunaId`: na coluna que já está
 * ordenada, inverte o sentido; nas outras, começa pelo sentido que ela prefere
 * (`primeiro` — o que responde a pergunta mais comum daquela coluna).
 */
export function proximaOrdem(atual: OrdemDaTabela, colunaId: string, primeiro: Sentido): OrdemDaTabela {
  return {
    coluna: colunaId,
    sentido: atual.coluna === colunaId ? (atual.sentido === "asc" ? "desc" : "asc") : primeiro,
  };
}
