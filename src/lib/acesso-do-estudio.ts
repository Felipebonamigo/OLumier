import "server-only";
import { consultar } from "./db";

/**
 * A TRAVA DE TEMPO — e ela é o desenho inteiro.
 *
 * Sem ela, cada página do painel gravaria uma linha em `tenants`. São várias
 * requisições por minuto de quem está montando uma galeria, todas escrevendo a
 * mesma informação com um segundo de diferença. Com 15 minutos, uma tarde
 * inteira de trabalho gera no máximo 4 escritas por hora, e a pergunta que a
 * coluna existe para responder — "essa pessoa ainda entra?" — continua com a
 * mesma resposta.
 *
 * Quinze e não sessenta porque a marca também serve para saber se alguém está
 * no ar AGORA (ao ligar para um cliente, ao investigar um envio travado), e
 * uma hora de defasagem apagaria essa leitura.
 */
export const JANELA_DE_ACESSO_MIN = 15;

/**
 * Carimba a passagem do fotógrafo — no máximo uma vez por janela.
 *
 * ── A TRAVA VIVE NO `where`, E NÃO NUM `select` ANTES ─────────────────────
 *
 * Ler a marca para depois decidir se grava abre uma corrida: duas requisições
 * simultâneas (e elas são simultâneas o tempo todo — cada aba do painel é uma)
 * leem a mesma marca velha e as duas gravam. No `where`, quem resolve é o
 * banco: a segunda casa zero linhas e não faz nada. É o mesmo argumento de
 * `criarSecao`, que confere nome repetido dentro da consulta.
 *
 * ── NUNCA LANÇA ──────────────────────────────────────────────────────────
 *
 * Esta função é um efeito colateral de uma página que só queria se desenhar. Se
 * o banco recusar a escrita, o certo é a página aparecer assim mesmo — o
 * carimbo de acesso não vale uma tela de erro. O `catch` é mudo de propósito:
 * `sessaoAtual` já falaria com o banco logo antes, então um banco fora do ar
 * derruba a página por outro caminho, com mensagem de verdade.
 */
export async function marcarAcessoDoEstudio(tenantId: string): Promise<void> {
  try {
    await consultar(
      `update tenants
          set ultimo_acesso_em = now()
        where id = $1
          and (ultimo_acesso_em is null
               or ultimo_acesso_em < now() - ($2 || ' minutes')::interval)`,
      [tenantId, String(JANELA_DE_ACESSO_MIN)],
    );
  } catch {
    /* Ver o comentário acima: silêncio é a decisão, não esquecimento. */
  }
}
