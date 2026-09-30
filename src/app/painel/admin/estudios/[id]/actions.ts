"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { adminDaRequisicao } from "@/lib/portao-admin";
import { definirPixiesetLiberado } from "@/lib/acesso-pixieset";

/**
 * O botão "Permitir Pixieset" da ficha do estúdio.
 *
 * Todo export de um arquivo "use server" é um endpoint que qualquer pessoa
 * logada consegue chamar, com qualquer corpo. O portão da PÁGINA não protege
 * nada aqui: a ação confere o admin de novo, e para quem não é, a resposta é
 * a mesma de um endereço que não existe (ver `lib/portao-admin.ts`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function permitirPixiesetAction(form: FormData): Promise<void> {
  const admin = await adminDaRequisicao();
  if (!admin) notFound();

  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) notFound();

  const resultado = await definirPixiesetLiberado(id, form.get("liberar") === "1", admin);
  if (resultado === "nao-existe") notFound();

  revalidatePath(`/painel/admin/estudios/${id}`);
  redirect(`/painel/admin/estudios/${id}#pixieset`);
}
