import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { consultarUm } from "@/lib/db";
import { formatarBytes, type Galeria } from "@/lib/tenants";
import { listarMedias } from "@/lib/medias";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { resumoAcessos } from "@/lib/galerias-publicas";
import { EnviarArquivos } from "@/components/enviar-arquivos";
import { GradeMedias, type MediaExibida } from "@/components/grade-medias";
import { PublicarGaleria } from "@/components/publicar-galeria";
import { EditorAparencia } from "@/components/editor-aparencia";
import { EditorSecoes } from "@/components/editor-secoes";
import { listarSecoes } from "@/lib/secoes";
import { lerAparencia } from "@/config/aparencia";
import { PrazoCofre } from "@/components/prazo-cofre";
import { EditorGaleria } from "@/components/editor-galeria";
import { paraCampoDeData } from "@/lib/datas";
import { estadoSelecao, listaDaSelecao, resumoDaGaleria } from "@/lib/favoritas";
import { PainelSelecao } from "@/components/painel-selecao";
import { diasAteArquivar, mesesEquivalentes } from "@/config/prazos";
import { apagarGaleriaAction } from "../../actions";

export const metadata: Metadata = { title: "Galeria" };
export const dynamic = "force-dynamic";

export default async function GaleriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // no Next 16 params é Promise
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  // O tenant_id no where é a autorização: id de outro estúdio simplesmente não existe aqui.
  const galeria = await consultarUm<Galeria & { estudio_slug: string }>(
    `select g.*, t.slug as estudio_slug
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.tenant_id = $2`,
    [id, tenantId],
  );
  if (!galeria) notFound();

  const medias = await listarMedias(galeria.id);
  const acessos = await resumoAcessos(galeria.id);
  const secoes = await listarSecoes(galeria.id);

  // O que o cliente marcou. Uma consulta agregada, não uma por foto.
  const favoritas = await resumoDaGaleria(galeria.id);
  const selecao = await estadoSelecao(galeria.id);
  const listaSelecao = await listaDaSelecao(galeria.id);

  // URLs assinadas com validade curta: o objeto no bucket nunca fica público.
  // Aqui também usamos a miniatura — o painel de quem tem 600 fotos precisa abrir rápido.
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

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  /*
   * Mesma data, no formato que o <input type="date"> espera.
   *
   * Montada com os campos LOCAIS, não com toISOString(). A coluna é `date` — dia
   * puro, sem hora — e o driver a entrega como meia-noite no fuso do processo.
   * Passar por UTC só dá certo em fuso negativo: num servidor a leste de
   * Greenwich, meia-noite local cai no dia anterior em UTC, e abrir o formulário
   * sem mexer em nada já mostraria a data errada — que então seria salva.
   */
  const dataISO = galeria.data_evento ? paraCampoDeData(new Date(galeria.data_evento)) : null;

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
  const heicSemPrevia = medias.filter(
    (m) => /heic|heif/i.test(m.mime) && !m.chave_preview,
  ).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <EditorGaleria
          galeriaId={galeria.id}
          titulo={galeria.titulo}
          subtitulo={galeria.subtitulo}
          dataISO={dataISO}
          dataFormatada={dataEvento}
        />
        {/*
          O selo responde UMA pergunta: o link do cliente abre agora?

          São três estados, não dois, e o terceiro é fácil de perder: no cofre,
          `publicada` continua true de propósito — é isso que faz reativar
          devolver a galeria ao ar sem o fotógrafo republicar. Ler só `publicada`
          fazia a mesma tela dizer "publicada" em cima e "No cofre" embaixo, e
          quem bate o olho lê o de cima.

          `estado` vem antes de `publicada` porque o cofre vence a publicação:
          arquivada com `publicada` true tem o link fora do ar do mesmo jeito.
          `scripts/testar-cofre.mjs` prende isto.
        */}
        {(() => {
          const noCofre = galeria.estado === "arquivada";
          const noAr = !noCofre && galeria.publicada;
          return (
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                noAr
                  ? "border-ok/40 bg-ok/10 text-ok"
                  : noCofre
                    ? "border-acento/40 bg-acento/10 text-acento-alto"
                    : "border-linha text-texto-faint"
              }`}
            >
              {noAr ? "publicada" : noCofre ? "no cofre" : "rascunho"}
            </span>
          );
        })()}
      </header>

      {heicSemPrevia > 0 && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta"
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

      <dl className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {
            rotulo: "Arquivos",
            valor: `${fotos} ${fotos === 1 ? "foto" : "fotos"}${videos ? ` · ${videos} vídeo${videos > 1 ? "s" : ""}` : ""}`,
          },
          { rotulo: "Espaço", valor: formatarBytes(galeria.bytes_total) },
          {
            rotulo: "Acessos do cliente",
            valor: acessos
              ? `${acessos.aberturas} ${acessos.aberturas === 1 ? "abertura" : "aberturas"} · ${acessos.downloads} download${acessos.downloads === 1 ? "" : "s"}`
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

      {/*
        O ENVIO VEM PRIMEIRO, e a ordem desta página é a decisão.

        Até 27/08/2026 vinham antes dele o publicar, o prazo e a APARÊNCIA — o
        fotógrafo escolhia capa, tipografia e grade olhando fotos de exemplo, e
        só via o resultado de verdade depois de subir o casamento inteiro. A
        ordem da tela é o roteiro que ela sugere, e o roteiro estava invertido.

        Agora ela segue o trabalho: manda as fotos, vê o que chegou, organiza em
        capítulos, escolhe o visual JÁ VENDO as fotos, define as regras do álbum
        e só então entrega. `testar-upload.mjs` prende esta ordem.
      */}
      <EnviarArquivos
        galeriaId={galeria.id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
      />

      <GradeMedias
        medias={exibidas}
        galeriaId={galeria.id}
        capaId={galeria.capa_media_id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
      />

      <EditorSecoes
        galeriaId={galeria.id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome, total: s.total ?? 0 }))}
        semCapitulo={medias.filter((m) => !m.secao_id).length}
      />

      <EditorAparencia
        galeriaId={galeria.id}
        caminhoPublico={`/g/${galeria.estudio_slug}/${galeria.slug}?previa=1`}
        inicial={lerAparencia(galeria.aparencia)}
      />

      {/*
        A escolha do álbum. Aparece sempre, e não só depois da primeira marcação
        como a caixa antiga: as REGRAS (quantas fotos, até quando) precisam ser
        definidas ANTES de mandar o link, que é justamente quando ainda não há
        nenhuma marcada.
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
      />

      <PublicarGaleria
        galeriaId={galeria.id}
        caminho={`/g/${galeria.estudio_slug}/${galeria.slug}`}
        estudioSlug={galeria.estudio_slug}
        galeriaSlug={galeria.slug}
        publicada={galeria.publicada}
        temSenha={Boolean(galeria.senha_hash)}
        permiteDownload={galeria.permite_download}
        semFotos={medias.length === 0}
      />

      <PrazoCofre
        galeriaId={galeria.id}
        arquivada={galeria.estado === "arquivada"}
        mesesAtual={mesesEquivalentes(galeria.expira_em)}
        diasRestantes={diasAteArquivar(galeria.expira_em)}
        arquivadaEm={galeria.arquivada_em ? String(galeria.arquivada_em) : null}
      />

      <section className="mt-12 border-t border-linha pt-6">
        <h2 className="text-sm font-semibold">Apagar galeria</h2>
        <p className="mt-1 max-w-[52ch] text-xs text-texto-faint">
          Remove a galeria e todos os arquivos dela. Não dá para desfazer.
        </p>
        <form action={apagarGaleriaAction} className="mt-3">
          <input type="hidden" name="galeria_id" value={galeria.id} />
          {/* Aqui o redirecionamento É necessário: a página que a pessoa está
              olhando acabou de ir para a lixeira. Na lista da Conta, não. */}
          <input type="hidden" name="voltar" value="1" />
          <button
            type="submit"
            className="rounded-lg border border-erro/40 px-4 py-2 text-sm text-erro transition hover:bg-erro/10"
          >
            Apagar “{galeria.titulo}”
          </button>
        </form>
      </section>
    </main>
  );
}
