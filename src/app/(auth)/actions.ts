"use server";

import { redirect } from "next/navigation";
import { criarSessao, encerrarSessao } from "@/lib/auth";
import { autenticar, buscarTenantPorEmail, criarTenant, emailJaUsado } from "@/lib/tenants";
import { planoPorId, PLANO_INICIAL } from "@/config/planos";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";
import { emailConfigurado } from "@/lib/email";
import { conferirSenhaNova } from "@/lib/senha";
import { marca } from "@/config/marca";
import {
  MINIMO_SENHA,
  concluir,
  conferirToken,
  criarPedido,
  enviarEmailDeRecuperacao,
} from "@/lib/recuperacao";
import { headers } from "next/headers";

/**
 * O recado de cada recusa de senha. Fica junto porque as três telas que definem
 * senha dizem a MESMA coisa — cadastro, recuperação e troca —, e três frases
 * escritas em três lugares viram três frases diferentes na primeira revisão.
 */
const RECADO_SENHA: Record<"curta" | "diferentes", string> = {
  curta: `A senha precisa de pelo menos ${MINIMO_SENHA} caracteres.`,
  diferentes: "As duas senhas não são iguais. Confira a digitação.",
};

export interface EstadoForm {
  erro?: string;
}

/** Redirecionar só para caminho interno — "proximo" vem da URL e não é confiável. */
function destinoSeguro(proximo: FormDataEntryValue | null): string {
  const p = typeof proximo === "string" ? proximo : "";
  return p.startsWith("/") && !p.startsWith("//") ? p : "/painel";
}

export async function entrarAction(_estado: EstadoForm, form: FormData): Promise<EstadoForm> {
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");

  if (!email || !senha) return { erro: "Preencha e-mail e senha." };

  // Freio por e-mail: é o alvo de quem tenta adivinhar a senha de uma conta.
  const chave = `login:${email.toLowerCase()}`;
  const antes = podeTentar(chave);
  if (!antes.permitido) {
    return { erro: `Muitas tentativas. Tente de novo em ${emPalavras(antes.esperarSeg!)}.` };
  }

  const tenant = await autenticar(email, senha);
  // Mensagem única de propósito: dizer "esse e-mail não existe" entrega quem é cliente nosso.
  if (!tenant) {
    const depois = registrarErro(chave);
    if (!depois.permitido) {
      return { erro: `Muitas tentativas. Tente de novo em ${emPalavras(depois.esperarSeg!)}.` };
    }
    return { erro: "E-mail ou senha incorretos." };
  }

  limparTentativas(chave);
  await criarSessao(tenant.id);
  redirect(destinoSeguro(form.get("proximo")));
}

