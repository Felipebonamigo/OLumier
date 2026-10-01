"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { entrarNaGaleriaAction, type EstadoSenha } from "./actions";
import {
  FONTES_TEXTO,
  FONTES_TITULO,
  variaveisDeForma,
  variaveisDoTema,
  type Aparencia,
} from "@/config/aparencia";

/**
 * A TELA DA SENHA — com a cara da galeria, e não a da plataforma.
 *
 * ── O PEDIDO (01/10/2026) ─────────────────────────────────────────────────
 *
 * Juan, com um print do portão de uma galeria da VicenteFilms: "o design dessa
 * tela pré não segue o da galeria?". Felipe: "o design da página que coloca a
 * senha tem que seguir o padrão do design bonito/escolhido pra galeria. Tá
 * ficando de outro jeito".
 *
 * Estava. Esta tela desenhava com os tokens da PLATAFORMA — o fundo do painel,
 * a serifada do produto, o âmbar do botão. O fotógrafo escolhe capa, tema, duas
 * fontes, cor e acabamento, e a PRIMEIRA tela que o casal vê ignorava tudo.
 *
 * É o lugar onde o princípio da marca mais vale, e onde ele estava mais
 * quebrado: "a Galeria Átomo fica por trás, a marca do fotógrafo fica na
 * frente" (`docs/estrategia-de-marca.md`). O casal chega aqui antes de qualquer
 * outra coisa.
 *
 * ── O QUE ELA NÃO GANHOU JUNTO ───────────────────────────────────────────
 *
 * A FOTO. Design é do fotógrafo e não conta nada sobre o casamento; foto é o
 * conteúdo que a senha existe para proteger. Vestir o portão com a aparência
 * não pode virar uma brecha para ver a capa sem a senha —
 * `testar-portao-com-a-cara-da-galeria.mjs` confere que nenhuma chave de mídia
 * e nenhuma URL assinada aparecem aqui.
 *
 * ── POR QUE OS CONTROLES SÃO DAQUI, E NÃO DE `form-ui` ───────────────────
 *
 * Porque `Campo` e `BotaoEnviar` pintam com os tokens do PAINEL (`bg-acento`,
 * `border-linha`), que é o que se quer no painel e é exatamente o problema
 * aqui. Trocar a cor deles por variável afetaria todas as telas de conta; são
 * trinta linhas para o portão falar a língua da galeria sem mexer no resto.
 */

function Botao({ aparencia }: { aparencia: Aparencia }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-[var(--g-pilula,9999px)] px-6 py-3 text-sm font-semibold transition hover:opacity-85 disabled:opacity-60"
      style={{
        background: "var(--g-destaque)",
        color: "var(--g-sobre-destaque)",
        fontFamily: FONTES_TEXTO[aparencia.fonteTexto],
      }}
    >
      {pending ? "Abrindo…" : "Abrir galeria"}
    </button>
  );
}

export function PortaoDeSenha({
  estudio,
  galeria,
  titulo,
  nomeEstudio,
  aparencia,
}: {
  estudio: string;
  galeria: string;
  titulo: string;
  nomeEstudio: string;
  /** A aparência PUBLICADA. O rascunho é do dono, e o dono não vê esta tela. */
  aparencia: Aparencia;
}) {
  const [estado, action] = useActionState<EstadoSenha, FormData>(entrarNaGaleriaAction, {});

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16 text-center"
      style={{
        /* As mesmas variáveis que a galeria usa, pelas mesmas funções: duas
           fontes da verdade para o tema é como as duas telas divergem. */
        ...variaveisDoTema(aparencia),
        ...variaveisDeForma(aparencia),
        background: "var(--g-fundo)",
        color: "var(--g-texto)",
        fontFamily: FONTES_TEXTO[aparencia.fonteTexto],
      }}
    >
      <p
        className="font-mono text-[11px] uppercase tracking-[0.28em]"
        style={{ color: "var(--g-suave)" }}
      >
        {nomeEstudio}
      </p>
      <h1
        className="mt-4 text-3xl tracking-tight"
        style={{ fontFamily: FONTES_TITULO[aparencia.tipografia] }}
      >
        {titulo}
      </h1>
      <p className="mt-3 text-sm" style={{ color: "var(--g-suave)" }}>
        Esta galeria é protegida. Digite a senha que você recebeu junto com o link.
      </p>

      <form action={action} className="mt-8 flex flex-col gap-4 text-left">
        <input type="hidden" name="estudio" value={estudio} />
        <input type="hidden" name="galeria" value={galeria} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm" style={{ color: "var(--g-suave)" }}>
            Senha
          </span>
          <input
            name="senha"
            type="password"
            required
            autoFocus
            autoComplete="off"
            placeholder="••••••••"
            className="w-full rounded-[var(--g-canto,6px)] px-3 py-2.5 text-sm outline-none"
            style={{
              background: "var(--g-superficie)",
              color: "var(--g-texto)",
              border: "1px solid var(--g-linha)",
            }}
          />
        </label>
        {estado.erro && (
          <p role="alert" className="text-xs" style={{ color: "var(--g-destaque)" }}>
            {estado.erro}
          </p>
        )}
        <Botao aparencia={aparencia} />
      </form>
    </main>
  );
}
