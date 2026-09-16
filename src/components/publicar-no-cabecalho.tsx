"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPublicacaoAction } from "@/app/painel/actions";

/**
 * PUBLICAR DE QUALQUER ABA.
 *
 * Juan, 05/09/2026: "não achei onde publica a galeria… achei, na sessão de
 * entrega. Mas seria ótimo se tivesse lá em cima, em 'rascunho'. Pra publicar
 * independente de qual página estivesse."
 *
 * Ele descreveu o remédio junto com a queixa, e no lugar certo: o selo de
 * estado já respondia "está no ar?" nas quatro abas — faltava ele responder
 * também "e como coloco no ar?". O botão de publicar existia só na Entrega, que
 * é a última aba do menu, e quem acaba de montar o Design não tem motivo para
 * procurar ali.
 *
 * ── O SELO CONTINUA SENDO UM SELO QUANDO NÃO HÁ O QUE FAZER ───────────────
 *
 * Publicada e no cofre viram texto, não botão. "Tirar do ar" existe na Entrega
 * e no menu da lista, e trazê-lo para o cabeçalho poria uma ação destrutiva no
 * mesmo pixel em que, um minuto antes, havia uma ação construtiva — o tipo de
 * troca que faz a mão errar.
 *
 * Publicar a galeria também publica a aparência pendente (ver
 * `promoverRascunhoSePendente`), então este botão fecha o caso das duas
 * usuárias que entregaram a galeria com o tema errado.
 */
/*
 * ── SELO E AÇÃO TÊM FORMAS DIFERENTES, E CADA FORMA É UMA SÓ ─────────────
 *
 * Felipe, 16/09/2026, com a foto da fileira: "e esses botões de cada forma,
 * cada tamanho, muito feio".
 *
 * Havia quatro desenhos lado a lado — pastilha de `py-1`, botão de `py-1.5`,
 * outra pastilha, e o botão grande. Cada peça nasceu num dia, com as classes
 * escritas na mão, e a fileira virou uma amostra de raios e alturas.
 *
 * A regra agora é de LEITURA, não de estética: o que se LÊ é pastilha
 * arredondada; o que se CLICA é retângulo de canto suave. Duas formas, e o olho
 * sabe de longe onde pode agir. "rascunho" e "publicada" deixaram de parecer
 * botões apagados.
 *
 * `SELO` tem a mesma altura do botão secundário do cabeçalho, para a fileira
 * assentar numa linha só.
 */
const SELO = "inline-flex items-center rounded-full border px-3 py-1.5 text-xs leading-none";

/*
 * `data-selo="estado"` é o gancho de teste, e ele existe por um motivo prático:
 * `testar-cofre.mjs` precisa ler o que o cabeçalho AFIRMA sobre o link do
 * cliente, e até 16/09/2026 fazia isso casando a string de classes do Tailwind.
 * Isso já quebrou duas vezes sem nada do comportamento mudar — em 05/09, quando
 * o selo virou selo-e-botão, e hoje, quando as pastilhas foram uniformizadas.
 *
 * Um atributo é a promessa certa: "aqui está o estado da galeria, por extenso".
 * Ele pode mudar de cor, de raio e de padding à vontade.
 */
const ATRIBUTO_SELO = { "data-selo": "estado" } as const;

/*
 * ── SELO E AÇÃO SÃO DOIS COMPONENTES (16/09/2026) ────────────────────────
 *
 * Eram um só, e o cabeçalho ficava assim:
 *
 *   [aparência não publicada]  [Ver como o cliente vê]  [rascunho] [Publicar]
 *                selo                   ação              selo       ação
 *
 * Um selo encravado entre duas ações, e o olho lendo "rascunho" como um botão
 * apagado. Separados, o cabeçalho agrupa o que se LÊ de um lado e o que se
 * CLICA do outro, e a fileira passa a ter uma ordem: aqui está o estado, ali
 * está o que fazer com ele.
 */

