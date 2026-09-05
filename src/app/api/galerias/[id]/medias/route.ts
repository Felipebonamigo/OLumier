import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { apagarTodasAsMedias } from "@/lib/medias";
import { apagarObjeto } from "@/lib/r2";

/**
 * APAGAR TODAS AS FOTOS DA GALERIA DE UMA VEZ.
 *
 * ── DE ONDE VEIO ──────────────────────────────────────────────────────────
 *
 * Juan, 05/09/2026: o envio morreu no meio (ele trocou de aba), e ele quis
 * desfazer o que tinha subido para refazer do zero. Só existia remoção
 * individual: 519 cliques em "remover", um por cartão.
 *
 * ── POR QUE É DELETE NUMA ROTA, E NÃO UMA SERVER ACTION ───────────────────
 *
 * Porque a remoção de UMA foto já é `DELETE /api/medias/[id]/confirmar`, e o
 * que ela faz depois do banco — apagar original, thumb e preview no bucket — é
 * exatamente o mesmo trabalho. Duas portas para a mesma operação divergem: a
 * que ninguém olha esquece de apagar a derivada, e a conta do bucket cresce com
 * arquivo que nenhuma linha do banco menciona.
 *
 * ── A ORDEM IMPORTA ───────────────────────────────────────────────────────
 *
 * Banco primeiro, bucket depois. Ao contrário, uma falha no meio deixaria linha
 * apontando para objeto que não existe mais — e a galeria mostraria foto
 * quebrada para o cliente. Na ordem certa, o pior caso é objeto órfão no
 * bucket, que `varrer-orfaos.mjs` recolhe depois e que ninguém vê.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id: galeriaId } = await params;
  const apagadas = await apagarTodasAsMedias(galeriaId, tenantId);

  /* `null` é "esta galeria não é sua" — 404 e não 403, a mesma resposta que o
     painel dá, para não confirmar que o id existe. Galeria vazia devolve lista
     vazia, que é sucesso: apagar nada é o resultado pedido. */
  if (apagadas === null) {
    return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  }

  await Promise.all(
    apagadas
      .flatMap((m) => [m.chave, m.chave_thumb, m.chave_preview])
      .filter((c): c is string => Boolean(c))
      .map((c) => apagarObjeto(c).catch(() => {})),
  );

  return NextResponse.json({ ok: true, apagadas: apagadas.length });
}
