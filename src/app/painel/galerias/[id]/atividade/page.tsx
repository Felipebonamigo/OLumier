import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { resumoAcessos, listarDownloads } from "@/lib/galerias-publicas";
import { urlDaDerivada, armazemDe } from "@/lib/armazem";
import { comoChamar } from "@/lib/favoritas";
import { ListaDeDownloads } from "@/components/lista-de-downloads";
import { estadoSelecao, listaDaSelecao, resumoPorPessoa } from "@/lib/favoritas";
import { PainelSelecao } from "@/components/painel-selecao";

export const metadata: Metadata = { title: "Atividade da galeria" };
export const dynamic = "force-dynamic";

/**
 * A aba ATIVIDADE — o que o cliente fez com a entrega.
 *
 * É a terceira categoria que o sócio pediu: "ver quem está baixando,
 * favoritando". Junta as duas coisas que antes ficavam em pontas opostas da
 * página: o contador de aberturas e downloads, lá em cima no cabeçalho, e a
 * seleção do álbum, lá embaixo.
 */
export default async function AtividadePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* A tranca é de cada rota, não do layout — ver `lib/galeria-painel.ts`. */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const acessos = await resumoAcessos(galeria.id);
  const selecao = await estadoSelecao(galeria.id);
  const listaSelecao = await listaDaSelecao(galeria.id);
  /* Quem escolheu o quê — desde a migração 033 a lista tem dona, e sem isto o
     fotógrafo veria um total sem saber de quem é cada escolha. */
  const pessoas = await resumoPorPessoa(galeria.id);

  /*
   * ── A LISTA DE DOWNLOADS, COM UMA ASSINATURA POR FOTO ───────────────────
   *
   * Uma URL assinada por LINHA seria uma assinatura por download: a mesma foto
   * baixada por doze convidados assinaria doze vezes o mesmo objeto. O `Map`
   * por `media_id` derruba isso para uma por foto distinta, que é o número que
   * importa — e é o mesmo cuidado que a página de fotos já tem.
   */
  const downloads = await listarDownloads(galeria.id);
  const urlPorMedia = new Map<string, string | null>();
  for (const d of downloads) {
    if (!d.media_id || urlPorMedia.has(d.media_id) || !d.chave) continue;
    urlPorMedia.set(
      d.media_id,
      await urlDaDerivada(d.chave_thumb, d.chave, armazemDe(d.armazem), 3600),
    );
  }

  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        {[
          {
            rotulo: "Acessos do cliente",
            valor: acessos
              ? `${acessos.aberturas} ${acessos.aberturas === 1 ? "abertura" : "aberturas"}`
              : "—",
          },
          {
            rotulo: "Downloads",
            valor: acessos
              ? `${acessos.downloads} download${acessos.downloads === 1 ? "" : "s"}`
              : "—",
          },
        ].map((item) => (
          <div key={item.rotulo} className="rounded-xl border border-linha bg-carbon px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
              {item.rotulo}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium">{item.valor}</dd>
          </div>
        ))}
      </dl>

      {acessos?.ultimo && (
        <p className="mt-3 text-xs text-texto-faint">
          Última visita em{" "}
          {new Date(acessos.ultimo).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
          .
        </p>
      )}

      {/*
        A escolha do álbum. Aparece sempre, e não só depois da primeira
        marcação: as REGRAS (quantas fotos, até quando) precisam ser definidas
        ANTES de mandar o link, que é justamente quando ainda não há nenhuma
        marcada.
      */}
      <PainelSelecao
        galeriaId={galeria.id}
        total={selecao.total}
        limite={selecao.limite}
        prazo={selecao.prazo ? selecao.prazo.toISOString() : null}
        fechadaEm={selecao.fechadaEm ? selecao.fechadaEm.toISOString() : null}
        aberta={selecao.aberta}
        motivo={selecao.motivo}
        lista={listaSelecao.map((l) => ({ nome: l.nome, capitulo: l.capitulo }))}
        pessoas={pessoas}
      />

      <ListaDeDownloads
        linhas={downloads.map((d) => ({
          id: d.id,
          quando: d.quando.toISOString(),
          tudo: d.acao === "baixou_tudo",
          /* `comoChamar` é a mesma regra em toda tela: nome, senão e-mail. Desde
             a migração 040 a pessoa pode ter só um dos dois. */
          quem: d.email || d.nome ? comoChamar({ email: d.email, nome: d.nome }) : "não identificado",
          identificado: Boolean(d.email || d.nome),
          arquivo: d.nome_original,
          url: d.media_id ? (urlPorMedia.get(d.media_id) ?? null) : null,
        }))}
      />
    </>
  );
}
