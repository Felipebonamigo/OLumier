#!/usr/bin/env node
/**
 * O NOME DO ARQUIVO BAIXADO LEVA O CAPÍTULO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-nome-com-capitulo.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── DE ONDE VEIO (10/09/2026) ─────────────────────────────────────────────
 *
 * Juan pediu "escolher se será feito todas de uma única vez ou se será separado
 * em pastas". O menu de baixar por capítulo saiu no mesmo dia — mas ele escolhe
 * a LISTA, não separa nada: baixar "Recepção" e depois "Festa" larga 1.077
 * arquivos soltos no mesmo monte de downloads, que é exatamente o que "separado
 * em pastas" existiria para evitar.
 *
 * Zip no servidor continua recusado (puxar a galeria inteira para cá é lento
 * para o casal e caro para nós — ver galeria-cliente.tsx). O que dá para fazer
 * sem servidor de empacotamento é o nome: com "Recepção - " na frente, os
 * arquivos de um capítulo ficam juntos em qualquer pasta, em qualquer sistema,
 * porque toda listagem ordena por nome.
 *
 * ── POR QUE O TESTE MIRA NA URL ASSINADA, E NÃO NO COMPONENTE ─────────────
 *
 * Porque no computador o `a.download` do nosso código É IGNORADO: a URL do
 * arquivo é do armazém (outra origem), e nessa condição o navegador obedece ao
 * `Content-Disposition` que veio assinado, não ao atributo. Medido em 10/09.
 *
 * Ou seja: prefixo posto só no cliente não mudaria UMA LETRA no computador do
 * Juan — que é onde ele disse estar pensando. Este arquivo, por isso, decodifica
 * o `response-content-disposition` da URL que a rota assina. É a única prova que
 * vale para o PC.
 *
 * O celular é o caso oposto (o nome vem do JavaScript, no `new File`), e por
 * isso a última etapa cobra que os dois lados chamem a MESMA função.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { nomeComCapitulo } from "../src/lib/nome-de-arquivo.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

console.log("A regra do nome:\n");

await etapa("sem capítulo, o nome não é tocado", () => {
  for (const vazio of [null, undefined, "", "   "]) {
    const r = nomeComCapitulo("foto-01.jpg", vazio);
    if (r !== "foto-01.jpg") throw new Error(`${JSON.stringify(vazio)} virou ${JSON.stringify(r)}`);
  }
  return "4 casos";
});

await etapa("com capítulo, ele vai na frente", () => {
  const r = nomeComCapitulo("foto-01.jpg", "Recepção");
  if (r !== "Recepção - foto-01.jpg") throw new Error(`veio ${JSON.stringify(r)}`);
  return r;
});

/* O nome do capítulo é texto que o FOTÓGRAFO escreve, e vai virar nome de
   arquivo no computador de outra pessoa. Barra e dois-pontos são os que doem:
   uma vira caminho, o outro é ilegal no Windows. */
await etapa("caractere que não pode existir em nome de arquivo é removido", () => {
  const r = nomeComCapitulo("a.jpg", 'Festa/Noite: "a melhor" <parte> | 1*2?');
  for (const proibido of ["/", "\\", ":", '"', "<", ">", "|", "*", "?"]) {
    if (r.includes(proibido)) throw new Error(`sobrou ${proibido} em ${JSON.stringify(r)}`);
  }
  if (!r.endsWith("a.jpg")) throw new Error(`o nome do arquivo se perdeu: ${JSON.stringify(r)}`);
  return r;
});

await etapa("capítulo comprido é aparado", () => {
  const r = nomeComCapitulo("a.jpg", "x".repeat(120));
  if (r.length > 80) throw new Error(`${r.length} caracteres — vira caminho longo demais`);
  return `${r.length} caracteres`;
});

await etapa("capítulo que vira vazio depois da limpeza não prefixa nada", () => {
  /* "///" limpo é "" — e "" + " - " + nome seria um nome começando com traço. */
  const r = nomeComCapitulo("a.jpg", "///");
  if (r !== "a.jpg") throw new Error(`veio ${JSON.stringify(r)}`);
});

