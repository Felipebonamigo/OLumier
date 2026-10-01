import { NextResponse, type NextRequest } from "next/server";
import { autorizacaoConfere, segredoDaPonte } from "@/lib/ponte-atomatiza";
import { situacaoDaConta } from "@/lib/pacote";

/**
 * O ATOMATIZA PERGUNTA: este CPF/CNPJ tem conta aqui, e assina?
 *
 * É o que a tela de assinar de lá usa para montar o pacote: "você já tem conta
 * na Galeria (bi•••@gmail.com)" ou "vamos criar a sua". Só o banco, sem Asaas.
 * O contrato está em `docs/pacote.md`; a mesma porta fechada de
 * `/api/ponte/conta` sem o segredo.
 */
export async function POST(request: NextRequest) {
  const segredo = segredoDaPonte();
  if (!segredo) return NextResponse.json({ erro: "ponte sem segredo configurado" }, { status: 503 });
  if (!autorizacaoConfere(request.headers.get("authorization"), segredo)) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  let corpo: { documento?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }
  return NextResponse.json(await situacaoDaConta(corpo?.documento));
}
