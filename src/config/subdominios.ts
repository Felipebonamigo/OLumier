/**
 * Subdomínios que pertencem à plataforma e nunca podem virar estúdio.
 *
 * Fonte ÚNICA de propósito. Antes esta lista só existia dentro do `proxy.ts`, e
 * o cadastro não a consultava: um estúdio chamado "WWW Fotografia" viraria o
 * slug `www`, e aí `www.fotonio.com.br` deixaria de ser o site para tentar ser a
 * página desse estúdio — que o proxy recusaria, deixando o cadastro com um
 * endereço quebrado e o site principal em risco.
 *
 * Sem `server-only`: o proxy roda em outro ambiente e precisa importar daqui.
 */

export const SUBDOMINIOS_RESERVADOS = new Set([
  // a plataforma
  "www",
  "app",
  "admin",
  "api",
  "painel",
  "conta",
  "ajuda",
  "suporte",
  "blog",
  "status",
  "cdn",
  "static",
  "assets",
  // infraestrutura e e-mail — apontar um destes para o app quebraria serviço
  "mail",
  "email",
  "smtp",
  "imap",
  "pop",
  "ftp",
  "ns",
  "ns1",
  "ns2",
  "mx",
  "webmail",
  "autodiscover",
  "autoconfig",
  // pegadinhas de verificação de domínio e certificado
  "_domainkey",
  "dmarc",
  "acme",
  "test",
  "teste",
  "dev",
  "homolog",
  "staging",
]);

/** true quando o slug não pode ser usado como endereço de estúdio. */
export function slugReservado(slug: string): boolean {
  return SUBDOMINIOS_RESERVADOS.has(slug.toLowerCase());
}
