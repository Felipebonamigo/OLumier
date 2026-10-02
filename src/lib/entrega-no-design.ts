import "server-only";
import { consultar } from "./db";
import { armazemDe, urlDaDerivada } from "./armazem";
import { urlDeLeitura } from "./r2";
import { tituloDoEpisodio } from "./formato-da-entrega";

/**
 * O QUE A ABA DESIGN MOSTRA DAS PASTAS E DO STREAM (30/09/2026).
 *
 * Juan, depois de ver os dois formatos: "pro formato Pastas, adicionar opção
 * de escolher a capa de cada capítulo" e, no Stream, "trocar o nome do
 * arquivo que aparece na visualização".
 *
 * A capa da pasta JÁ existia — um botão no hover de cada foto, na aba Fotos.
 * Existia e ninguém achou: quem está decidindo como as pastas ficam está no
 * Design, olhando a prévia, e não numa grade de mil fotos. Então as duas
 * coisas moram agora onde o formato é escolhido, com a prévia ao lado.
 *
 * A aba Design não carrega mídia (ver `design/page.tsx`), e isto continua
 * pequeno: uma miniatura por capítulo e um pôster por vídeo. As fotos de uma
 * pasta, para escolher a capa, só vêm quando a pessoa abre aquela pasta —
 * `fotosDaPasta`, uma página por vez.
 */

const VALIDADE = 3600;

export interface VideoNoDesign {
  id: string;
  /** O nome escrito pelo fotógrafo, ou null — aí a tela usa `doArquivo`. */
  titulo: string | null;
  /** O que o Stream mostra sem nome escrito: tirado do arquivo. */
  doArquivo: string;
  nomeDoArquivo: string;
  poster: string | null;
  capitulo: string | null;
}

export interface PastaNoDesign {
  secaoId: string;
  nome: string;
  fotos: number;
  /** A capa que o cliente vê hoje — a enviada, a escolhida, ou a primeira foto. */
  capa: string | null;
  /** A capa foi escolhida (e não é só a primeira por falta de escolha). */
  escolhida: boolean;
  /** A capa é um ARQUIVO enviado à parte (migração 057), não uma foto da entrega. */
  enviada: boolean;
}

export interface FotoDaPasta {
  id: string;
  url: string;
}

/** Os vídeos da galeria, na ordem do Stream (soltos primeiro, depois os capítulos). */
export async function videosNoDesign(galeriaId: string): Promise<VideoNoDesign[]> {
  const linhas = await consultar<{
    id: string;
    titulo: string | null;
    nome_original: string;
    chave_thumb: string | null;
    capitulo: string | null;
  }>(
    `select m.id, m.titulo, m.nome_original, m.chave_thumb, s.nome as capitulo
       from medias m
       left join secoes s on s.id = m.secao_id
      where m.galeria_id = $1 and m.pronto and m.tipo = 'video'
      order by (m.secao_id is not null), s.ordem nulls first, m.ordem, m.criado_em
      limit 200`,
    [galeriaId],
  );
  return Promise.all(
    linhas.map(async (v) => ({
      id: v.id,
      titulo: v.titulo,
      doArquivo: tituloDoEpisodio(v.nome_original),
      nomeDoArquivo: v.nome_original,
      poster: v.chave_thumb ? await urlDeLeitura(v.chave_thumb, VALIDADE) : null,
      capitulo: v.capitulo,
    })),
  );
}

/**
 * Os capítulos com foto, cada um com a capa que o cliente vê hoje. A mesma
 * regra da galeria pública: a escolhida, se ainda está no capítulo e tem
 * imagem; senão a primeira foto.
 */
export async function pastasNoDesign(galeriaId: string): Promise<PastaNoDesign[]> {
  const linhas = await consultar<{
    secao_id: string;
    nome: string;
    fotos: number;
    escolhida: boolean;
    capa_chave: string | null;
    chave: string | null;
    chave_thumb: string | null;
    armazem: string | null;
  }>(
    `select s.id as secao_id, s.nome, s.capa_chave,
            (select count(*)::int from medias f
              where f.secao_id = s.id and f.pronto and f.tipo = 'foto') as fotos,
            (capa.id is not null and capa.id = s.capa_media_id) as escolhida,
            capa.chave, capa.chave_thumb, capa.armazem
       from secoes s
       left join lateral (
         select m.id, m.chave, m.chave_thumb, m.armazem
           from medias m
          where m.secao_id = s.id and m.pronto
            and (m.tipo = 'foto' or m.chave_thumb is not null)
          order by (m.id = s.capa_media_id) desc, (m.tipo = 'foto') desc, m.ordem, m.criado_em
          limit 1
       ) capa on true
      where s.galeria_id = $1
      order by s.ordem`,
    [galeriaId],
  );
  /*
   * QUEM VENCE QUEM: arquivo enviado > foto escolhida > primeira foto. A mesma
   * ordem da capa da galeria, para as duas telas não discordarem.
   *
   * O `filter` passou a aceitar capítulo SEM foto que tenha capa enviada: é
   * justamente o caso de quem subiu uma arte para um capítulo que ainda vai
   * receber as fotos, e antes ele desaparecia da tela.
   */
  return Promise.all(
    linhas
      .filter((l) => l.capa_chave || l.chave)
      .map(async (l) => ({
        secaoId: l.secao_id,
        nome: l.nome,
        fotos: l.fotos,
        escolhida: l.escolhida,
        enviada: Boolean(l.capa_chave),
        capa: l.capa_chave
          ? await urlDeLeitura(l.capa_chave, VALIDADE)
          : await urlDaDerivada(l.chave_thumb, l.chave as string, armazemDe(l.armazem), VALIDADE),
      })),
  );
}

export const FOTOS_POR_PAGINA = 60;

/**
 * As fotos de uma pasta, para escolher a capa — uma página de cada vez. Vídeo
 * com pôster entra também: a pasta de um filme pode ter a capa do filme.
 *
 * `tenant_id` no `where` é a tranca: pasta de outro estúdio devolve lista
 * vazia, igual a uma pasta que não existe.
 */
export async function fotosDaPasta(
  galeriaId: string,
  tenantId: string,
  secaoId: string,
  desde: number,
): Promise<{ fotos: FotoDaPasta[]; mais: boolean }> {
  const linhas = await consultar<{ id: string; chave: string; chave_thumb: string | null; armazem: string }>(
    `select m.id, m.chave, m.chave_thumb, m.armazem
       from medias m
      where m.galeria_id = $1 and m.tenant_id = $2 and m.secao_id = $3 and m.pronto
        and (m.tipo = 'foto' or m.chave_thumb is not null)
      order by m.ordem, m.criado_em
      offset $4 limit $5`,
    [galeriaId, tenantId, secaoId, Math.max(0, Math.floor(desde)), FOTOS_POR_PAGINA + 1],
  );
  const pagina = linhas.slice(0, FOTOS_POR_PAGINA);
  return {
    fotos: await Promise.all(
      pagina.map(async (m) => ({
        id: m.id,
        url: await urlDaDerivada(m.chave_thumb, m.chave, armazemDe(m.armazem), VALIDADE),
      })),
    ),
    mais: linhas.length > FOTOS_POR_PAGINA,
  };
}
