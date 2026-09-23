import "server-only";
import { consultar, consultarUm, emTransacao } from "./db";
import { gerarSlug } from "./tenants";

/**
 * O ENDEREÇO DA GALERIA, E O QUE SOBRA DO ANTERIOR: NADA.
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
 * é clicável"; e depois, sobre `paula-bruno-2`, "o link não gostei porque não
 * consegui arrumar o 2". A galeria nasceu com o 2 porque ele já tinha criado
 * uma `paula-bruno` por engano.
 *
 * ── POR QUE O CAMPO ERA TRAVADO ───────────────────────────────────────────
 *
 * `galerias.slug` é a metade final do link que vai para o WhatsApp do casal e é
 * repassado para a família inteira. Trocá-lo transformava em erro um link em
 * circulação — e link de casamento não se reenvia.
 *
 * A primeira resposta foi permitir a troca só enquanto a galeria não tivesse
 * sido publicada nem aberta: seguro e pela metade, porque quem errou o endereço
 * e só percebeu depois de entregar continuava preso a ele. A segunda foi guardar
 * o endereço de saída como APELIDO, que continuava abrindo e redirecionava para
 * o novo (migração 030).
 *
 * ── A REGRA DE HOJE: TROCAR APAGA (16/09/2026) ────────────────────────────
 *
 * Felipe: "quando alterar o endereço da galeria, apagar o antigo". Perguntei se
 * valia também para a galeria já entregue, onde o apelido é o que segura o link
 * do casal: "pode apagar sempre o endereço antigo".
 *
 * Então o apelido acabou, e a consequência tem nome: trocar o endereço de uma
 * galeria entregue MATA o link que está no WhatsApp do casal. A escolha se
 * defende sozinha nos dois motivos reais de trocar — consertar um engano, e aí
 * não há link nenhum em circulação; ou revogar um link que vazou, e aí o apelido
 * era justamente o defeito, porque a troca não revogava coisa alguma.
 *
 * O que não se defende é descobrir isso depois. Por isso a tela diz antes, e a
 * galeria no ar ainda pergunta — ver `components/endereco-da-galeria.tsx`.
 *
 * ── A TABELA CONTINUA, E SÓ ESVAZIA ───────────────────────────────────────
 *
 * `enderecos_antigos_galeria` (030) não recebe mais nenhuma linha. As que já
 * existem continuam sendo lidas, e isso é decisão, não esquecimento: apagar
 * todas na subida mataria de uma vez, sem aviso e sem volta, links que hoje
 * funcionam. Cada linha some quando a galeria dela trocar de endereço de novo,
 * ou quando alguém apertar "apagar" na tela de Entrega.
 *
 * ── O ESCOPO: DENTRO DO ESTÚDIO, NÃO NO MUNDO ─────────────────────────────
 *
 * Vale para o que restou de apelido: ele vive dentro de `/g/<estudio>/<galeria>`
 * e é único por estúdio, não global. Duas fotógrafas podem ter, cada uma, uma
 * `paula-bruno` sem conflito nenhum. O que não pode é outra galeria DO MESMO
 * ESTÚDIO tomar um apelido vivo: aí o link entregue ao casal A passaria a abrir
 * as fotos do casamento B, funcionando e errado.
 */

export interface GaleriaResolvida {
  galeriaId: string;
  /** O endereço VÁLIDO hoje. Igual ao consultado quando `ehAntigo` é falso. */
  slugAtual: string;
  /** true = o visitante veio por um apelido e deve ser redirecionado. */
  ehAntigo: boolean;
}

/**
 * De quem é este endereço, dentro deste estúdio — atual ou antigo.
 *
 * Só é chamada quando a busca normal já não achou a galeria: o caminho comum é
 * o do endereço certo, e ele não pode pagar a consulta de quem errou.
 *
 * A segunda consulta só encontra apelidos ANTERIORES a 16/09/2026 — desde então
 * a troca não guarda nenhum. Ela fica porque esses links estão na mão de gente
 * que não tem como saber disso.
 */
export async function resolverGaleriaDoEstudio(
  tenantId: string,
  slug: string,
): Promise<GaleriaResolvida | null> {
  const atual = await consultarUm<{ id: string }>(
    "select id from galerias where tenant_id = $1 and slug = $2",
    [tenantId, slug],
  );
  if (atual) return { galeriaId: atual.id, slugAtual: slug, ehAntigo: false };

  const antigo = await consultarUm<{ galeria_id: string; slug_atual: string }>(
    `select a.galeria_id, g.slug as slug_atual
       from enderecos_antigos_galeria a
       join galerias g on g.id = a.galeria_id
      where a.tenant_id = $1 and a.slug = $2`,
    [tenantId, slug],
  );
  if (!antigo) return null;

  return { galeriaId: antigo.galeria_id, slugAtual: antigo.slug_atual, ehAntigo: true };
}

