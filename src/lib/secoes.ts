import "server-only";
import { consultar, consultarUm } from "./db";
import { gerarSlug } from "./tenants";
import { ORDENS_DAS_FOTOS, type OrdemDasFotos } from "@/config/ordens-das-fotos";

export { ORDENS_DAS_FOTOS, type OrdemDasFotos };

export interface Secao {
  id: string;
  galeria_id: string;
  nome: string;
  /**
   * O APELIDO DO CAPÍTULO — a parte que vai no link (`?cap=cerimonia`).
   *
   * Felipe, 16/09/2026: "o link do capítulo está muito extenso, temos que
   * diminuir e ficar mais simples, para quando mandar". Era o id da seção, 36
   * caracteres de UUID para dizer "Cerimônia" — e um UUID no meio de uma
   * mensagem de WhatsApp parece link de rastreamento.
   *
   * Coluna e não derivação do nome na hora, por dois motivos escritos na
   * migração 034: dois nomes podem gerar o mesmo apelido, e renomear o capítulo
   * mudaria o link já entregue em silêncio.
   */
  slug: string;
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
    "insert into secoes (galeria_id, nome, slug, ordem) values ($1, $2, $3, $4) returning *",
    [galeriaId, limpo, await apelidoLivre(galeriaId, limpo), prox?.n ?? 0],
  );
}

/**
 * Um apelido que ainda não existe nesta galeria.
 *
 * O nome já foi recusado se repetido, mas o APELIDO ainda pode colidir: "Making
 * Of" e "Making-of" são nomes diferentes e dão o mesmo `making-of`. O índice
 * único da migração 034 recusaria a segunda inserção, e o fotógrafo veria o
 * capítulo simplesmente não ser criado — por causa de um hífen que ele não
 * digitou.
 *
 * O sufixo numérico é o mesmo desempate do endereço do estúdio (`gerarSlug` +
 * `-2`, `-3`): feio de ler e melhor que a criação falhar.
 *
 * Sem letra nenhuma no nome (um capítulo chamado só "🎉") o apelido sai do id,
 * como no backfill da migração.
 */
async function apelidoLivre(galeriaId: string, nome: string): Promise<string> {
  const base = gerarSlug(nome);
  if (!base) return `cap-${Date.now().toString(36)}`;
  let tentativa = base;
  for (let i = 2; ; i++) {
    const ocupado = await consultarUm(
      "select 1 from secoes where galeria_id = $1 and slug = $2",
      [galeriaId, tentativa],
    );
    if (!ocupado) return tentativa;
    tentativa = `${base}-${i}`;
  }
}

/**
 * De quem é este `?cap=` — apelido ou id.
 *
 * O apelido vem primeiro porque é o link de hoje. O id continua sendo aceito
 * porque os links de ontem o carregam, e link de capítulo entregue ao casal não
 * se reenvia — mesma razão dos apelidos de endereço (migrações 025 e 030).
 *
 * `sem-capitulo` atravessa intocado: é um nome que a página inventa para o
 * grupo das fotos soltas, não um capítulo do banco.
 */
