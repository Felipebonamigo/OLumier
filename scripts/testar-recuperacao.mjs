#!/usr/bin/env node
/**
 * Testa "esqueci minha senha" de ponta a ponta.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-recuperacao.mjs
 *
 * Este fluxo é a porta dos fundos da autenticação: quem passa por ele entra na
 * conta sem saber a senha. Por isso o que importa aqui são os testes NEGATIVOS
 * — token usado, vencido, inventado, reaproveitado — e não o caminho feliz, que
 * é o único que costuma ser exercitado na mão.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import {
  VALIDADE_MS,
  concluir,
  conferirToken,
  criarPedido,
  gerarToken,
  hashDoToken,
} from "../src/lib/recuperacao.ts";
import { conferirSenha, gerarHashSenha } from "../src/lib/auth.ts";
import { trocarSenha } from "../src/lib/senha.ts";
import { cookieDeSessao } from "./sessao-de-teste.mjs";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL } = process.env;
const db = new pg.Client({ connectionString: DATABASE_URL });
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

// Estudio proprio desta execucao (antes: o mais antigo do banco).
const tenant = await estudioDaRodada(db);
const senhaOriginal = tenant.senha_hash;

const VENCER = "update recuperacoes set expira_em = now() - interval '1 minute' where token_hash = $1";

try {
  console.log("token");

  await etapa("token é longo e sem caractere que quebre URL", () => {
    const t = gerarToken();
    if (t.length < 40) throw new Error(`curto demais: ${t.length}`);
    if (!/^[A-Za-z0-9_-]+$/.test(t)) throw new Error(`caractere fora do base64url: ${t}`);
    return `${t.length} caracteres`;
  });

  await etapa("dois tokens nunca saem iguais", () => {
    const vistos = new Set();
    for (let i = 0; i < 500; i++) vistos.add(gerarToken());
    igual(vistos.size, 500, "tokens distintos");
  });

  /*
   * O ponto da história: o dump do banco sai todo dia e vai para fora do
   * servidor. Token em texto puro no dump = qualquer cópia do backup vira chave
   * para entrar nas contas com pedido aberto.
   */
  await etapa("o banco guarda o HASH, nunca o token", async () => {
    const { token } = await criarPedido(tenant.id);
    const { rows } = await db.query(
      "select token_hash from recuperacoes where tenant_id = $1 order by criado_em desc limit 1",
      [tenant.id],
    );
    if (rows[0].token_hash === token) throw new Error("o token está em texto puro no banco!");
    igual(rows[0].token_hash, hashDoToken(token), "hash gravado");
    const { rows: busca } = await db.query("select 1 from recuperacoes where token_hash = $1", [
      token,
    ]);
    igual(busca.length, 0, "o token em texto não acha linha nenhuma");
  });

  console.log("\nconferência");

  await etapa("token válido é aceito e identifica a conta", async () => {
    const { token } = await criarPedido(tenant.id);
    const r = await conferirToken(token);
    if (!r.ok) throw new Error(`recusou: ${r.motivo}`);
    igual(r.pedido.tenantId, tenant.id, "conta do pedido");
  });

  await etapa("token inventado é recusado", async () => {
    const r = await conferirToken(gerarToken());
    if (r.ok) throw new Error("aceitou token que nunca existiu!");
    igual(r.motivo, "inexistente", "motivo");
  });

  await etapa("token vazio ou curto é recusado", async () => {
    for (const t of ["", "abc", "x".repeat(19)]) {
      const r = await conferirToken(t);
      if (r.ok) throw new Error(`aceitou "${t}"`);
    }
  });

  await etapa("token vencido é recusado", async () => {
    const { token } = await criarPedido(tenant.id);
    await db.query(VENCER, [hashDoToken(token)]);
    const r = await conferirToken(token);
    if (r.ok) throw new Error("aceitou token vencido!");
    igual(r.motivo, "expirado", "motivo");
  });

  await etapa("pedido novo invalida o anterior", async () => {
    const primeiro = (await criarPedido(tenant.id)).token;
    const segundo = (await criarPedido(tenant.id)).token;
    const a = await conferirToken(primeiro);
    const b = await conferirToken(segundo);
    if (a.ok) throw new Error("o link antigo continuou valendo");
    if (!b.ok) throw new Error("o link novo não vale");
    return "só o mais recente abre";
  });

  console.log("\ntroca de senha");

  await etapa("troca a senha e queima o token", async () => {
    const { token } = await criarPedido(tenant.id);
    if (!(await concluir(token, "senha-nova-de-teste-1"))) throw new Error("não concluiu");

    const { rows } = await db.query("select senha_hash from tenants where id = $1", [tenant.id]);
    if (!(await conferirSenha("senha-nova-de-teste-1", rows[0].senha_hash))) {
      throw new Error("a senha nova não confere");
    }
    const r = await conferirToken(token);
    if (r.ok) throw new Error("o token continuou válido depois de usado!");
    igual(r.motivo, "usado", "motivo");
  });

  /*
   * Reuso é o ataque óbvio: quem tiver o link (e-mail encaminhado, histórico do
   * navegador, alguém olhando por cima do ombro) tenta de novo mais tarde.
   */
  await etapa("o mesmo token não troca a senha duas vezes", async () => {
    const { token } = await criarPedido(tenant.id);
    igual(await concluir(token, "primeira-troca-123"), true, "primeira");
    igual(await concluir(token, "segunda-troca-456"), false, "segunda");

    const { rows } = await db.query("select senha_hash from tenants where id = $1", [tenant.id]);
    if (await conferirSenha("segunda-troca-456", rows[0].senha_hash)) {
      throw new Error("a segunda troca passou — o token foi reutilizado");
    }
    return "a segunda tentativa não muda nada";
  });

  await etapa("token vencido não troca senha", async () => {
    const { token } = await criarPedido(tenant.id);
    await db.query(VENCER, [hashDoToken(token)]);
    igual(await concluir(token, "nao-deveria-valer-99"), false, "concluir com vencido");
  });

  console.log("\nsessões antigas");

  /*
   * O motivo de `senha_alterada_em` existir: sem ele, trocar a senha por
   * desconfiança deixaria o invasor logado por até 30 dias — o cookie é
   * assinado e não tem registro no servidor para revogar.
   *
   * A conferência é feita contra uma ROTA DE VERDADE, de propósito. Aqui havia
   * uma etapa que remontava o cookie na mão e checava só a conta de datas; ela
   * saiu quando o cookie passou a carregar a emissão. Como montava o formato
   * antigo por conta própria, teria continuado verde para sempre — provando
   * aritmética sobre um formato que o app não usa mais, enquanto um erro em
   * `sessaoAtual` passaria despercebido.
   */
  let servidor = false;
  try {
    servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    servidor = false;
  }

  if (!servidor) {
    console.log("  – conferência contra o servidor pulada (fora do ar)");
  } else {
    const pedirLogo = (cookie) =>
      fetch(`${BASE}/api/marca/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ mime: "image/png", bytes: 1000 }),
      });

    await etapa("o app REJEITA cookie anterior à troca de senha", async () => {
      const antigo = cookieDeSessao(tenant.id, { emitidoEm: Date.now() - 10 * 60 * 1000 });

      const { token } = await criarPedido(tenant.id);
      await concluir(token, "troca-contra-o-servidor-55");

      igual((await pedirLogo(antigo)).status, 401, "status com cookie velho");

      const r2 = await pedirLogo(cookieDeSessao(tenant.id));
      if (r2.status === 401) throw new Error("o cookie NOVO também foi rejeitado");
      return `velho 401 · novo ${r2.status}`;
    });

    await etapa("cookie com assinatura adulterada é rejeitado", async () => {
      const bom = cookieDeSessao(tenant.id);
      igual((await pedirLogo(bom.slice(0, -4) + "0000")).status, 401, "assinatura trocada");
    });

    await etapa("cookie de conta que não existe não vale", async () => {
      const inventado = cookieDeSessao("00000000-0000-0000-0000-000000000000");
      igual((await pedirLogo(inventado)).status, 401, "conta inexistente");
    });
  }

  console.log("\ntrocar a senha pelo painel");

  await etapa("exige a senha atual correta", async () => {
    await db.query("update tenants set senha_hash = $1 where id = $2", [senhaOriginal, tenant.id]);
    const r = await trocarSenha(tenant.id, "senha-que-nao-e-a-atual", "nova-valida-123", "nova-valida-123");
    igual(r.ok, false, "resultado");
    igual(r.motivo, "atual-errada", "motivo");

    const { rows } = await db.query("select senha_hash from tenants where id = $1", [tenant.id]);
    igual(rows[0].senha_hash, senhaOriginal, "a senha NÃO pode ter mudado");
  });

  await etapa("recusa senha curta, repetida diferente e igual à atual", async () => {
    const atual = "senha-atual-boa-123";
    await db.query("update tenants set senha_hash = $1 where id = $2", [
      await gerarHashSenha(atual),
      tenant.id,
    ]);
    igual((await trocarSenha(tenant.id, atual, "curta", "curta")).motivo, "curta", "curta");
    igual((await trocarSenha(tenant.id, atual, "uma-senha-boa", "outra-senha")).motivo, "diferentes", "diferentes");
    igual((await trocarSenha(tenant.id, atual, atual, atual)).motivo, "igual-a-atual", "igual");
  });

  await etapa("troca a senha e move senha_alterada_em", async () => {
    const atual = "senha-atual-boa-123";
    const antesDaTroca = new Date(
      (await db.query("select senha_alterada_em from tenants where id = $1", [tenant.id])).rows[0]
        .senha_alterada_em,
    ).getTime();

    const r = await trocarSenha(tenant.id, atual, "senha-nova-do-painel-9", "senha-nova-do-painel-9");
    igual(r.ok, true, "resultado");

    const { rows } = await db.query("select senha_hash, senha_alterada_em from tenants where id = $1", [
      tenant.id,
    ]);
    if (!(await conferirSenha("senha-nova-do-painel-9", rows[0].senha_hash))) {
      throw new Error("a senha nova não confere");
    }
    if (new Date(rows[0].senha_alterada_em).getTime() <= antesDaTroca) {
      throw new Error("senha_alterada_em não avançou — as outras sessões não cairiam");
    }
  });

  /*
   * O cenário que motiva isto: a pessoa desconfia de invasão, pede o link por
   * e-mail, se lembra da senha e troca pelo painel. Sem esta regra o link
   * continuaria valendo por uma hora — na caixa de entrada de quem ela estava
   * tentando expulsar.
   */
  await etapa("trocar a senha mata pedido de recuperação em aberto", async () => {
    const atual = "senha-nova-do-painel-9";
    const { token } = await criarPedido(tenant.id);
    igual((await conferirToken(token)).ok, true, "o pedido nasce válido");

    await trocarSenha(tenant.id, atual, "outra-senha-ainda-77", "outra-senha-ainda-77");

    const depois = await conferirToken(token);
    igual(depois.ok, false, "o link deveria ter morrido");
    igual(depois.motivo, "usado", "motivo");
  });

  console.log("\nconfiguração do e-mail");

  /*
   * Em 24/08/2026 a linha `RESEND_API_KEY=cole_aqui` foi parar no
   * .env.production: o texto de exemplo de uma instrução foi colado literalmente.
   *
   * Uma chave de mentira é pior que chave nenhuma. O recurso foi desenhado para
   * ficar escondido enquanto não puder funcionar; com um valor qualquer no lugar
   * da chave, ele se acharia pronto — o link apareceria, a pessoa pediria a
   * recuperação, a tela diria "o link já saiu" e nada chegaria nunca.
   */
  await etapa("chave que não é do Resend conta como NÃO configurado", async () => {
    const { emailConfigurado, motivoEmailIndisponivel } = await import("../src/lib/email.ts");
    const antes = process.env.RESEND_API_KEY;
    const antesRem = process.env.EMAIL_REMETENTE;
    try {
      process.env.EMAIL_REMETENTE = "nao-responda@olumier.com.br";
      for (const falsa of ["cole_aqui", "sua_chave_aqui", "xxx", "RESEND_API_KEY"]) {
        process.env.RESEND_API_KEY = falsa;
        if (emailConfigurado()) throw new Error(`aceitou "${falsa}" como chave`);
        if (!motivoEmailIndisponivel()?.includes("re_")) {
          throw new Error(`o motivo não explica o formato para "${falsa}"`);
        }
      }
      process.env.RESEND_API_KEY = "re_parece_de_verdade_123";
      if (!emailConfigurado()) throw new Error("recusou uma chave com o prefixo certo");
      return "só chave com re_ liga o recurso";
    } finally {
      if (antes === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = antes;
      if (antesRem === undefined) delete process.env.EMAIL_REMETENTE;
      else process.env.EMAIL_REMETENTE = antesRem;
    }
  });

  console.log("\nvalidade");

  await etapa("o pedido vence em 1 hora", async () => {
    const { expiraEm } = await criarPedido(tenant.id);
    const minutos = Math.round((expiraEm.getTime() - Date.now()) / 60000);
    igual(minutos, Math.round(VALIDADE_MS / 60000), "minutos de validade");
    return `${minutos} minutos`;
  });
} finally {
  // Devolve a conta ao estado anterior: os testes trocaram a senha de verdade.
  await db.query("update tenants set senha_hash = $1 where id = $2", [senhaOriginal, tenant.id]);
  await db.query("delete from recuperacoes where tenant_id = $1", [tenant.id]);
  // A bancada desta execucao sai inteira, na ordem certa (ver fixture-de-teste.mjs).
  await limparRodada(db);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a recuperação de senha tem problema");
  process.exit(1);
}
console.log("\n✓ recuperação de senha íntegra\n");
