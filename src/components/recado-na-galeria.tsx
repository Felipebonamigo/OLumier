"use client";

import { useState } from "react";
import { CONVITE_PADRAO, TETO_DO_RECADO } from "@/config/recado";

/**
 * O RECADO, NA TELA DO CASAL (migração 058).
 *
 * Juan, 01/10/2026: "clicando ali, as pessoas poderão adicionar um feedback por
 * escrito, ou preencher um formulário de 0 a 5 estrelas".
 *
 * ── A CARA É A DA GALERIA, NÃO A NOSSA ────────────────────────────────────
 *
 * Tudo aqui sai dos tokens `--g-*` que a galeria já emite (ver `variaveisDoTema`
 * e `variaveisDeForma`). É a mesma correção que a tela da senha recebeu em
 * 30/09/2026 — "o design da página que coloca a senha tem que seguir o padrão
 * escolhido pra galeria" —, e é a regra do produto: a marca do fotógrafo fica na
 * frente.
 *
 * ── A IDENTIFICAÇÃO VEM ANTES, E É A MESMA DO RESTO ───────────────────────
 *
 * Recado anônimo seria uma linha que o fotógrafo não pode responder. Quem já se
 * identificou para favoritar ou baixar não é perguntado de novo: a identidade é
 * a mesma (`pessoas_da_galeria`), e quem pergunta é o pai, que já tem o estado.
 */
/**
 * A RESPOSTA AO PONTEIRO desta tela.
 *
 * Felipe, 03/10/2026: "tem que ter um hover ou algo assim (…) e o mesmo para o
 * pop up dele". A tela inteira tinha ZERO estados de hover — nem o botão de
 * enviar, nem as estrelas, que são justamente o que se usa com o ponteiro
 * parado em cima, decidindo a nota.
 *
 * O véu sai da própria cor do texto da galeria, como na grade: num tema claro um
 * véu escuro some, num escuro um véu claro estoura. `active:` vem junto porque
 * no celular não há hover — e é o toque que precisa de retorno.
 */
const RESPONDE =
  "transition hover:bg-[color-mix(in_srgb,var(--g-texto)_10%,transparent)] " +
  "active:bg-[color-mix(in_srgb,var(--g-texto)_16%,transparent)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-[var(--g-texto)]";

