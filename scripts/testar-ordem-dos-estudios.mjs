#!/usr/bin/env node
/**
 * Testa a ORDEM da tabela de estúdios do admin. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-ordem-dos-estudios.mjs
 *
 * Felipe, 30/09/2026: "permita ordenar essa lista pelas colunas". A regra mora
 * em `lib/ordem-dos-estudios.ts` e é pura: esta suíte não precisa de banco nem
 * de servidor. O que ela prende:
 *
 *   - cada coluna ordena pelo número que a célula mostra;
 *   - data vazia vai para o fim nos DOIS sentidos;
 *   - endereço torto cai na ordem de sempre, em vez de quebrar a página;
 *   - o cabeçalho da coluna ativa inverte, o das outras começa pelo preferido;
 *   - a lista original não é mexida (os totais da página leem dela).
 *
 * 13/10/2026, depois de "está bem bugado para mexer aqui e reordenar" (44
 * estúdios: cada clique refazia a Administração inteira no servidor): a ordem
 * passa a ser feita no navegador, sobre chaves que o servidor manda junto de
 * cada linha. Esta suíte prende que o navegador e o servidor ordenam IGUAL —
 * as duas leem de `lib/ordem-por-chaves.ts` — e as duas colunas novas, a última
 * velocidade de envio e de download.
 */
const { COLUNAS_DOS_ESTUDIOS, ORDEM_PADRAO, SEM_EXTRAS, lerOrdem, ordenarEstudios, enderecoDaOrdem, chavesDoEstudio } =
  await import("../src/lib/ordem-dos-estudios.ts");
const { ordenarPorChaves, proximaOrdem } = await import("../src/lib/ordem-por-chaves.ts");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const GB = 1024 ** 3;
const estudio = (nome, extra = {}) => ({
  id: nome,
  nome_estudio: nome,
  email: `${nome}@x`,
  slug: nome,
  plano_id: "g:foto:500",
  ciclo_cobranca: "mensal",
  status: "trial",
  trial_ate: null,
  criado_em: new Date("2026-09-01"),
  cpf_cnpj: null,
  dominio_proprio: null,
  dominio_verificado_em: null,
  tem_assinatura: false,
  asaas_cliente_id: null,
  asaas_assinatura_id: null,
  assinatura_criada_em: null,
  ultimo_pagamento_em: null,
  pago_ate: null,
  senha_alterada_em: null,
  quota_bytes: String(Math.round(10 * GB)),
  bytes_no_ar: "0",
  bytes_no_cofre: "0",
  galerias: 1,
  publicadas: 1,
  na_lixeira: 0,
  medias: 0,
  fotos: 0,
  videos: 0,
  acessos_30d: 0,
  favoritas: 0,
  ultimo_acesso: null,
  ultimo_envio: null,
  ultima_alteracao: null,
  ultimo_acesso_estudio: null,
  ...extra,
});

/* Na ordem do banco: quem chegou por último primeiro. */
const lista = [
  estudio("Santarem", { criado_em: new Date("2026-09-29T12:00Z"), bytes_no_ar: String(Math.round(0.9 * GB)), fotos: 12, videos: 10, ultimo_acesso: new Date("2026-09-30") }),
  estudio("Vitoria", { criado_em: new Date("2026-09-29T11:00Z"), bytes_no_ar: String(Math.round(2.2 * GB)), fotos: 189, ultimo_acesso: new Date("2026-09-29") }),
  estudio("caroline", { criado_em: new Date("2026-09-29T10:00Z") }),
  estudio("Bia", { criado_em: new Date("2026-09-29T09:00Z"), bytes_no_ar: String(Math.round(9.5 * GB)), fotos: 944, ultimo_acesso: new Date("2026-09-30T08:00Z"), ultimo_acesso_estudio: new Date("2026-09-29") }),
  estudio("Ágata", { criado_em: new Date("2026-08-01"), status: "ativo", plano_id: "g:foto:1000", ultimo_acesso_estudio: new Date("2026-09-20") }),
];
const nomes = (l) => l.map((e) => e.nome_estudio).join(", ");

console.log("A ordem da tabela de estúdios\n");

