import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel } from "@/lib/galeria-painel";
import { formatarBytes } from "@/lib/tenants";
import { listarMedias } from "@/lib/medias";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { listarSecoes } from "@/lib/secoes";
import { resumoDaGaleria } from "@/lib/favoritas";
import { EnviarArquivos } from "@/components/enviar-arquivos";
import { GradeMedias, type MediaExibida } from "@/components/grade-medias";
import { EditorSecoes } from "@/components/editor-secoes";

export const metadata: Metadata = { title: "Fotos da galeria" };
export const dynamic = "force-dynamic";

/**
 * A aba FOTOS — o trabalho em si, e por isso a aba padrão.
 *
 * A ordem interna é a que estava na página antiga, e continua sendo decisão:
 * capítulos primeiro, envio logo depois, grade no fim. O fotógrafo monta os
 * capítulos, manda as fotos já para o capítulo certo e vê o que chegou.
 * `testar-upload.mjs` prende essa ordem.
 *
 * É a única aba que assina uma URL por foto — a miniatura da grade. Era isso
 * que TODA visita à galeria pagava antes da divisão em abas.
 */
export default async function FotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* A tranca é de cada rota, não do layout — ver `lib/galeria-painel.ts`. */
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");
  const galeria = await galeriaDoPainel(id, tenantId);
  if (!galeria) notFound();

  const medias = await listarMedias(galeria.id);
  const secoes = await listarSecoes(galeria.id);
  /* Quantas pessoas marcaram cada foto — uma consulta agregada, não uma por foto. */
  const favoritas = await resumoDaGaleria(galeria.id);

  const exibidas: MediaExibida[] = await Promise.all(
    medias.map(async (m) => ({
      id: m.id,
      nome: m.nome_original,
      tipo: m.tipo,
      bytes: Number(m.bytes),
      secaoId: m.secao_id,
      favoritas: favoritas.porMedia.get(m.id) ?? 0,
      url: await urlDaDerivada(m.chave_thumb, m.chave, armazemDe(m.armazem), 3600),
    })),
  );

  const fotos = medias.filter((m) => m.tipo === "foto").length;
  const videos = medias.length - fotos;

  /*
   * HEIC que não virou prévia é entrega quebrada esperando acontecer.
   *
   * As prévias são geradas no NAVEGADOR do fotógrafo. O Safari decodifica HEIC;
   * Chrome e Firefox no Windows, não — e aí a foto fica sem prévia e a galeria
   * cai no arquivo .heic original. Só que <img src="foto.heic"> não renderiza em
   * Chrome, Firefox nem Android: o convidado vê imagem quebrada.
   *
   * O fotógrafo não descobriria sozinho — no painel dele o problema é o mesmo,
   * mas entre centenas de miniaturas ninguém repara. Por isso o aviso conta
   * quantas são e diz o que fazer.
   */
  const heicSemPrevia = medias.filter((m) => /heic|heif/i.test(m.mime) && !m.chave_preview).length;

  return (
    <>
      {heicSemPrevia > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta"
        >
          <p className="font-medium">
            {heicSemPrevia} {heicSemPrevia === 1 ? "foto pode não aparecer" : "fotos podem não aparecer"}{" "}
            para seus clientes
          </p>
          <p className="mt-1 text-xs">
            {heicSemPrevia === 1 ? "Ela está" : "Elas estão"} em HEIC (o formato padrão do iPhone) e
            o navegador que você usou para enviar não conseguiu gerar a prévia. Quem abrir a galeria
            no Chrome, no Firefox ou num Android vai ver espaço em branco no lugar{" "}
            {heicSemPrevia === 1 ? "dela" : "delas"}.
          </p>
          <p className="mt-1.5 text-xs">
            <strong>Como resolver:</strong> reexporte {heicSemPrevia === 1 ? "essa foto" : "essas fotos"}{" "}
            como JPG e envie de novo — ou reenvie pelo Safari, que lê HEIC e gera a prévia
            normalmente.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3">
        {[
          {
            rotulo: "Arquivos",
            valor: `${fotos} ${fotos === 1 ? "foto" : "fotos"}${videos ? ` · ${videos} vídeo${videos > 1 ? "s" : ""}` : ""}`,
          },
          { rotulo: "Espaço", valor: formatarBytes(galeria.bytes_total) },
        ].map((item) => (
          <div key={item.rotulo} className="rounded-xl border border-linha bg-carbon px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-texto-faint">
              {item.rotulo}
            </dt>
            <dd className="mt-1 truncate text-sm font-medium">{item.valor}</dd>
          </div>
        ))}
      </dl>

      {/*
        OS CAPÍTULOS VÊM PRIMEIRO, O ENVIO LOGO DEPOIS, e a ordem é a decisão.

        Ela segue o trabalho: monta os capítulos, manda as fotos já para o
        capítulo certo, vê o que chegou. Capítulos no topo desde 04/09/2026, a
        pedido do Felipe. `testar-upload.mjs` prende esta ordem.
      */}
      <EditorSecoes
        galeriaId={galeria.id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome, total: s.total ?? 0 }))}
        semCapitulo={medias.filter((m) => !m.secao_id).length}
        /* Como esta galeria chama o grupo das soltas (migração 037). Nulo é o
           normal e quer dizer "Outras fotos". */
        grupoSolto={galeria.grupo_solto}
      />

      <EnviarArquivos
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
        rostosAtivos={galeria.rostos_ativos}
        /* O que já está na galeria, para a pergunta do nome repetido. Só os
           nomes — a lista já foi consultada acima, então não custa consulta
           nenhuma, e mandar a mídia inteira para o cliente seria pagar por
           dado que ele não usa. */
        nomesNaGaleria={medias.map((m) => m.nome_original)}
      />

      <GradeMedias
        medias={exibidas}
        galeriaId={galeria.id}
        capaId={galeria.capa_media_id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
      />
    </>
  );
}