export async function secaoPeloApelido(
  galeriaId: string,
  pedido: string,
): Promise<string | null> {
  if (!pedido || pedido === "sem-capitulo") return pedido || null;
  const achada = await consultarUm<{ id: string }>(
    "select id from secoes where galeria_id = $1 and (slug = $2 or id::text = $2) limit 1",
    [galeriaId, pedido],
  );
  return achada?.id ?? null;
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

/*
 * Renomear NÃO mexe no apelido, e isso é a promessa da migração 034: o
 * fotógrafo troca "Festa" por "Festa 🎉" e o link que ele mandou ontem para o
 * casal continua abrindo. O apelido é do capítulo, não do texto que por acaso
 * está nele hoje.
 */
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

/**
 * COMO SE CHAMA, NESTA GALERIA, O GRUPO DAS FOTOS SEM CAPÍTULO.
 *
 * ── DE ONDE VEIO (18/09/2026, migração 037) ──────────────────────────────
 *
 * Juan: "aqui fica aparecendo 'outras fotos' (…) não tem como trocar pra esse
 * nome, tipo galeria completa ou algo assim. Não criei nenhuma pasta com esse
 * nome." Não criou: o grupo é calculado — é o que sobra — e o texto era nosso.
 *
 * Não está em `renomearSecao` porque não é uma seção: não há linha para
 * atualizar. O nome mora na galeria, e o grupo continua existindo (ou não)
 * conforme haja foto solta.
 *
 * VAZIO APAGA. Limpar o campo grava `null`, e `nomeDoGrupoSolto` devolve
 * "Outras fotos" de novo — voltar ao nome de fábrica não precisa de um botão
 * próprio, e um texto vazio aqui faria a pastilha sem letra nenhuma que a
 * mudança de 04/09/2026 veio tirar da tela.
 */
export async function renomearGrupoSolto(galeriaId: string, tenantId: string, nome: string) {
  const limpo = nome.trim().slice(0, 60);
  await consultar(`update galerias set grupo_solto = $1 where id = $2 and tenant_id = $3`, [
    limpo || null,
    galeriaId,
    tenantId,
  ]);
}

/** Compara como o fotógrafo espera: foto_2 antes de foto_10. */
const colador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/**
 * Reordena as fotos de um capítulo (ou as sem capítulo) por um critério.
 *
 * ── POR QUE A ORDENAÇÃO ACONTECE EM JAVASCRIPT ───────────────────────────
 *
 * Por causa do A→Z. O fotógrafo espera `foto_2` antes de `foto_10`, e é isso
 * que o `Intl.Collator` com `numeric` faz — a MESMA função que ordena os
 * arquivos no envio (`ordenarNaturalPorCaminho`). O Postgres não tem ordenação
 * natural: um `order by nome_original` põe `foto_10` antes de `foto_2`, e
 * chegar perto disso em SQL exigiria uma função de chave que envelheceria
 * separada da do envio. São algumas centenas de linhas por capítulo, já
 * trazidas por `galeria_id`.
 *
 * ── A ESCRITA É UMA SÓ ───────────────────────────────────────────────────
 *
 * Um `update` por foto seriam 600 idas ao banco por clique. O `unnest` manda a
 * lista inteira numa instrução: cada id recebe a posição que a ordenação lhe
 * deu.
 *
 * Renumerar de 0 a N-1 é seguro porque a galeria ordena por capítulo ANTES de
 * `ordem` (ver `listarMediasPublicas`): dentro do capítulo só a posição
 * relativa importa, e entre capítulos quem manda é `secoes.ordem`.
 */
export async function ordenarFotosDaSecao(
  galeriaId: string,
  tenantId: string,
  secaoId: string | null,
  criterio: OrdemDasFotos,
): Promise<{ ok: boolean; quantas: number; semData: number }> {
  if (!(await galeriaDoTenant(galeriaId, tenantId))) return { ok: false, quantas: 0, semData: 0 };

  /*
   * `baixadas` vem junto porque "mais baixadas" precisa dela, e uma segunda
   * consulta por foto seriam centenas de idas ao banco. O `left join lateral`
   * conta só as fotos deste capítulo, e não a galeria inteira.
   *
   * `acao = 'baixou'` e não `in ('baixou','baixou_tudo')`: o zip da galeria
   * inteira não é sobre uma foto, e contá-lo daria +1 em todas de uma vez —
   * "mais baixadas" viraria a ordem de sempre com um número maior em cima.
   *
   * ── O `order by` NÃO É ENFEITE: ELE É O DESEMPATE (25/09/2026) ─────────
   *
   * Juan: "as fotos não estão ficando em ordem de A-Z. A foto seguinte tem que
   * estar logo depois da foto anterior."
   *
   * Duas fotos com o MESMO nome empatam — e elas existem de verdade nas
   * galerias dele: a entrega da Júlia tinha `sirius-jugusw-1070.jpg` duas
   * vezes, que é o que faz o zip precisar do `nomeUnico` e a tela precisar do
   * `AvisoDeRepetidas`. O `Intl.Collator` devolve 0 para o par, e com
   * `sensitivity: "base"` ele devolve 0 também para `Foto.JPG` e `foto.jpg`.
   *
   * Empate resolvido pelo `sort`, que é estável desde o ES2019: o par sai na
   * ordem em que ENTROU. Só que a consulta não pedia ordem nenhuma, e sem
   * `order by` o Postgres não promete nada — ele devolve o que for mais barato
   * de ler, que muda com um `update`, com um `vacuum` ou com o plano. Ou seja:
   * clicar "Nome A → Z" duas vezes podia dar dois resultados diferentes, e a
   * cópia preto-e-branco caía antes da colorida sem nada tê-la mandado para lá.
   *
   * Pedindo `ordem` aqui, o empate cai na sequência que a galeria já tinha —
   * que é a do envio, a que o fotógrafo montou. `criado_em` e `id` fecham a
   * conta para as linhas que nasceram com a mesma `ordem`.
   *
   * Vale para os cinco critérios de uma vez, e não só para o A→Z: em "mais
   * baixadas" a galeria recém-entregue é um empate de ponta a ponta.
   */
  const fotos = await consultar<{
    id: string;
    nome_original: string;
    criado_em: Date;
    tirada_em: Date | null;
    baixadas: number;
  }>(
    `select m.id, m.nome_original, m.criado_em, m.tirada_em,
            coalesce(d.n, 0)::int as baixadas
       from medias m
       left join lateral (
         select count(*) as n from acessos a
          where a.media_id = m.id and a.acao = 'baixou'
       ) d on true
      where m.galeria_id = $1 and ${secaoId === null ? "m.secao_id is null" : "m.secao_id = $2"}
      order by m.ordem, m.criado_em, m.id`,
    secaoId === null ? [galeriaId] : [galeriaId, secaoId],
  );
  if (fotos.length === 0) return { ok: true, quantas: 0, semData: 0 };

  const quando = (f: (typeof fotos)[number]) =>
    (criterio === "cronologica" ? (f.tirada_em ?? f.criado_em) : f.criado_em).getTime();

  const ordenadas = [...fotos].sort((a, b) => {
    if (criterio === "nome") return colador.compare(a.nome_original, b.nome_original);
    if (criterio === "nome-invertido") return colador.compare(b.nome_original, a.nome_original);
    /* Empate em "mais baixadas" é a regra e não a exceção: numa galeria nova
       TODAS têm zero. Sem desempate a ordem viria do banco, que não promete
       nenhuma — a pessoa clicaria "mais baixadas" e veria a galeria embaralhar
       sem motivo. O nome é o desempate porque é o que ela reconhece. */
    if (criterio === "mais-baixadas") {
      return b.baixadas - a.baixadas || colador.compare(a.nome_original, b.nome_original);
    }
    /* Empate de horário — rajada de câmera grava várias no mesmo segundo — cai
       no nome, que dentro de uma câmera é a sequência do disparo. */
    const dif = quando(a) - quando(b);
    return dif !== 0 ? dif : colador.compare(a.nome_original, b.nome_original);
  });

  await consultar(
    `update medias m
        set ordem = nova.posicao
       from unnest($1::uuid[], $2::int[]) as nova(id, posicao)
      where m.id = nova.id and m.galeria_id = $3`,
    [ordenadas.map((f) => f.id), ordenadas.map((_, i) => i), galeriaId],
  );

  return {
    ok: true,
    quantas: ordenadas.length,
    /* Quantas não tinham data da câmera. A tela usa este número para avisar
       que aquelas caíram na data de envio, em vez de fingir que a ordem
       cronológica valeu para todas. */
    semData: criterio === "cronologica" ? fotos.filter((f) => !f.tirada_em).length : 0,
  };
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

/**
 * Grava a ordem inteira dos capítulos de uma vez.
 *
 * ── POR QUE ISTO EXISTE AO LADO DE `moverSecao` (11/09/2026) ──────────────
 *
 * Carol: "tem que clicar na flechinha e ir subindo um por um pra organizar,
 * não tem como fazer algo tipo pra segurar e arrastar? Quero subir a pasta da
 * festa lá pra cima". Sete capítulos, "Festa" no fim: seis cliques, seis idas
 * ao servidor, a página recarregando embaixo do dedo a cada uma.
 *
 * `moverSecao` continua — é a operação de um passo, e é o que as setas fazem;
 * elas ficam para quem usa teclado e para o toque, onde `draggable` do HTML
 * não existe. Arrastar, porém, não é um passo: é uma ordem nova inteira, e
 * pedir seis trocas de vizinho para descrever um gesto seria reimplementar o
 * gesto em cima da peça errada.
 *
 * ── A LISTA VEM DO NAVEGADOR ──────────────────────────────────────────────
 *
 * E por isso nada dela é usado antes de passar pelo banco. O `where` amarra
 * cada id à galeria E ao tenant numa consulta só: id de capítulo de outro
 * estúdio simplesmente não aparece no resultado, e o que não aparece não é
 * gravado. Sem isso, "reordene esta lista" seria "reordene a galeria de quem
 * eu quiser" — `scripts/testar-ordem-capitulos.mjs` tenta exatamente isso.
 *
 * Capítulo que a lista não mencionou não some nem embaralha: vai para depois
 * dos enviados, na ordem que já tinha. É o que mantém a tela coerente quando o
 * navegador manda uma lista defasada — alguém criou um capítulo noutra aba
 * enquanto esta arrastava.
 */
export async function reordenarSecoes(galeriaId: string, tenantId: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) return;

  /* As que EXISTEM e são desta galeria deste tenant. A lista de fora serve
     só para ordenar o que o banco confirmou. */
  const minhas = await consultar<Secao>(
    `select s.id, s.ordem from secoes s
       join galerias g on g.id = s.galeria_id
      where s.galeria_id = $1 and g.tenant_id = $2
      order by s.ordem, s.criado_em`,
    [galeriaId, tenantId],
  );
  if (minhas.length === 0) return;

  const validos = new Set(minhas.map((s) => s.id));
  const pedidos: string[] = [];
  for (const id of ids) {
    /* `Set` de ida e volta resolve o id repetido sem um passo à parte: a
       segunda aparição não acha mais o id em `validos`. */
    if (validos.has(id)) {
      pedidos.push(id);
      validos.delete(id);
    }
  }
  if (pedidos.length === 0) return;

  /* Os que sobraram mantêm a ordem antiga entre si, atrás dos pedidos. */
  const finais = [...pedidos, ...minhas.filter((s) => validos.has(s.id)).map((s) => s.id)];

  /*
   * Uma consulta só, e não uma por capítulo: sete UPDATEs em sequência abrem
   * sete janelas em que a galeria tem duas seções com a mesma `ordem`, e a
   * página do cliente pode ser montada no meio delas.
   */
  await consultar(
    `update secoes s set ordem = novo.ordem
       from (select unnest($3::uuid[]) as id, generate_subscripts($3::uuid[], 1) - 1 as ordem) novo
      where s.id = novo.id and s.galeria_id = $1
        and exists (select 1 from galerias g where g.id = s.galeria_id and g.tenant_id = $2)`,
    [galeriaId, tenantId, finais],
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

/**
 * Manda TODAS as fotos sem capítulo desta galeria para um capítulo.
 *
 * ── POR QUE NÃO REUSA `moverMediasParaSecao` ───────────────────────────────
 *
 * Aquela recebe uma lista de ids, e a lista teria de ser montada antes — o
 * painel precisaria carregar as mídias só para descobrir quais estão soltas, e
 * a aba Fotos de um casamento tem 600 delas. Aqui o "quais" é uma condição
 * (`secao_id is null`), e o banco resolve num UPDATE só.
 *
 * As duas travas de sempre, e as duas importam:
 *
 *   o CAPÍTULO tem de ser desta galeria E deste estúdio — senão um id de
 *   capítulo alheio no formulário jogaria as fotos para a conta de outro;
 *   a GALERIA tem de ser deste estúdio — o update filtra por `tenant_id`
 *   também nas mídias, e não só pela galeria.
 *
 * Devolve quantas moveu. Zero quando o capítulo não é válido para esta
 * galeria: quem chama trata como "não fiz nada", que é a verdade.
 */
export async function moverSoltasParaSecao(
  galeriaId: string,
  secaoId: string,
  tenantId: string,
): Promise<number> {
  const destino = await consultarUm<{ id: string }>(
    `select s.id
       from secoes s
       join galerias g on g.id = s.galeria_id
      where s.id = $1 and s.galeria_id = $2 and g.tenant_id = $3`,
    [secaoId, galeriaId, tenantId],
  );
  if (!destino) return 0;

  const movidas = await consultar<{ id: string }>(
    `update medias set secao_id = $1
      where galeria_id = $2 and tenant_id = $3 and secao_id is null
      returning id`,
    [secaoId, galeriaId, tenantId],
  );
  return movidas.length;
}
