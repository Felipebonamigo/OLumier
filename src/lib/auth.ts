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
  const expiraEm = Date.now() + DURACAO_DIAS * 24 * 60 * 60 * 1000;
  const dados = `${tenantId}.${expiraEm}`;
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

/** Valida o cookie e devolve o id do tenant, ou null. Nunca confia no conteúdo sem conferir a assinatura. */
export function lerTokenSessao(valor: string | undefined): string | null {
  if (!valor) return null;
  const partes = valor.split(".");
  if (partes.length !== 3) return null;
  const [tenantId, expiraEm, assinatura] = partes;

  const esperada = assinar(`${tenantId}.${expiraEm}`);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Number(expiraEm) < Date.now()) return null;
  return tenantId;
}

export async function sessaoAtual(): Promise<string | null> {
  const jar = await cookies();
  return lerTokenSessao(jar.get(COOKIE)?.value);
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export const NOME_COOKIE = COOKIE;
