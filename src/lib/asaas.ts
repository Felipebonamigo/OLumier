import "server-only";
import { montarFatias } from "@/config/socios";
import type { Ciclo } from "@/config/planos";

/**
 * Cliente do Asaas — cobrança recorrente com split.
 *
 * Escrito em cima do `fetch` em vez de um SDK: a API é pequena (quatro chamadas)
 * e um SDK a mais significa uma dependência a mais para atualizar.
 *
 * ⚠️ A conta é a MESMA do Atomatiza (decisão do Felipe). Isso significa que
 * clientes dos dois produtos convivem no mesmo painel do Asaas — por isso toda
 * cobrança daqui leva `externalReference` começando com "olumier:", e o webhook
 * ignora o que não for nosso. Sem isso, um evento do Atomatiza mexeria numa
 * assinatura daqui.
 */

const PREFIXO = "olumier:";

function base(): string {
  // Sandbox por padrão: começar apontando para produção é como testar cobrança
  // com o cartão de alguém.
  return process.env.ASAAS_AMBIENTE === "producao"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

export const asaasConfigurado = () => Boolean(process.env.ASAAS_API_KEY);

export const asaasEmProducao = () => process.env.ASAAS_AMBIENTE === "producao";

async function chamar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) throw new Error("ASAAS_API_KEY não configurada");

  const r = await fetch(`${base()}${caminho}`, {
    ...opcoes,
    headers: {
      "Content-Type": "application/json",
      access_token: chave,
      ...opcoes.headers,
    },
    cache: "no-store",
  });

  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : {};

  if (!r.ok) {
    // O Asaas devolve os problemas numa lista; junta tudo para o log ser útil.
    const detalhe =
      dados?.errors?.map((e: { description?: string }) => e.description).filter(Boolean).join("; ") ||
      `HTTP ${r.status}`;
    throw new Error(`Asaas: ${detalhe}`);
  }
  return dados as T;
}

// --- cliente ----------------------------------------------------------------

export interface ClienteAsaas {
  id: string;
  name: string;
  email: string;
}

/**
 * Cria ou reaproveita o cliente no Asaas.
 * Busca por `externalReference` primeiro: sem isso, cada nova assinatura criaria
 * um cliente duplicado e o painel do Asaas viraria uma bagunça.
 */
export async function garantirCliente(dados: {
  tenantId: string;
  nome: string;
  email: string;
  cpfCnpj?: string;
}): Promise<ClienteAsaas> {
  const referencia = `${PREFIXO}${dados.tenantId}`;

  const busca = await chamar<{ data: ClienteAsaas[] }>(
    `/customers?externalReference=${encodeURIComponent(referencia)}`,
  );
  if (busca.data?.length > 0) return busca.data[0];

  return chamar<ClienteAsaas>("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: dados.nome,
      email: dados.email,
      cpfCnpj: dados.cpfCnpj,
      externalReference: referencia,
    }),
  });
}

// --- assinatura -------------------------------------------------------------

export interface AssinaturaAsaas {
  id: string;
  status: string;
  nextDueDate: string;
  value: number;
}

/**
 * Cria a assinatura mensal já com o split configurado.
 *
 * O split manda embora APENAS o lucro de cada sócio; o que sobra fica na conta
 * principal e é a reserva que paga Cloudflare, Backblaze e VPS. Ou seja: o
 * Felipe nunca precisa separar custo de lucro na mão.
 */
export async function criarAssinatura(dados: {
  clienteAsaasId: string;
  tenantId: string;
  planoId: string;
  /** Já é o preço DO CICLO — mensal ou dez meses, conforme `ciclo`. */
  precoCentavos: number;
  ciclo: Ciclo;
  descricao: string;
  primeiroVencimento: Date;
}): Promise<AssinaturaAsaas> {
  /* O ciclo entra no split porque a reserva de custo depende dele: o anual
   * cobra uma vez e ocupa disco por doze meses. Ver `lucroCentavos`. */
  const fatias = montarFatias(dados.planoId, dados.precoCentavos, dados.ciclo);

  return chamar<AssinaturaAsaas>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: dados.clienteAsaasId,
      billingType: "UNDEFINED", // o cliente escolhe entre Pix, boleto ou cartão
      value: dados.precoCentavos / 100,
      nextDueDate: dados.primeiroVencimento.toISOString().slice(0, 10),
      cycle: dados.ciclo === "anual" ? "YEARLY" : "MONTHLY",
      description: dados.descricao,
      externalReference: `${PREFIXO}${dados.tenantId}`,
      split: fatias.map((f) => ({
        walletId: f.carteira,
        fixedValue: f.centavos / 100,
      })),
    }),
  });
}

/**
 * Troca o valor da assinatura quando o estúdio muda de plano.
 *
 * Recalcula o split junto — e isso importa: o split é gravado na assinatura no
 * momento em que ela nasce, então uma assinatura criada quando os sócios ainda
 * não tinham carteira ficaria sem divisão para sempre. Passar por aqui é o que
 * traz essa assinatura de volta para a regra atual.
 *
 * `updatePendingPayments` faz a cobrança já emitida e não paga acompanhar o
 * novo valor. Sem isso, quem sobe de plano hoje pagaria o preço antigo neste
 * mês e o novo só no seguinte — e quem desce pagaria caro por mais um ciclo.
 */
export async function atualizarAssinatura(dados: {
  assinaturaId: string;
  planoId: string;
  precoCentavos: number;
  /** O ciclo da assinatura que já existe — trocar de ciclo NÃO passa por aqui. */
  ciclo: Ciclo;
  descricao: string;
}): Promise<AssinaturaAsaas> {
  /* Mesmo motivo de `criarAssinatura`: sem o ciclo, uma troca de plano dentro do
   * anual recalcularia o split com reserva de um mês e mandaria embora o
   * dinheiro dos outros onze. */
  const fatias = montarFatias(dados.planoId, dados.precoCentavos, dados.ciclo);

  return chamar<AssinaturaAsaas>(`/subscriptions/${dados.assinaturaId}`, {
    method: "PUT",
    body: JSON.stringify({
      value: dados.precoCentavos / 100,
      description: dados.descricao,
      updatePendingPayments: true,
      split: fatias.map((f) => ({
        walletId: f.carteira,
        fixedValue: f.centavos / 100,
      })),
    }),
  });
}

export async function cancelarAssinatura(assinaturaId: string) {
  return chamar(`/subscriptions/${assinaturaId}`, { method: "DELETE" });
}

export async function buscarAssinatura(assinaturaId: string) {
  return chamar<AssinaturaAsaas>(`/subscriptions/${assinaturaId}`);
}

/** Link de pagamento da cobrança em aberto, para mostrar ao fotógrafo. */
export async function proximaCobranca(assinaturaId: string) {
  const r = await chamar<{
    data: { id: string; status: string; dueDate: string; invoiceUrl: string; value: number }[];
  }>(`/subscriptions/${assinaturaId}/payments?status=PENDING&limit=1`);
  return r.data?.[0] ?? null;
}

/** true se o evento do webhook pertence ao Galeria Átomo (a conta é dividida com o Atomatiza). */
export function eventoEhNosso(referenciaExterna: string | null | undefined): boolean {
  return Boolean(referenciaExterna?.startsWith(PREFIXO));
}

/** Extrai o id do estúdio de uma referência nossa. */
export function tenantDaReferencia(referenciaExterna: string): string {
  return referenciaExterna.slice(PREFIXO.length);
}
