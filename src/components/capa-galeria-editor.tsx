"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EscolherCapa } from "@/components/escolher-capa";
import { pontoNaFoto } from "@/lib/enquadramento";

/**
 * A área de capa, dentro de Design.
 *
 * ── O PEDIDO (04/09/2026) ─────────────────────────────────────────────────
 *
 * "Adicionar uma área de selecionar capa: escolher se será de alguma galeria já
 * existente ou se será através da importação de algum arquivo."
 *
 * São duas metades, e só uma existia:
 *
 *   UMA FOTO DA GALERIA  já dava, e estava escondida — o botão "capa" mora em
 *     cada miniatura da grade, e quem não rolasse a grade não o encontrava.
 *     Aqui ele vira um caminho anunciado, com link para o lugar certo.
 *   UM ARQUIVO PRÓPRIO   não existia. Quem quisesse uma arte na capa (convite,
 *     cartão com o nome do casal) precisava subi-la como foto — e ela aparecia
 *     no meio das outras para o casal, contava como entrega e ia no "baixar
 *     tudo". Agora vai para fora de `medias`. Ver a migração 029.
 *
 * ── O ESCOLHEDOR VIROU POP-UP (08/09/2026) ────────────────────────────────
 *
 * Felipe: "abrir um pop up para selecionar a foto de capa, ao invés de ir para
 * a galeria, facilita para o usuário".
 *
 * Era um LINK para a aba Fotos, e o caminho é pior do que parece: rolar
 * centenas de miniaturas procurando o botão "capa" que só aparece no hover de
 * cada uma, e depois voltar ao Design para ver o resultado. Três telas para
 * uma decisão.
 *
 * O motivo de ser um link continua verdadeiro e deixou de valer: desenhar a
 * grade AQUI obrigaria o Design a assinar uma miniatura por foto — 600 num
 * casamento —, que é a carga que a divisão em abas veio cortar. O pop-up busca
 * a lista só ao ABRIR (`/api/galerias/[id]/fotos`), então quem entra no Design
 * para trocar a fonte não paga nada. O custo passou a ser de quem usa.
 *
 * ── E O ENQUADRAMENTO ─────────────────────────────────────────────────────
 *
 * Juan, no mesmo dia: "queria que aparecesse mais o corpo do noivo, mas o
 * enquadramento foi automático". Ver `PontoFocal` mais abaixo.
 */
