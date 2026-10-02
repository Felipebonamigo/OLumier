"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { adminDaRequisicao } from "@/lib/portao-admin";
import { definirLoginLiberado } from "@/lib/acesso-plataforma";
import { plataformaPorId } from "@/config/plataformas-de-origem";
import { definirFormatosLiberados } from "@/lib/acesso-formatos";

/**
 * Os botões "Permitir Pixieset" e "Permitir Pixellu" da ficha do estúdio.
 *
 * Todo export de um arquivo "use server" é um endpoint que qualquer pessoa
 * logada consegue chamar, com qualquer corpo. O portão da PÁGINA não protege
 * nada aqui: a ação confere o admin de novo, e para quem não é, a resposta é
 * a mesma de um endereço que não existe (ver `lib/portao-admin.ts`).
 *
 * A plataforma vem do formulário, então é conferida contra a lista fechada de
 * `config/plataformas-de-origem.ts` — texto qualquer ali vira 404, nunca uma
 * coluna chutada no banco.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function permitirLoginAction(form: FormData): Promise<void> {
  const admin = await adminDaRequisicao();
  if (!admin) notFound();

  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) notFound();
  const plataforma = plataformaPorId(form.get("plataforma"));
  if (!plataforma) notFound();

  const resultado = await definirLoginLiberado(
    id,
    plataforma.id,
    form.get("liberar") === "1",
    admin,
  );
  if (resultado === "nao-existe") notFound();

  revalidatePath(`/painel/admin/estudios/${id}`);
  redirect(`/painel/admin/estudios/${id}#outras-plataformas`);
}

/** O botão "Liberar Pastas e Stream" da ficha — mesma tranca do Pixieset. */
export async function liberarFormatosAction(form: FormData): Promise<void> {
  const admin = await adminDaRequisicao();
  if (!admin) notFound();

  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) notFound();

  const resultado = await definirFormatosLiberados(id, form.get("liberar") === "1", admin);
  if (resultado === "nao-existe") notFound();

  revalidatePath(`/painel/admin/estudios/${id}`);
  redirect(`/painel/admin/estudios/${id}#formatos`);
}
