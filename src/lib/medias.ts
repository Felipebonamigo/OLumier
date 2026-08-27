import "server-only";
import { consultar, consultarUm } from "./db";

export interface Media {
  id: string;
  galeria_id: string;
  tenant_id: string;
  chave: string;
  chave_thumb: string | null;
  chave_preview: string | null;
  nome_original: string;
  tipo: "foto" | "video";
  mime: string;
  bytes: string;
  largura: number | null;
  altura: number | null;
  secao_id: string | null;
  ordem: number;
  pronto: boolean;
  criado_em: Date;
  /**
   * Em qual fornecedor o ORIGINAL mora: 'r2' (padrão) ou 'b2'. As derivadas
   * ficam sempre no r2 — ver `lib/armazem.ts`, que é quem decide de onde ler.
   */
  armazem: string;
}

/** O que aceitamos subir. Fora desta lista, recusamos antes de gerar a URL. */
export const TIPOS_ACEITOS: Record<string, "foto" | "video"> = {
  "image/jpeg": "foto",
  "image/png": "foto",
  "image/webp": "foto",
  "image/avif": "foto",
  "image/heic": "foto",
  "image/heif": "foto",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

/**
 * Acima deste tamanho, o envio vai em partes. O R2 aceita até 5 GiB num PUT
 * único; passando disso, o protocolo S3 exige quebrar o arquivo.
 */
export const LIMITE_PUT_UNICO = 5 * 1024 ** 3;

/**
 * Teto por arquivo. Filme de casamento em 4K costuma ficar entre 10 e 40 GB;
 * 100 GB dá folga sem virar convite para alguém subir um backup inteiro.
 */
export const LIMITE_POR_ARQUIVO = 100 * 1024 ** 3;

/**
 * Tamanho de cada parte. O S3 aceita no máximo 10.000 partes, então 100 MB
 * cobre até 1 TB; acima disso o cliente aumenta a parte para não estourar.
 */
export const TAMANHO_PARTE = 100 * 1024 ** 2;
export const MAX_PARTES = 10_000;

export async function listarMedias(galeriaId: string) {
  return consultar<Media>(
    "select * from medias where galeria_id = $1 and pronto order by ordem, criado_em",
    [galeriaId],
  );
}

/**
 * Espaço já comprometido pelo tenant: conta também o que está subindo agora
 * (pronto = false). Sem isso, vários envios em paralelo furariam a quota juntos.
 */
export interface UsoDoEstudio {
  /** Galerias no ar (link aberto para o cliente final). */
  noAr: bigint;
  /** Galerias arquivadas (fora do ar, guardadas). */
  noCofre: bigint;
}
/*
 * Os dois continuam separados porque a TELA mostra a quebra ("700 GB no ar ·
 * 300 GB arquivado") — mas isso é informação, não são dois limites. Desde a
 * unificação de 25/08/2026 quem limita é a soma, e só ela. Ver `bytesUsados`.
 */

/**
 * Espaço usado, separado em dois baldes.
 *
 * Conta também o que está SUBINDO agora (`pronto = false`): a reserva existe
 * justamente para dois envios simultâneos não furarem a quota juntos, e ignorá-la
 * aqui recriaria o furo. Como reserva presa é soltada pela limpeza diária
 * (scripts/limpar-pendentes.mjs), contá-la não prende espaço para sempre.
 *
 * `exceto` serve para a confirmação de upload: ali a reserva da própria mídia
 * ainda está somada com o tamanho DECLARADO, e contá-la junto com o tamanho real
 * recusaria um arquivo que na verdade cabe.
 */
export async function usoDoEstudio(tenantId: string, exceto?: string): Promise<UsoDoEstudio> {
  const r = await consultarUm<{ no_ar: string; no_cofre: string }>(
    `select
       coalesce(sum(m.bytes) filter (where g.estado <> 'arquivada'), 0)::text as no_ar,
       coalesce(sum(m.bytes) filter (where g.estado =  'arquivada'), 0)::text as no_cofre
     from medias m
     join galerias g on g.id = m.galeria_id
     where m.tenant_id = $1
       and ($2::uuid is null or m.id <> $2::uuid)`,
    [tenantId, exceto ?? null],
  );
  return {
    noAr: BigInt(r?.no_ar ?? "0"),
    noCofre: BigInt(r?.no_cofre ?? "0"),
  };
}

/**
 * Espaço TOTAL ocupado — é o que o portão de upload compara com a quota.
 *
 * Soma o que está no ar e o que está arquivado. Chamava-se `bytesNoAr` e
 * ignorava o arquivado, o que fazia sentido quando o cofre tinha balde próprio.
 * Depois da unificação, ignorar o arquivado transformaria arquivar em espaço
 * grátis: bastaria arquivar tudo para enviar sem limite, e a fatura do B2
 * subiria sem receita atrás. `scripts/testar-quota.mjs` prende isto.
 */
export async function bytesUsados(tenantId: string, exceto?: string): Promise<bigint> {
  const { noAr, noCofre } = await usoDoEstudio(tenantId, exceto);
  return noAr + noCofre;
}

export async function criarMediaPendente(dados: {
  galeriaId: string;
  tenantId: string;
  chave: string;
  chaveThumb?: string | null;
  chavePreview?: string | null;
  nomeOriginal: string;
  tipo: "foto" | "video";
  mime: string;
  bytes: number;
  largura?: number | null;
  altura?: number | null;
  secaoId?: string | null;
  /** Posição do arquivo na lista que o fotógrafo ordenou. */
  indice?: number;
  /**
   * Onde o ORIGINAL vai nascer. Gravado na linha na hora da criação, e não
   * consultado depois: um vídeo de 30 GB pode levar horas subindo, e se a
   * credencial do B2 entrar no ambiente no meio do envio, as partes seguintes
   * iriam para outro fornecedor. A linha é a memória de onde este arquivo mora.
   */
  armazem?: "r2" | "b2";
}) {
  /*
   * A ORDEM vem do navegador (a posição do arquivo na lista já ordenada por
   * nome), somada à última posição CONFIRMADA da galeria.
   *
   * O `max(ordem)` sozinho embaralhava: três arquivos sobem em paralelo, os três
   * leem o mesmo máximo e recebem a mesma posição — e "foto_1, foto_2, foto_3"
   * chegava ao casal fora de ordem. O fotógrafo ordena os arquivos de propósito
   * antes de enviar; essa ordem é a narrativa do casamento.
   *
   * O filtro `pronto` é o que torna a base estável durante o envio: as linhas
   * pendentes do próprio lote não mexem no cálculo, então os três paralelos
   * chegam ao mesmo ponto de partida e cada um soma o seu índice.
   */
  const proxima = await consultarUm<{ n: number }>(
    "select coalesce(max(ordem), -1) + 1 as n from medias where galeria_id = $1 and pronto",
    [dados.galeriaId],
  );
  const posicao = (proxima?.n ?? 0) + (dados.indice ?? 0);

  return consultarUm<Media>(
    `insert into medias (galeria_id, tenant_id, chave, chave_thumb, chave_preview,
                         nome_original, tipo, mime, bytes, largura, altura, secao_id, ordem, pronto,
                         armazem)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14)
     returning *`,
    [
      dados.galeriaId,
      dados.tenantId,
      dados.chave,
      dados.chaveThumb ?? null,
      dados.chavePreview ?? null,
      dados.nomeOriginal,
      dados.tipo,
      dados.mime,
      dados.bytes,
      dados.largura ?? null,
      dados.altura ?? null,
      dados.secaoId ?? null,
      posicao,
      dados.armazem ?? "r2",
    ],
  );
}

/** Anula as chaves de derivadas que não chegaram ao bucket — a grade cai no original. */
export async function anularDerivadas(mediaId: string, quais: { thumb?: boolean; preview?: boolean }) {
  const partes: string[] = [];
  if (quais.thumb) partes.push("chave_thumb = null");
  if (quais.preview) partes.push("chave_preview = null");
  if (partes.length === 0) return;
  await consultarUm(`update medias set ${partes.join(", ")} where id = $1`, [mediaId]);
}

/** Marca como pronta usando o tamanho REAL vindo do bucket — nunca o que o navegador declarou. */
export async function confirmarMedia(mediaId: string, tenantId: string, bytesReais: number) {
  return consultarUm<Media>(
    `update medias set bytes = $1, pronto = true
      where id = $2 and tenant_id = $3
      returning *`,
    [bytesReais, mediaId, tenantId],
  );
}

export async function buscarMedia(mediaId: string, tenantId: string) {
  return consultarUm<Media>("select * from medias where id = $1 and tenant_id = $2", [
    mediaId,
    tenantId,
  ]);
}

export async function apagarMedia(mediaId: string, tenantId: string) {
  const apagada = await consultarUm<Media>(
    "delete from medias where id = $1 and tenant_id = $2 returning *",
    [mediaId, tenantId],
  );

  /*
   * Apagar UMA foto não tem lixeira — some na hora, e é assim de propósito:
   * quem descarta uma foto ruim no meio da seleção não quer ver as duzentas
   * descartadas ocupando uma lista depois. Justamente por não ter volta, o
   * registro importa: é a única memória de que aquele arquivo existiu.
   */
  if (apagada) {
    const { registrarEvento, ACOES } = await import("./eventos");
    await registrarEvento({
      tenantId,
      ator: "estudio",
      acao: ACOES.MEDIA_APAGADA,
      alvoTipo: "media",
      alvoId: mediaId,
      detalhe: {
        nome: apagada.nome_original,
        galeriaId: apagada.galeria_id,
        bytes: String(apagada.bytes),
        tipo: apagada.tipo,
      },
    });
  }

  return apagada;
}

/**
 * Atualiza a mídia depois de uma REPUBLICAÇÃO — o arquivo trocou, o id não.
 *
 * A diferença para `confirmarMedia` é a razão de existir desta função: lá a
 * linha estava pendente e vira pronta; aqui ela já era pronta e continua sendo,
 * porque nada pode piscar para o casal enquanto o fotógrafo republica.
 *
 * Aqui havia o zeramento de `espelhado_em`, porque a cópia no espelho era do
 * conteúdo ANTIGO. O espelho foi removido em 27/08/2026 e a coluna com ele —
 * ver `scripts/testar-sem-espelho.mjs`. Se um dia voltar uma segunda cópia,
 * este é um dos lugares que ela precisa tocar: republicação troca o arquivo sem
 * trocar o id, e uma cópia marcada como feita nunca mais entraria na fila.
 */
export async function republicarMedia(
  mediaId: string,
  tenantId: string,
  dados: { bytes: number; largura?: number | null; altura?: number | null },
) {
  return consultarUm<Media>(
    `update medias
        set bytes = $3,
            largura = coalesce($4, largura),
            altura = coalesce($5, altura)
      where id = $1 and tenant_id = $2 and pronto
      returning *`,
    [mediaId, tenantId, dados.bytes, dados.largura ?? null, dados.altura ?? null],
  );
}
