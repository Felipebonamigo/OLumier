import "server-only";
import { consultar, consultarUm } from "./db";
import { armazemDe, urlDoOriginal } from "./armazem";
import type { Entrega } from "./entrega-da-galeria";
import { entradasDaParte } from "./entradas-do-zip";
import {
  chaveDeCache,
  VALIDADE_DAS_URLS,
  type Manifesto,
  type RelatoDeZip,
  type TipoDeZip,
} from "./zip-remoto";

/**
 * O PEDIDO DE ZIP QUE ATRAVESSA PARA O SERVIDOR — o lado do app.
 *
 * O navegador é redirecionado para outra máquina, e lá não há cookie: a senha
 * da galeria e a identificação de quem escolheu as favoritas ficam aqui. Por
 * isso o app resolve TUDO antes do redirecionamento (travas, lista de fotos,
 * nome de cada arquivo dentro do zip) e grava; o servidor de ZIP só lê o
 * resultado. Ver `lib/zip-remoto.ts` e docs/servidor-zip.md.
 */

/** O que fica gravado por foto: o bastante para nomear, conferir e versionar. */
export interface EntradaGravada {
  id: string;
  nome: string;
  tamanho: number;
  versao: number;
}

export interface PedidoDeZip {
  id: string;
  galeria_id: string;
  tenant_id: string;
  tipo: TipoDeZip;
  secao_id: string | null;
  entradas: EntradaGravada[];
  nome_do_zip: string;
  ip_hash: string | null;
  user_agent: string | null;
  /** Quem clicou em baixar. Ver migração 041. */
  pessoa_id: string | null;
  /** Qual parte da galeria grande, ou nulo no ZIP inteiro. Migração 070. */
  parte: number | null;
  expira_em: string;
}

export async function criarPedidoDeZip(
  galeriaId: string,
  entrega: Entrega,
  quem: { ipHash: string | null; userAgent: string | null; pessoaId?: string | null },
  secaoId: string | null,
  /* A parte da galeria grande (`?parte=`), ou nulo para o ZIP inteiro. Ver
     `lib/partes-do-zip.ts`. */
  parte: number | null = null,
): Promise<{ id: string; nomeDoZip: string } | null> {
  const daParte = entradasDaParte(entrega, parte);
  /* A galeria mudou entre o menu e o clique e esta parte não existe mais. */
  if (!daParte) return null;
  const { nomeDoZip, arquivos } = daParte;
  const entradas: EntradaGravada[] = arquivos.map((a) => ({
    id: a.media.id,
    nome: a.nome,
    tamanho: a.tamanho,
    versao: a.media.versao ?? 1,
  }));
  const linha = await consultarUm<{ id: string }>(
    `insert into pedidos_zip (galeria_id, tipo, secao_id, entradas, nome_do_zip, ip_hash, user_agent, pessoa_id, parte, partes)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      galeriaId,
      entrega.tipo,
      secaoId,
      JSON.stringify(entradas),
      nomeDoZip,
      quem.ipHash,
      quem.userAgent?.slice(0, 300) ?? null,
      quem.pessoaId ?? null,
      daParte.parte?.numero ?? null,
      daParte.parte?.de ?? null,
    ],
  );
  if (!linha) throw new Error("o pedido de zip não foi gravado");
  return { id: linha.id, nomeDoZip };
}

export async function lerPedidoDeZip(id: string): Promise<PedidoDeZip | null> {
  return consultarUm<PedidoDeZip>(
    `select p.id, p.galeria_id, g.tenant_id, p.tipo, p.secao_id, p.entradas,
            p.nome_do_zip, p.ip_hash, p.user_agent, p.pessoa_id, p.parte, p.expira_em
       from pedidos_zip p join galerias g on g.id = p.galeria_id
      where p.id = $1`,
    [id],
  );
}

/**
 * O manifesto que o servidor de ZIP recebe.
 *
 * A lista de nomes e tamanhos vem do pedido, congelada no clique. A URL de
 * cada original é assinada AGORA, e só quando pedida: no arquivo guardado o
 * servidor não precisa de URL nenhuma, e assinar 2 000 delas a cada download
 * seria CPU do VPS gasta em vão.
 *
 * Foto que sumiu entre o clique e a montagem (apagada pelo fotógrafo) sai da
 * lista em vez de derrubar o ZIP inteiro — e com ela some da chave de cache,
 * então o arquivo guardado com ela também deixa de ser encontrado.
 */
export async function manifestoDoPedido(
  pedido: PedidoDeZip,
  comUrls: boolean,
): Promise<Manifesto> {
  const ids = pedido.entradas.map((e) => e.id);
  const medias = await consultar<{
    id: string;
    chave: string;
    armazem: string;
    bytes: string;
    versao: number;
    criado_em: Date;
  }>(
    `select id, chave, armazem, bytes, versao, criado_em
       from medias
      where galeria_id = $1 and pronto and id = any($2::uuid[])`,
    [pedido.galeria_id, ids],
  );
  const porId = new Map(medias.map((m) => [m.id, m]));

  const vivas = pedido.entradas.filter((e) => porId.has(e.id));
  /* O tamanho e a versão ATUAIS: uma republicação entre o clique e a montagem
     muda os dois, e o ZIP tem de descrever o arquivo que vai buscar. */
  const atuais = vivas.map((e) => {
    const m = porId.get(e.id)!;
    return { ...e, tamanho: Number(m.bytes), versao: m.versao };
  });

  const arquivos = await Promise.all(
    atuais.map(async (e) => {
      const m = porId.get(e.id)!;
      return {
        nome: e.nome,
        tamanho: e.tamanho,
        url: comUrls
          ? await urlDoOriginal(m.chave, armazemDe(m.armazem), VALIDADE_DAS_URLS)
          : undefined,
      };
    }),
  );

  return {
    pedidoId: pedido.id,
    galeriaId: pedido.galeria_id,
    tipo: pedido.tipo,
    nomeDoZip: pedido.nome_do_zip,
    chaveDeCache: chaveDeCache(
      pedido.galeria_id,
      pedido.tipo,
      pedido.secao_id,
      atuais.map((e) => ({ nome: `${e.nome}#${e.versao}`, tamanho: e.tamanho })),
    ),
    arquivos,
    dataDoConteudo: new Date(
      Math.max(0, ...atuais.map((e) => new Date(porId.get(e.id)!.criado_em).getTime())),
    ).toISOString(),
  };
}

