import "server-only";
import { consultar } from "@/lib/db";
import { lerAparencia, type Aparencia } from "@/config/aparencia";

/**
 * Rascunho e publicação da aparência — as duas escritas, num lugar só.
 *
 * ── POR QUE SÃO DUAS COLUNAS (01/09/2026) ─────────────────────────────────
 *
 * Até 31/08 o editor gravava a cada clique, direto em `aparencia`. Tinha uma
 * virtude — nada se perdia — e um defeito: experimentar mexia na galeria que o
 * cliente estava vendo naquele instante.
 *
 * O botão "Publicar aparência" resolveu o defeito e trouxe outro, pior, porque
 * é silencioso: quem escolhia e saía sem apertar perdia a escolha. Custou isso
 * no mesmo dia, com a primeira usuária de verdade.
 *
 * As duas colunas separam o que estava grudado:
 *
 *   aparencia            o que o CLIENTE vê. Só muda em `publicarAparencia`.
 *   aparencia_rascunho   o que o FOTÓGRAFO está experimentando. Grava sozinho.
 *
 * Nada se perde, inclusive trocando de aparelho — que é o que o navegador
 * sozinho não resolveria —, e publicar continua sendo um ato.
 *
 * ── POR QUE ISTO NÃO MORA EM `actions.ts` ─────────────────────────────────
 *
 * Server action não se importa de um script de teste: puxa o runtime do cliente
 * do Next e estoura fora de uma requisição. Com a regra aqui, `testar-previa`
 * exercita a ESCRITA de verdade, contra o banco, em vez de conferir a tela e
 * torcer. As actions viram duas linhas de casca.
 */

/** Guarda o que o fotógrafo está experimentando. Não toca no que está no ar. */
export async function gravarRascunho(
  galeriaId: string,
  tenantId: string,
  bruto: unknown,
): Promise<{ ok: boolean }> {
  const limpa = lerAparencia(bruto);
  /* O `returning` existe para saber se ESCREVEU: um update sem ele devolve lista
     vazia tanto quando gravou quanto quando não achou a galeria, e a tela diria
     "salvo" para uma gravação que não aconteceu. */
  const linhas = await consultar(
    `update galerias set aparencia_rascunho = $1
      where id = $2 and tenant_id = $3
      returning id`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );
  return { ok: linhas.length > 0 };
}

/**
 * Publica: o que estava no rascunho passa a ser o que o cliente vê.
 *
 * O rascunho é APAGADO no mesmo update, e não numa segunda consulta. Sobrando,
 * ele seria idêntico ao publicado e a barra continuaria pedindo para publicar
 * uma coisa já publicada — e, num update separado, uma falha de rede no meio
 * deixaria exatamente esse estado.
 */
export async function publicarAparencia(
  galeriaId: string,
  tenantId: string,
  bruto: unknown,
): Promise<{ ok: boolean; aparencia: Aparencia }> {
  const limpa = lerAparencia(bruto);
  const linhas = await consultar(
    `update galerias set aparencia = $1, aparencia_rascunho = null, atualizado_em = now()
      where id = $2 and tenant_id = $3
      returning id`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );
  return { ok: linhas.length > 0, aparencia: limpa };
}
