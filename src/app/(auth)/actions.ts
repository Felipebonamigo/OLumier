"use server";

import { redirect } from "next/navigation";
import { criarSessao, encerrarSessao } from "@/lib/auth";
import { autenticar, criarTenant, emailJaUsado } from "@/lib/tenants";
import { planoPorId, planos } from "@/config/planos";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";

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
  const planoId = String(form.get("plano_id") ?? planos[0].id);

  if (!nomeEstudio) return { erro: "Diga o nome do seu estúdio." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { erro: "E-mail inválido." };
  if (senha.length < 8) return { erro: "A senha precisa de pelo menos 8 caracteres." };
  if (!planoPorId(planoId)) return { erro: "Plano inválido." };
  if (await emailJaUsado(email)) return { erro: "Já existe uma conta com esse e-mail." };

  const tenant = await criarTenant({ nomeEstudio, email, senha, planoId });
  await criarSessao(tenant.id);
  redirect("/painel");
}

export async function sairAction() {
  await encerrarSessao();
  redirect("/entrar");
}
