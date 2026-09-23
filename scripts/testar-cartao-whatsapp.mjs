#!/usr/bin/env node
/**
 * O cartão que o WhatsApp desdobra. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-cartao-whatsapp.mjs
 *
 * ── O QUE ESTE ARQUIVO EXISTE PARA PRENDER ────────────────────────────────
 *
 * A Carol, 06/09/2026: "coloquei cor branca lá na configuração e o link do
 * WhatsApp tá indo escuro". Ela tinha razão duas vezes, e o print mostrava as
 * duas:
 *
 *   1. A imagem do cartão era pintada com uma paleta CRAVADA no código —
 *      gradiente quase preto, texto creme, assinatura dourada. A galeria dela é
 *      branca. O cartão é a primeira coisa que o casal vê da entrega, e ele
 *      contradizia a galeria inteira.
 *
 *   2. O título e a descrição do cartão eram os da PLATAFORMA — "Galeria Átomo
 *      — Onde o instante permanece", "Galerias inteligentes para fotógrafos".
 *      `generateMetadata` da galeria definia só o `title` da aba; sem um bloco
 *      `openGraph` próprio, o Next herdava o da raiz. O fotógrafo mandava a
 *      entrega mais pessoal do ano e o cartão anunciava o fornecedor dele.
 *
 * ── POR QUE O TESTE LÊ PIXEL ──────────────────────────────────────────────
 *
 * Porque a queixa é sobre o que se VÊ. Conferir que o código chama
 * `variaveisDoTema` provaria que alguém escreveu a chamada, não que o cartão
 * saiu branco — e o defeito anterior deste mesmo arquivo (o véu invisível,
 * documentado lá) foi exatamente um caso de código certo e imagem errada.
 * Aqui a imagem é baixada e o primeiro pixel é lido.
 */
import pg from "pg";
import zlib from "node:zlib";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let falhou = false;
const ok = (m, extra) => console.log(`  ✓ ${m}${extra ? ` — ${extra}` : ""}`);
const erro = (m) => {
  console.error(`  ✗ ${m}`);
  falhou = true;
};

/**
 * O primeiro pixel do PNG, sem biblioteca nenhuma.
 *
 * Só a PRIMEIRA linha, e é isso que torna o decodificador pequeno: o filtro de
 * uma linha do PNG se resolve olhando a linha de cima, e para a linha zero a de
 * cima é toda zeros. Ler o rodapé exigiria desfazer as 630 linhas.
 *
 * Serve bem porque o cartão neutro (galeria com senha, sem foto) é o fundo do
 * tema de ponta a ponta — o canto superior esquerdo É a cor da galeria.
 */
function primeiroPixel(png) {
  return lerPixel(png, 0, 0);
}

/**
 * Qualquer pixel do PNG — o que exige desfazer o filtro linha a linha.
 *
 * ── POR QUE A VERSÃO CURTA DEIXOU DE BASTAR (08/09/2026) ──────────────────
 *
 * Ler só a primeira linha respondia "de que cor é o cartão", que era a queixa
 * de 06/09. A queixa nova é sobre a FAIXA DE BAIXO — o gradiente por cima da
 * foto —, e essa mora na altura 600 de 630. Para chegar lá é preciso desfazer
 * os filtros de todas as linhas acima, porque cada linha do PNG é codificada
 * em relação à anterior.
 *
 * Continua sem biblioteca: o algoritmo são cinco casos e cabe em vinte linhas.
 * A alternativa era instalar um decodificador de imagem para conferir uma cor.
 */
