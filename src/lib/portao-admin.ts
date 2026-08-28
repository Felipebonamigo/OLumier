import "server-only";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { buscarTenantPorId } from "@/lib/tenants";
import { ehAdmin } from "@/config/admin";
import { marca } from "@/config/marca";

/**
 * O PORTÃO DA ADMINISTRAÇÃO, num lugar só.
 *
 * Existia escrito à mão dentro de `painel/admin/page.tsx`. Enquanto havia uma
 * página, funcionava; com a segunda (a ficha de um estúdio), copiar as seis
 * linhas seria a forma clássica de a terceira nascer sem elas — e a terceira
 * página desprotegida não avisa, ela só responde 200 para quem não devia ver.
 *
 * Duas regras que este arquivo carrega, e que não são detalhe:
 *
 *  1. `notFound()`, nunca "acesso negado". Uma tela de negado CONFIRMA que a
 *     página existe, e isso é informação para quem estiver procurando. Do lado
 *     de fora, a rota é indistinguível de um endereço que nunca existiu —
 *     inclusive quando `ADMINS` está vazia, que é o padrão.
 *
 *  2. O TÍTULO também precisa do portão. Com `export const metadata`, o Next
 *     resolve o título ANTES de a página rodar — então o 404 saía com
 *     "Administração" na aba do navegador, confirmando a rota que a resposta
 *     deveria esconder. Um teste pegou isso. Por isso existe
 *     `metadataDeAdmin`, e toda página desta área usa ela.
 */

/** Devolve o tenant do administrador. Para quem não é, a rota não existe. */
export async function exigirAdmin() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const eu = await buscarTenantPorId(tenantId);
  if (!eu || !ehAdmin(eu.email)) notFound();

  return eu;
}

/**
 * O título da aba, com o mesmo portão da página.
 *
 * Para quem não é admin devolve o título neutro da marca — o mesmo de qualquer
 * endereço inexistente.
 */
export async function metadataDeAdmin(titulo: string): Promise<Metadata> {
  const tenantId = await sessaoAtual();
  const eu = tenantId ? await buscarTenantPorId(tenantId) : null;
  if (!eu || !ehAdmin(eu.email)) return { title: `${marca.nome} — ${marca.tagline}` };
  return { title: titulo, robots: { index: false, follow: false } };
}
