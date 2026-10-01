/**
 * O AVISO DE FOTOS REPETIDAS.
 *
 * Felipe, 23/09/2026, olhando o zip do casamento da Júlia: dentro de "Cerimônia"
 * havia `sirius-jugusw-1070.jpg` E `sirius-jugusw-1070 (2).jpg`, os dois com
 * 2.888 KB. O "(2)" é nosso — `nomeUnico` renomeia para o descompactador não
 * sobrescrever uma foto com a outra —, mas dois arquivos com o mesmo tamanho em
 * bytes não são duas fotos: é a mesma foto duas vezes na galeria.
 *
 * Ele pediu a consulta e disse "eu nem sei aonde esta o banco dessa aplicação".
 * Ninguém deveria precisar saber: a pergunta é do produto, então a resposta
 * mora na tela.
 *
 * ── DOIS CASOS, E SÓ UM É PROBLEMA ────────────────────────────────────────
 *
 * Tamanhos DIFERENTES com o mesmo nome são duas fotos de verdade — a câmera do
 * segundo fotógrafo também começa em `DSC_0001.jpg`. Isso é normal, o zip já
 * trata, e a tela diz que está tudo bem.
 *
 * Tamanhos IGUAIS são a mesma foto entrando duas vezes. Aí o casal recebe a
 * foto repetida na galeria e no zip, e alguém precisa decidir o que fazer —
 * por isso o aviso NÃO apaga nada sozinho. Apagar foto de casamento por conta
 * própria, a partir de uma heurística de nome e tamanho, é exatamente o tipo
 * de esperteza que não se desfaz.
 */
import { VerNaGrade } from "@/components/ver-na-grade";

export function AvisoDeRepetidas({
  galeriaId,
  itens,
}: {
  galeriaId: string;
  itens: { nome: string; vezes: number; mesmoTamanho: boolean }[];
}) {
  if (itens.length === 0) return null;

  const iguais = itens.filter((i) => i.mesmoTamanho);
  const soONome = itens.filter((i) => !i.mesmoTamanho);

  /* A frase inteira de uma vez, e não pedaços costurados no meio do JSX: são
     quatro combinações (com ou sem repetida de verdade × um ou vários nomes) e
     montá-la por partes já produziu "Outros 1 nome aparece" e um parágrafo
     começando sem sujeito. "Outro" só cabe quando há repetida de verdade
     acima — sem ela, não há de que este seja outro. */
  const sujeito =
    iguais.length > 0
      ? soONome.length === 1
        ? "Outro nome aparece"
        : `Outros ${soONome.length} nomes aparecem`
      : soONome.length === 1
        ? "Um nome de arquivo aparece"
        : `${soONome.length} nomes de arquivo aparecem`;

  return (
    <section className="mt-8 rounded-xl border border-alerta/40 bg-alerta/5 p-5">
      <h2 className="text-sm font-semibold text-alerta">
        {iguais.length > 0
          ? `${iguais.length} ${iguais.length === 1 ? "foto repetida" : "fotos repetidas"}`
          : "Nomes de arquivo repetidos"}
      </h2>

      {iguais.length > 0 && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-texto-soft">
            Estas subiram mais de uma vez — mesmo nome e mesmo tamanho. O casal vai ver cada
            uma repetida na galeria e no arquivo .zip.
          </p>
          {/* "Marque a cópia extra na grade abaixo" era o conselho até
              01/10/2026 — e o Juan, com 4.000 fotos: "impossível eu achar".
              Agora a grade mostra só elas, lado a lado, com um botão que marca
              as cópias extras. */}
          <VerNaGrade
            galeriaId={galeriaId}
            filtro="repetidas"
            className="mt-2 rounded-md border border-alerta/60 px-2.5 py-1.5 text-xs font-medium text-alerta transition hover:bg-alerta/10"
          >
            ver as repetidas e apagar as cópias
          </VerNaGrade>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {iguais.map((i) => (
              <li
                key={i.nome}
                className="rounded-md border border-alerta/30 bg-void/40 px-2 py-1 font-mono text-[11px] text-texto-soft"
              >
                {i.nome}
                {i.vezes > 2 && <span className="ml-1.5 text-alerta">×{i.vezes}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {soONome.length > 0 && (
        <p className={`${iguais.length > 0 ? "mt-4" : "mt-1"} text-xs leading-relaxed text-texto-soft`}>
          {/* Dito como notícia boa, porque é: sem esta frase o fotógrafo veria
              o nome repetido e iria procurar um problema que não existe. */}
          {sujeito} mais de uma vez, mas com tamanhos diferentes — são fotos distintas que se
          chamam igual, e isso está certo. No .zip elas saem como “(2)”, para nenhuma ser
          sobrescrita.
        </p>
      )}
    </section>
  );
}
