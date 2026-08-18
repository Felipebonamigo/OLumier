import "server-only";
import { montarFatias } from "@/config/socios";

/**
 * Cliente do Asaas — cobrança recorrente com split.
 *
 * Escrito em cima do `fetch` em vez de um SDK: a API é pequena (quatro chamadas)
 * e um SDK a mais significa uma dependência a mais para atualizar.
 *
 * ⚠️ A conta é a MESMA do Atomatiza (decisão do Felipe). Isso significa que
 * clientes dos dois produtos convivem no mesmo painel do Asaas — por isso toda
 * cobrança daqui leva `externalReference` começando com "fotonio:", e o webhook
 * ignora o que não for nosso. Sem isso, um evento do Atomatiza mexeria numa
 * assinatura daqui.
 */

const PREFIXO = "fotonio:";

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
  precoCentavos: number;
  descricao: string;
  primeiroVencimento: Date;
}): Promise<AssinaturaAsaas> {
  const fatias = montarFatias(dados.planoId, dados.precoCentavos);

  return chamar<AssinaturaAsaas>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: dados.clienteAsaasId,
      billingType: "UNDEFINED", // o cliente escolhe entre Pix, boleto ou cartão
      value: dados.precoCentavos / 100,
      nextDueDate: dados.primeiroVencimento.toISOString().slice(0, 10),
      cycle: "MONTHLY",
      description: dados.descricao,
      externalReference: `${PREFIXO}${dados.tenantId}`,
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

/** true se o evento do webhook pertence ao Fotônio (a conta é dividida com o Atomatiza). */
export function eventoEhNosso(referenciaExterna: string | null | undefined): boolean {
  return Boolean(referenciaExterna?.startsWith(PREFIXO));
}

/** Extrai o id do estúdio de uma referência nossa. */
export function tenantDaReferencia(referenciaExterna: string): string {
  return referenciaExterna.slice(PREFIXO.length);
}
