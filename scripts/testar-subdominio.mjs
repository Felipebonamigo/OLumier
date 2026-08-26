#!/usr/bin/env node
/**
 * Testa o subdomínio por estúdio. Uso:
 *   node --env-file=.env.local scripts/testar-subdominio.mjs
 *
 * Não precisa do DNS pronto: o roteamento é decidido pelo cabeçalho Host, então
 * dá para simular `siriusfotografia.olumier.com.br` batendo no servidor local.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { DOMINIOS_ATENDIDOS } from "../src/config/dominios.ts";
import { marca } from "../src/config/marca.ts";
import http from "node:http";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* Bancada propria desta execucao — antes: a galeria mais antiga do banco.
 * Ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db);
const tslug = bancada.tslug, gslug = bancada.gslug, titulo = bancada.titulo,
  nome_estudio = bancada.estudio.nome_estudio;
await db.query(
  "update galerias set publicada = true, senha_hash = null, estado = 'online' where slug = $1",
  [gslug],
);

/*
 * ── CANÔNICO E LEGADO SÃO DOIS ENDEREÇOS, E O TESTE PRECISA DOS DOIS ──────
 *
 * Até 26/08/2026 este arquivo inteiro rodava contra `olumier.com.br` cravado
 * aqui. Parecia detalhe e não era: na troca de marca, o domínio cravado virou o
 * LEGADO, e o canônico — o que o produto passa a mostrar, montar em link e
 * mandar por e-mail — ficou sem uma única etapa. A suíte seguia verde provando
 * o endereço que estava saindo de cena.
 *
 * Agora `HOST` vem de `marca.dominio`, então as etapas abaixo acompanham a
 * marca sozinhas na próxima troca.
 *
 * `HOST_LEGADO` é literal DE PROPÓSITO, e é a única coisa neste arquivo que
 * deve continuar escrita à mão. Ele guarda a promessa de `DOMINIOS_ATENDIDOS`:
 * link de galeria já entregue a um casal continua abrindo no endereço antigo,
 * sem redirecionar. Essa promessa passou a valer no Caddy em 26/08/2026, onde a
 * raiz e o `www` do antigo redirecionam mas o subdomínio de estúdio NÃO — e um
 * `redir` escrito com um caractere a mais levaria o subdomínio junto, mandando
 * o casal para a home. Antes desta etapa, nada no repositório acusava isso.
 *
 * Quando o passo 4 chegar (tirar o antigo de `DOMINIOS_ATENDIDOS`, meses depois),
 * a etapa do legado fica vermelha — e aí ela sai junto, de propósito.
 */
const HOST = `${tslug}.${marca.dominio}`;
const HOST_LEGADO = `${tslug}.olumier.com.br`;
console.log(
  `estúdio: ${nome_estudio}\nsubdomínio canônico: ${HOST}\nsubdomínio legado:   ${HOST_LEGADO}\n`,
);

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
/*
 * Usa o módulo http em vez de fetch: o fetch do Node trata "Host" como cabeçalho
 * proibido e o descarta em silêncio — o servidor receberia "localhost" e o teste
 * falharia sem que o app tivesse problema algum. Já me enganou uma vez.
 */