/** Os endereços antigos que esta galeria ainda carrega, do mais novo ao mais velho. */
export async function apelidosDaGaleria(galeriaId: string) {
  return consultar<{ slug: string; criado_em: Date }>(
    "select slug, criado_em from enderecos_antigos_galeria where galeria_id = $1 order by criado_em desc",
    [galeriaId],
  );
}

export type ResultadoDoEndereco = { ok: true; slug: string } | { ok: false; erro: string };

/**
 * Apaga um endereço antigo: ele deixa de abrir a galeria.
 *
 * Desde 16/09/2026 a troca já não guarda apelido nenhum, então isto serve ao que
 * ficou das trocas anteriores — e serve AGORA, sem esperar a próxima troca, que
 * é o que interessa quando o link vazou e a pressa é justamente essa.
 *
 * É destrutivo e não tem volta pelo produto (o apelido pode ser reivindicado por
 * outra galeria depois), então quem chama pergunta antes.
 */
export async function esquecerApelidoDaGaleria(
  galeriaId: string,
  tenantId: string,
  slug: string,
): Promise<{ ok: boolean }> {
  const linhas = await consultar(
    "delete from enderecos_antigos_galeria where tenant_id = $1 and galeria_id = $2 and slug = $3 returning slug",
    [tenantId, galeriaId, slug],
  );
  return { ok: linhas.length > 0 };
}

/**
 * Troca o endereço. O anterior deixa de existir.
 *
 * O texto pedido passa por `gerarSlug` — a MESMA função que nomeia a galeria na
 * criação. Duas regras de endereço divergiriam: a pessoa digitaria algo que a
 * criação aceita e a troca recusa, sem entender a diferença.
 *
 * As duas escritas — largar os endereços antigos e trocar o slug — vão numa
 * transação. Sem ela, uma falha entre as duas apagaria os apelidos de uma troca
 * que não aconteceu: a galeria ficaria no endereço velho e sem o que ainda a
 * protegia.
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

  const galeria = await consultarUm<{ slug: string }>(
    "select slug from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
  if (!galeria) return { ok: false, erro: "Galeria não encontrada." };
  if (galeria.slug === slug) return { ok: true, slug };

  /* Outra GALERIA viva do mesmo estúdio já usa este endereço. */
  const ocupado = await consultarUm(
    "select 1 from galerias where tenant_id = $1 and slug = $2 and id <> $3",
    [tenantId, slug, galeriaId],
  );
  if (ocupado) return { ok: false, erro: `Você já tem uma galeria em /${slug}.` };

  /*
   * O endereço pedido é apelido vivo de OUTRA galeria do mesmo estúdio — dos que
   * ficaram de antes de 16/09/2026. Enquanto aquele link abrir a galeria dela,
   * este estúdio não pode entregá-lo a esta aqui.
   *
   * `galeria_id <> $3` deixa de fora os apelidos da própria galeria: retomar um
   * endereço que já foi seu é permitido, e a troca apaga a linha logo abaixo.
   */
  const apelidoAlheio = await consultarUm(
    "select 1 from enderecos_antigos_galeria where tenant_id = $1 and slug = $2 and galeria_id <> $3",
    [tenantId, slug, galeriaId],
  );
  if (apelidoAlheio) {
    return {
      ok: false,
      erro: `/${slug} foi o endereço de outra galeria sua e continua abrindo aquela. Apague-o na Entrega dela para poder usá-lo aqui.`,
    };
  }

  try {
    return await emTransacao(async (q) => {
      /*
       * O endereço que sai não vira apelido, e os que já eram apelido vão junto:
       * TODOS, não só o que está saindo agora.
       *
       * "Trocar o endereço apaga o antigo" não conviveria com um apelido de três
       * trocas atrás continuando no ar — a pessoa acabou de ler que o anterior
       * morre, e a tela seguiria listando endereços vivos.
       *
       * É também o que permite RETOMAR um endereço anterior sem laço: a linha
       * dizendo "este endereço é antigo" mandaria o visitante para si mesmo.
       */
      await q("delete from enderecos_antigos_galeria where tenant_id = $1 and galeria_id = $2", [
        tenantId,
        galeriaId,
      ]);
      const linhas = await q<{ slug: string }>(
        "update galerias set slug = $1, atualizado_em = now() where id = $2 and tenant_id = $3 returning slug",
        [slug, galeriaId, tenantId],
      );
      if (linhas.length === 0) throw new Error("galeria sumiu no meio da troca");
      return { ok: true as const, slug: linhas[0].slug };
    });
  } catch {
    /* Corrida com outra aba: o índice único pegou o que a conferência acima não
       podia pegar, porque entre conferir e gravar cabe outra galeria nascer. */
    return { ok: false, erro: `Você já tem uma galeria em /${slug}.` };
  }
}
