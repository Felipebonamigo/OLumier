import "server-only";
import { timingSafeEqual } from "node:crypto";
import { consultar } from "@/lib/db";

/**
 * A PONTE COM O ATOMATIZA — quem tem conta nas duas plataformas.
 *
 * Felipe, 29/09/2026: Galeria e Atomatiza lado a lado, "como se fossem abas",
 * e o seletor "só vai aparecer pra quem tem cadastro nas duas plataformas".
 *
 * ── UM SENTIDO SÓ ─────────────────────────────────────────────────────────
 *
 * O Atomatiza pergunta, a Galeria responde. Cada vez que alguém abre o painel
 * de lá, o servidor de lá chama `/api/ponte/conta` com o e-mail de quem entrou
 * (e o CPF/CNPJ da empresa, se for o dono). Achando conta aqui, respondemos que
 * sim e gravamos a data em `tenants.atomatiza_visto_em`.
 *
 * Dali em diante, o nosso painel sabe sozinho: basta ler a coluna. Nenhuma
 * tela daqui depende do Atomatiza estar no ar, e o Atomatiza não precisou abrir
 * uma porta nova para o banco dele — lá, a chave que atravessa contas tem uma
 * lista fechada de usos, e "tem conta?" não justificava entrar nela.
 *
 * O preço disso: quem tem as duas contas e ainda não abriu o Atomatiza desde
 * que a ponte existe só vê o seletor daqui depois da primeira visita lá. Lá ele
 * aparece na hora.
 *
 * ── O SEGREDO ─────────────────────────────────────────────────────────────
 *
 * O combo foi feito "sem segredo novo" (ver `lib/combo.ts`), porque o Asaas
 * já era o terreno comum. Aqui não dá: conta em teste não passa pelo Asaas, e
 * "este e-mail tem conta?" aberto para a internet seria uma lista de clientes
 * consultável um a um. Então a pergunta vem assinada com `PONTE_ATOMO_SEGREDO`,
 * o mesmo valor nos dois servidores. Sem ele configurado, a porta fica fechada
 * (503) e o seletor simplesmente não aparece — em nenhum dos dois lados.
 */

/** Quanto tempo o seletor continua depois da última visita ao Atomatiza. */
export const DIAS_DA_PONTE = 30;

/**
 * Onde o seletor leva. `/login` e não a raiz: lá, a raiz de quem não está
 * logado é a página de venda, e o `/login` de quem já está logado vai direto
 * para o painel.
 */
export const URL_ATOMATIZA = (process.env.ATOMATIZA_URL ?? "https://atomatiza.com.br").replace(/\/+$/, "");
export const LINK_ATOMATIZA = `${URL_ATOMATIZA}/login`;

/**
 * O nome da aba de cada plataforma. O link usa o nome como `target`: o
 * primeiro clique abre uma aba nova, e os seguintes voltam para ela em vez de
 * abrir outra. Os dois lados gravam o próprio nome na janela (`window.name`),
 * para a volta também cair na aba que já existe. Mudou aqui, mude lá — em
 * `src/lib/galeria-atomo.ts` do Atomatiza.
 */
export const JANELA_GALERIA = "galeria-atomo";
export const JANELA_ATOMATIZA = "atomatiza";

/** A mesma régua do `SESSION_SECRET`: segredo curto é segredo adivinhável. */
const TAMANHO_MINIMO = 32;

/** O segredo da ponte, ou null quando ausente ou curto demais para valer. */
export function segredoDaPonte(): string | null {
  const s = process.env.PONTE_ATOMO_SEGREDO;
  return s && s.length >= TAMANHO_MINIMO ? s : null;
}

/**
 * O cabeçalho `Authorization: Bearer <segredo>` confere?
 *
 * `timingSafeEqual` pela mesma razão do webhook do Asaas: `!==` sai no
 * primeiro byte diferente, e o tempo entrega o segredo caractere a caractere.
 */
export function autorizacaoConfere(cabecalho: string | null, segredo: string): boolean {
  const veio = Buffer.from((cabecalho ?? "").replace(/^Bearer\s+/i, ""));
  const esperado = Buffer.from(segredo);
  return veio.length === esperado.length && timingSafeEqual(veio, esperado);
}

/** O estúdio usa o Atomatiza? Lê só a coluna — nenhuma chamada de rede. */
export function usaOAtomatiza(tenant: { atomatiza_visto_em: Date | null }, agora = new Date()): boolean {
  const visto = tenant.atomatiza_visto_em;
  if (!visto) return false;
  return agora.getTime() - new Date(visto).getTime() <= DIAS_DA_PONTE * 24 * 60 * 60 * 1000;
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

/**
 * Marca os estúdios que têm este e-mail ou este CPF/CNPJ, e diz se achou algum.
 *
 * E-mail sem diferença de caixa, como no login daqui. O documento só com
 * dígitos, que é como `tenants.cpf_cnpj` guarda. Um documento curto demais para
 * ser CPF não entra na busca: não é para uma string vazia casar com ninguém.
 *
 * A escrita só acontece quando a data tem mais de uma hora: o Atomatiza
 * pergunta a cada abertura de painel, e não há motivo para um `update` por tela.
 */
export async function marcarContaDoAtomatiza(dados: {
  email?: string | null;
  documento?: string | null;
}): Promise<boolean> {
  const email = dados.email?.trim().toLowerCase() || null;
  const doc = soDigitos(dados.documento ?? "");
  const documento = doc.length >= 11 ? doc : null;
  if (!email && !documento) return false;

  const achados = await consultar<{ id: string; atomatiza_visto_em: Date | null }>(
    `select id, atomatiza_visto_em from tenants
      where ($1::text is not null and lower(email) = $1)
         or ($2::text is not null and cpf_cnpj = $2)`,
    [email, documento],
  );
  if (achados.length === 0) return false;

  await consultar(
    `update tenants set atomatiza_visto_em = now()
      where id = any($1::uuid[])
        and (atomatiza_visto_em is null or atomatiza_visto_em < now() - interval '1 hour')`,
    [achados.map((t) => t.id)],
  );
  return true;
}
