/**
 * A ORDEM DA TABELA DE ESTÚDIOS DO ADMIN (30/09/2026).
 *
 * Felipe, com o print da tabela: "permita ordenar essa lista pelas colunas".
 *
 * Com dezenove estúdios a pergunta já não é "quem está aqui", é "quem está no
 * topo de cada coisa": quem está enchendo o espaço, quem custa mais, quem não
 * entra há mais tempo. A ordem fixa (quem chegou por último primeiro) só
 * responde uma delas.
 *
 * ── PELO ENDEREÇO, E NÃO NO NAVEGADOR ────────────────────────────────────
 *
 * `?ordem=espaco&sentido=desc#estudios`. A página é do servidor e a tabela já
 * chega inteira, então ordenar aqui não custa nada — e o link ordenado pode ir
 * para um sócio do jeito que está na tela.
 *
 * ── O QUE CADA COLUNA ORDENA ─────────────────────────────────────────────
 *
 * O número que a célula mostra em destaque, calculado pelas MESMAS funções
 * que a célula usa (`metricas-admin`, `config/trial`). Uma ordem por um número
 * que não é o da tela pareceria embaralhada.
 *
 * Data vazia ("sem registro", "nunca abriram") vai sempre para o fim, nos dois
 * sentidos: em "mais antigo primeiro" ela não é o mais antigo — é o que não
 * tem data nenhuma, e no topo esconderia justamente quem tem.
 *
 * Pura, sem banco: `scripts/testar-ordem-dos-estudios.mjs` cobre sem servidor.
 */
import { planoPorId } from "@/config/planos";
import {
  SITUACOES,
  custoMensalDoEstudioCentavos,
  mensalEquivalenteCentavos,
  precoMensalDoEstudio,
} from "./metricas-admin";
import type { LinhaAdmin } from "./admin";

export type Sentido = "asc" | "desc";
type Valor = string | number | null;

export interface ColunaDosEstudios {
  id: string;
  titulo: string;
  /** O sentido do primeiro clique: o que responde a pergunta mais comum. */
  primeiro: Sentido;
  valor: (e: LinhaAdmin) => Valor;
}

const quando = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

export const COLUNAS_DOS_ESTUDIOS: ColunaDosEstudios[] = [
  { id: "estudio", titulo: "Estúdio", primeiro: "asc", valor: (e) => e.nome_estudio },
  {
    id: "situacao",
    titulo: "Situação",
    primeiro: "asc",
    /* Na ordem de `SITUACOES` (trial, ativo, cortesia…), que é a ordem em que
       o painel inteiro as apresenta — alfabética juntaria "ativo" e
       "cancelado" por acaso. */
    valor: (e) => {
      const i = (SITUACOES as readonly string[]).indexOf(e.status);
      return i < 0 ? SITUACOES.length : i;
    },
  },
  {
    id: "plano",
    titulo: "Plano",
    primeiro: "desc",
    valor: (e) => planoPorId(e.plano_id)?.precoCentavos ?? null,
  },
  {
    id: "paga",
    titulo: "Paga",
    primeiro: "desc",
    /* O mesmo número da célula: só quem é ativo paga, e o anual vale por mês. */
    valor: (e) =>
      e.status === "ativo"
        ? mensalEquivalenteCentavos(precoMensalDoEstudio(e), e.ciclo_cobranca)
        : 0,
  },
  {
    id: "custo",
    titulo: "Custa por mês",
    primeiro: "desc",
    valor: (e) => custoMensalDoEstudioCentavos(e),
  },
  {
    id: "espaco",
    titulo: "Espaço",
    primeiro: "desc",
    /* O ocupado, no ar mais no cofre — o número grande da célula. */
    /* Em `Number`, e não `BigInt`: para ordenar basta, e só perde precisão
       acima de 9 petabytes. */
    valor: (e) => Number(e.bytes_no_ar) + Number(e.bytes_no_cofre),
  },
  {
    id: "conteudo",
    titulo: "Conteúdo",
    primeiro: "desc",
    /* Arquivos, e não galerias: "1 galeria" empata quase todo mundo. */
    valor: (e) => e.fotos + e.videos,
  },
  {
    id: "cliente",
    titulo: "Cliente abriu",
    primeiro: "desc",
    valor: (e) => quando(e.ultimo_acesso),
  },
  {
    id: "estudio-entrou",
    titulo: "Estúdio entrou",
    primeiro: "desc",
    valor: (e) => quando(e.ultimo_acesso_estudio),
  },
  { id: "entrou", titulo: "Entrou", primeiro: "desc", valor: (e) => quando(e.criado_em) },
];

/** A ordem de sempre: quem chegou por último primeiro — a do banco. */
export const ORDEM_PADRAO = { coluna: "entrou", sentido: "desc" as Sentido };

export interface OrdemDosEstudios {
  coluna: string;
  sentido: Sentido;
}

/** Lê o endereço. Coluna ou sentido que não existem caem na ordem de sempre. */
export function lerOrdem(p: { ordem?: string | string[]; sentido?: string | string[] }): OrdemDosEstudios {
  const coluna = COLUNAS_DOS_ESTUDIOS.find((c) => c.id === p.ordem);
  if (!coluna) return ORDEM_PADRAO;
  const sentido = p.sentido === "asc" || p.sentido === "desc" ? p.sentido : coluna.primeiro;
  return { coluna: coluna.id, sentido };
}

/**
 * Ordena uma CÓPIA — os totais da página leem a lista original. Empate
 * mantém a ordem de chegada, que é a do banco.
 */
export function ordenarEstudios(linhas: LinhaAdmin[], ordem: OrdemDosEstudios): LinhaAdmin[] {
  const coluna =
    COLUNAS_DOS_ESTUDIOS.find((c) => c.id === ordem.coluna) ??
    COLUNAS_DOS_ESTUDIOS.find((c) => c.id === ORDEM_PADRAO.coluna)!;
  const fator = ordem.sentido === "asc" ? 1 : -1;

  return linhas
    .map((linha, i) => ({ linha, i, v: coluna.valor(linha) }))
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
    .map((x) => x.linha);
}

/**
 * O endereço do cabeçalho: na coluna que já está ordenada, inverte o
 * sentido; nas outras, começa pelo sentido que ela prefere.
 */
export function enderecoDaOrdem(atual: OrdemDosEstudios, colunaId: string): string {
  const coluna = COLUNAS_DOS_ESTUDIOS.find((c) => c.id === colunaId);
  if (!coluna) return "#estudios";
  const sentido =
    atual.coluna === colunaId ? (atual.sentido === "asc" ? "desc" : "asc") : coluna.primeiro;
  return `?ordem=${coluna.id}&sentido=${sentido}#estudios`;
}
