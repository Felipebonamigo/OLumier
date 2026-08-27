#!/usr/bin/env node
/**
 * Cookie de sessão que existe e não vale. Uso:
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-sessao-podre.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O LOOP ────────────────────────────────────────────────────────────────
 *
 * Duas checagens de sessão que discordam:
 *
 *   proxy   (borda, sem banco)  — OTIMISTA: o cookie existe? então está logado.
 *   layout  (Node, com banco)   — RIGOROSO: a assinatura vale e o estúdio existe?
 *
 * Enquanto as duas concordam, o desenho é bom: a borda é barata e rápida, e a
 * conferência cara acontece uma vez só. Quando discordam — cookie presente e
 * inválido — vira armadilha fechada:
 *
 *   /painel → layout recusa → /entrar → proxy vê o cookie → /painel → …
 *
 * ERR_TOO_MANY_REDIRECTS, e a pessoa não consegue nem chegar na tela de entrar
 * para consertar. Aconteceu com o Felipe em 27/08/2026, em produção, com a
 * conta dele. A saída era limpar cookie no navegador — o que ninguém adivinha.
 *
 * O conserto não é fazer o proxy conferir assinatura: ele continuaria discordando
 * do banco quando o estúdio deixasse de existir. É JOGAR FORA o cookie podre. Um
 * cookie que o layout recusou não tem serventia nenhuma, e enquanto ele existir
 * o proxy vai continuar acreditando nele.
 *
 * Layout é componente de servidor e não pode mexer em cookie — por isso a saída
 * passa por uma rota, que pode.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const PODRE = "olumier_sessao=existe-mas-nao-vale";

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

/**
 * Segue os redirecionamentos na mão, para poder VER a corrente — e guardando
 * cookie como um navegador guarda.
 *
 * O pote de cookies não é detalhe: sem ele, o cliente reenvia o cookie podre a
 * cada passo e o teste acusa loop mesmo depois de o servidor ter mandado apagá-lo.
 * Foi o que aconteceu na primeira versão deste arquivo: o conserto já estava
 * certo e o teste continuava vermelho, culpando o código pelo defeito do teste.
 */
async function seguir(caminho, cookieInicial, limite = 12) {
  const passos = [];
  const pote = new Map();
  for (const parte of cookieInicial.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome) pote.set(nome, resto.join("="));
  }

  let url = new URL(caminho, BASE).toString();
  let ultima = null;

  for (let i = 0; i < limite; i++) {
    const cookie = [...pote].map(([n, v]) => `${n}=${v}`).join("; ");
    const r = await fetch(url, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    ultima = r;
    passos.push(`${new URL(url).pathname} → ${r.status}`);

    /* Expirado ou vazio SAI do pote — é assim que o navegador entende
     * "apague este cookie", e é a única coisa que quebra a armadilha. */
    for (const posto of r.headers.getSetCookie?.() ?? []) {
      const [par, ...atributos] = posto.split(";");
      const [nome, ...resto] = par.trim().split("=");
      const valor = resto.join("=");
      const morto =
        valor === "" || valor === '""' || atributos.some((a) => /max-age=0/i.test(a.trim()));
      if (morto) pote.delete(nome);
      else pote.set(nome, valor);
    }

    const destino = r.headers.get("location");
    if (!destino) return { passos, resposta: r, url, pote };
    url = new URL(destino, BASE).toString();
  }
  return { passos, resposta: ultima, url, pote, estourou: true };
}

console.log("Cookie de sessão podre:\n");

await etapa("/painel com cookie inválido NÃO entra em loop", async () => {
  const { passos, estourou } = await seguir("/painel", PODRE);
  if (estourou) {
    throw new Error(`loop: ${passos.slice(0, 6).join(" ")} … — é o ERR_TOO_MANY_REDIRECTS`);
  }
  return `${passos.length} passo(s)`;
});

await etapa("e termina na tela de entrar, servida de verdade", async () => {
  const { resposta, url } = await seguir("/painel", PODRE);
  if (resposta.status !== 200) throw new Error(`parou em HTTP ${resposta.status}`);
  if (!new URL(url).pathname.startsWith("/entrar")) {
    throw new Error(`parou em ${new URL(url).pathname}, esperava /entrar`);
  }
});

await etapa("o cookie podre é JOGADO FORA no caminho", async () => {
  /* Sem isto o loop volta no próximo clique: o layout recusa de novo, e o proxy
   * continua vendo o mesmo cookie. Limpar é o que fecha a armadilha para valer. */
  const { pote } = await seguir("/painel", PODRE);
  if (pote.has("olumier_sessao")) {
    throw new Error("o cookie sobreviveu — a armadilha reabre no próximo clique");
  }
  return "o navegador sai sem ele";
});

await etapa("/entrar com cookie inválido abre normalmente", async () => {
  /* O caminho direto: a pessoa desiste do painel e vai para a tela de entrar.
   * Se o proxy a chutar para o painel, ela não tem como sair do buraco. */
  const { resposta, url, estourou } = await seguir("/entrar", PODRE);
  if (estourou) throw new Error("loop a partir de /entrar");
  if (resposta.status !== 200 || !new URL(url).pathname.startsWith("/entrar")) {
    throw new Error(`parou em ${new URL(url).pathname} com ${resposta.status}`);
  }
});

await etapa("sem cookie nenhum, /painel manda para entrar guardando o destino", async () => {
  /* Regressão: o conserto não pode custar o `?proximo=`, que é o que devolve a
   * pessoa à página que ela queria depois de entrar. */
  const r = await fetch(new URL("/painel/conta", BASE), { redirect: "manual" });
  const destino = r.headers.get("location") ?? "";
  if (!destino.includes("proximo")) {
    throw new Error(`redirecionou sem guardar o destino: ${destino}`);
  }
});

console.log(falhou ? "\n✗ a sessão podre tem problema" : "\n✓ sessão podre ok");
process.exitCode = falhou ? 1 : 0;
