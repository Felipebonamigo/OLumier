import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { galeriaDoPainel, fotosRepetidas } from "@/lib/galeria-painel";
import { formatarBytes } from "@/lib/tenants";
import { buscarTenantPorId } from "@/lib/tenants";
import { precisaConfirmarEmail } from "@/lib/confirmacao-email";
import { listarMedias } from "@/lib/medias";
import { enderecoDaMiniatura } from "@/lib/miniaturas-assinadas";
import { CAPITULOS_SUGERIDOS, listarSecoes } from "@/lib/secoes";
import { resumoDaGaleria } from "@/lib/favoritas";
import { downloadsPorFoto } from "@/lib/galerias-publicas";
import { AvisoDeRepetidas } from "@/components/aviso-de-repetidas";
import { EnviarArquivos } from "@/components/enviar-arquivos";
import { GradeMedias, type MediaExibida } from "@/components/grade-medias";
import { EditorSecoes } from "@/components/editor-secoes";
import { formatosLiberadosPara } from "@/lib/acesso-formatos";

export const metadata: Metadata = { title: "Fotos e vídeos da galeria" };
export const dynamic = "force-dynamic";

/** Ladrilhos que cabem numa tela grande (10 colunas × 8 linhas). */
const PRIMEIRA_TELA = 80;

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
  /* A MESMA pergunta que o aviso do topo do painel faz (`painel/layout.tsx`).
     Duas regras diferentes para a mesma coisa é como a tela passa a dizer uma
     coisa em cima e outra embaixo. */
  const tenant = await buscarTenantPorId(tenantId);
  const emailPendente = tenant ? precisaConfirmarEmail(tenant) : false;
  if (!galeria) notFound();

  const medias = await listarMedias(galeria.id);
  const secoes = await listarSecoes(galeria.id);
  /* Quantas pessoas marcaram cada foto — uma consulta agregada, não uma por foto. */
  const favoritas = await resumoDaGaleria(galeria.id);
  /* Uma consulta agrupada para a galeria inteira, e não uma por foto. */
  const baixadas = await downloadsPorFoto(galeria.id);
  /* A mesma pergunta que o Felipe ia fazer no banco, feita pela tela. */
  const repetidas = await fotosRepetidas(galeria.id);

  const exibidas: MediaExibida[] = await Promise.all(
    medias.map(async (m, i) => ({
      id: m.id,
      nome: m.nome_original,
      tipo: m.tipo,
      bytes: Number(m.bytes),
      secaoId: m.secao_id,
      favoritas: favoritas.porMedia.get(m.id) ?? 0,
      baixadas: baixadas.get(m.id) ?? 0,
      versao: m.versao,
      temCapa: Boolean(m.chave_thumb),
      /*
       * ── SÓ A PRIMEIRA TELA VEM ASSINADA (01/10/2026) ──────────────────
       *
       * Juan: "tá tudo bem lagado… cada exclusão / criação de um capítulo
       * novo tá…". Esta página assinava os endereços de TODAS as mídias a
       * cada volta do servidor — e toda ação da aba (criar capítulo, mover,
       * marcar capa) volta ao servidor. Numa galeria de 3.000 fotos eram 1,4
       * MB de endereços por clique, e assinatura nova é imagem nova: o
       * navegador baixava de novo as miniaturas da tela.
       *
       * Agora vêm só as primeiras, para a grade nascer com imagem; o resto a
       * grade pede quando o ladrilho chega perto da tela, e guarda. Ver
       * `lib/miniaturas-do-painel.ts`.
       *
       * O vídeo leva dois endereços (`url` é a capa, `urlFilme` o filme —
       * ver `enderecoDaMiniatura`), e foi por isso que o player do painel
       * voltou a tocar em 29/09/2026.
       */
      ...(i < PRIMEIRA_TELA ? await enderecoDaMiniatura(m) : {}),
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
        /* Os momentos típicos, para clicar um a um. Descem por propriedade
           porque `lib/secoes.ts` é `server-only` e o editor é do cliente — o
           mesmo caminho do assistente de galeria nova. */
        sugestoes={CAPITULOS_SUGERIDOS}
        semCapitulo={medias.filter((m) => !m.secao_id).length}
        /* Como esta galeria chama o grupo das soltas (migração 037). Nulo é o
           normal e quer dizer "Outras fotos". */
        grupoSolto={galeria.grupo_solto}
      />

      {/*
        ── NÃO OFERECER O QUE VAI SER RECUSADO (29/09/2026) ─────────────────

        A Carol arrastou 74 fotos e recebeu "0 de 74 — 33 com erro", com o
        motivo escondido numa lista que só aparece expandindo a barra de envio.
        A trava do servidor estava certa (o e-mail da conta nova dela nunca foi
        confirmado); o que estava errado era a tela convidar para uma pasta de
        casamento inteira e só então dizer não, 74 vezes.

        Felipe: "não permita que eles tentem publicar as imagens sem ter
        confirmado o e-mail".

        A trava do servidor FICA — é ela que protege, e quem chama a rota direto
        não passa por tela nenhuma. Isto aqui é para a pessoa saber ANTES de
        arrastar, e com o caminho da saída à mão: o aviso do topo do painel tem
        o botão de pedir outro link.
      */}
      {emailPendente ? (
        <section className="mt-8 rounded-xl border border-alerta/40 bg-carbon-2 px-5 py-6">
          {/* A mesma régua do `<h2>` do bloco de envio, porque este cartão
              ocupa o lugar dele — duas escalas no mesmo slot fariam a tela
              parecer que trocou de assunto, e não de estado. */}
          <h2 className="text-sm font-semibold">Confirme seu e-mail para enviar fotos e vídeos</h2>
          <p className="mt-1.5 max-w-prose text-sm text-texto-soft">
            O link foi para <strong className="font-normal text-texto">{tenant?.email}</strong>. Se
            não chegou, veja o lixo eletrônico — ou peça outro no aviso do topo desta página. Assim
            que confirmar, a área de envio aparece aqui.
          </p>
        </section>
      ) : (
      <EnviarArquivos
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
        rostosAtivos={galeria.rostos_ativos}
        /* O que já está na galeria, para a pergunta do nome repetido. Só os
           nomes — a lista já foi consultada acima, então não custa consulta
           nenhuma, e mandar a mídia inteira para o cliente seria pagar por
           dado que ele não usa. */
        nomesNaGaleria={medias.map((m) => m.nome_original)}
      />
      )}

      {/*
        ── FOTOS REPETIDAS ───────────────────────────────────────────────

        Felipe, 23/09/2026, olhando o zip do casamento da Júlia: lá dentro
        havia `sirius-jugusw-1070.jpg` e `sirius-jugusw-1070 (2).jpg` com o
        mesmo tamanho em bytes. Ele pediu a consulta no banco e disse "eu nem
        sei aonde esta o banco dessa aplicação".

        Ninguém deveria precisar saber. Fica acima da grade porque é sobre o
        que ESTÁ nela, e some quando não há repetida — aviso permanente vira
        mobília.
      */}
      <AvisoDeRepetidas itens={repetidas} />

      <GradeMedias
        medias={exibidas}
        galeriaId={galeria.id}
        capaId={galeria.capa_media_id}
        secoes={secoes.map((s) => ({ id: s.id, nome: s.nome }))}
        /* A capa de cada pasta (migração 052), para o selo e o botão da grade.
           Só as escolhidas: sem escolha a pasta usa a primeira foto, e a
           grade não precisa dizer isso em cada capítulo. */
        mostrarCapaDaPasta={await formatosLiberadosPara(galeria.tenant_id)}
        capasDasPastas={Object.fromEntries(
          secoes.filter((s) => s.capa_media_id).map((s) => [s.id, s.capa_media_id as string]),
        )}
      />
    </>
  );
}
