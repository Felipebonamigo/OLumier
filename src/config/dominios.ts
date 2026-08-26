/**
 * QUAIS DOMÍNIOS ESTA INSTALAÇÃO ATENDE.
 *
 * ── POR QUE ISTO NÃO É `marca.dominio` ────────────────────────────────────
 * São duas perguntas diferentes, e confundi-las é o que trava uma troca de
 * domínio no meio:
 *
 *   `marca.dominio`  → o domínio CANÔNICO. O que entra em link de e-mail, no
 *                      endereço que a gente mostra, no "copiar link". É UM só,
 *                      sempre, porque duas respostas ali viram dois endereços
 *                      para a mesma galeria.
 *
 *   `DOMINIOS_ATENDIDOS` → os domínios que RESPONDEM. Durante uma troca de
 *                      marca são dois ao mesmo tempo: o antigo, que tem galeria
 *                      entregue e link circulando, e o novo, para onde tudo
 *                      está indo.
 *
 * ── O QUE QUEBRA SE FOR UM SÓ ─────────────────────────────────────────────
 * O Caddy emite certificado SOB DEMANDA e pergunta ao app antes (ver
 * `api/tls/permitir`). Se a lista não tiver o domínio novo, o certificado nunca
 * sai e o site novo não sobe — mesmo com o DNS perfeito. E se ela deixar de ter
 * o antigo, todo link já entregue perde o HTTPS de uma vez.
 *
 * Por isso a transição não é "trocar", é "somar e depois tirar":
 *
 *   1. some o novo aqui, publica  ← nada muda para quem já usa
 *   2. DNS, certificado, e-mail
 *   3. `marca.dominio` passa a apontar para o novo
 *   4. meses depois, tira o antigo daqui — e o Caddy passa a só redirecionar
 *
 * O antigo NÃO sai junto com o passo 3. Enquanto houver um link de casamento
 * circulando por aí, ele precisa continuar abrindo.
 *
 * `scripts/testar-subdominio.mjs` prende os dois lados: que todo domínio desta
 * lista libera certificado e roteia subdomínio de estúdio, e que um domínio
 * parecido (`estudio.olumier.com.br.golpe.net`) continua barrado em todos.
 */
export const DOMINIOS_ATENDIDOS = [
  /* O de hoje — tem galeria no ar e é o canônico até a fase 2. */
  "olumier.com.br",
  /* Para onde o produto está indo. Já aceito aqui de propósito, antes de o DNS
   * existir: aceitar um domínio que ainda não resolve não custa nada, e é o que
   * permite o certificado sair no minuto em que o DNS entrar. */
  "galeriaatomo.com.br",
] as const;

/**
 * O slug do estúdio, se o host for subdomínio de algum domínio atendido.
 *
 * Devolve `null` para o domínio principal, para o `www`, para sub-subdomínio
 * (`a.b.dominio`) e para qualquer host de fora. Quem chama decide o que fazer
 * com o `null` — o proxy trata como site principal, o porteiro do certificado
 * recusa.
 *
 * A comparação é por SUFIXO COM PONTO (`.olumier.com.br`), nunca `includes`:
 * `olumier.com.br.golpe.net` contém o nosso nome e não é nosso, e um `includes`
 * transformaria o porteiro em emissor de certificado para o golpista.
 */
export function estudioDoHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const nome = host.split(":")[0].toLowerCase().trim();

  for (const base of DOMINIOS_ATENDIDOS) {
    const sufixo = `.${base}`;
    if (!nome.endsWith(sufixo)) continue;
    const slug = nome.slice(0, -sufixo.length);
    if (!slug || slug.includes(".")) return null;
    return slug;
  }
  return null;
}

/** true quando o host é o domínio principal ou o `www` de algum atendido. */
export function ehDominioPrincipal(host: string | null | undefined): boolean {
  if (!host) return false;
  const nome = host.split(":")[0].toLowerCase().trim();
  return DOMINIOS_ATENDIDOS.some((d) => nome === d || nome === `www.${d}`);
}
