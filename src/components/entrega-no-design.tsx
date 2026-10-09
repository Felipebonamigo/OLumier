"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  definirCapaDaPastaAction,
  fotosDaPastaAction,
  renomearVideoAction,
} from "@/app/painel/actions";
import type { FotoDaPasta, PastaNoDesign, VideoNoDesign } from "@/lib/entrega-no-design";
import { pontoNaFoto } from "@/lib/enquadramento";

/**
 * O CONTEÚDO DAS PASTAS E DO STREAM, NO DESIGN (30/09/2026).
 *
 * Os nomes dos vídeos e as capas das pastas não são aparência: não passam pelo
 * rascunho nem pelo "Publicar". São dados da entrega, como o nome de um
 * capítulo — gravam na hora, e a prévia recarrega sozinha (a assinatura da
 * prévia, em `design/page.tsx`, inclui os dois).
 *
 * Moram aqui, e não na aba Fotos, porque é aqui que o fotógrafo está olhando
 * a prévia do formato — ver `lib/entrega-no-design.ts`.
 */

/** Os nomes dos vídeos, um campo por vídeo, com o pôster ao lado. */
export function NomesDosVideos({
  galeriaId,
  videos,
  aoGravar,
}: {
  galeriaId: string;
  videos: VideoNoDesign[];
  aoGravar: () => void;
}) {
  if (videos.length === 0) return null;
  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Nome de cada vídeo</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        É o nome que o cliente vê no Stream. Vazio usa o nome do arquivo. O arquivo baixado continua
        com o nome original.
      </p>
      <ul className="mt-2 divide-y divide-linha rounded-lg border border-linha">
        {videos.map((v) => (
          <NomeDoVideo key={v.id} galeriaId={galeriaId} video={v} aoGravar={aoGravar} />
        ))}
      </ul>
    </div>
  );
}

function NomeDoVideo({
  galeriaId,
  video,
  aoGravar,
}: {
  galeriaId: string;
  video: VideoNoDesign;
  aoGravar: () => void;
}) {
  const [valor, setValor] = useState(video.titulo ?? "");
  const [gravado, setGravado] = useState(video.titulo ?? "");
  const [estado, setEstado] = useState<"" | "gravando" | "ok" | "erro">("");
  const [, iniciar] = useTransition();

  function gravar() {
    const limpo = valor.replace(/\s+/g, " ").trim();
    if (limpo === gravado) return;
    setEstado("gravando");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", video.id);
      f.set("titulo", limpo);
      const r = await renomearVideoAction(f);
      if (!r.ok) {
        setEstado("erro");
        return;
      }
      setValor(limpo);
      setGravado(limpo);
      setEstado("ok");
      aoGravar();
    });
  }

  return (
    <li className="flex items-center gap-3 p-2">
      <span className="block aspect-video w-20 shrink-0 overflow-hidden rounded bg-carbon-2">
        {video.poster && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
          <img src={video.poster} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <input
          value={valor}
          onChange={(e) => {
            setValor(e.target.value.slice(0, 120));
            setEstado("");
          }}
          onBlur={gravar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") setValor(gravado);
          }}
          maxLength={120}
          placeholder={video.doArquivo}
          aria-label={`Nome do vídeo ${video.nomeDoArquivo}`}
          className="w-full rounded-md border border-linha bg-void px-2.5 py-1.5 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
        />
        <span className="mt-1 flex gap-2 truncate text-[10px] text-texto-faint">
          <span className="truncate">
            {video.nomeDoArquivo}
            {video.capitulo ? ` · ${video.capitulo}` : ""}
          </span>
          <span
            role="status"
            className={`ml-auto shrink-0 ${estado === "erro" ? "text-alerta" : "text-texto-faint"}`}
          >
            {estado === "gravando" ? "gravando…" : estado === "ok" ? "gravado" : estado === "erro" ? "não gravou" : ""}
          </span>
        </span>
      </span>
    </li>
  );
}

/**
 * A capa de cada pasta: o cartão de cada capítulo com a capa de hoje, e as
 * fotos dele para escolher outra — carregadas só quando a pasta é aberta.
 */
