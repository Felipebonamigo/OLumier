import "server-only";
import { consultarUm } from "./db";
import { hashDeIp } from "./ip";
import { soDigitos } from "./documento";
import { ACOES } from "./eventos";

/**
 * AS TRAVAS DO CADASTRO — uma conta de teste por pessoa.
 *
 * O teste grátis dá 10 GB por 14 dias (`config/trial.ts`). Sem trava nenhuma, a
 * mesma pessoa abria uma conta nova a cada vencimento, com outro e-mail, e
 * usava o produto de graça para sempre. Pedido do Felipe em 28/09/2026; ver o
 * cabeçalho de `db/migracoes/045-cadastro-protegido.sql` para as quatro medidas
 * e por que cada uma existe.
 *
 * Aqui moram as duas que decidem se o cadastro PASSA:
 *
 *   1. O CPF/CNPJ é único. É a trava de verdade — trocar de e-mail é de graça,
 *      trocar de CPF não é. O índice parcial no banco segura a corrida entre
 *      dois cadastros simultâneos; esta função existe para a pessoa ler uma
 *      frase em português, e não um erro de restrição.
 *
 *   3. O mesmo IP cria no máximo `LIMITE_CADASTROS_POR_IP` contas por dia. É a
 *      trava contra o robô, não contra a pessoa: quem cria conta de fachada à
 *      mão esbarra no documento antes. O número é baixo o bastante para
 *      atrapalhar um script e alto o bastante para dois sócios, no mesmo
 *      escritório, criarem cada um a sua no mesmo dia.
 *
 * (A 2, confirmar o e-mail, mora em `confirmacao-email.ts`; a 4, apagar o
 * teste abandonado, em `testes-abandonados.ts`.)
 */

/** Contas por IP numa janela. Ver o item 3 acima. */
export const LIMITE_CADASTROS_POR_IP = 3;
export const JANELA_CADASTROS_POR_IP_HORAS = 24;

/**
 * Esse documento já é de outra conta?
 *
 * `excetoTenantId` serve à ativação da assinatura: o estúdio que confirma o
 * PRÓPRIO documento não pode colidir consigo mesmo.
 *
 * Compara só dígitos, que é como a coluna guarda (migração 006). Formatado ou
 * não, "529.982.247-25" e "52998224725" são o mesmo documento.
 */
export async function documentoEmUso(documento: string, excetoTenantId?: string): Promise<boolean> {
  const d = soDigitos(documento);
  if (!d) return false;
  const r = await consultarUm(
    "select 1 from tenants where cpf_cnpj = $1 and ($2::uuid is null or id <> $2::uuid) limit 1",
    [d, excetoTenantId ?? null],
  );
  return Boolean(r);
}

/**
 * Quantas contas este IP criou na janela.
 *
 * Conta os eventos `conta.criada` — que já guardam o IP pseudonimizado desde a
 * migração 014 —, em vez de uma tabela nova só para isto. O evento é gravado
 * por `cadastrarAction` no mesmo instante em que a conta nasce.
 *
 * IP desconhecido não conta nada. Acontece fora de produção (sem o Caddy na
 * frente não há `x-forwarded-for`), e juntar todos os "sem IP" numa conta só
 * faria o terceiro cadastro do dia travar o quarto de qualquer outra pessoa.
 */
export async function cadastrosRecentesDoIp(ip: string | null): Promise<number> {
  if (!ip) return 0;
  const r = await consultarUm<{ n: number }>(
    `select count(*)::int as n from eventos
      where ip_hash = $1 and acao = $2
        and criado_em > now() - ($3 || ' hours')::interval`,
    [hashDeIp(ip), ACOES.CONTA_CRIADA, String(JANELA_CADASTROS_POR_IP_HORAS)],
  );
  return r?.n ?? 0;
}

export async function ipPodeCadastrar(ip: string | null): Promise<boolean> {
  return (await cadastrosRecentesDoIp(ip)) < LIMITE_CADASTROS_POR_IP;
}

/**
 * O erro do banco é a colisão do documento?
 *
 * Duas pessoas (ou duas abas) cadastrando o mesmo CPF no mesmo segundo passam
 * as duas por `documentoEmUso` — e a segunda esbarra no índice único. Sem isto
 * ela veria a tela de erro genérica em vez da frase certa.
 */
export function colisaoDeDocumento(erro: unknown): boolean {
  const e = erro as { code?: string; constraint?: string } | null;
  return e?.code === "23505" && e.constraint === "tenants_cpf_cnpj_unico";
}
