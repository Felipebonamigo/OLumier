"use client";

import { useState, useTransition } from "react";
import { agendarEmailsAction, cancelarEmailsAction, salvarEmailConfigAction } from "@/app/painel/actions";
import {
  TEMPLATES,
  TIPOS,
  type TemplateDeEmail,
  type TipoDeEmail,
} from "@/config/email-da-galeria";

/**
 * AVISAR O CLIENTE POR E-MAIL (migração 059).
 *
 * Juan, 01/10/2026: "estruturar um sistema de entrega de galeria, notificando
 * por email (…) templates prontos (…) emails sendo enviados 03 meses depois,
 * pedindo feedback. 06 meses depois do evento (…) 12 meses depois do evento
 * também (…) E também um email enviado no próprio dia do casamento."
 *
 * ── A TELA MOSTRA O CALENDÁRIO ANTES DE QUALQUER COISA SAIR ───────────────
 *
 * Porque ela está prometendo mandar e-mail para o cliente de outra pessoa, em
 * datas que o fotógrafo não escolheu uma por uma. Ver a lista agendada abaixo do
 * botão: é o que vai sair, para quem, e quando. Nada aqui manda nada na hora —
 * quem manda é o script diário.
 */
export function AvisarPorEmail({
  galeriaId,
  publicada,
  temDataDeEvento,
  clienteSugerido = "",
  config,
  agendados,
}: {
  galeriaId: string;
  publicada: boolean;
  /** Sem data de evento, três dos cinco lembretes não têm de onde contar. */
  temDataDeEvento: boolean;
  /**
   * O cliente que veio do contrato do Atomatiza, já na forma
   * `Nome <email@exemplo.com>` (migração 061). Vazio na galeria que não veio da
   * ponte — que é o estado de quase toda galeria.
   */
  clienteSugerido?: string;
  config: { lembretes: boolean; template: TemplateDeEmail; mensagem: string };
  agendados: {
    id: string;
    tipo: TipoDeEmail;
    para: string;
    nome: string | null;
    quando: string;
    enviado: string | null;
    erro: string | null;
  }[];
}) {
  const [lembretes, setLembretes] = useState(config.lembretes);
  const [template, setTemplate] = useState(config.template);
  const [mensagem, setMensagem] = useState(config.mensagem);
  /*
   * A caixa nasce com o cliente do contrato. Depois do primeiro envio ela
   * esvazia (o `setDestinatarios("")` do sucesso) e NÃO volta a sugerir: quem já
   * pôs o casal na fila não precisa do nome de volta no campo, e a lista "na
   * fila" logo abaixo já mostra quem está lá.
   */
  const [destinatarios, setDestinatarios] = useState(clienteSugerido);
  const [recado, setRecado] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, iniciar] = useTransition();

  function gravarConfig(mudanca: {
    lembretes?: boolean;
    template?: TemplateDeEmail;
    mensagem?: string;
  }) {
    const novo = { lembretes, template, mensagem, ...mudanca };
    setErro("");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("lembretes", novo.lembretes ? "1" : "0");
      f.set("template", novo.template);
      f.set("mensagem", novo.mensagem);
      const r = await salvarEmailConfigAction(f);
      if (r.erro) setErro(r.erro);
    });
  }

  function agendar() {
    setErro("");
    setRecado("");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("destinatarios", destinatarios);
      const r = await agendarEmailsAction(f);
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      setDestinatarios("");
      setRecado(
        r.agendados === 0
          ? "Esses endereços já estavam na fila."
          : `${r.agendados} e-mail(is) na fila. O primeiro sai na próxima rodada diária.`,
      );
    });
  }

  function cancelar() {
    setErro("");
    setRecado("");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      const r = await cancelarEmailsAction(f);
      if (r.erro) setErro(r.erro);
      else setRecado(`${r.cancelados} e-mail(is) pendentes cancelados.`);
    });
  }

  const pendentes = agendados.filter((a) => !a.enviado);

  return (
    <section className="mt-12 border-t border-linha pt-6">
      <h2 className="text-sm font-semibold">Avisar o cliente por e-mail</h2>
      <p className="mt-1 text-xs text-texto-faint">
        O e-mail de entrega sai quando você manda. Os lembretes, se você ligar, saem sozinhos nas
        datas abaixo.
      </p>

      {!publicada && (
        <p className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-xs text-alerta">
          Publique a galeria antes de avisar o cliente: o link iria para ele e abriria uma página de
          erro.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-texto-soft" htmlFor="email-destinatarios">
            Para quem
          </label>
          <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
            Um por linha. Pode ser <code>Ana &lt;ana@exemplo.com&gt;</code> para o e-mail chamar a
            pessoa pelo nome.
          </p>
          <textarea
            id="email-destinatarios"
            value={destinatarios}
            onChange={(e) => setDestinatarios(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder={"Ana <ana@exemplo.com>\ndavi@exemplo.com"}
            className="mt-2 w-full resize-none rounded-lg border border-linha bg-void px-3 py-2 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
          />
          <button
            type="button"
            disabled={ocupado || !publicada}
            onClick={agendar}
            className="mt-2 rounded-lg border border-acento bg-acento/10 px-3.5 py-2 text-xs font-medium transition hover:bg-acento/20 disabled:opacity-50"
          >
            {ocupado ? "gravando…" : "Pôr na fila"}
          </button>
        </div>

        <div>
          <span className="block text-xs font-medium text-texto-soft">Desenho do e-mail</span>
          <ul className="mt-2 space-y-1.5">
            {TEMPLATES.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="radio"
                    name="template-do-email"
                    checked={template === t.id}
                    onChange={() => {
                      setTemplate(t.id);
                      gravarConfig({ template: t.id });
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--acento)]"
                  />
                  <span>
                    <span className="block text-sm">{t.nome}</span>
                    <span className="block text-[11px] leading-snug text-texto-faint">{t.desc}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-texto-soft" htmlFor="email-mensagem">
          Sua mensagem no e-mail de entrega
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
          Vazio usa o texto pronto. Vale só para o e-mail de entrega — os lembretes têm texto
          próprio.
        </p>
        <textarea
          id="email-mensagem"
          value={mensagem}
          onChange={(e) => setMensagem(e.target.value.slice(0, 600))}
          onBlur={() => gravarConfig({})}
          maxLength={600}
          rows={2}
          placeholder="Foi um prazer fotografar esse dia. Qualquer coisa, me chama."
          className="mt-2 w-full resize-none rounded-lg border border-linha bg-void px-3 py-2 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
        />
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={lembretes}
          onChange={(e) => {
            setLembretes(e.target.checked);
            gravarConfig({ lembretes: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--acento)]"
        />
        <span>
          <span className="block text-sm font-medium">Mandar os lembretes também</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-texto-faint">
            Pedir recado três meses depois da entrega, relembrar seis meses depois do evento e avisar
            na véspera de um ano.
            {!temDataDeEvento && " Sem a data do evento cadastrada, só o pedido de recado existe."}
          </span>
        </span>
      </label>

      <ul className="mt-4 space-y-1">
        {TIPOS.map((t) => (
          <li key={t.id} className="text-[11px] leading-snug text-texto-faint">
            <strong className="font-medium text-texto-soft">{t.nome}</strong> — {t.desc}
          </li>
        ))}
      </ul>

      {(erro || recado) && (
        <p role="status" className={`mt-3 text-xs ${erro ? "text-alerta" : "text-texto-faint"}`}>
          {erro || recado}
        </p>
      )}

      {agendados.length > 0 && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-texto-soft">Na fila</span>
            {pendentes.length > 0 && (
              <button
                type="button"
                disabled={ocupado}
                onClick={cancelar}
                className="text-[11px] text-texto-faint underline underline-offset-4 transition hover:text-alerta disabled:opacity-50"
              >
                cancelar os {pendentes.length} pendentes
              </button>
            )}
          </div>
          <ul className="mt-2 divide-y divide-linha rounded-lg border border-linha">
            {agendados.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="text-xs text-texto-soft">
                  {TIPOS.find((t) => t.id === a.tipo)?.nome ?? a.tipo}
                </span>
                <span className="text-[11px] text-texto-faint">
                  {a.nome ? `${a.nome} · ` : ""}
                  {a.para}
                </span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-texto-faint">
                  {a.enviado ? `enviado ${a.enviado}` : a.quando}
                </span>
                {a.erro && (
                  <span className="w-full text-[11px] text-alerta">{a.erro}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
