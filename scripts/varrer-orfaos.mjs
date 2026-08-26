#!/usr/bin/env node
/**
 * Acha (e opcionalmente apaga) arquivo pago que ninguém mais referencia.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs --apagar
 *
 * Por que existe: objeto no bucket sem linha correspondente é invisível — não
 * aparece no painel, não conta na quota, não aparece em relatório nenhum — e
 * continua sendo cobrado todo mês. O jeito de descobrir é comparar as listas.
 *
 * Como isso acontece: galeria apagada antes da correção de 20/08/2026, upload
 * interrompido entre o PUT e a confirmação, logo trocada, ou um teste que morreu
 * no meio.
 *
 * SEM `--apagar` ele só relata. Apagar arquivo é irreversível, então a ação
 * destrutiva precisa ser pedida explicitamente.
 */
import pg from "pg";
import { listarObjetos, apagarObjetos, BUCKET } from "../src/lib/r2.ts";
import { listarArquivos, apagarArquivo, ARQUIVOS_BUCKET, arquivosConfigurado } from "../src/lib/b2.ts";
import { chavesConhecidas, podeApagar } from "./varrer-orfaos-regras.mjs";

const APAGAR = process.argv.includes("--apagar");

/*
 * O guarda do ambiente, ANTES de qualquer outra coisa.
 *
 * Fica aqui em cima de propósito: antes de conectar no banco, antes de listar o
 * bucket. Recusar depois de listar custaria tempo e chamada paga sem necessidade
 * — mas o motivo que importa é outro. Quanto mais código roda antes da recusa,
 * mais fácil é alguém, um dia, mover a checagem para depois do apagamento sem
 * perceber que a moveu para depois.
 *
 * Só vale para `--apagar`: relatar é sempre seguro, e relatar de outro ambiente
 * é justamente como este problema foi descoberto.
 *
 * A regra e o porquê estão em varrer-orfaos-regras.mjs; o teste está em
 * scripts/testar-varredura.mjs, que confere inclusive esta chamada existir.
 */
if (APAGAR) {
  const veredito = podeApagar({ bucket: BUCKET, databaseUrl: process.env.DATABASE_URL });
  if (!veredito.pode) {
    console.error(`✗ --apagar recusado: ${veredito.motivo}`);
    console.error(`\n  Sem --apagar a varredura roda normalmente e só relata.`);
    process.exit(1);
  }
}

/*
 * Margem de segurança: entre o PUT no bucket e a confirmação no banco existe uma
 * janela em que o objeto é, tecnicamente, órfão. Sem esta margem a varredura
 * apagaria o arquivo de quem está enviando NESTE momento — o pior jeito possível
 * de "limpar".
 *
 * Esta constante existia desde o começo e o comentário prometia exatamente isso,
 * mas o filtro nunca usava a idade: a promessa estava no comentário e não no
 * código. Corrigido em 21/08/2026.
 */
const IDADE_MINIMA_H = 24;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/*
 * DOIS ARMAZÉNS, DOIS CONJUNTOS. Cada bucket é comparado contra as chaves
 * conhecidas DELE — ver `chavesConhecidas` para a razão, que é destrutiva se
 * ignorada: as derivadas ficam sempre no R2 mesmo quando o original está no B2.
 *
 * Enquanto as credenciais `ARQUIVOS_*` não existirem no ambiente, o B2 é pulado
 * com aviso. Silêncio aqui seria o defeito de novo: "0 órfãos" por não ter
 * olhado é indistinguível de "0 órfãos" por não haver nenhum.
 */
const conhecidas = await chavesConhecidas(db);
const corte = Date.now() - IDADE_MINIMA_H * 3600 * 1000;

const armazens = [
  { nome: "R2", bucket: BUCKET, listar: listarObjetos, conhecidas: conhecidas.r2, ligado: true },
  {
    nome: "B2",
    bucket: ARQUIVOS_BUCKET,
    listar: listarArquivos,
    conhecidas: conhecidas.b2,
    ligado: arquivosConfigurado,
  },
];

