import type { Manifesto, RelatoDeZip } from "../src/lib/zip-remoto.ts";
import { CONFIG } from "./config.ts";

/**
 * O cliente do APP: as duas rotas internas que o servidor de ZIP chama.
 *
 * O servidor nunca fala com o banco nem com o bucket por conta própria — não
 * tem credencial de nenhum dos dois. Tudo que ele sabe de uma galeria vem do
 * manifesto, e tudo que ele conta de volta vai pelo relato. É o que deixa esta
 * máquina descartável: trocar de servidor é copiar duas variáveis.
 */

export class PedidoRecusado extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

const cabecalhos = () => ({
  Authorization: `Bearer ${CONFIG.segredo}`,
  Accept: "application/json",
});

export async function buscarManifesto(pedidoId: string, comUrls: boolean): Promise<Manifesto> {
  const url = `${CONFIG.appUrl}/api/interno/zip/manifesto/${pedidoId}${comUrls ? "?comUrls=1" : ""}`;
  const r = await fetch(url, { headers: cabecalhos(), signal: AbortSignal.timeout(60_000) });
  if (r.status === 404 || r.status === 410) {
    throw new PedidoRecusado(410, "este link de download venceu — volte à galeria e clique de novo");
  }
  if (!r.ok) throw new PedidoRecusado(502, `o app respondeu ${r.status} ao pedir o manifesto`);
  return (await r.json()) as Manifesto;
}

/**
 * Relata sem nunca lançar: o download já aconteceu (ou já caiu), e uma falha
 * no relato não pode virar erro para quem está baixando.
 */
export async function relatar(relato: RelatoDeZip): Promise<void> {
  try {
    await fetch(`${CONFIG.appUrl}/api/interno/zip/evento`, {
      method: "POST",
      headers: { ...cabecalhos(), "Content-Type": "application/json" },
      body: JSON.stringify(relato),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    console.error(`relato não chegou ao app (${relato.evento}, ${relato.pedidoId}):`, e);
  }
}
