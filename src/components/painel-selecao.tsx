"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarRegrasSelecaoAction, reabrirSelecaoAction } from "@/app/painel/actions";

/**
 * As favoritas do cliente, do lado de quem entrega.
 *
 * Chamava-se "Escolha do álbum" — nome do que o fotógrafo FAZ com a lista
 * depois, não do que a seção mostra. O que ela mostra são as fotos que o cliente
 * marcou, e é assim que ele fala delas ao telefone.
 *
 * O que estava faltando não era a marcação — os corações já funcionavam desde a
 * migração 010. Faltava tudo o que vem depois dela: quantas fotos cabem, até
 * quando dá para escolher, e o sinal de que acabou.
 *
 * Sem esse sinal o fotógrafo não tem como saber quando pode editar. Ele volta ao
 * WhatsApp perguntar "já escolheram?", que é exatamente o vai e volta que a
 * seleção veio matar.
 *
 * ── POR QUE A LISTA FICA AQUI, E EM TEXTO ─────────────────────────────────
 * Porque o próximo passo dele é o Lightroom, e lá se filtra por NOME DE
 * ARQUIVO. Um botão de "exportar CSV" daria um arquivo para ele abrir, converter
 * e colar; o texto pronto para copiar entra direto no campo de busca do editor.
 * É o degrau mais baixo que resolve.
 */
