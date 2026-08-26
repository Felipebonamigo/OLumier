"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { reclamarDominio, soltarDominio, verificarPosse } from "@/lib/dominio-proprio";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";

/**
 * O endereço próprio do estúdio.
 *
 * Arquivo separado de `painel/actions.ts` de propósito: aquele já passa de 700
 * linhas e é editado por todo mundo ao mesmo tempo. Estas três funções são um
 * assunto só, e ficam onde a tela que as usa mora.
 */

async function exigirTenant(): Promise<string> {
  const id = await sessaoAtual();
  if (!id) redirect("/entrar");
  return id;
}

export interface EstadoDominio {
  erro?: string;
  ok?: string;
}

export async function reclamarDominioAction(form: FormData): Promise<EstadoDominio> {
  const tenantId = await exigirTenant();
  const r = await reclamarDominio(tenantId, String(form.get("dominio") ?? ""));
  revalidatePath("/painel/site");
  return r.ok ? { ok: "Agora crie o registro abaixo no seu provedor de domínio." } : { erro: r.erro };
}

/**
 * Confere o registro TXT.
 *
 * Com freio, e o freio não é decoração: cada clique é uma consulta DNS de
 * verdade, para fora. O botão fica ao lado de um texto que diz "pode levar
 * alguns minutos", que é exatamente o convite para alguém segurar o clique.
 *
 * O freio é por ESTÚDIO e não por IP: quem clica é o dono logado, e trocar de
 * rede não deveria dar mais tentativas.
 */
export async function verificarDominioAction(): Promise<EstadoDominio> {
  const tenantId = await exigirTenant();

  const chave = `dominio:${tenantId}`;
  const antes = podeTentar(chave);
  if (!antes.permitido) {
    return { erro: `Muitas tentativas seguidas. Tente de novo em ${emPalavras(antes.esperarSeg!)}.` };
  }

  const r = await verificarPosse(tenantId);
  revalidatePath("/painel/site");

  if (!r.ok) {
    /* "Ainda não propagou" é o caso NORMAL nas primeiras tentativas, e mesmo
     * assim conta para o freio: cada uma custa uma consulta DNS. O texto explica
     * que esperar é o certo, então o freio não surpreende ninguém. */
    const depois = registrarErro(chave);
    if (!depois.permitido) {
      return { erro: `Muitas tentativas seguidas. Tente de novo em ${emPalavras(depois.esperarSeg!)}.` };
    }
    return { erro: r.erro };
  }

  limparTentativas(chave);
  return { ok: "Endereço confirmado. Agora aponte o DNS conforme as instruções." };
}

export async function soltarDominioAction(): Promise<EstadoDominio> {
  const tenantId = await exigirTenant();
  await soltarDominio(tenantId);
  limparTentativas(`dominio:${tenantId}`);
  revalidatePath("/painel/site");
  return { ok: "Endereço removido. Suas galerias seguem no endereço da plataforma." };
}
