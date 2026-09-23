import { NextResponse, type NextRequest } from "next/server";
import { consultar, consultarUm } from "@/lib/db";
import { temAcessoLiberado } from "@/lib/galerias-publicas";
import { galeriasNoAr } from "@/lib/assinatura";
import { armazemDe, urlDaDerivada, urlDoOriginal } from "@/lib/armazem";
import { nomeComCapitulo, vaiPrefixar, nomeDoGrupoSolto } from "@/lib/nome-de-arquivo";

/**
 * URLs do lightbox e do download, assinadas SOB DEMANDA.
 *
 * Até 03/09/2026 a página da galeria assinava três URLs por foto e mandava as
 * três no HTML. Medido na galeria real de 111 fotos: 454 KB de página, 62 %
 * eram URL assinada, e preview + original — que a primeira pintura não usa —
 * eram 147 KB. Num casamento de 600 fotos, 800 KB a mais no 4G do salão.
 *
 * Agora o HTML leva só a miniatura. O preview é pedido aqui quando o lightbox
 * abre (a foto atual e as vizinhas), e o original quando alguém clica em
 * baixar. Uma ida e volta a mais nesses dois momentos, em troca de um terço da
 * página a menos para todo mundo — inclusive quem nunca amplia nada.
 *
 * ── A RÉGUA É A MESMA DA PÁGINA, E É AQUI QUE ELA MORA AGORA ───────────────
 *
 * Publicada, estúdio no ar, galeria no ar e no prazo, senha quando houver — e
 * download SÓ quando o fotógrafo permitiu. Essa última regra é a razão de a
 * rota existir com cuidado: antes o interruptor de download decidia se a URL
 * do original ia no HTML; agora decide se esta rota a entrega. "Esconder o
 * botão não é proteger: o interruptor precisa apagar o link" continua valendo,
 * e o link agora nem chega a nascer.
 */

const VALIDADE = 6 * 3600;
/** Teto de ids por pedido. "Baixar tudo" pede a galeria inteira de uma vez. */
const MAX_IDS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const galeria = await consultarUm<{
    senha_hash: string | null;
    estado: string;
    permite_download: boolean;
    expira_em: string | null;
    estudio_status: string;
    estudio_trial_ate: string | null;
  }>(
    `select g.senha_hash, g.estado, g.permite_download, g.expira_em,
            t.status as estudio_status, t.trial_ate as estudio_trial_ate
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.publicada`,
    [id],
  );
  if (!galeria) return NextResponse.json({ erro: "sem acesso" }, { status: 404 });
  /*
   * Trial abandonado e prazo vencido, na ordem da página (16/09/2026): ela diz
   * "fora do ar" e "o prazo terminou", e sem estas linhas quem guardou o id da
   * galeria assinava os originais por aqui mesmo assim. As mesmas portas de
   * `prepararEntrega`, que guarda o zip e a lista.
   */
  if (!galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate })) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.estado !== "online") return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  if (galeria.expira_em && new Date(galeria.expira_em) < new Date()) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }

  let corpo: { ids?: unknown; tipo?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  const { ids, tipo } = corpo;
  if (
    (tipo !== "preview" && tipo !== "download") ||
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_IDS ||
    !ids.every((i) => typeof i === "string" && UUID.test(i))
  ) {
    return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  }

  if (tipo === "download" && !galeria.permite_download) {
    return NextResponse.json({ erro: "download não permitido nesta galeria" }, { status: 403 });
  }

  /*
   * `galeria_id = $1` no where é o que impede pedir foto de outra galeria por
   * esta: id que não é desta simplesmente não volta.
   */
  const medias = await consultar<{
    id: string;
    chave: string;
    chave_preview: string | null;
    nome_original: string;
    armazem: string;
    capitulo: string | null;
  }>(
    `select m.id, m.chave, m.chave_preview, m.nome_original, m.armazem,
            s.nome as capitulo
       from medias m
       left join secoes s on s.id = m.secao_id
      where m.galeria_id = $1 and m.pronto and m.id = any($2::uuid[])`,
    [id, ids],
  );

  /*
   * O CAPÍTULO VAI NO NOME DO ARQUIVO, E A DECISÃO É AQUI (10/09/2026).
   *
   * Não no componente: a URL do arquivo é do armazém, ou seja, outra origem — e
   * nessa condição o navegador IGNORA o atributo `download` do nosso link e
   * obedece ao `Content-Disposition` que sai assinado daqui. Prefixo posto só no
   * cliente não mudaria uma letra no computador, que é onde o Juan disse estar
   * pensando quando pediu "separado em pastas".
   *
   * UMA consulta a mais, e só no download: conta os GRUPOS da galeria (cada
   * capítulo com foto, mais as fotos soltas como um grupo). Com um grupo só,
   * todas as fotos levariam o mesmo prefixo — que não separa nada e só alonga o
   * nome. É a mesma régua do menu de baixar, que também não oferece pasta
   * quando só existe uma.
   */
  /* O nome do grupo das soltas sai na MESMA consulta: ele é do fotógrafo desde
     a migração 037, e uma segunda ida ao banco por causa de um texto seria
     consulta a mais em cada lote de download. */
  const daGaleria =
    tipo === "download"
      ? await consultarUm<{ n: number; grupo_solto: string | null }>(
          `select (select count(*)::int
                     from (select secao_id from medias
                            where galeria_id = $1 and pronto
                            group by secao_id) g) as n,
                  (select grupo_solto from galerias where id = $1) as grupo_solto`,
          [id],
        )
      : null;
  const prefixar = vaiPrefixar(daGaleria?.n ?? 1);
  const grupoSolto = nomeDoGrupoSolto(daGaleria?.grupo_solto);

  const pares = await Promise.all(
    medias.map(async (m) => {
      const armazem = armazemDe(m.armazem);
      const url =
        tipo === "preview"
          ? await urlDaDerivada(m.chave_preview, m.chave, armazem, VALIDADE)
          : await urlDoOriginal(
              m.chave,
              armazem,
              VALIDADE,
              prefixar
                ? nomeComCapitulo(m.nome_original, m.capitulo ?? grupoSolto)
                : m.nome_original,
            );
      return [m.id, url] as const;
    }),
  );

  return NextResponse.json({ urls: Object.fromEntries(pares) });
}
