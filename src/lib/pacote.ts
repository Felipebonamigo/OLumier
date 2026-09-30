import "server-only";
import { consultar, consultarUm } from "@/lib/db";
import { marca } from "@/config/marca";
import { cicloDe, espacoValido, idDaMontagem, planoPorId, type Ciclo } from "@/config/planos";
import {
  ehFaixaAtomatiza,
  MARCA_DO_PACOTE,
  planoEntraNoCombo,
  precoDoCicloComComboCentavos,
  type FaixaAtomatiza,
} from "@/config/combo";
import { montarFatias } from "@/config/socios";
import {
  asaasConfigurado,
  buscarAssinatura,
  cancelarAssinatura,
  criarAssinaturaDoPacote,
  ehDoPacoteUnico,
  garantirCliente,
  type FatiaParaOAsaas,
} from "@/lib/asaas";
import { documentoEmUso } from "@/lib/cadastro";
import { ESCOLHA_CARTAO, formaDaAssinatura } from "@/config/forma-assinatura";
import { VERSOES_LEGAIS } from "@/config/documentos-legais";
import { conferirDocumento, soDigitos } from "@/lib/documento";
import { assinarTenant, vencimentoDoTeste } from "@/lib/assinar";
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
    /** A assinatura é a fatura única do pacote (`docs/pacote.md`). */
    pacote?: boolean;
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

export type CodigoDaPonte = "conta_de_outro_email" | "email_em_uso" | "ja_assina" | "combinado";

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
  pacote_atomatiza_id: string | null;
}

