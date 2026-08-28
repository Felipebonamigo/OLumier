import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao, tenantQuePodeEnviar } from "@/lib/auth-api";
import { consultar, consultarUm } from "@/lib/db";
import { buscarTenantPorId, criarGaleria, type Galeria } from "@/lib/tenants";
import { registrarEvento, ACOES } from "@/lib/eventos";
import { enderecoDaGaleria } from "@/config/marca";

/**
 * Listar e criar galeria — as duas coisas que faltavam para um programa
 * conseguir publicar.
 *
 * Criar galeria vivia SÓ como server action (`criarGaleriaAction`), que usa
 * `redirect()` e `revalidatePath`: útil para o formulário do painel e
 * inalcançável de fora do React. Sem esta rota, a chave de API autorizaria um
 * plugin do Lightroom que não teria onde publicar. Ver docs/chave-de-api.md.
 *
 * O painel continua usando a server action — ela não sai daqui. Esta rota é a
 * porta de fora, e as duas chamam a mesma `criarGaleria` do `lib/tenants`.
 *
 * ── `referenciaExterna` — o Atomatiza criando a galeria de um contrato ─────
 * Quem manda `referenciaExterna` no POST está dizendo "esta galeria representa
 * o MEU registro tal" — hoje, um contrato do Atomatiza. A rota guarda isso em
 * (origem, origem_ref) e passa a responder de forma IDEMPOTENTE: o mesmo
 * contrato pedindo de novo recebe a galeria que já existe (200), não uma
 * "ana-pedro-2" ao lado (ver migração 026). A referência é opaca — a gente
 * guarda e devolve, nunca interpreta.
 */

/** A quem esta rota diz "atomatiza": o único criador de fora que existe hoje. */
const ORIGEM_INTEGRACAO = "atomatiza";

/** A resposta de criação, igual nos dois caminhos (criou agora / já existia). */
async function corpoDaGaleria(galeria: Galeria, estudioSlug: string) {
  return {
    id: galeria.id,
    slug: galeria.slug,
    titulo: galeria.titulo,
    /*
     * O endereço já sai CANÔNICO e pronto: é este link que o outro sistema vai
     * guardar no contrato e mandar ao casal. Montá-lo lá exigiria conhecer o
     * nosso domínio e o slug do estúdio — e no dia em que qualquer um dos dois
     * mudasse, todo consumidor montaria link velho.
     */
    estudioSlug,
    url: enderecoDaGaleria(estudioSlug, galeria.slug),
  };
}

/** As galerias do estúdio, para o plugin mostrar a lista de destinos. */
export async function GET(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  /*
   * A lixeira fica de fora: para quem publica, galeria apagada não existe, e
   * oferecê-la como destino faria o plugin ressuscitar entrega que o fotógrafo
   * mandou apagar. O cofre entra, com o estado à mostra — dá para ver que está
   * arquivada e reativar no painel.
   *
   * `origem`/`origem_ref` entram para quem monta um seletor de "vincular
   * galeria existente" poder mostrar quais já pertencem a um registro dele.
   */
  const galerias = await consultar(
    `select id, slug, titulo, subtitulo, data_evento, publicada, estado,
            origem, origem_ref, bytes_total::text as bytes
       from galerias
      where tenant_id = $1 and estado <> 'lixeira'
      order by criado_em desc`,
    [tenantId],
  );

  return NextResponse.json({ galerias });
}

