import "server-only";
import { consultar, consultarUm, emTransacao } from "./db";

/**
 * O endereço do estúdio, e o apelido que sobrevive à troca.
 *
 * `tenants.slug` vai para fora em três lugares — o link da galeria
 * (`/g/<estudio>/<galeria>`), a vitrine (`/e/<estudio>`) e o subdomínio próprio.
 * Trocá-lo derrubava TODO link já entregue a um casal, e link de casamento não
 * se reenvia: ele está num grupo de WhatsApp que ninguém vai reabrir. Por isso o
 * campo era travado — o que resolvia o risco e não resolvia a necessidade de
 * quem digitou errado no cadastro.
 *
 * Aqui o endereço anterior vira apelido e continua resolvendo, com
 * redirecionamento permanente para o atual.
 *
 * A regra mora neste módulo, e não dentro da action, pelo mesmo motivo de
 * `lib/senha.ts`: action não se chama de fora, e regra que não dá para exercitar
 * num teste acaba não sendo exercitada. Ver `scripts/testar-endereco-antigo.mjs`.
 */

/**
 * Quantas vezes um estúdio pode trocar de endereço.
 *
 * A tabela de apelidos cresce para sempre e é consultada em toda visita que erra
 * o endereço atual. Sem limite, uma conta sozinha a enche — e o custo cai em
 * cima de quem só quer abrir uma galeria.
 *
 * Três é palpite calibrado pelo uso real: trocar de endereço é coisa de arrumar
 * um erro de cadastro ou uma mudança de nome do estúdio, não rotina. Quem
 * precisar da quarta fala com a gente, e essa conversa é barata; o contrário —
 * descobrir que a tabela virou depósito — não é.
 */
export const LIMITE_TROCAS = 3;

export interface EstudioResolvido {
  tenantId: string;
  /** O endereço VÁLIDO hoje. Igual ao consultado quando `ehAntigo` é falso. */
  slugAtual: string;
  /** true = o visitante veio por um apelido e deve ser redirecionado. */
  ehAntigo: boolean;
}

/**
 * De quem é este endereço — atual ou antigo.
 *
 * Olha primeiro o endereço vigente e só então os apelidos: o caminho comum é o
 * do endereço certo, e ele não pode pagar a consulta extra de quem errou.
 *
 * `null` quando não é de ninguém. Quem chama decide o que fazer com isso — a
 * galeria devolve 404, o porteiro do certificado recusa a emissão.
 */
export async function resolverEstudio(slug: string): Promise<EstudioResolvido | null> {
  const atual = await consultarUm<{ id: string }>("select id from tenants where slug = $1", [slug]);
  if (atual) return { tenantId: atual.id, slugAtual: slug, ehAntigo: false };

  const antigo = await consultarUm<{ tenant_id: string; slug_atual: string }>(
    `select a.tenant_id, t.slug as slug_atual
       from enderecos_antigos a
       join tenants t on t.id = a.tenant_id
      where a.slug = $1`,
    [slug],
  );
  if (!antigo) return null;

  return { tenantId: antigo.tenant_id, slugAtual: antigo.slug_atual, ehAntigo: true };
}

/**
 * O endereço está livre PARA ESTE ESTÚDIO?
 *
 * Duas assimetrias de propósito:
 *
 * 1. apelido de OUTRO estúdio NÃO está livre. Sem isso, o link que A entregou ao
 *    casal dele passaria a abrir a galeria de B — vazamento entre contas, com
 *    aparência de funcionamento normal e nada na tela para denunciar. É a razão
 *    de esta função existir em vez de um simples "existe alguém com esse slug".
 *
 * 2. o PRÓPRIO apelido antigo está livre. Quem trocou por engano precisa
 *    conseguir voltar, e os links entregues já apontam para lá de qualquer jeito.
 */
export async function enderecoDisponivel(slug: string, tenantId: string): Promise<boolean> {
  const dono = await resolverEstudio(slug);
  return dono === null || dono.tenantId === tenantId;
}

