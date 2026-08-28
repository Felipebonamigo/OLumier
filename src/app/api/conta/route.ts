import { NextResponse, type NextRequest } from "next/server";
import { tenantDaRequisicao } from "@/lib/auth-api";
import { buscarTenantPorId } from "@/lib/tenants";
import { marca } from "@/config/marca";

/**
 * Quem é o dono desta chave — o aperto de mão de uma conexão.
 *
 * Quando o fotógrafo cola a chave `ga_…` em outro sistema (hoje, o Atomatiza),
 * o outro lado precisa confirmar na hora A QUEM ela pertence e mostrar isso na
 * tela — "você está conectando ao estúdio Sirius Fotografia". Sem esta rota, a
 * conexão seria às cegas: uma chave colada errada só apareceria dias depois,
 * como galeria criada no estúdio errado.
 *
 * ── POR QUE ISTO NÃO FERE O "conta exige cookie" de auth-api.ts ───────────
 * Aquela regra protege as rotas de CONTA de verdade — cobrança, exclusão,
 * troca de senha. Aqui não sai nada que dê poder: nem e-mail, nem plano, nem
 * status de pagamento. Só identidade pública (nome, slug) e o `tenantId`, que
 * é justamente a âncora que o outro lado deve guardar — o slug PODE mudar
 * (ver migração 025), o id não.
 *
 * `dominio` vai junto para o consumidor validar/normalizar links de galeria
 * sem gravar o nosso domínio em código — quando ele mudar de novo (Fotônio →
 * Olumier → Galeria Átomo…), quem pergunta aqui acompanha.
 */
export async function GET(request: NextRequest) {
  const tenantId = await tenantDaRequisicao(request, "leitura");
  if (!tenantId) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 401 });

  return NextResponse.json({
    tenantId: tenant.id,
    slug: tenant.slug,
    nomeEstudio: tenant.nome_estudio,
    dominio: marca.dominio,
  });
}