export function CapasDasPastas({
  galeriaId,
  pastas,
  aoGravar,
}: {
  galeriaId: string;
  pastas: PastaNoDesign[];
  aoGravar: () => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  /*
   * ── POR QUE UM CONTADOR, E NÃO SÓ O ID ────────────────────────────────
   *
   * Medido no navegador: o `<dialog>` fecha com Esc SEM disparar o evento
   * `close` — um ouvinte posto direto no elemento contou zero. O React não
   * tem como saber que fechou, e o estado fica dizendo "aberta".
   *
   * Sem isto, reabrir a MESMA pasta não fazia nada: o id não mudava, o efeito
   * não rodava de novo, e era preciso clicar duas vezes. O contador sobe a
   * cada clique, então "abrir esta pasta" é sempre um pedido novo — mesmo que
   * seja a mesma de antes.
   */
  const [pedido, setPedido] = useState(0);
  if (pastas.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-texto-faint">
        Quando a galeria tiver capítulos com fotos, a capa de cada pasta se escolhe aqui.
      </p>
    );
  }
  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Capa de cada pasta</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        Clique num capítulo para enviar uma imagem ou escolher uma das fotos dele. Sem escolha, a capa
        é a primeira foto do capítulo. As fotos fora de capítulo formam uma pasta com a primeira delas.
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {pastas.map((p) => {
          const ativa = aberta === p.secaoId;
          return (
            <li key={p.secaoId}>
              <button
                type="button"
                onClick={() => {
                  setAberta(p.secaoId);
                  setPedido((n) => n + 1);
                }}
                className={`group block w-full overflow-hidden rounded-lg border text-left transition ${
                  ativa ? "border-acento" : "border-linha hover:border-acento"
                }`}
              >
                <span className="relative block aspect-[4/3] bg-carbon-2">
                  {p.capa && (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
                    <img src={p.capa} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white/85">
                    {p.enviada ? "imagem enviada" : p.escolhida ? "capa escolhida" : "primeira foto"}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                  <span className="truncate text-xs font-medium">{p.nome}</span>
                  <span className="shrink-0 text-[10px] text-acento-alto">
                    trocar
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {/*
        ── A ESCOLHA VIROU POP-UP (09/10/2026) ──────────────────────────────

        Juan: "a escolha das capas poderia acontecer através de um popup, dando
        as opções de escolher foto da galeria ou enviar imagem (ao invés de ter
        que rolar a página, tudo aconteceria por um popup)".

        O painel nascia ABAIXO da grade inteira. Com vinte pastas, clicar na
        primeira abria a lista a uma tela e meia dali, e quem clicou não via
        nada acontecer.

        `<dialog>` de verdade, com `showModal`: Esc para sair, foco presoDENTRO
        e fundo inerte vêm do navegador. É a mesma escolha do enquadramento da
        capa da galeria, pelo mesmo motivo — reimplementar isso à mão troca
        quatro comportamentos corretos por quatro defeitos a descobrir.

        UM pop-up, e não um por pasta: vinte `<dialog>` no HTML seriam vinte
        vezes a mesma marcação para mostrar uma de cada vez.
      */}
      <PopUpDaCapa
        galeriaId={galeriaId}
        pedido={pedido}
        pasta={pastas.find((p) => p.secaoId === aberta) ?? null}
        fechar={() => setAberta(null)}
        aoGravar={() => {
          setAberta(null);
          aoGravar();
        }}
      />
    </div>
  );
}

function PopUpDaCapa({
  galeriaId,
  pasta,
  pedido,
  fechar,
  aoGravar,
}: {
  galeriaId: string;
  pasta: PastaNoDesign | null;
  /** Sobe a cada clique no cartão. Ver o porquê em `CapasDasPastas`. */
  pedido: number;
  fechar: () => void;
  aoGravar: () => void;
}) {
  const caixa = useRef<HTMLDialogElement>(null);

  /* Abrir e fechar seguem o ESTADO, e não o clique: assim o Esc do navegador
     (que fecha sem passar por nós) não deixa o estado dizendo "aberta". */
  useEffect(() => {
    const d = caixa.current;
    if (!d) return;
    if (pasta && !d.open) d.showModal();
    if (!pasta && d.open) d.close();
  }, [pasta, pedido]);

  /*
   * O Esc do navegador fecha o `<dialog>` SEM passar por nós, e o estado ficava
   * dizendo "aberta". Medido no navegador: depois do Esc o cartão continuava
   * escrito "fechar", e o clique seguinte FECHAVA em vez de reabrir — era
   * preciso clicar duas vezes na mesma pasta.
   *
   * O ouvinte é posto no elemento, e não no `onClose` do React: é o evento
   * nativo que o navegador dispara, e foi exatamente ele que o `onClose` não
   * entregou aqui.
   */
  useEffect(() => {
    const d = caixa.current;
    if (!d) return;
    d.addEventListener("close", fechar);
    return () => d.removeEventListener("close", fechar);
  }, [fechar]);

  return (
    <dialog
      ref={caixa}
      className="m-auto w-[min(94vw,860px)] max-w-none rounded-xl border border-linha bg-carbon p-4 text-texto backdrop:bg-black/60"
    >
      {pasta && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">A capa de {pasta.nome}</h2>
              <p className="mt-0.5 text-[11px] text-texto-faint">
                Escolha uma foto do capítulo, envie uma imagem, e ajuste o enquadramento.
              </p>
            </div>
            <button
              type="button"
              onClick={() => caixa.current?.close()}
              className="shrink-0 rounded-lg border border-linha px-3 py-1.5 text-xs transition hover:bg-carbon-2"
            >
              Fechar
            </button>
          </div>
          <FotosParaCapa key={pasta.secaoId} galeriaId={galeriaId} pasta={pasta} escolher={aoGravar} />
        </>
      )}
    </dialog>
  );
}

/**
 * ONDE A CAPA DA PASTA DEVE SER CORTADA.
 *
 * A foto aparece INTEIRA aqui — a miniatura do painel mostra o RESULTADO (já
 * cortado), e é impossível apontar para o noivo se o noivo já foi cortado fora
 * da imagem em que se clica. São dois quadros com trabalhos opostos.
 *
 * A conta mora em `lib/enquadramento.ts`, a mesma da capa da galeria: o
 * elemento `img` É a foto (proporção natural, sem faixa vazia), e `pontoNaFoto`
 * recusa o clique enquanto a foto não tem medida — não gravar nada é melhor
 * que gravar errado.
 */
function EnquadrarCapaDaPasta({
  galeriaId,
  secaoId,
  url,
  x,
  y,
}: {
  galeriaId: string;
  secaoId: string;
  url: string;
  x: number;
  y: number;
}) {
  const [ponto, setPonto] = useState({ x, y });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function apontar(evento: React.MouseEvent<HTMLImageElement>) {
    const foto = evento.currentTarget;
    const r = foto.getBoundingClientRect();
    const novo = pontoNaFoto({
      quadro: { largura: r.width, altura: r.height },
      foto: { largura: foto.naturalWidth, altura: foto.naturalHeight },
      clique: { x: evento.clientX - r.left, y: evento.clientY - r.top },
    });
    if (!novo) return;

    const anterior = ponto;
    setPonto(novo);
    setSalvando(true);
    setErro("");
    try {
      const resposta = await fetch(`/api/galerias/${galeriaId}/secoes/${secaoId}/foco`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focoX: novo.x, focoY: novo.y }),
      });
      if (!resposta.ok) throw new Error(String(resposta.status));
    } catch {
      /* Sem isto a bolinha ficava onde a pessoa clicou e o banco ficava com o
         ponto velho: a tela mentia até alguém recarregar. */
      setPonto(anterior);
      setErro("não deu para salvar — clique de novo");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-3">
      <span className="block text-xs text-texto-soft">Enquadramento da capa</span>
      <p className="mt-0.5 text-[11px] text-texto-faint">
        Clique no que não pode ser cortado. A capa corta o resto em volta deste ponto.
      </p>
      <div className="mt-2 flex justify-center">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém */}
          <img
            src={url}
            alt="A capa da pasta inteira: clique no que não pode ser cortado"
            onClick={apontar}
            className="block max-h-[46vh] max-w-full cursor-crosshair"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,.55)]"
            style={{ left: `${ponto.x}%`, top: `${ponto.y}%` }}
          />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-texto-faint">
        {salvando ? "salvando…" : `ponto em ${ponto.x}% ${ponto.y}%`}
      </p>
      {erro && <p className="mt-1 text-[11px] text-alerta">{erro}</p>}
    </div>
  );
}