async function contaDoDocumento(documento: string): Promise<ContaNaPonte | null> {
  return consultarUm<ContaNaPonte>(
    `select id, email, status, plano_id, ciclo_cobranca, asaas_assinatura_id, pago_ate, pacote_atomatiza_id
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
    assinatura = {
      status,
      plano: gb ? { gb } : {},
      ciclo: cicloDe(t.ciclo_cobranca),
      ...(t.pacote_atomatiza_id ? { pacote: true } : {}),
    };
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
type Recusa = { ok: false; status: number; erro: string; codigo?: CodigoDaPonte };

/**
 * A conta daqui para um pedido da ponte — a mesma regra para `assinar` e para
 * `pacote/preparar`: achada pelo documento e com o mesmo e-mail, ou criada (sem
 * senha, com o aceite e o convite), já no plano pedido e SEM assinatura.
 */
async function prepararContaDaPonte(
  pedido: PedidoDeAssinatura,
): Promise<{ ok: true; conta: ContaNaPonte; contaNova: boolean; planoId: string } | Recusa> {
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
  return { ok: true, conta, contaNova, planoId };
}

export async function receberAssinatura(pedido: PedidoDeAssinatura): Promise<RespostaDeAssinatura> {
  const preparada = await prepararContaDaPonte(pedido);
  if (!preparada.ok) return preparada;
  const { conta, contaNova } = preparada;

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
  | { ok: true; atomatiza: { contaNova: boolean; valorCentavos: number }; totalCentavos: number }
  | { ok: false; erro: string; galeriaAssinada: boolean };

// --- a fatura única (`docs/pacote.md`, "Fatura única") -----------------------

/** Uma parte do split do OUTRO produto: % do valor DELE, ou valor exato. */
export interface ParteDoParceiro {
  walletId: string;
  percentual?: number;
  fixoCentavos?: number;
}

/**
 * O split da fatura única: as partes dos sócios dos DOIS produtos numa
 * cobrança só (Felipe: "uma cobrança que depois divida a porcentagem correta
 * para cada sistema e para cada sócio").
 *
 * Cada lado pensa em % do SEU valor; o Asaas aplica o % sobre o TOTAL. Então o
 * percentual de cada lado é reescalado pela fatia dele no total, e o fixo
 * continua fixo. A mesma carteira nos dois lados vira uma parte só — o Asaas
 * não aceita a carteira repetida: percentuais somam; fixo com percentual vira
 * tudo percentual (o fixo como % do total bruto). Duas casas decimais, para
 * baixo: a sobra de arredondamento fica na conta principal, nunca passa de 100.
 */
export function juntarSplit(
  nossas: FatiaParaOAsaas[],
  nossoValorCentavos: number,
  delas: ParteDoParceiro[],
  valorDelesCentavos: number,
): FatiaParaOAsaas[] {
  const total = nossoValorCentavos + valorDelesCentavos;
  if (total <= 0) return [];
  const porCarteira = new Map<string, { carteira: string; pct: number; fixo: number }>();
  const somar = (carteira: string, pct: number, fixo: number) => {
    const chave = carteira.trim().toLowerCase();
    const atual = porCarteira.get(chave) ?? { carteira: carteira.trim(), pct: 0, fixo: 0 };
    atual.pct += pct;
    atual.fixo += fixo;
    porCarteira.set(chave, atual);
  };
  for (const f of nossas) {
    if (f.percentual !== undefined) somar(f.carteira, (f.percentual * nossoValorCentavos) / total, 0);
    else somar(f.carteira, 0, f.centavos);
  }
  for (const p of delas) {
    if (!p.walletId) continue;
    if (typeof p.percentual === "number") somar(p.walletId, (p.percentual * valorDelesCentavos) / total, 0);
    else if (typeof p.fixoCentavos === "number") somar(p.walletId, 0, p.fixoCentavos);
  }
  const duasCasas = (n: number) => Math.floor(n * 100) / 100;
  return [...porCarteira.values()]
    .map((c) =>
      c.pct > 0
        ? { carteira: c.carteira, centavos: 0, percentual: duasCasas(c.pct + (c.fixo * 100) / total) }
        : { carteira: c.carteira, centavos: c.fixo },
    )
    .filter((c) => (c.percentual ?? 0) > 0 || c.centavos > 0);
}

/** "1 TB", "500 GB" — como a descrição e o e-mail mostram. */
const rotuloGb = (gb: number) => (gb >= 1000 ? `${gb / 1000} TB` : `${gb} GB`);

export interface Preparado {
  ok: true;
  contaId: string;
  contaNova: boolean;
  valorCentavos: number;
  nome: string;
  split: ParteDoParceiro[];
}

/** Parceiro: o Atomatiza vai criar a fatura única; aqui só a conta e o preço. */
export async function prepararPacote(pedido: PedidoDeAssinatura): Promise<Preparado | Recusa> {
  const faixa = pedido.parceiro.faixa;
  if (!faixa) return { ok: false, status: 400, erro: "Faixa do Atomatiza inválida." };
  const preparada = await prepararContaDaPonte(pedido);
  if (!preparada.ok) return preparada;
  const plano = planoPorId(preparada.planoId)!;
  const valorCentavos = precoDoCicloComComboCentavos(plano, pedido.ciclo, faixa);
  const split: ParteDoParceiro[] = montarFatias(plano.id, valorCentavos, pedido.ciclo).map((f) =>
    f.percentual !== undefined
      ? { walletId: f.carteira, percentual: f.percentual }
      : { walletId: f.carteira, fixoCentavos: f.centavos },
  );
  return {
    ok: true,
    contaId: preparada.conta.id,
    contaNova: preparada.contaNova,
    valorCentavos,
    nome: `Galeria Átomo ${rotuloGb(pedido.plano.gb!)}`,
    split,
  };
}

/**
 * Parceiro: a fatura única nasceu lá; grava aqui. Não confia no pedido: lê a
 * assinatura no Asaas e confere que a referência dela é `pacote:<esta conta>:…`
 * — senão qualquer id de assinatura viraria "pago" nesta conta.
 */
export async function vincularPacote(corpo: unknown): Promise<{ ok: true } | Recusa> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const documento = soDigitos(String(c.documento ?? ""));
  const contaId = String(c.contaId ?? "");
  const assinaturaId = String(c.assinaturaId ?? "");
  const clienteId = String(c.clienteId ?? "");
  if (!documento || !/^[0-9a-f-]{36}$/i.test(contaId) || !assinaturaId) {
    return { ok: false, status: 400, erro: "Pedido de vínculo incompleto." };
  }
  const t = await consultarUm<{ id: string; cpf_cnpj: string | null; asaas_assinatura_id: string | null }>(
    "select id, cpf_cnpj, asaas_assinatura_id from tenants where id = $1",
    [contaId],
  );
  if (!t || t.cpf_cnpj !== documento) return { ok: false, status: 400, erro: "Conta e documento não conferem." };
  if (t.asaas_assinatura_id === assinaturaId) return { ok: true };
  if (t.asaas_assinatura_id) {
    return { ok: false, status: 409, codigo: "ja_assina", erro: "Esta conta da Galeria Átomo já tem assinatura." };
  }

  const a = await buscarAssinatura(assinaturaId);
  const [, daGaleria, doAtomatiza] = (a.externalReference ?? "").split(":");
  if (!ehDoPacoteUnico(a.externalReference) || daGaleria !== contaId || !doAtomatiza || a.deleted) {
    return { ok: false, status: 400, erro: "A assinatura não é o pacote desta conta." };
  }
  const faixa = faixaDoNomeDoPacote(a.description);
  await consultar(
    `update tenants
        set asaas_cliente_id = $1, asaas_assinatura_id = $2, ciclo_cobranca = $3, combo_atomatiza = $4,
            pacote_atomatiza_id = $5, assinatura_criada_em = now(), atualizado_em = now()
      where id = $6`,
    [clienteId || a.customer || null, assinaturaId, cicloDe(c.ciclo), faixa, doAtomatiza, contaId],
  );
  return { ok: true };
}

/** A faixa do Atomatiza na descrição da fatura única ("… + Atomatiza Solo · pacote"). */
export function faixaDoNomeDoPacote(descricao: string | null | undefined): FaixaAtomatiza | null {
  const m = /Atomatiza\s+(Solo|Equipe|Est[uú]dio)/i.exec(descricao ?? "");
  if (!m) return null;
  const f = m[1].toLowerCase();
  return f === "solo" ? "solo" : f === "equipe" ? "equipe" : "estudio";
}

async function prepararNoAtomatiza(pedido: Omit<PedidoDeAssinatura, "pacote">): Promise<Preparado | Recusa> {
  const r = await chamarAtomatiza("/api/ponte/pacote/preparar", pedido, 15_000);
  if (!r) return { ok: false, status: 503, erro: "O Atomatiza não respondeu." };
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.ok && j?.ok === true && typeof j.contaId === "string" && Number(j.valorCentavos) > 0) {
    return {
      ok: true,
      contaId: j.contaId,
      contaNova: j.contaNova === true,
      valorCentavos: Math.round(Number(j.valorCentavos)),
      nome: typeof j.nome === "string" ? j.nome.slice(0, 60) : "Atomatiza",
      split: Array.isArray(j.split) ? (j.split as ParteDoParceiro[]) : [],
    };
  }
  return {
    ok: false,
    status: r.status,
    erro: typeof j?.erro === "string" ? j.erro : `O Atomatiza recusou (HTTP ${r.status}).`,
    codigo: (j?.codigo as CodigoDaPonte | undefined) ?? undefined,
  };
}

async function vincularNoAtomatiza(pedido: {
  documento: string;
  contaId: string;
  assinaturaId: string;
  clienteId: string;
  valorCentavos: number;
  ciclo: Ciclo;
}): Promise<{ ok: true } | Recusa> {
  const r = await chamarAtomatiza("/api/ponte/pacote/vincular", pedido, 15_000);
  if (!r) return { ok: false, status: 503, erro: "O Atomatiza não respondeu." };
  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.ok && j?.ok === true) return { ok: true };
  return { ok: false, status: r.status, erro: typeof j?.erro === "string" ? j.erro : `O Atomatiza recusou (HTTP ${r.status}).` };
}

/**
 * "Assinar o pacote" — a Galeria é quem cria a fatura única (`docs/pacote.md`,
 * "A ordem de O"):
 *
 *   1. confere o lado daqui;
 *   2. o Atomatiza prepara a conta de lá e diz quanto cobra e como divide;
 *   3. UMA assinatura, no nosso cliente do Asaas, com o total e o split dos
 *      dois produtos;
 *   4. grava aqui;
 *   5. o Atomatiza grava lá. Falhou → a assinatura é cancelada e nada fica
 *      cobrando por um produto que não sabe dela.
 */
export async function assinarPacote(tenantId: string, escolha: EscolhaDoPacote): Promise<ResultadoDoPacote> {
  const falha = (erro: string): ResultadoDoPacote => ({ ok: false, erro, galeriaAssinada: false });
  if (!asaasConfigurado()) return falha("A cobrança ainda não foi ligada.");
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return falha("Conta não encontrada.");
  if (tenant.asaas_assinatura_id) return falha("Esta conta já tem assinatura.");
  const plano = planoPorId(tenant.plano_id);
  const gb = gbDoPlano(tenant.plano_id);
  if (!plano || !gb || !espacoValido(gb) || !planoEntraNoCombo(plano)) {
    return falha("O plano desta conta não entra no pacote. Escolha um tamanho da grade.");
  }

  const documento = soDigitos(escolha.documento || tenant.cpf_cnpj || "");
  const problema = conferirDocumento(documento);
  if (problema) return falha(problema);
  if (await documentoEmUso(documento, tenantId)) {
    return falha(`Esse CPF/CNPJ já está em outra conta. Fale com a gente pelo WhatsApp ${marca.whatsappVisivel} para juntar as duas.`);
  }

  const forma = formaDaAssinatura(escolha.forma);
  const vencimento = vencimentoDoTeste(tenant.trial_ate);
  const deLa = await prepararNoAtomatiza({
    documento,
    email: tenant.email,
    nome: tenant.nome_estudio,
    plano: { faixa: escolha.faixa },
    ciclo: escolha.ciclo,
    forma: forma === "CREDIT_CARD" ? "cartao" : "fatura",
    vencimento: vencimento.toISOString().slice(0, 10),
    parceiro: { gb },
    aceitouTermos: escolha.aceitouTermos,
  });
  if (!deLa.ok) return falha(deLa.erro);

  const cliente = await garantirCliente({ tenantId, nome: tenant.nome_estudio, email: tenant.email, cpfCnpj: documento });
  await consultar("update tenants set cpf_cnpj = $1, atualizado_em = now() where id = $2", [documento, tenantId]);

  const nosso = precoDoCicloComComboCentavos(plano, escolha.ciclo, escolha.faixa);
  const total = nosso + deLa.valorCentavos;
  const fatias = juntarSplit(montarFatias(plano.id, nosso, escolha.ciclo), nosso, deLa.split, deLa.valorCentavos);
  const assinatura = await criarAssinaturaDoPacote({
    clienteAsaasId: cliente.id,
    tenantId,
    estudioAtomatizaId: deLa.contaId,
    precoCentavos: total,
    ciclo: escolha.ciclo,
    descricao: `Pacote ${marca.nome} ${rotuloGb(gb)} + ${deLa.nome}${MARCA_DO_PACOTE}`,
    primeiroVencimento: vencimento,
    forma,
    fatias,
  });

  await consultar(
    `update tenants
        set asaas_cliente_id = $1, asaas_assinatura_id = $2, ciclo_cobranca = $3, combo_atomatiza = $4,
            pacote_atomatiza_id = $5, atomatiza_visto_em = now(), assinatura_criada_em = now(), atualizado_em = now()
      where id = $6`,
    [cliente.id, assinatura.id, escolha.ciclo, escolha.faixa, deLa.contaId, tenantId],
  );

  const vinculo = await vincularNoAtomatiza({
    documento,
    contaId: deLa.contaId,
    assinaturaId: assinatura.id,
    clienteId: cliente.id,
    valorCentavos: deLa.valorCentavos,
    ciclo: escolha.ciclo,
  });
  if (!vinculo.ok) {
    await cancelarAssinatura(assinatura.id).catch((e) =>
      console.error(`[pacote] estúdio ${tenantId}: o vínculo falhou E a assinatura ${assinatura.id} não foi cancelada:`, e),
    );
    await consultar(
      `update tenants
          set asaas_assinatura_id = null, combo_atomatiza = null, pacote_atomatiza_id = null,
              assinatura_criada_em = null, atualizado_em = now()
        where id = $1`,
      [tenantId],
    );
    return falha(`O Atomatiza não confirmou o pacote (${vinculo.erro}). Nada foi cobrado — tente de novo em instantes.`);
  }

  return { ok: true, atomatiza: { contaNova: deLa.contaNova, valorCentavos: deLa.valorCentavos }, totalCentavos: total };
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