etapa("toda coluna do cabeçalho tem ordem, e os ids não se repetem", () => {
  const ids = COLUNAS_DOS_ESTUDIOS.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new Error(`ids repetidos: ${ids}`);
  if (ids.length !== 12) throw new Error(`${ids.length} colunas, a tabela tem 12`);
  for (const c of COLUNAS_DOS_ESTUDIOS) for (const e of lista) c.valor(e, SEM_EXTRAS);
  return ids.join(" · ");
});

etapa("sem nada no endereço, a ordem de sempre (quem chegou por último)", () => {
  const o = lerOrdem({});
  if (o.coluna !== ORDEM_PADRAO.coluna || o.sentido !== ORDEM_PADRAO.sentido) throw new Error(JSON.stringify(o));
  const r = ordenarEstudios(lista, o);
  if (nomes(r) !== nomes(lista)) throw new Error(nomes(r));
  return nomes(r);
});

etapa("endereço torto cai na ordem de sempre", () => {
  for (const p of [{ ordem: "drop table" }, { ordem: ["espaco", "x"] }, { ordem: "" }]) {
    const o = lerOrdem(p);
    if (o.coluna !== ORDEM_PADRAO.coluna) throw new Error(`${JSON.stringify(p)} virou ${o.coluna}`);
  }
  const semSentido = lerOrdem({ ordem: "estudio", sentido: "lado" });
  if (semSentido.sentido !== "asc") throw new Error("sentido inválido não caiu no preferido da coluna");
  return "3 endereços tortos, 1 sentido inventado";
});

etapa("espaço, do mais cheio para o mais vazio", () => {
  const r = ordenarEstudios(lista, { coluna: "espaco", sentido: "desc" });
  if (r[0].nome_estudio !== "Bia" || r[1].nome_estudio !== "Vitoria") throw new Error(nomes(r));
  return nomes(r);
});

etapa("nome, em ordem alfabética sem ligar para acento nem maiúscula", () => {
  const r = ordenarEstudios(lista, { coluna: "estudio", sentido: "asc" });
  if (nomes(r) !== "Ágata, Bia, caroline, Santarem, Vitoria") throw new Error(nomes(r));
  return nomes(r);
});

etapa("conteúdo conta fotos e vídeos juntos", () => {
  const r = ordenarEstudios(lista, { coluna: "conteudo", sentido: "desc" });
  if (r[0].nome_estudio !== "Bia" || r[1].nome_estudio !== "Vitoria" || r[2].nome_estudio !== "Santarem") {
    throw new Error(nomes(r));
  }
  return nomes(r);
});

etapa("quem não tem data vai para o fim nos DOIS sentidos", () => {
  for (const sentido of ["asc", "desc"]) {
    const r = ordenarEstudios(lista, { coluna: "estudio-entrou", sentido });
    const comData = r.slice(0, 2).map((e) => e.nome_estudio).sort().join(",");
    if (comData !== "Bia,Ágata") throw new Error(`${sentido}: ${nomes(r)}`);
  }
  const antigos = ordenarEstudios(lista, { coluna: "estudio-entrou", sentido: "asc" });
  if (antigos[0].nome_estudio !== "Ágata") throw new Error(`asc: ${nomes(antigos)}`);
  return "asc e desc começam por quem tem data";
});

etapa("quem paga: só o ativo, e antes de todo mundo", () => {
  const r = ordenarEstudios(lista, { coluna: "paga", sentido: "desc" });
  if (r[0].nome_estudio !== "Ágata") throw new Error(nomes(r));
  return nomes(r);
});

etapa("a lista original não muda (os totais da página leem dela)", () => {
  const antes = nomes(lista);
  ordenarEstudios(lista, { coluna: "estudio", sentido: "asc" });
  if (nomes(lista) !== antes) throw new Error("a lista original foi reordenada");
  return "intacta";
});

