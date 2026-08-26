import "server-only";
import { consultar, consultarUm } from "./db";

export interface Secao {
  id: string;
  galeria_id: string;
  nome: string;
  ordem: number;
  total?: number;
}

/** Sugestões de capítulo — o fotógrafo cria os seis com um clique. */
export const CAPITULOS_SUGERIDOS = [
  "Making Of",
  "Cerimônia",
  "Decoração",
  "Recepção",
  "Festa",
  "Ensaio",
];

export async function listarSecoes(galeriaId: string) {
  return consultar<Secao>(
    `select s.*, (select count(*)::int from medias m where m.secao_id = s.id and m.pronto) as total
       from secoes s
      where s.galeria_id = $1
      order by s.ordem, s.criado_em`,
    [galeriaId],
  );
}

/** Confere que a galeria é do tenant antes de qualquer escrita em seção. */
async function galeriaDoTenant(galeriaId: string, tenantId: string) {
  return consultarUm<{ id: string }>(
    "select id from galerias where id = $1 and tenant_id = $2",
    [galeriaId, tenantId],
  );
}

export async function criarSecao(galeriaId: string, tenantId: string, nome: string) {
  if (!(await galeriaDoTenant(galeriaId, tenantId))) return null;
  const limpo = nome.trim().slice(0, 60);
  if (!limpo) return null;

  /*
   * Capítulo repetido é recusado — e "Making Of" x "making of" contam como o
   * mesmo. Para qualquer pessoa eles SÃO o mesmo, e quem paga o preço da
   * distinção não é o fotógrafo: é o casal, que abre o menu da galeria, vê duas
   * entradas de nome idêntico e encontra as fotos partidas entre as duas.
   *
   * `lower()` nos dois lados em vez de `citext` ou índice único: a comparação
   * mora ao lado da inserção, onde quem lê o código a encontra. Uma migração de
   * tipo para uma regra desta altura seria subir dois degraus a mais da escada.
   *
   * O `null` de volta é o mesmo que o de nome vazio — o chamador já trata.
   * `scripts/testar-secoes.mjs` prende os dois casos.
   */
  const repetido = await consultarUm<{ id: string }>(
    "select id from secoes where galeria_id = $1 and lower(nome) = lower($2) limit 1",
    [galeriaId, limpo],
  );
  if (repetido) return null;

  const prox = await consultarUm<{ n: number }>(
    "select coalesce(max(ordem), -1) + 1 as n from secoes where galeria_id = $1",
    [galeriaId],
  );
  return consultarUm<Secao>(
    "insert into secoes (galeria_id, nome, ordem) values ($1, $2, $3) returning *",
    [galeriaId, limpo, prox?.n ?? 0],
  );
}

/**
 * Devolve o id de cada capítulo pedido, criando só os que faltam.
 *
 * É o que o envio de pasta precisa: ele lê "01 Making Of", "02 Cerimônia" do
 * disco e tem de carimbar cada foto com um id. `criarSecao` sozinha não serve
 * porque devolve `null` em dois casos diferentes — nome vazio e nome repetido —
 * e o envio quer justamente o id do repetido, não um erro. Sem isto, a segunda
 * leva de fotos da mesma pasta chegaria sem capítulo nenhum.
 *
 * A ordem da lista é preservada, porque ela é a ordem das pastas, que é a ordem
 * da narrativa do casamento.
 *
 * SEQUENCIAL de propósito. Em paralelo, dois nomes que só diferem na caixa
 * ("Making Of" e "making of" na mesma pasta) poderiam passar juntos pela
 * checagem de repetido antes de qualquer um dos dois existir, e nasceriam os
 * dois. São poucos capítulos por envio; a lentidão não se nota, e a duplicata
 * apareceria no menu do casal, que é onde ninguém quer descobrir.
 */