/** O que a tela AFIRMA sobre o link do cliente: no ar, rascunho ou no cofre. */
export function SeloDaGaleria({
  publicada,
  noCofre,
}: {
  publicada: boolean;
  noCofre: boolean;
}) {
  if (noCofre) {
    return (
      <span {...ATRIBUTO_SELO} className={`${SELO} border-acento/40 bg-acento/10 text-acento-alto`}>
        no cofre
      </span>
    );
  }
  if (publicada) {
    return (
      <span {...ATRIBUTO_SELO} className={`${SELO} border-ok/40 bg-ok/10 text-ok`}>
        publicada
      </span>
    );
  }
  return (
    <span {...ATRIBUTO_SELO} className={`${SELO} border-linha text-texto-faint`}>
      rascunho
    </span>
  );
}

/** O que dá para FAZER com o estado acima. Nada, quando a galeria está no cofre. */
export function AcaoDePublicar({
  galeriaId,
  publicada,
  noCofre,
}: {
  galeriaId: string;
  publicada: boolean;
  noCofre: boolean;
}) {
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  /* No cofre não há o que apertar: reativar é decisão da Entrega, onde o prazo
     é explicado. Um botão aqui seria a ação mais importante da tela sem o
     contexto que a torna compreensível. */
  if (noCofre) return null;

  const mudar = (para: "0" | "1") =>
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("publicada", para);
      await salvarPublicacaoAction(f);
      router.refresh();
    });

  if (publicada) {
    /*
      TIRAR DO AR fica aqui também, e de propósito com outro PESO.

      O Juan pediu o atalho ("copiar link, tirar galeria do ar, etc"), e
      negá-lo no cabeçalho seria mandá-lo procurar na Entrega justamente o que
      ele reclamou de ter procurado. Mas um segundo botão grande no mesmo pixel
      em que, um minuto antes, havia "Publicar galeria" é a troca que faz a mão
      errar: um link é publicado e despublicado com o mesmo gesto, e o segundo
      derruba a entrega de um casamento.

      Por isso é um texto sublinhado e não um botão, e por isso pergunta antes.
      A ação existe, e não se dá por acidente.
    */
    return (
      <button
        type="button"
        disabled={salvando}
        onClick={() => {
          if (!confirm("Tirar a galeria do ar? O link do cliente para de abrir.")) return;
          mudar("0");
        }}
        /* `whitespace-nowrap` porque o cabeçalho é um flex que quebra: sem ele,
           num espaço apertado o texto quebrava LETRA por letra e o botão virava
           uma coluna de 21 px de largura. */
        className="whitespace-nowrap text-xs text-texto-faint underline underline-offset-4 transition hover:text-texto disabled:opacity-50"
      >
        {salvando ? "tirando…" : "tirar do ar"}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={salvando}
      onClick={() => mudar("1")}
      /*
        "TEM QUE TER UM BOTÃO BEM GRANDE DISSO" — as palavras dele.

        A primeira versão saiu do tamanho de um botão comum, menor até que o
        "Nova galeria" da lista. Botão do mesmo tamanho de todo o resto é
        justamente o que ele não achou: numa tela com selo, link de prévia e
        aviso de aparência, o que decide para onde o olho vai é o CONTRASTE de
        tamanho, não a existência do botão.

        Continua o MAIOR da fileira. O que mudou em 16/09/2026 foi o exagero:
        `px-6 py-3` com `text-base` o deixava quase o dobro da altura dos
        vizinhos, e uma fileira com um botão de outra escala é o "muito feio" da
        foto do Felipe. Um degrau acima dos outros basta.
      */
      className="rounded-lg bg-acento px-5 py-2.5 text-sm font-semibold text-void shadow-[0_0_28px_-10px_var(--acento)] transition hover:bg-acento-alto disabled:opacity-60"
    >
      {salvando ? "Publicando…" : "Publicar galeria"}
    </button>
  );
}
