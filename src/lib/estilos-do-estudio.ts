import "server-only";
import { consultar, consultarUm, emTransacao } from "@/lib/db";
import { lerAparencia, type Aparencia } from "@/config/aparencia";

/**
 * OS ESTILOS DO ESTÚDIO — até cinco combinações salvas, cada uma com nome.
 *
 * Juan, 28/09/2026: "Ela pode salvar até 5 padrões próprios e dar nome pra
 * eles. Eu criei uns 3 que eu gostei, mas só pode salvar um." Ver a migração
 * 044 para como isto convive com o padrão do estúdio (`aparencia_padrao`),
 * que continua sendo o design com que toda galeria nova nasce.
 *
 * As regras moram aqui, e não em `actions.ts`, pelo mesmo motivo de
 * `aparencia-galeria.ts`: server action não se importa de um script de teste,
 * e `testar-estilos-do-estudio` precisa exercitar a ESCRITA contra o banco.
 */

export const MAXIMO_DE_ESTILOS = 5;
export const TAMANHO_DO_NOME = 40;

export interface EstiloDoEstudio {
  id: string;
  nome: string;
  aparencia: Aparencia;
}

type Resultado = { ok: true; estilos: EstiloDoEstudio[] } | { ok: false; erro: string };

/** O nome como vai para o banco: sem espaço sobrando, e nunca vazio nem longo. */
export function normalizarNomeDoEstilo(bruto: unknown): string | null {
  const nome = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (!nome || nome.length > TAMANHO_DO_NOME) return null;
  return nome;
}

const RECUSA_DO_NOME = `Dê um nome ao estilo, com até ${TAMANHO_DO_NOME} letras.`;

/* O índice único é o que garante o nome sem repetir; a tela só precisa
   traduzir o erro dele. */
const nomeRepetido = (e: unknown) =>
  (e as { code?: string }).code === "23505" &&
  String((e as { constraint?: string }).constraint ?? "").includes("nome");

/** Os estilos do estúdio, do mais antigo para o mais novo — a ordem em que foram salvos. */
export async function estilosDoEstudio(tenantId: string): Promise<EstiloDoEstudio[]> {
  const linhas = await consultar<{ id: string; nome: string; aparencia: unknown }>(
    `select id, nome, aparencia from estilos_do_estudio
      where tenant_id = $1
      order by criado_em, id`,
    [tenantId],
  );
  /* `lerAparencia` completa o eixo que nasceu depois de o estilo ser salvo,
     como faz com a galeria: um estilo de hoje continua abrindo daqui a um ano. */
  return linhas.map((l) => ({ id: l.id, nome: l.nome, aparencia: lerAparencia(l.aparencia) }));
}

/**
 * Salva a combinação como um estilo novo.
 *
 * O limite é conferido com a linha do estúdio TRAVADA: contar e depois inserir
 * em duas consultas soltas deixaria dois cliques simultâneos verem quatro
 * estilos cada um e salvarem o sexto e o sétimo.
 */
export async function salvarEstilo(tenantId: string, nomeBruto: unknown, aparenciaBruta: unknown): Promise<Resultado> {
  const nome = normalizarNomeDoEstilo(nomeBruto);
  if (!nome) return { ok: false, erro: RECUSA_DO_NOME };
  /* Validada ANTES de gravar: a origem é a tela, e o que se grava vai ser
     aplicado em galerias depois — um campo torto aqui se espalharia. */
  const aparencia = lerAparencia(aparenciaBruta);

  try {
    const gravou = await emTransacao(async (q) => {
      const estudio = await q("select id from tenants where id = $1 for update", [tenantId]);
      if (estudio.length === 0) return false;
      const [{ n }] = await q<{ n: number }>(
        "select count(*)::int as n from estilos_do_estudio where tenant_id = $1",
        [tenantId],
      );
      if (n >= MAXIMO_DE_ESTILOS) return false;
      await q("insert into estilos_do_estudio (tenant_id, nome, aparencia) values ($1, $2, $3)", [
        tenantId,
        nome,
        JSON.stringify(aparencia),
      ]);
      return true;
    });
    if (!gravou) {
      return {
        ok: false,
        erro: `Você já tem ${MAXIMO_DE_ESTILOS} estilos salvos. Apague um para guardar este.`,
      };
    }
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: `Já existe um estilo chamado “${nome}”.` };
    throw e;
  }
  return { ok: true, estilos: await estilosDoEstudio(tenantId) };
}

/** Troca o nome. Só o dono do estilo consegue: o `tenant_id` vai no `where`. */
export async function renomearEstilo(tenantId: string, id: string, nomeBruto: unknown): Promise<Resultado> {
  const nome = normalizarNomeDoEstilo(nomeBruto);
  if (!nome) return { ok: false, erro: RECUSA_DO_NOME };
  try {
    const linhas = await consultar(
      `update estilos_do_estudio set nome = $3, atualizado_em = now()
        where id = $1 and tenant_id = $2
        returning id`,
      [id, tenantId, nome],
    );
    if (linhas.length === 0) return { ok: false, erro: "Esse estilo não existe mais." };
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: `Já existe um estilo chamado “${nome}”.` };
    /* id que não é uuid: é o mesmo "não existe" para quem pediu. */
    if ((e as { code?: string }).code === "22P02") return { ok: false, erro: "Esse estilo não existe mais." };
    throw e;
  }
  return { ok: true, estilos: await estilosDoEstudio(tenantId) };
}

/**
 * Apaga o estilo. Nenhuma galeria muda: quem usou o estilo guardou uma CÓPIA
 * da combinação na própria galeria, e o padrão do estúdio também é cópia.
 */
export async function apagarEstilo(tenantId: string, id: string): Promise<Resultado> {
  try {
    await consultar("delete from estilos_do_estudio where id = $1 and tenant_id = $2", [id, tenantId]);
  } catch (e) {
    if ((e as { code?: string }).code !== "22P02") throw e;
  }
  return { ok: true, estilos: await estilosDoEstudio(tenantId) };
}

/** A combinação de um estilo deste estúdio, ou null se não for dele (ou não existir). */
export async function aparenciaDoEstilo(tenantId: string, id: string): Promise<Aparencia | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const linha = await consultarUm<{ aparencia: unknown }>(
    "select aparencia from estilos_do_estudio where id = $1 and tenant_id = $2",
    [id, tenantId],
  );
  return linha ? lerAparencia(linha.aparencia) : null;
}

/**
 * Faz de um estilo salvo o padrão do estúdio — o design com que toda galeria
 * nova nasce. Grava uma CÓPIA em `aparencia_padrao`: apagar o estilo depois
 * não desfaz o padrão, do mesmo jeito que não desfaz as galerias que o usam.
 */
export async function tornarEstiloPadrao(tenantId: string, id: string): Promise<Aparencia | null> {
  const aparencia = await aparenciaDoEstilo(tenantId, id);
  if (!aparencia) return null;
  await consultar("update tenants set aparencia_padrao = $1 where id = $2", [JSON.stringify(aparencia), tenantId]);
  return aparencia;
}