export function RecadoNaGaleria({
  convite,
  escrito,
  estrelas,
  perguntas,
  fonteTitulo,
  fonteTexto,
  identificado,
  identificar,
  mandar,
  aoFechar,
}: {
  convite: string;
  /** Pedir texto escrito. Desligado, a tela tem só as estrelas. */
  escrito: boolean;
  estrelas: boolean;
  perguntas: string[];
  /* As famílias vêm prontas de quem desenha a galeria: elas saem de
     `FONTES_TITULO`/`FONTES_TEXTO` e não de variável CSS — ver `portao.tsx`,
     que teve de aprender a mesma coisa em 30/09/2026. */
  fonteTitulo: string;
  fonteTexto: string;
  identificado: boolean;
  /** Devolve a mensagem de erro, ou null quando deu certo. */
  identificar: (dados: { nome: string; email: string }) => Promise<string | null>;
  /** Devolve a mensagem de erro, ou null quando gravou. */
  mandar: (dados: {
    texto: string;
    notas: Record<string, number>;
    autoriza: boolean;
  }) => Promise<string | null>;
  aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [texto, setTexto] = useState("");
  const [notas, setNotas] = useState<Record<string, number>>({});
  const [autoriza, setAutoriza] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function enviar() {
    if (ocupado) return;
    setErro("");
    if (!identificado) {
      if (!nome.trim() && !email.trim()) {
        setErro("Escreva o seu nome ou o seu e-mail.");
        return;
      }
      setOcupado(true);
      const falha = await identificar({ nome: nome.trim(), email: email.trim() });
      if (falha) {
        setErro(falha);
        setOcupado(false);
        return;
      }
      setOcupado(false);
    }
    if (!texto.trim() && Object.keys(notas).length === 0) {
      setErro("Escreva algo ou dê uma nota.");
      return;
    }
    setOcupado(true);
    const falha = await mandar({ texto: texto.trim(), notas, autoriza });
    setOcupado(false);
    if (falha) {
      setErro(falha);
      return;
    }
    setPronto(true);
  }

  const campo = {
    background: "color-mix(in srgb, var(--g-texto) 6%, transparent)",
    border: "1px solid var(--g-linha)",
    color: "var(--g-texto)",
    /* O acabamento sai do mesmo eixo que arredonda as fotos e os botões da
       galeria: reto escolhido na capa tem de ser reto aqui também. */
    borderRadius: "var(--g-pilula, 9999px)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deixar um recado"
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "color-mix(in srgb, var(--g-fundo) 82%, transparent)" }}
      onClick={(e) => {
        /* Clicar fora fecha — mas só o fundo, nunca um clique que nasceu dentro
           do cartão e subiu até aqui. */
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        className="w-full max-w-lg p-6 sm:p-8"
        style={{
          background: "var(--g-fundo)",
          border: "1px solid var(--g-linha)",
          borderRadius: "var(--g-canto, 12px)",
          color: "var(--g-texto)",
          fontFamily: fonteTexto,
        }}
      >
        {pronto ? (
          <>
            <p className="text-lg" style={{ fontFamily: fonteTitulo }}>
              Recado enviado.
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--g-suave)" }}>
              Obrigado — só o fotógrafo vai ler.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={aoFechar}
                className={`px-5 py-2.5 text-sm ${RESPONDE}`}
                style={campo}
              >
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg leading-snug" style={{ fontFamily: fonteTitulo }}>
              {convite || CONVITE_PADRAO}
            </p>

            {!identificado && (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value.slice(0, 80))}
                  placeholder="Seu nome"
                  aria-label="Seu nome"
                  className="w-full px-3 py-2.5 text-sm outline-none"
                  style={campo}
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value.slice(0, 160))}
                  placeholder="Seu e-mail (opcional)"
                  aria-label="Seu e-mail"
                  type="email"
                  className="w-full px-3 py-2.5 text-sm outline-none"
                  style={campo}
                />
              </div>
            )}

            {estrelas && perguntas.length > 0 && (
              <ul className="mt-5 space-y-3">
                {perguntas.map((q) => (
                  <li key={q}>
                    <span className="block text-sm" style={{ color: "var(--g-suave)" }}>
                      {q}
                    </span>
                    <Estrelas
                      valor={notas[q] ?? 0}
                      mudar={(n) => setNotas((atual) => ({ ...atual, [q]: n }))}
                      rotulo={q}
                    />
                  </li>
                ))}
              </ul>
            )}

            {escrito && (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, TETO_DO_RECADO))}
              maxLength={TETO_DO_RECADO}
              rows={4}
              placeholder="Escreva aqui (opcional)"
              aria-label="Seu recado"
              className="mt-5 w-full resize-none px-3 py-2.5 text-sm outline-none"
              style={campo}
            />
            )}

            {/*
              A AUTORIZAÇÃO, pedida AGORA e nunca depois.
              Começa desmarcada: autorização que vem marcada não é autorização.
            */}
            {escrito && (
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={autoriza}
                onChange={(e) => setAutoriza(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span style={{ color: "var(--g-suave)" }}>
                O fotógrafo pode usar o que eu escrevi como depoimento no site dele.
              </span>
            </label>
            )}

            {erro && (
              <p role="alert" className="mt-3 text-sm" style={{ color: "var(--g-texto)" }}>
                {erro}
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={aoFechar}
                className={`rounded-[var(--g-pilula,9999px)] px-4 py-2.5 text-sm ${RESPONDE} hover:text-[var(--g-texto)]`}
                style={{ color: "var(--g-tenue)" }}
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={ocupado}
                /* Cheio de `--g-texto`: um véu da mesma cor não mudaria nada
                   aqui. O retorno é o próprio botão recuando de intensidade. */
                className="px-5 py-2.5 text-sm transition hover:opacity-85 active:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-texto)] disabled:opacity-60"
                style={{
                  ...campo,
                  background: "var(--g-texto)",
                  color: "var(--g-fundo)",
                  borderColor: "var(--g-texto)",
                }}
              >
                {ocupado ? "enviando…" : "Enviar recado"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Cinco estrelas, de 1 a 5 — e a nota 0 existe clicando na estrela já marcada.
 *
 * Botões de verdade, um por nota, e não um `range`: no celular um controle de
 * arrastar com cinco passos erra o passo o tempo todo, e com teclado a estrela é
 * alcançável por tabulação sem ninguém precisar saber que é um campo.
 */
function Estrelas({
  valor,
  mudar,
  rotulo,
}: {
  valor: number;
  mudar: (n: number) => void;
  rotulo: string;
}) {
  return (
    <div className="mt-1 flex gap-1" role="group" aria-label={rotulo}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} de 5`}
          aria-pressed={valor >= n}
          onClick={() => mudar(valor === n ? 0 : n)}
          /* A estrela cresce um pouco sob o ponteiro: é o que diz QUAL delas
             vai ser marcada antes do clique. Sem isso, dar nota é adivinhar. */
          className="rounded px-0.5 text-xl leading-none transition hover:scale-125 active:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-texto)]"
          style={{ color: valor >= n ? "var(--g-texto)" : "var(--g-tenue)" }}
        >
          ★
        </button>
      ))}
    </div>
  );
}
