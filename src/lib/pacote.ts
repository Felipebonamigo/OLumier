import "server-only";
import { consultar, consultarUm } from "@/lib/db";
import { marca } from "@/config/marca";
import { cicloDe, espacoValido, idDaMontagem, planoPorId, type Ciclo } from "@/config/planos";
import { ehFaixaAtomatiza, MARCA_DO_PACOTE, type FaixaAtomatiza } from "@/config/combo";
import { buscarAssinatura, trocarDescricaoDaAssinatura } from "@/lib/asaas";
import { ESCOLHA_CARTAO, formaDaAssinatura } from "@/config/forma-assinatura";
import { VERSOES_LEGAIS } from "@/config/documentos-legais";
import { conferirDocumento, soDigitos } from "@/lib/documento";
import { assinarTenant } from "@/lib/assinar";
import { recalcularCombo } from "@/lib/combo";
import { buscarTenantPorId, criarTenant, emailJaUsado } from "@/lib/tenants";
import { trocarPlano } from "@/lib/troca-de-plano";
import { criarPedido } from "@/lib/recuperacao";
import { enviarEmail, moldura } from "@/lib/email";
import { registrarEvento, ACOES } from "@/lib/eventos";
import { hashDeEmail } from "@/lib/ip";
import { segredoDaPonte, URL_ATOMATIZA } from "@/lib/ponte-atomatiza";

/**
 * O PACOTE GALERIA ÁTOMO + ATOMATIZA — o lado da Galeria.
 *
 * O contrato inteiro está em `docs/pacote.md`, igual nos dois repositórios.
 * Aqui mora o que ele pede deste lado:
 *
 *   · `situacaoDaConta` — responde ao Atomatiza "este CPF/CNPJ tem conta aqui?"
 *     (`/api/ponte/situacao`), só pelo banco;
 *   · `receberAssinatura` — cria a conta (se preciso) e a assinatura daqui a
 *     pedido do Atomatiza (`/api/ponte/assinar`);
 *   · `situacaoNoAtomatiza` / `assinarNoAtomatiza` — as mesmas perguntas, no
 *     sentido contrário;
 *   · `assinarPacote` / `acrescentarAtomatiza` — os dois botões da Conta.
 *
 * Quem é a mesma pessoa: SÓ o CPF/CNPJ (Felipe, 30/09/2026: "vamos manter por
 * documento, por segurança"). O e-mail só trava: a conta que já existe do
 * outro lado só é usada se o e-mail dela for o de quem está assinando.
 */

// --- o formato da ponte ------------------------------------------------------

export type StatusNaPonte = "ativa" | "pendente" | "atrasada";

export interface SituacaoNaPonte {
  conta: boolean;
  emailMascarado: string | null;
  assinatura: null | {
    status: StatusNaPonte;
    plano: { gb?: number; faixa?: FaixaAtomatiza };
    ciclo: Ciclo;
  };
}

export interface PedidoDeAssinatura {
  documento: string;
  email: string;
  nome: string;
  plano: { gb?: number; faixa?: FaixaAtomatiza };
  ciclo: Ciclo;
  forma: "cartao" | "fatura";
  /** AAAA-MM-DD. */
  vencimento: string;
  pacote: boolean;
  parceiro: { gb?: number; faixa?: FaixaAtomatiza };
  aceitouTermos: boolean;
}

export type CodigoDaPonte = "conta_de_outro_email" | "email_em_uso" | "ja_assina";

export type RespostaDeAssinatura =
  | { ok: true; contaNova: boolean; valorCentavos: number; faturaUrl: string | null }
  | { ok: false; status: number; erro: string; codigo?: CodigoDaPonte };

const SEM_CONTA: SituacaoNaPonte = { conta: false, emailMascarado: null, assinatura: null };

/**
 * "bi•••@gmail.com": o bastante para a pessoa reconhecer o próprio e-mail, e
 * pouco para a tela do outro sistema virar vitrine do endereço de alguém.
 */
export function mascararEmail(email: string): string {
  const [nome, dominio] = email.trim().toLowerCase().split("@");
  if (!nome || !dominio) return "•••";
  return `${nome.slice(0, Math.min(2, nome.length))}•••@${dominio}`;
}

const mesmoEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Os gigas de um plano, para a ponte: o da grade vem no id; o antigo, na quota. */
function gbDoPlano(planoId: string): number | null {
  const partes = planoId.split(":");
  if (partes.length === 3 && partes[0] === "g") return Number(partes[2]) || null;
  return planoPorId(planoId)?.quotaGb ?? null;
}

// --- o Atomatiza pergunta ----------------------------------------------------

interface ContaNaPonte {
  id: string;
  email: string;
  status: string;
  plano_id: string;
  ciclo_cobranca: string | null;
  asaas_assinatura_id: string | null;
  pago_ate: Date | null;
}

async function contaDoDocumento(documento: string): Promise<ContaNaPonte | null> {
  return consultarUm<ContaNaPonte>(
    `select id, email, status, plano_id, ciclo_cobranca, asaas_assinatura_id, pago_ate
       from tenants where cpf_cnpj = $1
      order by criado_em limit 1`,
    [documento],
  );
}

/** A situação daqui, pelo banco — é para desenhar a tela de lá, sem Asaas. */
export async function situacaoDaConta(documentoBruto: unknown): Promise<SituacaoNaPonte> {
  const documento = soDigitos(String(documentoBruto ?? ""));
  if (conferirDocumento(documento)) return SEM_CONTA;
  const t = await contaDoDocumento(documento);
  if (!t) return SEM_CONTA;

  let assinatura: SituacaoNaPonte["assinatura"] = null;
  if (t.asaas_assinatura_id && t.status !== "cancelado") {
    const status: StatusNaPonte =
      t.status === "inadimplente" ? "atrasada" : t.status === "ativo" && t.pago_ate ? "ativa" : "pendente";
    const gb = gbDoPlano(t.plano_id);
    assinatura = { status, plano: gb ? { gb } : {}, ciclo: cicloDe(t.ciclo_cobranca) };
  }
  return { conta: true, emailMascarado: mascararEmail(t.email), assinatura };
}

