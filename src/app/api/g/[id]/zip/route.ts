import { NextResponse, type NextRequest } from "next/server";
import { armazemDe, urlDoOriginal } from "@/lib/armazem";
import { dispositionSegura } from "@/lib/r2";
import { registrarAcesso } from "@/lib/galerias-publicas";
import { pessoaAtual } from "@/lib/favoritas";
import { GRUPO_SEM_CAPITULO } from "@/lib/nome-de-arquivo";
import { prepararEntrega } from "@/lib/entrega-da-galeria";
import { tamanhoDoZip, zipEmFluxo, type ArquivoDoZip } from "@/lib/zip-em-fluxo";

/**
 * A galeria, um capítulo ou as favoritas de quem escolheu — num ZIP só.
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "o download de baixar várias fotos ainda está difícil", e, no
 * computador, "uma pasta zipada". Até aqui eram um arquivo por vez com 700 ms
 * de pausa: 2108 fotos, 25 minutos de navegador disparando download.
 *
 *   /api/g/<id>/zip                 a galeria inteira, uma pasta por capítulo
 *   /api/g/<id>/zip?cap=<capítulo>  só aquele capítulo
 *   /api/g/<id>/zip?favoritas=1     as favoritas de quem está identificado
 *
 * ── O CUSTO, DITO COM TODAS AS LETRAS ─────────────────────────────────────
 *
 * Os bytes passam pelo VPS: cada original é buscado no balde e repassado para
 * o navegador. Não fica nada na memória nem no disco — é um cano, não um
 * depósito —, mas a banda é nossa. Foi a razão de não haver zip até aqui, e
 * continua sendo o preço dele.
 *
 * Sem compressão: foto já é JPEG, e comprimir de novo gastaria a CPU do mesmo
 * servidor que atende as outras galerias. Ver `lib/zip-em-fluxo.ts`.
 */

/*
 * Validade de cada link do original. Curta de propósito — ele é assinado na
 * VEZ da foto, não no começo do zip. Um capítulo de 2 GB leva meia hora; se
 * todas as URLs fossem assinadas antes, as últimas venceriam no caminho.
 */
const VALIDADE_DE_CADA_FOTO = 15 * 60;

/**
 * Nome único dentro do zip.
 *
 * Duas fotos "DSC_0001.jpg" no mesmo capítulo são comuns — câmera reiniciada,
 * dois fotógrafos. Dentro de um zip, nome repetido faz o descompactador
 * sobrescrever uma com a outra ou perguntar o que fazer para cada uma, e o
 * casal perde foto sem saber. A segunda vira "DSC_0001 (2).jpg".
 */
function nomeUnico(nome: string, usados: Set<string>): string {
  if (!usados.has(nome.toLowerCase())) {
    usados.add(nome.toLowerCase());
    return nome;
  }
  const ponto = nome.lastIndexOf(".");
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const ext = ponto > 0 ? nome.slice(ponto) : "";
  for (let n = 2; ; n++) {
    const tentativa = `${base} (${n})${ext}`;
    if (!usados.has(tentativa.toLowerCase())) {
      usados.add(tentativa.toLowerCase());
      return tentativa;
    }
  }
}

