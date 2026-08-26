"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  criarChaveApiAction,
  revogarChaveApiAction,
  type EstadoChave,
} from "@/app/painel/actions";
import { Campo, Erro, BotaoEnviar } from "@/components/form-ui";

export interface ChaveNaTela {
  id: string;
  nome: string;
  prefixo: string;
  escopo: string;
  criada_em: string;
  ultimo_uso_em: string | null;
}

function Botao() {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>Criar chave</BotaoEnviar>;
}

const data = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : null;

/**
 * Chaves de API do estúdio.
 *
 * Fica fechado por padrão, como a troca de senha: é raro, e um botão de criar
 * credencial sempre aberto convida a criar chave que ninguém vai usar — e chave
 * esquecida é chave que continua valendo depois de vazar.
 *
 * ── O SEGREDO APARECE UMA VEZ ──────────────────────────────────────────────
 * O banco guarda só o hash, então não existe "ver de novo". A tela precisa
 * dizer isso ANTES, não depois: quem fecha a caixa sem copiar perde a chave e
 * tem de revogar e criar outra. Ver docs/chave-de-api.md.
 */
export function ChavesApi({ chaves }: { chaves: ChaveNaTela[] }) {
  const [aberto, setAberto] = useState(false);
  const [estado, action] = useActionState<EstadoChave, FormData>(criarChaveApiAction, {});
  const [copiado, setCopiado] = useState(false);

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Chaves de API</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Para programas que publicam na sua conta sem abrir o navegador.
          </p>
        </div>
        {!aberto && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:border-linha-forte hover:text-texto"
          >
            Criar chave
          </button>
        )}
      </div>

      {/* O segredo, uma vez só. */}
      {estado.segredo && (
        <div className="mt-4 rounded-lg border border-acento/40 bg-acento/5 p-4">
          <p className="text-xs font-medium text-acento-alto">
            Copie agora — esta chave não aparece de novo.
          </p>
          <code className="mt-2 block break-all rounded bg-void/60 px-3 py-2 font-mono text-xs">
            {estado.segredo}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(estado.segredo!).then(
                () => setCopiado(true),
                /* Sem área de transferência (contexto não seguro, permissão
                 * negada): o segredo continua na tela para copiar à mão. Só o
                 * aviso de "copiado" é que não pode mentir. */
                () => setCopiado(false),
              );
            }}
            className="mt-2 text-xs text-texto-soft underline hover:text-texto"
          >
            {copiado ? "copiado ✓" : "copiar"}
          </button>
        </div>
      )}

      {aberto && (
        <form action={action} className="mt-4 flex flex-col gap-3 border-t border-linha pt-4">
          <Campo
            label="Nome"
            name="nome"
            required
            placeholder="Lightroom do notebook"
            dica="Só para você saber qual revogar depois."
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-texto-soft">O que ela pode fazer</span>
            <select
              name="escopo"
              defaultValue="envio"
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm"
            >
              <option value="envio">Enviar — criar galeria, subir e substituir arquivo</option>
              <option value="leitura">Só ler — listar galerias, sem escrever nada</option>
            </select>
            <span className="text-xs text-texto-faint">
              Nenhuma das duas apaga galeria nem mexe na sua conta.
            </span>
          </label>
          <Erro mensagem={estado.erro} />
          <div className="flex items-center gap-3">
            <Botao />
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-xs text-texto-soft underline hover:text-texto"
            >
              cancelar
            </button>
          </div>
        </form>
      )}

      {chaves.length > 0 ? (
        <ul className="mt-4 divide-y divide-linha border-t border-linha">
          {chaves.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.nome}</p>
                <p className="text-xs text-texto-faint">
                  <code className="font-mono">{c.prefixo}…</code>
                  {" · "}
                  {c.escopo === "leitura" ? "só leitura" : "envio"}
                  {" · "}
                  {c.ultimo_uso_em
                    ? `usada em ${data(c.ultimo_uso_em)}`
                    : "nunca usada"}
                </p>
              </div>
              <form action={revogarChaveApiAction}>
                <input type="hidden" name="chave_id" value={c.id} />
                <button
                  type="submit"
                  className="text-xs text-texto-soft underline transition hover:text-erro"
                >
                  revogar
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        !aberto && (
          <p className="mt-4 text-xs text-texto-faint">
            Nenhuma chave. Você só precisa de uma se for publicar por fora do painel.
          </p>
        )
      )}
    </section>
  );
}
