import "server-only";
import { consultar } from "./db";
import { armazemDe, urlDoOriginal } from "./armazem";

/**
 * Os vídeos de uma galeria que ainda tocam o ORIGINAL — os candidatos à versão
 * leve (`lib/versao-leve.ts`, migração 065) —, com o endereço do original para
 * o navegador do fotógrafo ler.
 *
 * Só quando o botão é apertado: a aba Vídeo não assina filme nenhum ao abrir
 * (ver a página). E o endereço vale SEIS HORAS porque a conversão lê o original
 * aos pedaços enquanto converte, um vídeo depois do outro — um endereço que
 * vencesse no meio da fila faria o vigésimo vídeo falhar sem motivo aparente.
 *
 * O `tenant_id` no `where` é a tranca: galeria de outro estúdio devolve lista
 * vazia, e nenhuma URL sai daqui para quem não é dono.
 */
const VALIDADE_SEG = 6 * 3600;

export async function videosParaPreparar(galeriaId: string, tenantId: string) {
  const linhas = await consultar<{
    id: string;
    nome_original: string;
    bytes: string;
    chave: string;
    armazem: string;
    sem_capa: boolean;
  }>(
    `select m.id, m.nome_original, m.bytes, m.chave, m.armazem, m.chave_thumb is null as sem_capa
       from medias m
       join galerias g on g.id = m.galeria_id
      where m.galeria_id = $1 and g.tenant_id = $2 and m.tenant_id = $2
        and m.tipo = 'video' and m.pronto and m.chave_reproducao is null
      order by m.secao_id nulls first, m.ordem`,
    [galeriaId, tenantId],
  );
  return Promise.all(
    linhas.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      bytes: Number(m.bytes),
      semCapa: m.sem_capa,
      url: await urlDoOriginal(m.chave, armazemDe(m.armazem), VALIDADE_SEG),
    })),
  );
}