/** Só minúscula, número e hífen — é isso que vira subdomínio e caminho de URL. */
export function normalizarEndereco(bruto: string): string {
  return bruto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/*
 * Endereços que a plataforma usa para si. Um estúdio chamado "painel" ou "api"
 * criaria um subdomínio que colide com o nosso — e o dono descobriria pela
 * galeria do cliente dele abrindo a tela errada.
 */
const RESERVADOS = new Set([
  "api", "app", "painel", "admin", "www", "mail", "email", "smtp", "ftp",
  "entrar", "cadastrar", "recuperar", "sair", "termos", "privacidade",
  "seguranca", "planos", "precos", "sobre", "contato", "ajuda", "blog",
  "static", "assets", "cdn", "g", "e", "_next",
]);

export type FalhaEndereco = "curto" | "invalido" | "reservado" | "ocupado" | "limite";

const RECADOS: Record<FalhaEndereco, string> = {
  curto: "O endereço precisa de pelo menos 3 caracteres.",
  invalido: "Use só letras, números e hífen.",
  reservado: "Esse endereço é reservado pela plataforma. Escolha outro.",
  ocupado: "Esse endereço já é de outro estúdio.",
  limite: `Você já trocou de endereço ${LIMITE_TROCAS} vezes. Fale com a gente se precisar de outra.`,
};

/**
 * Troca o endereço, guardando o anterior como apelido.
 *
 * Tudo numa transação: se o apelido não entrar, o endereço não muda. O contrário
 * — endereço novo gravado e apelido perdido — é o cenário em que os links
 * entregues quebram em silêncio, que é justamente o que este módulo existe para
 * impedir.
 *
 * Voltar ao endereço anterior APAGA o apelido correspondente. Sem isso o estúdio
 * ficaria com um apelido apontando para ele mesmo, e o redirecionamento viraria
 * laço: /a → /a.
 */
export async function trocarEndereco(
  tenantId: string,
  bruto: string,
): Promise<{ erro?: string; slug?: string }> {
  const slug = normalizarEndereco(bruto);
  if (slug.length < 3) return { erro: RECADOS.curto };
  if (!/^[a-z0-9-]+$/.test(slug)) return { erro: RECADOS.invalido };
  if (RESERVADOS.has(slug)) return { erro: RECADOS.reservado };

  const tenant = await consultarUm<{ slug: string }>("select slug from tenants where id = $1", [
    tenantId,
  ]);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (tenant.slug === slug) return { slug };

  if (!(await enderecoDisponivel(slug, tenantId))) return { erro: RECADOS.ocupado };

  /* O limite conta os apelidos QUE VÃO SOBRAR. Voltar a um endereço anterior
   * remove um apelido em vez de somar, e não pode gastar cota por isso. */
  const jaTem = await consultarUm<{ n: number }>(
    "select count(*)::int as n from enderecos_antigos where tenant_id = $1",
    [tenantId],
  );
  const retomando = await consultarUm<{ slug: string }>(
    "select slug from enderecos_antigos where slug = $1 and tenant_id = $2",
    [slug, tenantId],
  );
  if (!retomando && (jaTem?.n ?? 0) >= LIMITE_TROCAS) return { erro: RECADOS.limite };

  /* `emTransacao` e não três `consultar` seguidos: cada `consultar` pede uma
     conexão ao pool, então o `begin` podia abrir transação numa conexão que
     nunca receberia o `update`. Com o pool ocioso o mesmo cliente volta sempre
     e o erro não aparece — ele apareceria no dia de movimento. Ver `lib/db.ts`. */
  await emTransacao(async (q) => {
    await q(
      `insert into enderecos_antigos (slug, tenant_id) values ($1, $2)
       on conflict (slug) do nothing`,
      [tenant.slug, tenantId],
    );
    await q("delete from enderecos_antigos where slug = $1 and tenant_id = $2", [slug, tenantId]);
    await q("update tenants set slug = $1, atualizado_em = now() where id = $2", [slug, tenantId]);
  });

  return { slug };
}

/** Os apelidos deste estúdio, do mais novo para o mais antigo — para a tela. */
export async function enderecosAntigos(tenantId: string) {
  return consultar<{ slug: string; criado_em: Date }>(
    "select slug, criado_em from enderecos_antigos where tenant_id = $1 order by criado_em desc",
    [tenantId],
  );
}
