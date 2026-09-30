"use client";

import { useMemo, useState } from "react";
import {
  arquivosDeArrasto,
  comCaminhoDoInput,
  separarRepetidos,
  type ArquivoComCaminho,
} from "@/lib/fila-upload";
import { lerZip, ehZip, ZipIlegivel } from "@/lib/zip-leitor";
import {
  fontesDaPasta,
  fonteDoZip,
  montarGalerias,
  galeriaDeMesmoNome,
  type FonteDeImportacao,
} from "@/lib/importacao";
import { capitulosDaPasta } from "@/lib/capitulos-pasta";
import { useEnvio, formatarBytesCurto } from "@/components/envio-em-curso";
import { prepararImportacaoAction } from "@/app/painel/importar/actions";

/**
 * A tela da importação: escolher → revisar nome e data → criar e enviar.
 *
 * Nada é criado até a pessoa apertar o botão. A etapa de revisão existe porque
 * o nome da pasta no disco raramente é o título que o cliente deve ler
 * ("2025-03-14_ana_pedro_FINAL"), e porque 80 galerias criadas com o nome
 * errado são 80 renomeações à mão depois.
 */

interface Existente {
  id: string;
  titulo: string;
  estado: string;
}

/** Uma pasta escolhida — guardada separada das outras, cada uma com o seu modo. */
interface PastaEscolhida {
  brutos: ArquivoComCaminho[];
  modo: "subpastas" | "uma";
}

interface Edicao {
  titulo: string;
  data: string;
  incluir: boolean;
}

interface Preparada {
  titulo: string;
  id: string | null;
  nova: boolean;
  enviados: number;
  pulados: number;
  erro?: string;
}