export async function cadastrarAction(_estado: EstadoForm, form: FormData): Promise<EstadoForm> {
  const nomeEstudio = String(form.get("nome_estudio") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  const senhaConfirmacao = String(form.get("senha_confirmacao") ?? "");
  /*
   * O formulário não manda mais plano — a conta nasce no plano inicial e a
   * pessoa escolhe na Conta. O campo continua sendo aceito e validado porque
   * o teste de ponta a ponta o usa para criar contas em planos diferentes, e
   * porque aceitar sem validar seria deixar a quota vir de fora.
   */
  const planoId = String(form.get("plano_id") ?? PLANO_INICIAL);

  if (!nomeEstudio) return { erro: "Diga o nome do seu estúdio." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: "E-mail inválido." };
  /* A confirmação é conferida AQUI, não só no navegador. O campo a mais na
   * tela evita o erro de digitação; esta linha evita o formulário montado à
   * mão — e é a fronteira de confiança, que não recebe atalho. */
  const problemaSenha = conferirSenhaNova(senha, senhaConfirmacao);
  if (problemaSenha) return { erro: RECADO_SENHA[problemaSenha] };
  if (!planoPorId(planoId)) return { erro: "Plano inválido." };
  if (await emailJaUsado(email)) return { erro: "Já existe uma conta com esse e-mail." };

  const tenant = await criarTenant({ nomeEstudio, email, senha, planoId });

  /*
   * O marco zero da conta. É o evento que ancora todos os outros: numa disputa,
   * "desde quando esse estúdio usa o serviço" e "com qual plano ele entrou" são
   * as duas primeiras perguntas, e nenhuma delas tem resposta confiável olhando
   * a tabela `tenants` — lá só existe o estado de hoje.
   */
  const { registrarEvento, ACOES } = await import("@/lib/eventos");
  const { ipDaRequisicao } = await import("@/lib/origem");
  await registrarEvento({
    tenantId: tenant.id,
    estudio: nomeEstudio,
    ator: "estudio",
    acao: ACOES.CONTA_CRIADA,
    alvoTipo: "conta",
    alvoId: tenant.id,
    detalhe: { plano: planoId, email },
    ip: await ipDaRequisicao(),
  });

  await criarSessao(tenant.id);
  redirect("/painel");
}

export async function sairAction() {
  await encerrarSessao();
  redirect("/entrar");
}


// --- esqueci minha senha ----------------------------------------------------

export interface EstadoRecuperar {
  erro?: string;
  /** true quando o pedido foi processado — a tela troca de conteúdo. */
  enviado?: boolean;
}

/**
 * Pede o link de recuperação.
 *
 * A RESPOSTA É SEMPRE A MESMA, exista o e-mail ou não. Dizer "não achei essa
 * conta" transformaria este formulário numa lista de clientes da plataforma: quem
 * quisesse saber se um estúdio usa a plataforma bastaria digitar o e-mail dele.
 * Quem não tem conta simplesmente não recebe nada.
 */
export async function pedirRecuperacaoAction(
  _estado: EstadoRecuperar,
  form: FormData,
): Promise<EstadoRecuperar> {
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { erro: "Digite seu e-mail." };

  if (!emailConfigurado()) {
    return {
      erro: `O envio de e-mail ainda não está ligado. Fale com ${marca.email} para redefinir sua senha.`,
    };
  }

  /*
   * Freio por e-mail. Sem ele, este formulário vira uma forma de encher a caixa
   * de entrada de alguém — e de gastar nossa cota de envio — só repetindo o
   * mesmo endereço.
   */
  const chave = `recuperar:${email.toLowerCase()}`;
  const antes = podeTentar(chave);
  if (!antes.permitido) {
    return { erro: `Muitos pedidos. Tente de novo em ${emPalavras(antes.esperarSeg!)}.` };
  }
  // Conta TODO pedido, não só os que falharam: aqui não existe "errar" — o que
  // precisa de freio é a repetição em si. O nome da função é do caso de senha.
  registrarErro(chave);

  const tenant = await buscarTenantPorEmail(email);
  if (tenant) {
    const cab = await headers();
    const origem = cab.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { token } = await criarPedido(tenant.id, origem ?? undefined);
    const link = `https://${marca.dominio}/recuperar/${token}`;
    await enviarEmailDeRecuperacao(tenant.email, tenant.nome_estudio, link);
  }

  // Mesmo retorno nos dois caminhos.
  return { enviado: true };
}

export interface EstadoNovaSenha {
  erro?: string;
}

/** Grava a senha nova. O token vem do campo escondido, não da URL da action. */
export async function definirSenhaNovaAction(
  _estado: EstadoNovaSenha,
  form: FormData,
): Promise<EstadoNovaSenha> {
  const token = String(form.get("token") ?? "");
  const senha = String(form.get("senha") ?? "");
  const repetida = String(form.get("senha_repetida") ?? "");

  const problema = conferirSenhaNova(senha, repetida);
  if (problema) return { erro: RECADO_SENHA[problema] };

  const conferido = await conferirToken(token);
  if (!conferido.ok) {
    return { erro: "Este link não vale mais. Peça um novo em “esqueci minha senha”." };
  }

  const ok = await concluir(token, senha);
  if (!ok) return { erro: "Este link não vale mais. Peça um novo." };

  /*
   * NÃO cria sessão automaticamente.
   *
   * Seria mais cômodo entrar direto, e é o que muitos sistemas fazem. Só que
   * quem chegou aqui pode ser alguém que interceptou o e-mail; obrigar a digitar
   * a senha nova na tela de entrada não atrapalha o dono (ele acabou de
   * escolhê-la) e fecha a porta de entrar sem nunca provar que sabe a senha.
   */
  redirect("/entrar?senha_redefinida=1");
}
