"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminDaRequisicao } from "@/lib/portao-admin";
import { ACOES, registrarEvento } from "@/lib/eventos";
import { apagarCusto, gravarCusto } from "@/lib/custos-da-sociedade";
import { lerCusto, type ErroDoCusto } from "@/lib/custos-da-sociedade-regras";
import { mesValido } from "@/lib/caixa-dos-socios";

/**
 * OS CUSTOS DA SOCIEDADE — as duas únicas escritas do caixa dos sócios.
 *
 * Todo export de um arquivo "use server" é um endpoint que qualquer pessoa
 * logada consegue chamar, com qualquer corpo. O portão da PÁGINA não protege
 * nada aqui: cada ação confere o admin de novo, e para quem não é, a resposta
 * é a mesma de um endereço que não existe.
 *
 * Só números da lista mudam — nenhum dinheiro, conta ou cobrança. Cada
 * mudança vai para a auditoria com quem fez, o antes (quando havia) e o depois.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function voltar(form: FormData, resultado: { ok: string } | { erro: ErroDoCusto }): never {
  const q = new URLSearchParams();
  const mes = mesValido(form.get("mes"));
  if (mes) q.set("mes", mes);
  if ("ok" in resultado) q.set("ok", resultado.ok);
  else q.set("erro", resultado.erro);
  redirect(`/painel/admin/caixa?${q}#custos`);
}

export async function salvarCustoAction(form: FormData): Promise<void> {
  const admin = await adminDaRequisicao();
  if (!admin) redirect("/painel");

  const idBruto = form.get("id");
  const id = typeof idBruto === "string" && idBruto ? idBruto : null;
  if (id && !UUID.test(id)) voltar(form, { erro: "nao-achou" });

  const lido = lerCusto({
    nome: form.get("nome"),
    sistema: form.get("sistema"),
    valor: form.get("valor"),
    confirmado: form.get("confirmado"),
    nota: form.get("nota"),
  });
  if ("erro" in lido) voltar(form, { erro: lido.erro });

  let gravado: { id: string; nome: string } | null;
  try {
    gravado = await gravarCusto(id, lido.custo, admin.id);
  } catch (e) {
    console.error("[caixa] não consegui gravar o custo:", e);
    voltar(form, { erro: "banco" });
  }
  if (!gravado) voltar(form, { erro: "nao-achou" });

  await registrarEvento({
    tenantId: admin.id,
    estudio: admin.nome_estudio,
    ator: "estudio",
    acao: ACOES.CUSTO_DA_SOCIEDADE,
    alvoTipo: "custo",
    alvoId: gravado.id,
    detalhe: {
      operacao: id ? "alterado" : "criado",
      nome: lido.custo.nome,
      sistema: lido.custo.sistema,
      centavos_por_mes: lido.custo.centavosPorMes,
      confirmado: lido.custo.confirmado,
    },
  });

  revalidatePath("/painel/admin/caixa");
  revalidatePath("/painel/admin");
  voltar(form, { ok: id ? "alterado" : "criado" });
}

export async function apagarCustoAction(form: FormData): Promise<void> {
  const admin = await adminDaRequisicao();
  if (!admin) redirect("/painel");

  const id = form.get("id");
  if (typeof id !== "string" || !UUID.test(id)) voltar(form, { erro: "nao-achou" });

  let apagado: Awaited<ReturnType<typeof apagarCusto>>;
  try {
    apagado = await apagarCusto(id);
  } catch (e) {
    console.error("[caixa] não consegui apagar o custo:", e);
    voltar(form, { erro: "banco" });
  }
  if (!apagado) voltar(form, { erro: "nao-achou" });

  await registrarEvento({
    tenantId: admin.id,
    estudio: admin.nome_estudio,
    ator: "estudio",
    acao: ACOES.CUSTO_DA_SOCIEDADE,
    alvoTipo: "custo",
    alvoId: id,
    detalhe: { operacao: "apagado", ...apagado },
  });

  revalidatePath("/painel/admin/caixa");
  revalidatePath("/painel/admin");
  voltar(form, { ok: "apagado" });
}
