/*
 * ── A ENTREGA NEM SEMPRE É DE FOTO (07/10/2026) ───────────────────────────
 *
 * A GM Creative, por WhatsApp, depois de mandar a galeria para o cliente dela:
 *
 *   "Não sei se tem uma opção também, sei que a galeria é para fotógrafos.
 *    Mas a gente amou muito e já enviei para o cliente testar se deu tudo
 *    certo. Porém, se aparecer fotos ali eles vão confundir muuuito!"
 *
 * O cartão que o cliente dela recebeu no WhatsApp dizia "Fotos por GM
 * CREATIVE" — texto fixo no código, de quando a plataforma só pensava em
 * fotografia. A entrega dela tem vídeo.
 *
 * Felipe, no mesmo dia: "lembre-se, é uma galeria de fotos e vídeos".
 *
 * A regra mora aqui fora para ser respondida sem banco e sem rede: ela é
 * decidida por dois números, e um teste que precise subir galeria para
 * conferir o plural de uma palavra nunca vai ser rodado.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { creditoDaEntrega } from "../src/lib/palavra-da-entrega.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let vermelhas = 0;
async function etapa(nome, fn) {
  try {
    const nota = await fn();
    console.log(`  ✓ ${nome}${nota ? ` — ${nota}` : ""}`);
  } catch (e) {
    vermelhas++;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b) => {
  if (a !== b) throw new Error(`veio ${JSON.stringify(a)}, esperava ${JSON.stringify(b)}`);
};

console.log("A palavra da entrega:\n");

/* ── A REGRA, SEM BANCO ──────────────────────────────────────────────────── */

await etapa("só foto continua dizendo Fotos — é o que 500 galerias já entregues dizem", () => {
  igual(creditoDaEntrega({ fotos: 120, videos: 0, estudio: "GM CREATIVE" }), "Fotos por GM CREATIVE");
  return "Fotos por X";
});

await etapa("só vídeo diz Vídeos — a queixa que chegou", () => {
  igual(creditoDaEntrega({ fotos: 0, videos: 8, estudio: "GM CREATIVE" }), "Vídeos por GM CREATIVE");
  return "Vídeos por X";
});

await etapa("os dois juntos dizem os dois", () => {
  igual(creditoDaEntrega({ fotos: 90, videos: 4, estudio: "GM CREATIVE" }), "Fotos e vídeos por GM CREATIVE");
  return "Fotos e vídeos por X";
});

await etapa("galeria ainda vazia não promete nem um nem outro", () => {
  /* Antes de subir o primeiro arquivo não há verdade a dizer sobre o conteúdo
     — e chutar "Fotos" aqui é exatamente o defeito que estamos consertando,
     só que mais cedo. O crédito ao estúdio continua, porque esse é certo. */
  igual(creditoDaEntrega({ fotos: 0, videos: 0, estudio: "GM CREATIVE" }), "Por GM CREATIVE");
  return "Por X";
});

await etapa("sem nome de estúdio não sobra crédito nenhum", () => {
  /* O cartão junta os pedaços com " · ". Um pedaço vazio viraria um ponto
     solto no fim da frase. */
  igual(creditoDaEntrega({ fotos: 10, videos: 0, estudio: "" }), "");
  igual(creditoDaEntrega({ fotos: 10, videos: 0, estudio: null }), "");
  return "vazio";
});

await etapa("um vídeo só já conta — não existe 'pouco vídeo para contar'", () => {
  igual(creditoDaEntrega({ fotos: 300, videos: 1, estudio: "X" }), "Fotos e vídeos por X");
  return "1 vídeo em 300 fotos ainda é vídeo";
});

/* ── O TEXTO DA GALERIA NÃO PODE VOLTAR A ASSUMIR FOTO ───────────────────── */

/*
 * Esta varredura é de FONTE, e isso é uma escolha, não preguiça: os textos que
 * interessam moram em caixas que só existem depois de um clique — confirmar a
 * escolha, falhar o download, a dica do iPhone. Provar cada um pelo navegador
 * pediria encenar o estado inteiro da galeria; o que precisa ser guardado é
 * mais simples e mais duradouro — que ninguém escreva "foto" de novo onde a
 * entrega pode ser filme.
 *
 * O teste que prova pelo DESENHO é o do aviso do limite, em
 * `scripts/testar-selecao.mjs`, que lê a página como um convidado leria.
 */
