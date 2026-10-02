import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { recadosDaGaleria } from "@/lib/recados";

/**
 * OS RECADOS DA GALERIA, PARA O OUTRO SISTEMA LER (02/10/2026).
 *
 * Juan, 01/10/2026: "já integrará o feedback que as pessoas deram na galeria,
 * dentro do próprio sistema Atomatiza. Talvez como um 'registro de contato'".
 *
 * ── POR QUE O TEXTO É BUSCADO, E NÃO EMPURRADO ────────────────────────────
 *
 * O canal de avisos (`lib/avisos.ts`) diz "tem recado novo" e NADA mais — é a
 * regra 2 dele: "o que vai no aviso é o mínimo, nem título, nem endereço, nem
 * nada do casal". Quem quiser o texto vem aqui, com a chave de API do próprio
 * estúdio.
 *
 * A diferença importa no pior caso. Se o segredo do canal vazar, um aviso forjado
 * conseguiria, no máximo, provocar uma busca autenticada que devolve o que já era
 * daquele estúdio. Empurrando o texto, o mesmo vazamento permitiria ESCREVER a
 * palavra inventada de um casal dentro do CRM de um fotógrafo — e de lá ela sairia
 * como depoimento.
 *
 * ── A TRANCA É `galeriaDoPainel` ──────────────────────────────────────────
 *
 * A mesma do painel, que amarra `tenant_id`: galeria de outro estúdio não existe
 * para esta chave, e a resposta é 404 — a mesma de um id que nunca existiu, para
 * não confirmar nada a quem está tentando.
 *
 * ── `desde` ───────────────────────────────────────────────────────────────
 *
 * Quem importa recado para o próprio sistema não pode reimportar o que já
 * importou. `?desde=<ISO>` devolve só o que foi escrito DEPOIS daquele instante,
 * e a resposta sempre traz o `quando` de cada um, que é o valor a guardar para a
 * próxima vez.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  /* `leitura`: ler recado não escreve nada. Chave de `envio` também passa — ver
     `escopoAtende` em `lib/auth-api.ts`. */
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) {
    return NextResponse.json({ erro: "Chave inválida ou ausente." }, { status: 401 });
  }

  const { id } = await params;
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) return NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });

  const desdeBruto = request.nextUrl.searchParams.get("desde");
  const desde = desdeBruto ? new Date(desdeBruto) : null;
  /* Data que não é data vira "sem corte", e não erro: o outro lado guardando um
     valor estranho receberia a lista inteira de novo — chato, nunca perda. */
  const corte = desde && !Number.isNaN(desde.getTime()) ? desde : null;

  const todos = await recadosDaGaleria(galeria.id);
  const recados = todos
    .filter((r) => !corte || r.quando > corte)
    .map((r) => ({
      id: r.id,
      /* Quem escreveu, como ela se identificou. Pode ser só nome — a galeria
         aceita nome sem e-mail para deixar recado. */
      nome: r.nome,
      email: r.email,
      texto: r.texto,
      notas: r.notas,
      /* A autorização para usar como depoimento, dada por ela no momento em que
         escreveu. O outro lado precisa dela junto do texto: é o que separa "posso
         publicar isto no meu site" de "não posso". */
      autorizaDepoimento: r.autoriza,
      quando: r.quando.toISOString(),
      /* Qual envio desta identidade é este. Dois textos diferentes com o mesmo
         e-mail não são correção: a identidade não é verificada (migração 060), e
         quem vai publicar um depoimento precisa ver isso. */
      ordem: r.ordem,
      deste: r.total,
    }));

  return NextResponse.json({ galeriaId: galeria.id, recados });
}
