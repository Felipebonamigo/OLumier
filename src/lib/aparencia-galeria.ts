import "server-only";
import { consultar, consultarUm } from "@/lib/db";
import { lerAparencia, presetPorId, type Aparencia } from "@/config/aparencia";
import { aparenciaDoEstilo } from "@/lib/estilos-do-estudio";

/**
 * Rascunho e publicação da aparência — as duas escritas, num lugar só.
 *
 * ── POR QUE SÃO DUAS COLUNAS (01/09/2026) ─────────────────────────────────
 *
 * Até 31/08 o editor gravava a cada clique, direto em `aparencia`. Tinha uma
 * virtude — nada se perdia — e um defeito: experimentar mexia na galeria que o
 * cliente estava vendo naquele instante.
 *
 * O botão "Publicar aparência" resolveu o defeito e trouxe outro, pior, porque
 * é silencioso: quem escolhia e saía sem apertar perdia a escolha. Custou isso
 * no mesmo dia, com a primeira usuária de verdade.
 *
 * As duas colunas separam o que estava grudado:
 *
 *   aparencia            o que o CLIENTE vê. Só muda em `publicarAparencia`.
 *   aparencia_rascunho   o que o FOTÓGRAFO está experimentando. Grava sozinho.
 *
 * Nada se perde, inclusive trocando de aparelho — que é o que o navegador
 * sozinho não resolveria —, e publicar continua sendo um ato.
 *
 * ── POR QUE ISTO NÃO MORA EM `actions.ts` ─────────────────────────────────
 *
 * Server action não se importa de um script de teste: puxa o runtime do cliente
 * do Next e estoura fora de uma requisição. Com a regra aqui, `testar-previa`
 * exercita a ESCRITA de verdade, contra o banco, em vez de conferir a tela e
 * torcer. As actions viram duas linhas de casca.
 */

/** Guarda o que o fotógrafo está experimentando. Não toca no que está no ar. */
export async function gravarRascunho(
  galeriaId: string,
  tenantId: string,
  bruto: unknown,
): Promise<{ ok: boolean }> {
  const limpa = lerAparencia(bruto);
  /* O `returning` existe para saber se ESCREVEU: um update sem ele devolve lista
     vazia tanto quando gravou quanto quando não achou a galeria, e a tela diria
     "salvo" para uma gravação que não aconteceu. */
  const linhas = await consultar(
    `update galerias set aparencia_rascunho = $1
      where id = $2 and tenant_id = $3
      returning id`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );
  return { ok: linhas.length > 0 };
}

/**
 * Publica: o que estava no rascunho passa a ser o que o cliente vê.
 *
 * O rascunho é APAGADO no mesmo update, e não numa segunda consulta. Sobrando,
 * ele seria idêntico ao publicado e a barra continuaria pedindo para publicar
 * uma coisa já publicada — e, num update separado, uma falha de rede no meio
 * deixaria exatamente esse estado.
 */
export async function publicarAparencia(
  galeriaId: string,
  tenantId: string,
  bruto: unknown,
): Promise<{ ok: boolean; aparencia: Aparencia }> {
  const limpa = lerAparencia(bruto);
  const linhas = await consultar(
    `update galerias set aparencia = $1, aparencia_rascunho = null, atualizado_em = now()
      where id = $2 and tenant_id = $3
      returning id`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );
  return { ok: linhas.length > 0, aparencia: limpa };
}

/**
 * Publicar a GALERIA leva a aparência pendente junto.
 *
 * ── O ERRO QUE ISTO CONSERTA, VISTO DUAS VEZES ─────────────────────────────
 *
 * A Carol em 31/08/2026 e a Ana em 04/09/2026 fizeram a mesma coisa: escolheram
 * o tema claro, viram a prévia clara, saíram — e o cliente recebeu a galeria
 * escura. Em produção a linha da Ana estava assim:
 *
 *   aparencia          {}                     → cai no padrão, que é noite
 *   aparencia_rascunho {"tema":"claro", ...}
 *
 * O produto estava tecnicamente certo, e a barra do editor até dizia "o seu
 * cliente ainda vê o anterior". Só que duas de duas usuárias não viram — e
 * aviso que ninguém vê não é aviso.
 *
 * Quem aperta "publicar galeria" está dizendo "o cliente pode ver o que eu
 * fiz". Deixar o desenho para trás nesse exato instante nunca é o que se quis.
 *
 * A separação rascunho/publicado NÃO acabou, e não podia: ela existe para
 * experimentar sem mexer na galeria que o cliente já está vendo. O que mudou é
 * que o ato de publicar a galeria também é um ato de publicar o que ela é.
 *
 * Devolve true quando havia rascunho e ele virou o publicado.
 */