/** Lê e confere o pedido da ponte. Devolve o pedido limpo ou a frase do erro. */
export function lerPedido(corpo: unknown): PedidoDeAssinatura | string {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const documento = soDigitos(String(c.documento ?? ""));
  const problema = conferirDocumento(documento);
  if (problema) return problema;

  const email = String(c.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "E-mail inválido.";
  const nome = String(c.nome ?? "").trim().slice(0, 80);
  if (!nome) return "Falta o nome do estúdio.";

  const plano = (c.plano ?? {}) as Record<string, unknown>;
  const gb = Number(plano.gb);
  if (!espacoValido(gb)) return "Tamanho de Galeria inválido.";

  if (c.ciclo !== "mensal" && c.ciclo !== "anual") return "Ciclo inválido.";
  if (c.forma !== "cartao" && c.forma !== "fatura") return "Forma de pagamento inválida.";
  const vencimento = String(c.vencimento ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || Number.isNaN(Date.parse(`${vencimento}T12:00:00Z`))) {
    return "Vencimento inválido.";
  }

  const pacote = c.pacote === true;
  const parceiro = (c.parceiro ?? {}) as Record<string, unknown>;
  if (pacote && !ehFaixaAtomatiza(parceiro.faixa)) return "Faixa do Atomatiza inválida.";

  return {
    documento,
    email,
    nome,
    plano: { gb },
    ciclo: c.ciclo,
    forma: c.forma,
    vencimento,
    pacote,
    parceiro: ehFaixaAtomatiza(parceiro.faixa) ? { faixa: parceiro.faixa } : {},
    aceitouTermos: c.aceitouTermos === true,
  };
}

/**
 * O Atomatiza pede a assinatura daqui (`docs/pacote.md`, "Regras de quem
 * recebe"). O preço sai sempre da NOSSA tabela: do pedido, só vem QUAL plano.
 */
export async function receberAssinatura(pedido: PedidoDeAssinatura): Promise<RespostaDeAssinatura> {
  const planoId = idDaMontagem({ segmento: "foto", espacoGb: pedido.plano.gb! });
  let conta = await contaDoDocumento(pedido.documento);
  let contaNova = false;

  if (conta) {
    if (!mesmoEmail(conta.email, pedido.email)) {
      return {
        ok: false,
        status: 409,
        codigo: "conta_de_outro_email",
        erro:
          "Este CPF/CNPJ já tem conta na Galeria Átomo com outro e-mail. Entre por lá para assinar — " +
          "o desconto do combo entra do mesmo jeito.",
      };
    }
    if (conta.asaas_assinatura_id) {
      return { ok: false, status: 409, codigo: "ja_assina", erro: "Esta conta da Galeria Átomo já tem assinatura." };
    }
    if (conta.plano_id !== planoId) {
      const troca = await trocarPlano(conta.id, planoId, { ip: null });
      if ("erro" in troca && troca.erro) return { ok: false, status: 400, erro: troca.erro };
    }
  } else {
    if (await emailJaUsado(pedido.email)) {
      return {
        ok: false,
        status: 409,
        codigo: "email_em_uso",
        erro:
          "Este e-mail já tem conta na Galeria Átomo com outro CPF/CNPJ. " +
          `Fale com a gente pelo WhatsApp ${marca.whatsappVisivel} para juntar as contas.`,
      };
    }
    if (!pedido.aceitouTermos) {
      return { ok: false, status: 400, erro: "Para criar a conta na Galeria Átomo, é preciso aceitar os Termos e a Privacidade." };
    }
    const tenant = await criarTenant({
      nomeEstudio: pedido.nome,
      email: pedido.email,
      senha: null,
      planoId,
      cpfCnpj: pedido.documento,
      /* O e-mail é o de login do dono no Atomatiza, e a conta só abre pelo link
       * de criar senha que vai para ele: clicar é a confirmação. */
      emailConfirmado: true,
    });
    contaNova = true;
    /* O marco zero e o ACEITE, como no cadastro (`cadastrarAction`): a tela do
     * Atomatiza mostrou os nossos Termos e a Privacidade ao lado da caixa que a
     * pessoa marcou. `origem` diz por onde ela entrou. */
    await registrarEvento({
      tenantId: tenant.id,
      estudio: pedido.nome,
      ator: "sistema",
      acao: ACOES.CONTA_CRIADA,
      alvoTipo: "conta",
      alvoId: tenant.id,
      detalhe: {
        plano: planoId,
        email_hash: hashDeEmail(pedido.email),
        aceitou: { termos: VERSOES_LEGAIS.termos, privacidade: VERSOES_LEGAIS.privacidade },
        origem: "pacote",
      },
    });
    conta = await contaDoDocumento(pedido.documento);
    if (!conta) return { ok: false, status: 500, erro: "Criei a conta, mas não consegui lê-la de volta." };
    await enviarConvite(conta.id).catch((e) => console.error(`[pacote] convite não saiu para ${conta!.id}:`, e));
  }

  /* Quem chegou pela ponte usa o Atomatiza: o seletor de plataforma aparece na
   * hora, sem esperar a próxima visita ao painel de lá. */
  await consultar("update tenants set atomatiza_visto_em = now() where id = $1", [conta.id]);

  const r = await assinarTenant(conta.id, {
    documento: pedido.documento,
    ciclo: pedido.ciclo,
    forma: formaDaAssinatura(pedido.forma === "cartao" ? ESCOLHA_CARTAO : "fatura"),
    pacote: pedido.pacote,
    faixaDoParceiro: pedido.pacote ? (pedido.parceiro.faixa ?? null) : undefined,
    vencimento: new Date(`${pedido.vencimento}T12:00:00Z`),
  });
  if (!r.ok) {
    return r.jaAssina
      ? { ok: false, status: 409, codigo: "ja_assina", erro: "Esta conta da Galeria Átomo já tem assinatura." }
      : { ok: false, status: 400, erro: r.erro };
  }
  return { ok: true, contaNova, valorCentavos: r.valorCentavos, faturaUrl: r.faturaUrl };
}

/** Sete dias: o convite chega sem ninguém esperar por ele. */
const VALIDADE_DO_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

/** "Sua conta está pronta, crie a sua senha" — o link é o do esqueci a senha. */
async function enviarConvite(tenantId: string): Promise<boolean> {
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return false;
  const { token } = await criarPedido(tenantId, "pacote", VALIDADE_DO_CONVITE_MS);
  const link = `https://${marca.dominio}/recuperar/${token}`;
  const nome = tenant.nome_estudio.replace(/[<>&"]/g, "");
  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">
      A conta de <strong style="color:#eef1f6">${nome}</strong> na ${marca.nome} foi criada junto
      com o pacote que você assinou no Atomatiza. Falta só a senha.
    </p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Criar minha senha
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7484">
      O link vale por 7 dias e só funciona uma vez. Se ele vencer, use "Esqueci a senha"
      em ${marca.dominio}/entrar com este e-mail.
    </p>`;
  return enviarEmail({
    para: tenant.email,
    assunto: `Sua conta na ${marca.nome} está pronta`,
    html: moldura("Crie a sua senha", corpo),
    texto: [
      `A conta de ${tenant.nome_estudio} na ${marca.nome} foi criada junto com o pacote que você assinou no Atomatiza.`,
      "",
      "Falta só a senha:",
      link,
      "",
      `O link vale por 7 dias e só funciona uma vez. Se ele vencer, use "Esqueci a senha" em ${marca.dominio}/entrar com este e-mail.`,
    ].join("\n"),
  });
}

// --- a Galeria pergunta ------------------------------------------------------

async function chamarAtomatiza(caminho: string, corpo: unknown, limiteMs: number): Promise<Response | null> {
  const segredo = segredoDaPonte();
  if (!segredo) return null;
  try {
    return await fetch(`${URL_ATOMATIZA}${caminho}`, {
      method: "POST",
      headers: { authorization: `Bearer ${segredo}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(limiteMs),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * A situação deste documento no Atomatiza, ou null quando não deu para saber
 * (ponte desligada, fora do ar, lenta). Null = a tela não oferece o pacote:
 * sem saber se a conta existe lá, a oferta poderia prometer o que não cumpre.
 */
export async function situacaoNoAtomatiza(documento: string): Promise<SituacaoNaPonte | null> {
  const doc = soDigitos(documento);
  if (conferirDocumento(doc)) return null;
  const r = await chamarAtomatiza("/api/ponte/situacao", { documento: doc }, 1500);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as SituacaoNaPonte | null;
  return j && typeof j.conta === "boolean" ? j : null;
}

export async function assinarNoAtomatiza(pedido: PedidoDeAssinatura): Promise<RespostaDeAssinatura> {
  const r = await chamarAtomatiza("/api/ponte/assinar", pedido, 15_000);
  if (!r) return { ok: false, status: 503, erro: "O Atomatiza não respondeu." };
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.ok && j?.ok === true) {
    return {
      ok: true,
      contaNova: j.contaNova === true,
      valorCentavos: Number(j.valorCentavos) || 0,
      faturaUrl: typeof j.faturaUrl === "string" ? j.faturaUrl : null,
    };
  }
  return {
    ok: false,
    status: r.status,
    erro: typeof j?.erro === "string" ? j.erro : `O Atomatiza recusou (HTTP ${r.status}).`,
    codigo: (j?.codigo as CodigoDaPonte | undefined) ?? undefined,
  };
}

// --- os botões da Conta ------------------------------------------------------

export interface EscolhaDoPacote {
  faixa: FaixaAtomatiza;
  ciclo: Ciclo;
  /** A escolha crua da tela: "cartao" ou outra coisa (fatura). */
  forma: unknown;
  documento: string;
  aceitouTermos: boolean;
}

export type ResultadoDoPacote =
  | { ok: true; atomatiza: { contaNova: boolean; valorCentavos: number } }
  | { ok: false; erro: string; galeriaAssinada: boolean };

/**
 * "Assinar o pacote" (`docs/pacote.md`, "A ordem de quem chama"):
 *
 *   1. a assinatura daqui, com a marca e no preço de sempre;
 *   2. a do Atomatiza, pela ponte, já com o combo;
 *   3. deu certo → a conferência do combo daqui acha a de lá e baixa a nossa
 *      (fatura emitida inclusive). Deu errado → a nossa fica no preço cheio,
 *      que é o certo sem o outro, e a tela diz o que houve.
 */
export async function assinarPacote(tenantId: string, escolha: EscolhaDoPacote): Promise<ResultadoDoPacote> {
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { ok: false, erro: "Conta não encontrada.", galeriaAssinada: false };
  const gb = gbDoPlano(tenant.plano_id);
  if (!gb || !espacoValido(gb)) {
    return { ok: false, erro: "O plano desta conta não entra no pacote. Escolha um tamanho da grade.", galeriaAssinada: false };
  }
  const forma = formaDaAssinatura(escolha.forma);

  const nossa = await assinarTenant(tenantId, {
    documento: escolha.documento,
    ciclo: escolha.ciclo,
    forma,
    pacote: true,
  });
  if (!nossa.ok) return { ok: false, erro: nossa.erro, galeriaAssinada: false };

  const depois = await buscarTenantPorId(tenantId);
  const deLa = await assinarNoAtomatiza({
    documento: depois?.cpf_cnpj ?? soDigitos(escolha.documento),
    email: tenant.email,
    nome: tenant.nome_estudio,
    plano: { faixa: escolha.faixa },
    ciclo: escolha.ciclo,
    forma: forma === "CREDIT_CARD" ? "cartao" : "fatura",
    vencimento: nossa.vencimento.toISOString().slice(0, 10),
    pacote: true,
    parceiro: { gb },
    aceitouTermos: escolha.aceitouTermos,
  });

  /* A conferência roda nos dois casos: um "não respondeu" pode ter sido uma
   * assinatura que nasceu lá e cuja resposta se perdeu no caminho. */
  const conferir = () =>
    recalcularCombo(tenantId, "pacote").catch((e) =>
      console.error(`[pacote] estúdio ${tenantId}: a conferência do combo falhou:`, e),
    );

  if (!deLa.ok && deLa.codigo !== "ja_assina") {
    /* Sem o outro lado, a marca sai: ela faria o Atomatiza contar a nossa
     * assinatura ainda não paga se a pessoa o assinasse separado depois — e
     * separado a regra é a de sempre (`docs/pacote.md`). */
    await tirarAMarca(nossa.assinaturaId).catch((e) =>
      console.error(`[pacote] estúdio ${tenantId}: não consegui tirar a marca do pacote:`, e),
    );
    await conferir();
    return {
      ok: false,
      galeriaAssinada: true,
      erro: `A assinatura da Galeria foi criada, mas a do Atomatiza não: ${deLa.erro} Ela ficou no preço cheio; quando o Atomatiza for assinado, o desconto entra.`,
    };
  }

  await conferir();
  return {
    ok: true,
    atomatiza: deLa.ok ? { contaNova: deLa.contaNova, valorCentavos: deLa.valorCentavos } : { contaNova: false, valorCentavos: 0 },
  };
}

async function tirarAMarca(assinaturaId: string): Promise<void> {
  const a = await buscarAssinatura(assinaturaId);
  const descricao = a.description ?? "";
  if (descricao.includes(MARCA_DO_PACOTE)) {
    await trocarDescricaoDaAssinatura(assinaturaId, descricao.replace(MARCA_DO_PACOTE, ""));
  }
}

/**
 * Quem já assina a Galeria acrescenta o Atomatiza. Não é pacote: a regra do
 * desconto é a de sempre (`pacote: false`) — lá, o combo conta a nossa
 * assinatura a partir do primeiro pagamento; aqui, a deles.
 */
export async function acrescentarAtomatiza(
  tenantId: string,
  escolha: Omit<EscolhaDoPacote, "documento">,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant?.asaas_assinatura_id || !tenant.cpf_cnpj) {
    return { ok: false, erro: "Assine a Galeria antes de acrescentar o Atomatiza." };
  }
  const gb = gbDoPlano(tenant.plano_id);
  const forma = formaDaAssinatura(escolha.forma);
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await assinarNoAtomatiza({
    documento: tenant.cpf_cnpj,
    email: tenant.email,
    nome: tenant.nome_estudio,
    plano: { faixa: escolha.faixa },
    ciclo: escolha.ciclo,
    forma: forma === "CREDIT_CARD" ? "cartao" : "fatura",
    vencimento: hoje,
    pacote: false,
    parceiro: gb ? { gb } : {},
    aceitouTermos: escolha.aceitouTermos,
  });
  return r.ok ? { ok: true } : { ok: false, erro: r.erro };
}
