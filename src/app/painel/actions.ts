"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { criarGaleria, apagarGaleria } from "@/lib/tenants";
import { consultar } from "@/lib/db";
import { gerarHashSenhaGaleria } from "@/lib/galerias-publicas";
import { lerAparencia } from "@/config/aparencia";
import { PRAZOS } from "@/config/prazos";
import { marca } from "@/config/marca";
import { planoPorId } from "@/config/planos";
import { buscarTenantPorId } from "@/lib/tenants";
import { asaasConfigurado, garantirCliente, criarAssinatura } from "@/lib/asaas";
import { conferirDocumento, soDigitos } from "@/lib/documento";
import { definirPrazo, arquivarAgora, reativar } from "@/lib/cofre";
import {
  CAPITULOS_SUGERIDOS,
  apagarSecao,
  criarSecao,
  moverMediasParaSecao,
  moverSecao,
  renomearSecao,
} from "@/lib/secoes";

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

// --- capítulos --------------------------------------------------------------

export async function criarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const nome = String(form.get("nome") ?? "");
  await criarSecao(galeriaId, tenantId, nome);
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Cria os capítulos sugeridos de uma vez — a estrutura típica de um casamento. */
export async function criarCapitulosSugeridosAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  for (const nome of CAPITULOS_SUGERIDOS) {
    await criarSecao(galeriaId, tenantId, nome);
  }
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

export async function renomearSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await renomearSecao(String(form.get("secao_id") ?? ""), tenantId, String(form.get("nome") ?? ""));
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function apagarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await apagarSecao(String(form.get("secao_id") ?? ""), tenantId);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function moverSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const direcao = form.get("direcao") === "cima" ? "cima" : "baixo";
  await moverSecao(String(form.get("secao_id") ?? ""), tenantId, direcao);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function moverMediasAction(form: FormData) {
  const tenantId = await exigirTenant();
  const ids = String(form.get("media_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const destino = String(form.get("secao_id") ?? "");
  await moverMediasParaSecao(ids, destino || null, tenantId);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

// --- cobranca --------------------------------------------------------------

/**
 * Cria a assinatura no Asaas para o estudio logado.
 * Guarda os ids no banco: sem isso, uma segunda chamada criaria assinatura
 * duplicada e o fotografo pagaria duas vezes.
 */
export async function criarAssinaturaAction(
  documento: string,
): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();

  if (!asaasConfigurado()) return { erro: "A cobranca ainda nao foi ligada." };

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta nao encontrada." };
  if (tenant.asaas_assinatura_id) return; // ja tem

  const plano = planoPorId(tenant.plano_id);
  if (!plano) return { erro: "Plano invalido." };

  // O Asaas recusa cliente sem CPF/CNPJ. Conferir aqui em vez de deixar a API
  // devolver erro em inglês que não diz à pessoa o que fazer.
  const doc = soDigitos(documento || tenant.cpf_cnpj || "");
  const problema = conferirDocumento(doc);
  if (problema) return { erro: problema };

  try {
    const cliente = await garantirCliente({
      tenantId,
      nome: tenant.nome_estudio,
      email: tenant.email,
      cpfCnpj: doc,
    });

    // Guardar só depois do Asaas aceitar: documento recusado não deve ficar
    // gravado como se fosse válido.
    await consultar("update tenants set cpf_cnpj = $1, atualizado_em = now() where id = $2", [
      doc,
      tenantId,
    ]);

    // Primeiro vencimento quando o teste acabar; se ja acabou, em 3 dias.
    const fimTrial = tenant.trial_ate ? new Date(tenant.trial_ate) : new Date();
    const minimo = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const vencimento = fimTrial > minimo ? fimTrial : minimo;

    const assinatura = await criarAssinatura({
      clienteAsaasId: cliente.id,
      tenantId,
      planoId: plano.id,
      precoCentavos: plano.precoCentavos,
      descricao: `${marca.nome} — ${plano.nome}`,
      primeiroVencimento: vencimento,
    });

    await consultar(
      `update tenants
          set asaas_cliente_id = $1, asaas_assinatura_id = $2,
              assinatura_criada_em = now(), atualizado_em = now()
        where id = $3`,
      [cliente.id, assinatura.id, tenantId],
    );

    revalidatePath("/painel/conta");
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "nao consegui criar a assinatura" };
  }
}

// --- cofre ----------------------------------------------------------------

export async function definirPrazoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const bruto = String(form.get("meses") ?? "");
  // "" significa sem prazo; qualquer outro valor precisa estar na lista oferecida.
  const meses = bruto === "" ? null : Number(bruto);
  if (meses !== null && !PRAZOS.some((p) => p.meses === meses)) return;

  await definirPrazo(galeriaId, tenantId, meses);
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

export async function arquivarAgoraAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;
  await arquivarAgora(galeriaId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
}

export async function reativarAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;
  await reativar(galeriaId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
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
