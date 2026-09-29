import "server-only";
import { montarFatias, type FatiaSocio } from "@/config/socios";
import type { Ciclo } from "@/config/planos";
import type { FormaAssinatura } from "@/config/forma-assinatura";
import type { PagamentoDoAsaas } from "./caixa-dos-socios";

/**
 * Traduz uma fatia para o formato do split do Asaas.
 *
 * Duas formas, e a escolha não é de estilo: dividindo o LUCRO o valor é conhecido
 * e vai em `fixedValue`; dividindo a RECEITA ele não é — a taxa depende do meio
 * de pagamento, que o cliente só escolhe depois — e vai em `percentualValue`,
 * para o próprio Asaas aplicar sobre o líquido. O porquê inteiro está em
 * `montarFatias` e em `scripts/testar-split.mjs`.
 */
function montarFatiaAsaas(f: FatiaSocio) {
  return f.percentual !== undefined
    ? { walletId: f.carteira, percentualValue: f.percentual }
    : { walletId: f.carteira, fixedValue: f.centavos / 100 };
}

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
  /* Configurável só para o teste local poder apontar para um servidor de
   * mentira e conferir o que o cliente FAZ com respostas que a API de verdade
   * não devolve sob encomenda — 502 com HTML, corpo vazio, JSON quebrado.
   * Mesmo motivo do `EMAIL_API` em `lib/email.ts`. Em produção a variável não
   * existe e vale a escolha abaixo. */
  const forcado = process.env.ASAAS_API?.trim();
  if (forcado) return forcado;

  // Sandbox por padrão: começar apontando para produção é como testar cobrança
  // com o cartão de alguém.
  return process.env.ASAAS_AMBIENTE === "producao"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

export const asaasConfigurado = () => Boolean(process.env.ASAAS_API_KEY);

export const asaasEmProducao = () => process.env.ASAAS_AMBIENTE === "producao";

/**
 * Um id do Asaas como UM segmento do caminho, nunca mais que isso.
 *
 * Desde o combo (28/09/2026) ids chegam de fora — o `customer` de um evento do
 * webhook — e vão para o caminho de uma chamada com a chave da conta. O `fetch`
 * resolve `..` como um navegador; sem esta guarda, um id forjado trocaria "este
 * cliente" por outra rota da conta inteira. Mesmo remédio do Atomatiza
 * (`segmento`, no `asaas.ts` de lá).
 */
function segmento(id: string): string {
  if (!id || id === "." || id === "..") throw new Error("Asaas: identificador inválido");
  return encodeURIComponent(id);
}

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

  /*
   * O parse vem DEPOIS de admitir que a resposta pode não ser JSON.
   *
   * Até 27/08/2026 esta linha era `texto ? JSON.parse(texto) : {}`, antes de
   * qualquer olhada no status. Uma resposta não-JSON — 502, 429, página de WAF —
   * estourava com "Unexpected token '<'" e DESTRUÍA a única informação que
   * diria o que houve: o status. Aconteceu no ensaio contra o sandbox, e o
   * fotógrafo leria isso na tela.
   */
  let dados: {
    errors?: { description?: string }[];
    [k: string]: unknown;
  } = {};
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      const tipo = r.headers.get("content-type") ?? "sem tipo";
      throw new Error(
        `Asaas: HTTP ${r.status} devolveu algo que não é JSON (${tipo}): ` +
          `${texto.slice(0, 180).replace(/\s+/g, " ").trim()}`,
      );
    }
  }

  if (!r.ok) {
    // O Asaas devolve os problemas numa lista; junta tudo para o log ser útil.
    const detalhe =
      dados?.errors?.map((e: { description?: string }) => e.description).filter(Boolean).join("; ") ||
      `HTTP ${r.status}`;
    throw new Error(`Asaas: ${detalhe}`);
  }
  return dados as T;
}

