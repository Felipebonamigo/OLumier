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
export async function chavesConhecidas(db) {
  const { rows: midias } = await db.query(
    "select chave, chave_thumb, chave_preview, armazem from medias",
  );
  const { rows: marcas } = await db.query(
    "select logo_chave from tenants where logo_chave is not null",
  );

  const r2 = new Set();
  const b2 = new Set();

  for (const m of midias) {
    /* O original segue a coluna; as derivadas, nunca. */
    if (m.chave) (m.armazem === "b2" ? b2 : r2).add(m.chave);
    if (m.chave_thumb) r2.add(m.chave_thumb);
    if (m.chave_preview) r2.add(m.chave_preview);
  }
  for (const t of marcas) if (t.logo_chave) r2.add(t.logo_chave);

  return { r2, b2 };
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