export function PainelSelecao({
  galeriaId,
  total,
  limite,
  prazo,
  fechadaEm,
  aberta,
  motivo,
  combinada,
  lista,
  pessoas = [],
}: {
  galeriaId: string;
  total: number;
  limite: number | null;
  prazo: string | null;
  fechadaEm: string | null;
  aberta: boolean;
  motivo: "fechada" | "prazo" | null;
  /** Há limite ou prazo. Sem eles as favoritas são livres — ver
      `EstadoSelecao.combinada` em `lib/favoritas.ts`. */
  combinada: boolean;
  lista: { nome: string; capitulo: string | null }[];
  /**
   * Quem escolheu, e quantas — migração 033.
   *
   * Vazio nas galerias entregues antes de 15/09/2026: lá a lista era uma só e
   * ninguém se identificava. O bloco some nesse caso, em vez de desenhar um
   * "0 pessoas" que faria o fotógrafo procurar um defeito que não existe.
   */
  pessoas?: { id: string; email: string | null; nome: string | null; quantas: number }[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mostrandoLista, setMostrandoLista] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const executar = (acao: (f: FormData) => Promise<{ erro?: string } | void>, campos: Record<string, string>) =>
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      setErro(r?.erro ?? null);
      router.refresh();
    });

  const texto = lista.map((l) => l.nome).join("\n");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* Área de transferência bloqueada (http, permissão negada): a lista está
       * aberta na tela logo abaixo, então dá para selecionar à mão. Um alerta
       * aqui só assustaria por algo que tem saída óbvia. */
      setMostrandoLista(true);
    }
  };

  const dataBonita = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) : "";

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Favoritas do cliente</h2>
          {/*
            ── O TEXTO FICOU PARA TRÁS DO PRODUTO (17/09/2026) ─────────────

            Dizia "a lista é uma só — o casal escolhe junto". Foi verdade até a
            migração 033, em 15/09/2026, quando cada pessoa passou a ter a sua,
            identificada por e-mail. Desde então a frase contradizia a lista por
            pessoa desenhada dez linhas abaixo dela, na mesma tela.

            Felipe leu o cartão e perguntou se o recurso tinha sido feito. Tinha
            — só que a tela dizia que não, e é a tela que ele lê.
          */}
          <p className="mt-0.5 text-xs text-texto-faint">
            Cada pessoa marca as suas na própria galeria, identificada por e-mail. A noiva vê a
            mesma lista no celular e no notebook, e ninguém desmarca a escolha de outro.
          </p>
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-xs ${
            !aberta ? "border-ok/40 bg-ok/10 text-ok" : "border-linha text-texto-faint"
          }`}
        >
          {!combinada
            ? "favoritas livres"
            : motivo === "fechada"
              ? "escolha encerrada"
              : motivo === "prazo"
                ? "prazo vencido"
                : "escolhendo"}
        </span>
      </div>

      {/*
        O número primeiro: é o que ele abre a tela para ver.

        ── "DE 40" SAIU DAQUI (17/09/2026) ─────────────────────────────────

        Este total é o da GALERIA INTEIRA, e o limite é POR PESSOA — quem
        aplica é `alternarDaPessoa`, que conta as favoritas de quem está
        marcando. Escrever "90 de 40" juntava os dois números como se fossem a
        mesma conta e dizia ao fotógrafo que o combinado tinha estourado
        quando três pessoas escolheram 30 cada, dentro do combinado.

        O limite agora aparece onde ele de fato vale: ao lado de cada pessoa,
        logo abaixo. Aqui fica só o que este número é — a soma.
      */}
      <p className="mt-4 text-sm text-texto-soft">
        <strong className="text-texto">{total}</strong>{" "}
        {total === 1 ? "foto escolhida" : "fotos escolhidas"}
        {pessoas.length > 1 && <> por {pessoas.length} pessoas</>}
        {limite !== null && <> · até {limite} por pessoa</>}
        {motivo === "fechada" && fechadaEm && <> · encerrada em {dataBonita(fechadaEm)}</>}
      </p>

      {/*
        Só depois de encerrada é que a lista serve para editar: antes disso ela
        muda a cada clique do cliente, e copiar no meio da escolha leva um recorte
        que envelhece em minutos.
      */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copiar}
            className="rounded-lg border border-linha-forte px-3 py-1.5 text-sm transition hover:bg-carbon-2"
          >
            {copiado ? "copiado ✓" : "copiar os nomes dos arquivos"}
          </button>
          <button
            type="button"
            onClick={() => setMostrandoLista((v) => !v)}
            className="text-xs text-texto-faint underline-offset-2 hover:underline"
          >
            {mostrandoLista ? "esconder a lista" : "ver a lista"}
          </button>
          {aberta && (
            <span className="text-xs text-texto-faint">
              — o cliente ainda está escolhendo, a lista pode mudar
            </span>
          )}
        </div>
      )}

      {/*
        ── QUEM ESCOLHEU (15/09/2026, migração 033) ────────────────────────

        Antes a seleção era um número só, porque a lista era uma só. Agora cada
        pessoa tem a sua, e o total sem os nomes esconderia justamente o que o
        fotógrafo precisa para montar o álbum: se as 60 fotos são a escolha de
        uma pessoa ou a soma de duas listas de 30 que se sobrepõem.

        O e-mail aparece porque é o que identifica; o nome, quando foi dado,
        vem na frente porque é como o fotógrafo conhece a pessoa.
      */}
      {pessoas.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {pessoas.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft"
              /* Desde a migração 040 a pessoa pode ter só nome: quem baixa se
                 identifica com um dos dois, e a lista de escolhas é a mesma. */
              title={p.email ?? undefined}
            >
              <span className="font-medium text-texto">{p.nome || p.email}</span>
              {p.nome && p.email && <span className="ml-1.5 text-texto-faint">{p.email}</span>}
              {/* Com limite, a conta de cada uma é contra o limite DELA — que é
                  como o produto aplica, e o que o fotógrafo precisa saber para
                  cobrar o combinado. */}
              <span className="ml-2 text-texto-faint">
                {p.quantas} {p.quantas === 1 ? "foto" : "fotos"}
                {limite !== null && <> de {limite}</>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mostrandoLista && total > 0 && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-linha bg-void p-3 text-xs leading-relaxed text-texto-soft">
          {lista.map((l) => (l.capitulo ? `${l.nome}\t${l.capitulo}` : l.nome)).join("\n")}
        </pre>
      )}

      {/* Regras */}
      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-linha pt-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-texto-soft">Quantas fotos cada pessoa escolhe</span>
          <input
            type="number"
            min={1}
            defaultValue={limite ?? ""}
            placeholder="sem limite"
            id="selecao-limite"
            disabled={ocupado}
            className="w-36 rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-texto-soft">Até quando</span>
          <input
            type="date"
            defaultValue={prazo ? prazo.slice(0, 10) : ""}
            id="selecao-prazo"
            disabled={ocupado}
            className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
          />
        </label>

        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            const l = (document.getElementById("selecao-limite") as HTMLInputElement).value;
            const p = (document.getElementById("selecao-prazo") as HTMLInputElement).value;
            executar(salvarRegrasSelecaoAction, { limite: l, prazo: p });
          }}
          className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
        >
          Salvar
        </button>

        {!aberta && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => executar(reabrirSelecaoAction, {})}
            className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
          >
            Reabrir a escolha
          </button>
        )}
      </div>

      {/*
        ── ESTE PARÁGRAFO DIZIA O CONTRÁRIO DO CÓDIGO (17/09/2026) ─────────

        "O limite vale para a galeria inteira, não por pessoa" foi verdade até a
        migração 033. Desde então quem aplica é `alternarDaPessoa`, contra a
        contagem de quem está marcando: o limite é POR PESSOA.

        Felipe apontou o cartão dizendo que "ali está comunicando outro recado".
        Não era só redação: um fotógrafo que lesse isto combinaria 40 fotos com
        o casal achando que 40 era o teto da galeria, e receberia 120.
      */}
      <p className="mt-2 text-xs text-texto-faint">
        Deixe em branco para não limitar. O limite vale <strong>por pessoa</strong> — cada uma
        escolhe até esse número —, e baixar o limite nunca apaga escolha que já foi feita. Sem
        número e sem prazo, as favoritas ficam livres: ninguém encerra a lista, nem aparece
        &ldquo;Terminei minha escolha&rdquo; para o cliente.
      </p>

      {erro && <p className="mt-3 text-sm text-erro">{erro}</p>}
    </section>
  );
}
