import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { registrarCanal, removerCanal, canalDoEstudio } from "@/lib/avisos";
import { temCripto } from "@/lib/cripto";

/**
 * O canal de avisos do estúdio — para onde contar que a entrega mudou.
 *
 * Quem registra é QUEM RECEBE (hoje, o Atomatiza), com um segredo que ele
 * mesmo inventa. É o desenho do webhook do Asaas, e ele tem duas virtudes:
 * quem recebe escolhe como quer ser reconhecido, e pode girar o segredo quando
 * quiser sem pedir nada a ninguém.
 *
 * Escopo `envio`, e não `leitura`: registrar um canal é dizer para onde os
 * eventos deste estúdio vão sair. Uma chave só de leitura, vazada, poderia
 * apontar o fluxo para fora — e apesar de o aviso não carregar nada sensível
 * (ver `lib/avisos.ts`), "quem lê" e "quem redireciona" não podem ser o mesmo
 * poder.
 */
export async function POST(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  if (!temCripto) {
    return NextResponse.json(
      { erro: "Este servidor ainda não guarda segredo cifrado (AVISOS_ENC_KEY)." },
      { status: 503 },
    );
  }

  let corpo: { url?: string; segredo?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const url = String(corpo.url ?? "").trim();
  const segredo = String(corpo.segredo ?? "");

  /*
   * SÓ `https`, e o endereço é conferido pelo parser.
   *
   * Isto aqui é um lugar de onde o nosso servidor vai FAZER requisição para um
   * endereço que outra pessoa escolheu. Aceitar `http` mandaria o segredo em
   * claro pela rede; aceitar qualquer coisa transformaria esta rota num jeito
   * de fazer o nosso servidor bater onde o dono da chave quiser.
   */
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return NextResponse.json({ erro: "Endereço inválido." }, { status: 400 });
  }
  if (destino.protocol !== "https:") {
    return NextResponse.json({ erro: "O endereço precisa ser https." }, { status: 400 });
  }
  /* Segredo curto não é segredo: com 16 bytes de aleatório de verdade não há
   * o que adivinhar, e recusar aqui é mais honesto que assinar com o que não
   * protege nada. */
  if (segredo.length < 24) {
    return NextResponse.json({ erro: "O segredo é curto demais." }, { status: 400 });
  }

  await registrarCanal(tenantId, destino.toString(), segredo);
  return NextResponse.json({ ok: true, url: destino.toString() }, { status: 200 });
}

/** O estado do canal, para quem registrou conferir que ainda está de pé. O
 *  segredo NUNCA volta — só o endereço e a última tentativa. */
export async function GET(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const canal = await canalDoEstudio(tenantId);
  return NextResponse.json({ registrado: Boolean(canal), url: canal?.url ?? null });
}

export async function DELETE(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "envio");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  await removerCanal(tenantId);
  return NextResponse.json({ ok: true });
}
