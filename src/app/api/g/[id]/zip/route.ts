import { NextResponse, type NextRequest } from "next/server";
import { armazemDe, urlDoOriginal } from "@/lib/armazem";
import { dispositionSegura } from "@/lib/r2";
import { pessoaAtual } from "@/lib/favoritas";
import { hashDeIp } from "@/lib/ip";
import { prepararEntrega } from "@/lib/entrega-da-galeria";
import { entradasDaParte } from "@/lib/entradas-do-zip";
import { lerParte } from "@/lib/partes-do-zip";
import { tamanhoDoZip, zipEmFluxo, type ArquivoDoZip } from "@/lib/zip-em-fluxo";
import { assinarPedido, segredoDoZip, urlDoServidorDeZip, zipRemotoConfigurado } from "@/lib/zip-remoto";
import { criarPedidoDeZip, registrarEntregaDeZip } from "@/lib/pedidos-zip";

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
 *   /api/g/<id>/zip?fotos=<ids>     as que a busca por rosto achou
 *   /api/g/<id>/zip?parte=<n>       a parte n da galeria grande (10/10/2026)
 *
 * A PARTE: a galeria acima de 4 GB também sai em ZIPs de até 4 GB, que o
 * navegador baixa ao mesmo tempo — ver `lib/partes-do-zip.ts`. A lista das
 * partes vem de `/api/g/<id>/zip/partes`; sem `?parte=`, o ZIP inteiro de
 * sempre continua saindo.
 *
 * ── DOIS CAMINHOS, E QUAL VALE (23/09/2026) ───────────────────────────────
 *
 * Com `ZIP_SERVIDOR_URL` e `ZIP_SEGREDO` no ambiente, esta rota NÃO carrega
 * byte nenhum: aplica as travas, grava o pedido com a lista resolvida e
 * redireciona o navegador para o servidor de ZIP, que monta o arquivo uma vez,
 * o guarda e o entrega quantas vezes pedirem — com retomada. É o caminho de
 * produção. Ver `lib/zip-remoto.ts` e docs/servidor-zip.md.
 *
 * Sem as variáveis, o ZIP é montado AQUI, em fluxo, como desde 16/09: cada
 * original é buscado no balde e repassado ao navegador. Não fica nada na
 * memória nem no disco, mas a banda é do VPS — que é dividido com os outros
 * sites. Foi a razão de o servidor de ZIP existir, e continua sendo a razão
 * de este caminho ser só reserva. Os bytes que saem por aqui são registrados
 * com origem 'vps', para o painel de administração mostrar que a reserva está
 * em uso.
 *
 * Sem compressão: foto já é JPEG. Ver `lib/zip-em-fluxo.ts`.
 */

/*
 * Validade de cada link do original no caminho de reserva. Curta de
 * propósito — ele é assinado na VEZ da foto, não no começo do zip. Um capítulo
 * de 2 GB leva meia hora; se todas as URLs fossem assinadas antes, as últimas
 * venceriam no caminho.
 */