/*
 * ── A CARTEIRA DA PRÓPRIA CONTA NÃO VAI NO SPLIT (29/09/2026) ────────────
 *
 * Uma cliente de verdade tentou assinar e leu, em vermelho, embaixo do
 * botão: "Asaas: Não é permitido split para sua própria carteira." A conta
 * que cobra é a mesma do Atomatiza, e uma das `ASAAS_CARTEIRA_*` aponta para
 * a carteira DELA. O Asaas recusa a cobrança inteira por causa dessa linha, e
 * nenhuma assinatura nascia.
 *
 * A linha não faz falta: o que não vai no split fica na conta que cobrou, que
 * é exatamente onde essa fatia ia parar. Então a carteira da conta é
 * perguntada ao próprio Asaas (`GET /wallets`) e tirada do split nas três
 * chamadas que o mandam — em vez de depender de alguém lembrar de apagar a
 * variável certa no servidor.
 *
 * Se a pergunta falhar, o split vai como antes: melhor tentar e o Asaas dizer
 * o motivo do que travar toda cobrança por uma consulta auxiliar.
 */
/* Guardada por endereço da API — e não pela chave: trocar a chave em produção
   é trocar o `.env`, que reinicia o processo e esvazia isto de qualquer jeito.
   O endereço é o que muda dentro de um processo, nos testes. */
const carteiraDaConta = new Map<string, string>();

async function carteiraPropria(): Promise<string | null> {
  const conta = base();
  const guardada = carteiraDaConta.get(conta);
  if (guardada) return guardada;
  try {
    const r = await chamar<{ data?: { id?: string }[] }>("/wallets");
    const id = r.data?.[0]?.id?.trim().toLowerCase() || null;
    if (id) carteiraDaConta.set(conta, id);
    return id;
  } catch {
    return null;
  }
}

/** As fatias sem a da própria conta. Pura, para o teste cobrir sem rede. */
export function semACarteiraDaConta(fatias: FatiaSocio[], propria: string | null): FatiaSocio[] {
  if (!propria) return fatias;
  return fatias.filter((f) => f.carteira.trim().toLowerCase() !== propria);
}

