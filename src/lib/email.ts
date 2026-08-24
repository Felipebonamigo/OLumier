import "server-only";
import { marca } from "@/config/marca";

/**
 * Envio de e-mail transacional.
 *
 * Fala direto com a API HTTP do Resend, sem SDK: é uma requisição só, e uma
 * dependência a mais teria que ser mantida, auditada e atualizada para
 * economizar dez linhas.
 *
 * NADA aqui é obrigatório para o app funcionar. Sem chave configurada,
 * `emailConfigurado()` devolve false e quem chama esconde o que depende de
 * e-mail — em vez de oferecer um botão que não faz nada.
 */

/*
 * Endereço da API. Configurável só para o teste local poder apontar para um
 * servidor de mentira e conferir o e-mail que SERIA enviado — sem depender da
 * conta do Resend nem mandar mensagem para ninguém de verdade. Em produção a
 * variável não existe e vale o padrão.
 */
const API = process.env.EMAIL_API ?? "https://api.resend.com/emails";

/**
 * O remetente precisa ser de um domínio VERIFICADO no Resend.
 *
 * Mandar "redefina sua senha do Fotônio" de um endereço de outro domínio é
 * exatamente o que um golpe faria: o cliente veria remetente estranho pedindo
 * troca de senha. Por isso o remetente é configurável e não tem valor padrão
 * chutado — ou está certo, ou o recurso fica desligado.
 */
function remetente(): string | null {
  const r = process.env.EMAIL_REMETENTE?.trim();
  if (!r) return null;
  return r.includes("<") ? r : `${marca.nome} <${r}>`;
}

export function emailConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY && remetente());
}

/** Por que o envio não está disponível — para a tela poder ser honesta. */
export function motivoEmailIndisponivel(): string | null {
  if (!process.env.RESEND_API_KEY) return "RESEND_API_KEY não configurada";
  if (!remetente()) return "EMAIL_REMETENTE não configurado";
  return null;
}

export interface Email {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

/**
 * Envia e devolve se deu certo. NÃO lança.
 *
 * Quem chama está sempre no meio de um fluxo do usuário, e uma exceção aqui
 * viraria erro 500 numa tela que, do ponto de vista da pessoa, funcionou. O
 * detalhe da falha vai para o log do servidor, onde é útil; a tela responde a
 * mesma coisa de sempre.
 */
export async function enviarEmail(email: Email): Promise<boolean> {
  const de = remetente();
  if (!process.env.RESEND_API_KEY || !de) {
    console.warn(`[email] não enviado (${motivoEmailIndisponivel()}): ${email.assunto}`);
    return false;
  }

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: de,
        to: [email.para],
        subject: email.assunto,
        html: email.html,
        text: email.texto,
      }),
      // Sem timeout, uma API lenta seguraria a resposta da tela indefinidamente.
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      // O corpo do erro do Resend diz qual é o problema (domínio não verificado,
      // chave sem permissão). Sem isso, sobra "não enviou" e nada mais.
      console.error(`[email] ${r.status}: ${(await r.text()).slice(0, 400)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] falhou:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Casca visual comum. Tabela e estilo em linha porque cliente de e-mail ignora
 * folha de estilo externa e boa parte do CSS moderno — o que funciona em todos
 * é o HTML que a web usava em 2005.
 */
export function moldura(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#0d0b09;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0b09;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#16120e;border:1px solid rgba(240,221,190,0.14);border-radius:12px;padding:32px">
        <tr><td>
          <p style="margin:0 0 24px;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#f0c268">${marca.nome}</p>
          <h1 style="margin:0 0 16px;font-size:20px;color:#ece4d6">${titulo}</h1>
          ${corpo}
          <p style="margin:28px 0 0;font-size:12px;color:#7d715f">
            ${marca.nome} · ${marca.dominio}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