const VALIDADE_DE_CADA_FOTO = 15 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /* ── As travas e a escolha das fotos: as mesmas da lista do celular ──── */
  const entrega = await prepararEntrega(id, request.nextUrl.searchParams);
  if (entrega instanceof NextResponse) return entrega;
  if (entrega.fotos.length === 0) {
    return NextResponse.json({ erro: "nada para baixar" }, { status: 404 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");

  /*
   * QUEM está baixando — lido aqui em cima porque serve aos DOIS caminhos, e
   * porque é o único lugar onde dá para ler.
   *
   * `pessoaAtual` e NÃO `visitanteAtual`: o segundo devolve o id anônimo do
   * navegador (modelo anterior à migração 033), que não existe em
   * `pessoas_da_galeria` — a chave estrangeira recusaria em silêncio e todo
   * download ficaria anônimo. Pego no navegador, não no teste.
   *
   * Pelo servidor de ZIP a leitura tem de acontecer AGORA e ir congelada no
   * pedido (migração 041): quem confirma a entrega é uma rota interna chamada
   * de volta pelo servidor, sem cookie e sem sessão.
   */
  const pessoaId = await pessoaAtual(id);
  const parte = lerParte(request.nextUrl.searchParams.get("parte"));

  /* ── O caminho de produção: o servidor de ZIP ──────────────────────────── */
  if (zipRemotoConfigurado()) {
    const cap = request.nextUrl.searchParams.get("cap");
    const pedido = await criarPedidoDeZip(
      id,
      entrega,
      { ipHash: ip ? hashDeIp(ip) : null, userAgent, pessoaId },
      /* `sem-capitulo` é o grupo das soltas: capítulo sem id. */
      entrega.tipo === "capitulo" && cap && cap !== "sem-capitulo" ? cap : null,
      parte,
    );
    if (!pedido) return parteQueSumiu();
    const destino = `${urlDoServidorDeZip()}/z/${assinarPedido(pedido.id, segredoDoZip())}`;
    return NextResponse.redirect(destino, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  /* ── A reserva: o ZIP montado aqui, em fluxo ───────────────────────────── */
  const daParte = entradasDaParte(entrega, parte);
  if (!daParte) return parteQueSumiu();
  const { nomeDoZip, arquivos: entradas } = daParte;
  const arquivos: ArquivoDoZip[] = entradas.map((e) => ({
    nome: e.nome,
    tamanho: e.tamanho,
    abrir: async function* () {
      /* Assinado AGORA, na vez desta foto — ver VALIDADE_DE_CADA_FOTO. */
      const endereco = await urlDoOriginal(e.media.chave, armazemDe(e.media.armazem), VALIDADE_DE_CADA_FOTO);
      const r = await fetch(endereco);
      if (!r.ok || !r.body) {
        throw new Error(`o original de "${e.media.nome_original}" não veio (HTTP ${r.status})`);
      }
      for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) yield pedaco;
    },
  }));

  /*
   * ── O REGISTRO ESPERA O FIM ──────────────────────────────────────────────
   *
   * A mesma lição de 05/09/2026, agora do lado do servidor: registrar no
   * começo contaria o CLIQUE. Aqui dá para fazer melhor que no navegador — o
   * fluxo sabe quando terminou. Se a pessoa cancelar o download no meio, o
   * gerador é interrompido antes desta linha e a Atividade não mente.
   */
  const tamanho = tamanhoDoZip(arquivos);
  const inicio = Date.now();
  let entregues = 0;
  let terminou = false;
  const pedidoParaRegistro = {
    id: null,
    galeria_id: id,
    tenant_id: entrega.tenantId,
    tipo: entrega.tipo,
    ip_hash: ip ? hashDeIp(ip) : null,
    user_agent: userAgent,
    pessoa_id: pessoaId,
    parte: daParte.parte?.numero ?? null,
  };

  async function* comRegistro() {
    for await (const pedaco of zipEmFluxo(arquivos)) {
      entregues += pedaco.length;
      yield pedaco;
    }
    terminou = true;
    /* Pelo VPS cada download É uma montagem: leu o armazém inteiro de novo. O
       'servido' é o que vira a linha de `acessos` que a Atividade mostra. */
    const duracaoMs = Date.now() - inicio;
    await registrarEntregaDeZip(pedidoParaRegistro, "vps", { evento: "montado", bytes: tamanho, doCache: false, duracaoMs });
    await registrarEntregaDeZip(pedidoParaRegistro, "vps", { evento: "servido", bytes: tamanho, doCache: false, duracaoMs });
  }

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
      if (!terminou) {
        /* O desperdício que antes não deixava rastro: o que saiu até cair. */
        await registrarEntregaDeZip(pedidoParaRegistro, "vps", {
          evento: "abortado",
          bytes: entregues,
          doCache: false,
          duracaoMs: Date.now() - inicio,
        });
      }
    },
  });

  return new Response(corpo, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": dispositionSegura(nomeDoZip),
      /* Exato, calculado antes do primeiro byte — é o que dá barra de progresso
         a um download de meia hora. Ver `tamanhoDoZip`. */
      "Content-Length": String(tamanho),
      /* Sem cache: é um download pessoal, com a senha e a identificação de quem
         pediu, e um proxy no meio não pode guardar para o próximo. */
      "Cache-Control": "private, no-store",
    },
  });
}

/*
 * A parte pedida não existe mais: a galeria mudou (fotos entraram ou saíram)
 * entre o menu, que mostrou "parte 4 de 4", e o clique. 404 com o motivo, e
 * não o ZIP inteiro no lugar: quem pediu 4 GB não pode receber 20 sem aviso.
 */
function parteQueSumiu() {
  return NextResponse.json(
    { erro: "a galeria mudou desde que o menu abriu — abra o menu de novo para ver as partes" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}