/** O split como vai ao Asaas. */
async function splitDoAsaas(fatias: FatiaSocio[]) {
  return semACarteiraDaConta(fatias, await carteiraPropria()).map((f) => montarFatiaAsaas(f));
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
  /** O cliente do Asaas dono da assinatura. */
  customer?: string;
  description?: string | null;
  externalReference?: string | null;
  /** O Asaas devolve a assinatura apagada com este campo — ver `criarAssinatura`. */
  deleted?: boolean;
  /**
   * Aparece só depois de a primeira fatura ser paga com cartão: é a prova de
   * que o Asaas guardou o cartão e vai cobrar sozinho. Nunca traz o número
   * inteiro — só bandeira e os quatro últimos. Ver `lib/cartao-salvo.ts`.
   */
  creditCard?: {
    creditCardNumber?: string | null;
    creditCardBrand?: string | null;
    /** O cartão salvo, reusável numa cobrança avulsa (a diferença da troca de
     *  plano) sem ninguém digitar o número de novo. Nunca é o número. */
    creditCardToken?: string | null;
  } | null;
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
  /** Como o estúdio escolheu pagar. Ver `config/forma-assinatura.ts`. */
  forma: FormaAssinatura;
}): Promise<AssinaturaAsaas> {
  /* O ciclo entra no split porque a reserva de custo depende dele: o anual
   * cobra uma vez e ocupa disco por doze meses. Ver `lucroCentavos`. */
  const referencia = `${PREFIXO}${dados.tenantId}`;

  /*
   * Procura antes de criar — o MESMO padrão de `garantirCliente`, e por um
   * motivo pior que o dele.
   *
   * `criarAssinaturaAction` só grava o `asaas_assinatura_id` DEPOIS que esta
   * função volta. Se a assinatura nasce no Asaas e a resposta se perde no
   * caminho (rede, 502, parse), a ação cai no catch, nada é gravado, e a guarda
   * `if (tenant.asaas_assinatura_id) return` não dispara no clique seguinte: o
   * fotógrafo vê "erro", clica de novo e passa a ter DUAS assinaturas ativas
   * cobrando todo mês. Reproduzido em 27/08/2026 contra o sandbox.
   *
   * A mordida final era o cancelamento: o webhook trata SUBSCRIPTION_DELETED
   * sem olhar QUAL assinatura, então quem percebesse a cobrança dobrada e
   * cancelasse uma perderia o acesso continuando a pagar a outra.
   *
   * Só `ACTIVE` e não apagada conta. Reaproveitar uma assinatura morta seria
   * pior que duplicar: o estúdio pagaria e nunca receberia cobrança, porque a
   * assinatura devolvida não emite mais nada.
   */
  const existentes = await chamar<{ data: AssinaturaAsaas[] }>(
    `/subscriptions?externalReference=${encodeURIComponent(referencia)}`,
  );
  const viva = existentes.data?.find((a) => a.status === "ACTIVE" && !a.deleted);
  if (viva) return viva;

  const fatias = montarFatias(dados.planoId, dados.precoCentavos, dados.ciclo);

  return chamar<AssinaturaAsaas>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: dados.clienteAsaasId,
      /*
       * QUEM ESCOLHE É O ESTÚDIO, e a diferença é grande:
       *
       *   UNDEFINED    a fatura abre com Pix, boleto e cartão lado a lado, e ele
       *                paga cada mês na mão. Era o único jeito até 05/09/2026.
       *   CREDIT_CARD  a primeira fatura pede o cartão, o Asaas GUARDA o cartão,
       *                e as mensalidades seguintes são capturadas sozinhas.
       *
       * Medido no sandbox pelo Atomatiza em 03/09/2026, porque a documentação
       * não responde: criar a assinatura SEM dados de cartão é aceito (200) e a
       * fatura pede o cartão; ao pagar, a assinatura passa a ter `creditCard`
       * com token, e as cobranças seguintes nascem confirmadas sem ninguém abrir
       * fatura nenhuma.
       *
       * Nada de cartão passa por aqui: o número é digitado na página do Asaas, e
       * é isso que mantém o sistema fora do escopo de PCI. Ver
       * `config/forma-assinatura.ts` e a etapa "nenhum dado de cartão viaja na
       * criação" em `scripts/testar-assinatura-recorrente.mjs`.
       */
      billingType: dados.forma,
      value: dados.precoCentavos / 100,
      nextDueDate: dados.primeiroVencimento.toISOString().slice(0, 10),
      cycle: dados.ciclo === "anual" ? "YEARLY" : "MONTHLY",
      description: dados.descricao,
      externalReference: referencia,
      split: await splitDoAsaas(fatias),
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
  /**
   * A cobrança já emitida e não paga acompanha o valor novo? Sim por padrão
   * (troca de plano). O combo desliga quando o preço SOBE: quem cancelou a
   * outra plataforma volta ao preço cheio no ciclo seguinte, não numa fatura
   * que ele já recebeu com outro valor.
   */
  atualizarPendentes?: boolean;
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
      updatePendingPayments: dados.atualizarPendentes ?? true,
      split: await splitDoAsaas(fatias),
    }),
  });
}

// --- combo com o Atomatiza (28/09/2026) ------------------------------------
//
// A conta do Asaas é a mesma dos dois produtos, e é por ela que um enxerga a
// assinatura do outro: o mesmo CPF/CNPJ, um cliente de cada lado. Ver
// `lib/combo.ts`.

export interface ClienteDoDocumento {
  id: string;
  cpfCnpj?: string | null;
  externalReference?: string | null;
  deleted?: boolean;
}

/** Os clientes da conta com este CPF/CNPJ — o nosso e o do Atomatiza. */
export async function clientesDoDocumento(documento: string): Promise<ClienteDoDocumento[]> {
  const r = await chamar<{ data?: ClienteDoDocumento[] }>(
    `/customers?cpfCnpj=${encodeURIComponent(documento)}&limit=100`,
  );
  return (r.data ?? []).filter((c) => !c.deleted);
}

