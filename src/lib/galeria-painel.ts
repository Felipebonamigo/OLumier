import "server-only";
import { consultar, consultarUm } from "./db";
import type { Galeria } from "./tenants";

/**
 * A galeria como o PAINEL a vê — e a autorização que vem junto.
 *
 * ── POR QUE ISTO EXISTE (04/09/2026) ───────────────────────────────────────
 *
 * A tela da galeria virou quatro rotas (fotos, design, entrega, atividade).
 * Quatro rotas são quatro portas para a mesma galeria, e basta UMA sem tranca:
 * a cláusula `and g.tenant_id = $2` é a autorização inteira deste produto, e
 * copiá-la à mão em quatro arquivos é convidar a quinta cópia a esquecê-la.
 *
 * Ela mora aqui, numa função só, e cada página chama. O layout compartilhado
 * NÃO é a defesa — ele desenha o cabeçalho, e um dia alguém pode montar uma
 * rota fora dele. `scripts/testar-painel-abas.mjs` pergunta a cada aba se a
 * galeria do vizinho abre.
 */
export interface GaleriaDoPainel extends Galeria {
  estudio_slug: string;
  estudio_fonte: string | null;
}

/** A galeria DESTE estúdio, ou null. Id de outro estúdio simplesmente não existe. */
export function galeriaDoPainel(id: string, tenantId: string) {
  return consultarUm<GaleriaDoPainel>(
    `select g.*, t.slug as estudio_slug, t.fonte_chave as estudio_fonte
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2`,
    [id, tenantId],
  );
}

/**
 * Quantos arquivos prontos a galeria tem.
 *
 * Existe para a aba Entrega, que só precisa saber se há alguma foto (para
 * avisar antes de publicar galeria vazia). Carregar `listarMedias` ali traria
 * a linha inteira de cada mídia para responder um sim ou não — e era
 * exatamente esse tipo de carga desnecessária que a divisão em abas veio
 * cortar.
 */
export async function contarMediasProntas(galeriaId: string): Promise<number> {
  const r = await consultarUm<{ n: number }>(
    "select count(*)::int as n from medias where galeria_id = $1 and pronto",
    [galeriaId],
  );
  return r?.n ?? 0;
}


/**
 * FOTOS REPETIDAS — o mesmo nome de arquivo mais de uma vez nesta galeria.
 *
 * Felipe, 23/09/2026, olhando o zip do casamento da Júlia: dentro de "Cerimônia"
 * havia `sirius-jugusw-1070.jpg` E `sirius-jugusw-1070 (2).jpg`, com o MESMO
 * tamanho em bytes. O "(2)" é nosso (`nomeUnico`, para o descompactador não
 * sobrescrever uma com a outra), mas dois arquivos idênticos em bytes não são
 * duas fotos: é a mesma foto duas vezes na galeria.
 *
 * Ele pediu a consulta e disse "eu nem sei aonde esta o banco dessa aplicação".
 * Ninguém deveria precisar saber. A pergunta é do produto, então a resposta
 * mora na tela.
 *
 * ── PELO NOME, E NÃO PELO CONTEÚDO ───────────────────────────────────────
 *
 * Comparar bytes exigiria ler os dois arquivos de volta do bucket — banda e
 * dinheiro para responder uma pergunta que o nome já responde. É o mesmo
 * raciocínio de `separarRepetidos` no envio, e aqui vale ainda mais: é
 * justamente por nome que a pergunta do envio decide.
 *
 * `bytes` vem junto porque é ele que separa os dois casos: tamanhos DIFERENTES
 * são duas fotos que por acaso se chamam igual (duas câmeras, `DSC_0001.jpg`),
 * e isso é normal. Tamanhos IGUAIS são a mesma foto entrando duas vezes.
 */
export async function fotosRepetidas(
  galeriaId: string,
): Promise<{ nome: string; vezes: number; mesmoTamanho: boolean }[]> {
  return consultar<{ nome: string; vezes: number; mesmoTamanho: boolean }>(
    `select nome_original as nome,
            count(*)::int as vezes,
            count(distinct bytes) = 1 as "mesmoTamanho"
       from medias
      where galeria_id = $1 and pronto
      group by nome_original
     having count(*) > 1
      order by count(*) desc, nome_original
      limit 200`,
    [galeriaId],
  );
}
