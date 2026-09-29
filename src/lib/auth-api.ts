import "server-only";
import { sessaoAtual } from "./auth";
import { conferirChave, type Escopo } from "./chaves-api";
import { buscarTenantPorId } from "./tenants";
import { situacaoDoTenant } from "./assinatura";
import { asaasConfigurado } from "./asaas";
import { precisaConfirmarEmail, RECADO_EMAIL_PENDENTE } from "./confirmacao-email";

/**
 * Quem está falando com esta rota — navegador ou programa.
 *
 * Substitui `sessaoAtual()` nas rotas que o plugin do Lightroom usa, e SÓ
 * nelas. As rotas de cobrança, conta e exclusão continuam exigindo cookie: cada
 * rota que aceita chave é superfície nova, e um plugin não tem o que fazer lá.
 *
 * Ver docs/chave-de-api.md.
 */

/**
 * `envio` implica `leitura`.
 *
 * O plugin precisa LISTAR as galerias para o fotógrafo escolher onde publicar, e
 * obrigá-lo a colar duas chaves para uma tarefa só seria cerimônia sem ganho de
 * segurança — quem pode escrever já pode ver o que escreveu. O contrário não
 * vale: chave de leitura não envia nada, que é o ponto de ela existir.
 */
function escopoAtende(daChave: Escopo, exigido: Escopo): boolean {
  if (daChave === exigido) return true;
  return daChave === "envio" && exigido === "leitura";
}

/**
 * Devolve o `tenant_id` de quem fez a requisição, ou `null`.
 *
 * ── A ORDEM IMPORTA, E A AUSÊNCIA DE FALLBACK MAIS AINDA ───────────────────
 * Se veio `Authorization`, a resposta sai dali — válida ou não. NÃO existe
 * "tentou a chave, falhou, tenta o cookie": num navegador com sessão viva, esse
 * fallback faria uma chave REVOGADA continuar parecendo boa, porque o cookie
 * salvaria a requisição. O fotógrafo revogaria a chave vazada, testaria no
 * próprio painel, veria funcionar e concluiria que a revogação não pegou.
 *
 * Cabeçalho presente é uma declaração de quem você é. Se estiver errado, é 401 —
 * não é convite para tentar outra identidade.
 */
export async function tenantDaRequisicao(
  req: Request,
  escopo: Escopo,
): Promise<string | null> {
  const cabecalho = req.headers.get("authorization");

  if (cabecalho) {
    /* `Bearer` sem depender de caixa: a especificação diz que o esquema é
     * case-insensitive, e cliente HTTP em Lua manda o que quiser. */
    const casa = /^bearer\s+(.+)$/i.exec(cabecalho.trim());
    if (!casa) return null;

    const chave = await conferirChave(casa[1]);
    if (!chave) return null;
    if (!escopoAtende(chave.escopo, escopo)) return null;
    return chave.tenantId;
  }

  /*
   * Sem cabeçalho: é o painel, e nada muda para ele.
   *
   * O try/catch cobre a chamada FORA de um contexto de requisição do Next —
   * onde `cookies()` estoura. Nesse caso a resposta verdadeira é "não há
   * sessão", que é exatamente `null`. Dentro de uma rota, que é onde esta
   * função roda de verdade, `cookies()` não estoura.
   */
  try {
    return await sessaoAtual();
  } catch {
    return null;
  }
}

/**
 * Autoriza E confere o portão de cobrança, numa chamada só.
 *
 * ── POR QUE OS DOIS JUNTOS ────────────────────────────────────────────────
 * Nas rotas antigas de envio o portão vem de graça: `situacaoDoTenant` já mora
 * no corpo delas, então trocar a linha da autorização não abriu buraco nenhum.
 * As rotas NOVAS nascem vazias — e uma rota nova que esquece o `podeEnviar`
 * transforma a chave de API em desvio do paywall, silenciosamente, porque tudo
 * continua funcionando (para quem não deveria poder).
 *
 * Deixar os dois numa função só é o que torna esse esquecimento impossível:
 * quem quer escrever chama isto e recebe o erro pronto, ou o tenant.
 *
 * Devolve `{ tenantId }` ou `{ erro, status }` — nunca os dois.
 */
export async function tenantQuePodeEnviar(
  req: Request,
): Promise<{ tenantId: string } | { erro: string; status: number }> {
  const tenantId = await tenantDaRequisicao(req, "envio");
  if (!tenantId) return { erro: "Sessão expirada. Entre de novo.", status: 401 };

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada.", status: 401 };

  /* Trial vencido, inadimplente ou cancelado não cria mais nada. O que já está
   * publicado continua no ar — ver src/lib/assinatura.ts. */
  const situacao = situacaoDoTenant(tenant, asaasConfigurado());
  if (!situacao.podeEnviar) {
    /* `recado` é opcional no tipo. Recusar sem dizer por quê deixaria o plugin
     * mostrando um 402 mudo ao fotógrafo, que é pior que a frase genérica. */
    return { erro: situacao.recado ?? "Assinatura inativa. Confira o plano na sua conta.", status: 402 };
  }

  /* O e-mail da conta ainda não foi confirmado — só vale com o envio de e-mail
   * ligado. Mesma regra da rota de envio; ver lib/confirmacao-email.ts. */
  if (precisaConfirmarEmail(tenant)) return { erro: RECADO_EMAIL_PENDENTE, status: 403 };

  return { tenantId };
}
