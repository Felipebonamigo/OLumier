import "server-only";
import { consultar, consultarUm } from "./db";
import { gerarSlug } from "./tenants";

/**
 * O ENDEREÇO DA GALERIA, E QUANDO ELE PODE MUDAR.
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área
 * não é clicável"; e depois, sobre o link que saiu, "não consegui arrumar o 2".
 * A galeria dele nasceu `paula-bruno-2` porque ele já tinha criado uma
 * `paula-bruno` por engano, e ficou com o 2 para sempre.
 *
 * ── POR QUE O CAMPO ERA TRAVADO, E POR QUE A TRAVA ESTAVA CERTA ───────────
 *
 * O endereço vai para o WhatsApp do casal e é repassado para a família inteira.
 * Renomear a galeria não pode transformar um link em circulação numa página de
 * erro — e, ao contrário do endereço do ESTÚDIO, que ganhou apelido na migração
 * 025, a galeria não tem tabela de apelido: o endereço antigo simplesmente
 * deixaria de existir.
 *
 * A trava resolvia o risco e não resolvia a necessidade. Quem errou o endereço
 * numa galeria que ninguém nunca viu ficava com o erro para sempre.
 *
 * ── A REGRA ───────────────────────────────────────────────────────────────
 *
 * Troca enquanto a galeria NÃO ESTÁ PUBLICADA **e** NUNCA FOI ABERTA.
 *
 * As duas condições, e é a segunda que sustenta a promessa. "Não publicada"
 * sozinha liberaria a troca numa galeria que foi ao ar, foi entregue e depois
 * saiu do ar por um tempo — e o link do casal quebraria. Sem nenhum acesso
 * registrado E fora do ar, ninguém pode ter aquele endereço: ele nunca
 * respondeu a ninguém.
 *
 * É uma porta que se fecha sozinha, e isso é de propósito: no instante em que a
 * galeria é publicada, o endereço vira compromisso.
 */

/** Dá para trocar o endereço desta galeria agora? */
export async function podeTrocarEnderecoDaGaleria(
  galeriaId: string,
  tenantId: string,
): Promise<boolean> {
  const linha = await consultarUm<{ pode: boolean }>(
    `select (not g.publicada
             and not exists (select 1 from acessos a where a.galeria_id = g.id)) as pode
       from galerias g
      where g.id = $1 and g.tenant_id = $2`,
    [galeriaId, tenantId],
  );
  return Boolean(linha?.pode);
}

export type ResultadoDoEndereco = { ok: true; slug: string } | { ok: false; erro: string };

/**
 * Troca o endereço, ou explica por que não.
 *
 * O texto pedido passa por `gerarSlug` — a MESMA função que nomeia a galeria na
 * criação. Duas regras de endereço divergiriam: a pessoa digitaria algo que a
 * criação aceitaria e a troca recusaria, sem entender a diferença.
 */
export async function trocarEnderecoDaGaleria(
  galeriaId: string,
  tenantId: string,
  pedido: string,
): Promise<ResultadoDoEndereco> {
  const slug = gerarSlug(pedido);
  if (!slug) {
    return { ok: false, erro: "Use letras e números — foi isso que sobrou do que você digitou." };
  }
  if (slug.length > 80) {
    return { ok: false, erro: "Endereço longo demais. Até 80 caracteres." };
  }

  if (!(await podeTrocarEnderecoDaGaleria(galeriaId, tenantId))) {
    return {
      ok: false,
      erro: "Esta galeria já foi publicada ou já foi aberta por alguém. O endereço fica fixo para não quebrar o link que você entregou.",
    };
  }

  /* Endereço é único POR ESTÚDIO, e a conferência é aqui além do índice do
     banco: sem ela, o erro chegaria à pessoa como uma violação de constraint em
     inglês. O índice continua sendo a última palavra — entre conferir e gravar
     cabe outra galeria nascer com o mesmo nome. */
  const ocupado = await consultarUm(
    "select 1 from galerias where tenant_id = $1 and slug = $2 and id <> $3",
    [tenantId, slug, galeriaId],
  );
  if (ocupado) {
    return { ok: false, erro: `Você já tem uma galeria em /${slug}.` };
  }

  try {
    const linhas = await consultar<{ slug: string }>(
      `update galerias
          set slug = $1, atualizado_em = now()
        where id = $2 and tenant_id = $3
          and not publicada
          and not exists (select 1 from acessos a where a.galeria_id = galerias.id)
      returning slug`,
      [slug, galeriaId, tenantId],
    );
    if (linhas.length === 0) {
      return { ok: false, erro: "Não foi possível trocar o endereço agora." };
    }
    return { ok: true, slug: linhas[0].slug };
  } catch {
    /* Corrida com outra aba criando galeria de mesmo nome: o índice único pegou
       o que a conferência acima não podia pegar. */
    return { ok: false, erro: `Você já tem uma galeria em /${slug}.` };
  }
}
