#!/usr/bin/env node
/**
 * Os termos, e o momento em que alguém os aceita. Uso:
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-termos.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O QUE ISTO FECHA ──────────────────────────────────────────────────────
 *
 * Os Termos e a Política de Privacidade existiam desde cedo, bem escritos, e
 * ninguém nunca os aceitou: o cadastro não os mencionava nem linkava, e eles só
 * apareciam no rodapé das páginas institucionais. Termo que a pessoa não viu no
 * momento de se comprometer vale muito menos do que um que ela viu — e a
 * diferença entre os dois é uma frase na tela de criar conta.
 *
 * As etapas de CONTEÚDO existem porque texto jurídico é o que mais silenciosamente
 * se perde numa reescrita de página: sai um parágrafo, ninguém nota, e o buraco
 * só aparece no dia em que alguém precisa dele.
 *
 * O que NÃO é testado aqui, e é bom deixar dito: se o texto vale em juízo.
 * Cláusula que EXCLUI a responsabilidade do fornecedor é anulável pelo CDC
 * (art. 51, I); a que LIMITA sobrevive melhor. Os dois textos convivem de
 * propósito — o teste só garante que ambos continuam lá.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

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

const pegar = async (caminho) => {
  const r = await fetch(new URL(caminho, BASE));
  if (!r.ok) throw new Error(`${caminho} devolveu HTTP ${r.status}`);
  return r.text();
};

/** Texto visível, sem marcação e sem escapes do payload do React. */
const limpo = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\\u([0-9a-f]{4})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ");

console.log("Termos e aceite:\n");

/* ── as páginas existem ──────────────────────────────────────────────────── */

for (const caminho of ["/termos", "/privacidade", "/seguranca"]) {
  await etapa(`${caminho} responde`, async () => {
    const html = await pegar(caminho);
    if (limpo(html).length < 800) throw new Error("página quase vazia");
  });
}

/* ── o aceite, que é o que faltava ───────────────────────────────────────── */

await etapa("o cadastro linka os Termos e a Privacidade", async () => {
  const html = await pegar("/cadastrar");
  for (const destino of ["/termos", "/privacidade"]) {
    if (!html.includes(`"${destino}"`)) {
      throw new Error(`não há link para ${destino} — ninguém aceita o que não viu`);
    }
  }
});

await etapa("e diz, em texto, que criar a conta é aceitar", async () => {
  /* O link sozinho não é aceite: é só um link no rodapé de outra forma. A frase
   * é o que transforma o clique em concordância. */
  const texto = limpo(await pegar("/cadastrar"));
  if (!/ao criar (a |sua )?conta[^.]*aceit/i.test(texto)) {
    throw new Error("falta a frase que liga criar a conta a aceitar os termos");
  }
});

await etapa('o cadastro avisa "entrega, não backup" MESMO fora do beta', async () => {
  /*
   * A frase era a segunda metade de `marca.betaExplicacao`. Desligar o beta —
   * uma linha em config/marca.ts — apagaria junto o aviso mais importante do
   * produto, em silêncio e sem ninguém decidir isso.
   *
   * A etapa simula o dia em que o beta acabar: lê o texto da configuração e
   * confere que ele NÃO depende da bandeira, e que a página o mostra.
   */
  const { marca } = await import("../src/config/marca.ts");
  if (/beta/i.test(marca.entregaNaoBackup)) {
    throw new Error("o aviso voltou a falar de beta — vai sumir junto com ele");
  }
  if (/entrega, n[ãa]o.{0,3}backup/i.test(marca.betaExplicacao)) {
    throw new Error("o aviso voltou para DENTRO do texto do beta");
  }

  const texto = limpo(await pegar("/cadastrar"));
  if (!/ferramenta de entrega, n[ãa]o de backup/i.test(texto)) {
    throw new Error("o cadastro não mostra o aviso");
  }
});

/* ── o conteúdo que não pode sumir numa reescrita ────────────────────────── */

await etapa("os termos põem os DIREITOS das fotos no usuário", async () => {
  const t = limpo(await pegar("/termos"));
  const exigidos = [
    [/direitos sobre o material|direitos sobre as fotos/i, "que a pessoa declara ter os direitos"],
    [/autoriza[çc][ãa]o das pessoas retratadas/i, "a autorização de quem aparece nas fotos"],
    [/n[ãa]o (temos como )?verifica/i, "que não temos como verificar isso"],
  ];
  for (const [padrao, oque] of exigidos) {
    if (!padrao.test(t)) throw new Error(`sumiu dos termos: ${oque}`);
  }
});

await etapa("os termos trazem a isenção E o limite de responsabilidade", async () => {
  /* Os dois, e não um. A exclusão é o que o Felipe pediu; o limite é o que tem
   * chance de sobreviver ao CDC. Perder o limite para ficar só com a exclusão
   * seria trocar a cláusula que vale pela que não vale. */
  const t = limpo(await pegar("/termos"));
  if (!/n[ãa]o nos responsabilizamos/i.test(t)) throw new Error("sumiu a isenção");
  /* Casa a SUBSTÂNCIA — "limitad…" e "valor que você pagou" na mesma frase —, e
   * não a redação exata. Um teste preso à vírgula reprova quando alguém melhora
   * o texto, e aí o próximo a mexer aprende a mudar o teste em vez de ler. */
  if (!/limitad[ao][^.]{0,80}valor que voc[êe] pagou/i.test(t)) {
    throw new Error("sumiu o LIMITE — sobrou só a cláusula mais fácil de anular");
  }
});

await etapa("os termos continuam dizendo que não somos backup", async () => {
  const t = limpo(await pegar("/termos"));
  if (!/n[ãa]o substitui o seu backup|guarde (suas|os seus) c[óo]pias|guarde os seus originais/i.test(t)) {
    throw new Error("sumiu o aviso de guardar as próprias cópias");
  }
});

await etapa('"entrega, não backup" aparece LOGO NO COMEÇO, não só no fim', async () => {
  /*
   * A frase já existia em quatro lugares e nos quatro aparecia depois —
   * Disponibilidade, segurança, /seguranca e o aviso de beta. Aviso que só chega
   * no rodapé chega quando a expectativa já se formou, e a expectativa errada
   * aqui custa um casamento inteiro.
   *
   * A etapa confere POSIÇÃO, e não presença: presença já era verdade quando o
   * problema existia.
   */
  const t = limpo(await pegar("/termos"));
  const onde = t.search(/ferramenta de ENTREGA, n[ãa]o de backup/i);
  if (onde < 0) throw new Error("a frase não está nos termos");

  /* O primeiro terço do texto. Não é número mágico: é "antes de o leitor
   * decidir", e nenhuma seção de responsabilidade cabe aí. */
  const limite = t.length / 3;
  if (onde > limite) {
    throw new Error(
      `a frase está no caractere ${onde} de ${t.length} — escorregou para o fim de novo`,
    );
  }
  return `caractere ${onde} de ${t.length}`;
});

console.log(falhou ? "\n✗ os termos têm problema" : "\n✓ termos e aceite ok");
process.exitCode = falhou ? 1 : 0;
