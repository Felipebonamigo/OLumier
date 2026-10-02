"use server";

import { revalidatePath } from "next/cache";
import { sessaoAtual } from "@/lib/auth";
import { consultar, consultarUm } from "@/lib/db";
import { buscarTenantPorId, criarGaleria } from "@/lib/tenants";
import { situacaoDoTenant } from "@/lib/assinatura";
import { asaasConfigurado } from "@/lib/asaas";
import { precisaConfirmarEmail, RECADO_EMAIL_PENDENTE } from "@/lib/confirmacao-email";
import { aparenciaInicialDaGaleria } from "@/lib/aparencia-galeria";

/**
 * Cria (ou reencontra) as galerias de uma importação, TODAS de uma vez, antes
 * do primeiro arquivo subir.
 *
 * ── POR QUE ANTES, E NÃO UMA POR VEZ DURANTE O ENVIO ──────────────────────
 *
 * Porque o fotógrafo precisa ver as 80 no painel desde o primeiro minuto, e
 * porque a fila de envio já é uma só (`envio-em-curso.tsx`): ela precisa saber
 * para onde vai cada arquivo na hora em que ele entra.
 *
 * Nascem NÃO PUBLICADAS (o padrão da coluna). Uma importação de 80 galerias é
 * acervo sendo mudado de casa, não 80 entregas — publicar é decisão de cada
 * uma, depois de conferir.
 *
 * ── CONTINUAR NUMA GALERIA QUE JÁ EXISTE ──────────────────────────────────
 *
 * A importação de 400 GB por uma linha de casa vai cair no meio. Rodá-la de
 * novo não pode criar "ana-e-pedro-2" ao lado da primeira: a tela reconhece a
 * galeria pelo nome e manda `existenteId`, e aqui voltam os nomes dos arquivos
 * que já estão prontos nela, para a fila pular o que já subiu. É a mesma
 * comparação por nome do envio comum (`separarRepetidos`).
 */

export interface PedidoDeGaleria {
  titulo: string;
  /** "2025-03-14", ou vazio. */
  dataEvento?: string | null;
  /** A galeria do estúdio com o mesmo nome, quando a pessoa escolheu continuar nela. */
  existenteId?: string | null;
}

export interface GaleriaPreparada {
  titulo: string;
  id: string | null;
  nova: boolean;
  /** Nome e tamanho dos que já estão prontos nela — a fila pula estes
      (mesma régua de `separarRepetidos`). */
  arquivosNaGaleria: { nome: string; bytes: number }[];
  erro?: string;
}

/** Teto por importação: acima disso é pasta errada, não acervo. */
const TETO_DE_GALERIAS = 500;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function prepararImportacaoAction(
  pedidos: PedidoDeGaleria[],
): Promise<{ galerias?: GaleriaPreparada[]; erro?: string }> {
  const tenantId = await sessaoAtual();
  if (!tenantId) return { erro: "Sessão expirada. Entre de novo." };
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };

  /* O mesmo portão da rota de envio, conferido ANTES de criar qualquer
     galeria: sem ele, um teste vencido criaria 80 galerias vazias e só então
     cada arquivo seria recusado. */
  const situacao = situacaoDoTenant(tenant, asaasConfigurado());
  if (!situacao.podeEnviar) return { erro: situacao.recado };
  if (precisaConfirmarEmail(tenant)) return { erro: RECADO_EMAIL_PENDENTE };

  if (!Array.isArray(pedidos) || pedidos.length === 0) return { erro: "Nenhuma galeria para criar." };
  if (pedidos.length > TETO_DE_GALERIAS) {
    return { erro: `São ${pedidos.length} galerias — o limite por importação é ${TETO_DE_GALERIAS}.` };
  }

  /* O padrão de aparência do estúdio vale para toda galeria nova, como no
     "Nova galeria" de quem passa direto pela etapa do estilo. Lido uma vez. */
  const aparencia = await aparenciaInicialDaGaleria(tenantId, "", "");

  const galerias: GaleriaPreparada[] = [];
  for (const p of pedidos) {
    const titulo = String(p?.titulo ?? "").trim().slice(0, 200);
    /* Uma resposta por pedido, SEMPRE, na mesma ordem: a tela casa a resposta
       com a galeria pela posição. Pular o pedido desalinharia todas as outras. */
    if (!titulo) {
      galerias.push({ titulo, id: null, nova: false, arquivosNaGaleria: [], erro: "sem nome" });
      continue;
    }
    const dataEvento = DATA.test(String(p.dataEvento ?? "")) ? String(p.dataEvento) : undefined;

    if (p.existenteId) {
      // tenant_id no where é a autorização: galeria de outro estúdio não existe aqui.
      const g = await consultarUm<{ id: string; estado: string }>(
        `select id, estado from galerias
          where id = $1 and tenant_id = $2 and estado <> 'lixeira'`,
        [p.existenteId, tenantId],
      );
      if (!g) {
        galerias.push({ titulo, id: null, nova: false, arquivosNaGaleria: [], erro: "galeria não encontrada" });
        continue;
      }
      if (g.estado !== "online") {
        galerias.push({
          titulo,
          id: g.id,
          nova: false,
          arquivosNaGaleria: [],
          erro: "está no cofre — reative antes de importar para ela",
        });
        continue;
      }
      const arquivos = await consultar<{ nome_original: string; bytes: string }>(
        "select nome_original, bytes from medias where galeria_id = $1 and pronto",
        [g.id],
      );
      galerias.push({
        titulo,
        id: g.id,
        nova: false,
        arquivosNaGaleria: arquivos.map((a) => ({ nome: a.nome_original, bytes: Number(a.bytes) })),
      });
      continue;
    }

    const nova = await criarGaleria({ tenantId, titulo, dataEvento });
    if (aparencia) {
      await consultar("update galerias set aparencia = $1 where id = $2 and tenant_id = $3", [
        JSON.stringify(aparencia),
        nova!.id,
        tenantId,
      ]).catch(() => {});
    }
    galerias.push({ titulo, id: nova!.id, nova: true, arquivosNaGaleria: [] });
  }

  revalidatePath("/painel");
  return { galerias };
}
