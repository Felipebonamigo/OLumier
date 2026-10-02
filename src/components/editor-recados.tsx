"use client";

import { useState, useTransition } from "react";
import { salvarRecadoConfigAction } from "@/app/painel/actions";
import { CONVITE_PADRAO, MAX_PERGUNTAS, TETO_DA_PERGUNTA, TETO_DO_CONVITE } from "@/config/recado";

/**
 * A configuração CRUA, e não a que a galeria pública usa.
 *
 * `configDoRecado` junta regras ("estrelas sem pergunta não liga nada", "convite
 * vazio usa o padrão") e por isso perde a informação de que esta tela precisa:
 * o que o fotógrafo marcou. Um interruptor que mostra o resultado da regra em
 * vez da escolha dele pisca sozinho quando ele apaga a última pergunta.
 */
export interface ConfigCruaDoRecado {
  ativo: boolean;
  estrelas: boolean;
  convite: string;
  perguntas: string[];
}

/**
 * A ÁREA DE RECADOS, como o fotógrafo a monta.
 *
 * Juan, 01/10/2026: "preencher um formulário de 0 a 5 estrelas, montado e
 * organizado lá na área de feedbacks da organização da galeria".
 *
 * Os dois interruptores são separados porque são coisas diferentes: a NOTA ajuda
 * o fotógrafo a melhorar, a FRASE é o que ele mostra para vender. O Juan escreveu
 * "ou"; quem quer as duas liga as duas.
 *
 * Grava sozinho, a cada mudança — como a aparência. E por isso avisa quando não
 * consegue: salvamento automático que falha em silêncio é o fotógrafo achando
 * que ligou e o casal não vendo nada.
 */
export function EditorRecados({
  galeriaId,
  config,
}: {
  galeriaId: string;
  config: ConfigCruaDoRecado;
}) {
  const [ativo, setAtivo] = useState(config.ativo);
  const [estrelas, setEstrelas] = useState(config.estrelas);
  /* O convite vem vazio quando ele não escreveu nada: o texto do produto é o
     `placeholder`, e assim o campo não mente dizendo que ele escreveu aquilo. */
  const [convite, setConvite] = useState(config.convite);
  const [perguntas, setPerguntas] = useState<string[]>(config.perguntas);
  const [erro, setErro] = useState("");
  const [estado, setEstado] = useState<"" | "gravando" | "ok">("");
  const [, iniciar] = useTransition();

  function gravar(mudanca: {
    ativo?: boolean;
    estrelas?: boolean;
    convite?: string;
    perguntas?: string[];
  }) {
    const novo = { ativo, estrelas, convite, perguntas, ...mudanca };
    setErro("");
    setEstado("gravando");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("ativo", novo.ativo ? "1" : "0");
      f.set("estrelas", novo.estrelas ? "1" : "0");
      f.set("convite", novo.convite);
      f.set("perguntas", JSON.stringify(novo.perguntas.map((q) => q.trim()).filter(Boolean)));
      const r = await salvarRecadoConfigAction(f);
      if (r.erro) {
        setErro(r.erro);
        setEstado("");
        /* O que o servidor recusou não fica na tela como se tivesse valido. */
        setEstrelas(estrelas);
        return;
      }
      setEstado("ok");
    });
  }

  const mudarPergunta = (i: number, valor: string) => {
    const lista = perguntas.map((q, k) => (k === i ? valor.slice(0, TETO_DA_PERGUNTA) : q));
    setPerguntas(lista);
    return lista;
  };

  return (
    <div className="space-y-5">
      <Chave
        ligado={ativo}
        titulo="Pedir um recado escrito"
        desc="O casal escreve, com as palavras dele, o que achou da entrega."
        mudar={(v) => {
          setAtivo(v);
          gravar({ ativo: v });
        }}
      />

      <div>
        <label className="block text-xs font-medium text-texto-soft" htmlFor="convite-do-recado">
          O convite que o casal lê
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
          Vazio usa o texto padrão: “{CONVITE_PADRAO}”
        </p>
        <textarea
          id="convite-do-recado"
          value={convite}
          onChange={(e) => setConvite(e.target.value.slice(0, TETO_DO_CONVITE))}
          onBlur={() => gravar({})}
          maxLength={TETO_DO_CONVITE}
          rows={2}
          placeholder={CONVITE_PADRAO}
          className="mt-2 w-full resize-none rounded-lg border border-linha bg-void px-3 py-2 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
        />
      </div>

      <Chave
        ligado={estrelas}
        titulo="Pedir notas de 0 a 5"
        desc="Uma linha de estrelas por pergunta sua. Precisa de pelo menos uma pergunta."
        mudar={(v) => {
          setEstrelas(v);
          gravar({ estrelas: v });
        }}
      />

      <div>
        <span className="block text-xs font-medium text-texto-soft">Suas perguntas</span>
        <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
          Até {MAX_PERGUNTAS}. Cada uma ganha uma linha de cinco estrelas na galeria.
        </p>
        <ul className="mt-2 space-y-2">
          {perguntas.map((q, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => mudarPergunta(i, e.target.value)}
                onBlur={() => gravar({})}
                maxLength={TETO_DA_PERGUNTA}
                aria-label={`Pergunta ${i + 1}`}
                placeholder="Como foi o atendimento?"
                className="w-full rounded-md border border-linha bg-void px-2.5 py-1.5 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const lista = perguntas.filter((_, k) => k !== i);
                  setPerguntas(lista);
                  gravar({ perguntas: lista });
                }}
                aria-label={`Tirar a pergunta ${i + 1}`}
                className="shrink-0 rounded-md border border-linha px-2 py-1.5 text-[11px] text-texto-faint transition hover:border-alerta hover:text-alerta"
              >
                tirar
              </button>
            </li>
          ))}
        </ul>
        {perguntas.length < MAX_PERGUNTAS && (
          <button
            type="button"
            onClick={() => setPerguntas([...perguntas, ""])}
            className="mt-2 rounded-md border border-linha px-2.5 py-1.5 text-xs transition hover:border-acento"
          >
            Acrescentar pergunta
          </button>
        )}
      </div>

      <p role="status" className={`text-[11px] ${erro ? "text-alerta" : "text-texto-faint"}`}>
        {erro || (estado === "gravando" ? "gravando…" : estado === "ok" ? "gravado" : "")}
      </p>
    </div>
  );
}

/** Um interruptor com nome e explicação — o molde dos controles de entrega. */
function Chave({
  ligado,
  titulo,
  desc,
  mudar,
}: {
  ligado: boolean;
  titulo: string;
  desc: string;
  mudar: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={ligado}
        onChange={(e) => mudar(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--acento)]"
      />
      <span>
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-texto-faint">{desc}</span>
      </span>
    </label>
  );
}