/** Cria a galeria. A coleção publicada do Lightroom vira uma destas. */
export async function POST(request: NextRequest) {
  // Autoriza E confere o portão de cobrança — ver tenantQuePodeEnviar.
  const quem = await tenantQuePodeEnviar(request);
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });

  let corpo: {
    titulo?: string;
    subtitulo?: string;
    dataEvento?: string;
    referenciaExterna?: string;
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const titulo = String(corpo.titulo ?? "").trim();
  if (!titulo) return NextResponse.json({ erro: "Dê um nome para a galeria." }, { status: 400 });

  /* Curta porque vira metade de um índice único: uma referência de verdade é um
   * id, e id não tem 200 caracteres. Recusar cedo é melhor que truncar — uma
   * referência truncada colidiria com outra e a idempotência viraria mistura. */
  const referencia = String(corpo.referenciaExterna ?? "").trim();
  if (referencia.length > 200) {
    return NextResponse.json({ erro: "A referência externa é longa demais." }, { status: 400 });
  }

  const tenant = await buscarTenantPorId(quem.tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

  /*
   * IDEMPOTÊNCIA, do jeito burro que funciona: procurar antes, e deixar o
   * índice único da migração 026 segurar a corrida entre duas chamadas
   * simultâneas. Quem chegar segundo na corrida recebe 23505 do banco e
   * devolve a galeria do primeiro — o chamador não distingue, e é o ponto.
   */
  const buscarExistente = () =>
    consultarUm<Galeria>(
      `select * from galerias
        where tenant_id = $1 and origem = $2 and origem_ref = $3 and estado <> 'lixeira'`,
      [quem.tenantId, ORIGEM_INTEGRACAO, referencia],
    );

  if (referencia) {
    const existente = await buscarExistente();
    if (existente) {
      return NextResponse.json(await corpoDaGaleria(existente, tenant.slug), { status: 200 });
    }
  }

  /* `criarGaleria` resolve a colisão de slug sozinha (ana-pedro, ana-pedro-2…):
   * o plugin pode publicar duas coleções de mesmo nome sem escolher endereço. */
  const nascer = () =>
    criarGaleria({
      tenantId: quem.tenantId,
      titulo,
      subtitulo: String(corpo.subtitulo ?? "").trim() || undefined,
      dataEvento: String(corpo.dataEvento ?? "").trim() || undefined,
      origem: referencia ? { de: ORIGEM_INTEGRACAO, ref: referencia } : undefined,
    });

  /*
   * DUAS CORRIDAS DIFERENTES CHEGAM AQUI COMO O MESMO 23505, e tratá-las igual
   * transforma uma delas em erro 500 sem explicação. Quem separa é o NOME do
   * índice violado:
   *
   *   galerias_origem_unica        → o mesmo contrato pediu duas vezes ao mesmo
   *                                  tempo. A galeria do primeiro é a resposta
   *                                  certa para o segundo — é a idempotência
   *                                  funcionando, e o chamador não distingue.
   *
   *   galerias_tenant_id_slug_key  → dois contratos DIFERENTES com o mesmo
   *                                  título, ao mesmo tempo: os dois calcularam
   *                                  "ana-e-pedro" antes de qualquer um gravar.
   *                                  Aqui não há galeria do outro para devolver
   *                                  — a resposta certa é tentar de novo, e a
   *                                  segunda volta já enxerga o slug tomado e
   *                                  escolhe "ana-e-pedro-2".
   */
  const nomeDoIndice = (e: unknown) =>
    (e as { code?: string; constraint?: string })?.code === "23505"
      ? (e as { constraint?: string }).constraint
      : undefined;

  let galeria: Galeria | null | undefined;
  try {
    galeria = await nascer();
  } catch (e) {
    const indice = nomeDoIndice(e);

    if (indice === "galerias_origem_unica" && referencia) {
      const existente = await buscarExistente();
      if (!existente) throw e;
      return NextResponse.json(await corpoDaGaleria(existente, tenant.slug), { status: 200 });
    }

    if (indice === "galerias_tenant_id_slug_key") {
      // Uma segunda tentativa, e só uma: se ela também bater, é sinal de algo
      // que repetir não resolve, e insistir só esconderia o problema.
      galeria = await nascer();
    } else {
      throw e;
    }
  }

  /*
   * Só a criação DE FORA vira evento de auditoria — é a que alguém pode
   * questionar depois ("quem criou esta galeria?"), e a resposta precisa
   * sobreviver à galeria. Criação pelo painel continua sem evento.
   */
  if (referencia) {
    await registrarEvento({
      tenantId: quem.tenantId,
      estudio: tenant.nome_estudio,
      ator: "estudio",
      acao: ACOES.GALERIA_CRIADA_DE_FORA,
      alvoTipo: "galeria",
      alvoId: galeria!.id,
      detalhe: { titulo, origem: ORIGEM_INTEGRACAO, origem_ref: referencia },
    });
  }

  return NextResponse.json(await corpoDaGaleria(galeria!, tenant.slug), { status: 201 });
}
