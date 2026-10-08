import "server-only";
import { consultar, emTransacao, type Consulta } from "./db";

/**
 * MOVER FOTOS PARA OUTRA GALERIA — sem subir de novo.
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Uma aluna manda só as prévias do ensaio numa galeria, e quando o resto fica
 * pronto precisa levar essas fotos para a galeria final. Sem isto, era apagar e
 * SUBIR de novo — horas de envio para mudar uma foto de endereço.
 *
 * ── O QUE MOVE, E O QUE NÃO PRECISA MOVER ─────────────────────────────────
 *
 * O arquivo fica onde está. A chave no bucket (`<estúdio>/<galeria>/<uuid>.jpg`)
 * carrega o id da galeria em que a foto nasceu, mas nada lê esse pedaço: quem
 * apaga, serve e varre órfão parte da LINHA de `medias`, que guarda a chave
 * inteira (`destruirGaleria`, `apagarArquivosDasMedias`, `varrer-orfaos`). Mudar
 * de galeria é, então, mudar `galeria_id` — zero byte copiado, zero risco de
 * ficar objeto pago sem dono. `scripts/testar-mover-entre-galerias.mjs` prende
 * isso: o teste confere que a chave NÃO mudou.
 *
 * O espaço também não precisa de conta: o gatilho de `medias` (migração 057)
 * refaz `bytes_total` das DUAS galerias quando `galeria_id` muda, e o uso do
 * estúdio fica igual porque o dono é o mesmo.
 *
 * ── O QUE FICA PENDURADO NA FOTO E TEM DE SER ACERTADO ────────────────────
 *
 *   capa da galeria / capa de capítulo (origem)  aponta para a foto → solta;
 *       uma capa apontando para foto de outra galeria é imagem que não é daquela
 *       entrega.
 *   favoritas   são de um visitante ANÔNIMO DAQUELA galeria (cookie por galeria)
 *       → não fazem sentido na nova; apagam, e a tela AVISA antes.
 *   rostos      são dado biométrico (LGPD) e só existem em galeria com a busca
 *       ligada → seguem a foto se o destino tem a busca ligada, e saem se não.
 *   acessos     são o histórico DA ENTREGA de origem ("o cliente baixou isto")
 *       → ficam, como prova do que aconteceu lá.
 */

/** O teto de fotos numa só operação — o mesmo de `moverFotosAction`. */
export const MAXIMO_POR_MOVIMENTO = 10_000;

/** O que se quer mover, dito de um jeito que o servidor consegue conferir. */
export type EscopoDoMovimento =
  /** As fotos que a pessoa marcou na grade. */
  | { tipo: "ids"; ids: string[] }
  /** O capítulo inteiro. O capítulo em si NÃO vai: só o que há dentro dele. */
  | { tipo: "capitulo"; secaoId: string }
  /** As fotos sem capítulo ("Outras fotos", ou o nome que o estúdio deu). */
  | { tipo: "soltas" };

export interface DestinoPossivel {
  id: string;
  titulo: string;
  subtitulo: string | null;
  dataEvento: string | null;
  total: number;
}

export interface CapituloDoDestino {
  id: string;
  nome: string;
  total: number;
}

export interface OpcoesDoDestino {
  capitulos: CapituloDoDestino[];
  /** O nome do grupo das soltas NESTA galeria. Nulo = "Outras fotos". */
  grupoSolto: string | null;
  /** Quantas marcações de favorita se perdem no caminho. */
  favoritas: number;
}

