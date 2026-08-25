import "server-only";
import { consultar, consultarUm } from "./db";
import { calcularVencimento } from "@/config/prazos";
import { usoDoEstudio } from "./medias";

/**
 * Cofre: a galeria fica um tempo no ar e depois desce, sem nada ser apagado.
 *
 * É a promessa que nenhum concorrente faz — neles, plano cancelado ou galeria
 * vencida significa entrega perdida. Aqui o link sai do ar e o arquivo continua,
 * reativável em um clique. Do lado do negócio, é o que faz um cliente com anos
 * de entregas guardadas não cancelar.
 */

// Constantes e cálculos puros vivem em config/prazos — a tela do painel é um
// componente de cliente e não pode importar um módulo server-only.
export { PRAZOS, PRAZO_PADRAO, calcularVencimento, diasAteArquivar } from "@/config/prazos";

export async function definirPrazo(
  galeriaId: string,
  tenantId: string,
  meses: number | null,
): Promise<void> {
  /*
   * O prazo conta a partir de AGORA, não da data do evento: o fotógrafo às vezes
   * publica meses depois do casamento, e contar do evento entregaria ao casal uma
   * galeria já vencida.
   */
  const expira = calcularVencimento(meses);
  await consultar(
    `update galerias set expira_em = $1, atualizado_em = now()
      where id = $2 and tenant_id = $3`,
    [expira, galeriaId, tenantId],
  );
}

export interface ResultadoCofre {
  ok: boolean;
  erro?: string;
}

/** Quanto a galeria ocupa — o que vai mudar de balde ao arquivar ou reativar. */
async function tamanhoDaGaleria(galeriaId: string, tenantId: string): Promise<bigint | null> {
  const r = await consultarUm<{ existe: boolean; bytes: string }>(
    `select true as existe,
            coalesce((select sum(m.bytes) from medias m where m.galeria_id = g.id), 0)::text as bytes
       from galerias g where g.id = $1 and g.tenant_id = $2`,
    [galeriaId, tenantId],
  );
  return r ? BigInt(r.bytes) : null;
}

/**
 * Manda a galeria para o cofre agora, sem esperar o prazo.
 *
 * NÃO PODE FALHAR, e isso é o desenho, não descuido: desde a unificação de
 * 25/08/2026 existe um espaço só, então arquivar não muda o total ocupado —
 * muda apenas se o link abre para o cliente final. Não há motivo físico para
 * recusar.
 *
 * A versão anterior recusava quando não cabia no `quota_cofre_bytes`, que
 * nascia zero (migração 007). Na prática o cliente padrão levava "não cabe no
 * seu cofre" na primeira vez que tentava usar o recurso que mais vendemos, e a
 * saída oferecida era apagar entrega — exatamente o que a página /seguranca
 * promete que nunca é preciso fazer.
 *
 * `scripts/testar-quota.mjs` prende isto: se alguém reintroduzir uma recusa
 * aqui, a suíte fica vermelha antes de o cliente descobrir.
 */
export async function arquivarAgora(
  galeriaId: string,
  tenantId: string,
): Promise<ResultadoCofre> {
  const tamanho = await tamanhoDaGaleria(galeriaId, tenantId);
  if (tamanho === null) return { ok: false, erro: "Galeria não encontrada." };

  await consultar(
    `update galerias
        set estado = 'arquivada', arquivada_em = now(), atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado = 'online'`,
    [galeriaId, tenantId],
  );

  /*
   * Arquivar por BOTÃO, não por prazo — e a distinção importa: aqui foi decisão
   * de alguém, e o cliente do estúdio pode reclamar que a galeria saiu do ar
   * antes do combinado. `arquivarVencidas` registra como 'sistema'.
   */
  const { registrarEvento, ACOES } = await import("./eventos");
  await registrarEvento({
    tenantId,
    ator: "estudio",
    acao: ACOES.GALERIA_ARQUIVADA,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    detalhe: { manual: true, bytes: tamanho.toString() },
  });

  return { ok: true };
}

/**
 * Tira a galeria do cofre. Estende o prazo por mais 12 meses a partir de hoje —
 * reativar e a galeria vencer de novo na semana seguinte seria uma armadilha.
 *
 * Também NÃO PODE FALHAR, pelo mesmo motivo de `arquivarAgora`: com um espaço
 * só, voltar ao ar não ocupa um byte a mais do que já estava ocupado. A recusa
 * antiga ("não há espaço no ar") existia porque os baldes eram dois.
 */