function lerPixel(png, x, y) {
  const { largura, canais, cru } = desempacotar(png);
  const porLinha = largura * canais;
  let anterior = Buffer.alloc(porLinha);
  let linha = anterior;

  for (let i = 0; i <= y; i++) {
    const inicio = i * (porLinha + 1);
    const filtro = cru[inicio];
    linha = Buffer.from(cru.subarray(inicio + 1, inicio + 1 + porLinha));

    for (let j = 0; j < porLinha; j++) {
      const a = j >= canais ? linha[j - canais] : 0; // à esquerda
      const b = anterior[j]; // acima
      const c = j >= canais ? anterior[j - canais] : 0; // acima e à esquerda
      if (filtro === 1) linha[j] = (linha[j] + a) & 255;
      else if (filtro === 2) linha[j] = (linha[j] + b) & 255;
      else if (filtro === 3) linha[j] = (linha[j] + ((a + b) >> 1)) & 255;
      else if (filtro === 4) {
        /* Paeth: escolhe entre esquerda, acima e diagonal o mais próximo da
           soma dos dois primeiros menos o terceiro. */
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        linha[j] = (linha[j] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (filtro !== 0) throw new Error(`filtro ${filtro} desconhecido`);
    }
    anterior = linha;
  }

  const p = x * canais;
  return { r: linha[p], g: linha[p + 1], b: linha[p + 2] };
}

function desempacotar(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("não é PNG");

  let pos = 8;
  let largura = 0;
  let canais = 0;
  const idat = [];

  while (pos < png.length) {
    const tamanho = png.readUInt32BE(pos);
    const tipo = png.toString("ascii", pos + 4, pos + 8);
    const dados = png.subarray(pos + 8, pos + 8 + tamanho);

    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      const profundidade = dados[8];
      const cor = dados[9];
      if (profundidade !== 8) throw new Error(`profundidade ${profundidade} não suportada`);
      /* 2 = RGB, 6 = RGBA. São os dois que o satori emite. */
      canais = cor === 6 ? 4 : cor === 2 ? 3 : 0;
      if (!canais) throw new Error(`tipo de cor ${cor} não suportado`);
    } else if (tipo === "IDAT") {
      idat.push(Buffer.from(dados));
    } else if (tipo === "IEND") break;

    pos += 12 + tamanho; // tamanho + tipo(4) + dados + crc(4)
  }

  return { largura, canais, cru: zlib.inflateSync(Buffer.concat(idat)) };
}

/** 0 (preto) a 1 (branco). Fórmula da luminância relativa, arredondada. */
const claridade = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const g = await galeriaDaRodada(db, { nome: "cartao", medias: 2, publicada: true });
const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

/*
 * COM SENHA de propósito: a galeria trancada não põe a foto no cartão (ver o
 * cabeçalho de `opengraph-image.tsx`), e o quadro fica sendo só a cor do tema.
 * É o que permite medir a cor sem depender de qual foto caiu ali.
 */
await db.query("update galerias set senha_hash = $1 where id = $2", ["$2b$10$naoimporta", g.id]);

async function cartaoDe(aparencia) {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify(aparencia),
    g.id,
  ]);
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const endereco = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
  if (!endereco) throw new Error("a página não declara og:image");
  /*
   * ── O CARTÃO É BUSCADO NA BANCADA, E NÃO EM PRODUÇÃO (18/09/2026) ───────
   *
   * `metadataBase` (em `app/layout.tsx`) torna toda URL de metadado ABSOLUTA
   * contra o domínio de verdade — que é o certo para o WhatsApp, que lê a
   * etiqueta de fora. Só que `new URL(absoluta, BASE)` ignora a base: este
   * teste saía da bancada e ia buscar o cartão em galeriaatomo.com.br.
   *
   * Isso é errado de duas maneiras, e as duas apareceram: numa máquina com
   * saída para a internet ele media A PRODUÇÃO em vez do build que acabou de
   * ser construído — verde sobre código que ninguém testou; e numa máquina sem
   * saída (a deste ambiente, que barra o domínio) ele reprovava por 403, com o
   * cartão local respondendo 200 e um PNG de 1200×630 perfeito.
   *
   * O CAMINHO é o que interessa; a origem é a bancada.
   */
  const caminho = new URL(endereco, BASE);
  const noBanco = new URL(caminho.pathname + caminho.search, BASE);
  const r = await fetch(noBanco, { cache: "no-store" });
  if (!r.ok) throw new Error(`o cartão respondeu HTTP ${r.status}`);
  const tipo = r.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/png")) throw new Error(`o cartão veio como ${tipo}`);
  return { png: Buffer.from(await r.arrayBuffer()), html };
}

