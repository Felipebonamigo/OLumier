import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

/**
 * Autenticação do fotógrafo (o dono da conta). O cliente final não tem login —
 * a galeria dele é protegida por senha própria, tratada em outro lugar.
 *
 * Sem dependência externa: scrypt para senha, HMAC para a sessão. O scrypt é
 * proposital — é lento e usa memória, o que encarece ataque de força bruta se
 * o banco vazar.
 */

const scryptAsync = promisify(scrypt) as (
  senha: string,
  sal: string,
  tamanho: number,
) => Promise<Buffer>;

const COOKIE = "fotonio_sessao";
const DURACAO_DIAS = 30;

function segredo(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curto demais no .env.local");
  }
  return s;
}

// --- senha -----------------------------------------------------------------

export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16).toString("hex");
  const derivada = await scryptAsync(senha, sal, 64);
  return `scrypt:${sal}:${derivada.toString("hex")}`;
}

export async function conferirSenha(senha: string, hashGuardado: string): Promise<boolean> {
  const [algo, sal, hex] = hashGuardado.split(":");
  if (algo !== "scrypt" || !sal || !hex) return false;
  const derivada = await scryptAsync(senha, sal, 64);
  const guardada = Buffer.from(hex, "hex");
  // Comparação de tempo constante: um `===` vazaria informação pelo tempo de resposta.
  if (guardada.length !== derivada.length) return false;
  return timingSafeEqual(guardada, derivada);
}

// --- sessão ----------------------------------------------------------------

function assinar(dados: string): string {
  return createHmac("sha256", segredo()).update(dados).digest("hex");
}

export async function criarSessao(tenantId: string): Promise<void> {
  /*
   * O cookie carrega a EMISSÃO junto com o vencimento.
   *
   * Antes só o vencimento ia, e a emissão era deduzida subtraindo a duração.
   * A dedução só vale enquanto todo cookie no mundo tiver exatamente esta
   * duração: mudar DURACAO_DIAS de 30 para 14 faria a emissão de todo cookie já
   * entregue "pular" 16 dias, e a revogação por troca de senha passaria a
   * derrubar (ou poupar) sessão errada. Gravar o fato custa 13 caracteres.
   */
  const agora = Date.now();
  const expiraEm = agora + DURACAO_DIAS * 24 * 60 * 60 * 1000;
  const dados = `${tenantId}.${agora}.${expiraEm}`;
  const valor = `${dados}.${assinar(dados)}`;

  const jar = await cookies();
  jar.set(COOKIE, valor, {
    httpOnly: true, // JavaScript da página não enxerga — barra roubo por XSS
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACAO_DIAS * 24 * 60 * 60,
  });
}

export interface Sessao {
  tenantId: string;
  /** Quando o cookie foi emitido, em ms. Usado para revogar por troca de senha. */
  emitidoEm: number;
}

/** Valida o cookie. Nunca confia no conteúdo sem conferir a assinatura. */
export function lerTokenSessao(valor: string | undefined): Sessao | null {
  if (!valor) return null;
  const partes = valor.split(".");
  // Formato antigo (3 partes, sem emissão) não é aceito: sem saber quando o
  // cookie nasceu não há como decidir se ele sobreviveu a uma troca de senha.
  if (partes.length !== 4) return null;
  const [tenantId, emitidoEm, expiraEm, assinatura] = partes;

  const esperada = assinar(`${tenantId}.${emitidoEm}.${expiraEm}`);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (!Number(emitidoEm) || Number(expiraEm) < Date.now()) return null;
  return { tenantId, emitidoEm: Number(emitidoEm) };
}

/**
 * Id do tenant da sessão, ou null.
 *
 * Além da assinatura e do vencimento, confere se o cookie é mais NOVO que a
 * última troca de senha. A sessão é um cookie assinado, sem registro no
 * servidor: sem esta conferência não haveria como revogar nada, e quem tivesse
 * roubado o cookie continuaria dentro por até 30 dias depois de a pessoa trocar
 * a senha — justamente o cenário em que ela troca porque desconfia de invasão.
 *
 * Custa uma leitura por chave primária. Quem chama isto já vai ao banco no
 * mesmo pedido de qualquer forma.
 */
export async function sessaoAtual(): Promise<string | null> {
  const jar = await cookies();
  const sessao = lerTokenSessao(jar.get(COOKIE)?.value);
  if (!sessao) return null;

  const { consultarUm } = await import("./db");
  const t = await consultarUm<{ senha_alterada_em: Date }>(
    "select senha_alterada_em from tenants where id = $1",
    [sessao.tenantId],
  );
  // Conta apagada no meio da sessão: o cookie deixa de valer junto.
  if (!t) return null;

  // Margem de 5s: no fluxo de recuperação a senha muda e o login acontece em
  // seguida, e relógio de banco e de app não batem ao milissegundo.
  if (new Date(t.senha_alterada_em).getTime() - 5000 > sessao.emitidoEm) return null;

  return sessao.tenantId;
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export const NOME_COOKIE = COOKIE;
