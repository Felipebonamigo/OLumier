"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { criarGaleria, apagarGaleria } from "@/lib/tenants";

/** Toda action começa por aqui: quem não tem sessão válida não faz nada. */
async function exigirTenant(): Promise<string> {
  const id = await sessaoAtual();
  if (!id) redirect("/entrar");
  return id;
}

export interface EstadoGaleria {
  erro?: string;
}

export async function criarGaleriaAction(
  _estado: EstadoGaleria,
  form: FormData,
): Promise<EstadoGaleria> {
  const tenantId = await exigirTenant();

  const titulo = String(form.get("titulo") ?? "").trim();
  if (!titulo) return { erro: "Dê um nome para a galeria." };

  const subtitulo = String(form.get("subtitulo") ?? "").trim();
  const dataEvento = String(form.get("data_evento") ?? "").trim();

  const galeria = await criarGaleria({ tenantId, titulo, subtitulo, dataEvento });
  revalidatePath("/painel");
  redirect(`/painel/galerias/${galeria!.id}`);
}

export async function apagarGaleriaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  // O apagarGaleria filtra por tenant_id também — id adivinhado não apaga galeria alheia.
  await apagarGaleria(tenantId, galeriaId);
  revalidatePath("/painel");
  redirect("/painel");
}