export function CapaGaleriaEditor({
  galeriaId,
  urlCapaAtual,
  enviada,
  focoX,
  focoY,
}: {
  galeriaId: string;
  /** A capa que está valendo agora, seja a enviada ou a foto escolhida. */
  urlCapaAtual: string | null;
  /** true quando a capa atual é um arquivo enviado, não uma foto da galeria. */
  enviada: boolean;
  /** Onde cortar, em porcentagem. 50/50 é o centro — ver migração 031. */
  focoX: number;
  focoY: number;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"enviando" | "removendo" | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function usarFotoDaGaleria(mediaId: string) {
    setErro(null);
    try {
      const r = await fetch(`/api/galerias/${galeriaId}/capa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      if (!r.ok) throw new Error("não consegui usar esta foto como capa");
      setEscolhendo(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui trocar a capa");
    }
  }

  async function enviar(arquivo: File) {
    setErro(null);
    setOcupado("enviando");
    try {
      /* Mesmo caminho da logo e das fotos: o arquivo vai DIRETO para o bucket
         com URL assinada, sem passar pelo nosso servidor. */
      const preparo = await fetch(`/api/galerias/${galeriaId}/capa`, {
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

      const confirma = await fetch(`/api/galerias/${galeriaId}/capa`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "não consegui confirmar a capa");

      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui enviar a capa");
    } finally {
      setOcupado(null);
    }
  }

  async function remover() {
    setErro(null);
    setOcupado("removendo");
    try {
      const r = await fetch(`/api/galerias/${galeriaId}/capa`, { method: "DELETE" });
      if (!r.ok) throw new Error("não consegui tirar a capa");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui tirar a capa");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Foto da capa</span>

      <div className="mt-2 flex flex-wrap items-start gap-4">
        <div className="w-40 shrink-0 overflow-hidden rounded-lg border border-linha bg-void">
          {urlCapaAtual ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
            <img src={urlCapaAtual} alt="Capa atual da galeria" className="h-24 w-full object-cover" />
          ) : (
            <span className="grid h-24 place-items-center px-2 text-center text-[11px] text-texto-faint">
              a primeira foto da galeria
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-texto-faint">
            {enviada
              ? "Uma imagem que você enviou só para a capa. Ela não aparece na galeria nem entra no download do cliente."
              : urlCapaAtual
                ? "Está usando uma foto da galeria."
                : "Sem escolha, a capa é a primeira foto da galeria."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado !== null}
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2 disabled:opacity-50"
            >
              {ocupado === "enviando" ? "enviando…" : "Enviar uma imagem"}
            </button>

            <button
              type="button"
              onClick={() => setEscolhendo(true)}
              className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:border-acento hover:bg-acento/5 hover:text-texto"
            >
              Usar uma foto da galeria
            </button>

            {enviada && (
              <button
                type="button"
                disabled={ocupado !== null}
                onClick={remover}
                className="rounded-lg px-3 py-1.5 text-xs text-texto-faint underline underline-offset-4 transition hover:text-erro disabled:opacity-50"
              >
                {ocupado === "removendo" ? "tirando…" : "tirar a imagem enviada"}
              </button>
            )}
          </div>

          <p className="mt-2 text-[11px] text-texto-faint">PNG, JPG ou WEBP, até 8 MB.</p>
          {erro && <p className="mt-2 text-xs text-erro">{erro}</p>}

          {/* Só existe com foto: sem capa não há o que enquadrar, e um quadro
              vazio aqui seria uma pergunta sem resposta. */}
          {urlCapaAtual && (
            <PontoFocal galeriaId={galeriaId} url={urlCapaAtual} x={focoX} y={focoY} />
          )}
        </div>
      </div>

      <EscolherCapa
        galeriaId={galeriaId}
        aberto={escolhendo}
        aoFechar={() => setEscolhendo(false)}
        aoEscolher={usarFotoDaGaleria}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviar(f);
        }}
      />
    </div>
  );
}

/**
 * O PONTO FOCAL: onde a capa deve ser cortada.
 *
 * Juan, 08/09/2026, com o print da capa dividida: "não consigo escolher onde
 * fica o ponto focal, eu queria que aparecesse mais o corpo do noivo, mas o
 * enquadramento foi automático". Na foto dele o noivo estava encostado na
 * borda de baixo, quase saindo.
 *
 * ── A FOTO APARECE INTEIRA AQUI, E É O PONTO ──────────────────────────────
 *
 * A miniatura do painel mostra o RESULTADO (já cortado); este quadro mostra a
 * foto INTEIRA, porque é impossível apontar para o noivo se o noivo já foi
 * cortado fora da imagem em que se clica. São dois quadros com trabalhos
 * opostos, e trocar um pelo outro quebra os dois.
 *
 * ── POR QUE CLICAR, E NÃO ARRASTAR ────────────────────────────────────────
 *
 * Arrastar exige mira contínua e, no toque, o dedo cobre justamente a imagem
 * que se precisa ver. Um clique é uma afirmação — "é aqui" — e o clique
 * seguinte a desfaz. O alvo é a foto inteira, o maior possível.
 *
 * ── E AGORA ELE ABRE GRANDE (05/10/2026) ──────────────────────────────────
 *
 * Juan: "o enquadramento poderia estar dentro de um botão chamado
 * 'enquadramento da capa', que quando clicasse nele abriria a foto pra
 * escolher com a bolinha onde fica o centro".
 *
 * O quadro antigo tinha 384×224 e morava aberto no painel, disputando espaço
 * com tudo o mais. Medido no mesmo editor, a Prévia tinha 927×578: o pequeno
 * dos dois era justamente aquele em que se precisa MIRAR. Fechado num botão,
 * ele para de ocupar a coluna o tempo todo e passa a abrir do tamanho da tela.
 *
 * `<dialog>` de verdade, com `showModal`: Esc para sair, foco preso dentro e
 * fundo inerte vêm do navegador. Reimplementar isso à mão seria trocar quatro
 * comportamentos corretos por quatro defeitos a descobrir.
 *
 * ── E A FOTO NÃO TEM MAIS FAIXA VAZIA ─────────────────────────────────────
 *
 * O quadro antigo era uma caixa com a foto `object-contain` dentro: ela quase
 * nunca preenchia a caixa, e o clique era medido contra a CAIXA. Todo clique
 * saía deslocado — numa foto 16:9 em caixa 4:3, clicar no topo da foto gravava
 * 13%. Isso cabia dentro do dedo enquanto o quadro era pequeno; num quadro
 * grande, não cabe mais.
 *
 * Agora o elemento `img` É a foto: `max-h`/`max-w` com a proporção natural, e
 * nenhuma faixa vazia para deslocar nada — o que vale para o clique e para a
 * bolinha, que é posicionada no mesmo sistema. `pontoNaFoto` continua fazendo
 * a conta porque é ela que recusa o clique antes de a foto ter medida, e
 * porque deixa a regra num lugar onde se pode olhar sem abrir o navegador.
 */
function PontoFocal({
  galeriaId,
  url,
  x,
  y,
}: {
  galeriaId: string;
  url: string;
  x: number;
  y: number;
}) {
  const [ponto, setPonto] = useState({ x, y });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  async function apontar(evento: React.MouseEvent<HTMLImageElement>) {
    const foto = evento.currentTarget;
    const r = foto.getBoundingClientRect();
    const novo = pontoNaFoto({
      quadro: { largura: r.width, altura: r.height },
      foto: { largura: foto.naturalWidth, altura: foto.naturalHeight },
      clique: { x: evento.clientX - r.left, y: evento.clientY - r.top },
    });
    /* Foto ainda sem medida: nada muda e nada é gravado. Silêncio aqui é
       honesto — não houve escolha para registrar. */
    if (!novo) return;

    const anterior = ponto;
    setPonto(novo);
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/galerias/${galeriaId}/capa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focoX: novo.x, focoY: novo.y }),
      });
      if (!resposta.ok) throw new Error(String(resposta.status));
      router.refresh();
    } catch {
      /* Sem isto a bolinha ficava onde a pessoa clicou e o banco ficava com o
         ponto velho: a tela mentia até alguém recarregar a página. */
      setPonto(anterior);
      setErro("não deu para salvar — clique de novo");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => caixa.current?.showModal()}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-linha px-3 py-2.5 text-left transition hover:border-acento hover:bg-acento/5"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium text-texto-soft">Enquadramento da capa</span>
          <span className="mt-0.5 block text-[11px] text-texto-faint">
            {salvando ? "salvando…" : `o centro está em ${ponto.x}% ${ponto.y}%`}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-xs text-texto-faint">
          ajustar
        </span>
      </button>
      {erro && <p className="mt-1 text-[11px] text-erro">{erro}</p>}

      <dialog
        ref={caixa}
        /* `backdrop:` é o fundo do próprio navegador — não há div de fundo para
           esquecer de fechar, nem z-index para brigar com o resto da tela. */
        className="m-auto w-[min(92vw,960px)] max-w-none rounded-xl border border-linha bg-carbon p-4 text-texto backdrop:bg-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Enquadramento da capa</h2>
            <p className="mt-0.5 text-[11px] text-texto-faint">
              Clique no que não pode ser cortado. A capa corta o resto em volta deste ponto.
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

        {/* O embrulho encolhe até a foto, e não ao contrário: é isso que faz a
            bolinha em porcentagem cair exatamente onde a pessoa clicou. */}
        <div className="mt-3 flex justify-center">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
            <img
              src={url}
              alt="A foto da capa inteira: clique no que não pode ser cortado"
              onClick={apontar}
              className="block max-h-[70vh] max-w-full cursor-crosshair"
            />
            <span
              aria-hidden="true"
              /* `pointer-events-none` para a bolinha não roubar o clique de
                 quem está mirando justamente embaixo dela. */
              className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,.55)]"
              style={{ left: `${ponto.x}%`, top: `${ponto.y}%` }}
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-texto-faint">
          {salvando ? "salvando…" : `ponto em ${ponto.x}% ${ponto.y}%`}
        </p>
      </dialog>
    </div>
  );
}
