import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { formatoDaFonte, nomeDaFonte, recusaDaFonte } from "@/lib/fonte-estudio";
import {
  chaveDaLogo,
  urlDeUpload,
  urlDeLeitura,
  conferirObjeto,
  apagarObjeto,
  armazenamentoConfigurado,
} from "@/lib/r2";

/**
 * Envio da fonte própria do estúdio — mesmo desenho do envio da logo:
 *
 *   POST   → devolve a URL de envio
 *   PUT    → confirma (confere os BYTES que chegaram) e grava
 *   DELETE → tira a fonte
 *
 * O arquivo vai direto do navegador para o bucket, sem passar pelo nosso
 * servidor. Aqui o motivo é o mesmo da logo e mais forte: um OTF completo passa
 * fácil do limite de 1 MB de um server action, e a pessoa veria erro genérico em
 * algo que dissemos aceitar até 3 MB.
 */

/** Só chave dentro da pasta de marca DESTE estúdio. */
function chaveDoTenant(chave: string, tenantId: string) {
  return chave.startsWith(`${tenantId}/marca/`);
}

async function exigirSessao() {
  return await sessaoAtual();
}

export async function POST(request: NextRequest) {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }

  let corpo: { bytes?: number; nome?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  /* Só o TAMANHO é conferido aqui. O formato depende dos bytes, que ainda não
     existem — quem decide isso é o PUT, depois do envio. */
  const recusa = recusaDaFonte(Number(corpo.bytes ?? 0));
  if (recusa) return NextResponse.json({ erro: recusa }, { status: 415 });

  /* Reaproveita a pasta de marca: mesma vizinhança da logo, mesma regra de
     posse, e a varredura de órfãos já a conhece (`ehChaveDeMarca`). */
  const chave = chaveDaLogo(tenantId, "fonte");
  const url = await urlDeUpload(chave, "font/woff2", 600);
  return NextResponse.json({ url, chave });
}

export async function PUT(request: NextRequest) {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });

  let corpo: { chave?: string; nome?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const chave = String(corpo.chave ?? "");
  // A chave vem do navegador. Sem esta conferência, um pedido forjado apontaria
  // a fonte deste estúdio para um objeto de outro.
  if (!chave || !chaveDoTenant(chave, tenantId)) {
    return NextResponse.json({ erro: "Envio inválido." }, { status: 400 });
  }

  let real: { bytes: number };
  try {
    real = await conferirObjeto(chave);
  } catch {
    return NextResponse.json({ erro: "O arquivo não chegou. Tente de novo." }, { status: 409 });
  }

  /*
   * OS PRIMEIROS BYTES, LIDOS DO BUCKET.
   *
   * É a diferença entre acreditar e conferir. O `content-type` que chegou aqui
   * foi escolhido por nós no POST, e a extensão foi escolhida por quem enviou —
   * nenhum dos dois diz o que o arquivo É. Um Range de 4 bytes custa quase nada
   * e responde a única pergunta que importa: o navegador vai conseguir desenhar
   * isto como fonte?
   */
  let formato: { formato: string; css: string } | null = null;
  try {
    const url = await urlDeLeitura(chave, 120);
    const r = await fetch(url, {
      headers: { range: "bytes=0-7" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) formato = formatoDaFonte(new Uint8Array(await r.arrayBuffer()));
  } catch {
    formato = null;
  }

  const recusa = recusaDaFonte(real.bytes) ?? (formato ? null : "Este arquivo não é uma fonte. Aceitamos WOFF2, WOFF, OTF e TTF.");
  if (recusa) {
    // Recusado: não deixa o arquivo para trás sendo cobrado.
    await apagarObjeto(chave).catch(() => {});
    return NextResponse.json({ erro: recusa }, { status: 415 });
  }

  const nome = nomeDaFonte(String(corpo.nome ?? ""));

  // Lê a anterior ANTES de trocar: depois do update não há mais como saber qual
  // objeto ficou sem dono.
  const antes = await consultarUm<{ fonte_chave: string | null }>(
    "select fonte_chave from tenants where id = $1",
    [tenantId],
  );
  await consultarUm("update tenants set fonte_chave = $1, fonte_nome = $2 where id = $3", [
    chave,
    nome,
    tenantId,
  ]);

  const anterior = antes?.fonte_chave;
  if (anterior && anterior !== chave) await apagarObjeto(anterior).catch(() => {});

  revalidatePath("/painel/conta");
  return NextResponse.json({ ok: true, nome, formato: formato?.formato });
}

export async function DELETE() {
  const tenantId = await exigirSessao();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });

  const antes = await consultarUm<{ fonte_chave: string | null }>(
    "select fonte_chave from tenants where id = $1",
    [tenantId],
  );
  await consultarUm("update tenants set fonte_chave = null, fonte_nome = null where id = $1", [
    tenantId,
  ]);

  if (antes?.fonte_chave) await apagarObjeto(antes.fonte_chave).catch(() => {});

  revalidatePath("/painel/conta");
  return NextResponse.json({ ok: true });
}
