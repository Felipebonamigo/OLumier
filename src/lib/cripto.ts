import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifra simétrica para o segredo de terceiro guardado no banco — hoje só o
 * segredo do canal de avisos, que o Atomatiza registra aqui.
 *
 * Por que cifrar se a tabela já é inalcançável pela API: são defesas de camadas
 * diferentes. A inacessibilidade protege contra o ACESSO; a cifra protege
 * contra a CÓPIA — backup, dump, log de replicação, ou o dia em que alguém
 * rodar um select com a credencial de serviço.
 *
 * AES-256-GCM: além de cifrar, autentica. Texto adulterado faz o decifrar
 * levantar erro, em vez de devolver lixo que parece dado.
 *
 * Segredo PRÓPRIO (`AVISOS_ENC_KEY`), nunca emprestado do `SESSION_SECRET`:
 * aquele assina cookie de sessão e liberação de galeria, e um segredo que serve
 * a dois propósitos não pode ser girado por causa de um sem quebrar o outro.
 */

const SEGREDO = process.env.AVISOS_ENC_KEY;

/** true quando há segredo no ambiente. Sem ele, registrar canal fica
 *  indisponível — e a rota diz isso, em vez de gravar em claro. */
export const temCripto = Boolean(SEGREDO && SEGREDO.length >= 16);

/** Os 32 bytes que o AES-256 exige. O sha256 aceita qualquer frase longa do
 *  `.env` sem obrigar ninguém a contar bytes — não substitui o segredo ser
 *  aleatório e comprido. */
function chave(): Buffer {
  if (!temCripto) throw new Error("AVISOS_ENC_KEY ausente ou curta demais (mínimo 16 caracteres).");
  return createHash("sha256").update(SEGREDO!).digest();
}

/** `a1.<iv>.<tag>.<cifrado>`, tudo em base64url. O prefixo de versão existe
 *  para um dia trocar de algoritmo sem precisar adivinhar o formato do que já
 *  está gravado. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12); // 96 bits: o que o GCM espera
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["a1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dado.toString("base64url")].join(".");
}

export function decifrar(blob: string): string {
  const [versao, iv, tag, dado] = blob.split(".");
  if (versao !== "a1" || !iv || !tag || !dado) throw new Error("Formato de segredo desconhecido.");

  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dado, "base64url")), d.final()]).toString("utf8");
}
