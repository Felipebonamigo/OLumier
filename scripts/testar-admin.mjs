#!/usr/bin/env node
/**
 * Testa a visão de administrador. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-admin.mjs
 *
 * O que importa aqui é o PORTÃO. A página mostra a lista de todos os estúdios —
 * nome, e-mail, uso, situação de pagamento. Errar quem entra é vazar a base de
 * clientes inteira para um cliente.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { ehAdmin, administradores } from "../src/config/admin.ts";
import { panoramaDosEstudios } from "../src/lib/admin.ts";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

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

const guardado = process.env.ADMINS;
const restaurar = () => {
  if (guardado === undefined) delete process.env.ADMINS;
  else process.env.ADMINS = guardado;
};

try {
  console.log("quem é admin");

  /*
   * O padrão precisa ser "ninguém". Uma lista vazia que liberasse geral
   * transformaria esquecer de configurar em vazar a base — e esquecer de
   * configurar é o estado natural de uma instalação nova.
   */
  await etapa("sem ADMINS configurada, NINGUÉM é admin", () => {
    delete process.env.ADMINS;
    igual(ehAdmin("qualquer@um.com"), false, "sem variável");
    process.env.ADMINS = "";
    igual(ehAdmin("qualquer@um.com"), false, "variável vazia");
    process.env.ADMINS = "   ,  , ";
    igual(ehAdmin("qualquer@um.com"), false, "só vírgulas e espaço");
    igual(administradores().length, 0, "lista vazia");
  });

  await etapa("reconhece quem está na lista", () => {
    process.env.ADMINS = "felipe@exemplo.com, carol@exemplo.com";
    igual(ehAdmin("felipe@exemplo.com"), true, "primeiro");
    igual(ehAdmin("carol@exemplo.com"), true, "segundo");
  });

  await etapa("não diferencia maiúscula nem espaço em volta", () => {
    process.env.ADMINS = "  Felipe@Exemplo.COM ";
    igual(ehAdmin("felipe@exemplo.com"), true, "minúsculo");
    igual(ehAdmin("  FELIPE@EXEMPLO.COM  "), true, "maiúsculo com espaço");
  });

  await etapa("recusa quem não está na lista", () => {
    process.env.ADMINS = "felipe@exemplo.com";
    for (const e of [
      "outro@exemplo.com",
      "felipe@exemplo.com.br", // parecido não é igual
      "xfelipe@exemplo.com",
      "felipe@exemplo.co",
      "",
      null,
      undefined,
    ]) {
      igual(ehAdmin(e), false, `deveria recusar ${JSON.stringify(e)}`);
    }
  });

  console.log("\npanorama");

  await etapa("uma consulta devolve todos os estúdios com os números", async () => {
    const linhas = await panoramaDosEstudios();
    const { rows } = await db.query("select count(*)::int n from tenants");
    igual(linhas.length, rows[0].n, "quantidade de estúdios");
    if (linhas.length === 0) return "banco sem estúdios";

    const e = linhas[0];
    for (const campo of ["id", "nome_estudio", "email", "slug", "status", "bytes_no_ar"]) {
      if (e[campo] === undefined) throw new Error(`falta o campo ${campo}`);
    }
    // bigint precisa vir como texto: acima de 8 PB o Number perde precisão.
    if (typeof e.bytes_no_ar !== "string") throw new Error("bytes_no_ar não veio como texto");
    return `${linhas.length} estúdio(s)`;
  });

  await etapa("separa o que está no ar do que está no cofre", async () => {
    const linhas = await panoramaDosEstudios();
    if (linhas.length === 0) return "sem estúdios para conferir";
    const e = linhas[0];

    const { rows } = await db.query(
      `select
         coalesce(sum(m.bytes) filter (where g.estado <> 'arquivada'), 0)::text no_ar,
         coalesce(sum(m.bytes) filter (where g.estado =  'arquivada'), 0)::text cofre
       from medias m join galerias g on g.id = m.galeria_id
      where g.tenant_id = $1 and m.pronto`,
      [e.id],
    );
    igual(e.bytes_no_ar, rows[0].no_ar, "bytes no ar");
    igual(e.bytes_no_cofre, rows[0].cofre, "bytes no cofre");
  });

  // --- o portão, pela rota ---------------------------------------------------

  let servidor = false;
  try {
    servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }

  if (!servidor) {
    console.log("\n⚠ servidor fora do ar — a parte da rota foi pulada");
  } else {
    console.log("\npela rota");

    // Estúdio próprio desta execução — antes vinha o mais antigo do banco.
    {
      const estudio = await estudioDaRodada(db);
      const cookie = cookieDeSessao(estudio.id);

      await etapa("sem sessão a página não existe", async () => {
        const r = await fetch(`${BASE}/painel/admin`, { redirect: "manual" });
        // Sem sessão vai para /entrar (302/307) — nunca mostra a tabela.
        if (r.status === 200) throw new Error("respondeu 200 sem sessão");
        return `HTTP ${r.status}`;
      });

      /*
       * O caso importante: conta VÁLIDA que não é admin. É o cliente logado
       * tentando o endereço. Precisa ser 404 — e não "acesso negado", que
       * confirmaria a existência da página.
       */
      await etapa("estúdio comum recebe 404, não 'acesso negado'", async () => {
        const r = await fetch(`${BASE}/painel/admin`, { headers: { cookie } });
        igual(r.status, 404, "status");
        const corpo = await r.text();
        if (/administra|estúdios da plataforma/i.test(corpo)) {
          throw new Error("a página vazou conteúdo para quem não é admin");
        }
        if (/negado|permissão|autoriza/i.test(corpo)) {
          throw new Error("a resposta confirma que a página existe");
        }
      });
    }
  }
} finally {
  restaurar();
  // A bancada desta execucao sai inteira, na ordem certa (ver fixture-de-teste.mjs).
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a visão de administrador tem problema");
  process.exit(1);
}
console.log("\n✓ visão de administrador íntegra\n");