const pedir = (caminho, host = HOST) =>
  new Promise((resolve, reject) => {
    const url = new URL(BASE + caminho);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { Host: host },
      },
      (res) => {
        // Sem isto, um acento pode ser partido entre dois pedaços e chegar corrompido.
        res.setEncoding("utf8");
        let corpo = "";
        res.on("data", (c) => (corpo += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: { get: (h) => res.headers[h.toLowerCase()] },
            corpo,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
const texto = async (r) =>
  r.corpo.replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ");

console.log("Roteamento pelo endereço:\n");

await etapa("a raiz do subdomínio lista as galerias do estúdio", async () => {
  const r = await pedir("/");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(nome_estudio)) throw new Error("não mostrou o nome do estúdio");
  return "página do estúdio";
});

await etapa("o caminho curto abre a galeria", async () => {
  const r = await pedir(`/${gslug}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("não abriu a galeria certa");
  return `/${gslug} → ${titulo}`;
});

await etapa("o endereço bonito é mantido (reescrita, não redirecionamento)", async () => {
  const r = await pedir(`/${gslug}`);
  if (r.status >= 300 && r.status < 400) {
    throw new Error(`redirecionou para ${r.headers.get("location")} — o visitante veria a URL feia`);
  }
  return "sem redirecionamento";
});

await etapa("o domínio canônico continua servindo a rota interna", async () => {
  const r = await pedir(`/g/${tslug}/${gslug}`, marca.dominio);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("a rota interna quebrou no canônico");
  return `/g/estudio/galeria intacto em ${marca.dominio}`;
});

/*
 * ── O LEGADO, E POR QUE ELE É UMA ETAPA E NÃO UM COMENTÁRIO ───────────────
 *
 * `DOMINIOS_ATENDIDOS` promete que o domínio antigo continua servindo enquanto
 * houver link circulando. Promessa sem etapa é intenção: até 26/08/2026, se o
 * `olumier.com.br` parasse de rotear estúdio, NENHUM teste acusava — e o
 * sintoma apareceria num casal abrindo o link do próprio casamento.
 *
 * As duas etapas abaixo são o par que a configuração do Caddy pode quebrar de
 * um jeito silencioso: lá a raiz e o `www` do antigo redirecionam para o
 * canônico, mas o SUBDOMÍNIO de estúdio não pode redirecionar. Um `redir` com
 * escopo largo demais faz a raiz parecer certa e manda o casal para a home.
 */
await etapa("LEGADO: o subdomínio de estúdio ainda abre a galeria", async () => {
  const r = await pedir(`/${gslug}`, HOST_LEGADO);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${HOST_LEGADO} — link já entregue quebrou`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("abriu, mas não era a galeria");
  return `${HOST_LEGADO}/${gslug} intacto`;
});

await etapa("LEGADO: a rota interna também segue de pé no domínio antigo", async () => {
  const r = await pedir(`/g/${tslug}/${gslug}`, "olumier.com.br");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (!t.includes(titulo)) throw new Error("a rota antiga quebrou");
  return "/g/estudio/galeria intacto no legado";
});

/*
 * A casa de um estúdio só responde pelo que é dele.
 *
 * `/g/` é a forma interna das páginas públicas e estava na lista de rotas que o
 * subdomínio deixava passar intactas — então `sirius.olumier.com.br/g/carol/x`
 * servia a entrega da Carol dentro do endereço do Sirius. Não vazava galeria com
 * senha, mas quebrava exatamente a marca própria que o produto vende.
 */
await etapa("galeria de OUTRO estúdio não abre neste endereço", async () => {
  /* `slugVizinho`, e não `marca` como se chamava até 26/08/2026: o nome antigo
   * SOMBREAVA o `marca` importado no topo do arquivo. Enquanto a comparação
   * abaixo era um literal isso não custava nada; no instante em que ela passou a
   * ler `marca.dominio`, virou `undefined` dentro deste escopo e a etapa acusou
   * um destino que estava certo. Sombreamento não dá erro — dá resposta errada. */
  const slugVizinho = `vizinho-${Date.now()}`;
  const {
    rows: [v],
  } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash)
          values ($1, 'Estúdio Vizinho', $2, 'x') returning id, slug`,
    [slugVizinho, `${slugVizinho}@teste`],
  );
  await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
          values ($1, 'entrega-alheia', 'Entrega Alheia', true, 'online')`,
    [v.id],
  );

  try {
    const r = await pedir(`/g/${v.slug}/entrega-alheia`);
    if (r.status === 200) throw new Error("serviu a entrega do vizinho dentro deste endereço");
    if (r.status < 300 || r.status >= 400) {
      throw new Error(`esperava redirecionamento, veio ${r.status}`);
    }
    const destino = r.headers.get("location") ?? "";
    if (destino.includes(`${tslug}.`)) throw new Error(`continuou neste domínio: ${destino}`);
    /* `marca.dominio` e não literal: ver a nota na etapa do painel, mais abaixo. */
    if (!destino.includes(marca.dominio)) throw new Error(`mandou para ${destino}`);
    return "vai para o domínio principal";
  } finally {
    await db.query("delete from tenants where id = $1", [v.id]);
  }
});

await etapa("o caminho interno da própria galeria vira o endereço curto", async () => {
  const r = await pedir(`/g/${tslug}/${gslug}`);
  if (r.status < 300 || r.status >= 400) {
    throw new Error(`esperava redirecionamento, veio ${r.status}`);
  }
  const destino = r.headers.get("location") ?? "";
  if (!destino.includes(`${tslug}.`) || !destino.endsWith(`/${gslug}`)) {
    throw new Error(`mandou para ${destino}`);
  }
  return `um endereço só — ${destino}`;
});

await etapa("a vitrine de outro estúdio também não abre aqui", async () => {
  const r = await pedir("/e/estudio-alheio");
  if (r.status < 300 || r.status >= 400) {
    throw new Error(`esperava redirecionamento, veio ${r.status}`);
  }
  if ((r.headers.get("location") ?? "").includes(`${tslug}.`)) {
    throw new Error("a vitrine alheia ficou neste domínio");
  }
  return "/e/ alheio sai daqui";
});

await etapa("o painel não abre por subdomínio de estúdio", async () => {
  const r = await pedir("/painel");
  if (r.status < 300 || r.status >= 400) throw new Error(`esperava redirecionamento, veio ${r.status}`);
  const destino = r.headers.get("location") ?? "";
  /* `marca.dominio` e não literal: ver a nota na etapa do painel, mais abaixo. */
  if (!destino.includes(marca.dominio) || destino.includes(`${tslug}.`)) {
    throw new Error(`mandou para ${destino}`);
  }
  return "manda para o domínio principal";
});

await etapa("subdomínio reservado não vira estúdio", async () => {
  const r = await pedir("/", "www.olumier.com.br");
  const t = await texto(r);
  if (t.includes("Nenhuma galeria pública")) throw new Error("www foi tratado como estúdio");
  return "www segue sendo o site";
});

await etapa("estúdio inexistente devolve 404", async () => {
  const r = await pedir("/", "estudio-que-nao-existe.olumier.com.br");
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "HTTP 404";
});

console.log("\nPorteiro do certificado:\n");

await etapa("libera certificado para estúdio que existe", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=${HOST}`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200";
});

await etapa("recusa estúdio inexistente", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=inventado.olumier.com.br`);
  if (r.status !== 403) throw new Error(`esperava 403, veio ${r.status}`);
  return "HTTP 403";
});

