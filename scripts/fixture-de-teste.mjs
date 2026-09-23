/**
 * A bancada de cada execução da suíte.
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA MATAR ──────────────────────────────────
 * Até 26/08/2026, vinte testes escolhiam a fixture assim:
 *
 *     select ... from galerias g ... order by g.criado_em limit 1
 *
 * "a galeria mais antiga do banco" — a MESMA linha para todo mundo. Enquanto
 * rodava uma suíte por vez, funcionava. Com cinco sessões no mesmo banco de
 * desenvolvimento, duas execuções mexiam nas mesmas linhas e o `limpar()` de
 * uma apagava o estado que a outra acabara de criar. As duas reprovavam, em
 * arquivos diferentes a cada rodada, e ninguém publicava.
 *
 * Naquela tarde isso derrubou dois portões de deploy e custou quatro rodadas de
 * coordenação entre sessões. Uma delas levou `44 passaram · 3 falharam`; os três
 * rodados isolados depois passaram. Não havia defeito no produto.
 *
 * ── POR QUE FILA NÃO RESOLVIA ─────────────────────────────────────────────
 * A saída óbvia era combinar "uma sessão roda por vez". Ela falha por duas
 * razões medidas no mesmo dia:
 *
 *   1. O invasor típico não é portão de deploy — é `npm test` de quem está
 *      desenvolvendo e não sabe que existe fila.
 *   2. Não dá para saber, olhando a árvore de processos, se uma execução tem
 *      dono vivo. No Git-Bash do Windows o ancestral aparece morto tanto na
 *      rodada abandonada quanto na legítima. Tentamos atribuir dono a um
 *      processo por uma hora e a conclusão foi que a pergunta não tem resposta
 *      de fora.
 *
 * Com bancada própria por execução, a pergunta deixa de importar: duas suítes
 * simultâneas não se enxergam.
 *
 * ── A REGRA ───────────────────────────────────────────────────────────────
 * Nenhum teste escolhe linha que não criou. Quem precisa de estúdio ou galeria
 * pede aqui. `scripts/testar-isolamento.mjs` varre os testes e reprova quem
 * voltar ao padrão antigo — o defeito não volta por esquecimento.
 *
 * É o mesmo argumento do `sessao-de-teste.mjs`: formato compartilhado mora num
 * módulo, não em vinte cópias. Aqui vale ainda mais para a LIMPEZA, que tem uma
 * ordem que não é óbvia (ver `limparRodada`).
 */
import { randomUUID } from "node:crypto";
import { apagarObjeto } from "../src/lib/r2.ts";
import { apagarArquivo } from "../src/lib/b2.ts";

/**
 * A marca desta execução.
 *
 * PID sozinho não serve: o sistema recicla PID e o banco de desenvolvimento
 * sobrevive entre rodadas, então duas execuções distantes no tempo poderiam
 * receber a mesma marca e brigar pelo `unique` do slug. O sufixo aleatório
 * fecha isso.
 *
 * Fica curto de propósito — entra em slug, que aparece em URL de teste.
 */
const MARCA = `t${process.pid}${randomUUID().slice(0, 6)}`;

/** Devolve a marca, para quem precisar compor nome próprio. */
export function marcaDaRodada() {
  return MARCA;
}

/* Memória do processo: pedir duas vezes devolve a mesma bancada. Sem isto,
 * um teste que chama `estudioDaRodada()` em duas etapas criaria dois estúdios
 * e compararia um com o outro. */
let estudio = null;
const galerias = new Map();

/**
 * O estúdio desta execução. Cria na primeira chamada, devolve o mesmo depois.
 *
 * @param db        cliente pg já conectado
 * @param opcoes.quotaBytes  espaço contratado (padrão: 1 TB, folgado)
 * @param opcoes.nome        nome de exibição (padrão: "Estúdio da Rodada")
 */
