import "server-only";
import { randomUUID } from "node:crypto";
import { consultar, emTransacao, type Consulta } from "./db";
import { bytesUsados } from "./medias";
import { armazemDe, copiarDerivada, copiarOriginal, apagarArquivosDasMedias } from "./armazem";
import { ehUuid, MAXIMO_POR_MOVIMENTO } from "./mover-entre-galerias";

/**
 * COPIAR FOTOS PARA OUTRA GALERIA — o arquivo vira dois.
 *
 * ── O PEDIDO (14/10/2026) ─────────────────────────────────────────────────
 *
 * Felipe: tem uma galeria com todas as fotos analógicas da vida, e as fotos de
 * cada cliente precisam ir também para a galeria DELE — sem catar em HD. "Mover"
 * não serve (a foto sairia do acervo); é preciso copiar. O Pixieset tinha.
 *
 * ── POR QUE NÃO COMPARTILHAR O ARQUIVO ────────────────────────────────────
 *
 * Mover troca o `galeria_id` e o arquivo fica onde está (ver
 * `mover-entre-galerias.ts`). Copiar poderia, em teoria, criar uma segunda
 * linha apontando para a MESMA chave — zero byte novo. Não faz: quem apaga
 * (`apagarMedia`, `destruirGaleria`, a faxina do teste abandonado, a lixeira)
 * parte da linha e leva o objeto junto. Apagar a foto de uma galeria apagaria a
 * da outra, calado, e o cliente abriria um espaço vazio. A chave também é
 * `unique`. Cada cópia é, então, um OBJETO NOVO, com chave própria — e por isso
 * conta no espaço do estúdio, e a tela diz isso antes de a pessoa copiar.
 *
 * A cópia acontece DENTRO do armazém (`copia-no-balde.ts`): nada trafega pelo
 * VPS nem pelo navegador, e é por isso que dura segundos.
 *
 * ── LOTES POR PESO ────────────────────────────────────────────────────────
 *
 * A chamada copia no máximo ~`LIMITE_DE_BYTES_POR_CHAMADA` e devolve o que
 * sobrou (`restantes`); a tela chama de novo até acabar. Foto vem 40 de uma vez;
 * um filme de 30 GB vem sozinho. Sem isso, uma seleção de vídeos estouraria o
 * tempo da requisição e a pessoa não saberia o que foi copiado.
 *
 * ── A ORDEM: OBJETOS, DEPOIS LINHAS ───────────────────────────────────────
 *
 * Copia os arquivos primeiro; só então grava as linhas, numa transação. Se um
 * arquivo falha, os já copiados são apagados e NADA entra na galeria. O pior
 * caso é a queda entre as duas etapas, que deixa objetos sem linha — e esses a
 * `varrer-orfaos.mjs` recolhe.
 *
 * ── O QUE A CÓPIA LEVA ────────────────────────────────────────────────────
 *
 *   leva    arquivo, miniaturas, versão leve do vídeo, nome, título, data da
 *           foto, medidas, duração; os rostos, se o destino tem a busca ligada
 *   não     favoritas (são escolha do cliente DAQUELA entrega), capa, acessos
 */

export const MAXIMO_POR_CHAMADA = 40;
/** Passou disto numa chamada, o resto vai para a próxima. A primeira foto sempre vai. */
export const LIMITE_DE_BYTES_POR_CHAMADA = 1.5 * 1024 ** 3;

export type ResultadoDaCopia =
  | { ok: true; copiadas: number; bytesCopiados: number; restantes: string[] }
  | { ok: false; erro: string };

interface Origem {
  id: string;
  chave: string;
  chave_thumb: string | null;
  chave_preview: string | null;
  chave_reproducao: string | null;
  armazem: string;
  bytes: string;
}

/**
 * A chave de uma cópia: troca a "família" (`<tenant>/<galeria>/<uuid>`) do
 * original pela nova, mantendo o sufixo de cada arquivo (`_thumb.webp`,
 * `_prev.avif`, `_leve.mp4`, a extensão). Devolve null para chave que não segue
 * o padrão — a derivada fica de fora em vez de ser copiada para um lugar
 * adivinhado.
 */
export function chaveDaCopia(
  chaveOriginal: string,
  chaveDoArquivo: string | null,
  novaBase: string,
): string | null {
  if (!chaveDoArquivo) return null;
  const baseAntiga = chaveOriginal.replace(/\.[a-z0-9]{1,10}$/i, "");
  if (!chaveDoArquivo.startsWith(baseAntiga)) return null;
  return `${novaBase}${chaveDoArquivo.slice(baseAntiga.length)}`;
}

/** Faz `tarefa` para cada item, no máximo `n` ao mesmo tempo. */
async function emParalelo<T>(itens: T[], n: number, tarefa: (item: T) => Promise<void>) {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (proximo < itens.length) {
      const meu = proximo++;
      await tarefa(itens[meu]);
    }
  });
  /* Espera TODOS terminarem antes de lançar: com `Promise.all` o erro de um
     devolveria o controle enquanto os outros ainda copiavam, e o desfazer
     deixaria passar justamente o que chegasse depois. */
  const resultados = await Promise.allSettled(trabalhadores);
  const falha = resultados.find((r) => r.status === "rejected");
  if (falha) throw (falha as PromiseRejectedResult).reason;
}

