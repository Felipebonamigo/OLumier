/**
 * A regra de "o que o banco reconhece como seu", separada do script que apaga.
 *
 * Mora aqui, e não dentro de varrer-orfaos.mjs, para o teste exercitar ESTE
 * código em vez de uma cópia. Uma regra de segurança testada por imitação não
 * está testada: no dia em que alguém mexer no original, o teste continua verde
 * enquanto o script destrói arquivo.
 */

/**
 * Todas as chaves do bucket que têm dono no banco.
 *
 * São DUAS origens, e esquecer a segunda é destrutivo: a logo do estúdio mora no
 * bucket mas não tem linha em `medias` — ela é do estúdio, não de uma galeria.
 * Uma varredura que olhasse só `medias` classificaria a logo de TODO MUNDO como
 * órfã e, com `--apagar`, tiraria a marca de todos os clientes de uma vez.
 */
export async function chavesConhecidas(db) {
  const { rows: midias } = await db.query("select chave, chave_thumb, chave_preview from medias");
  const { rows: marcas } = await db.query(
    "select logo_chave from tenants where logo_chave is not null",
  );
  return new Set(
    [
      ...midias.flatMap((r) => [r.chave, r.chave_thumb, r.chave_preview]),
      ...marcas.map((r) => r.logo_chave),
    ].filter(Boolean),
  );
}
