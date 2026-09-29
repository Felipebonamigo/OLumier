import "server-only";
import { consultar, consultarUm } from "./db";
import { emailConfigurado, enviarEmail, moldura } from "./email";
import { gerarToken, hashDoToken } from "./recuperacao";
import { marca } from "@/config/marca";

/**
 * CONFIRMAR O E-MAIL ANTES DE ENVIAR FOTOS.
 *
 * Uma das quatro travas contra a conta de teste repetida (pedido do Felipe em
 * 28/09/2026 — ver `db/migracoes/045-cadastro-protegido.sql`). Sozinha ela não
 * segura quem tem vinte caixas de e-mail; o que faz é tornar cada conta nova
 * um pouco mais cara que um formulário, e garantir que o endereço da conta
 * existe — o que as outras medidas precisam: o aviso antes de apagar o teste
 * abandonado só vale se chegar a alguém.
 *
 * ── SÓ COM O E-MAIL LIGADO ───────────────────────────────────────────────
 *
 * Em 17/09/2026 o envio de e-mail estava desligado em produção (`docs/email.md`:
 * o domínio ainda não foi verificado no Resend). Exigir um clique num link que
 * nunca chega trancaria toda conta nova — por uma porta que nós não abrimos.
 * Então a regra inteira depende de `emailConfigurado()`:
 *
 *   - desligado: a conta nasce confirmada e ninguém vê nada disto;
 *   - ligado: a conta nasce pendente, o link sai no cadastro, e o painel mostra
 *     o recado com o botão de reenviar até o clique.
 *
 * E se o e-mail está "ligado" mas o envio falha no cadastro (domínio que
 * deixou de valer, API fora do ar), a conta também nasce confirmada: travar
 * alguém por um defeito nosso é pior que deixar passar uma conta sem clique.
 * O CPF único continua valendo nesse caso — é ele a trava de verdade.
 */

/**
 * Sete dias. A pessoa cria a conta, é interrompida, volta no fim de semana —
 * o link ainda tem que funcionar. O que ele libera é só o envio de fotos para a
 * PRÓPRIA conta, que ela já acessa com a senha; não é uma chave de entrada como
 * o de recuperação, e não precisa da mesma pressa.
 */
export const VALIDADE_CONFIRMACAO_MS = 7 * 24 * 60 * 60 * 1000;

/** O que as rotas de envio respondem enquanto o clique não veio. */
export const RECADO_EMAIL_PENDENTE =
  "Confirme seu e-mail para começar a enviar fotos. O link está na sua caixa de entrada — se não chegou, peça outro no topo do painel.";

/**
 * A conta ainda precisa confirmar o e-mail para enviar?
 *
 * PURA, como `situacaoDoTenant`: recebe se o e-mail está ligado em vez de
 * perguntar, para o teste cobrir as combinações sem mexer em variável de
 * ambiente.
 */
export function confirmacaoPendente(
  tenant: { email_confirmado_em: Date | string | null | undefined },
  emailLigado: boolean,
): boolean {
  return emailLigado && !tenant.email_confirmado_em;
}

/** A mesma pergunta, já com o estado do e-mail do servidor. */
export function precisaConfirmarEmail(tenant: {
  email_confirmado_em: Date | string | null | undefined;
}): boolean {
  return confirmacaoPendente(tenant, emailConfigurado());
}

/**
 * Cria o link e devolve o token em texto — a única vez que ele existe assim.
 * No banco fica só o hash, como em `recuperacoes`.
 *
 * Os links anteriores do mesmo estúdio são queimados: quem pede outro vai usar
 * o mais novo, e dois vivos só dobram o que vaza se um e-mail for parar onde
 * não devia.
 */
export async function criarConfirmacao(tenantId: string): Promise<string> {
  const token = gerarToken();
  await consultar(
    "update confirmacoes_email set usado_em = now() where tenant_id = $1 and usado_em is null",
    [tenantId],
  );
  await consultar(
    `insert into confirmacoes_email (tenant_id, token_hash, expira_em) values ($1, $2, $3)`,
    [tenantId, hashDoToken(token), new Date(Date.now() + VALIDADE_CONFIRMACAO_MS)],
  );
  return token;
}

export type ResultadoConfirmacao =
  | { ok: true; tenantId: string; nomeEstudio: string }
  | { ok: false; motivo: "inexistente" | "expirado" | "usado" };

/**
 * Confere o link e marca o e-mail como confirmado.
 *
 * Link já usado, de conta que JÁ está confirmada, responde ok: é a pessoa
 * clicando duas vezes no mesmo e-mail, e "esse link já foi usado" a faria
 * achar que algo deu errado. Só é recusa quando o link foi queimado por um
 * pedido mais novo e a conta continua pendente — aí o link certo é o outro.
 */
export async function confirmarEmail(token: string): Promise<ResultadoConfirmacao> {
  if (!token || token.length < 20) return { ok: false, motivo: "inexistente" };

  const linha = await consultarUm<{
    id: string;
    tenant_id: string;
    expira_em: Date;
    usado_em: Date | null;
    nome_estudio: string;
    email_confirmado_em: Date | null;
  }>(
    `select c.id, c.tenant_id, c.expira_em, c.usado_em, t.nome_estudio, t.email_confirmado_em
       from confirmacoes_email c
       join tenants t on t.id = c.tenant_id
      where c.token_hash = $1`,
    [hashDoToken(token)],
  );

  if (!linha) return { ok: false, motivo: "inexistente" };
  const pronto = { ok: true as const, tenantId: linha.tenant_id, nomeEstudio: linha.nome_estudio };
  if (linha.usado_em) return linha.email_confirmado_em ? pronto : { ok: false, motivo: "usado" };
  if (new Date(linha.expira_em).getTime() < Date.now()) return { ok: false, motivo: "expirado" };

  await consultar("update confirmacoes_email set usado_em = now() where id = $1", [linha.id]);
  await consultar(
    "update tenants set email_confirmado_em = coalesce(email_confirmado_em, now()) where id = $1",
    [linha.tenant_id],
  );
  return pronto;
}

/** Nome de estúdio vai dentro do HTML do e-mail — e é texto que a pessoa digitou. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Manda o link. Devolve se o e-mail SAIU — false também quando o envio está
 * desligado. Não lança (a regra de `enviarEmail`).
 */
export async function enviarConfirmacao(tenant: {
  id: string;
  email: string;
  nome_estudio: string;
}): Promise<boolean> {
  if (!emailConfigurado()) return false;

  const token = await criarConfirmacao(tenant.id);
  const link = `https://${marca.dominio}/confirmar-email/${token}`;

  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">
      A conta de <strong style="color:#eef1f6">${escapar(tenant.nome_estudio)}</strong> na
      ${marca.nome} está criada. Falta confirmar que este e-mail é seu — é ele que
      recebe os avisos da conta, e o envio de fotos começa depois deste clique.
    </p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Confirmar e-mail
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7484">
      O link vale por 7 dias. Não criou conta nenhuma? Pode ignorar este e-mail.
    </p>`;

  return enviarEmail({
    para: tenant.email,
    assunto: `Confirme seu e-mail na ${marca.nome}`,
    html: moldura("Confirme seu e-mail", corpo),
    texto: [
      `A conta de ${tenant.nome_estudio} na ${marca.nome} está criada.`,
      "Falta confirmar que este e-mail é seu. Abra o link abaixo:",
      link,
      "",
      "O link vale por 7 dias. Não criou conta nenhuma? Pode ignorar este e-mail.",
    ].join("\n"),
  });
}