async function origensDaSelecao(
  q: Consulta,
  tenantId: string,
  origemId: string,
  ids: string[],
): Promise<Origem[]> {
  return q<Origem>(
    `select id, chave, chave_thumb, chave_preview, chave_reproducao, armazem, bytes::text as bytes
       from medias
      where galeria_id = $1 and tenant_id = $2 and pronto and id = any($3::uuid[])
      order by ordem, criado_em, id`,
    [origemId, tenantId, ids],
  );
}

/** O que fala com o armazém — separado para o teste trocar por um de mentira. */
export interface Copiador {
  original(de: string, para: string, armazem: "r2" | "b2"): Promise<boolean>;
  derivada(de: string, para: string): Promise<boolean>;
  apagar: typeof apagarArquivosDasMedias;
}
const COPIADOR_REAL: Copiador = {
  original: copiarOriginal,
  derivada: copiarDerivada,
  apagar: apagarArquivosDasMedias,
};

export async function copiarMediasParaOutraGaleria(dados: {
  tenantId: string;
  origemId: string;
  destinoId: string;
  secaoDestinoId: string | null;
  ids: string[];
  /** A quota que VALE agora (`quotaEfetivaBytes`) — a cópia ocupa espaço novo. */
  quotaBytes: bigint;
  copiador?: Copiador;
}): Promise<ResultadoDaCopia> {
  const { tenantId, origemId, destinoId, secaoDestinoId } = dados;
  const armazens = dados.copiador ?? COPIADOR_REAL;

  if (!ehUuid(origemId) || !ehUuid(destinoId)) return { ok: false, erro: "Galeria inválida." };
  if (origemId === destinoId) return { ok: false, erro: "Escolha uma galeria diferente da atual." };
  if (secaoDestinoId !== null && !ehUuid(secaoDestinoId)) return { ok: false, erro: "Capítulo inválido." };

  const ids = [...new Set(dados.ids.filter(ehUuid))].slice(0, MAXIMO_POR_MOVIMENTO);
  if (ids.length === 0) return { ok: false, erro: "Não há fotos para copiar." };

  const galerias = await consultar<{ id: string; rostos_ativos: boolean }>(
    `select id, rostos_ativos from galerias
      where id = any($1::uuid[]) and tenant_id = $2 and estado = 'online'`,
    [[origemId, destinoId], tenantId],
  );
  if (!galerias.some((g) => g.id === origemId)) return { ok: false, erro: "Não encontrei a galeria de origem." };
  const destino = galerias.find((g) => g.id === destinoId);
  if (!destino) return { ok: false, erro: "Essa galeria não está disponível para receber fotos." };

  if (secaoDestinoId) {
    const [secao] = await consultar<{ id: string }>(
      "select id from secoes where id = $1 and galeria_id = $2",
      [secaoDestinoId, destinoId],
    );
    if (!secao) return { ok: false, erro: "Esse capítulo não existe na galeria escolhida." };
  }

  /* A seleção na ordem da galeria, e dela o pedaço que cabe nesta chamada. */
  const todas = await origensDaSelecao(consultar, tenantId, origemId, ids);
  const naChamada: Origem[] = [];
  let peso = 0;
  for (const o of todas) {
    const b = Number(o.bytes);
    if (naChamada.length >= MAXIMO_POR_CHAMADA) break;
    if (naChamada.length > 0 && peso + b > LIMITE_DE_BYTES_POR_CHAMADA) break;
    naChamada.push(o);
    peso += b;
  }
  /* O que não está mais na origem (apagado, movido) some da fila; o que sobrou
     por peso volta para a tela chamar de novo. */
  const restantes = todas.slice(naChamada.length).map((o) => o.id);
  if (naChamada.length === 0) return { ok: true, copiadas: 0, bytesCopiados: 0, restantes: [] };

  /* Espaço: a cópia ocupa de novo. Conferido aqui, e não só na tela, porque é o
     servidor que impede o estúdio de passar da quota por esta porta. */
  const usado = await bytesUsados(tenantId);
  if (usado + BigInt(Math.round(peso)) > dados.quotaBytes) {
    return {
      ok: false,
      erro: "Espaço insuficiente para copiar. Cada cópia ocupa espaço novo — libere espaço ou aumente o plano.",
    };
  }

  /* 1. Os arquivos, dentro do armazém. */
  const copias = naChamada.map((o) => {
    const base = `${tenantId}/${destinoId}/${randomUUID()}`;
    const ext = o.chave.match(/\.[a-z0-9]{1,10}$/i)?.[0] ?? "";
    return {
      origem: o,
      chave: `${base}${ext}`,
      thumb: chaveDaCopia(o.chave, o.chave_thumb, base),
      preview: chaveDaCopia(o.chave, o.chave_preview, base),
      reproducao: chaveDaCopia(o.chave, o.chave_reproducao, base),
      /* A derivada que não existia no armazém não vira linha com chave morta. */
      thumbOk: false,
      previewOk: false,
      reproducaoOk: false,
      originalOk: false,
    };
  });

  try {
    await emParalelo(copias, 4, async (c) => {
      const armazem = armazemDe(c.origem.armazem);
      c.originalOk = await armazens.original(c.origem.chave, c.chave, armazem);
      if (!c.originalOk) throw new Error(`o original não está mais no armazém (${c.origem.id})`);
      if (c.thumb && c.origem.chave_thumb) c.thumbOk = await armazens.derivada(c.origem.chave_thumb, c.thumb);
      if (c.preview && c.origem.chave_preview) c.previewOk = await armazens.derivada(c.origem.chave_preview, c.preview);
      if (c.reproducao && c.origem.chave_reproducao) {
        c.reproducaoOk = await armazens.derivada(c.origem.chave_reproducao, c.reproducao);
      }
    });
  } catch (e) {
    await desfazer(copias, armazens);
    console.error("[copiar] falhou no armazém:", e);
    return { ok: false, erro: "Não consegui copiar os arquivos agora. Nada foi alterado — tente de novo." };
  }

  /* 2. As linhas, todas ou nenhuma. */
  try {
    const gravadas = await emTransacao<{ bytes: number; ids: Set<string> }>(async (q) => {
      /* De novo, já dentro da transação e com a origem travada: outra aba pode
         ter apagado uma das fotos enquanto o armazém copiava. */
      const vivas = new Set(
        (await q<{ id: string }>(
          `select id from medias where galeria_id = $1 and tenant_id = $2 and pronto
              and id = any($3::uuid[]) for share`,
          [origemId, tenantId, naChamada.map((o) => o.id)],
        )).map((l) => l.id),
      );
      const [fim] = await q<{ n: number }>(
        "select coalesce(max(ordem), -1) + 1 as n from medias where galeria_id = $1",
        [destinoId],
      );
      let posicao = fim?.n ?? 0;
      let total = 0;
      const feitas = new Set<string>();
      for (const c of copias) {
        if (!vivas.has(c.origem.id)) continue;
        const [nova] = await q<{ id: string }>(
          `insert into medias
             (galeria_id, tenant_id, chave, chave_thumb, chave_preview, chave_reproducao,
              nome_original, titulo, tipo, mime, bytes, largura, altura, duracao_seg,
              tirada_em, armazem, secao_id, ordem, pronto, versao)
           select $2, tenant_id, $3, $4, $5, $6,
                  nome_original, titulo, tipo, mime, bytes, largura, altura, duracao_seg,
                  tirada_em, armazem, $7, $8, true, 1
             from medias where id = $1 and tenant_id = $9
           returning id`,
          [
            c.origem.id,
            destinoId,
            c.chave,
            c.thumbOk ? c.thumb : null,
            c.previewOk ? c.preview : null,
            c.reproducaoOk ? c.reproducao : null,
            secaoDestinoId,
            posicao++,
            tenantId,
          ],
        );
        /* Rosto é dado biométrico: só vai para galeria com a busca ligada. */
        if (destino.rostos_ativos && nova) {
          await q(
            `insert into rostos (media_id, galeria_id, tenant_id, caixa, px, vetor)
             select $2, $3, tenant_id, caixa, px, vetor from rostos where media_id = $1`,
            [c.origem.id, nova.id, destinoId],
          );
        }
        total += Number(c.origem.bytes);
        feitas.add(c.origem.id);
      }
      return { bytes: total, ids: feitas };
    });

    /* A foto apagada enquanto o armazém copiava deixou arquivo sem linha: sai
       agora, em vez de esperar a varredura de órfãos. */
    const descartadas = copias.filter((c) => !gravadas.ids.has(c.origem.id));
    if (descartadas.length > 0) await desfazer(descartadas, armazens);

    return { ok: true, copiadas: gravadas.ids.size, bytesCopiados: gravadas.bytes, restantes };
  } catch (e) {
    await desfazer(copias, armazens);
    console.error("[copiar] falhou ao gravar:", e);
    return { ok: false, erro: "Não consegui concluir a cópia. Nada foi alterado — tente de novo." };
  }
}

/** Apaga o que já foi copiado — a cópia falhou e não pode sobrar objeto pago sem dono. */
async function desfazer(
  copias: { chave: string; thumb: string | null; preview: string | null; reproducao: string | null;
            thumbOk: boolean; previewOk: boolean; reproducaoOk: boolean; originalOk: boolean;
            origem: { armazem: string } }[],
  armazens: Copiador,
) {
  const lixo = copias
    .filter((c) => c.originalOk || c.thumbOk || c.previewOk || c.reproducaoOk)
    .map((c) => ({
      chave: c.originalOk ? c.chave : "",
      chave_thumb: c.thumbOk ? c.thumb : null,
      chave_preview: c.previewOk ? c.preview : null,
      chave_reproducao: c.reproducaoOk ? c.reproducao : null,
      armazem: c.origem.armazem,
    }));
  if (lixo.length === 0) return;
  const r = await armazens.apagar(lixo);
  if (r.falhou) console.error("[copiar] não consegui desfazer:", r.falhou);
}