export async function buscarCliente(clienteId: string): Promise<ClienteDoDocumento> {
  return chamar<ClienteDoDocumento>(`/customers/${segmento(clienteId)}`);
}

export async function assinaturasDoCliente(clienteId: string): Promise<AssinaturaAsaas[]> {
  const r = await chamar<{ data?: AssinaturaAsaas[] }>(
    `/subscriptions?customer=${encodeURIComponent(clienteId)}&limit=100`,
  );
  return r.data ?? [];
}

/** A assinatura tem cobrança vencida e não paga? */
export async function temCobrancaVencida(assinaturaId: string): Promise<boolean> {
  const r = await chamar<{ data?: unknown[] }>(
    `/subscriptions/${segmento(assinaturaId)}/payments?status=OVERDUE&limit=1`,
  );
  return (r.data?.length ?? 0) > 0;
}

/** Os estados de cobrança em que o dinheiro entrou (cartão, Pix/boleto, em mãos). */
const PAGAS = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/**
 * A assinatura já foi paga alguma vez?
 *
 * Uma chamada sem filtro de estado, e não três (uma por estado pago): as
 * primeiras cem cobranças bastam — assinatura que não pagou nenhuma em cem
 * ciclos já teria sido cancelada muito antes.
 */
export async function temCobrancaPaga(assinaturaId: string): Promise<boolean> {
  const r = await chamar<{ data?: { status?: string }[] }>(
    `/subscriptions/${segmento(assinaturaId)}/payments?limit=100`,
  );
  return (r.data ?? []).some((c) => PAGAS.has(c.status ?? ""));
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

/** true se o evento do webhook pertence à Galeria Átomo (a conta é dividida com o Atomatiza). */
export function eventoEhNosso(referenciaExterna: string | null | undefined): boolean {
  return Boolean(referenciaExterna?.startsWith(PREFIXO));
}

/**
 * Extrai o id do estúdio de uma referência nossa.
 *
 * A mensalidade leva `olumier:<estúdio>`; a cobrança da diferença de uma troca
 * de plano leva `olumier:<estúdio>:diferenca:<quando>` (ver
 * `referenciaDaDiferenca`). O id é sempre o segundo pedaço — um uuid não tem
 * dois-pontos.
 */
export function tenantDaReferencia(referenciaExterna: string): string {
  return referenciaExterna.slice(PREFIXO.length).split(":")[0];
}

/**
 * De que é a cobrança: a mensalidade da assinatura, ou a diferença de uma
 * troca de plano. O webhook trata as duas de jeitos diferentes — a diferença
 * NÃO renova o período pago; se renovasse, pagar R$ 20 de diferença daria um
 * mês (ou um ano, no anual) inteiro de serviço a partir daquele dia.
 */
export function tipoDaReferencia(referenciaExterna: string): "assinatura" | "diferenca" {
  return referenciaExterna.slice(PREFIXO.length).split(":")[1] === "diferenca" ? "diferenca" : "assinatura";
}

export const referenciaDaDiferenca = (tenantId: string, quando: Date = new Date()) =>
  `${PREFIXO}${tenantId}:diferenca:${quando.getTime()}`;

// --- a diferença da troca de plano (28/09/2026) -----------------------------
//
// Ver `config/troca-de-plano.ts` para a regra e `lib/troca-de-plano.ts` para o
// fluxo.

export interface CobrancaAsaas {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl?: string | null;
  externalReference?: string | null;
  description?: string | null;
}

/** As faturas da assinatura ainda não pagas — a vencer e vencidas. */
export async function cobrancasEmAberto(assinaturaId: string): Promise<CobrancaAsaas[]> {
  const id = segmento(assinaturaId);
  const [pendentes, vencidas] = await Promise.all([
    chamar<{ data?: CobrancaAsaas[] }>(`/subscriptions/${id}/payments?status=PENDING&limit=100`),
    chamar<{ data?: CobrancaAsaas[] }>(`/subscriptions/${id}/payments?status=OVERDUE&limit=100`),
  ]);
  return [...(pendentes.data ?? []), ...(vencidas.data ?? [])];
}

/**
 * Uma cobrança avulsa — a diferença da troca de plano.
 *
 * Com `cartao`, é capturada na hora no cartão que a assinatura já guardou
 * (`creditCardToken`), com o IP de quem clicou — o Asaas exige o IP do
 * pagador, nunca o do servidor. Sem cartão, vira fatura com Pix, boleto e
 * cartão lado a lado, como a mensalidade de quem paga na mão.
 *
 * O split viaja na cobrança, como na assinatura: os sócios recebem a parte
 * deles da diferença no mesmo pagamento.
 */
export async function criarCobrancaAvulsa(dados: {
  clienteAsaasId: string;
  centavos: number;
  vencimento: string;
  descricao: string;
  referencia: string;
  fatias: FatiaSocio[];
  cartao?: { token: string; ip: string } | null;
}): Promise<CobrancaAsaas> {
  const split = await splitDoAsaas(dados.fatias);
  return chamar<CobrancaAsaas>("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: dados.clienteAsaasId,
      billingType: dados.cartao ? "CREDIT_CARD" : "UNDEFINED",
      value: dados.centavos / 100,
      dueDate: dados.vencimento,
      description: dados.descricao,
      externalReference: dados.referencia,
      ...(dados.cartao ? { creditCardToken: dados.cartao.token, remoteIp: dados.cartao.ip } : {}),
      split: split.length ? split : undefined,
    }),
  });
}