export async function promoverRascunhoSePendente(
  galeriaId: string,
  tenantId: string,
): Promise<boolean> {
  /*
   * Um UPDATE só, com a condição dentro: ler-e-depois-escrever abriria janela
   * para o editor gravar um rascunho entre as duas consultas, e aí publicaríamos
   * um estado que a pessoa não viu na prévia.
   *
   * `lerAparencia` não roda aqui de propósito — o rascunho já passou por ela em
   * `gravarRascunho`, e revalidar exigiria trazer o JSON para o Node só para
   * devolvê-lo igual.
   */
  const linhas = await consultar(
    `update galerias
        set aparencia = aparencia_rascunho,
            aparencia_rascunho = null,
            atualizado_em = now()
      where id = $1 and tenant_id = $2 and aparencia_rascunho is not null
      returning id`,
    [galeriaId, tenantId],
  );
  return linhas.length > 0;
}

/**
 * ── O PADRÃO DE DESIGN DO ESTÚDIO (16/09/2026) ────────────────────────────
 *
 * Felipe: "adicionar algum método de 'salvar padrão criado', para sempre se
 * repetir na hora do design da capa".
 *
 * O editor tem doze eixos. Um fotógrafo acerta a combinação dele uma vez e a
 * partir daí quer ISSO em toda entrega — e até hoje refazia as doze escolhas
 * por galeria. Um estúdio tem UMA identidade visual; o padrão é ela.
 *
 * Ver a migração 036 para por que isto é uma coluna no tenant e não uma lista
 * de presets salvos.
 */

/** Guarda a aparência como o padrão do estúdio. Sobrescreve o anterior. */
export async function salvarPadraoDoEstudio(tenantId: string, bruto: unknown) {
  /*
   * Passa por `lerAparencia` ANTES de gravar, ao contrário do rascunho — que já
   * chega validado de `gravarRascunho`. Aqui a origem é a tela, e o que se grava
   * vai valer para toda galeria futura: um campo torto aqui se propagaria
   * silenciosamente por um ano de entregas.
   */
  await consultar("update tenants set aparencia_padrao = $1 where id = $2", [
    JSON.stringify(lerAparencia(bruto)),
    tenantId,
  ]);
}

/** Esquece o padrão: a galeria nova volta a nascer com o padrão do código. */
export async function esquecerPadraoDoEstudio(tenantId: string) {
  await consultar("update tenants set aparencia_padrao = null where id = $1", [tenantId]);
}

/**
 * A aparência com que uma galeria nova deste estúdio deve nascer.
 *
 * Null quando o estúdio nunca salvou um padrão — e aí quem cria não grava nada,
 * deixando a coluna `aparencia` no `'{}'` de sempre, que `lerAparencia`
 * completa com o padrão do código. É o que mantém esta migração sem efeito
 * nenhum sobre quem não pediu.
 */
export async function padraoDoEstudio(tenantId: string): Promise<unknown | null> {
  const linha = await consultarUm<{ aparencia_padrao: unknown }>(
    "select aparencia_padrao from tenants where id = $1",
    [tenantId],
  );
  return linha?.aparencia_padrao ?? null;
}

/**
 * O mesmo padrão, já LIDO — para as telas que o desenham.
 *
 * O painel mostra o padrão como cartão (em Design e na criação da galeria), e
 * cartão precisa de aparência completa: `lerAparencia` preenche o eixo que
 * nasceu depois de o padrão ser salvo, do mesmo jeito que faz com a galeria.
 * Null continua querendo dizer "nunca salvou".
 */
export async function padraoDoEstudioLido(tenantId: string): Promise<Aparencia | null> {
  const bruto = await padraoDoEstudio(tenantId);
  return bruto ? lerAparencia(bruto) : null;
}

/**
 * A aparência com que uma galeria NOVA nasce, pelo que a pessoa escolheu na
 * criação.
 *
 * A ordem é a de quem decidiu mais perto desta galeria: um estilo pronto ou um
 * estilo salvo apontado na etapa de estilo (uma decisão tomada AGORA, sobre
 * esta entrega) vence o padrão do estúdio, que é a decisão de sempre e serve a
 * quem passou direto. Sem nenhum dos três, null — e a coluna fica no `'{}'`
 * de sempre, que `lerAparencia` completa com o padrão do código.
 *
 * Estilo que não é deste estúdio (ou foi apagado entre abrir a tela e criar)
 * é ignorado em silêncio: a galeria nasce no padrão, e não deixa de nascer.
 */
export async function aparenciaInicialDaGaleria(
  tenantId: string,
  presetId: string,
  estiloId: string,
): Promise<unknown | null> {
  const preset = presetPorId(presetId);
  if (preset) return preset.aparencia;
  if (estiloId) {
    const doEstilo = await aparenciaDoEstilo(tenantId, estiloId);
    if (doEstilo) return doEstilo;
  }
  return padraoDoEstudio(tenantId);
}