/**
 * O ZIP chegou inteiro: as quedas ANTERIORES do mesmo download deixam de ser
 * queda (migração 050).
 *
 * "O mesmo download" é o mesmo ZIP (galeria, tipo e capítulo) pedido pela
 * mesma pessoa — o mesmo pedido (o "Retomar" e o gerenciador de download do
 * Android reabrem o mesmo link) ou outro pedido do mesmo IP ou da mesma pessoa
 * identificada (quem clicou em baixar de novo). Até 12 h para trás, que é a
 * vida de um pedido: é pelo pedido que se sabe quem foi, e ele é apagado
 * depois disso.
 *
 * Feito AGORA porque depois não dá: quando o pedido some, `pedido_id` vira
 * nulo nas entregas e nada mais liga a queda à entrega.
 *
 * Pelo VPS não há pedido gravado, então as quedas de lá não são reconhecidas.
 * É o caminho de reserva, e o painel já avisa quando ele está em uso.
 */
async function marcarQuedasRetomadas(pedidoId: string): Promise<void> {
  await consultar(
    `update entregas_zip a set retomado = true
       from pedidos_zip antes, pedidos_zip agora
      where agora.id = $1
        and a.pedido_id = antes.id
        and a.evento = 'abortado' and not a.retomado
        and a.criado_em > now() - interval '12 hours'
        and antes.galeria_id = agora.galeria_id
        and antes.tipo = agora.tipo
        and antes.secao_id is not distinct from agora.secao_id
        and antes.parte is not distinct from agora.parte
        and (antes.id = agora.id or antes.ip_hash = agora.ip_hash or antes.pessoa_id = agora.pessoa_id)`,
    [pedidoId],
  );
}

/**
 * Registra o que aconteceu com um ZIP — montado, servido, trecho ou abortado —
 * com os bytes. É o que o painel de administração soma para dizer se o desenho
 * está custando o previsto.
 *
 * `servido` também vira a linha de sempre em `acessos`, porque é ela que a
 * Atividade da galeria mostra ao fotógrafo ("o casal baixou dia tal").
 * Registrar só no fim é a lição de 05/09/2026: o clique não é o download.
 */
export async function registrarEntregaDeZip(
  pedido: Pick<
    PedidoDeZip,
    "galeria_id" | "tenant_id" | "tipo" | "ip_hash" | "user_agent" | "pessoa_id"
  > & {
    /** Nulo no caminho de reserva: lá não há pedido, o ZIP nasce e morre na rota. */
    id: string | null;
    /** A parte da galeria grande. Ver migração 070. */
    parte?: number | null;
  },
  origem: "vps" | "servidor",
  relato: Omit<RelatoDeZip, "pedidoId">,
): Promise<void> {
  try {
    await consultar(
      `insert into entregas_zip (pedido_id, galeria_id, tenant_id, tipo, origem, evento, bytes, do_cache, duracao_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        pedido.id,
        pedido.galeria_id,
        pedido.tenant_id,
        pedido.tipo,
        origem,
        relato.evento,
        Math.round(relato.bytes),
        relato.doCache,
        Math.round(relato.duracaoMs),
      ],
    );
    if (relato.evento === "servido") {
      await consultar(
        /* `pessoa_id` fecha o circuito da migração 041: pelo servidor de ZIP
           esta chamada vem de uma rota interna, sem cookie, e o dono só existe
           porque foi congelado no pedido quando a pessoa clicou. */
        `insert into acessos (galeria_id, acao, ip_hash, user_agent, pessoa_id)
         values ($1, $2, $3, $4, $5)`,
        [
          pedido.galeria_id,
          /* A parte 1 de 4 não é o casamento inteiro: entra como o zip de um
             capítulo entra. Ver migração 070. */
          pedido.tipo === "tudo" && !pedido.parte ? "baixou_tudo" : "baixou",
          pedido.ip_hash,
          pedido.user_agent,
          pedido.pessoa_id,
        ],
      );
      if (pedido.id) await marcarQuedasRetomadas(pedido.id);
    }
  } catch {
    /* Registro é secundário, como em `registrarAcesso`: o ZIP já foi entregue. */
  }
}

/** Pedidos vencidos saem; as entregas ficam (pedido_id vira null pela FK). */
export async function limparPedidosVencidos(): Promise<number> {
  const linhas = await consultar<{ id: string }>(
    `delete from pedidos_zip where expira_em < now() returning id`,
  );
  return linhas.length;
}