/** A fatura de diferença que ainda espera pagamento, se houver — para a Conta. */
export async function diferencaEmAberto(clienteAsaasId: string): Promise<CobrancaAsaas | null> {
  const r = await chamar<{ data?: CobrancaAsaas[] }>(
    `/payments?customer=${encodeURIComponent(clienteAsaasId)}&status=PENDING&limit=100`,
  );
  return (r.data ?? []).find((c) => c.externalReference?.startsWith(PREFIXO) &&
    tipoDaReferencia(c.externalReference) === "diferenca") ?? null;
}

// --- o caixa dos sócios (29/09/2026) ----------------------------------------
//
// Leitura só: os pagamentos da conta inteira, dos DOIS produtos. Ver
// `lib/caixa-dos-socios.ts` para o que se faz com eles.

/** Páginas de 100 (o máximo do Asaas). Trinta páginas são 3.000 pagamentos num mês. */
const PAGINAS_DO_CAIXA = 30;

async function listarTodos(filtros: Record<string, string>): Promise<{
  pagamentos: PagamentoDoAsaas[];
  incompleto: boolean;
}> {
  const pagamentos: PagamentoDoAsaas[] = [];
  for (let pagina = 0; pagina < PAGINAS_DO_CAIXA; pagina++) {
    const q = new URLSearchParams({ ...filtros, limit: "100", offset: String(pagina * 100) });
    const r = await chamar<{ data?: PagamentoDoAsaas[]; hasMore?: boolean }>(`/payments?${q}`);
    pagamentos.push(...(r.data ?? []));
    if (!r.hasMore) return { pagamentos, incompleto: false };
  }
  return { pagamentos, incompleto: true };
}

/**
 * O que CAIU na conta entre duas datas (`paymentDate`, "AAAA-MM-DD").
 *
 * Pix e boleto caem no dia em que o cliente paga; cartão, quando o Asaas
 * libera. O que foi pago no cartão e ainda não caiu está em `pagamentosAReceber`.
 */
export function pagamentosRecebidos(de: string, ate: string) {
  return listarTodos({ "paymentDate[ge]": de, "paymentDate[le]": ate });
}

/** Cartão aprovado, esperando o Asaas liberar. */
export function pagamentosAReceber() {
  return listarTodos({ status: "CONFIRMED" });
}