await etapa("nenhum texto da galeria chama a entrega de foto", async () => {
  /* As telas que o CLIENTE lê. A do fotógrafo fica de fora de propósito: ele
     sabe o que subiu, e lá "fotos" ainda é a palavra dele. */
  const telas = [
    "../src/components/galeria-cliente.tsx",
    "../src/components/menus-da-galeria.tsx",
  ];

  /* Onde "foto" continua VERDADE, e por quê. Lista curta de propósito: cada
     item aqui é uma promessa de que aquele lugar só mostra foto mesmo. */
  const verdadeiras = [
    "Suas fotos", // busca por rosto — ela só encontra foto
    "app Fotos", // o nome do aplicativo do iPhone, não a nossa palavra
    "Google Fotos", // idem, no Android
  ];

  /* Nome técnico não é lido por ninguém: parâmetro de endereço (?fotos=),
     atributo de contrato (data-sobre-a-foto), chave de cache. O que distingue
     é não ter espaço — frase para gente tem. */
  const nomeTecnico = (texto) => !/\s/.test(texto) || texto.startsWith("data-");

  const problemas = [];
  for (const tela of telas) {
    const bruto = await readFile(new URL(tela, import.meta.url), "utf8");
    /* Comentário fora ANTES de olhar: metade deste arquivo explica por que o
       texto é o que é, e várias dessas explicações CITAM a palavra antiga.
       Uma varredura que lesse comentário reprovaria a própria documentação —
       e foi o que aconteceu na primeira versão desta etapa. */
    const semBloco = bruto.replace(/\/\*[\s\S]*?\*\//g, "");
    const codigo = semBloco
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("import "))
      .join("\n");

    for (const [, texto] of codigo.matchAll(/["`]([^"`\n]{6,})["`]/g)) {
      /* O que esta DENTRO de ${...} e codigo, nao texto: sem tirar isso, um
         parametro de endereco como `?fotos=${ids.map((x) => x.id)}` parece
         frase, porque a funcao ali dentro tem espaco. */
      const legivel = texto.replace(/[$][{][^}]*[}]/g, "");
      if (!/\bfotos?\b/i.test(legivel)) continue;
      if (verdadeiras.some((v) => texto.includes(v))) continue;
      if (nomeTecnico(legivel)) continue;
      /* Frase que alguem le comeca com letra. Endereco (?fotos=), caminho e
         chave nao comecam — e foi onde a varredura tropecou tres vezes antes
         de eu parar de remendar a expressao e trocar o criterio. */
      if (!/^[A-Za-zÀ-ÿ]/.test(legivel.trim())) continue;
      problemas.push(`${tela.split("/").pop()}: ${texto.slice(0, 70)}`);
    }
  }

  if (problemas.length) {
    throw new Error(`ainda falam em foto:\n      - ${problemas.join("\n      - ")}`);
  }
  return `${telas.length} telas limpas`;
});

/* ── E O CARTÃO DE VERDADE ───────────────────────────────────────────────── */

await exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const g = await galeriaDaRodada(db, { nome: "palavra", medias: 3 });
  await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [g.id]);

  const descricaoDoCartao = async () => {
    const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
    return html.match(/property="og:description"\s+content="([^"]*)"/)?.[1] ?? "";
  };

  await etapa("galeria só de fotos: o cartão diz Fotos", async () => {
    const d = await descricaoDoCartao();
    if (!/Fotos por /.test(d)) throw new Error(`og:description é "${d}"`);
    if (/vídeo/i.test(d)) throw new Error(`falou de vídeo sem ter nenhum: "${d}"`);
    return d;
  });

  await etapa("virando tudo vídeo, o cartão para de dizer Fotos", async () => {
    /* É o caso da GM Creative: a entrega inteira é filme. */
    await db.query("update medias set tipo = 'video' where galeria_id = $1", [g.id]);
    const d = await descricaoDoCartao();
    if (!/Vídeos por /.test(d)) throw new Error(`og:description é "${d}"`);
    if (/Fotos/.test(d)) throw new Error(`ainda diz Fotos numa entrega só de vídeo: "${d}"`);
    return d;
  });

  await etapa("com os dois, o cartão diz os dois", async () => {
    const { rows } = await db.query(
      "select id from medias where galeria_id = $1 order by ordem limit 1",
      [g.id],
    );
    await db.query("update medias set tipo = 'foto' where id = $1", [rows[0].id]);
    const d = await descricaoDoCartao();
    if (!/Fotos e vídeos por /.test(d)) throw new Error(`og:description é "${d}"`);
    return d;
  });

  await etapa("mídia que ainda não ficou pronta não decide a palavra", async () => {
    /* Arquivo no meio do envio não está na galeria para ninguém. Se contasse,
       o cartão mudaria de palavra durante o upload e voltaria depois. */
    await db.query("update medias set tipo = 'video', pronto = false where galeria_id = $1", [g.id]);
    const { rows } = await db.query(
      "select id from medias where galeria_id = $1 order by ordem limit 1",
      [g.id],
    );
    await db.query("update medias set tipo = 'foto', pronto = true where id = $1", [rows[0].id]);
    const d = await descricaoDoCartao();
    if (/vídeo/i.test(d)) throw new Error(`contou vídeo que ainda não está pronto: "${d}"`);
    return d;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ a palavra da entrega segue o que a entrega tem\n");
