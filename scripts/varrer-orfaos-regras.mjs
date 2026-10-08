/**
 * A regra de "o que o banco reconhece como seu", separada do script que apaga.
 *
 * Mora aqui, e não dentro de varrer-orfaos.mjs, para o teste exercitar ESTE
 * código em vez de uma cópia. Uma regra de segurança testada por imitação não
 * está testada: no dia em que alguém mexer no original, o teste continua verde
 * enquanto o script destrói arquivo.
 */

/**
 * As chaves que têm dono no banco, SEPARADAS POR ARMAZÉM.
 *
 * Devolve `{ r2, b2 }`, dois Set. São conjuntos diferentes porque são buckets
 * diferentes: comparar a listagem de um contra as chaves do outro classifica
 * arquivo vivo como órfão.
 *
 * ── ORIGEM 1: a logo do estúdio ───────────────────────────────────────────
 * Mora no bucket mas não tem linha em `medias` — é do estúdio, não de uma
 * galeria. Uma varredura que olhasse só `medias` classificaria a logo de TODO
 * MUNDO como órfã e, com `--apagar`, tiraria a marca de todos os clientes de
 * uma vez. Logo é sempre R2.
 *
 * ── ORIGEM 2: as mídias, e aqui mora a armadilha ──────────────────────────
 * `medias.armazem` descreve UM dos três arquivos da linha: o ORIGINAL. As
 * derivadas (`chave_thumb`, `chave_preview`) ficam SEMPRE no R2 — veja
 * `urlDaDerivada` em src/lib/armazem.ts, que lê a derivada direto do R2 sem
 * passar pelo despachante de armazém.
 *
 * Separar por LINHA — jogar os três campos de uma mídia do B2 no conjunto do
 * B2 — faria a varredura do R2 deixar de reconhecer as derivadas de toda
 * galeria servida pelo B2. Com `--apagar`, miniatura e prévia de todas elas
 * seriam removidas.
 *
 * E o estrago não apareceria: quando a derivada falta, `urlDaDerivada` cai no
 * original. A galeria passa a servir o arquivo cheio no lugar da miniatura —
 * uma grade de 800 fotos vira 800 downloads de original, com egresso pago do
 * B2. Fica lenta e cara em vez de visivelmente quebrada, então ninguém abre
 * chamado e a conta chega no fim do mês.
 *
 * `scripts/testar-limpeza.mjs` prende cada um desses casos.
 */
/**
 * O estúdio dono de uma chave — o primeiro pedaço do caminho.
 *
 * TODA chave do bucket começa com o id do estúdio: mídia em
 * `<tenant>/<galeria>/<uuid>.ext` e logo em `<tenant>/marca/<uuid>.png`.
 * Devolve `null` para chave sem barra, que não tem dono declarado.
 */
export function donoDaChave(chave) {
  const corte = String(chave ?? "").indexOf("/");
  return corte > 0 ? chave.slice(0, corte) : null;
}

/**
 * A chave pertence a OUTRO ambiente?
 *
 * O guarda mais abaixo recusa a varredura inteira quando banco e bucket não
 * combinam. É grosso de propósito, e tem um custo: do dev a varredura nunca
 * roda, órfão nenhum aparece, e alguém acaba contornando o guarda.
 *
 * Esta é a régua fina, e ela vale mesmo com o bucket compartilhado: chave cujo
 * dono não é estúdio DESTE banco não é conhecida nem órfã — é de outra gente. A
 * varredura passa longe em vez de classificar foto de cliente como lixo.
 *
 * Falha para o lado de NÃO apagar em todos os casos duvidosos: chave sem dono,
 * dono desconhecido, e conjunto de donos vazio (banco novo, ou consulta que não
 * trouxe nada). Se vazio significasse "tudo é nosso", o pior caso seria apagar
 * o bucket inteiro.
 *
 * O preço: objeto de estúdio APAGADO daqui vira invisível para a varredura, em
 * vez de virar órfão. É custo de armazenamento contra risco de destruir foto de
 * casamento — e por isso `varrer-orfaos.mjs` os RELATA à parte, para não somem
 * do mapa em silêncio.
 */
export function deOutroAmbiente(chave, donos) {
  const dono = donoDaChave(chave);
  return dono === null || !donos.has(dono);
}

