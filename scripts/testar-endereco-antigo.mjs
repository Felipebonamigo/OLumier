#!/usr/bin/env node
/**
 * Trocar o endereço do estúdio sem quebrar link já entregue. Uso:
 *
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-endereco-antigo.mjs
 *
 * ── O PROBLEMA ────────────────────────────────────────────────────────────
 *
 * O endereço do estúdio (`tenants.slug`) nasce no cadastro e aparece em três
 * lugares que vão para fora: o link da galeria (`/g/<estudio>/<galeria>`), a
 * vitrine (`/e/<estudio>`) e o subdomínio próprio. Trocá-lo derruba TODO link
 * que o fotógrafo já mandou para um casal — e link de casamento não se
 * "reenvia": ele está num grupo de WhatsApp de 2023 que ninguém vai reabrir.
 *
 * Por isso o campo era travado, com a tela dizendo "links já entregues não podem
 * quebrar". A trava resolvia o risco e não resolvia a necessidade: quem errou o
 * nome no cadastro ficava com ele para sempre.
 *
 * ── A REGRA ───────────────────────────────────────────────────────────────
 *
 * O endereço anterior vira APELIDO e continua resolvendo, com redirecionamento
 * permanente para o novo. O casal não percebe nada; o Google aprende a troca.
 *
 * As três recusas valem mais que o caminho feliz, e é onde este teste insiste:
 *
 *  1. apelido de OUTRO estúdio nunca é reutilizado. Sem isso, o link que A
 *     entregou passaria a abrir a galeria de B — vazamento com aparência de
 *     funcionamento normal;
 *  2. o próprio apelido antigo pode ser retomado, senão quem troca por engano
 *     não consegue voltar;
 *  3. o subdomínio antigo continua valendo para emissão de certificado, senão
 *     ele passa a dar erro de TLS em vez de redirecionar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import {
  resolverEstudio,
  enderecoDisponivel,
  trocarEndereco,
  LIMITE_TROCAS,
} from "../src/lib/endereco.ts";

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

const marca = `end-${Date.now()}`;
const criar = async (slug) => {
  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash)
     values ($1, 'Teste Endereço', $2, 'x') returning id`,
    [slug, `${slug}@teste`],
  );
  return rows[0].id;
};

const A = await criar(`${marca}-a`);
const B = await criar(`${marca}-b`);

console.log("O endereço do estúdio:\n");

try {
  /* ── a troca, e o apelido ──────────────────────────────────────────────── */

  await etapa("trocar o endereço guarda o anterior como apelido", async () => {
    const r = await trocarEndereco(A, `${marca}-novo`);
    if (r.erro) throw new Error(r.erro);
    const atual = await resolverEstudio(`${marca}-novo`);
    if (atual?.tenantId !== A) throw new Error("o endereço novo não resolve");
    if (atual.ehAntigo) throw new Error("o endereço novo veio marcado como antigo");
  });

  await etapa("o endereço ANTIGO continua resolvendo, marcado como antigo", async () => {
    const velho = await resolverEstudio(`${marca}-a`);
    if (!velho) throw new Error("o link já entregue ao casal parou de abrir");
    if (velho.tenantId !== A) throw new Error("resolveu para o estúdio errado");
    if (!velho.ehAntigo) throw new Error("não avisou que é antigo — não haveria redirecionamento");
    if (velho.slugAtual !== `${marca}-novo`) throw new Error("não disse para onde redirecionar");
    return `${marca}-a → ${velho.slugAtual}`;
  });

  await etapa("endereço que não existe em lugar nenhum devolve nada", async () => {
    if (await resolverEstudio(`${marca}-nunca-existiu`)) {
      throw new Error("resolveu um endereço inventado");
    }
  });

  /* ── as três recusas ───────────────────────────────────────────────────── */

  await etapa("apelido de OUTRO estúdio NÃO pode ser tomado", async () => {
    /* A recusa mais cara do arquivo. Sem ela, o link que A entregou ao casal
     * dele passa a abrir a galeria de B — e nada na tela denuncia. */
    const livre = await enderecoDisponivel(`${marca}-a`, B);
    if (livre) throw new Error("liberou o endereço antigo de A para B — vaza galeria entre contas");
  });

  await etapa("o PRÓPRIO apelido antigo pode ser retomado", async () => {
    /* Quem troca por engano precisa conseguir voltar. É o mesmo endereço, o
     * mesmo dono, e os links entregues apontam para lá de qualquer jeito. */
    if (!(await enderecoDisponivel(`${marca}-a`, A))) {
      throw new Error("o estúdio não consegue voltar ao próprio endereço anterior");
    }
  });

  await etapa("endereço em uso por outro estúdio continua recusado", async () => {
    if (await enderecoDisponivel(`${marca}-b`, A)) throw new Error("dois estúdios no mesmo endereço");
  });

  await etapa("voltar ao endereço antigo LIMPA o apelido", async () => {
    /* Senão o estúdio fica com um apelido apontando para ele mesmo, e o
     * redirecionamento vira laço: /a → /a. */
    const r = await trocarEndereco(A, `${marca}-a`);
    if (r.erro) throw new Error(r.erro);
    const agora = await resolverEstudio(`${marca}-a`);
    if (agora?.ehAntigo) throw new Error("o endereço atual ficou marcado como antigo — vira laço");
  });

  /* ── o limite ──────────────────────────────────────────────────────────── */

  await etapa(`o limite de ${LIMITE_TROCAS} trocas é imposto`, async () => {
    /* A tabela de apelidos cresce para sempre e é consultada em toda visita que
     * erra o endereço atual. Sem limite, uma conta sozinha pode enchê-la. */
    const feitas = await db.query(
      "select count(*)::int as n from enderecos_antigos where tenant_id = $1",
      [A],
    );
    for (let i = feitas.rows[0].n; i < LIMITE_TROCAS + 2; i++) {
      const r = await trocarEndereco(A, `${marca}-t${i}`);
      if (r.erro) {
        if (!/j[áa] trocou|limite/i.test(r.erro)) {
          throw new Error(`recusou por outro motivo: ${r.erro}`);
        }
        return `parou na ${i}ª`;
      }
    }
    throw new Error(`passou de ${LIMITE_TROCAS} trocas sem reclamar`);
  });

  /* ── a fiação: quem resolve slug precisa conhecer o apelido ────────────── */

  await etapa("os três lugares que VALIDAM endereço conhecem o apelido", async () => {
    /*
     * Três, e não quatro: o `proxy.ts` só extrai o rótulo do subdomínio e o
     * repassa, sem conferir no banco se aquele estúdio existe. Quem valida é a
     * página, e é lá que o apelido precisa ser conhecido. Passar pelo proxy
     * também seria uma consulta ao banco em TODA visita, para servir o caso
     * raro de quem chega pelo endereço velho.
     *
     * O porteiro do certificado é diferente e não pode ficar de fora: sem ele, o
     * subdomínio antigo nem chega a responder — o visitante toma erro de TLS
     * antes de qualquer redirecionamento existir.
     */
    const { readFileSync } = await import("node:fs");
    const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

    const alvos = [
      ["src/app/api/tls/permitir/route.ts", "a emissão de certificado"],
      ["src/app/g/[estudio]/[galeria]/page.tsx", "o link da galeria"],
      ["src/app/e/[estudio]/page.tsx", "a vitrine"],
    ];
    for (const [arquivo, oque] of alvos) {
      if (!/resolverEstudio/.test(ler(arquivo))) {
        throw new Error(`${oque} (${arquivo}) não conhece apelido — quebra o link entregue`);
      }
    }
    return "3 lugares";
  });
} finally {
  await db.query("delete from tenants where id = any($1)", [[A, B]]);
  await db.end();
}

console.log(falhou ? "\n✗ o endereço do estúdio tem problema" : "\n✓ endereço do estúdio ok");
process.exitCode = falhou ? 1 : 0;