await etapa("acento é preservado — é nome de capítulo, não de arquivo de sistema", () => {
  const r = nomeComCapitulo("a.jpg", "Cerimônia");
  if (!r.startsWith("Cerimônia")) throw new Error(`veio ${JSON.stringify(r)}`);
});

console.log("\nO que a URL assinada manda para o computador:\n");

const g = await galeriaDaRodada(db, { nome: "nome-capitulo", medias: 3, publicada: true });
await db.query("update galerias set senha_hash = null, permite_download = true where id = $1", [
  g.id,
]);

/** O nome que o navegador vai gravar no disco, lido do `Content-Disposition`. */
const nomeQueChega = async (mediaId) => {
  const r = await fetch(`${BASE}/api/g/${g.id}/urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [mediaId], tipo: "download" }),
  });
  if (!r.ok) throw new Error(`a rota respondeu ${r.status}`);
  const { urls } = await r.json();
  const url = urls[mediaId];
  if (!url) throw new Error("a rota não assinou esta foto");
  const disposition = new URL(url).searchParams.get("response-content-disposition");
  if (!disposition) throw new Error("a URL não traz response-content-disposition");
  /* `filename*=UTF-8''...` é a forma que carrega acento; é ela que o navegador
     prefere quando as duas existem. */
  const estrela = disposition.match(/filename\*=UTF-8''([^;]+)/);
  if (estrela) return decodeURIComponent(estrela[1]);
  return disposition.match(/filename="([^"]*)"/)?.[1] ?? "";
};

await etapa("galeria sem capítulo nenhum: nome puro, como sempre foi", async () => {
  const nome = await nomeQueChega(g.midias[0].id);
  if (nome !== g.midias[0].nome_original) {
    throw new Error(`veio ${JSON.stringify(nome)}, esperava ${JSON.stringify(g.midias[0].nome_original)}`);
  }
  return nome;
});

let capA, capB;
await etapa("com dois capítulos, o arquivo chega com o capítulo na frente", async () => {
  const { rows } = await db.query(
    `insert into secoes (galeria_id, nome, ordem)
          values ($1, 'Cerimônia', 0), ($1, 'Festa', 1) returning id, nome`,
    [g.id],
  );
  [capA, capB] = rows;
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[0].id, capA.id]);
  await db.query("update medias set secao_id = $2 where id = $1", [g.midias[1].id, capB.id]);

  const um = await nomeQueChega(g.midias[0].id);
  const dois = await nomeQueChega(g.midias[1].id);
  if (!um.startsWith("Cerimônia - ")) throw new Error(`o da Cerimônia veio ${JSON.stringify(um)}`);
  if (!dois.startsWith("Festa - ")) throw new Error(`o da Festa veio ${JSON.stringify(dois)}`);
  return `${um} · ${dois}`;
});

await etapa("a foto solta, no meio de capítulos, vira “Outras fotos”", async () => {
  /* O mesmo nome que o menu de baixar mostra para esse grupo — o cliente
     escolhe "Outras fotos (318)" e os arquivos chegam marcados assim. */
  const solta = await nomeQueChega(g.midias[2].id);
  if (!solta.startsWith("Outras fotos - ")) throw new Error(`veio ${JSON.stringify(solta)}`);
  return solta;
});

await etapa("com UM capítulo só, não há o que separar: nome puro", async () => {
  /* Mesma régua do menu, que também não oferece pasta quando só existe uma:
     prefixar todas as fotos com o mesmo texto não separa nada, só alonga. */
  await db.query("update medias set secao_id = $2 where galeria_id = $1", [g.id, capA.id]);
  try {
    const nome = await nomeQueChega(g.midias[0].id);
    if (nome !== g.midias[0].nome_original) throw new Error(`veio ${JSON.stringify(nome)}`);
    return nome;
  } finally {
    await db.query("update medias set secao_id = null where galeria_id = $1", [g.id]);
    await db.query("update medias set secao_id = $2 where id = $1", [g.midias[0].id, capA.id]);
    await db.query("update medias set secao_id = $2 where id = $1", [g.midias[1].id, capB.id]);
  }
});

await etapa("o preview NÃO ganha prefixo — não é arquivo que a pessoa guarda", async () => {
  const r = await fetch(`${BASE}/api/g/${g.id}/urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [g.midias[0].id], tipo: "preview" }),
  });
  const { urls } = await r.json();
  const d = new URL(urls[g.midias[0].id]).searchParams.get("response-content-disposition");
  if (d && /Cerimônia/.test(decodeURIComponent(d))) {
    throw new Error("o preview veio com nome de download");
  }
  return "sem prefixo";
});