etapa("o cabeçalho ativo inverte; os outros começam pelo preferido", () => {
  const atual = { coluna: "espaco", sentido: "desc" };
  const mesmo = enderecoDaOrdem(atual, "espaco");
  if (mesmo !== "?ordem=espaco&sentido=asc#estudios") throw new Error(mesmo);
  const nome = enderecoDaOrdem(atual, "estudio");
  if (nome !== "?ordem=estudio&sentido=asc#estudios") throw new Error(nome);
  const custo = enderecoDaOrdem(atual, "custo");
  if (custo !== "?ordem=custo&sentido=desc#estudios") throw new Error(custo);
  return `${mesmo} · ${nome}`;
});

etapa("a ordem do navegador é a do servidor, em toda coluna e nos dois sentidos", () => {
  const extras = new Map([
    ["Santarem", { envioBps: 9_000_000, downloadBps: null }],
    ["Vitoria", { envioBps: 2_000_000, downloadBps: 8_000_000 }],
    ["Bia", { envioBps: null, downloadBps: 1_000_000 }],
  ]);
  let conferidas = 0;
  for (const c of COLUNAS_DOS_ESTUDIOS) {
    for (const sentido of ["asc", "desc"]) {
      const doServidor = nomes(ordenarEstudios(lista, { coluna: c.id, sentido }, extras));
      const itens = lista.map((e) => ({ e, chaves: chavesDoEstudio(e, extras.get(e.id)) }));
      const doNavegador = ordenarPorChaves(itens, { coluna: c.id, sentido })
        .map((x) => x.e.nome_estudio)
        .join(", ");
      if (doServidor !== doNavegador) throw new Error(`${c.id} ${sentido}: servidor ${doServidor} ≠ navegador ${doNavegador}`);
      conferidas++;
    }
  }
  return `${conferidas} ordens conferidas`;
});

etapa("última velocidade: a mais rápida primeiro, e quem não mediu vai para o fim", () => {
  const extras = new Map([
    ["Santarem", { envioBps: 9_000_000, downloadBps: null }],
    ["Vitoria", { envioBps: 2_000_000, downloadBps: 8_000_000 }],
    ["Bia", { envioBps: null, downloadBps: 1_000_000 }],
  ]);
  const envio = ordenarEstudios(lista, { coluna: "envio", sentido: "desc" }, extras);
  if (nomes(envio.slice(0, 2)) !== "Santarem, Vitoria") throw new Error(nomes(envio));
  const devagar = ordenarEstudios(lista, { coluna: "envio", sentido: "asc" }, extras);
  if (nomes(devagar.slice(0, 2)) !== "Vitoria, Santarem") throw new Error(`asc: ${nomes(devagar)}`);
  const dl = ordenarEstudios(lista, { coluna: "download", sentido: "desc" }, extras);
  if (nomes(dl.slice(0, 2)) !== "Vitoria, Bia") throw new Error(`download: ${nomes(dl)}`);
  /* Sem extras nenhuns, ninguém mediu: tudo empata e a ordem de chegada fica. */
  const vazio = ordenarEstudios(lista, { coluna: "envio", sentido: "desc" });
  if (nomes(vazio) !== nomes(lista)) throw new Error(`sem medida: ${nomes(vazio)}`);
  return `${nomes(envio.slice(0, 2))} · ${nomes(dl.slice(0, 2))}`;
});

etapa("o clique no navegador faz o mesmo que o link do servidor", () => {
  const atual = { coluna: "espaco", sentido: "desc" };
  for (const c of COLUNAS_DOS_ESTUDIOS) {
    const prox = proximaOrdem(atual, c.id, c.primeiro);
    const link = enderecoDaOrdem(atual, c.id);
    if (link !== `?ordem=${prox.coluna}&sentido=${prox.sentido}#estudios`) throw new Error(`${c.id}: ${link} ≠ ${JSON.stringify(prox)}`);
  }
  const volta = proximaOrdem(proximaOrdem(atual, "espaco", "desc"), "espaco", "desc");
  if (volta.sentido !== "desc") throw new Error("duas vezes na mesma coluna devia voltar ao começo");
  return "12 colunas, link e clique concordam";
});

console.log(falhou ? "\n✗ a ordem da tabela tem problema" : "\n✓ a tabela ordena por qualquer coluna");
process.exitCode = falhou ? 1 : 0;