export async function estudioDaRodada(db, opcoes = {}) {
  if (estudio) return estudio;

  /* `returning *` de propósito: os testes pedem colunas variadas do estúdio
   * (logo_chave, site, senha_hash, status, trial_ate). Listar campo a campo
   * obrigaria a mexer aqui a cada teste novo, e o esquecimento apareceria como
   * `undefined` no teste — erro que custa a achar. */
  const { rows } = await db.query(
    /* status 'ativo' EXPLICITO: o default do banco e 'trial', e desde
     * 27/08/2026 o trial tem teto de quota (config/trial.ts). A bancada
     * representa o estudio PAGANTE — o caso comum dos testes — senao toda
     * declaracao acima do teto reprovaria testes que nao falam de trial.
     * Teste que quer o trial poe o status na mao (testar-teto-trial.mjs). */
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
     values ($1, $2, $3, 'x', $4, 'ativo')
     returning *`,
    [
      `estudio-${MARCA}`,
      opcoes.nome ?? "Estúdio da Rodada",
      `${MARCA}@teste.local`,
      String(opcoes.quotaBytes ?? 1024 ** 4),
    ],
  );
  estudio = rows[0];
  return estudio;
}

/* O vizinho, para os testes de isolamento. Ver `segundoEstudioDaRodada`. */
let vizinho = null;

/**
 * O SEGUNDO estúdio desta execução — o vizinho de quem nada deve vazar.
 *
 * Três suítes (`testar-api-galerias`, `testar-chave-api`,
 * `testar-dominio-proprio`) pediam dois estúdios EMPRESTADOS do banco:
 *
 *     select id from tenants order by criado_em limit 2
 *
 * Os dois mais antigos que por acaso existissem. Numa máquina com histórico
 * funciona; num banco recém-criado — o do CI, o de quem acabou de clonar — não
 * existem dois, e as três desistiam antes da primeira etapa com "preciso de
 * dois estúdios no banco de teste". Só passavam porque a máquina de quem
 * rodava tinha sobra de rodadas anteriores.
 *
 * Pior no `testar-dominio-proprio`, que ESCREVE nos estúdios que encontra:
 * num banco de desenvolvimento com conta de gente, era o teste apagando o
 * domínio próprio de quem não pediu nada.
 *
 * Agora o vizinho é criado aqui, e `limparRodada` leva os dois embora.
 */
export async function segundoEstudioDaRodada(db) {
  if (vizinho) return vizinho;

  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status)
     values ($1, $2, $3, 'x', $4, 'ativo')
     returning *`,
    [`vizinho-${MARCA}`, "Estúdio Vizinho", `vizinho-${MARCA}@teste.local`, String(1024 ** 4)],
  );
  vizinho = rows[0];
  return vizinho;
}

/**
 * Uma galeria desta execução, com mídia pronta dentro.
 *
 * As mídias nascem com `pronto = true` e chave FALSA — nenhum objeto sobe ao
 * armazém. Quem precisa de arquivo de verdade no bucket (upload, derivadas,
 * multipart) sobe por cima e limpa o que subiu; `limparRodada` cobre o caso
 * apagando o objeto antes da linha.
 *
 * @param db
 * @param opcoes.nome       chave de memória — pedir o mesmo nome devolve a mesma
 *                          galeria. Use nomes diferentes para galerias diferentes.
 * @param opcoes.medias     quantas mídias criar (padrão: 3)
 * @param opcoes.publicada  padrão: true, que é o que a maioria dos testes quer
 * @param opcoes.bytes      tamanho de cada mídia (padrão: 1 MB)
 * @param opcoes.dono       de quem é a galeria (padrão: o estúdio da rodada).
 *                          Passe `segundoEstudioDaRodada(db)` para dar conteúdo
 *                          ao vizinho: sem galeria do lado de lá, toda prova de
 *                          isolamento passa sem comparar nada — e "passou" aí
 *                          quer dizer "não olhou", que é pior que vermelho.
 */
