import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "./db";

/**
 * Chave de API por estúdio — a credencial de quem não é navegador.
 *
 * Este módulo é o ÚNICO lugar que sabe o formato da chave e como ela é
 * conferida. Nenhuma rota monta ou parte a chave à mão: a rota chama
 * `conferirChave` e recebe o estúdio, ou não recebe nada.
 *
 * Ver docs/chave-de-api.md e db/migracoes/022-chaves-api.sql.
 */

/**
 * `ga_`, de Galeria Átomo. Decisão fechada em 26/08/2026.
 *
 * Não é enfeite: é a coluna indexada pela qual a linha é encontrada. Chave já
 * distribuída não muda de prefixo sem quebrar quem a usa — pela mesma razão que
 * o escopo não se reescopa depois. Se a plataforma trocar de nome, isto NÃO
 * acompanha (ver src/config/marca.ts, "o que não muda").
 */
export const PREFIXO = "ga_";

export type Escopo = "envio" | "leitura";

/** Bytes da parte secreta. 32 bytes = 256 bits: não existe dicionário para isso. */
const BYTES_SEGREDO = 32;
/** Bytes da parte pública, que vira o `prefixo` guardado em texto claro. */
const BYTES_PREFIXO = 3;

export interface ChaveCriada {
  id: string;
  prefixo: string;
  /** O segredo inteiro. Aparece UMA vez e nunca mais — não é guardado. */
  segredo: string;
}

export interface ChaveListada {
  id: string;
  nome: string;
  prefixo: string;
  escopo: Escopo;
  criada_em: Date;
  ultimo_uso_em: Date | null;
}

/**
 * SHA-256, e não o scrypt que `auth.ts` usa para senha.
 *
 * Senha é escolhida por gente, tem pouca entropia, e o hash lento é o que faz o
 * ataque de dicionário não compensar. Aqui o segredo é aleatório de 256 bits:
 * dicionário não existe, e um hash lento só colocaria latência em toda
 * requisição do plugin — que é o caminho quente do upload.
 */
function hashDe(segredo: string): string {
  return createHash("sha256").update(segredo).digest("hex");
}

/** base64url sem padding: cabe em cabeçalho HTTP e em arquivo de configuração. */
function aleatorio(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Cria a chave e devolve o segredo — a única vez que ele existe fora da máquina
 * de quem pediu. O banco fica só com o hash.
 */
export async function gerarChave(
  tenantId: string,
  nome: string,
  escopo: Escopo = "envio",
): Promise<ChaveCriada> {
  const prefixo = PREFIXO + aleatorio(BYTES_PREFIXO);
  const segredo = `${prefixo}_${aleatorio(BYTES_SEGREDO)}`;

  const linha = await consultarUm<{ id: string }>(
    `insert into chaves_api (tenant_id, nome, prefixo, hash, escopo)
          values ($1, $2, $3, $4, $5)
       returning id`,
    [tenantId, nome.trim() || "Sem nome", prefixo, hashDe(segredo), escopo],
  );

  return { id: linha!.id, prefixo, segredo };
}

/**
 * Confere a chave e devolve de quem ela é.
 *
 * Devolve `null` para tudo que não abre: formato errado, prefixo inexistente,
 * hash diferente, chave revogada. Quem chama não precisa distinguir os casos —
 * e não DEVE: uma mensagem de erro que diferencia "prefixo não existe" de "hash
 * errado" conta ao atacante qual metade ele acertou.
 */
export async function conferirChave(
  valor: string | null | undefined,
): Promise<{ id: string; tenantId: string; escopo: Escopo } | null> {
  if (typeof valor !== "string") return null;

  const segredo = valor.trim();
  if (!segredo.startsWith(PREFIXO)) return null;

  /* `ga_` + prefixo + `_` + parte secreta. Sem as duas partes não há o que
   * conferir — e sem esta guarda, uma chave truncada acharia a linha e
   * compararia hash de string vazia. */
  const corte = segredo.indexOf("_", PREFIXO.length);
  if (corte < 0) return null;
  const prefixo = segredo.slice(0, corte);
  if (prefixo.length <= PREFIXO.length || corte === segredo.length - 1) return null;

  const linha = await consultarUm<{
    id: string;
    tenant_id: string;
    hash: string;
    escopo: Escopo;
  }>(
    `select id, tenant_id, hash, escopo from chaves_api
      where prefixo = $1 and revogada_em is null`,
    [prefixo],
  );
  if (!linha) return null;

  /* Comparação de tempo constante, igual ao que `auth.ts` faz com a senha: um
   * `===` vazaria pelo tempo de resposta quantos caracteres bateram. */
  const veio = Buffer.from(hashDe(segredo), "hex");
  const guardado = Buffer.from(linha.hash, "hex");
  if (veio.length !== guardado.length || !timingSafeEqual(veio, guardado)) return null;

  /*
   * O último uso é ESPERADO, não disparado e esquecido.
   *
   * A tentação é `void update(...)` para não pagar a ida ao banco no caminho
   * quente do upload. O problema é o que a data significa: é por ela que o
   * fotógrafo distingue chave esquecida (nunca usada) de chave viva que ele não
   * reconhece — que é o sinal de vazamento. Data que "geralmente" grava não
   * serve para isso; quem olha precisa poder confiar.
   *
   * O try/catch mantém a garantia que motivava o disparo solto: se o update
   * falhar, ele perde a data na tela, não o upload que estava fazendo.
   */
  try {
    await consultarUm("update chaves_api set ultimo_uso_em = now() where id = $1", [linha.id]);
  } catch {
    /* segue: a chave é válida mesmo que a data não tenha gravado */
  }

  return { id: linha.id, tenantId: linha.tenant_id, escopo: linha.escopo };
}

/**
 * As chaves ativas do estúdio. Nunca devolve `hash` — a tela não tem o que
 * fazer com ele, e o que não sai daqui não vaza em log nem em payload.
 */
export function listarChaves(tenantId: string): Promise<ChaveListada[]> {
  return consultar<ChaveListada>(
    `select id, nome, prefixo, escopo, criada_em, ultimo_uso_em
       from chaves_api
      where tenant_id = $1 and revogada_em is null
      order by criada_em desc`,
    [tenantId],
  );
}

/**
 * Revoga, com efeito imediato — `conferirChave` já filtra por `revogada_em`.
 *
 * O `tenant_id` no where É a autorização: chave de outro estúdio não existe
 * aqui. Devolve `false` quando não havia o que revogar, para a tela poder dizer
 * a verdade em vez de fingir sucesso.
 */
export async function revogarChave(id: string, tenantId: string): Promise<boolean> {
  const linha = await consultarUm<{ id: string }>(
    `update chaves_api set revogada_em = now()
      where id = $1 and tenant_id = $2 and revogada_em is null
      returning id`,
    [id, tenantId],
  );
  return Boolean(linha);
}
