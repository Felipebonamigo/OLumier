import "server-only";
import { consultar } from "./db";
import { hashDeIp } from "./ip";

/**
 * AUDITORIA — quem fez o quê, e quando.
 *
 * Existe por um motivo concreto: numa disputa, o fotógrafo dirá "o sistema
 * apagou minhas fotos". A diferença entre pagar e não pagar é conseguir mostrar
 * que às 14h32 do dia 3 foi a conta DELE que clicou em apagar. Sem registro, a
 * palavra dele vale tanto quanto a nossa — e o ônus de provar diligência é de
 * quem opera o serviço.
 *
 * Três propriedades sustentam isso, e cada uma tem teste em
 * `scripts/testar-auditoria.mjs`:
 *
 *  1. SOBREVIVE AO QUE REGISTRA — sem chave estrangeira, e com o que importa
 *     copiado dentro de `detalhe`. Evento que morre junto com a galeria apagada
 *     não é evidência de nada.
 *  2. NÃO SE REESCREVE — o banco recusa update e delete, por gatilho.
 *  3. NUNCA DERRUBA A AÇÃO — falha ao registrar é engolida. Um log que impede
 *     o usuário de trabalhar vira o incidente que ele deveria documentar.
 */

/**
 * As ações registradas. Constantes em vez de texto solto porque o valor vai
 * para o banco e é consultado depois: um erro de digitação criaria uma ação
 * nova, silenciosa, que nenhuma busca encontraria.
 *
 * A lista cobre o que alguém pode QUESTIONAR depois — destruição, dinheiro e
 * acesso. Não é telemetria de uso: registrar cada clique encheria a tabela e
 * afogaria justamente os eventos que importam.
 */
export const ACOES = {
  GALERIA_APAGADA: "galeria.apagada",
  GALERIA_RESTAURADA: "galeria.restaurada",
  GALERIA_DESTRUIDA: "galeria.destruida",
  GALERIA_ARQUIVADA: "galeria.arquivada",
  GALERIA_REATIVADA: "galeria.reativada",
  MEDIA_APAGADA: "media.apagada",
  PLANO_TROCADO: "plano.trocado",
  ASSINATURA_CANCELADA: "assinatura.cancelada",
  SENHA_TROCADA: "senha.trocada",
  CONTA_CRIADA: "conta.criada",
  /* O teste abandonado (migração 045): os dois avisos e a limpeza. É o único
   * lugar em que o SISTEMA apaga arquivo sem o fotógrafo ter pedido, e numa
   * disputa a pergunta vai ser "fui avisado? quando?". */
  AVISO_LIMPEZA_ENVIADO: "conta.aviso_limpeza",
  ARQUIVOS_DO_TESTE_APAGADOS: "conta.arquivos_apagados",
  /* Consentimento para dado biométrico (LGPD art. 11): ligar é o aceite, e o
   * registro é a prova de quando; desligar apaga os vetores e o registro diz
   * quantos. Sem isto, "quando o estúdio consentiu?" não teria resposta. */
  ROSTOS_LIGADOS: "rostos.ligados",
  ROSTOS_DESLIGADOS: "rostos.desligados",
  /* A foto da página inicial trocada pelo admin (migração 043). É a vitrine
   * pública da plataforma: "quem pôs essa foto aí, e quando?" precisa de
   * resposta, e a foto do lugar anterior é apagada do bucket na troca. */
  HOME_FOTO_TROCADA: "home.foto.trocada",
  HOME_FOTO_RESTAURADA: "home.foto.restaurada",
  /* O preço da assinatura mudou por causa do combo com o Atomatiza (entrou,
   * saiu ou trocou de faixa). É dinheiro mudando sem o estúdio apertar nada —
   * "por que a minha mensalidade mudou?" precisa de resposta com data. */
  COMBO_RECALCULADO: "assinatura.combo",
  /* Um aviso do Asaas sobre a cobrança da DIFERENÇA de uma troca de plano
   * (paga, vencida, cancelada, estornada). Ela não mexe no período pago —
   * então, sem este registro, não sobraria rastro dela aqui. */
  DIFERENCA_DA_TROCA: "assinatura.diferenca",
  /* Um custo da sociedade criado, mudado ou apagado no caixa dos sócios
   * (migração 047). A lista decide o resultado do mês que os três sócios
   * leem — "quem mudou o custo do VPS?" precisa de resposta. */
  CUSTO_DA_SOCIEDADE: "sociedade.custo",
  /* Aqui havia `ESPELHO_PURGADO: "espelho.purgado"`, removido em 27/08/2026
   * junto com o espelho. Antes de tirar, foi conferido que nenhum dos dois
   * bancos tinha uma linha com essa ação — se tivesse, o nome ficaria, porque
   * evento de auditoria sem nome vira texto órfão na tela do estúdio. */
} as const;

