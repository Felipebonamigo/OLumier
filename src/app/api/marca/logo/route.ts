import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { TIPOS_LOGO, recusaDaLogo } from "@/lib/marca-estudio";
import { chaveDaLogo, urlDeUpload, conferirObjeto, apagarObjeto, armazenamentoConfigurado } from "@/lib/r2";

/**
 * Envio da logo do estúdio, no mesmo modelo das fotos: o navegador manda o
 * arquivo DIRETO para o bucket com uma URL assinada.
 *
 * Poderia ser mais simples — uma logo tem uns 200 KB e caberia num server
 * action. Não cabe: o limite padrão de corpo de um server action é 1 MB, e um
 * PNG exportado sem cuidado passa disso com facilidade. A pessoa veria um erro
 * genérico em algo que a gente disse aceitar até 2 MB.
 *
 *   POST   → devolve a URL de envio
 *   PUT    → confirma (confere o que REALMENTE chegou) e grava
 *   DELETE → tira a logo
 */

/** Só chave dentro da pasta de marca DESTE estúdio. */
function chaveDoTenant(chave: string, tenantId: string) {
  return chave.startsWith(`${tenantId}/marca/`);
}

async function exigirSessao() {
  const tenantId = await sessaoAtual();
  if (!tenantId) return null;
  return tenantId;
}

export async function POST(request: NextRequest) {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }

  let corpo: { mime?: string; bytes?: number };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const mime = String(corpo.mime ?? "");
  const bytes = Number(corpo.bytes ?? 0);

  const recusa = recusaDaLogo(mime, bytes);
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 415 });

  const chave = chaveDaLogo(tenantId, TIPOS_LOGO[mime]);
  const url = await urlDeUpload(chave, mime, 600);
  return NextResponse.json({ url, chave });
}

export async function PUT(request: NextRequest) {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });

  let corpo: { chave?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const chave = String(corpo.chave ?? "");
  // A chave vem do navegador. Sem esta conferência, um pedido forjado apontaria
  // a logo deste estúdio para um objeto de outro — ou para qualquer chave do
  // bucket.
  if (!chave || !chaveDoTenant(chave, tenantId)) {
    return NextResponse.json({ erro: "Envio inválido." }, { status: 400 });
  }

  /*
   * Confere o que REALMENTE chegou ao bucket, não o que o navegador disse que ia
   * enviar. O tamanho e o tipo do POST são promessa; isto é o fato. Sem esta
   * conferência, bastaria anunciar "120 KB, image/png" e enviar outra coisa.
   */
  let real: { bytes: number; mime: string };
  try {
    real = await conferirObjeto(chave);
  } catch {
    return NextResponse.json({ erro: "O arquivo não chegou. Tente de novo." }, { status: 409 });
  }

  const recusa = recusaDaLogo(real.mime, real.bytes);
  if (recusa) {
    // Recusado: não deixa o arquivo para trás sendo cobrado.
    await apagarObjeto(chave).catch(() => {});
    return NextResponse.json({ erro: recusa }, { status: 415 });
  }

  // Lê a anterior ANTES de trocar: depois do update não há mais como saber qual
  // objeto ficou sem dono.
  const antes = await consultarUm<{ logo_chave: string | null }>(
    "select logo_chave from tenants where id = $1",
    [tenantId],
  );
  await consultarUm("update tenants set logo_chave = $1 where id = $2", [chave, tenantId]);

  // A logo antiga vira lixo pago no mesmo instante em que a nova entra.
  const anterior = antes?.logo_chave;
  if (anterior && anterior !== chave) await apagarObjeto(anterior).catch(() => {});

  revalidatePath("/painel/conta");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });

  // Lê antes de limpar: `returning` num update devolve a linha DEPOIS, com o
  // campo já nulo, e aí não haveria mais como saber qual objeto apagar.
  const antes = await consultarUm<{ logo_chave: string | null }>(
    "select logo_chave from tenants where id = $1",
    [tenantId],
  );
  await consultarUm("update tenants set logo_chave = null where id = $1", [tenantId]);

  if (antes?.logo_chave) await apagarObjeto(antes.logo_chave).catch(() => {});

  revalidatePath("/painel/conta");
  return NextResponse.json({ ok: true });
}
