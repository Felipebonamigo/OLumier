#!/usr/bin/env node
/**
 * Testa o que a conexão com o Atomatiza destrava na chave de API. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-conexao-atomatiza.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * O Atomatiza (contratos, agenda, cobrança) cria aqui a galeria de um contrato
 * e depois pergunta como ela está. Três coisas precisam ficar presas:
 *
 *   - IDEMPOTÊNCIA: o mesmo contrato pedindo duas vezes recebe a MESMA galeria
 *     (migração 041). Botão clicado duas vezes não pode fabricar "ana-pedro-2".
 *   - ISOLAMENTO: a referência é única POR ESTÚDIO, nunca global — dois
 *     estúdios podem ter contratos com o mesmo id lá.
 *   - `noAr` CALCULADO: o outro lado vai dizer "as fotos estão prontas" a um
 *     casal. A resposta tem de ser a régua da página pública, não a coluna
 *     `publicada` crua.
 *
 * E a aresta da lixeira: apagar a galeria LIBERA a referência (para recriar do
 * contrato sem esperar a purga), e o restauro de uma galeria cuja referência
 * já foi reocupada volta SEM o vínculo — ver `restaurarGaleria`.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { gerarChave } from "../src/lib/chaves-api.ts";
import { restaurarGaleria } from "../src/lib/tenants.ts";
import { marca, enderecoDaGaleria } from "../src/config/marca.ts";
import { CARENCIA_POS_TRIAL_DIAS } from "../src/config/trial.ts";
import { createHmac } from "node:crypto";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

/*
 * Dois estúdios PRÓPRIOS, criados por esta execução — ver o aviso no topo de
 * `testar-tudo.mjs`. Este teste depende do estado exato de (origem, origem_ref)
 * e não pode dividir bancada com ninguém.
 */
