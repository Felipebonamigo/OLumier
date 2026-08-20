"use client";

import { useEffect } from "react";
import { marca } from "@/config/marca";

/**
 * Tela de erro do app.
 *
 * Sem este arquivo, uma exceção no servidor cai na tela crua do Next — fundo
 * branco, texto em inglês, e em produção só um código de digest. Para o casal
 * que abriu o link da galeria isso parece o site ter sumido.
 *
 * O que ela NÃO faz: mostrar a mensagem do erro. Exceção de banco costuma
 * carregar host, usuário e trecho de SQL, e esta página é pública.
 */
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // O servidor já registrou; isto é para o erro aparecer no console do
    // navegador quando alguém estiver depurando junto.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <h1 className="font-serif text-2xl font-bold">Alguma coisa saiu do lugar</h1>
      <p className="mt-3 text-sm text-texto-soft">
        O problema é aqui do nosso lado, não é você. Tente de novo em alguns instantes.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-luz px-5 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta"
        >
          Tentar de novo
        </button>
        <a href="/" className="text-sm text-texto-soft underline underline-offset-4 hover:text-texto">
          Ir para o início
        </a>
      </div>

      {/* O digest é o que liga esta tela à linha no log do servidor. Sem ele,
          "deu erro" é impossível de investigar. */}
      {error.digest && (
        <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-texto-faint">
          código {error.digest}
        </p>
      )}

      <p className="mt-2 text-xs text-texto-faint">
        Se continuar, fale com {marca.email}
      </p>
    </main>
  );
}
