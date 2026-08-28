import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { consultarUm } from "@/lib/db";
import { galeriasNoAr } from "@/lib/assinatura";
import { enderecoDaGaleria } from "@/config/marca";

/**
 * Uma galeria, vista por quem tem a chave do estúdio.
 *
 * Existe para o outro lado de uma integração (hoje, o Atomatiza) responder
 * "como está a entrega deste contrato?" sem abrir o painel: publicada ou
 * rascunho, quantos arquivos, e o endereço canônico para mandar ao casal.
 *
 * ── `noAr` é CALCULADO, nunca a coluna crua ───────────────────────────────
 * `publicada` sozinha mente: uma galeria publicada pode estar no cofre, com o
 * prazo vencido, ou com o trial do estúdio abandonado além da carência — e em
 * todos esses casos o link NÃO abre para o casal. Quem consome esta rota vai
 * mostrar "as fotos estão prontas" para um cliente final; a resposta precisa
 * ser a mesma que a página pública daria, e a régua é a mesma dela
 * (`galeriasNoAr` + estado + prazo — ver src/app/g/[estudio]/[galeria]).
 *
 * ── O `tenant_id` no WHERE não é redundância ──────────────────────────────
 * Este banco não tem RLS: o isolamento entre estúdios é feito consulta a
 * consulta, e é ele que impede um id adivinhado de alcançar galeria alheia.
 * Id de fora do formato uuid nem chega ao banco — vira o mesmo 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  /* O mesmo 404 para "não é uuid" e "não é seu": responder diferente diria a
   * um curioso quais ids existem. */
  const naoExiste = () => NextResponse.json({ erro: "Galeria não encontrada." }, { status: 404 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return naoExiste();
  }

  const galeria = await consultarUm<{
    id: string;
    slug: string;
    titulo: string;
    subtitulo: string | null;
    data_evento: Date | null;
    publicada: boolean;
    estado: string;
    expira_em: Date | null;
    origem: string | null;
    origem_ref: string | null;
    bytes: string;
    total_medias: number;
    criado_em: Date;
    estudio_slug: string;
    estudio_status: string;
    estudio_trial_ate: Date | null;
  }>(
    `select g.id, g.slug, g.titulo, g.subtitulo, g.data_evento, g.publicada, g.estado,
            g.expira_em, g.origem, g.origem_ref, g.bytes_total::text as bytes,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total_medias,
            g.criado_em,
            t.slug as estudio_slug, t.status as estudio_status, t.trial_ate as estudio_trial_ate
       from galerias g
       join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2 and g.estado <> 'lixeira'`,
    [id, tenantId],
  );
  if (!galeria) return naoExiste();

  const vencida = Boolean(galeria.expira_em && new Date(galeria.expira_em) < new Date());
  const noAr =
    galeria.publicada &&
    galeria.estado === "online" &&
    !vencida &&
    galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate });

  return NextResponse.json({
    id: galeria.id,
    slug: galeria.slug,
    titulo: galeria.titulo,
    subtitulo: galeria.subtitulo,
    dataEvento: galeria.data_evento,
    publicada: galeria.publicada,
    estado: galeria.estado,
    noAr,
    origem: galeria.origem,
    origemRef: galeria.origem_ref,
    totalMedias: galeria.total_medias,
    bytes: galeria.bytes,
    criadoEm: galeria.criado_em,
    estudioSlug: galeria.estudio_slug,
    url: enderecoDaGaleria(galeria.estudio_slug, galeria.slug),
  });
}