export type Acao = (typeof ACOES)[keyof typeof ACOES];
export type Ator = "estudio" | "sistema" | "cliente";

export interface Evento {
  id: string;
  tenant_id: string | null;
  estudio: string | null;
  ator: Ator;
  acao: string;
  alvo_tipo: string | null;
  alvo_id: string | null;
  detalhe: Record<string, unknown>;
  criado_em: Date;
}

/*
 * O hash de IP mora em `./ip`, e é a MESMA função que a tabela `acessos` usa.
 *
 * Havia uma cópia aqui, com este mesmo comentário afirmando que era igual à de
 * lá — e não era: ela lia `SESSAO_SEGREDO ?? "sem-segredo"`, uma variável que
 * nunca existiu em ambiente nenhum. O sal era sempre a string do código, e as
 * duas tabelas nunca casaram. Ver o cabeçalho de `lib/ip.ts`.
 */

export interface DadosEvento {
  tenantId?: string | null;
  estudio?: string | null;
  ator: Ator;
  acao: string;
  alvoTipo?: string | null;
  alvoId?: string | null;
  /** O que faz o evento ser legível quando o alvo não existir mais. */
  detalhe?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Registra um evento. NUNCA lança.
 *
 * O `catch` vazio é deliberado e é a regra mais importante deste módulo: quem
 * chama está no caminho do usuário — apagando uma galeria, trocando um plano.
 * Se o log derrubasse a ação, uma tabela cheia ou um índice corrompido
 * impediriam o fotógrafo de trabalhar, e o registro de segurança viraria a
 * causa do incidente. Perder um evento é ruim; travar a operação é pior.
 */
export async function registrarEvento(dados: DadosEvento): Promise<void> {
  try {
    await consultar(
      `insert into eventos (tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, ip_hash)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        dados.tenantId ?? null,
        dados.estudio ?? null,
        dados.ator,
        dados.acao,
        dados.alvoTipo ?? null,
        dados.alvoId ?? null,
        JSON.stringify(dados.detalhe ?? {}),
        dados.ip ? hashDeIp(dados.ip) : null,
      ],
    );
  } catch (e) {
    // Registrado no log do servidor para não sumir de vez, mas sem propagar.
    console.error("[auditoria] não consegui registrar o evento:", e);
  }
}

/** O histórico de um estúdio, do mais recente para o mais antigo. */
export async function eventosDoEstudio(tenantId: string, limite = 200) {
  return consultar<Evento>(
    `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
       from eventos
      where tenant_id = $1
      order by id desc
      limit $2`,
    [tenantId, limite],
  );
}

/**
 * Tudo que aconteceu com um alvo — inclusive depois de ele deixar de existir.
 *
 * É esta a consulta de uma disputa: "o que aconteceu com a galeria X?", feita
 * quando a galeria X já foi destruída e não há mais o que consultar nela.
 */
export async function eventosDoAlvo(alvoId: string) {
  return consultar<Evento>(
    `select id, tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe, criado_em
       from eventos
      where alvo_id = $1
      order by id desc`,
    [alvoId],
  );
}