export async function reativar(galeriaId: string, tenantId: string): Promise<ResultadoCofre> {
  const tamanho = await tamanhoDaGaleria(galeriaId, tenantId);
  if (tamanho === null) return { ok: false, erro: "Galeria não encontrada." };

  await consultar(
    `update galerias
        set estado = 'online',
            arquivada_em = null,
            expira_em = case when expira_em is null then null
                             else now() + interval '12 months' end,
            atualizado_em = now()
      where id = $1 and tenant_id = $2 and estado = 'arquivada'`,
    [galeriaId, tenantId],
  );

  const { registrarEvento, ACOES } = await import("./eventos");
  await registrarEvento({
    tenantId,
    ator: "estudio",
    acao: ACOES.GALERIA_REATIVADA,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    // O prazo novo é o que o cliente do estúdio vai cobrar depois ("até quando
    // fica no ar?"), e ele é recalculado aqui, não combinado antes.
    detalhe: { bytes: tamanho.toString(), prazoEstendidoMeses: 12 },
  });

  return { ok: true };
}

/**
 * Arquiva tudo que venceu. Chamada pelo temporizador diário do servidor.
 * Devolve o que arquivou para o log — silêncio total esconde tarefa quebrada.
 *
 * NÃO recusa por falta de espaço no cofre, ao contrário do arquivamento manual.
 * A diferença é deliberada: o prazo foi combinado com o casal e prometido pelo
 * fotógrafo. Segurar a galeria no ar por falta de espaço quebraria esse combinado
 * E continuaria consumindo a quota das galerias no ar — dois prejuízos em vez de
 * um. O cofre passa do limite, e quem está acima é devolvido aqui para o log e o
 * aviso; a decisão de apagar algo continua sendo do dono.
 */
export async function arquivarVencidas() {
  const arquivadas = await consultar<{
    id: string;
    titulo: string;
    estudio: string;
    tenant_id: string;
  }>(
    `update galerias g
        set estado = 'arquivada', arquivada_em = now(), atualizado_em = now()
       from tenants t
      where t.id = g.tenant_id
        and g.estado = 'online'
        and g.expira_em is not null
        and g.expira_em < now()
      returning g.id, g.titulo, g.tenant_id, t.nome_estudio as estudio`,
  );

  /*
   * Ator 'sistema', e a diferença não é cosmética: quando o cliente do estúdio
   * reclamar que a galeria saiu do ar, este registro prova que foi o PRAZO que
   * venceu — o mesmo que o fotógrafo escolheu e combinou — e não alguém que
   * apertou um botão. Arquivar por botão vira 'estudio', em `arquivarAgora`.
   */
  if (arquivadas.length > 0) {
    const { registrarEvento, ACOES } = await import("./eventos");
    for (const g of arquivadas) {
      await registrarEvento({
        tenantId: g.tenant_id,
        estudio: g.estudio,
        ator: "sistema",
        acao: ACOES.GALERIA_ARQUIVADA,
        alvoTipo: "galeria",
        alvoId: g.id,
        detalhe: { titulo: g.titulo, manual: false, motivo: "prazo vencido" },
      });
    }
  }

  return arquivadas;
}

/**
 * Quem passou do espaço contratado — para o log da tarefa diária avisar.
 *
 * Conta TUDO (no ar e arquivado) contra a quota única. Chamava-se
 * `estudiosAcimaDoCofre` e olhava só o arquivado contra `quota_cofre_bytes`,
 * que a migração 016 zerou — deixar como estava faria a tarefa diária acusar
 * todo estúdio com uma única galeria arquivada.
 *
 * Estourar não bloqueia nada: só o upload seguinte é recusado. Aqui é aviso
 * para o operador, não punição para o cliente.
 */
export async function estudiosAcimaDoEspaco() {
  return consultar<{
    nome_estudio: string;
    email: string;
    usado: string;
    limite: string;
  }>(
    `select t.nome_estudio, t.email,
            coalesce(sum(m.bytes),0)::text as usado,
            t.quota_bytes::text            as limite
       from tenants t
       join galerias g on g.tenant_id = t.id
       join medias   m on m.galeria_id = g.id
      group by t.id, t.nome_estudio, t.email, t.quota_bytes
     having coalesce(sum(m.bytes),0) > t.quota_bytes`,
  );
}

/**
 * Espaço no ar × espaço no cofre — o fotógrafo vê os dois separados.
 *
 * Delega para `usoDoEstudio` de propósito: antes esta consulta era uma cópia
 * quase igual que contava só `pronto = true`, então a tela mostrava um número e
 * a quota usava outro — e o fotógrafo veria "sobra espaço" no exato momento em
 * que o envio fosse recusado. A tela precisa mostrar o que de fato limita.
 */
export async function usoPorEstado(tenantId: string) {
  return usoDoEstudio(tenantId);
}