export async function garantirSecoes(
  galeriaId: string,
  tenantId: string,
  nomes: string[],
): Promise<{ nome: string; id: string }[]> {
  if (!(await galeriaDoTenant(galeriaId, tenantId))) return [];

  const saida: { nome: string; id: string }[] = [];
  for (const bruto of nomes) {
    const nome = bruto.trim().slice(0, 60);
    if (!nome) continue;

    /* Procura antes de criar: o caso comum é o capítulo já existir, e assim o
     * envio da segunda leva não gasta uma tentativa de inserção por pasta. */
    const existente = await consultarUm<{ id: string; nome: string }>(
      "select id, nome from secoes where galeria_id = $1 and lower(nome) = lower($2) limit 1",
      [galeriaId, nome],
    );
    if (existente) {
      saida.push({ nome: existente.nome, id: existente.id });
      continue;
    }

    const criada = await criarSecao(galeriaId, tenantId, nome);
    if (criada) saida.push({ nome: criada.nome, id: criada.id });
  }
  return saida;
}

export async function renomearSecao(secaoId: string, tenantId: string, nome: string) {
  const limpo = nome.trim().slice(0, 60);
  if (!limpo) return;
  await consultar(
    `update secoes s set nome = $1
       from galerias g
      where s.id = $2 and s.galeria_id = g.id and g.tenant_id = $3`,
    [limpo, secaoId, tenantId],
  );
}

/** Apaga o capítulo; as fotos ficam (viram "sem capítulo") pelo on delete set null. */
export async function apagarSecao(secaoId: string, tenantId: string) {
  await consultar(
    `delete from secoes s
      using galerias g
      where s.id = $1 and s.galeria_id = g.id and g.tenant_id = $2`,
    [secaoId, tenantId],
  );
}

export async function moverSecao(secaoId: string, tenantId: string, direcao: "cima" | "baixo") {
  const atual = await consultarUm<Secao>(
    `select s.* from secoes s join galerias g on g.id = s.galeria_id
      where s.id = $1 and g.tenant_id = $2`,
    [secaoId, tenantId],
  );
  if (!atual) return;

  // Troca de posição com a vizinha na direção pedida.
  const vizinha = await consultarUm<Secao>(
    `select * from secoes
      where galeria_id = $1 and ordem ${direcao === "cima" ? "<" : ">"} $2
      order by ordem ${direcao === "cima" ? "desc" : "asc"} limit 1`,
    [atual.galeria_id, atual.ordem],
  );
  if (!vizinha) return;

  await consultar("update secoes set ordem = $1 where id = $2", [vizinha.ordem, atual.id]);
  await consultar("update secoes set ordem = $1 where id = $2", [atual.ordem, vizinha.id]);
}

/** Move fotos para um capítulo (ou para fora dele, com secaoId null). */
export async function moverMediasParaSecao(
  mediaIds: string[],
  secaoId: string | null,
  tenantId: string,
) {
  if (mediaIds.length === 0) return;

  /*
   * O filtro por tenant nas MÍDIAS não bastava: o `secaoId` vinha do formulário
   * e ia direto para o update. Um fotógrafo logado podia mandar o id de um
   * capítulo de OUTRO estúdio, e as fotos dele passavam a apontar para lá —
   * escrita cruzada entre contas, visível no painel da vítima.
   *
   * A tabela `secoes` não tem `tenant_id`, então o dono se descobre pela galeria.
   * Exigir também a MESMA galeria evita o caso mais bobo: jogar foto no capítulo
   * de outra galeria do próprio estúdio, onde ela sumiria da grade.
   */
  if (secaoId) {
    const destino = await consultarUm<{ id: string }>(
      `select s.id
         from secoes s
         join galerias g on g.id = s.galeria_id
        where s.id = $1
          and g.tenant_id = $2
          and s.galeria_id = (select galeria_id from medias where id = $3)`,
      [secaoId, tenantId, mediaIds[0]],
    );
    if (!destino) return;
  }

  await consultar(
    `update medias set secao_id = $1
      where id = any($2::uuid[]) and tenant_id = $3`,
    [secaoId, mediaIds, tenantId],
  );
}