export async function galeriaDaRodada(db, opcoes = {}) {
  const nome = opcoes.nome ?? "principal";
  if (galerias.has(nome)) return galerias.get(nome);

  const t = opcoes.dono ?? (await estudioDaRodada(db));
  const sufixo = `${MARCA}-${nome}`;

  const { rows } = await db.query(
    `insert into galerias (tenant_id, slug, titulo, publicada, estado)
     values ($1, $2, $3, $4, 'online')
     returning id, slug, titulo, tenant_id`,
    [t.id, `galeria-${sufixo}`, opcoes.titulo ?? `Galeria ${nome}`, opcoes.publicada ?? true],
  );
  const g = rows[0];

  const quantas = opcoes.medias ?? 3;
  const bytes = String(opcoes.bytes ?? 1024 * 1024);
  const midias = [];
  for (let i = 0; i < quantas; i++) {
    const chave = `${t.id}/${g.id}/${MARCA}-${i}.jpg`;
    const { rows: m } = await db.query(
      `insert into medias
         (galeria_id, tenant_id, chave, chave_thumb, chave_preview,
          nome_original, tipo, mime, bytes, largura, altura, ordem, pronto)
       values ($1,$2,$3,$4,$5,$6,'foto','image/jpeg',$7,1600,1067,$8,true)
       returning id, chave, nome_original`,
      [
        g.id, t.id, chave,
        chave.replace(/\.jpg$/, "_thumb.webp"),
        chave.replace(/\.jpg$/, "_prev.webp"),
        `${nome}-${i}.jpg`, bytes, i,
      ],
    );
    midias.push(m[0]);
  }

  const bancada = { ...g, estudio: t, midias, tslug: t.slug, gslug: g.slug };
  galerias.set(nome, bancada);
  return bancada;
}

/**
 * Apaga tudo o que esta execução criou.
 *
 * ── A ORDEM IMPORTA, E NÃO É ÓBVIA ────────────────────────────────────────
 * O objeto no armazém sai PRIMEIRO, a linha do banco DEPOIS. Ao contrário, a
 * cascata de `galerias` leva a linha da mídia junto e o objeto fica no bucket
 * sem ninguém que saiba relacioná-lo a nada — órfão pago, que o
 * `testar-limpeza` sai caçando depois. Foi descoberto do jeito caro em
 * 26/08/2026.
 *
 * Falha ao apagar objeto é ENGOLIDA de propósito: a maioria das chaves desta
 * bancada é falsa e nunca existiu no armazém. Limpeza que reprova por não achar
 * o que nunca esteve lá transformaria todo teste num vermelho inútil.
 */
export async function limparRodada(db) {
  if (!estudio) return { estudios: 0, galerias: 0, objetos: 0 };

  const { rows: midias } = await db.query(
    `select m.chave, m.chave_thumb, m.chave_preview, m.armazem
       from medias m where m.tenant_id = $1`,
    [estudio.id],
  );

  let objetos = 0;
  for (const m of midias) {
    for (const chave of [m.chave, m.chave_thumb, m.chave_preview]) {
      if (!chave) continue;
      try {
        /* Derivada vive sempre no R2; o original segue a coluna `armazem`.
         * Ver o comentário de src/lib/armazem.ts — a chave e o armazém têm de
         * ser escolhidos na mesma expressão. */
        const noB2 = m.armazem === "b2" && chave === m.chave;
        await (noB2 ? apagarArquivo(chave) : apagarObjeto(chave));
        objetos++;
      } catch {
        /* chave falsa da bancada, ou objeto já removido pelo próprio teste */
      }
    }
  }

  const quantas = galerias.size;
  /* Uma linha só: a cascata de `tenants` leva galerias, mídias, seções,
   * favoritas, acessos, chaves de API e recuperações. Conferido no schema. */
  await db.query("delete from tenants where id = $1", [estudio.id]);

  /* O vizinho vai junto: quem o cria não é quem o limpa, e deixá-lo para trás
     encheria o banco de "Estúdio Vizinho" a cada execução. */
  if (vizinho) await db.query("delete from tenants where id = $1", [vizinho.id]);

  const quantosEstudios = vizinho ? 2 : 1;
  estudio = null;
  vizinho = null;
  galerias.clear();
  return { estudios: quantosEstudios, galerias: quantas, objetos };
}

/**
 * Varre bancadas que ficaram para trás.
 *
 * Execução morta no meio não roda `limparRodada`, e o estúdio dela fica no
 * banco para sempre. Isto some com os antigos — e só com os antigos: uma
 * bancada recente pode ser de outra suíte rodando AGORA, e apagá-la seria
 * reintroduzir exatamente o defeito que este módulo existe para matar.
 *
 * @param horas  idade mínima para considerar abandonada (padrão: 2)
 */
export async function varrerBancadasAntigas(db, horas = 2) {
  const { rows } = await db.query(
    `delete from tenants
      where slug like 'estudio-t%'
        and email like '%@teste.local'
        and criado_em < now() - ($1 || ' hours')::interval
      returning slug`,
    [String(horas)],
  );
  return rows.map((r) => r.slug);
}
