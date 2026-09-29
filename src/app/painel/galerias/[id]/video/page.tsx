import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { listarMedias } from "@/lib/medias";
import { urlDeLeitura } from "@/lib/r2";
import { CapaDeVideo } from "@/components/capa-de-video";

export const metadata: Metadata = { title: "Vídeos da galeria" };
export const dynamic = "force-dynamic";

/**
 * A ABA VÍDEO — onde a capa de cada filme se escolhe.
 *
 * Juan, 29/09/2026: "podemos adicionar algum sistema de 'vídeo' na aba de menu
 * da galeria, que só aparece quando tem algum vídeo na galeria. Essa
 * configuração de vídeo permite escolher uma capa thumbnail para o vídeo ali."
 *
 * ── POR QUE ELA PRECISA EXISTIR, SE A CAPA JÁ É AUTOMÁTICA ───────────────
 *
 * Porque a automática tem casos em que não há como funcionar: codec que o
 * navegador não decodifica, filme que abre em preto, e os 41 vídeos que já
 * estavam em produção com capa branca antes do conserto de 29/09. Sem esta
 * aba, a saída para qualquer um deles seria apagar e reenviar o filme.
 *
 * ── ESTA ABA NÃO ASSINA O FILME ──────────────────────────────────────────
 *
 * Só a miniatura. A divisão em abas nasceu para cada uma pagar o que é dela
 * (ver `menu-galeria.tsx`), e assinar o original de cada vídeo aqui seria
 * refazer o que ela veio cortar. A capa nova não vem do armazém: vem do arquivo
 * que o fotógrafo ainda tem no computador — ver `CapaDeVideo`.
 */
export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* A tranca é de cada rota, não do layout — ver `lib/galeria-painel.ts`. */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const videos = (await listarMedias(galeria.id)).filter((m) => m.tipo === "video");

  const comCapa = await Promise.all(
    videos.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      /* Só a miniatura, e só quando ela existe. Nada de assinar o filme. */
      capa: m.chave_thumb ? await urlDeLeitura(m.chave_thumb, 3600) : null,
    })),
  );

  const semCapa = comCapa.filter((v) => !v.capa).length;

  return (
    <>
      <section className="rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Capa dos vídeos</h2>
        <p className="mt-0.5 max-w-prose text-xs text-texto-faint">
          É a imagem que o casal vê antes de apertar o play. Ela é tirada sozinha do filme quando
          você envia — mas nem todo vídeo deixa: alguns formatos o navegador não consegue abrir, e
          filme que começa no escuro não tem o que mostrar no primeiro segundo.
        </p>
        {semCapa > 0 && (
          <p className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
            {semCapa} {semCapa === 1 ? "vídeo está" : "vídeos estão"} sem capa. Na galeria{" "}
            {semCapa === 1 ? "ele aparece" : "eles aparecem"} como um retângulo com o botão de play.
          </p>
        )}
      </section>

      <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">
          {videos.length} {videos.length === 1 ? "vídeo" : "vídeos"}
        </h2>
        <p className="mt-0.5 text-xs text-texto-faint">
          Escolha o arquivo do filme, que está no seu computador, e a capa sai de um quadro dele — o
          filme não sobe de novo. Se o seu navegador não abrir o formato, escolha uma imagem em vez
          disso.
        </p>

        {videos.length === 0 ? (
          <p className="mt-4 text-sm text-texto-faint">Nenhum vídeo nesta galeria.</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comCapa.map((v) => (
              <li key={v.id} className="rounded-lg border border-linha bg-carbon-2 p-3">
                <CapaDeVideo mediaId={v.id} nome={v.nome} capa={v.capa} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