function FotosParaCapa({
  galeriaId,
  pasta,
  escolher,
}: {
  galeriaId: string;
  pasta: PastaNoDesign;
  escolher: () => void;
}) {
  const [fotos, setFotos] = useState<FotoDaPasta[] | null>(null);
  const [mais, setMais] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, iniciar] = useTransition();
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const rotaDaCapa = `/api/galerias/${galeriaId}/secoes/${pasta.secaoId}/capa`;

  /*
   * O arquivo vai DIRETO do navegador para o bucket com URL assinada — mesmo
   * caminho da capa da galeria, da logo e das fotos. O servidor só prepara e
   * confirma, e confere na confirmação o que REALMENTE chegou.
   */
  async function enviarArquivo(arquivo: File) {
    setErro("");
    setEnviando(true);
    try {
      const preparo = await fetch(rotaDaCapa, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: arquivo.type, bytes: arquivo.size }),
      });
      const dados = await preparo.json();
      if (!preparo.ok) throw new Error(dados.erro ?? "não consegui preparar o envio");

      const subida = await fetch(dados.url, {
        method: "PUT",
        headers: { "Content-Type": arquivo.type },
        body: arquivo,
      });
      if (!subida.ok) throw new Error("o arquivo não chegou ao armazenamento");

      const confirma = await fetch(rotaDaCapa, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "não consegui confirmar a capa");
      escolher();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui enviar a imagem");
    } finally {
      setEnviando(false);
    }
  }

  async function tirarEnviada() {
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch(rotaDaCapa, { method: "DELETE" });
      if (!r.ok) throw new Error("não consegui tirar a imagem");
      escolher();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui tirar a imagem");
    } finally {
      setEnviando(false);
    }
  }

  function carregar(desde: number) {
    iniciar(async () => {
      try {
        const r = await fotosDaPastaAction(galeriaId, pasta.secaoId, desde);
        setFotos((atual) => [...(atual ?? []), ...r.fotos]);
        setMais(r.mais);
      } catch {
        setErro("Não consegui carregar as fotos. Tente de novo.");
      }
    });
  }

  /* A primeira página, ao abrir. A `key` do pai remonta o componente ao
     trocar de pasta, então isto roda uma vez por pasta aberta. */
  useEffect(() => {
    let vivo = true;
    fotosDaPastaAction(galeriaId, pasta.secaoId, 0)
      .then((r) => {
        if (!vivo) return;
        setFotos(r.fotos);
        setMais(r.mais);
      })
      .catch(() => vivo && setErro("Não consegui carregar as fotos. Tente de novo."));
    return () => {
      vivo = false;
    };
  }, [galeriaId, pasta.secaoId]);

  function usar(id: string) {
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", id);
      const r = await definirCapaDaPastaAction(f);
      if (!r.ok) {
        setErro("Não consegui trocar a capa. Tente de novo.");
        return;
      }
      escolher();
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-linha p-3">
      <span className="block text-xs text-texto-soft">
        A capa de <strong className="text-texto">{pasta.nome}</strong>
      </span>
      {/*
        ── ENVIAR UMA IMAGEM QUE NÃO É DA ENTREGA (01/10/2026) ───────────────

        Juan: "enviar uma nova foto ou escolher uma da galeria". A segunda metade
        é a grade abaixo, e existia. Esta é a primeira: uma arte com o nome do
        capítulo, um convite, um frame tratado — imagem que o casal NÃO deve
        encontrar no meio das fotos dele.

        Fica ACIMA da grade porque é o pedido novo, e porque quem já sabe qual
        foto quer rola três centímetros; quem quer subir um arquivo e não acha o
        botão desiste.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={ocupado || enviando}
          onClick={() => arquivoRef.current?.click()}
          className="rounded-md border border-linha px-2.5 py-1.5 text-xs transition hover:border-acento disabled:opacity-60"
        >
          {enviando ? "enviando…" : "Enviar uma imagem"}
        </button>
        {pasta.enviada && (
          <button
            type="button"
            disabled={ocupado || enviando}
            onClick={tirarEnviada}
            className="text-[11px] text-texto-faint underline underline-offset-4 transition hover:text-alerta disabled:opacity-60"
          >
            tirar a imagem enviada
          </button>
        )}
        <span className="text-[11px] text-texto-faint">PNG, JPG ou WEBP, até 8 MB</span>
      </div>
      <input
        ref={arquivoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviarArquivo(f);
        }}
      />
      {/*
        ── O ENQUADRAMENTO (09/10/2026) ─────────────────────────────────────

        Juan: "adicionar opção de escolher o ponto focal da imagem, para poder
        deixar a capa da pasta também centralizada da forma que eu quiser". É o
        mesmo pedido que ele fez em 08/09 para a capa da GALERIA — ver a
        migração 066, e a 031 que veio antes.

        Aparece só quando JÁ existe capa: apontar o centro de uma imagem que
        ainda não foi escolhida é apontar para o nada.
      */}
      {pasta.capa && (
        <EnquadrarCapaDaPasta
          galeriaId={galeriaId}
          secaoId={pasta.secaoId}
          url={pasta.capa}
          x={pasta.focoX}
          y={pasta.focoY}
        />
      )}
      <span className="mt-3 block text-xs text-texto-soft">Ou escolha uma foto do capítulo</span>
      {erro && <p className="mt-2 text-xs text-alerta">{erro}</p>}
      {fotos === null ? (
        <p className="mt-2 text-[11px] text-texto-faint">carregando as fotos…</p>
      ) : (
        <>
          <ul className="mt-2 grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {fotos.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => usar(f.id)}
                  className="block aspect-square w-full overflow-hidden rounded border border-transparent transition hover:border-acento disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém */}
                  <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
          {mais && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => carregar(fotos.length)}
              className="mt-2 text-[11px] text-acento-alto underline underline-offset-4 disabled:opacity-60"
            >
              mostrar mais fotos
            </button>
          )}
        </>
      )}
    </div>
  );
}
