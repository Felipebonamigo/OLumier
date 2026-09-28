#!/usr/bin/env node
/**
 * OS ESTILOS DO ESTÚDIO — até cinco, com nome. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-estilos-do-estudio.mjs
 *
 * ── O PEDIDO (28/09/2026) ─────────────────────────────────────────────────
 *
 * Juan: "Adicionar opção de 5 modelos personalizados das combinações
 * individuais de cada pessoa. Ela pode salvar até 5 padrões próprios e dar
 * nome pra eles. Eu criei uns 3 que eu gostei, mas só pode salvar um."
 *
 * ── O QUE ESTE TESTE PRENDE ───────────────────────────────────────────────
 *
 * 1. Cabem cinco, e o sexto é recusado com recado — inclusive com oito
 *    cliques ao mesmo tempo (o limite é conferido com o estúdio travado).
 * 2. O nome é obrigatório, curto, e não se repete no estúdio (sem diferenciar
 *    maiúscula).
 * 3. Renomear e apagar só valem para o dono; o estilo de um estúdio não
 *    aparece para outro, nem pode ser usado por outro na criação.
 * 4. Apagar um estilo não mexe em galeria nenhuma, nem no padrão.
 * 5. Na criação: pronto > estilo salvo > padrão do estúdio.
 * 6. "Tornar padrão" copia o estilo para o padrão das galerias novas.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, segundoEstudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

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
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const E = await import("../src/lib/estilos-do-estudio.ts");
const { aparenciaInicialDaGaleria, padraoDoEstudio, salvarPadraoDoEstudio } = await import("../src/lib/aparencia-galeria.ts");
const { APARENCIA_PADRAO, PRESETS, lerAparencia } = await import("../src/config/aparencia.ts");

const t = await estudioDaRodada(db);
const outro = await segundoEstudioDaRodada(db);
const entregue = await galeriaDaRodada(db, { nome: "estilos-entregue", medias: 0, publicada: true });
const estilo = (capa, tema) => ({ ...APARENCIA_PADRAO, capa, tema });

console.log("\nOs estilos do estúdio:\n");

try {
  await etapa("cabem cinco, cada um com o seu nome, na ordem em que foram salvos", async () => {
    const nomes = ["Clean", "Jornal escuro", "Convite creme", "Minimal", "Arco"];
    for (const [i, n] of nomes.entries()) {
      const r = await E.salvarEstilo(t.id, n, estilo(["minima", "jornal", "convite", "minima", "arco"][i], i % 2 ? "noite" : "claro"));
      if (!r.ok) throw new Error(`recusou o ${i + 1}º: ${r.erro}`);
    }
    igual((await E.estilosDoEstudio(t.id)).map((e) => e.nome), nomes, "nomes");
    return "5 de 5";
  });

  await etapa("o sexto é recusado, com o recado de apagar um", async () => {
    const r = await E.salvarEstilo(t.id, "Sexto", estilo("imersa", "claro"));
    if (r.ok) throw new Error("salvou o sexto");
    if (!/5 estilos/.test(r.erro)) throw new Error(`recado: ${r.erro}`);
    igual((await E.estilosDoEstudio(t.id)).length, 5, "quantos");
  });

  await etapa("oito cliques ao mesmo tempo não passam de cinco", async () => {
    await db.query("delete from estilos_do_estudio where tenant_id = $1", [t.id]);
    const r = await Promise.all(
      Array.from({ length: 8 }, (_, i) => E.salvarEstilo(t.id, `Paralelo ${i}`, estilo("minima", "claro"))),
    );
    igual(r.filter((x) => x.ok).length, 5, "salvos");
    const { rows } = await db.query("select count(*)::int n from estilos_do_estudio where tenant_id = $1", [t.id]);
    igual(rows[0].n, 5, "no banco");
    await db.query("delete from estilos_do_estudio where tenant_id = $1", [t.id]);
  });

  await etapa("nome vazio, longo ou repetido é recusado; espaço sobrando sai", async () => {
    if ((await E.salvarEstilo(t.id, "   ", estilo("minima", "claro"))).ok) throw new Error("aceitou nome vazio");
    if ((await E.salvarEstilo(t.id, "x".repeat(41), estilo("minima", "claro"))).ok) throw new Error("aceitou 41 letras");
    const ok = await E.salvarEstilo(t.id, "  Meu   clean  ", estilo("minima", "claro"));
    if (!ok.ok) throw new Error(ok.erro);
    igual(ok.estilos.map((e) => e.nome), ["Meu clean"], "normalizado");
    const repetido = await E.salvarEstilo(t.id, "meu CLEAN", estilo("jornal", "noite"));
    if (repetido.ok) throw new Error("aceitou o mesmo nome com outra caixa");
    if (!/Já existe/.test(repetido.erro)) throw new Error(`recado: ${repetido.erro}`);
  });

  await etapa("a combinação passa por lerAparencia antes de gravar", async () => {
    const r = await E.salvarEstilo(t.id, "Torto", { capa: "nao-existe", tema: "claro", grade: 42 });
    if (!r.ok) throw new Error(r.erro);
    const salvo = r.estilos.find((e) => e.nome === "Torto");
    igual(salvo.aparencia, lerAparencia({ capa: "nao-existe", tema: "claro", grade: 42 }), "aparência");
  });

  const [primeiro] = await E.estilosDoEstudio(t.id);

  await etapa("renomear troca o nome; nome repetido é recusado", async () => {
    const r = await E.renomearEstilo(t.id, primeiro.id, "Clean do Juan");
    if (!r.ok) throw new Error(r.erro);
    igual(r.estilos[0].nome, "Clean do Juan", "nome");
    const rep = await E.renomearEstilo(t.id, primeiro.id, "torto");
    if (rep.ok) throw new Error("renomeou para o nome de outro estilo");
  });

  await etapa("outro estúdio não vê, não renomeia, não apaga e não usa", async () => {
    igual(await E.estilosDoEstudio(outro.id), [], "lista do outro");
    if ((await E.renomearEstilo(outro.id, primeiro.id, "Roubado")).ok) throw new Error("renomeou o de outro");
    await E.apagarEstilo(outro.id, primeiro.id);
    igual((await E.estilosDoEstudio(t.id)).some((e) => e.id === primeiro.id), true, "sobreviveu");
    igual(await E.aparenciaDoEstilo(outro.id, primeiro.id), null, "aparência para o outro");
    const nasce = await aparenciaInicialDaGaleria(outro.id, "", primeiro.id);
    if (nasce !== null) throw new Error("a galeria do outro nasceu com o estilo alheio");
    if ((await E.renomearEstilo(t.id, "nao-e-uuid", "X")).ok) throw new Error("aceitou id torto");
  });

  await etapa("na criação: pronto vence o estilo, e o estilo vence o padrão", async () => {
    await salvarPadraoDoEstudio(t.id, estilo("redonda", "creme"));
    const doEstilo = await aparenciaInicialDaGaleria(t.id, "", primeiro.id);
    igual(lerAparencia(doEstilo).capa, primeiro.aparencia.capa, "estilo salvo");
    const pronto = await aparenciaInicialDaGaleria(t.id, PRESETS[0].id, primeiro.id);
    igual(pronto, PRESETS[0].aparencia, "o pronto vence");
    const padrao = await aparenciaInicialDaGaleria(t.id, "", "");
    igual(lerAparencia(padrao).capa, "redonda", "sem escolha, o padrão");
    const sumiu = await aparenciaInicialDaGaleria(t.id, "", "00000000-0000-0000-0000-000000000000");
    igual(lerAparencia(sumiu).capa, "redonda", "estilo apagado cai no padrão");
  });

  await etapa("tornar padrão copia o estilo para as galerias novas", async () => {
    const aparencia = await E.tornarEstiloPadrao(t.id, primeiro.id);
    if (!aparencia) throw new Error("não tornou");
    igual(lerAparencia(await padraoDoEstudio(t.id)), primeiro.aparencia, "padrão");
    igual(await E.tornarEstiloPadrao(outro.id, primeiro.id), null, "o outro estúdio");
  });

  await etapa("apagar o estilo não mexe em galeria nenhuma, nem no padrão", async () => {
    const antes = (await db.query("select aparencia from galerias where id = $1", [entregue.id])).rows[0].aparencia;
    const padraoAntes = await padraoDoEstudio(t.id);
    const r = await E.apagarEstilo(t.id, primeiro.id);
    igual(r.estilos.some((e) => e.id === primeiro.id), false, "apagado");
    const depois = (await db.query("select aparencia from galerias where id = $1", [entregue.id])).rows[0].aparencia;
    igual(depois, antes, "galeria");
    igual(await padraoDoEstudio(t.id), padraoAntes, "padrão");
  });

  await etapa("a criação da galeria lê o campo `estilo` do formulário", async () => {
    const fonte = await import("node:fs/promises").then((fs) => fs.readFile("src/app/painel/actions.ts", "utf8"));
    if (!/String\(form\.get\("estilo"\)/.test(fonte)) throw new Error("criarGaleriaAction ignora o estilo escolhido");
    const assistente = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/app/painel/galerias/nova/assistente.tsx", "utf8"),
    );
    if (!/name="estilo"/.test(assistente)) throw new Error("o assistente não manda o estilo");
  });
} finally {
  await db.query("delete from estilos_do_estudio where tenant_id in ($1, $2)", [t.id, outro.id]);
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ os estilos do estúdio têm problema" : "\n✓ estilos do estúdio ok");
process.exit(falhou ? 1 : 0);
