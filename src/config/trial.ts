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

/**
 * Quantos dias a entrega continua no ar depois que o teste vence.
 *
 * O teto acima limita QUANTO cada trial abandonado custa; ele não limita POR
 * QUANTO TEMPO, e até 27/08/2026 a resposta era "para sempre" — galeria
 * publicada de um teste de 14 dias seguia servida indefinidamente.
 *
 * 15 dias porque o casal do fotógrafo não tem culpa da decisão dele: quem já
 * recebeu o link precisa de uma janela real para baixar as fotos depois que o
 * estúdio some. Menos que isso pune o convidado; muito mais devolve o "para
 * sempre" com outro nome.
 *
 * NADA é apagado quando o prazo acaba — a galeria só deixa de abrir. Pagar
 * devolve na hora. Ver `galeriasNoAr` em `lib/assinatura.ts`.
 */
export const CARENCIA_POS_TRIAL_DIAS = 15;
export const TETO_TRIAL_BYTES = BigInt(TETO_TRIAL_GB) * GB;

/**
 * ── CORTESIA NÃO TEM LIMITE DE ESPAÇO (16/09/2026) ────────────────────────
 *
 * Felipe: "o da Sirius e da Carol não tem vencimento, pode deixar ilimitado".
 * Cortesia é o status das contas dos SÓCIOS (migração 032), e o custo do que
 * elas guardam é cobrado por fora — o admin mostra quanto
 * (`custoMensalDoEstudioCentavos`).
 *
 * É REGRA, como o teto do trial, e não um número grande gravado no banco: a
 * troca de plano e o `sincronizar-quotas` regravam `quota_bytes`, e o limite
 * voltaria sem ninguém perceber.
 */
export function espacoSemLimite(t: { status: string }): boolean {
  return t.status === "cortesia";
}

/**
 * O "sem limite" em bytes, para as contas de envio continuarem sendo uma
 * comparação só (`usado + novo > quota`). 4 EiB: nenhum envio chega perto, e
 * cabe com folga num bigint. Tela nenhuma deve mostrar este número — elas
 * perguntam `espacoSemLimite` e dizem "sem limite".
 */
export const SEM_LIMITE_BYTES = BigInt(2) ** BigInt(62);

/**
 * A quota que VALE para este tenant, agora.
 *
 * Só o `trial` é rebaixado, e só a `cortesia` fica sem limite. Status
 * desconhecido fica com a quota inteira de propósito — é a mesma regra do
 * portão de cobrança: um estado que ninguém previu não pode travar quem está
 * pagando.
 */
export function quotaEfetivaBytes(t: { status: string; quota_bytes: string }): bigint {
  if (espacoSemLimite(t)) return SEM_LIMITE_BYTES;
  const doPlano = BigInt(t.quota_bytes);
  if (t.status !== "trial") return doPlano;
  return doPlano < TETO_TRIAL_BYTES ? doPlano : TETO_TRIAL_BYTES;
}
