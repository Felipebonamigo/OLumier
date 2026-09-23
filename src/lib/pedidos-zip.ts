import "server-only";
import { consultar, consultarUm } from "./db";
import { armazemDe, urlDoOriginal } from "./armazem";
import type { Entrega } from "./entrega-da-galeria";
import { entradasDoZip } from "./entradas-do-zip";
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
  expira_em: string;
}

export async function criarPedidoDeZip(
  galeriaId: string,
  entrega: Entrega,
  quem: { ipHash: string | null; userAgent: string | null },
  secaoId: string | null,
): Promise<{ id: string; nomeDoZip: string }> {
  const { nomeDoZip, arquivos } = entradasDoZip(entrega);
  const entradas: EntradaGravada[] = arquivos.map((a) => ({
    id: a.media.id,
    nome: a.nome,
    tamanho: a.tamanho,
    versao: a.media.versao ?? 1,
  }));
  const linha = await consultarUm<{ id: string }>(
    `insert into pedidos_zip (galeria_id, tipo, secao_id, entradas, nome_do_zip, ip_hash, user_agent)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)
     returning id`,
    [
      galeriaId,
      entrega.tipo,
      secaoId,
      JSON.stringify(entradas),
      nomeDoZip,
      quem.ipHash,
      quem.userAgent?.slice(0, 300) ?? null,
    ],
  );
  if (!linha) throw new Error("o pedido de zip não foi gravado");
  return { id: linha.id, nomeDoZip };
}

export async function lerPedidoDeZip(id: string): Promise<PedidoDeZip | null> {
  return consultarUm<PedidoDeZip>(
    `select p.id, p.galeria_id, g.tenant_id, p.tipo, p.secao_id, p.entradas,
            p.nome_do_zip, p.ip_hash, p.user_agent, p.expira_em
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
  const medias = await consultar<{ id: string; chave: string; armazem: string; bytes: string; versao: number }>(
    `select id, chave, armazem, bytes, versao
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
  };
}

/**
 * Registra o que aconteceu com um ZIP — montado, servido ou abortado — com os
 * bytes. É o que o painel de administração soma para dizer se o desenho está
 * custando o previsto.
 *
 * `servido` também vira a linha de sempre em `acessos`, porque é ela que a
 * Atividade da galeria mostra ao fotógrafo ("o casal baixou dia tal").
 * Registrar só no fim é a lição de 05/09/2026: o clique não é o download.
 */
export async function registrarEntregaDeZip(
  pedido: Pick<PedidoDeZip, "galeria_id" | "tenant_id" | "tipo" | "ip_hash" | "user_agent"> & {
    /** Nulo no caminho de reserva: lá não há pedido, o ZIP nasce e morre na rota. */
    id: string | null;
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
        `insert into acessos (galeria_id, acao, ip_hash, user_agent) values ($1, $2, $3, $4)`,
        [
          pedido.galeria_id,
          pedido.tipo === "tudo" ? "baixou_tudo" : "baixou",
          pedido.ip_hash,
          pedido.user_agent,
        ],
      );
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
