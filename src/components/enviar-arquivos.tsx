"use client";

import { useMemo, useState } from "react";
import {
  PARALELOS,
  type ArquivoComCaminho,
  arquivosDeArrasto,
  comCaminhoDoInput,
  separarRepetidos,
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
  nomesNaGaleria,
}: {
  secoes: SecaoDestino[];
  /** A busca por rosto está ligada: cada foto é medida durante o envio. */
  rostosAtivos: boolean;
  /** Nomes de arquivo que já estão na galeria — a base da pergunta de repetido. */
  nomesNaGaleria: string[];
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

  const mandar = (itens: ArquivoComCaminho[]) =>
    envio.enfileirar(itens, { destino: destino || undefined, rostosAtivos });

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
   * `nomesNaGaleria` é o retrato que o SERVIDOR desenhou quando a página
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
  const jaConhecidos = useMemo(
    () => [
      ...nomesNaGaleria,
      ...envio.fila.filter((i) => i.situacao !== "erro").map((i) => i.nome),
    ],
    [nomesNaGaleria, envio.fila],
  );

  function conferirEEnviar(brutos: ArquivoComCaminho[]) {
    if (brutos.length === 0) return;
    const { novos, repetidos } = separarRepetidos(brutos, jaConhecidos);
    if (repetidos.length === 0) mandar(brutos);
    else setPergunta({ novos, repetidos });
  }

  return (
    <section className="mt-8">
      {secoes.length > 0 && (
        <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-texto-soft">Enviar para o capítulo:</span>
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
        className={`rounded-xl border border-dashed px-6 py-12 text-center transition ${
          arrastando ? "border-acento bg-acento/5" : "border-linha-forte bg-carbon"
        }`}
      >
        <p className="text-base font-medium">Arraste a pasta do casamento aqui</p>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm text-texto-soft">
          Pode ser a pasta inteira, com subpastas. Os arquivos vão direto do seu navegador para o
          armazenamento — sem passar pelo nosso servidor.
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
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
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
              ? "arquivo tem nome igual ao de um que já está na galeria"
              : "arquivos têm nome igual ao de outros que já estão na galeria"}
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
                mandar([...pergunta.novos, ...pergunta.repetidos]);
                setPergunta(null);
              }}
              className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2"
            >
              Enviar mesmo assim ({pergunta.novos.length + pergunta.repetidos.length})
            </button>
            <button
              type="button"
              onClick={() => {
                if (pergunta.novos.length) mandar(pergunta.novos);
                setPergunta(null);
              }}
              disabled={pergunta.novos.length === 0}
              className="rounded-lg bg-acento px-3 py-1.5 text-xs font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
            >
              Ignorar as repetidas e enviar {pergunta.novos.length}
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
