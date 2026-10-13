import { formatarDuracaoCurta } from "@/lib/velocidade-regras";
import type { EtapasDoEstudio } from "@/lib/velocidade";

/**
 * "ONDE O TEMPO DE CADA FOTO VAI" — o envio, etapa por etapa (13/10/2026).
 *
 * A Melannie subiu 8,8 GB e levou 30 minutos a mais que no Pixieset. O PUT do
 * original (a parte que depende da rede) ocupou 43% do tempo das seis vagas da
 * fila, e o resto não tinha dono. Aqui cada foto que subiu mostra para onde o
 * tempo dela foi:
 *
 *   · "Vez" e "Miniatura": esperar o processador e gerar miniatura e preview;
 *   · "Preparo": o pedido que reserva o arquivo e assina o envio;
 *   · "Original": o PUT — o único número que a internet do fotógrafo decide;
 *   · "Miniaturas": quanto elas ainda demoraram depois de o original chegar;
 *   · "Confirmar": o servidor conferindo que o arquivo chegou;
 *   · "Perdido": o que sobra — tentativas que caíram e foram refeitas, as
 *     esperas entre elas (2, 5, 15, 30, 60 s) e o que ninguém cronometrou.
 *
 * Médias por foto, na vaga da fila: com seis vagas, a pasta leva mais ou menos
 * (média × fotos ÷ 6). Componente de servidor: nada aqui tem estado.
 */

const COLUNAS: { chave: keyof EtapasDoEstudio; rotulo: string; dica: string }[] = [
  { chave: "esperaMs", rotulo: "Vez", dica: "esperando a vez de gerar a miniatura (três por vez)" },
  { chave: "miniaturaMs", rotulo: "Miniatura", dica: "decodificar a foto e gerar miniatura e preview, no computador do fotógrafo" },
  { chave: "preparoMs", rotulo: "Preparo", dica: "o pedido ao servidor que reserva o arquivo e assina o envio" },
  { chave: "envioMs", rotulo: "Original", dica: "o envio do original ao armazém — a parte que depende da rede" },
  { chave: "derivadasMs", rotulo: "Miniaturas", dica: "o que as miniaturas ainda demoraram depois de o original chegar" },
  { chave: "confirmarMs", rotulo: "Confirmar", dica: "o servidor conferindo que o arquivo chegou" },
  { chave: "perdidoMs", rotulo: "Perdido", dica: "tentativas que caíram e foram refeitas, esperas entre elas e o que não foi cronometrado" },
];

const pct = (f: number) => `${Math.round(f * 100)}%`;

function Linha({ l, destaque = false }: { l: EtapasDoEstudio; destaque?: boolean }) {
  /* Perdido que passa de um quarto do total é o que merece olho. */
  const muitoPerdido = l.totalMs > 0 && l.perdidoMs / l.totalMs > 0.25;
  return (
    <tr className={`border-t border-linha ${destaque ? "bg-void/40 font-medium" : ""}`}>
      <td className="px-3 py-1.5 text-left">{l.estudio}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-texto-faint">{l.n}</td>
      <td className="whitespace-nowrap border-l border-linha px-2 py-1.5 text-right tabular-nums">{formatarDuracaoCurta(l.totalMs)}</td>
      {COLUNAS.map((c) => (
        <td
          key={c.chave}
          className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${
            c.chave === "perdidoMs" && muitoPerdido ? "font-medium text-alerta" : ""
          }`}
          title={c.chave === "perdidoMs" ? `${pct(l.totalMs > 0 ? l.perdidoMs / l.totalMs : 0)} do tempo da foto` : undefined}
        >
          {formatarDuracaoCurta(l[c.chave] as number)}
        </td>
      ))}
      <td className="whitespace-nowrap border-l border-linha px-2 py-1.5 text-right tabular-nums" title="fotos que precisaram de mais de uma tentativa">
        {pct(l.comRetentativa)}
      </td>
      <td
        className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${l.comQuedaDeRede > 0 ? "text-alerta" : ""}`}
        title="fotos em que o navegador ficou sem rede em algum momento"
      >
        {pct(l.comQuedaDeRede)}
      </td>
    </tr>
  );
}

export function TabelaOndeOTempoVai({ geral, porEstudio }: { geral: EtapasDoEstudio | null; porEstudio: EtapasDoEstudio[] }) {
  if (!geral) {
    return (
      <p className="text-sm text-texto-faint">
        Ainda sem fotos medidas por etapa — entra a partir do próximo envio feito depois da publicação desta tela.
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-linha bg-carbon">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-xs">
          <thead>
            <tr className="font-mono text-[9px] uppercase tracking-widest text-texto-faint">
              <th className="px-3 py-2 text-left font-normal">Estúdio</th>
              <th className="px-2 py-2 text-right font-normal" title="fotos que entram na média">
                Fotos
              </th>
              <th className="border-l border-linha px-2 py-2 text-right font-normal" title="da vaga ocupada ao fim, com todas as tentativas">
                Total
              </th>
              {COLUNAS.map((c) => (
                <th key={c.chave} className="px-2 py-2 text-right font-normal" title={c.dica}>
                  {c.rotulo}
                </th>
              ))}
              <th className="border-l border-linha px-2 py-2 text-right font-normal" title="fotos que precisaram de mais de uma tentativa">
                2ª tent.
              </th>
              <th className="px-2 py-2 text-right font-normal" title="fotos em que o navegador ficou sem rede">
                Sem rede
              </th>
            </tr>
          </thead>
          <tbody>
            <Linha l={geral} destaque />
            {porEstudio.map((e) => (
              <Linha key={e.estudio} l={e} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-linha px-3 py-2 text-[11px] leading-snug text-texto-faint">
        Média por foto que subiu, nos últimos 7 dias. A fila abre <strong className="font-medium text-texto-soft">seis vagas</strong>:
        uma pasta leva, mais ou menos, o <strong className="font-medium text-texto-soft">total</strong> × fotos ÷ 6. Só o{" "}
        <strong className="font-medium text-texto-soft">original</strong> depende da internet de quem envia;{" "}
        <strong className="font-medium text-texto-soft">perdido</strong> é o que sobra — tentativas que caíram e foram
        refeitas, as esperas entre elas (2, 5, 15, 30 e 60 s) e o que ninguém cronometrou. Estúdios com menos de 5
        fotos medidas ficam de fora.
      </p>
    </div>
  );
}