/** Pasta ou nome de arquivo sem os caracteres que o Windows recusa. */
const semProibidos = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /* ── As travas e a escolha das fotos: as mesmas da lista do celular ──── */
  const entrega = await prepararEntrega(id, request.nextUrl.searchParams);
  if (entrega instanceof NextResponse) return entrega;
  const escolhidas = entrega.fotos;
  const nomeDoCapitulo = new Map(
    [...entrega.capitulos].map(([cid, nome]) => [cid, semProibidos(nome)]),
  );
  /* Pasta por capítulo só no zip da galeria inteira: num zip de UM capítulo a
     pasta seria um nível a mais para abrir sem motivo. */
  const comPastas = entrega.tipo === "tudo" && entrega.capitulos.size > 0;

  if (escolhidas.length === 0) {
    return NextResponse.json({ erro: "nada para baixar" }, { status: 404 });
  }

  /* ── As entradas do zip ─────────────────────────────────────────────────── */
  const usados = new Set<string>();
  const arquivos: ArquivoDoZip[] = escolhidas.map((m) => {
    /* A pasta das soltas tem o nome que o fotógrafo deu (migração 037), e ele
       passa pela MESMA limpeza dos capítulos: é um nome de pasta dentro do zip,
       e o Windows recusa os mesmos caracteres nos dois. */
    const pasta = comPastas
      ? ((m.secao_id ? nomeDoCapitulo.get(m.secao_id) : null) ??
        (semProibidos(entrega.grupoSolto) || GRUPO_SEM_CAPITULO))
      : "";
    const nome = semProibidos(m.nome_original) || `${m.id}.jpg`;
    return {
      nome: nomeUnico(pasta ? `${pasta}/${nome}` : nome, usados),
      tamanho: Number(m.bytes),
      abrir: async function* () {
        /* Assinado AGORA, na vez desta foto — ver VALIDADE_DE_CADA_FOTO. */
        const endereco = await urlDoOriginal(m.chave, armazemDe(m.armazem), VALIDADE_DE_CADA_FOTO);
        const r = await fetch(endereco);
        if (!r.ok || !r.body) {
          throw new Error(`o original de "${m.nome_original}" não veio (HTTP ${r.status})`);
        }
        for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) yield pedaco;
      },
    };
  });

  /*
   * ── O REGISTRO ESPERA O FIM ──────────────────────────────────────────────
   *
   * A mesma lição de 05/09/2026, agora do lado do servidor: registrar no
   * começo contaria o CLIQUE. Aqui dá para fazer melhor que no navegador — o
   * fluxo sabe quando terminou. Se a pessoa cancelar o download no meio, o
   * gerador é interrompido antes desta linha e a Atividade não mente.
   */
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");
  const acao = entrega.tipo === "tudo" ? "baixou_tudo" : "baixou";

  /* Lido ANTES do fluxo começar: o gerador roda enquanto o zip é transmitido, e
     ali dentro `cookies()` já não é mais o pedido desta rota. */
  const pessoaId = await pessoaAtual(id);

  async function* comRegistro() {
    yield* zipEmFluxo(arquivos);
    await registrarAcesso({ galeriaId: id, acao, ip, userAgent, pessoaId });
  }

  const sufixo = semProibidos(entrega.sufixo.replace(/^ - /, ""));
  const nomeDoZip = `${semProibidos(entrega.titulo) || "galeria"}${sufixo ? ` - ${sufixo}` : ""}.zip`;

  /*
   * Um pedaço por vez, SÓ quando o navegador pede o próximo (`pull`). É o que
   * mantém a memória do VPS no tamanho de um pedaço de foto, e não no de um
   * capítulo: se a conexão da noiva for lenta, o servidor espera por ela em vez
   * de acumular.
   *
   * E o `cancel` é o que faz o cancelamento valer do lado de cá. Sem ele, a
   * pessoa fecha a aba no meio de um capítulo de 2 GB e o servidor continua
   * buscando fotos no balde para ninguém — banda paga, entregue ao vazio.
   */
  const gerador = comRegistro();
  const corpo = new ReadableStream<Uint8Array>({
    async pull(controle) {
      try {
        const { value, done } = await gerador.next();
        if (done) controle.close();
        else controle.enqueue(value);
      } catch (e) {
        /* Uma foto que não veio no meio do fluxo interrompe o zip — ver o
           teste "a falha no meio de uma foto" em testar-zip-em-fluxo.mjs. O
           navegador marca o download como falho, em vez de entregar um zip
           truncado que abriria "quase inteiro". */
        controle.error(e);
      }
    },
    async cancel() {
      await gerador.return(undefined);
    },
  });

  return new Response(corpo, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": dispositionSegura(nomeDoZip),
      /* Exato, calculado antes do primeiro byte — é o que dá barra de progresso
         a um download de meia hora. Ver `tamanhoDoZip`. */
      "Content-Length": String(tamanhoDoZip(arquivos)),
      /* Sem cache: é um download pessoal, com a senha e a identificação de quem
         pediu, e um proxy no meio não pode guardar para o próximo. */
      "Cache-Control": "private, no-store",
    },
  });
}
