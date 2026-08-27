/**
 * O TETO DO PERÍODO DE TESTE.
 *
 * O cadastro grava a quota do PLANO ESCOLHIDO e o trial nasce sem cartão. Sem
 * teto, quem escolhesse 10 TB no cadastro ganhava 10 TB de quota por 14 dias
 * sem pagar — e 10 TB cheios custam R$ 458,73/mês de B2+R2 pela nossa própria
 * planilha (`custoArmazenamentoCentavos`). O prejuízo não acabava com o trial:
 * vencido, o envio trava mas os bytes ficam guardados, custando todo mês.
 *
 * A regra é REGRA, não estado: nada é gravado no banco. Enquanto o status for
 * `trial`, a quota efetiva é `min(quota do plano, teto)`; no dia em que o
 * pagamento confirmar (`status = 'ativo'`), o teto some sozinho — sem webhook
 * reescrevendo quota, sem migração, sem estado para dessincronizar.
 *
 * 10 GB porque ainda cabe um casamento inteiro de FOTOS — uma cobertura típica
 * dá 500 a 800 arquivos de ~8 MB, algo entre 4 e 6 GB — então o produto se prova
 * no uso real, e o pior caso por trial abandonado cai para ~R$ 0,46/mês
 * (10 GB × R$ 0,0459). Era 25 GB até 27/08/2026.
 *
 * Mora em `config/` (e não em `lib/tenants`, que é server-only) porque a tela
 * da conta também precisa MOSTRAR o número certo: dizer "10 TB" e travar em
 * 25 GB leria como defeito, não como regra.
 *
 * `scripts/testar-teto-trial.mjs` prende a regra, a fiação nas quatro rotas de
 * envio e a recusa de ponta a ponta.
 */

const GB = BigInt(1024) ** BigInt(3);

export const TETO_TRIAL_GB = 10;
export const TETO_TRIAL_BYTES = BigInt(TETO_TRIAL_GB) * GB;

/**
 * A quota que VALE para este tenant, agora.
 *
 * Só o `trial` é rebaixado. Status desconhecido fica com a quota inteira de
 * propósito — é a mesma regra do portão de cobrança: um estado que ninguém
 * previu não pode travar quem está pagando.
 */
export function quotaEfetivaBytes(t: { status: string; quota_bytes: string }): bigint {
  const doPlano = BigInt(t.quota_bytes);
  if (t.status !== "trial") return doPlano;
  return doPlano < TETO_TRIAL_BYTES ? doPlano : TETO_TRIAL_BYTES;
}