export function ImportarGalerias({
  existentes,
  livreBytes,
  livreTexto,
  bloqueio,
}: {
  existentes: Existente[];
  livreBytes: number;
  livreTexto: string;
  /** O recado de quem não pode enviar (teste vencido, pagamento pendente). */
  bloqueio?: string | null;
}) {
  const envio = useEnvio();
  const [pastas, setPastas] = useState<PastaEscolhida[]>([]);
  const [zips, setZips] = useState<FonteDeImportacao[]>([]);
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});
  const [avisos, setAvisos] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [preparadas, setPreparadas] = useState<Preparada[] | null>(null);

  /* As fontes são DERIVADAS das pastas: trocar o modo de uma pasta refaz as
     linhas dela sem ler o disco de novo. O prefixo do índice separa duas
     pastas escolhidas que tenham subpastas de mesmo nome. */
  const fontes = useMemo<FonteDeImportacao[]>(
    () => [
      ...pastas.flatMap((p, i) =>
        fontesDaPasta(p.brutos, p.modo).map((f) => ({ ...f, id: `${i}:${f.id}` })),
      ),
      ...zips,
    ],
    [pastas, zips],
  );

  /** A edição da linha, ou o que a pasta sugeriu. */
  const edicaoDe = (f: FonteDeImportacao): Edicao =>
    edicoes[f.id] ?? { titulo: f.nomeSugerido, data: f.dataSugerida ?? "", incluir: true };

  const editar = (f: FonteDeImportacao, mudanca: Partial<Edicao>) =>
    setEdicoes((e) => ({ ...e, [f.id]: { ...edicaoDe(f), ...mudanca } }));

  const galerias = useMemo(
    () => montarGalerias(fontes.map((fonte) => ({ fonte, ...edicaoDe(fonte) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edicaoDe só lê `edicoes`
    [fontes, edicoes],
  );
  const totalBytes = galerias.reduce((s, g) => s + g.bytes, 0);
  const totalArquivos = galerias.reduce((s, g) => s + g.itens.length, 0);

  async function lerZips(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setLendo(true);
    const novas: FonteDeImportacao[] = [];
    const recados: string[] = [];
    for (const [k, z] of arquivos.entries()) {
      try {
        const { entradas, recusadas } = await lerZip(z);
        const fonte = fonteDoZip(z.name, entradas, zips.length + k);
        if (fonte.itens.length === 0) recados.push(`${z.name}: nenhuma foto ou vídeo dentro.`);
        else novas.push(fonte);
        if (recusadas.length > 0) {
          recados.push(
            `${z.name}: ${recusadas.length} ${recusadas.length === 1 ? "arquivo ficou" : "arquivos ficaram"} de fora (${recusadas[0].motivo}).`,
          );
        }
      } catch (e) {
        recados.push(`${z.name}: ${e instanceof ZipIlegivel ? e.message : "não consegui abrir."}`);
      }
    }
    setZips((atual) => [...atual, ...novas]);
    setAvisos((a) => [...a, ...recados]);
    setLendo(false);
  }

  function adicionarPasta(brutos: ArquivoComCaminho[]) {
    if (brutos.length > 0) setPastas((p) => [...p, { brutos, modo: "subpastas" }]);
  }

  function recomecar() {
    setPastas([]);
    setZips([]);
    setEdicoes({});
    setAvisos([]);
    setErro(null);
    setPreparadas(null);
    envio.limparConcluidos();
  }

  async function criarEEnviar() {
    setErro(null);
    setCriando(true);
    const pedidos = galerias.map((g) => ({
      titulo: g.titulo,
      dataEvento: g.data,
      existenteId: galeriaDeMesmoNome(g.titulo, existentes)?.id ?? null,
    }));
    const r = await prepararImportacaoAction(pedidos).catch(() => ({
      erro: "Não consegui falar com o servidor. Confira a conexão e tente de novo.",
      galerias: undefined,
    }));
    if (r.erro || !r.galerias) {
      setErro(r.erro ?? "Não consegui criar as galerias.");
      setCriando(false);
      return;
    }

    /* Uma por vez, na ordem da lista: `enfileirar` só devolve depois de o lote
       entrar na fila, e a fila sobe na ordem em que entrou. */
    const resultado: Preparada[] = [];
    for (const [k, p] of r.galerias.entries()) {
      const g = galerias[k];
      if (!p.id || p.erro) {
        resultado.push({ titulo: p.titulo, id: p.id, nova: p.nova, enviados: 0, pulados: 0, erro: p.erro });
        continue;
      }
      const { novos, repetidos } = separarRepetidos(g.itens, p.nomesNaGaleria);
      if (novos.length > 0) await envio.enfileirar(novos, { galeriaId: p.id, rostosAtivos: false });
      resultado.push({
        titulo: p.titulo,
        id: p.id,
        nova: p.nova,
        enviados: novos.length,
        pulados: repetidos.length,
      });
    }
    setPreparadas(resultado);
    setCriando(false);
  }

  if (preparadas) {
    return <Andamento preparadas={preparadas} aoRecomecar={recomecar} />;
  }

  return (
    <section aria-labelledby="titulo-importar" className="mt-8 rounded-xl border border-linha bg-carbon p-4 sm:p-5">
      <h2 id="titulo-importar" className="text-sm font-semibold">
        1. Escolha o que importar
      </h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Os arquivos vão direto do seu navegador para o armazenamento, como no envio comum. Nada
        é criado antes de você conferir a lista.
      </p>

      {bloqueio && (
        <p className="mt-4 rounded-lg border border-alerta/40 bg-alerta/10 p-3 text-sm text-alerta">
          {bloqueio}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setArrastando(false);
          /* As duas leituras começam ANTES do primeiro await: depois dele o
             navegador esvazia o `dataTransfer`. */
          const soltosZip = [...e.dataTransfer.files].filter(ehZip);
          const daPasta = arquivosDeArrasto(e.dataTransfer);
          adicionarPasta(await daPasta);
          await lerZips(soltosZip);
        }}
        className={`mt-4 rounded-xl border border-dashed px-4 py-10 text-center transition sm:px-6 ${
          arrastando ? "border-acento bg-acento/5" : "border-linha-forte bg-carbon-2"
        }`}
      >
        <p className="text-base font-medium">Arraste a pasta do acervo ou os ZIPs aqui</p>
        <p className="mx-auto mt-2 max-w-[56ch] text-sm text-texto-soft">
          Uma pasta com uma subpasta por trabalho vira uma galeria por subpasta. Cada ZIP vira uma
          galeria. Dá para somar: escolher uma pasta e depois mais ZIPs.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => document.getElementById("importar-pasta")?.click()}
            className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto"
          >
            Escolher pasta
          </button>
          <button
            type="button"
            onClick={() => document.getElementById("importar-zips")?.click()}
            className="rounded-lg border border-linha-forte px-4 py-2.5 text-sm transition hover:bg-carbon-2"
          >
            Escolher ZIPs
          </button>
        </div>
        <input
          id="importar-pasta"
          type="file"
          multiple
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(e) => {
            adicionarPasta([...(e.target.files ?? [])].map(comCaminhoDoInput));
            e.target.value = "";
          }}
        />
        <input
          id="importar-zips"
          type="file"
          multiple
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const escolhidos = [...(e.target.files ?? [])].filter(ehZip);
            e.target.value = "";
            void lerZips(escolhidos);
          }}
        />
        {lendo && <p className="mt-4 text-xs text-texto-soft">Lendo os ZIPs…</p>}
      </div>

      {avisos.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-alerta">
          {avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      {pastas.some((p) => p.brutos.length > 0) && (
        <div className="mt-4 flex flex-col gap-2">
          {pastas.map((p, i) => (
            <label key={i} className="flex items-start gap-2 text-xs text-texto-soft">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={p.modo === "uma"}
                onChange={(e) =>
                  setPastas((ps) =>
                    ps.map((x, j) => (j === i ? { ...x, modo: e.target.checked ? "uma" : "subpastas" } : x)),
                  )
                }
              />
              <span>
                <strong className="text-texto">{raizDe(p.brutos)}</strong> é UMA galeria só — as
                subpastas dela são capítulos, não galerias.
              </span>
            </label>
          ))}
        </div>
      )}

      {fontes.length > 0 && (
        <Revisao
          fontes={fontes}
          edicaoDe={edicaoDe}
          editar={editar}
          existentes={existentes}
        />
      )}

      {galerias.length > 0 && (
        <div className="mt-5 border-t border-linha pt-4">
          <p className="text-sm">
            <strong>{galerias.length}</strong> {galerias.length === 1 ? "galeria" : "galerias"} ·{" "}
            {totalArquivos} arquivos · {formatarBytesCurto(totalBytes)}
          </p>
          {totalBytes > livreBytes && (
            <p className="mt-1 text-xs text-alerta">
              Passa do espaço livre do seu plano ({livreTexto}). O que não couber vai falhar no
              envio — desmarque algumas galerias ou aumente o plano antes.
            </p>
          )}
          <p className="mt-1 text-xs text-texto-faint">
            As galerias nascem <strong className="text-texto-soft">sem publicar</strong>: ninguém
            recebe nada até você conferir e publicar cada uma.
          </p>
          {erro && <p className="mt-2 text-sm text-erro">{erro}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={criando || lendo || Boolean(bloqueio)}
              onClick={criarEEnviar}
              className="rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
            >
              {criando
                ? "Criando…"
                : `Criar ${galerias.length} ${galerias.length === 1 ? "galeria" : "galerias"} e enviar`}
            </button>
            <button
              type="button"
              onClick={recomecar}
              disabled={criando}
              className="rounded-lg px-3 py-2.5 text-sm text-texto-soft underline underline-offset-4 transition hover:text-texto"
            >
              limpar tudo
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** O nome da pasta escolhida, para a pessoa saber de qual se está falando. */
function raizDe(brutos: ArquivoComCaminho[]): string {
  const primeiro = brutos[0]?.caminho.split("/").filter(Boolean);
  return primeiro && primeiro.length > 1 ? primeiro[0] : "A pasta";
}

/**
 * A lista para conferir: uma linha por pasta ou ZIP, com o nome e a data
 * editáveis. É aqui que "2025-03-14_ana_FINAL" vira "Ana e Pedro".
 */
function Revisao({
  fontes,
  edicaoDe,
  editar,
  existentes,
}: {
  fontes: FonteDeImportacao[];
  edicaoDe: (f: FonteDeImportacao) => Edicao;
  editar: (f: FonteDeImportacao, m: Partial<Edicao>) => void;
  existentes: Existente[];
}) {
  /* Quantas linhas incluídas têm cada título — duas ou mais se juntam. */
  const contagem = new Map<string, number>();
  for (const f of fontes) {
    const e = edicaoDe(f);
    if (!e.incluir || !e.titulo.trim()) continue;
    const chave = chaveDoTitulo(e.titulo);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold">2. Confira o nome e a data de cada galeria</h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        A data é opcional. Linhas com o mesmo nome viram uma galeria só — é assim que as partes
        de um ZIP dividido se juntam.
      </p>

      <ul className="mt-3 flex flex-col divide-y divide-linha rounded-lg border border-linha">
        {fontes.map((f) => {
          const e = edicaoDe(f);
          const existente = e.titulo.trim() ? galeriaDeMesmoNome(e.titulo, existentes) : undefined;
          const juntas = contagem.get(chaveDoTitulo(e.titulo)) ?? 0;
          const capitulos = capitulosDaPasta(f.itens.map((i) => `galeria/${i.caminho}`)).length;
          return (
            <li key={f.id} className={`p-3 ${e.incluir ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input
                  type="checkbox"
                  checked={e.incluir}
                  onChange={(ev) => editar(f, { incluir: ev.target.checked })}
                  aria-label={`Importar ${f.rotulo}`}
                />
                <input
                  type="text"
                  value={e.titulo}
                  onChange={(ev) => editar(f, { titulo: ev.target.value })}
                  aria-label="Nome da galeria"
                  placeholder="Nome da galeria"
                  className="min-w-0 flex-1 basis-48 rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
                />
                <input
                  type="date"
                  value={e.data}
                  onChange={(ev) => editar(f, { data: ev.target.value })}
                  aria-label="Data (opcional)"
                  className="rounded-lg border border-linha bg-void px-3 py-1.5 text-sm focus:border-acento focus:outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-texto-faint">
                {f.origem === "zip" ? "ZIP " : "Pasta "}
                <span className="text-texto-soft">{f.rotulo}</span> · {f.itens.length} arquivos ·{" "}
                {formatarBytesCurto(f.bytes)}
                {capitulos > 0 && ` · ${capitulos} ${capitulos === 1 ? "capítulo" : "capítulos"}`}
              </p>
              {e.incluir && existente && (
                <p className="mt-1 text-xs text-alerta">
                  {existente.estado === "online"
                    ? "Já existe uma galeria com este nome: os arquivos vão para ela, e os que já estão lá são pulados. Para criar outra, mude o nome."
                    : "Já existe uma galeria com este nome, e ela está no cofre. Reative-a antes, ou mude o nome para criar outra."}
                </p>
              )}
              {e.incluir && juntas > 1 && (
                <p className="mt-1 text-xs text-texto-soft">
                  Junta com outra linha de mesmo nome numa galeria só.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A mesma comparação de `mesmaCoisa`, como chave de mapa. */
function chaveDoTitulo(t: string): string {
  return t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Depois de criar: o andamento POR GALERIA. A barra de baixo (a mesma do envio
 * comum) mostra os arquivos; aqui a pessoa vê em que galeria a fila está.
 */
function Andamento({ preparadas, aoRecomecar }: { preparadas: Preparada[]; aoRecomecar: () => void }) {
  const envio = useEnvio();
  const porGaleria = new Map<string, { prontos: number; erros: number; total: number }>();
  for (const item of envio.fila) {
    const c = porGaleria.get(item.galeriaId) ?? { prontos: 0, erros: 0, total: 0 };
    c.total++;
    if (item.situacao === "pronto") c.prontos++;
    if (item.situacao === "erro") c.erros++;
    porGaleria.set(item.galeriaId, c);
  }
  const novas = preparadas.filter((p) => p.nova && p.id).length;

  return (
    <section aria-labelledby="titulo-andamento" className="mt-8 rounded-xl border border-linha bg-carbon p-4 sm:p-5">
      <h2 id="titulo-andamento" className="text-sm font-semibold">
        {envio.rodando ? "Importando…" : "Importação enviada"}
      </h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        {novas > 0 && `${novas} ${novas === 1 ? "galeria criada" : "galerias criadas"}, sem publicar. `}
        Deixe esta página aberta até o fim — fechar ou sair para outra tela do painel para o
        envio. Se cair no meio, importe a mesma pasta de novo: o que já subiu é pulado.
      </p>

      <ul className="mt-4 flex flex-col divide-y divide-linha rounded-lg border border-linha">
        {preparadas.map((p, i) => {
          const c = p.id ? porGaleria.get(p.id) : undefined;
          const situacao = p.erro
            ? p.erro
            : p.enviados === 0
              ? "nada novo para enviar"
              : !c
                ? "na fila"
                : c.prontos + c.erros < c.total
                  ? `${c.prontos} de ${c.total}`
                  : c.erros > 0
                    ? `${c.prontos} enviados · ${c.erros} com erro`
                    : "pronta";
          return (
            <li key={`${p.id}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {p.titulo}
                {!p.nova && p.id && <span className="text-xs text-texto-faint"> · já existia</span>}
                {p.pulados > 0 && (
                  <span className="text-xs text-texto-faint"> · {p.pulados} já estavam lá</span>
                )}
              </span>
              <span className={`text-xs tabular-nums ${p.erro || (c && c.erros > 0) ? "text-alerta" : "text-texto-soft"}`}>
                {situacao}
              </span>
              {p.id && (
                <a
                  href={`/painel/galerias/${p.id}/fotos`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-texto-soft underline underline-offset-4 hover:text-texto"
                >
                  abrir
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {!envio.rodando && (
        <button
          type="button"
          onClick={aoRecomecar}
          className="mt-4 rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
        >
          Importar mais
        </button>
      )}
    </section>
  );
}
