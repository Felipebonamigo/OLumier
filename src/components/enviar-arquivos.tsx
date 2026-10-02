"use client";

import { useState } from "react";
import {
  PARALELOS,
  type ArquivoComCaminho,
  arquivosDeArrasto,
  comCaminhoDoInput,
  separarRepetidos,
  type ArquivoConhecido,
} from "@/lib/fila-upload";
import { useEnvio } from "@/components/envio-em-curso";

export interface SecaoDestino {
  id: string;
  nome: string;
}

/**
 * A zona de arrastar — e SÓ ela.
 *
 * A fila mora em `envio-em-curso.tsx`, montada no layout da galeria, porque o
 * envio precisa continuar quando a pessoa vai para o Design. Este componente
 * escolhe os arquivos, faz a pergunta sobre nomes repetidos e entrega a lista.
 * Nada de estado de envio aqui: era o estado morando nesta rota que matava o
 * upload na troca de aba (ver o comentário de `ProvedorDeEnvio`).
 */
export function EnviarArquivos({
  secoes,
  rostosAtivos,
  arquivosNaGaleria,
}: {
  secoes: SecaoDestino[];
  /** A busca por rosto está ligada: cada foto é medida durante o envio. */
  rostosAtivos: boolean;
  /** Nomes de arquivo que já estão na galeria — a base da pergunta de repetido. */
  arquivosNaGaleria: ArquivoConhecido[];
}) {
  const [arrastando, setArrastando] = useState(false);
  const [destino, setDestino] = useState("");
  /* A pergunta fica pendurada aqui até a pessoa responder. Guardar as duas
     listas separadas é o que permite as três respostas sem recontar nada. */
  const [pergunta, setPergunta] = useState<{
    novos: ArquivoComCaminho[];
    repetidos: ArquivoComCaminho[];
  } | null>(null);
  const envio = useEnvio();

  /* `encaixarCom`: a pasta tinha arquivos que já estavam na galeria — no fim
     do envio, o que subiu agora volta para o meio dela (ver
     `lib/encaixe-da-pasta.ts`). */
  const mandar = (itens: ArquivoComCaminho[], encaixarCom?: ArquivoComCaminho[]) =>
    envio.enfileirar(itens, { destino: destino || undefined, rostosAtivos, encaixarCom });

  /**
   * ── A PERGUNTA DO NOME REPETIDO ────────────────────────────────────────
   *
   * Juan, 05/09/2026: "impedir que subam fotos com o mesmo nome, pra não ficar
   * repetidas" e, logo depois, "adicionar um aviso que tem fotos com o mesmo
   * nome e dar as opções: subir mesmo assim, ignorar as repetidas e subir o
   * restante".
   *
   * O segundo pedido corrige o primeiro, e ele tem razão: IMPEDIR seria errado.
   * Duas fotos diferentes podem se chamar `DSC_0001.jpg` — uma da câmera do
   * primeiro fotógrafo, outra da do segundo — e recusar em silêncio faria
   * sumir foto de casamento. Perguntar deixa a decisão com quem sabe.
   *
   * Sem repetido a pergunta não aparece: quem arrasta uma pasta nova não
   * merece um diálogo no caminho.
   */
  /*
   * ── E A FILA DESTA SESSÃO CONTA (23/09/2026) ───────────────────────────
   *
   * `arquivosNaGaleria` é o retrato que o SERVIDOR desenhou quando a página
   * carregou, e quem o atualiza é o `router.refresh()` que só roda depois de a
   * fila ESVAZIAR. Num envio de 180 fotos, que leva minutos, soltar a mesma
   * pasta de novo no meio passava direto pela pergunta — e a foto entrava duas
   * vezes na galeria.
   *
   * É a mesma janela que embaralhava a ordem ("a segunda pasta solta assim que
   * a primeira parece ter acabado"), e o estrago aqui é pior: o casal recebe a
   * foto repetida na galeria e no zip, com o "(2)" que `nomeUnico` põe para
   * nenhuma das duas ser sobrescrita.
   *
   * Os que deram ERRO ficam de fora: nenhuma linha nasceu para eles, então
   * reenviar é legítimo e não merece diálogo no caminho.
   */
  /* Montada só na hora de soltar os arquivos: era um `useMemo` que dependia
     da fila, e a fila muda a cada progresso — 8.000 nomes copiados dezenas
     de vezes por segundo num envio de 4.000, para uma pergunta feita uma vez. */
  function conferirEEnviar(brutos: ArquivoComCaminho[]) {
    if (brutos.length === 0) return;
    const jaConhecidos: ArquivoConhecido[] = [
      ...arquivosNaGaleria,
      ...envio.fila.filter((i) => i.situacao !== "erro").map((i) => ({ nome: i.nome, bytes: i.bytes })),
    ];
    const { novos, repetidos } = separarRepetidos(brutos, jaConhecidos);
    if (repetidos.length === 0) mandar(brutos);
    else setPergunta({ novos, repetidos });
  }

  return (
    <section aria-labelledby="titulo-envio" className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      {/*
        ── A SEÇÃO SE APRESENTA (29/09/2026) ────────────────────────────────

        Juan: "poderia estar mais claro a parte de enviar as fotos" e, logo
        depois, "na parte de subir as fotos, deixar mais evidente que é uma
        seção de UPLOAD".

        Dava para ver no HTML: o bloco dos capítulos era um cartão com `<h2>` e
        subtítulo, e este começava direto no seletor de capítulo — uma caixa
        tracejada solta no meio do branco, sem nome. Quem varre a página não
        encontra uma seção que não se apresenta.

        O título NÃO repete a caixa: "Arraste a pasta do casamento aqui" é a
        instrução do gesto; o `<h2>` é o nome da seção. A frase sobre o arquivo
        ir direto para o armazenamento subiu para cá, e saiu de lá — dizer duas
        vezes, a três centímetros de distância, é o que o Felipe chamou de feio
        na outra tela.

        O `aria-labelledby` não é enfeite: `<section>` sem nome acessível não é
        landmark nenhuma, e "é uma seção de upload" ficaria verdade só para quem
        enxerga. A única palavra "Enviar" da tela morava no menu lateral — que
        some no celular.
      */}
      <h2 id="titulo-envio" className="text-sm font-semibold">
        Enviar fotos e vídeos
      </h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Daqui as fotos e os vídeos vão direto do seu navegador para o armazenamento — sem passar
        pelo nosso servidor.
      </p>

      {secoes.length > 0 && (
        <label className="mb-3 mt-4 flex flex-wrap items-center gap-2 text-sm">
          {/* "Para" e não "Enviar para": com o `<h2>Enviar fotos e vídeos</h2>` uma
              linha acima, o verbo repetido é o eco que o Felipe chamou de feio.
              Sob o título, o rótulo continua inequívoco. */}
          <span className="text-texto-soft">Para o capítulo:</span>
          {/*
            LIVRE DURANTE O ENVIO (16/09/2026).

            Era `disabled={envio.rodando}`, e a trava tinha razão de ser: a fila
            de envio era uma corrida fechada por lote, e mandar um segundo lote
            no meio do primeiro criava duas corridas disputando a mesma rede.

            Felipe topou com isso: "não consigo enviar simultaneamente fotos
            para making of, cerimônia, decoração… tenho que esperar subir as
            fotos de um dos capítulos". E depois, direto: "não bloquear o
            'enviar para capítulo'".

            A fila virou fila de verdade — um consumidor só, lista que cresce
            (ver `emParaleloDeFila`). O capítulo de cada arquivo é resolvido no
            momento em que ele ENTRA na fila e viaja com ele, então trocar o
            seletor agora não mexe no que já está subindo.
          */}
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
          >
            <option value="">— sem capítulo —</option>
            {secoes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
          <span className="text-xs text-texto-faint">
            dá para trocar e mandar outro capítulo sem esperar este terminar
          </span>
        </label>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setArrastando(false);
          conferirEEnviar(await arquivosDeArrasto(e.dataTransfer));
        }}
        className={`mt-4 rounded-xl border border-dashed px-6 py-12 text-center transition ${
          arrastando ? "border-acento bg-acento/5" : "border-linha-forte bg-carbon-2"
        }`}
      >
        <p className="text-base font-medium">Arraste a pasta do casamento aqui</p>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm text-texto-soft">
          Pode ser a pasta inteira, com subpastas.
        </p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => document.getElementById("escolher-pasta")?.click()}
            className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Escolher pasta
          </button>
          <button
            type="button"
            onClick={() => document.getElementById("escolher-arquivos")?.click()}
            className="rounded-lg border border-linha-forte px-4 py-2.5 text-sm transition hover:bg-carbon-2"
          >
            Escolher arquivos
          </button>
        </div>

        <input
          id="escolher-pasta"
          type="file"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(e) => {
            conferirEEnviar([...(e.target.files ?? [])].map(comCaminhoDoInput));
            e.target.value = "";
          }}
        />
        <input
          id="escolher-arquivos"
          type="file"
          multiple
          /*
            ── LISTA FECHADA VIRA UM ARQUIVO POR VEZ NO IPHONE (29/09/2026) ──

            Juan: "pelo celular, não estão conseguindo subir vários vídeos de
            uma vez. Tem que ir um a um."

            Aqui havia os nove mimes exatos. No iPhone, a lista fechada é o
            caminho conhecido para o seletor de fotos entregar um arquivo por
            vez; `image/*` e `video/*` são as formas que ele entende para abrir
            a biblioteca inteira com seleção múltipla.

            ⚠ Não confirmado num iPhone de verdade — não há um aqui. A
            confirmação é do Juan, no aparelho dele.

            Afrouxar aqui não afrouxa nada: quem decide o que ENTRA continua
            sendo o servidor, que devolve 415 para o que não estiver em
            `TIPOS_ACEITOS` (nove tipos exatos, presos por
            `testar-poster-de-video.mjs`). O `accept` só muda o que o seletor
            OFERECE — e oferecer a mais, com recusa clara depois, é melhor do
            que oferecer de menos e não deixar escolher nada.
          */
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            conferirEEnviar([...(e.target.files ?? [])].map(comCaminhoDoInput));
            e.target.value = "";
          }}
        />

        <p className="mt-4 text-xs text-texto-faint">
          JPG, PNG, WEBP, HEIC · MP4, MOV, WEBM · filmes de até 100 GB · {PARALELOS} de cada vez ·
          o envio continua enquanto você mexe nas outras abas
        </p>
      </div>

      {pergunta && (
        <div
          role="alertdialog"
          aria-label="Arquivos com nome repetido"
          className="mt-4 rounded-xl border border-alerta/40 bg-alerta/10 p-4"
        >
          <p className="text-sm font-medium text-alerta">
            {pergunta.repetidos.length}{" "}
            {pergunta.repetidos.length === 1
              ? "arquivo já está na galeria — mesmo nome e mesmo tamanho"
              : "arquivos já estão na galeria — mesmo nome e mesmo tamanho"}
          </p>
          <p className="mt-1 text-xs text-texto-soft">
            {pergunta.repetidos
              .slice(0, 6)
              .map((r) => r.arquivo.name)
              .join(", ")}
            {pergunta.repetidos.length > 6 && ` e mais ${pergunta.repetidos.length - 6}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                mandar([...pergunta.novos, ...pergunta.repetidos], []);
                setPergunta(null);
              }}
              className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2"
            >
              Enviar mesmo assim ({pergunta.novos.length + pergunta.repetidos.length})
            </button>
            <button
              type="button"
              onClick={() => {
                if (pergunta.novos.length) mandar(pergunta.novos, pergunta.repetidos);
                setPergunta(null);
              }}
              disabled={pergunta.novos.length === 0}
              className="rounded-lg bg-acento px-3 py-1.5 text-xs font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
            >
              Pular esses e enviar {pergunta.novos.length}
            </button>
            <button
              type="button"
              onClick={() => setPergunta(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-texto-soft underline underline-offset-4 transition hover:text-texto"
            >
              cancelar
            </button>
          </div>
        </div>
      )}

      {envio.avisoRostos && <p className="mt-3 text-xs text-alerta">{envio.avisoRostos}</p>}
    </section>
  );
}