export async function chavesConhecidas(db) {
  const { rows: midias } = await db.query(
    "select chave, chave_thumb, chave_preview, chave_reproducao, armazem from medias",
  );
  const { rows: marcas } = await db.query(
    "select logo_chave, fonte_chave from tenants where logo_chave is not null or fonte_chave is not null",
  );
  /*
   * AS CAPAS ENVIADAS COMO ARQUIVO — e a falta delas aqui era um defeito.
   *
   * Até 02/10/2026 esta função só conhecia as mídias e a logo. A capa enviada
   * à parte (`galerias.capa_chave`, migração 029) tinha dono no banco e nenhum
   * dono aqui: a varredura a lia como órfã e `--apagar` levava o arquivo de uma
   * galeria publicada. A capa de pasta (migração 057) nasceu com o mesmo risco
   * e entrou junto. Toda coluna de chave nova precisa vir para cá — é esta
   * lista que decide o que sobrevive no bucket.
   */
  const { rows: capas } = await db.query(
    "select capa_chave from galerias where capa_chave is not null",
  );
  const { rows: capasDePasta } = await db.query(
    "select capa_chave from secoes where capa_chave is not null",
  );
  /*
   * AS FOTOS DA PÁGINA INICIAL (migração 043) — a quarta coluna de chave que
   * estava fora desta lista, achada em 02/10/2026 pelo teste que varre o
   * `information_schema` em vez de confiar em memória.
   *
   * Elas não pertencem a galeria nenhuma: o admin as troca pela tela da home, e
   * ficam no bucket com duas derivadas. Fora daqui, `--apagar` levava a capa da
   * própria página de vendas.
   */
  const { rows: daHome } = await db.query(
    "select chave, chave_miniatura from fotos_da_home",
  );
  /* Os donos vêm de `tenants`, não das chaves: um estúdio recém-criado, ainda
   * sem foto nenhuma, precisa ser reconhecido como daqui. */
  const { rows: donosRows } = await db.query("select id from tenants");

  const r2 = new Set();
  const b2 = new Set();
  const donos = new Set(donosRows.map((t) => t.id));

  for (const m of midias) {
    /* O original segue a coluna; as derivadas, nunca. */
    if (m.chave) (m.armazem === "b2" ? b2 : r2).add(m.chave);
    if (m.chave_thumb) r2.add(m.chave_thumb);
    if (m.chave_preview) r2.add(m.chave_preview);
    /* A versão leve do vídeo (migração 065) — derivada, então R2. Sem esta
       linha a varredura a acharia sem dono e apagaria a cópia que o cliente
       assiste. */
    if (m.chave_reproducao) r2.add(m.chave_reproducao);
  }
  for (const t of marcas) {
    if (t.logo_chave) r2.add(t.logo_chave);
    /*
     * A FONTE PRÓPRIA DO ESTÚDIO (migração 026) — a terceira coluna de chave do
     * banco, e a que ficou de fora quando as capas entraram em 02/10/2026.
     *
     * O comentário da rota da fonte dizia que "a varredura já a conhece
     * (ehChaveDeMarca)". Não conhecia: `ehChaveDeMarca` existe em `lib/r2.ts` e
     * nenhum script da varredura a importa — é código morto. E o dono da chave É
     * um tenant deste banco, então o guarda de ambiente também não a protegia.
     */
    if (t.fonte_chave) r2.add(t.fonte_chave);
  }
  /* As capas são sempre do R2: nenhum caminho de envio de capa escreve no B2. */
  for (const c of [...capas, ...capasDePasta]) if (c.capa_chave) r2.add(c.capa_chave);
  for (const f of daHome) {
    if (f.chave) r2.add(f.chave);
    if (f.chave_miniatura) r2.add(f.chave_miniatura);
  }

  return { r2, b2, donos };
}

/*
 * ── O GUARDA DO AMBIENTE ──────────────────────────────────────────────────
 *
 * Em 26/08/2026 mediu-se que desenvolvimento e produção gravam no MESMO bucket
 * R2: `R2_BUCKET=galerias` e a mesma conta nos dois `.env`. A varredura compara
 * UM bucket contra UM banco, então tudo que o outro ambiente criou parece órfão.
 *
 * A direção cara: com foto de cliente em produção, rodar `--apagar` a partir do
 * DEV classifica essas fotos como órfãs — o banco de dev não conhece aquelas
 * chaves — e apaga foto de casamento.
 *
 * O QUE SEPARA OS AMBIENTES É O BANCO, NUNCA O BUCKET. Dev fala com
 * `fotonio_dev`, produção com `fotonio`, e os dois escrevem em `galerias`. Por
 * isso a pergunta aqui é se os dois combinam, e não "o banco está vazio?" — um
 * guarda de banco vazio deixaria passar justamente este caso, porque o dev
 * conhece centenas de chaves, as dele.
 *
 * Não dá para comparar os dois arquivos de ambiente: nenhuma máquina tem os
 * dois. O `.env.production` não existe na máquina de dev, e o `.env.local` não
 * existe no servidor. O que cada processo sabe é de si mesmo, e é só disso que
 * esta função precisa.
 *
 * ASSIMETRIA DELIBERADA: não impede produção de apagar arquivo de teste do dev.
 * Um lado destrói foto de cliente, o outro destrói `limpeza-0.png`.
 *
 * É REMENDO. O conserto é separar o bucket por ambiente — e nesse dia esta
 * função para de recusar sozinha, sem ninguém precisar lembrar de tirá-la.
 */
const BUCKET_DE_PRODUCAO = "galerias";
const BANCO_DE_PRODUCAO = "fotonio";

/** O nome do banco na ponta da URL, sem query. `null` quando não dá para saber. */
function nomeDoBanco(url) {
  if (!url) return null;
  const semQuery = String(url).split("?")[0].replace(/\/+$/, "");
  const nome = semQuery.slice(semQuery.lastIndexOf("/") + 1);
  return nome || null;
}

/**
 * Decide se `--apagar` pode rodar neste ambiente.
 * Devolve `{ pode, motivo }` — o motivo existe para quem rodar entender a recusa
 * em vez de achar que o script quebrou.
 */
export function podeApagar({ bucket, databaseUrl }) {
  if (bucket !== BUCKET_DE_PRODUCAO) return { pode: true };

  const banco = nomeDoBanco(databaseUrl);
  if (!banco) {
    return {
      pode: false,
      motivo:
        `sem DATABASE_URL não dá para saber de que ambiente é este banco, e o bucket ` +
        `"${BUCKET_DE_PRODUCAO}" é o de produção. Na dúvida, não apaga.`,
    };
  }
  if (banco !== BANCO_DE_PRODUCAO) {
    return {
      pode: false,
      motivo:
        `este processo fala com o banco "${banco}" mas escreve no bucket ` +
        `"${BUCKET_DE_PRODUCAO}", que é o de PRODUÇÃO. Os dois ambientes dividem esse ` +
        `bucket, então o que é de produção não aparece neste banco e entraria na lista ` +
        `de órfãos — inclusive foto de cliente. Rode a varredura do próprio ambiente, ` +
        `ou separe o bucket antes.`,
    };
  }
  return { pode: true };
}