await etapa("recusa domínio de fora (evita virar emissor de certificado alheio)", async () => {
  const r = await fetch(`${BASE}/api/tls/permitir?domain=site-do-golpista.com`);
  if (r.status !== 403) throw new Error(`esperava 403, veio ${r.status}`);
  return "HTTP 403";
});

await etapa("libera o domínio principal e o www", async () => {
  for (const d of ["olumier.com.br", "www.olumier.com.br"]) {
    const r = await fetch(`${BASE}/api/tls/permitir?domain=${d}`);
    if (r.status !== 200) throw new Error(`${d} veio ${r.status}`);
  }
  return "os dois liberados";
});

/*
 * ── A TRANSIÇÃO DE DOMÍNIO ────────────────────────────────────────────────
 *
 * Durante a troca de marca a instalação atende DOIS domínios ao mesmo tempo: o
 * antigo, que tem galeria no ar, e o novo, para onde tudo está indo. Os dois
 * precisam funcionar juntos, e a razão é o Caddy: ele emite certificado sob
 * demanda e PERGUNTA a este porteiro antes. Se o porteiro recusar o domínio
 * novo, o certificado nunca sai e o site novo não sobe — mesmo com o DNS certo.
 * E se ele parar de aceitar o antigo, quem já recebeu link fica sem HTTPS.
 *
 * Por isso a lista de domínios atendidos é uma peça própria (config/dominios),
 * separada de `marca.dominio`, que é o domínio CANÔNICO — o que entra em link de
 * e-mail e no endereço mostrado. Atender e ser canônico são coisas diferentes:
 * durante a transição atendemos dois e o canônico é um só.
 */
await etapa("atende os DOIS domínios durante a transição", async () => {
  for (const d of DOMINIOS_ATENDIDOS) {
    for (const nome of [d, `www.${d}`]) {
      const r = await fetch(`${BASE}/api/tls/permitir?domain=${nome}`);
      if (r.status !== 200) {
        throw new Error(
          `${nome} veio ${r.status} — sem isso o Caddy não emite certificado para ele`,
        );
      }
    }
  }
  return DOMINIOS_ATENDIDOS.join(" e ");
});

await etapa("o subdomínio de estúdio vale em qualquer domínio atendido", async () => {
  for (const d of DOMINIOS_ATENDIDOS) {
    const r = await fetch(`${BASE}/api/tls/permitir?domain=${tslug}.${d}`);
    if (r.status !== 200) throw new Error(`${tslug}.${d} veio ${r.status}`);
  }
  return `${tslug}.* liberado nos ${DOMINIOS_ATENDIDOS.length}`;
});

