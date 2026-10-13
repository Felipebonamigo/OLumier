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
import {
  panoramaDosEstudios,
  fichaDoEstudio,
  crescimentoMensal,
  entregaRecente,
  eventosRecentes,
} from "../src/lib/admin.ts";
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

  /*
   * A tela do painel lê vinte campos desta consulta. Um `select` que esquece um
   * deles não quebra nada: o React recebe `undefined`, renderiza vazio, e a
   * coluna some sem erro nenhum — que é o pior jeito de perder um número de
   * dinheiro. Esta etapa é a lista de presença.
   */
  await etapa("traz todos os campos que a tela lê", async () => {
    const linhas = await panoramaDosEstudios();
    if (linhas.length === 0) return "banco sem estúdios";
    const e = linhas[0];
    const obrigatorios = [
      "ciclo_cobranca", "cpf_cnpj", "dominio_proprio", "asaas_cliente_id",
      "asaas_assinatura_id", "assinatura_criada_em", "ultimo_pagamento_em",
      "pago_ate", "senha_alterada_em", "quota_bytes", "galerias", "publicadas",
      "na_lixeira", "medias", "fotos", "videos", "acessos_30d", "favoritas",
      "ultimo_acesso", "ultimo_envio",
    ];
    for (const campo of obrigatorios) {
      if (!(campo in e)) throw new Error(`falta o campo ${campo}`);
    }
    return `${obrigatorios.length} campos`;
  });

  await etapa("foto mais vídeo fecha com o total de arquivos", async () => {
    for (const e of await panoramaDosEstudios()) {
      if (e.fotos + e.videos !== e.medias) {
        throw new Error(`${e.slug}: ${e.fotos}+${e.videos} ≠ ${e.medias}`);
      }
    }
  });

  console.log("\na ficha de um estúdio");

  /*
   * O id vem da URL, e qualquer pessoa pode digitar o que quiser lá. Sem esta
   * guarda o Postgres recusa o texto como uuid e a página devolve erro 500 —
   * que, além de feio, confirma que a rota existe.
   */
  await etapa("id que não é uuid vira ficha vazia, não erro do banco", async () => {
    for (const lixo of ["nao-e-uuid", "'; drop table tenants; --", ""]) {
      igual(await fichaDoEstudio(lixo), null, `deveria recusar ${JSON.stringify(lixo)}`);
    }
  });

  await etapa("uuid válido que não existe também vira ficha vazia", async () => {
    igual(await fichaDoEstudio("00000000-0000-0000-0000-000000000000"), null, "inexistente");
  });

  await etapa("a ficha traz conta, galerias e histórico", async () => {
    const estudio = await estudioDaRodada(db);
    const ficha = await fichaDoEstudio(estudio.id);
    if (!ficha) throw new Error("não achou o estúdio da rodada");
    igual(ficha.estudio.id, estudio.id, "id");
    if (!Array.isArray(ficha.galerias)) throw new Error("galerias não é lista");
    if (!Array.isArray(ficha.eventos)) throw new Error("eventos não é lista");
  });

  console.log("\nas séries do painel");

  await etapa("a série começa no primeiro mês que teve dado, sem buraco depois", async () => {
    // Pedido do Felipe (13/10/2026): os meses anteriores ao primeiro cadastro
    // não entram. Eram barras rasas que ocupavam metade do gráfico e não
    // diziam "vendi pouco" — diziam "a plataforma não existia", que ninguém
    // precisa ler num gráfico de crescimento.
    //
    // MÊS VAZIO NO MEIO CONTINUA APARECENDO: ali o zero é informação (houve
    // mês e não houve cadastro). Só o começo é cortado — por isso a conta
    // abaixo compara o primeiro mês da série com o primeiro mês COM dado, e
    // não com "o primeiro mês não vazio".
    const meses = await crescimentoMensal(12);
    const { rows } = await db.query(`
      select to_char(date_trunc('month', now()) - make_interval(months => 11), 'YYYY-MM') as janela,
             to_char(least(
               (select min(date_trunc('month', criado_em)) from tenants),
               (select min(date_trunc('month', criado_em)) from medias where pronto)
             ), 'YYYY-MM') as primeiro,
             to_char(now(), 'YYYY-MM') as agora
    `);
    const { janela, primeiro, agora } = rows[0];
    // Dado mais velho que a janela não encurta nada: aí os doze meses têm história.
    const esperado = primeiro && primeiro > janela ? primeiro : janela;

    igual(meses[0].mes, esperado, "primeiro mês da série");
    igual(meses.at(-1).mes, agora, "último mês da série");
    if (esperado === primeiro && meses[0].cadastros === 0 && meses[0].bytes_enviados === "0") {
      throw new Error("a série ainda começa num mês vazio");
    }
    for (const m of meses) {
      if (!/^\d{4}-\d{2}$/.test(m.mes)) throw new Error(`mês fora do formato: ${m.mes}`);
      if (typeof m.cadastros !== "number") throw new Error(`${m.mes} sem cadastros`);
      if (typeof m.bytes_enviados !== "string") throw new Error(`${m.mes} sem bytes em texto`);
    }
    // Mês a mês consecutivo: buraco no MEIO vira barra faltando, que se lê
    // como mês que não houve.
    for (let i = 1; i < meses.length; i++) {
      const [a, mA] = meses[i - 1].mes.split("-").map(Number);
      const [b, mB] = meses[i].mes.split("-").map(Number);
      if (b * 12 + mB - (a * 12 + mA) !== 1) {
        throw new Error(`buraco entre ${meses[i - 1].mes} e ${meses[i].mes}`);
      }
    }
    return meses.map((m) => m.mes).join(" ");
  });

  await etapa("a entrega separa as quatro ações", async () => {
    const e = await entregaRecente(30);
    for (const acao of ["abriu", "baixou", "baixou_tudo", "assistiu"]) {
      if (typeof e[acao] !== "number") throw new Error(`falta ${acao}`);
    }
  });

  await etapa("os eventos recentes respeitam o limite", async () => {
    const evs = await eventosRecentes(5);
    if (evs.length > 5) throw new Error(`veio ${evs.length}, pedi 5`);
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

      /*
       * A FICHA É A SEGUNDA PÁGINA DA ÁREA, e é por onde o portão se perde.
       *
       * A primeira nasceu com a checagem escrita à mão dentro dela. Copiar
       * aquelas seis linhas para cada página nova é o caminho conhecido para a
       * terceira nascer sem elas — e página desprotegida não avisa: ela
       * responde 200 com o e-mail, o CPF e o histórico de um cliente para
       * qualquer conta logada. Por isso o portão virou `lib/portao-admin.ts`, e
       * por isso esta etapa existe apontando para a rota, não para a função.
       */
      await etapa("a ficha de um estúdio também recusa quem não é admin", async () => {
        const r = await fetch(`${BASE}/painel/admin/estudios/${estudio.id}`, {
          headers: { cookie },
        });
        igual(r.status, 404, "status");
        const corpo = await r.text();
        if (corpo.includes(estudio.email)) throw new Error("vazou o e-mail do estúdio");
        if (/negado|permissão|autoriza/i.test(corpo)) {
          throw new Error("a resposta confirma que a página existe");
        }
      });

      /* Terceira página da área. Mesma regra, mesma etapa: o portão é
         compartilhado justamente para que acrescentar página não exija lembrar
         de nada — e esta etapa é o que prova que não exigiu. */
      await etapa("o histórico também recusa quem não é admin", async () => {
        const r = await fetch(`${BASE}/painel/admin/eventos`, { headers: { cookie } });
        igual(r.status, 404, "status");
        const corpo = await r.text();
        if (/hist[óo]rico|auditoria/i.test(corpo)) throw new Error("vazou conteúdo da página");
      });

      await etapa("sem sessão a ficha também não existe", async () => {
        const r = await fetch(`${BASE}/painel/admin/estudios/${estudio.id}`, {
          redirect: "manual",
        });
        if (r.status === 200) throw new Error("respondeu 200 sem sessão");
        return `HTTP ${r.status}`;
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