console.log("\nO celular usa a mesma régua:\n");

/*
 * No celular o nome NÃO vem do Content-Disposition: vem do `new File([blob],
 * nome)` do nosso JavaScript. São dois lugares decidindo o mesmo nome, e a
 * única defesa contra eles divergirem é chamarem a mesma função.
 */
await etapa("o componente da galeria monta o nome pela mesma função", () => {
  const fonte = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/galeria-cliente.tsx"),
    "utf8",
  );
  /* O componente chama por um auxiliar (`nomeDeArquivo`), que é onde o capítulo
     de cada foto é procurado. O que se cobra aqui é a GARANTIA — que o nome
     entregue passe pela função compartilhada — e não a grafia dela em cada
     chamada; exigir o nome literal em toda linha obrigaria a repetir a busca do
     capítulo em cada ponto de download, que é justamente o jeito de os dois
     lados divergirem. */
  const auxiliar = fonte.match(/const nomeDeArquivo = [^]*?\);/)?.[0] ?? "";
  if (!/nomeComCapitulo/.test(auxiliar)) {
    throw new Error("o cliente não passa pelo nomeComCapitulo — o celular perderia o capítulo");
  }
  /* E a foto avulsa também: baixar UMA da Recepção tem de chegar igual à que
     veio no lote, senão o mesmo arquivo tem dois nomes. */
  const umaFoto = fonte.match(/async function salvarUm\([^]*?\n  \}/)?.[0] ?? "";
  if (/\bit\.nome\b/.test(umaFoto)) {
    throw new Error("baixar UMA foto ainda usa o nome cru — o mesmo arquivo teria dois nomes");
  }
  if (!/nomeDeArquivo\(it\)/.test(umaFoto)) {
    throw new Error("baixar UMA foto não monta o nome pelo auxiliar");
  }
  /* E o lote, que é o caminho do "baixar a pasta". Desde 16/09/2026 o celular
     não monta mais o nome do lote: ele vem pronto de `api/g/[id]/lista`, que
     passa por `nomeNaEntrega` → `nomeComCapitulo`. O comportamento é conferido
     de ponta a ponta em `testar-lista-de-entrega.mjs`; aqui se prende que o
     caminho continua sendo a função compartilhada. */
  const raiz = path.resolve(import.meta.dirname, "..");
  const rotaLista = readFileSync(path.join(raiz, "src/app/api/g/[id]/lista/route.ts"), "utf8");
  const entrega = readFileSync(path.join(raiz, "src/lib/entrega-da-galeria.ts"), "utf8");
  const funcao = entrega.match(/export function nomeNaEntrega[^]*?\n\}/)?.[0] ?? "";
  if (!/nomeNaEntrega\(/.test(rotaLista) || !/nomeComCapitulo\(/.test(funcao)) {
    throw new Error("o lote do celular não monta o nome pela função compartilhada");
  }
  return "lote e foto avulsa";
});

await etapa("o nome DE TELA continua sem prefixo", () => {
  /* O prefixo é do arquivo, não da interface: a legenda da foto e o rótulo do
     botão devem seguir dizendo o nome que o fotógrafo enviou. */
  const fonte = readFileSync(
    path.join(path.resolve(import.meta.dirname, ".."), "src/components/galeria-cliente.tsx"),
    "utf8",
  );
  const rotulos = fonte.match(/aria-label=\{`Baixar \$\{[^}]+\}`\}/g) ?? [];
  if (rotulos.some((r) => /nomeComCapitulo/.test(r))) {
    throw new Error("o prefixo vazou para o rótulo do botão");
  }
  return `${rotulos.length} rótulo(s) intactos`;
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o nome com capítulo tem problema" : "\n✓ nome com capítulo ok");
process.exit(falhou ? 1 : 0);