const carimbo = Date.now();
const novoEstudio = async (apelido) => {
  const { rows: [t] } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, status)
          values ($1, $2, $3, 'scrypt:x:y', 'ativo')
       returning id, slug, nome_estudio`,
    [`conexao-${apelido}-${carimbo}`, `Estúdio Conexão ${apelido}`, `conexao-${apelido}-${carimbo}@teste.local`],
  );
  return t;
};
const estudio = await novoEstudio("a");
const outro = await novoEstudio("b");

const criadas = { chaves: [], galerias: [], tenants: [estudio.id, outro.id] };
const novaChave = async (tenantId, escopo) => {
  const c = await gerarChave(tenantId, `conexao-atomatiza ${escopo}`, escopo);
  criadas.chaves.push(c.id);
  return c.segredo;
};

const chamar = (caminho, { metodo = "GET", chave, corpo } = {}) =>
  fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      ...(corpo ? { "content-type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

console.log(`\nConexão com o Atomatiza — ${estudio.nome_estudio}\n`);

const deEnvio = await novaChave(estudio.id, "envio");
const deLeitura = await novaChave(estudio.id, "leitura");
const doOutro = await novaChave(outro.id, "envio");

// O id do contrato lá é opaco aqui — um uuid de mentira serve exatamente igual.
const contrato = `contrato-${carimbo}`;

await etapa("/api/conta sem chave é 401", async () => {
  igual((await chamar("/api/conta")).status, 401, "status");
});

await etapa("/api/conta diz de quem é a chave", async () => {
  const r = await chamar("/api/conta", { chave: deLeitura });
  igual(r.status, 200, "status");
  const conta = await r.json();
  igual(conta.tenantId, estudio.id, "tenantId");
  igual(conta.slug, estudio.slug, "slug");
  igual(conta.nomeEstudio, estudio.nome_estudio, "nomeEstudio");
  igual(conta.dominio, marca.dominio, "dominio");
  igual(conta.escopo, "leitura", "escopo da chave de leitura");
  const deEnvioConta = await (await chamar("/api/conta", { chave: deEnvio })).json();
  igual(deEnvioConta.escopo, "envio", "escopo da chave de envio");
  return `${conta.nomeEstudio} · ${conta.slug}.${conta.dominio}`;
});

let galeria = null;

await etapa("criar com referência externa guarda a procedência", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status");
  galeria = await r.json();
  criadas.galerias.push(galeria.id);
  igual(galeria.estudioSlug, estudio.slug, "estudioSlug");
  igual(galeria.url, enderecoDaGaleria(estudio.slug, galeria.slug), "url canônica");
  const { rows: [g] } = await db.query("select origem, origem_ref from galerias where id = $1", [galeria.id]);
  igual(g.origem, "atomatiza", "origem");
  igual(g.origem_ref, contrato, "origem_ref");
  return galeria.url;
});

await etapa("a criação registra o evento de auditoria", async () => {
  const { rows } = await db.query(
    "select detalhe from eventos where alvo_id = $1 and acao = 'galeria.criada-de-fora'",
    [galeria.id],
  );
  igual(rows.length, 1, "eventos");
  igual(rows[0].detalhe.origem_ref, contrato, "detalhe.origem_ref");
});

await etapa("a mesma referência devolve a MESMA galeria", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 200, "status — repetição não é criação");
  const g = await r.json();
  igual(g.id, galeria.id, "id");
  const { rows } = await db.query(
    "select id from galerias where tenant_id = $1 and origem_ref = $2",
    [estudio.id, contrato],
  );
  igual(rows.length, 1, "linhas no banco");
});

await etapa("a referência é única POR ESTÚDIO, não global", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: doOutro,
    corpo: { titulo: "Contrato homônimo", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status");
  const g = await r.json();
  criadas.galerias.push(g.id);
  if (g.id === galeria.id) throw new Error("o outro estúdio recebeu a galeria alheia");
});

await etapa("referência longa demais é recusada", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "x", referenciaExterna: "r".repeat(201) },
  });
  igual(r.status, 400, "status");
});

await etapa("sem referência, nada muda para o plugin", async () => {
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Coleção do Lightroom" },
  });
  igual(r.status, 201, "status");
  const g = await r.json();
  criadas.galerias.push(g.id);
  const { rows: [linha] } = await db.query("select origem from galerias where id = $1", [g.id]);
  igual(linha.origem, null, "origem fica nula");
});

await etapa("GET /api/galerias/{id} responde como está a entrega", async () => {
  const r = await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura });
  igual(r.status, 200, "status");
  const g = await r.json();
  igual(g.publicada, false, "publicada");
  igual(g.noAr, false, "rascunho não está no ar");
  igual(g.origemRef, contrato, "origemRef");
  igual(g.url, galeria.url, "url");
});

await etapa("noAr é a régua da página pública, não a coluna crua", async () => {
  await db.query("update galerias set publicada = true, estado = 'online' where id = $1", [galeria.id]);
  let g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.noAr, true, "publicada e online");

  // Publicada, mas no cofre: o link do casal NÃO abre, e a rota tem de dizer isso.
  await db.query("update galerias set estado = 'arquivada' where id = $1", [galeria.id]);
  g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.publicada, true, "a coluna continua true");
  igual(g.noAr, false, "no cofre não está no ar");

  // Publicada, mas vencida: mesmo caso.
  await db.query(
    "update galerias set estado = 'online', expira_em = now() - interval '1 day' where id = $1",
    [galeria.id],
  );
  g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.noAr, false, "vencida não está no ar");

  await db.query("update galerias set expira_em = null where id = $1", [galeria.id]);
  return "cofre e prazo vencido derrubam o noAr";
});

await etapa("e o trial abandonado também — a perna mais sutil da régua", async () => {
  /*
   * As duas pernas acima moram na galeria; esta mora no ESTÚDIO, e é a única
   * que some sem ninguém ter mexido na galeria: o trial vence, passa a
   * carência, e o link do casal para de abrir sozinho. É também a que mais
   * engana quem consome esta rota — a galeria continua `publicada = true`,
   * `estado = 'online'`, sem prazo nenhum. Sem este passo, o `noAr` podia
   * perder a chamada a `galeriasNoAr` e o teste seguiria verde.
   */
  const { rows: [antes] } = await db.query(
    "select status, trial_ate from tenants where id = $1", [estudio.id]);

  const venceuHaMuito = `now() - interval '${CARENCIA_POS_TRIAL_DIAS + 5} days'`;
  await db.query(
    `update tenants set status = 'trial', trial_ate = ${venceuHaMuito} where id = $1`,
    [estudio.id],
  );
  let g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.publicada, true, "a galeria não mudou");
  igual(g.estado, "online", "nem o estado");
  igual(g.noAr, false, "trial abandonado derruba o noAr");

  // Dentro da carência ainda está no ar: a régua falha para o lado de MOSTRAR.
  await db.query(
    "update tenants set trial_ate = now() - interval '1 day' where id = $1", [estudio.id]);
  g = await (await chamar(`/api/galerias/${galeria.id}`, { chave: deLeitura })).json();
  igual(g.noAr, true, "dentro da carência continua no ar");

  await db.query(
    "update tenants set status = $2, trial_ate = $3 where id = $1",
    [estudio.id, antes.status, antes.trial_ate],
  );
  return `carência de ${CARENCIA_POS_TRIAL_DIAS} dias respeitada nos dois lados`;
});

await etapa("galeria de outro estúdio é 404, id torto também", async () => {
  igual((await chamar(`/api/galerias/${galeria.id}`, { chave: doOutro })).status, 404, "alheia");
  igual((await chamar("/api/galerias/nao-e-uuid", { chave: deLeitura })).status, 404, "id torto");
});

await etapa("a lista traz a procedência para o seletor de vínculo", async () => {
  const { galerias } = await (await chamar("/api/galerias", { chave: deLeitura })).json();
  const g = galerias.find((x) => x.id === galeria.id);
  if (!g) throw new Error("galeria criada não está na lista");
  igual(g.origem, "atomatiza", "origem");
  igual(g.origem_ref, contrato, "origem_ref");
});

await etapa("dois contratos de mesmo título ao mesmo tempo não viram erro", async () => {
  /* A corrida do índice de SLUG, que não é a do índice de origem: dois
   * contratos diferentes, mesmo título, ao mesmo tempo. Sem separar os dois
   * 23505, o segundo virava 500 — não há galeria do outro para lhe devolver.
   * Aqui as duas saem juntas de propósito. */
  const titulo = `Homônimos ${carimbo}`;
  const [a, b] = await Promise.all([
    chamar("/api/galerias", { metodo: "POST", chave: deEnvio, corpo: { titulo, referenciaExterna: `${contrato}-x` } }),
    chamar("/api/galerias", { metodo: "POST", chave: deEnvio, corpo: { titulo, referenciaExterna: `${contrato}-y` } }),
  ]);
  igual(a.status, 201, "status do primeiro");
  igual(b.status, 201, "status do segundo");
  const [ga, gb] = [await a.json(), await b.json()];
  criadas.galerias.push(ga.id, gb.id);
  if (ga.id === gb.id) throw new Error("dois contratos receberam a MESMA galeria");
  if (ga.slug === gb.slug) throw new Error("dois endereços iguais no mesmo estúdio");
  return `${ga.slug} e ${gb.slug}`;
});

await etapa("apagar a galeria LIBERA a referência do contrato", async () => {
  await db.query("update galerias set estado = 'lixeira', apagada_em = now() where id = $1", [galeria.id]);
  const r = await chamar("/api/galerias", {
    metodo: "POST",
    chave: deEnvio,
    corpo: { titulo: "Ana e Pedro", referenciaExterna: contrato },
  });
  igual(r.status, 201, "status — recriar sem esperar a purga");
  const g = await r.json();
  criadas.galerias.push(g.id);
  if (g.id === galeria.id) throw new Error("devolveu a galeria da lixeira");
  return `recriada como ${g.slug}`;
});

await etapa("restaurar a antiga não briga com a recriada", async () => {
  await restaurarGaleria(estudio.id, galeria.id);
  const { rows: [velha] } = await db.query(
    "select estado, origem, origem_ref from galerias where id = $1",
    [galeria.id],
  );
  igual(velha.estado, "online", "restaurada");
  igual(velha.origem, null, "o vínculo ficou com a recriada");
  const { rows } = await db.query(
    "select id from galerias where tenant_id = $1 and origem_ref = $2 and estado <> 'lixeira'",
    [estudio.id, contrato],
  );
  igual(rows.length, 1, "uma dona só para a referência");
});

// ---------------------------------------------------- o canal de avisos (camada 4)

await etapa("chave de LEITURA não registra canal de avisos", async () => {
  /* Registrar canal é dizer PARA ONDE os eventos deste estúdio saem. Uma chave
   * que só lê, vazada, não pode redirecionar fluxo. */
  const r = await chamar("/api/avisos", {
    metodo: "POST", chave: deLeitura,
    corpo: { url: "https://exemplo.invalido/aviso", segredo: "x".repeat(40) },
  });
  igual(r.status, 401, "status");
});

await etapa("canal em http é recusado — o segredo viajaria em claro", async () => {
  const r = await chamar("/api/avisos", {
    metodo: "POST", chave: deEnvio,
    corpo: { url: "http://exemplo.invalido/aviso", segredo: "x".repeat(40) },
  });
  igual(r.status, 400, "status");
});

await etapa("segredo curto é recusado — segredo curto não é segredo", async () => {
  const r = await chamar("/api/avisos", {
    metodo: "POST", chave: deEnvio,
    corpo: { url: "https://exemplo.invalido/aviso", segredo: "curto" },
  });
  igual(r.status, 400, "status");
});

/*
 * O RECEPTOR DE MENTIRA.
 *
 * Um servidor local que só guarda o que chegou. É a única forma honesta de
 * provar o que importa deste lado: que o aviso sai assinado com o segredo que
 * o outro registrou, e que NÃO leva endereço nem nada do casal dentro.
 */
const http = await import("node:http");
const recebidos = [];
const SEGREDO_DO_CANAL = "segredo-que-o-atomatiza-registrou-aqui-2026";
const receptor = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => { corpo += p; });
  req.on("end", () => {
    recebidos.push({ corpo, cabecalhos: req.headers });
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  });
});
await new Promise((r) => receptor.listen(3099, "127.0.0.1", r));

await etapa("o canal é registrado e o endereço volta normalizado", async () => {
  /* A rota exige https. Em teste não existe https local, então o registro é
   * feito direto pela biblioteca — é ela que o resto do sistema usa, e é o
   * comportamento DELA (assinar, montar, não vazar) que este teste prende. */
  const { registrarCanal } = await import("../src/lib/avisos.ts");
  await registrarCanal(estudio.id, "http://127.0.0.1:3099/aviso", SEGREDO_DO_CANAL);
  const r = await chamar("/api/avisos", { chave: deLeitura });
  const j = await r.json();
  igual(j.registrado, true, "registrado");
  igual(j.url, "http://127.0.0.1:3099/aviso", "url");
  if (JSON.stringify(j).includes(SEGREDO_DO_CANAL)) throw new Error("o segredo voltou na resposta");
  return "e o segredo nunca volta";
});

/*
 * Uma galeria PRÓPRIA para o canal, com vínculo intacto.
 *
 * A `galeria` de cima passou pela lixeira e pelo restauro, e o restauro LARGA o
 * vínculo quando a referência já tem dona nova (é o desenho, ver lib/tenants).
 * Reaproveitá-la aqui testaria o caminho "sem procedência" sem querer — que é
 * justo o passo seguinte, e ele precisa de uma galeria que de fato não tenha
 * vínculo para provar alguma coisa.
 */
const refAviso = `${contrato}-aviso`;
const { rows: [galeriaAviso] } = await db.query(
  `insert into galerias (tenant_id, slug, titulo, estado, publicada, origem, origem_ref)
        values ($1, $2, 'Entrega com aviso', 'online', true, 'atomatiza', $3)
     returning id`,
  [estudio.id, `entrega-com-aviso-${carimbo}`, refAviso],
);
criadas.galerias.push(galeriaAviso.id);

await etapa("publicar dispara o aviso, assinado com o segredo do outro lado", async () => {
  const { avisarEntrega } = await import("../src/lib/avisos.ts");
  recebidos.length = 0;
  await avisarEntrega(galeriaAviso.id);

  igual(recebidos.length, 1, "avisos recebidos");
  const { corpo, cabecalhos } = recebidos[0];
  igual(cabecalhos["x-atomo-estudio"], estudio.id, "o estúdio vai no cabeçalho");
  const esperada = createHmac("sha256", SEGREDO_DO_CANAL).update(corpo).digest("hex");
  igual(cabecalhos["x-atomo-assinatura"], esperada, "assinatura sobre o corpo CRU");

  const aviso = JSON.parse(corpo);
  igual(aviso.evento, "entrega.mudou", "evento");
  igual(aviso.referenciaExterna, refAviso, "a referência que o outro lado mandou");
  igual(aviso.noAr, true, "noAr calculado");
  if (!aviso.ocorridoEm) throw new Error("sem ocorridoEm — o outro lado não teria como ordenar");
  return `noAr=${aviso.noAr}, ${aviso.totalMedias} arquivo(s)`;
});

await etapa("o aviso NÃO leva endereço, título nem nada do casal", async () => {
  const aviso = JSON.parse(recebidos[0].corpo);
  const chaves = Object.keys(aviso).sort().join(",");
  igual(chaves, "evento,galeriaId,noAr,ocorridoEm,referenciaExterna,totalMedias", "campos do aviso");
  const texto = recebidos[0].corpo;
  for (const proibido of ["http", "galeriaatomo", "Entrega com aviso", "senha"]) {
    if (texto.includes(proibido)) throw new Error(`vazou "${proibido}" no corpo do aviso`);
  }
  return "só id, referência, estado e contagem";
});

await etapa("o trial abandonado também chega como fora do ar", async () => {
  /* O mesmo cuidado do noAr da rota: um aviso dizendo "no ar" sobre uma
   * galeria que não abre é pior que aviso nenhum — o outro lado vai escrever
   * isso na tela de quem vende. */
  const { avisarEntrega } = await import("../src/lib/avisos.ts");
  const { rows: [antes] } = await db.query("select status, trial_ate from tenants where id = $1", [estudio.id]);
  await db.query(
    `update tenants set status = 'trial', trial_ate = now() - interval '${CARENCIA_POS_TRIAL_DIAS + 5} days' where id = $1`,
    [estudio.id]);
  recebidos.length = 0;
  await avisarEntrega(galeriaAviso.id);
  const aviso = JSON.parse(recebidos[0].corpo);
  igual(aviso.noAr, false, "noAr com trial abandonado");
  await db.query("update tenants set status = $2, trial_ate = $3 where id = $1",
    [estudio.id, antes.status, antes.trial_ate]);
});

await etapa("galeria sem procedência não gera aviso nenhum", async () => {
  const { avisarEntrega } = await import("../src/lib/avisos.ts");
  const { rows: [solta] } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, estado, publicada)
          values ($1, $2, 'Sem contrato', 'online', true) returning id`,
    [estudio.id, `solta-${carimbo}`]);
  criadas.galerias.push(solta.id);
  recebidos.length = 0;
  await avisarEntrega(solta.id);
  igual(recebidos.length, 0, "avisos");
  return "avisar sobre ela seria mandar evento que o outro lado não encaixa";
});