const orfaos = [];
let objetosVistos = 0;

for (const a of armazens) {
  if (!a.ligado) {
    console.log(`${a.nome}: sem credencial neste ambiente — NÃO conferido`);
    console.log(`  (órfão no ${a.nome}, se houver, não aparece nesta varredura)\n`);
    continue;
  }

  console.log(`${a.nome} — bucket ${a.bucket}`);
  const doBucket = await a.listar();
  objetosVistos += doBucket.length;
  console.log(`  objetos no bucket: ${doBucket.length}`);
  console.log(`  chaves conhecidas pelo banco: ${a.conhecidas.size}`);

  const candidatos = doBucket.filter((o) => !a.conhecidas.has(o.chave));

  // Sem data conhecida, trata como recente: na dúvida, não apaga.
  const novosDemais = candidatos.filter((o) => !o.modificadoEm || o.modificadoEm.getTime() > corte);
  const daqui = candidatos.filter((o) => o.modificadoEm && o.modificadoEm.getTime() <= corte);

  if (novosDemais.length > 0) {
    console.log(
      `  ${novosDemais.length} sem dono, mas com menos de ${IDADE_MINIMA_H}h — podem ser envios em andamento, preservados`,
    );
  }
  console.log(`  órfãos: ${daqui.length}\n`);

  for (const o of daqui) orfaos.push({ ...o, armazem: a.nome });
}

if (orfaos.length === 0) {
  console.log(`✓ nenhum órfão — ${objetosVistos} objeto(s) conferido(s), bucket e banco batem\n`);
  await db.end();
  process.exit(0);
}

console.log(`  ⚠ órfãos encontrados: ${orfaos.length}`);
for (const o of orfaos.slice(0, 20)) console.log(`     [${o.armazem}] ${o.chave}`);
if (orfaos.length > 20) console.log(`     … e mais ${orfaos.length - 20}`);

if (!APAGAR) {
  console.log(
    `\nNada foi apagado. Para remover de verdade:\n` +
      `  node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs --apagar\n`,
  );
  await db.end();
  process.exit(0);
}

// Confere de novo, agora contra o banco lido AGORA: entre a listagem e este
// ponto alguém pode ter confirmado um upload ou salvo uma logo.
const conhecidas2 = await chavesConhecidas(db);
const aindaOrfaos = orfaos.filter((o) =>
  o.armazem === "B2" ? !conhecidas2.b2.has(o.chave) : !conhecidas2.r2.has(o.chave),
);
const salvos = orfaos.length - aindaOrfaos.length;
if (salvos > 0) console.log(`  (${salvos} deixaram de ser órfãos durante a varredura — preservados)`);

/* Cada um sai pelo seu armazém. O R2 apaga em lote; o B2 não tem lote nesta
 * base de código, então vai um a um — e a falha de um não pode interromper os
 * outros, senão um único objeto problemático deixa a conta inteira de pé. */
const noR2 = aindaOrfaos.filter((o) => o.armazem === "R2").map((o) => o.chave);
const noB2 = aindaOrfaos.filter((o) => o.armazem === "B2").map((o) => o.chave);

console.log(`\n  apagando ${aindaOrfaos.length} (${noR2.length} no R2, ${noB2.length} no B2)…`);
await apagarObjetos(noR2);

let falhasB2 = 0;
for (const chave of noB2) {
  try {
    await apagarArquivo(chave);
  } catch (e) {
    falhasB2++;
    console.error(`  ! não saiu do B2: ${chave} — ${e.message}`);
  }
}

const removidos = aindaOrfaos.length - falhasB2;
console.log(`✓ ${removidos} objeto(s) órfão(s) removidos — deixaram de ser cobrados`);
if (falhasB2) console.log(`  ${falhasB2} continuam no B2 e continuam sendo cobrados\n`);
else console.log("");

await db.end();
