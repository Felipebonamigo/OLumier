"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { criarGaleria, apagarGaleria } from "@/lib/tenants";
import { consultar } from "@/lib/db";
import { gerarHashSenhaGaleria } from "@/lib/galerias-publicas";
import { lerAparencia } from "@/config/aparencia";

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

/**
 * Salva os controles de entrega. Recebe só o que mudou: a tela alterna uma coisa
 * por vez, e campo ausente significa "não mexer" — não "apagar".
 */
export async function salvarPublicacaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const campos: string[] = [];
  const valores: unknown[] = [];

  const publicada = form.get("publicada");
  if (publicada !== null) {
    valores.push(publicada === "1");
    campos.push(`publicada = $${valores.length}`);
  }

  const permiteDownload = form.get("permite_download");
  if (permiteDownload !== null) {
    valores.push(permiteDownload === "1");
    campos.push(`permite_download = $${valores.length}`);
  }

  if (form.get("mexeu_senha") === "1") {
    const senha = String(form.get("senha") ?? "").trim();
    // Campo vazio tira a senha; com texto, grava o hash.
    valores.push(senha ? gerarHashSenhaGaleria(senha) : null);
    campos.push(`senha_hash = $${valores.length}`);
  }

  if (campos.length === 0) return;

  valores.push(galeriaId, tenantId);
  await consultar(
    `update galerias set ${campos.join(", ")}, atualizado_em = now()
      where id = $${valores.length - 1} and tenant_id = $${valores.length}`,
    valores,
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Salva a aparência. Valida antes de gravar — o JSON vem do navegador. */
export async function salvarAparenciaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return;
  }

  // lerAparencia descarta qualquer chave desconhecida ou valor inválido:
  // o que é gravado é sempre um objeto que o renderizador sabe desenhar.
  const limpa = lerAparencia(bruto);

  await consultar(
    `update galerias set aparencia = $1, atualizado_em = now()
      where id = $2 and tenant_id = $3`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Define qual foto abre a galeria. */
export async function definirCapaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const mediaId = String(form.get("media_id") ?? "");
  if (!galeriaId || !mediaId) return;

  await consultar(
    `update galerias g set capa_media_id = $1, atualizado_em = now()
      where g.id = $2 and g.tenant_id = $3
        and exists (select 1 from medias m where m.id = $1 and m.galeria_id = g.id)`,
    [mediaId, galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
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
