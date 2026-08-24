import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "./db";
import { gerarHashSenha } from "./auth";
import { enviarEmail, moldura } from "./email";
import { marca } from "@/config/marca";

/**
 * Recuperação de senha do fotógrafo.
 *
 * O fluxo inteiro é desenhado em torno de uma ideia: quem pede a recuperação
 * pode não ser o dono da conta. Então nada aqui confirma nem nega que um e-mail
 * existe, e o token vale uma vez só, por pouco tempo.
 */

/** Uma hora. Tempo de sair do computador, abrir o e-mail no celular e voltar. */
export const VALIDADE_MS = 60 * 60 * 1000;

/** Reexportado de senha.ts: o mínimo é um número só para o sistema inteiro. */
export { MINIMO_SENHA } from "./senha";

/**
 * 32 bytes de aleatório real, em base64url.
 *
 * Vai na URL, então nada de caracteres que precisem de escape. E é longo o
 * bastante para adivinhar ser impossível na prática — o freio de tentativas
 * protege o formulário, não o espaço de busca.
 */
export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface PedidoCriado {
  token: string;
  expiraEm: Date;
}

/**
 * Cria o pedido e devolve o token em texto — a ÚNICA vez que ele existe assim.
 * No banco fica só o hash.
 *
 * Pedidos anteriores do mesmo estúdio são invalidados: dois links vivos ao
 * mesmo tempo dobram a janela de exposição sem servir para nada, já que a
 * pessoa vai usar o mais recente.
 */
export async function criarPedido(tenantId: string, origem?: string): Promise<PedidoCriado> {
  const token = gerarToken();
  const expiraEm = new Date(Date.now() + VALIDADE_MS);

  await consultar(
    "update recuperacoes set usado_em = now() where tenant_id = $1 and usado_em is null",
    [tenantId],
  );
  await consultar(
    `insert into recuperacoes (tenant_id, token_hash, expira_em, origem)
     values ($1, $2, $3, $4)`,
    [tenantId, hashDoToken(token), expiraEm, origem ?? null],
  );

  return { token, expiraEm };
}

export type MotivoRecusa = "inexistente" | "expirado" | "usado";

export interface PedidoValido {
  id: string;
  tenantId: string;
  email: string;
  nomeEstudio: string;
}

/**
 * Confere o token. Devolve o pedido ou o motivo da recusa.
 *
 * A recusa é detalhada de propósito: quem chegou aqui tem um link em mãos, e
 * "esse link já foi usado" é diferente de "esse link venceu" — a primeira pode
 * significar que outra pessoa usou, e a pessoa precisa saber disso.
 */
export async function conferirToken(
  token: string,
): Promise<{ ok: true; pedido: PedidoValido } | { ok: false; motivo: MotivoRecusa }> {
  if (!token || token.length < 20) return { ok: false, motivo: "inexistente" };

  const linha = await consultarUm<{
    id: string;
    tenant_id: string;
    expira_em: Date;
    usado_em: Date | null;
    email: string;
    nome_estudio: string;
  }>(
    `select r.id, r.tenant_id, r.expira_em, r.usado_em, t.email, t.nome_estudio
       from recuperacoes r
       join tenants t on t.id = r.tenant_id
      where r.token_hash = $1`,
    [hashDoToken(token)],
  );

  if (!linha) return { ok: false, motivo: "inexistente" };
  if (linha.usado_em) return { ok: false, motivo: "usado" };
  if (new Date(linha.expira_em).getTime() < Date.now()) return { ok: false, motivo: "expirado" };

  return {
    ok: true,
    pedido: {
      id: linha.id,
      tenantId: linha.tenant_id,
      email: linha.email,
      nomeEstudio: linha.nome_estudio,
    },
  };
}

/**
 * Grava a senha nova e queima o token.
 *
 * `usado_em is null` no WHERE não é enfeite: é o que impede dois envios
 * simultâneos do mesmo formulário de valerem os dois. Quem chegar depois não
 * atualiza linha nenhuma e a função recusa.
 *
 * `senha_alterada_em` derruba todas as sessões abertas — inclusive a de quem
 * eventualmente tenha entrado com a senha antiga. Sem isso, trocar a senha por
 * desconfiança não expulsaria ninguém.
 */
export async function concluir(token: string, senhaNova: string): Promise<boolean> {
  const conferido = await conferirToken(token);
  if (!conferido.ok) return false;

  const queimado = await consultar<{ id: string }>(
    "update recuperacoes set usado_em = now() where id = $1 and usado_em is null returning id",
    [conferido.pedido.id],
  );
  if (queimado.length === 0) return false;

  const hash = await gerarHashSenha(senhaNova);
  await consultar(
    "update tenants set senha_hash = $1, senha_alterada_em = now() where id = $2",
    [hash, conferido.pedido.tenantId],
  );
  return true;
}

/** Comparação de tempo constante para strings curtas — usada nos testes e no fluxo. */
export function tokensIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- o e-mail ---------------------------------------------------------------

export async function enviarEmailDeRecuperacao(
  para: string,
  nomeEstudio: string,
  link: string,
): Promise<boolean> {
  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#b8ab90">
      Alguém pediu para redefinir a senha de <strong style="color:#f0e9db">${nomeEstudio}</strong>
      no ${marca.nome}. Se foi você, use o botão abaixo.
    </p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#e6c17a;color:#0c0a07;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Criar senha nova
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#847860">
      O link vale por 1 hora e só funciona uma vez.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#847860">
      <strong style="color:#b8ab90">Não foi você?</strong> Pode ignorar este e-mail —
      sua senha continua a mesma. Ninguém consegue entrar só por ter pedido isto.
    </p>`;

  return enviarEmail({
    para,
    assunto: `Redefinir a senha do ${marca.nome}`,
    html: moldura("Redefinir sua senha", corpo),
    texto: [
      `Alguém pediu para redefinir a senha de ${nomeEstudio} no ${marca.nome}.`,
      "",
      "Se foi você, abra o link abaixo:",
      link,
      "",
      "O link vale por 1 hora e só funciona uma vez.",
      "",
      "Não foi você? Pode ignorar este e-mail — sua senha continua a mesma.",
    ].join("\n"),
  });
}
