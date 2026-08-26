import "server-only";
import { armazemDe, conferirOriginal, type Armazem } from "./armazem";

/**
 * O QUE FAZER COM UM ENVIO QUE FICOU PARADO.
 *
 * A linha em `medias` nasce com `pronto = false` para reservar quota antes de o
 * envio começar — sem isso, dois uploads simultâneos furariam o limite juntos.
 * Quando ela fica parada, alguém precisa decidir entre coisas muito diferentes,
 * e errar para o lado errado apaga trabalho de cliente.
 *
 * ── POR QUE A REGRA SAIU DO SCRIPT (26/08/2026) ───────────────────────────
 * Ela morava dentro de `scripts/limpar-pendentes.mjs` e procurava o arquivo
 * SEMPRE no R2, com `conferirObjeto` importado direto de `lib/r2.ts`, ignorando
 * a coluna `armazem`.
 *
 * Desde a obra do B2 o ORIGINAL mora no B2, e só as derivadas ficam no R2.
 * Então, para toda mídia em B2 cujo envio deu certo e cuja confirmação se
 * perdeu, o script procurava onde o arquivo nunca esteve, não achava, concluía
 * "abandonado" e APAGAVA a linha — com o arquivo seguindo no B2, órfão, pago e
 * invisível. Perda de dado silenciosa, no sentido contrário ao que o script
 * existe para proteger.
 *
 * Num script, essa regra não tinha como ser testada sem um armazém de verdade.
 * Aqui ela é uma função pura de uma consulta injetável, e
 * `scripts/testar-pendentes.mjs` prende cada caso — inclusive o que faltava.
 */

/** O que o chamador precisa saber da mídia. */
export interface MediaPendente {
  chave: string;
  /** Vem do banco e pode ser nulo nas mídias anteriores à obra do B2. */
  armazem: string | null;
}

export type DecisaoPendente =
  | { acao: "resgatar"; bytes: number }
  | { acao: "remover" }
  | { acao: "adiar" };

/** A consulta ao armazém, injetável para o teste não precisar de rede. */
export type ConferirNoArmazem = (
  chave: string,
  armazem: Armazem,
) => Promise<{ bytes: number }>;

/**
 * Decide o destino de UMA mídia pendente.
 *
 * Três respostas, e a terceira é a que separa este código de um que perde foto:
 *
 *   resgatar — o arquivo está lá; só a confirmação se perdeu;
 *   remover  — o armazém respondeu "não tenho"; envio abandonado;
 *   adiar    — não deu para PERGUNTAR (rede, tempo esgotado, credencial).
 *
 * "Não achei" é resposta. "Não consegui perguntar" não é. Tratar as duas como
 * a mesma coisa apagaria o trabalho de um estúdio inteiro no dia em que o
 * armazém tivesse instabilidade — e a limpeza roda todo dia, sozinha, de
 * madrugada, sem ninguém olhando.
 *
 * Na dúvida, a mídia fica: ela volta na varredura de amanhã, e o custo de
 * esperar um dia é quota reservada. O custo de errar é a foto do casamento.
 */
export async function decidirPendente(
  media: MediaPendente,
  conferir: ConferirNoArmazem = conferirOriginal,
): Promise<DecisaoPendente> {
  /* `armazemDe` é a mesma normalização que a galeria usa para LER o arquivo.
   * Duas réguas diferentes fariam a limpeza procurar num lugar e a entrega
   * noutro — e a divergência só apareceria quando algo já tivesse sumido. */
  const armazem = armazemDe(media.armazem);

  try {
    const achado = await conferir(media.chave, armazem);
    return { acao: "resgatar", bytes: achado.bytes };
  } catch (erro) {
    return ehAusencia(erro) ? { acao: "remover" } : { acao: "adiar" };
  }
}

/**
 * O objeto não existe, ou não deu para perguntar?
 *
 * A lista é de nomes que a AWS SDK usa para "não está lá". Qualquer outra coisa
 * — tempo esgotado, DNS, credencial recusada, 500 do fornecedor — é falha de
 * comunicação, e falha de comunicação nunca autoriza apagar.
 *
 * O padrão é o seguro: erro desconhecido cai em "adiar", não em "remover".
 */
function ehAusencia(erro: unknown): boolean {
  const e = erro as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const nome = e?.name ?? e?.Code ?? "";
  if (nome === "NotFound" || nome === "NoSuchKey" || nome === "NotFoundException") return true;
  return e?.$metadata?.httpStatusCode === 404;
}