const base = { capa: "imersa", tipografia: "serifada", grade: "colunas", densidade: "normal" };

console.log("A cor do cartão segue a galeria\n");

try {
  for (const [nome, aparencia, esperado] of [
    ["claro", { ...base, tema: "claro" }, "claro"],
    ["noite", { ...base, tema: "noite" }, "escuro"],
    ["creme", { ...base, tema: "creme" }, "claro"],
    /* Cor própria por cima do tema escuro: quem escolheu branco no editor
       escolheu branco no cartão, e o tema de baixo não decide por ela. */
    [
      "noite com fundo branco escolhido à mão",
      { ...base, tema: "noite", cores: { fundo: "#ffffff", texto: "#211d16" } },
      "claro",
    ],
  ]) {
    const { png } = await cartaoDe(aparencia);
    const pixel = primeiroPixel(png);
    const luz = claridade(pixel);
    const veio = luz > 0.6 ? "claro" : luz < 0.25 ? "escuro" : "meio-termo";
    const passou = veio === esperado;
    const detalhe = `rgb(${pixel.r},${pixel.g},${pixel.b}) · luz ${luz.toFixed(2)}`;
    if (passou) ok(`tema ${nome} gera cartão ${esperado}`, detalhe);
    else erro(`tema ${nome} devia gerar cartão ${esperado} e veio ${veio} — ${detalhe}`);
  }

  console.log("\nO nome no cartão é o do casal, não o nosso\n");

  const { html } = await cartaoDe({ ...base, tema: "claro" });
  const meta = (prop) =>
    html.match(new RegExp(`property="${prop}"\\s+content="([^"]*)"`))?.[1] ?? "";

  const ogTitulo = meta("og:title");
  if (ogTitulo.includes(g.titulo)) ok("og:title traz o nome da galeria", ogTitulo);
  else erro(`og:title é "${ogTitulo}" — devia trazer "${g.titulo}"`);

  const ogDescricao = meta("og:description");
  if (ogDescricao.includes(g.estudio.nome_estudio)) {
    ok("og:description traz o nome do estúdio", ogDescricao);
  } else {
    erro(`og:description é "${ogDescricao}" — devia falar do estúdio "${g.estudio.nome_estudio}"`);
  }

  /*
   * O og:image tem de apontar para o cartão DESTA galeria.
   *
   * É a causa-raiz que ficou escondida por uma semana: sem o bloco `openGraph`
   * próprio, o Next resolvia o da raiz e mandava junto o `opengraph-image` da
   * RAIZ — o quadro da plataforma. O arquivo por galeria existia desde
   * 31/08/2026 e simplesmente não era pedido. Sem esta linha, alguém "limpa" o
   * bloco de metadados um dia e o cartão volta a ser o nosso, em silêncio.
   */
  const ogImagem = meta("og:image");
  if (ogImagem.includes(`/g/${g.tslug}/${g.gslug}/opengraph-image`)) {
    ok("og:image aponta para o cartão desta galeria");
  } else {
    erro(`og:image é "${ogImagem}" — devia ser o cartão da galeria, não o da raiz`);
  }

  /* A frase de venda da plataforma não pode aparecer na entrega de ninguém. */
  const { marca } = await import("../src/config/marca.ts");
  const vazou = [ogTitulo, ogDescricao].filter(
    (t) => t.includes(marca.tagline) || t.includes(marca.descricao),
  );
  if (!vazou.length) ok("e a frase de venda da plataforma não vaza para o cartão");
  else erro(`o cartão anuncia a plataforma: ${vazou.join(" / ")}`);

  /*
   * ── A CAPA EM WEBP NÃO PODE DERRUBAR O CARTÃO ───────────────────────────
   *
   * Achado ao consertar o resto, e é o defeito mais caro dos três: o satori
   * não decodifica WebP. Alimentado com um, ele estoura com "u2 is not
   * iterable", a rota fecha a conexão, e o robô do WhatsApp — que diante de
   * erro desiste — mostra o LINK PELADO. Pior que qualquer cartão feio.
   *
   * Não era hipótese: rodei o `ImageResponse` à mão com a derivada de uma
   * galeria real e ele estourou; com uma JPEG, desenhou. E as 1009 derivadas
   * de foto do banco são `.webp`, todas.
   *
   * Ficou escondido porque a página da galeria nem chegava a usar este cartão
   * — sem bloco `openGraph` próprio, o Next servia o da raiz. Consertar o
   * texto do cartão ligaria a imagem de verdade pela primeira vez, e o
   * primeiro efeito seria trocar "cartão da plataforma" por "cartão nenhum".
   *
   * A saída é cair no ORIGINAL, que é o arquivo que o fotógrafo enviou —
   * JPEG, na prática. Aqui a prova é por cor: o original de teste é um pixel
   * magenta, e o topo do cartão não tem véu (a última parada do gradiente é
   * transparente). Se o magenta aparecer, a foto entrou.
   */
  console.log("\nA capa em WebP não derruba o cartão\n");

  /* Um PNG 1×1 de verdade, montado aqui — o satori precisa decodificar. */
  function pngDeUmPixel(r, g2, b) {
    const bloco = (tipo, dados) => {
      const nome = Buffer.from(tipo, "ascii");
      const tamanho = Buffer.alloc(4);
      tamanho.writeUInt32BE(dados.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(Buffer.concat([nome, dados])));
      return Buffer.concat([tamanho, nome, dados, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); // largura
    ihdr.writeUInt32BE(1, 4); // altura
    ihdr[8] = 8; // 8 bits por canal
    ihdr[9] = 2; // RGB
    return Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      bloco("IHDR", ihdr),
      /* Uma linha: o byte de filtro (0) e os três canais. */
      bloco("IDAT", zlib.deflateSync(Buffer.from([0, r, g2, b]))),
      bloco("IEND", Buffer.alloc(0)),
    ]);
  }

  const { urlDeUpload, apagarObjeto } = await import("../src/lib/r2.ts");
  const enviar = async (chave, bytes, mime) => {
    const r = await fetch(await urlDeUpload(chave, mime, 300), {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes,
    });
    if (!r.ok) throw new Error(`não consegui subir ${chave}: HTTP ${r.status}`);
  };

  const capa = g.midias[0];
  const chavesDeTeste = [capa.chave, capa.chave.replace(/\.jpg$/, "_prev.webp")];
  try {
    /* Derivada em WebP (o que o produto gera hoje) e original em PNG. */
    await enviar(chavesDeTeste[1], Buffer.from("RIFF....WEBPnaoimporta"), "image/webp");
    await enviar(chavesDeTeste[0], pngDeUmPixel(255, 0, 255), "image/png");
    await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

    /* A rota que estoura DERRUBA A CONEXÃO — o `fetch` rejeita em vez de
       devolver um status. É por isso que cada passo destes anda com o próprio
       try: sem ele o arquivo morre aqui e nem os passos seguintes rodam, que é
       justamente o que aconteceu na primeira execução. */
    try {
      const { png } = await cartaoDe({ ...base, tema: "claro" });
      const pixel = primeiroPixel(png);
      const magenta = pixel.r > 200 && pixel.g < 80 && pixel.b > 200;
      const detalhe = `rgb(${pixel.r},${pixel.g},${pixel.b})`;
      if (magenta) ok("derivada WebP cai no original e a foto entra no cartão", detalhe);
      else erro(`a foto não entrou no cartão — topo veio ${detalhe}, esperava magenta`);
    } catch (e) {
      erro(`derivada WebP derrubou a rota do cartão — ${e.message} / ${e.cause?.message ?? ""}`);
    }

    /* E quando NEM o original serve, o cartão ainda tem de existir. */
    await enviar(chavesDeTeste[0], Buffer.from("RIFF....WEBPnaoimporta"), "image/webp");
    try {
      const semFoto = await cartaoDe({ ...base, tema: "claro" });
      const p2 = primeiroPixel(semFoto.png);
      if (claridade(p2) > 0.6) {
        ok("nada desenhável: o cartão neutro entra, e não a conexão fechada",
          `rgb(${p2.r},${p2.g},${p2.b})`);
      } else {
        erro(`sem foto desenhável o cartão saiu rgb(${p2.r},${p2.g},${p2.b})`);
      }
    } catch (e) {
      erro(`sem foto desenhável a rota caiu — ${e.message} / ${e.cause?.message ?? ""}`);
    }
    /*
     * ── "NÃO GOSTO DAQUELE GRADIENTE BRANCO" (08/09/2026) ─────────────────
     *
     * Carol, olhando o cartão já corrigido: "não acho bonita a prévia, não
     * gosto daquele gradiente branco ali, queria que fosse mais clean".
     *
     * O véu existe para o texto ler sobre qualquer foto — e o argumento a
     * favor de poder desligá-lo é que, sem ele, NADA se perde: o WhatsApp já
     * escreve o título e a descrição ao lado da imagem, e desde 06/09/2026
     * esses dois são o nome da galeria e o do estúdio. O texto sobre a foto
     * era a segunda cópia da mesma informação, com um gradiente por cima da
     * foto para pagá-la.
     *
     * `sobreposto` continua sendo o padrão — galeria entregue não muda de
     * cara. A prova aqui é por cor, na faixa de baixo: com a foto magenta
     * esticada, `foto` deixa magenta onde `sobreposto` deixa a cor do tema.
     */
    await enviar(chavesDeTeste[0], pngDeUmPixel(255, 0, 255), "image/png");
    for (const [modo, esperado] of [
      ["foto", "magenta"],
      ["sobreposto", "cor do tema"],
    ]) {
      try {
        const { png } = await cartaoDe({ ...base, tema: "claro", cartao: modo });
        /* Onde o véu é mais forte: a faixa do texto, perto do rodapé. */
        const p = lerPixel(png, 100, 560);
        const ehMagenta = p.r > 200 && p.g < 80 && p.b > 200;
        const veio = ehMagenta ? "magenta" : "cor do tema";
        const detalhe = `rgb(${p.r},${p.g},${p.b})`;
        if (veio === esperado) ok(`cartão "${modo}": o rodapé é ${esperado}`, detalhe);
        else erro(`cartão "${modo}" devia ter rodapé ${esperado} e veio ${veio} — ${detalhe}`);
      } catch (e) {
        erro(`cartão "${modo}" derrubou a rota — ${e.message}`);
      }
    }

    /* O modo limpo NÃO pode virar retângulo vazio quando não há foto: sem nada
       para mostrar, o cartão volta a ter o fundo e o nome. */
    await enviar(chavesDeTeste[0], Buffer.from("RIFF....WEBPnaoimporta"), "image/webp");
    try {
      const { png } = await cartaoDe({ ...base, tema: "claro", cartao: "foto" });
      const p = lerPixel(png, 100, 560);
      if (claridade(p) > 0.6) {
        ok("modo limpo sem foto ainda desenha o cartão com o nome", `rgb(${p.r},${p.g},${p.b})`);
      } else {
        erro(`modo limpo sem foto saiu rgb(${p.r},${p.g},${p.b}) — esperava o fundo claro`);
      }
    } catch (e) {
      erro(`modo limpo sem foto derrubou a rota — ${e.message}`);
    }
  } finally {
    /* Só as chaves que este teste criou. */
    for (const c of chavesDeTeste) await apagarObjeto(c).catch(() => {});
    await db.query("update galerias set senha_hash = $1 where id = $2", [
      "$2b$10$naoimporta",
      g.id,
    ]);
  }

  /* Galeria continua fora de busca — o cartão é para quem tem o link. */
  if (/name="robots"\s+content="[^"]*noindex/.test(html)) {
    ok("e a galeria segue fora dos buscadores");
  } else {
    erro("a galeria perdeu o noindex — link pessoal não pode entrar em busca");
  }
} finally {
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ o cartão do WhatsApp tem problema");
  process.exit(1);
}
console.log("\n✓ o cartão do WhatsApp segue a galeria");
