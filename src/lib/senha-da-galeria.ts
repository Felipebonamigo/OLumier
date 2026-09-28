import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * O LEMBRETE DA SENHA DA GALERIA — cifrado, para o fotógrafo poder relê-lo.
 *
 * Juan, 24/09/2026: "ao colocar a senha, ela some e eu não sei mais qual a
 * senha. Não fica aparecendo qual a senha — tem que anotar logo depois que
 * adiciona ali, porque É SEGREDO ATÉ PRA NÓS FOTÓGRAFOS. Tinha que ter algum
 * campo que a gente consiga ver qual é a senha, caso o cliente esqueça."
 *
 * A frase dele é o diagnóstico inteiro. Ele descreveu o produto funcionando
 * como projetado, e o projeto é que estava errado: hash existe para o segredo
 * de UMA pessoa, e esta senha é o contrário — o fotógrafo a inventa para
 * ENTREGAR, e o caso de uso é justamente o cliente esquecer e perguntar a ele.
 *
 * "Anotar logo depois que adiciona" era a gambiarra que o produto obrigava, e
 * gambiarra que o usuário inventa é dívida que nós deixamos. Esquecer obrigava
 * a TROCAR, e trocar derruba todo mundo que já recebeu a antiga.
 *
 * ── CIFRADA, E NÃO EM TEXTO PURO ─────────────────────────────────────────
 *
 * Guardar legível resolveria o Juan e criaria outro problema: um dump do banco
 * entregaria as senhas de todas as galerias, e gente repete senha entre
 * lugares. Cifrada com o segredo do servidor, quem tem só o banco não lê nada —
 * e quem tem o segredo já tinha o resto de qualquer jeito.
 *
 * ── AES-256-GCM, E NÃO CBC ───────────────────────────────────────────────
 *
 * GCM carrega uma etiqueta de autenticação: texto adulterado no banco falha ao
 * decifrar em vez de devolver lixo silencioso. Numa coluna que a tela exibe
 * como "a sua senha é X", devolver lixo seria pior que devolver erro.
 *
 * O IV é sorteado a cada gravação e viaja junto — duas galerias com a mesma
 * senha produzem textos cifrados diferentes, então a coluna não denuncia quem
 * usou "anaepedro".
 */

const ALGORITMO = "aes-256-gcm";
/** `v1:` na frente para o dia em que houver `v2:` — ver `decifrarSenha`. */
const PREFIXO = "v1:";

function chave(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET ausente");
  /* Deriva 32 bytes do segredo. O `:senha-da-galeria` separa esta chave de
     qualquer outro uso do mesmo segredo: assinar cookie e cifrar senha não
     podem compartilhar material, senão um vazamento de um vira dois. */
  return createHash("sha256").update(`${s}:senha-da-galeria`).digest();
}

/** Cifra a senha para guardar. Vazio devolve `null` — galeria sem senha. */
export function cifrarSenha(senha: string): string | null {
  const limpa = String(senha ?? "");
  if (!limpa) return null;

  const iv = randomBytes(12);
  const cifra = createCipheriv(ALGORITMO, chave(), iv);
  const corpo = Buffer.concat([cifra.update(limpa, "utf8"), cifra.final()]);
  const etiqueta = cifra.getAuthTag();
  return PREFIXO + [iv, etiqueta, corpo].map((b) => b.toString("base64url")).join(".");
}

/**
 * Lê a senha de volta. `null` quando não há, quando o formato é de outra época
 * ou quando a decifragem falha.
 *
 * Falhar em silêncio é de propósito: quem chama desenha uma TELA, e uma galeria
 * cuja senha não se consegue ler precisa dizer isso ao fotógrafo — não estourar
 * a página de entrega dele.
 */
export function decifrarSenha(guardado: string | null | undefined): string | null {
  if (!guardado || !guardado.startsWith(PREFIXO)) return null;
  try {
    const [iv, etiqueta, corpo] = guardado
      .slice(PREFIXO.length)
      .split(".")
      .map((p) => Buffer.from(p, "base64url"));
    if (!iv || !etiqueta || !corpo) return null;
    const decifra = createDecipheriv(ALGORITMO, chave(), iv);
    decifra.setAuthTag(etiqueta);
    return Buffer.concat([decifra.update(corpo), decifra.final()]).toString("utf8");
  } catch {
    /* Etiqueta que não bate, segredo trocado, coluna adulterada: tudo cai aqui,
       e a tela trata como "não dá para mostrar". */
    return null;
  }
}