await etapa("o proxy reconhece o estúdio nos dois domínios", async () => {
  /* O porteiro do certificado e o proxy leem o domínio em lugares DIFERENTES
   * (`api/tls/permitir` e `src/proxy.ts`). Um pode aceitar e o outro não —
   * o certificado sai, e o endereço abre a home em vez da galeria. */
  for (const d of DOMINIOS_ATENDIDOS) {
    const r = await pedir("/", `${tslug}.${d}`);
    if (!r.corpo.includes(nome_estudio)) {
      throw new Error(`${tslug}.${d} não abriu a vitrine do estúdio`);
    }
  }
  return "proxy e porteiro de acordo";
});

await etapa("domínio parecido continua barrado nos dois", async () => {
  /* `olumier.com.br.golpe.net` termina com o nosso nome e NÃO é nosso. */
  for (const d of DOMINIOS_ATENDIDOS) {
    const r = await fetch(`${BASE}/api/tls/permitir?domain=${tslug}.${d}.golpe.net`);
    if (r.status !== 403) throw new Error(`${d}.golpe.net veio ${r.status}, esperava 403`);
  }
  return "HTTP 403 nos dois";
});

/* ── domínio próprio (migração 023) ──────────────────────────────────────── */

console.log("\nDomínio próprio:\n");

const DOM_PROPRIO = `teste-proprio-${Date.now()}.com.br`;
const { rows: tp } = await db.query("select id from tenants where slug = $1", [tslug]);
const tenantDoTeste = tp[0].id;

/*
 * O servidor guarda host → estúdio em cache com validade (ver VALIDADE_MS em
 * lib/dominio-proprio.ts). Em produção quem grava limpa o cache no MESMO
 * processo; aqui o teste escreve no banco por fora, então a mudança leva até
 * uma validade para aparecer.
 *
 * Esperar um tempo fixo é o jeito errado: erra para os dois lados — lento
 * quando dá certo, vermelho por acaso quando a máquina engasga. Tentar até
 * valer não tem esse defeito e sobrevive a uma mudança na validade.
 */