await etapa("receptor fora do ar não derruba nada, e o erro fica registrado", async () => {
  const { avisarEntrega } = await import("../src/lib/avisos.ts");
  await new Promise((r) => receptor.close(r));
  // Não pode lançar: quem chama está publicando uma galeria.
  await avisarEntrega(galeriaAviso.id);
  const { rows: [linha] } = await db.query(
    "select ultimo_erro, ultimo_envio_em from avisos where tenant_id = $1", [estudio.id]);
  if (!linha?.ultimo_erro) throw new Error("a falha sumiu sem deixar rastro");
  if (!linha.ultimo_envio_em) throw new Error("sem data da tentativa");
  return `guardado: ${String(linha.ultimo_erro).slice(0, 40)}`;
});

/*
 * Limpeza: só o que este teste criou. Eventos ficam — a tabela recusa delete
 * por gatilho, de propósito (ver src/lib/eventos.ts), e evento órfão de teste
 * num banco de teste é exatamente o custo que ela anuncia.
 */
if (criadas.galerias.length > 0) {
  await db.query("delete from galerias where id = any($1::uuid[])", [criadas.galerias]);
}
await db.query("delete from galerias where tenant_id = any($1::uuid[])", [criadas.tenants]);
if (criadas.chaves.length > 0) {
  await db.query("delete from chaves_api where id = any($1::uuid[])", [criadas.chaves]);
}
await db.query("delete from avisos where tenant_id = any($1::uuid[])", [criadas.tenants]);
await db.query("delete from tenants where id = any($1::uuid[])", [criadas.tenants]);
await db.end();

console.log(falhou ? "\n✗ conexão com o Atomatiza com falha\n" : "\n✓ conexão com o Atomatiza ok\n");
process.exit(falhou ? 1 : 0);
