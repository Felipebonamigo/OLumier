import { NextResponse, type NextRequest } from "next/server";
import { sessaoAtual } from "@/lib/auth";
import { apagarTodasAsMedias } from "@/lib/medias";
import { apagarArquivosDasMedias } from "@/lib/armazem";

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
/** Ids vêm do navegador; formato errado é recusa, nunca interpretação. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await sessaoAtual();
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  /*
   * SEM CORPO é "todas" — o que esta rota sempre fez, e é o que o botão
   * "apagar todas" manda. COM `ids` são só aquelas (pedido do Juan em
   * 28/09/2026: ele marcava fotos e não tinha como apagar as marcadas).
   *
   * O corpo é opcional de propósito: `DELETE` sem corpo é o caso normal, e
   * `request.json()` estoura com corpo vazio. Ler e engolir o erro mantém o
   * caminho antigo intacto sem um segundo endereço para a mesma coisa.
   *
   * Lista malformada é 400 ANTES de qualquer apagamento: um `ids` que não é
   * lista de uuid não pode virar "ah, então apague tudo" — que é exatamente o
   * que acontecia até aqui, porque o corpo sequer era lido.
   */
  const corpo = await request.json().catch(() => null);
  let ids: string[] | undefined;
  if (corpo && typeof corpo === "object" && "ids" in corpo) {
    const lista = (corpo as { ids: unknown }).ids;
    if (!Array.isArray(lista) || !lista.every((i) => typeof i === "string" && UUID.test(i))) {
      return NextResponse.json({ erro: "Lista de fotos inválida." }, { status: 400 });
    }
    ids = lista as string[];
  }

  const { id: galeriaId } = await params;
  const apagadas = await apagarTodasAsMedias(galeriaId, tenantId, ids);

  /* `null` é "esta galeria não é sua" — 404 e não 403, a mesma resposta que o
     painel dá, para não confirmar que o id existe. Galeria vazia devolve lista
     vazia, que é sucesso: apagar nada é o resultado pedido. */
  if (apagadas === null) {
    return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  }

  /*
   * ── UMA REQUISIÇÃO POR LOTE, E NÃO POR CHAVE (18/09/2026) ───────────────
   *
   * Aqui saía um `DeleteObject` por chave, todos de uma vez. Numa galeria de
   * 286 fotos são 858 chamadas simultâneas ao armazém — e a tela da Ana
   * Carolina respondeu "Não foi possível apagar agora. Tente de novo.".
   *
   * `apagarArquivosDasMedias` agrupa em lotes de 1000 e ainda manda o ORIGINAL
   * para o fornecedor certo: o `apagarObjeto` do R2 errava de balde no que já
   * está no B2 e deixava arquivo pago para trás.
   *
   * Falha de bucket NÃO derruba a resposta: as linhas já foram, e dizer "não
   * deu" para quem acabou de ver a galeria esvaziar é pior do que o órfão que
   * `varrer-orfaos.mjs` recolhe depois.
   */
  const limpeza = await apagarArquivosDasMedias(apagadas);
  if (limpeza.falhou) {
    console.error(`apagar todas (galeria ${galeriaId}): ${limpeza.falhou}`);
  }

  return NextResponse.json({ ok: true, apagadas: apagadas.length });
}