const ateQue = async (tentar, oQue) => {
  const limite = Date.now() + 8000;
  let ultimo = "não chegou a rodar";
  while (Date.now() < limite) {
    try {
      return await tentar();
    } catch (e) {
      ultimo = e.message;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`${oQue} não aconteceu em 8s — último: ${ultimo}`);
};

const soltarProprio = () =>
  db.query(
    `update tenants set dominio_proprio = null, dominio_token = null,
            dominio_verificado_em = null where id = $1`,
    [tenantDoTeste],
  );

try {
  await etapa("domínio pedido mas NÃO verificado não libera certificado", async () => {
    await db.query(
      "update tenants set dominio_proprio = $2, dominio_token = 'tok', dominio_verificado_em = null where id = $1",
      [tenantDoTeste, DOM_PROPRIO],
    );
    const r = await pedir(`/api/tls/permitir?domain=${DOM_PROPRIO}`, "olumier.com.br");
    if (r.status !== 403) throw new Error(`veio ${r.status}, esperava 403`);
    return "HTTP 403 sem prova de posse";
  });

  await etapa("domínio pedido e NÃO verificado também não serve a galeria", async () => {
    const r = await pedir(`/${gslug}`, DOM_PROPRIO);
    if (r.status === 200 && (await texto(r)).includes(titulo)) {
      throw new Error("serviu a galeria sem prova de posse");
    }
    return `HTTP ${r.status}`;
  });

  await etapa("verificado libera o certificado", async () => {
    await db.query("update tenants set dominio_verificado_em = now() where id = $1", [
      tenantDoTeste,
    ]);
    return ateQue(async () => {
      const r = await pedir(`/api/tls/permitir?domain=${DOM_PROPRIO}`, "olumier.com.br");
      if (r.status !== 200) throw new Error(`veio ${r.status}`);
      return "HTTP 200";
    }, "o porteiro liberar");
  });

  await etapa("verificado serve a galeria pelo endereço do estúdio", async () =>
    ateQue(async () => {
      const r = await pedir(`/${gslug}`, DOM_PROPRIO);
      if (r.status !== 200) throw new Error(`veio ${r.status}`);
      /* Usa `texto()` e não o corpo cru: o título tem "&", que no HTML sai como
       * "&amp;". Comparar no cru dá falso negativo — me custou uma caçada. */
      if (!(await texto(r)).includes(titulo)) throw new Error("abriu, mas não é a galeria");
      return `${DOM_PROPRIO}/${gslug} → ${titulo}`;
    }, "a galeria abrir no domínio próprio"),
  );

  /*
   * A ARMADILHA que o desenho (docs/dominio-proprio.md, item 6) apontou.
   *
   * O endereço curto era montado com `marca.dominio`, e isso jogava o visitante
   * do domínio próprio de volta para o nosso no meio da navegação: o estúdio
   * paga por um endereço e o nome dele some na primeira normalização de link.
   *
   * O defeito é silencioso — a página abre, só que no lugar errado. Este teste
   * é a única coisa que o pega.
   */
  await etapa("o endereço curto NÃO devolve o visitante para o nosso domínio", async () => {
    const r = await pedir(`/g/${tslug}/${gslug}`, DOM_PROPRIO);
    if (r.status < 300 || r.status >= 400) throw new Error(`esperava redirecionamento, veio ${r.status}`);

    const destino = r.headers.get("location") ?? "";
    if (!destino.includes(DOM_PROPRIO)) {
      throw new Error(`perdeu o domínio do estúdio: mandou para ${destino}`);
    }
    if (destino.includes("olumier.com.br") || destino.includes("galeriaatomo.com.br")) {
      throw new Error(`vazou para o nosso domínio: ${destino}`);
    }
    return destino;
  });

  await etapa("o painel continua saindo do domínio do estúdio, de propósito", async () => {
    /* Aqui o comportamento certo é o CONTRÁRIO do de cima: o painel mora num
     * lugar só, porque o cookie de sessão não valeria em dois endereços. */
    const r = await pedir("/painel", DOM_PROPRIO);
    const destino = r.headers.get("location") ?? "";
    /* De `marca.dominio`, e não do literal que estava aqui até 26/08/2026.
     *
     * A propriedade sob teste é "o painel volta para o domínio CANÔNICO" — e
     * qual é o canônico é justamente o que `marca.dominio` responde. Com o
     * literal, a fase 2 da troca de marca reprovou esta etapa dizendo "painel
     * não voltou para o domínio principal: https://galeriaatomo.com.br/painel",
     * que é o destino certo. Teste que acusa o comportamento correto ensina a
     * ignorá-lo.
     *
     * Não confundir com `testar-marca-plataforma.mjs`, onde o literal é o ponto:
     * lá ele existe para RECUSAR a troca de endereço feita às cegas. Aqui ele só
     * envelhecia. */
    if (!destino.includes(marca.dominio)) {
      throw new Error(`painel não voltou para o domínio principal: ${destino}`);
    }
    return `vai para o domínio principal (${marca.dominio})`;
  });

  /*
   * A REMOÇÃO não é conferida por HTTP, de propósito.
   *
   * O acerto fica no cache do servidor por 60s (VALIDADE_ACERTO_MS). Em produção
   * isso não atrasa nada: `soltarDominio()` limpa o cache no MESMO processo. Aqui
   * o teste escreve no banco por fora, e esperar um minuto por uma asserção
   * deixaria a suíte mais lenta para provar o que já está provado em
   * `testar-dominio-proprio.mjs` — que roda em processo e vê o cache limpo.
   *
   * O que ESTE arquivo prova é a fiação: proxy e porteiro lendo a mesma régua.
   * Domínio que ninguém reclamou é o outro lado dessa fiação, e é instantâneo.
   */
  await etapa("domínio que ninguém reclamou não serve nem libera", async () => {
    const orfao = `nunca-reclamado-${Date.now()}.com.br`;
    const r = await pedir(`/${gslug}`, orfao);
    if (r.status === 200 && (await texto(r)).includes(titulo)) {
      throw new Error("serviu a galeria num domínio de ninguém");
    }
    const c = await pedir(`/api/tls/permitir?domain=${orfao}`, "olumier.com.br");
    if (c.status !== 403) throw new Error(`porteiro liberou domínio de ninguém: ${c.status}`);
    return "galeria fora e certificado recusado";
  });
} finally {
  await soltarProprio();
}

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ o subdomínio tem problema");
  process.exit(1);
}
console.log(`\n✓ subdomínio pronto — canônico ${marca.dominio}, legado olumier.com.br`);
