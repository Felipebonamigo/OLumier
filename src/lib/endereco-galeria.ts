import "server-only";
import { consultar, consultarUm, emTransacao } from "./db";
import { gerarSlug } from "./tenants";

/**
 * O ENDEREÇO DA GALERIA, E O APELIDO QUE SOBREVIVE À TROCA.
 *
 * Irmão de `lib/endereco.ts`, que faz isto para o endereço do ESTÚDIO. Mesmo
 * problema, mesma forma, uma diferença que muda tudo — ver "o escopo" abaixo.
 *
 * ── O PEDIDO ──────────────────────────────────────────────────────────────
 *
 * Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
 * é clicável"; e depois, sobre `paula-bruno-2`, "o link não gostei porque não
 * consegui arrumar o 2". A galeria nasceu com o 2 porque ele já tinha criado
 * uma `paula-bruno` por engano.
 *
 * ── POR QUE O CAMPO ERA TRAVADO, E POR QUE A TRAVA CAIU ───────────────────
 *
 * `galerias.slug` é a metade final do link que vai para o WhatsApp do casal e é
 * repassado para a família inteira. Trocá-lo transformava em erro um link em
 * circulação — e link de casamento não se reenvia.
 *
 * A primeira resposta foi permitir a troca só enquanto a galeria não tivesse
 * sido publicada nem aberta. Era seguro e era metade: quem errou o endereço e
 * só percebeu depois de entregar continuava preso a ele, que é justamente
 * quando a pessoa percebe — o casal responde "que 2 é esse?".
 *
 * Agora troca sempre, e o endereço anterior vira APELIDO: continua abrindo, com
 * redirecionamento permanente para o novo (migração 030). O casal não percebe
 * nada.
 *
 * ── O ESCOPO: DENTRO DO ESTÚDIO, NÃO NO MUNDO ─────────────────────────────
 *
 * Apelido de estúdio é global — dois estúdios não podem reivindicar o mesmo,
 * senão o link de um passa a abrir a galeria do outro. Apelido de galeria não:
 * ele vive dentro de `/g/<estudio>/<galeria>`, e duas fotógrafas podem ter,
 * cada uma, uma `paula-bruno` sem conflito nenhum. Tornar global aqui
 * inventaria uma escassez que o endereço não tem — a primeira `casamento` do
 * sistema tomaria a palavra de todo mundo.
 *
 * O que NÃO pode é outra galeria DO MESMO ESTÚDIO tomar um apelido: aí o link
 * entregue ao casal A passaria a abrir as fotos do casamento B, funcionando e
 * errado. É a recusa que `testar-endereco-galeria.mjs` mais insiste.
 */

/**
 * Quantas vezes uma galeria pode trocar de endereço.
 *
 * Mesmo número e mesmo raciocínio do estúdio (`LIMITE_TROCAS`): a tabela de
 * apelidos cresce para sempre e é consultada em toda visita que erra o
 * endereço. Trocar é consertar um erro, não rotina — e quem precisar da quarta
 * fala com a gente, conversa barata; descobrir que a tabela virou depósito não
 * é.
 */
export const LIMITE_TROCAS_GALERIA = 3;

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

/** Os endereços antigos desta galeria, do mais recente para o mais velho. */
export async function apelidosDaGaleria(galeriaId: string) {
  return consultar<{ slug: string; criado_em: Date }>(
    "select slug, criado_em from enderecos_antigos_galeria where galeria_id = $1 order by criado_em desc",
    [galeriaId],
  );
}

export type ResultadoDoEndereco = { ok: true; slug: string } | { ok: false; erro: string };

/**
 * Troca o endereço, guardando o anterior como apelido.
 *
 * O texto pedido passa por `gerarSlug` — a MESMA função que nomeia a galeria na
 * criação. Duas regras de endereço divergiriam: a pessoa digitaria algo que a
 * criação aceita e a troca recusa, sem entender a diferença.
 *
 * As duas escritas — gravar o apelido e trocar o slug — vão numa transação. Sem
 * ela, uma falha entre as duas deixa o pior estado possível: o endereço novo no
 * ar e o antigo sem apelido, ou seja, o link do casal morto e ninguém sabendo.
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
   * O apelido é de OUTRA galeria do mesmo estúdio.
   *
   * `galeria_id <> $3` é o que permite RETOMAR o próprio apelido: quem trocou
   * por engano precisa poder voltar, e recusar a volta a prenderia no endereço
   * novo exatamente pelo motivo que a prendia no antigo.
   */
  const apelidoAlheio = await consultarUm(
    "select 1 from enderecos_antigos_galeria where tenant_id = $1 and slug = $2 and galeria_id <> $3",
    [tenantId, slug, galeriaId],
  );
  if (apelidoAlheio) {
    return {
      ok: false,
      erro: `/${slug} foi o endereço de outra galeria sua e continua abrindo aquela. Escolha outro.`,
    };
  }

  /* O limite conta os apelidos QUE VÃO SOBRAR. Retomar um endereço anterior
     REMOVE um apelido em vez de somar, e não pode gastar cota por isso — senão
     desfazer um engano custa o mesmo que cometê-lo. */
  const retomando = await consultarUm(
    "select 1 from enderecos_antigos_galeria where tenant_id = $1 and slug = $2 and galeria_id = $3",
    [tenantId, slug, galeriaId],
  );
  const trocas = await consultarUm<{ n: number }>(
    "select count(*)::int as n from enderecos_antigos_galeria where galeria_id = $1",
    [galeriaId],
  );
  if (!retomando && (trocas?.n ?? 0) >= LIMITE_TROCAS_GALERIA) {
    return {
      ok: false,
      erro: `Esta galeria já trocou de endereço ${LIMITE_TROCAS_GALERIA} vezes, que é o limite. Fale com a gente se precisar de mais uma.`,
    };
  }

  try {
    return await emTransacao(async (q) => {
      /* O endereço que sai vira apelido. `on conflict do nothing` cobre o
         vaivém — trocar para A, para B e de volta para A deixaria o apelido A
         já gravado, e isso não é erro nenhum. */
      await q(
        `insert into enderecos_antigos_galeria (tenant_id, slug, galeria_id)
              values ($1, $2, $3)
         on conflict (tenant_id, slug) do nothing`,
        [tenantId, galeria.slug, galeriaId],
      );
      /* O apelido que a galeria está retomando deixa de ser apelido: ele volta
         a ser o endereço vigente, e uma linha dizendo "este endereço é antigo"
         mandaria o visitante para si mesmo, em laço. */
      await q(
        "delete from enderecos_antigos_galeria where tenant_id = $1 and slug = $2 and galeria_id = $3",
        [tenantId, slug, galeriaId],
      );
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
