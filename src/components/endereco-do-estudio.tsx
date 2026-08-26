"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reclamarDominioAction,
  verificarDominioAction,
  soltarDominioAction,
  type EstadoDominio,
} from "@/app/painel/site/actions";

/**
 * Um valor de DNS com o botão de copiar do lado.
 *
 * MORA FORA do `EnderecoDoEstudio` de propósito. Declarado lá dentro, era um
 * tipo de componente NOVO a cada render: o React não atualizava, desmontava e
 * remontava. Aqui isso apagava a rolagem horizontal de quem tinha arrastado o
 * `<code>` para ler o fim de um token longo, e reiniciava a transição do botão
 * — justamente enquanto a pessoa copia um valor de cada vez para o painel de
 * DNS, que é o único momento em que esta tela é usada.
 *
 * O `eslint` acusava três vezes ("Cannot create components during render") e
 * estava certo. Corrigido em 26/08/2026.
 */
function Valor({
  rotulo,
  valor,
  qual,
  copiado,
  aoCopiar,
}: {
  rotulo: string;
  valor: string;
  qual: string;
  /** Qual campo acabou de ser copiado, para o botão dizer "copiado ✓". */
  copiado: string | null;
  aoCopiar: (valor: string, qual: string) => void;
}) {
  return (
    <div className="mt-2">
      <span className="block text-xs text-texto-faint">{rotulo}</span>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto">
          {valor}
        </code>
        <button
          type="button"
          onClick={() => aoCopiar(valor, qual)}
          className="shrink-0 rounded-lg border border-linha-forte px-3 py-2 text-xs transition hover:bg-carbon-2"
        >
          {copiado === qual ? "copiado ✓" : "copiar"}
        </button>
      </div>
    </div>
  );
}

/**
 * O endereço próprio do estúdio — `carolinetedesco.com.br` no lugar do nosso.
 *
 * ── QUEM VAI LER ISTO NÃO SABE O QUE É CNAME ──────────────────────────────
 * E não precisa saber. O texto de cada passo importa mais que o layout: o
 * fotógrafo vai sair daqui, abrir o painel do Registro.br ou da Hostinger, e
 * tentar achar onde colar. Se ele errar, o certificado não sai e ele volta
 * achando que o produto está quebrado.
 *
 * Por isso são três estados bem separados, um pedido de cada vez, e cada valor
 * tem seu botão de copiar. Nada de "adicione um registro TXT e depois um A" na
 * mesma tela: são dois momentos, e o segundo só faz sentido depois do primeiro.
 */
export function EnderecoDoEstudio({
  dominio,
  verificado,
  registroNome,
  registroValor,
  ipDoServidor,
  enderecoDaPlataforma,
}: {
  dominio: string | null;
  verificado: boolean;
  registroNome: string | null;
  registroValor: string | null;
  /** Para onde o A record aponta. Vazio quando não configurado no ambiente. */
  ipDoServidor: string | null;
  enderecoDaPlataforma: string;
}) {
  const [estado, setEstado] = useState<EstadoDominio>({});
  const [copiado, setCopiado] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const rodar = (acao: () => Promise<EstadoDominio>) =>
    iniciar(async () => {
      setEstado(await acao());
      router.refresh();
    });

  const copiar = async (valor: string, qual: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(qual);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* Área de transferência bloqueada. O valor está na tela em texto
       * selecionável — dá para copiar à mão, e um alerta aqui só assustaria. */
    }
  };

  return (
    <section className="mt-10 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Endereço do site</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Hoje suas galerias abrem em{" "}
            <code className="text-texto-soft">{enderecoDaPlataforma}</code>. Se você já tem um
            domínio, pode usar o seu.
          </p>
        </div>
        {dominio && (
          <span
            className={`rounded-full border px-2.5 py-1 text-xs ${
              verificado ? "border-ok/40 bg-ok/10 text-ok" : "border-linha text-texto-faint"
            }`}
          >
            {verificado ? "confirmado" : "aguardando confirmação"}
          </span>
        )}
      </div>

      {/* ── 1. sem domínio ─────────────────────────────────────────────── */}
      {!dominio && (
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          action={(f) => rodar(() => reclamarDominioAction(f))}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-texto-soft">Seu domínio</span>
            <input
              name="dominio"
              placeholder="seuestudio.com.br"
              disabled={ocupado}
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm focus:border-acento focus:outline-none disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={ocupado}
            className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
          >
            Usar este endereço
          </button>
          <p className="w-full text-xs text-texto-faint">
            Precisa ser um domínio que você já comprou. Nós não vendemos domínio — e não cobramos
            nada a mais por usar o seu.
          </p>
        </form>
      )}

      {/* ── 2. pedido, aguardando a prova ──────────────────────────────── */}
      {dominio && !verificado && registroNome && registroValor && (
        <div className="mt-5">
          <p className="text-sm text-texto-soft">
            Para confirmar que <strong className="text-texto">{dominio}</strong> é seu, crie este
            registro <strong className="text-texto">TXT</strong> no painel onde você comprou o
            domínio:
          </p>

          <Valor
            rotulo="Nome (ou host)"
            valor={registroNome}
            qual="txt-nome"
            copiado={copiado}
            aoCopiar={copiar}
          />
          <Valor
            rotulo="Valor"
            valor={registroValor}
            qual="txt-valor"
            copiado={copiado}
            aoCopiar={copiar}
          />

          <p className="mt-3 text-xs text-texto-faint">
            Alguns provedores pedem só a primeira parte do nome, sem o seu domínio no fim. Depois de
            salvar, pode levar de alguns minutos a algumas horas para aparecer — isso é normal e não
            depende de nós.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => rodar(verificarDominioAction)}
              className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
            >
              {ocupado ? "Conferindo…" : "Já criei, conferir agora"}
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => rodar(soltarDominioAction)}
              className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── 3. confirmado, falta apontar ───────────────────────────────── */}
      {dominio && verificado && (
        <div className="mt-5">
          <p className="text-sm text-texto-soft">
            <strong className="text-texto">{dominio}</strong> é seu, confirmado. O último passo é
            apontar o domínio para cá:
          </p>

          {ipDoServidor ? (
            <>
              <Valor
                rotulo="Tipo A · nome “@” · valor"
                valor={ipDoServidor}
                qual="a-valor"
                copiado={copiado}
                aoCopiar={copiar}
              />
              <p className="mt-3 text-xs text-texto-faint">
                Se já existir um registro A no “@”, troque o valor dele em vez de criar outro. O
                certificado de segurança (o cadeado) sai sozinho na primeira visita — você não
                precisa fazer nada, e não custa nada.
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs text-alerta">
              O endereço do servidor não está configurado nesta instalação. Fale com o suporte antes
              de apontar o DNS.
            </p>
          )}

          <div className="mt-4">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => rodar(soltarDominioAction)}
              className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
            >
              Parar de usar este endereço
            </button>
            <p className="mt-2 text-xs text-texto-faint">
              Suas galerias voltam para <code>{enderecoDaPlataforma}</code>. Nada é apagado — mas os
              links que você já entregou com o seu domínio param de abrir.
            </p>
          </div>
        </div>
      )}

      {estado.erro && <p className="mt-4 text-sm text-erro">{estado.erro}</p>}
      {estado.ok && <p className="mt-4 text-sm text-ok">{estado.ok}</p>}
    </section>
  );
}