export type ResultadoDoMovimento =
  | { ok: true; movidas: number; favoritasRemovidas: number }
  | { ok: false; erro: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/**
 * As galerias para onde se pode mover: do MESMO estúdio, no ar, e não a de
 * origem.
 *
 * "No ar" é `estado = 'online'`. Galeria arquivada vive no cofre (o original
 * está em outro armazém, com outro custo) e a que está na lixeira vai ser
 * destruída em dias — jogar foto numa delas é perdê-la com um clique de
 * cerimônia. Para mover para uma, reative ou restaure antes.
 */
export async function galeriasParaMover(
  tenantId: string,
  origemId: string,
): Promise<DestinoPossivel[]> {
  const linhas = await consultar<{
    id: string;
    titulo: string;
    subtitulo: string | null;
    data_evento: string | null;
    total: number;
  }>(
    `select g.id, g.titulo, g.subtitulo, to_char(g.data_evento, 'YYYY-MM-DD') as data_evento,
            (select count(*)::int from medias m where m.galeria_id = g.id and m.pronto) as total
       from galerias g
      where g.tenant_id = $1 and g.estado = 'online' and g.id <> $2
      order by coalesce(g.data_evento, g.criado_em::date) desc, g.criado_em desc, g.id desc
      limit 1000`,
    [tenantId, origemId],
  );
  return linhas.map((l) => ({
    id: l.id,
    titulo: l.titulo,
    subtitulo: l.subtitulo,
    dataEvento: l.data_evento,
    total: l.total,
  }));
}

/**
 * Os ids que o escopo alcança — e SÓ os desta galeria e deste estúdio.
 *
 * É aqui que o id vindo do navegador deixa de ser confiável: a lista marcada
 * passa por `galeria_id = origem and tenant_id = estúdio`, então id de outra
 * galeria (ou de outro estúdio) simplesmente não casa e nunca entra no UPDATE.
 * `pronto` fica de fora de propósito: o que ainda está subindo não é foto, e
 * mover linha pela metade quebraria a confirmação do envio.
 *
 * Volta na ordem da galeria, que é a ordem que o destino vai herdar.
 */
async function idsDoEscopo(
  q: Consulta,
  tenantId: string,
  origemId: string,
  escopo: EscopoDoMovimento,
  travar: boolean,
): Promise<string[]> {
  const trava = travar ? "for update" : "";
  const base = `select id from medias
                 where galeria_id = $1 and tenant_id = $2 and pronto`;
  const ordem = `order by ordem, criado_em, id ${trava}`;

  let linhas: { id: string }[];
  if (escopo.tipo === "ids") {
    const ids = [...new Set(escopo.ids.filter(ehUuid))].slice(0, MAXIMO_POR_MOVIMENTO);
    if (ids.length === 0) return [];
    linhas = await q<{ id: string }>(`${base} and id = any($3::uuid[]) ${ordem}`, [
      origemId,
      tenantId,
      ids,
    ]);
  } else if (escopo.tipo === "capitulo") {
    if (!ehUuid(escopo.secaoId)) return [];
    linhas = await q<{ id: string }>(`${base} and secao_id = $3 ${ordem}`, [
      origemId,
      tenantId,
      escopo.secaoId,
    ]);
  } else {
    linhas = await q<{ id: string }>(`${base} and secao_id is null ${ordem}`, [origemId, tenantId]);
  }
  return linhas.slice(0, MAXIMO_POR_MOVIMENTO).map((l) => l.id);
}

/**
 * O que o destino oferece (capítulos, nome do grupo das soltas) e o que se
 * perde no caminho (favoritas) — para o modal dizer ANTES de a pessoa confirmar.
 *
 * Devolve null quando o destino não é um destino válido: o modal trata como
 * "não achei essa galeria", que é a verdade para quem forjou o id.
 */
export async function opcoesDoDestino(
  tenantId: string,
  origemId: string,
  destinoId: string,
  escopo: EscopoDoMovimento,
): Promise<OpcoesDoDestino | null> {
  if (!ehUuid(destinoId) || !ehUuid(origemId) || destinoId === origemId) return null;

  const [destino] = await consultar<{ grupo_solto: string | null }>(
    `select grupo_solto from galerias
      where id = $1 and tenant_id = $2 and estado = 'online'`,
    [destinoId, tenantId],
  );
  if (!destino) return null;

  const capitulos = await consultar<CapituloDoDestino>(
    `select s.id, s.nome,
            (select count(*)::int from medias m where m.secao_id = s.id and m.pronto) as total
       from secoes s
      where s.galeria_id = $1
      order by s.ordem, s.criado_em`,
    [destinoId],
  );

  const ids = await idsDoEscopo(consultar, tenantId, origemId, escopo, false);
  let favoritas = 0;
  if (ids.length > 0) {
    const [f] = await consultar<{ n: number }>(
      `select count(*)::int as n from favoritas where media_id = any($1::uuid[])`,
      [ids],
    );
    favoritas = f?.n ?? 0;
  }

  return { capitulos, grupoSolto: destino.grupo_solto, favoritas };
}

/**
 * Move as fotos do escopo para outra galeria, de uma vez e por inteiro: ou tudo
 * muda de lugar, ou nada muda.
 *
 * `secaoDestinoId` nulo manda para o grupo das soltas do destino ("Outras
 * fotos") — é o que acontece quando a pessoa não escolhe capítulo.
 *
 * As fotos entram no FIM da galeria de destino (e, portanto, no fim do capítulo
 * escolhido), na mesma ordem relativa que tinham. Quem quiser outra posição usa
 * o "para o início" e o arrastar da própria grade, que já existem.
 */
export async function moverMediasParaOutraGaleria(dados: {
  tenantId: string;
  origemId: string;
  destinoId: string;
  secaoDestinoId: string | null;
  escopo: EscopoDoMovimento;
}): Promise<ResultadoDoMovimento> {
  const { tenantId, origemId, destinoId, secaoDestinoId, escopo } = dados;

  if (!ehUuid(origemId) || !ehUuid(destinoId)) {
    return { ok: false, erro: "Galeria inválida." };
  }
  if (origemId === destinoId) {
    return { ok: false, erro: "Escolha uma galeria diferente da atual." };
  }
  if (secaoDestinoId !== null && !ehUuid(secaoDestinoId)) {
    return { ok: false, erro: "Capítulo inválido." };
  }

  return emTransacao<ResultadoDoMovimento>(async (q) => {
    /* As duas pontas precisam ser deste estúdio E estar no ar. A condição do
       tenant é a autorização inteira: um id de galeria alheia não aparece
       aqui, e a resposta é a de uma galeria que não existe. */
    const galerias = await q<{ id: string; rostos_ativos: boolean }>(
      `select id, rostos_ativos from galerias
        where id = any($1::uuid[]) and tenant_id = $2 and estado = 'online'`,
      [[origemId, destinoId], tenantId],
    );
    const origem = galerias.find((g) => g.id === origemId);
    const destino = galerias.find((g) => g.id === destinoId);
    if (!origem) return { ok: false, erro: "Não encontrei a galeria de origem." };
    if (!destino) {
      return { ok: false, erro: "Essa galeria não está disponível para receber fotos." };
    }

    /* O capítulo do destino tem de ser DO destino. Sem esta conferência o id
       viria direto do formulário: fotos apontando para o capítulo de outra
       galeria somem da grade de todas as duas. */
    if (secaoDestinoId) {
      const [secao] = await q<{ id: string }>(
        `select id from secoes where id = $1 and galeria_id = $2`,
        [secaoDestinoId, destinoId],
      );
      if (!secao) return { ok: false, erro: "Esse capítulo não existe na galeria escolhida." };
    }

    /* `for update`: duas abas movendo as mesmas fotos ao mesmo tempo esperam uma
       pela outra, e a segunda encontra a lista já vazia em vez de mover duas
       vezes. */
    const ids = await idsDoEscopo(q, tenantId, origemId, escopo, true);
    if (ids.length === 0) return { ok: true, movidas: 0, favoritasRemovidas: 0 };

    /* O fim da galeria de destino, contando também o que ainda está subindo:
       linha pendente já ocupa a posição dela (ver `criarMediaPendente`). */
    const [fim] = await q<{ n: number }>(
      `select coalesce(max(ordem), -1) + 1 as n from medias where galeria_id = $1`,
      [destinoId],
    );

    await q(
      `with posicoes as (
         select id, row_number() over (order by ordem, criado_em, id) - 1 as n
           from medias
          where id = any($1::uuid[])
       )
       update medias m
          set galeria_id = $2,
              secao_id = $3,
              ordem = $4 + p.n
         from posicoes p
        where m.id = p.id and m.tenant_id = $5`,
      [ids, destinoId, secaoDestinoId, fim?.n ?? 0, tenantId],
    );

    /* A capa da galeria e a capa de capítulo que eram uma destas fotos. */
    await q(
      `update galerias set capa_media_id = null
        where id = $1 and capa_media_id = any($2::uuid[])`,
      [origemId, ids],
    );
    await q(
      `update secoes set capa_media_id = null
        where galeria_id = $1 and capa_media_id = any($2::uuid[])`,
      [origemId, ids],
    );

    const apagadas = await q<{ id: string }>(
      `delete from favoritas where media_id = any($1::uuid[]) returning id`,
      [ids],
    );

    /* Dado biométrico só mora em galeria com a busca ligada. */
    if (destino.rostos_ativos) {
      await q(`update rostos set galeria_id = $1 where media_id = any($2::uuid[])`, [
        destinoId,
        ids,
      ]);
    } else {
      await q(`delete from rostos where media_id = any($1::uuid[])`, [ids]);
    }

    return { ok: true, movidas: ids.length, favoritasRemovidas: apagadas.length };
  });
}
