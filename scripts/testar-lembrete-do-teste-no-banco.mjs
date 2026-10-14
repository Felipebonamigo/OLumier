#!/usr/bin/env node
/**
 * Quem recebe o lembrete do teste — a consulta e as marcas, no banco. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-lembrete-do-teste-no-banco.mjs
 *
 * A regra de QUANDO avisar é pura e mora em `testar-lembrete-do-teste.mjs`.
 * Aqui conferimos o que a rotina da madrugada faz com ela: escolhe a conta
 * certa, não repete o aviso, e começa de novo quando o prazo é estendido. O
 * envio em si é simulado (`aplicar: false`) — nenhum e-mail sai de uma suíte.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { rodarLembretesDoTeste, textoDoLembrete } from "../src/lib/lembretes-do-teste.ts";
import { lembreteDoTeste } from "../src/lib/lembrete-do-teste.ts";

exigirBancoDeTeste();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: veio ${JSON.stringify(a)}, esperava ${JSON.stringify(b)}`);
};

const DIA = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
const agora = new Date();

try {
  const t = await estudioDaRodada(db);
  const rodar = () => rodarLembretesDoTeste({ aplicar: false, forcarLigada: true, apenas: [t.id] });
  const poe = (campos) =>
    db.query(
      `update tenants set status = 'trial', asaas_assinatura_id = null,
              trial_ate = $2, quota_bytes = $3, aviso_teste_tempo_em = $4, aviso_teste_espaco_em = $5
        where id = $1`,
      [t.id, campos.trialAte, campos.quota ?? 200 * GB, campos.avisoTempo ?? null, campos.avisoEspaco ?? null],
    );
  const enche = async (bytes) => {
    await db.query("delete from galerias where tenant_id = $1", [t.id]);
    const g = await db.query(
      `insert into galerias (tenant_id, slug, titulo, estado) values ($1, $2, 'x', 'online') returning id`,
      [t.id, `x-${Date.now()}`],
    );
    await db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, ordem, pronto)
       values ($1, $2, $3, 'a.jpg', 'foto', 'image/jpeg', $4, 0, true)`,
      [g.rows[0].id, t.id, `${t.id}/${g.rows[0].id}/a.jpg`, String(bytes)],
    );
  };

  console.log("O lembrete do teste, no banco:\n");

  await etapa("teste folgado: ninguém é avisado", async () => {
    await poe({ trialAte: new Date(agora.getTime() + 10 * DIA) });
    const r = await rodar();
    igual([r.tempo, r.espaco], [0, 0], "avisos");
  });

  await etapa("faltando 3 dias: aviso de tempo", async () => {
    await poe({ trialAte: new Date(agora.getTime() + 2.5 * DIA) });
    const r = await rodar();
    igual([r.tempo, r.espaco], [1, 0], "avisos");
  });

  await etapa("o aviso de tempo não se repete", async () => {
    await poe({
      trialAte: new Date(agora.getTime() + 2.5 * DIA),
      avisoTempo: new Date(agora.getTime() - 3600_000),
    });
    igual((await rodar()).tempo, 0, "repetiu");
  });

  await etapa("teste estendido pelo admin ganha um aviso novo", async () => {
    /* O aviso antigo é de 11 dias atrás; o prazo novo vence em 2 dias. */
    await poe({
      trialAte: new Date(agora.getTime() + 2 * DIA),
      avisoTempo: new Date(agora.getTime() - 11 * DIA),
    });
    igual((await rodar()).tempo, 1, "não avisou de novo");
  });

  await etapa("80% do espaço: aviso de espaço, uma vez só", async () => {
    await poe({ trialAte: new Date(agora.getTime() + 10 * DIA) });
    await enche(8.5 * GB);
    igual((await rodar()).espaco, 1, "primeiro");
    await poe({ trialAte: new Date(agora.getTime() + 10 * DIA), avisoEspaco: new Date() });
    igual((await rodar()).espaco, 0, "repetiu");
  });

  await etapa("quem já assina, ou já venceu, ou não é teste, fica de fora", async () => {
    await enche(9 * GB);
    await poe({ trialAte: new Date(agora.getTime() + 1 * DIA) });
    await db.query("update tenants set asaas_assinatura_id = 'sub_x' where id = $1", [t.id]);
    igual((await rodar()).linhas.length, 0, "com assinatura");
    await poe({ trialAte: new Date(agora.getTime() - 1 * DIA) });
    igual((await rodar()).linhas.length, 0, "vencido");
    await poe({ trialAte: new Date(agora.getTime() + 1 * DIA) });
    await db.query("update tenants set status = 'ativo' where id = $1", [t.id]);
    igual((await rodar()).linhas.length, 0, "pago");
  });

  await etapa("desligada (sem e-mail/cobrança), a rotina não faz nada", async () => {
    await poe({ trialAte: new Date(agora.getTime() + 1 * DIA) });
    const r = await rodarLembretesDoTeste({ aplicar: true, forcarLigada: false, apenas: [t.id] });
    igual([r.ligada, r.linhas.length], [false, 0], "desligada");
    const { rows } = await db.query("select aviso_teste_tempo_em from tenants where id = $1", [t.id]);
    igual(rows[0].aviso_teste_tempo_em, null, "gravou marca sem enviar");
  });

  await etapa("o texto diz os números certos e para onde ir", async () => {
    const l = lembreteDoTeste(
      { status: "trial", trial_ate: new Date(agora.getTime() + 2 * DIA), quota_bytes: String(200 * GB) },
      BigInt(Math.round(8.5 * GB)),
      true,
      agora,
    );
    const tempo = textoDoLembrete("tempo", { nome_estudio: "Estúdio X" }, l);
    const espaco = textoDoLembrete("espaco", { nome_estudio: "Estúdio X" }, l);
    for (const t2 of [tempo, espaco]) {
      const todo = `${t2.assunto} ${t2.paragrafos.join(" ")}`;
      if (!todo.includes("10 GB")) throw new Error(`não cita os 10 GB: ${todo}`);
    }
    if (!/em 2 dias/.test(tempo.assunto)) throw new Error(`assunto de tempo: ${tempo.assunto}`);
    if (!/15 dias/.test(tempo.paragrafos[0])) throw new Error("não diz quanto tempo as galerias ficam no ar");
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o lembrete no banco tem problema" : "\n✓ lembrete no banco ok");
process.exitCode = falhou ? 1 : 0;
