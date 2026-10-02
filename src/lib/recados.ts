import "server-only";
import { consultar, consultarUm } from "./db";
import { configDoRecado } from "@/config/recado";

/**
 * O RECADO DO CLIENTE — o que fala com o banco (migração 058).
 *
 * As medidas, as réguas e o convite padrão moram em `config/recado.ts`, porque o
 * editor do painel é componente de cliente e precisa deles. Daqui saem apenas a
 * leitura e a escrita. O `export *` existe para quem já importava tudo de
 * `lib/recados` continuar funcionando — inclusive os testes.
 */
export * from "@/config/recado";

/** A configuração desta galeria, direto do banco — para a rota que grava. */
export async function configDaGaleria(galeriaId: string) {
  const linha = await consultarUm<{
    recado_ativo: boolean;
    recado_estrelas: boolean;
    recado_convite: string | null;
    recado_perguntas: unknown;
  }>(
    "select recado_ativo, recado_estrelas, recado_convite, recado_perguntas from galerias where id = $1",
    [galeriaId],
  );
  return linha ? configDoRecado(linha) : null;
}

export interface RecadoGravado {
  texto: string | null;
  notas: Record<string, number>;
  autoriza: boolean;
}

/** Quantas vezes a MESMA identidade pode escrever na mesma galeria. */
export const MAX_RECADOS_POR_PESSOA = 3;

/**
 * Grava o recado desta pessoa nesta galeria — SEMPRE como linha nova.
 *
 * ── POR QUE NÃO É `on conflict do update` (migração 060) ─────────────────
 *
 * Era, e foi um defeito achado antes de publicar. A identidade de quem escreve é
 * um e-mail não verificado (decisão de 15/09/2026, em `lib/favoritas.ts`): quem
 * digitasse `ana@gmail.com` recebia a linha da Ana e o `do update` APAGAVA o
 * texto dela — e marcava, no nome dela, a autorização para usar como depoimento.
 * A versão sem atacante é a mesma: o casal com um e-mail só perdia o recado de
 * quem escreveu primeiro, e quem voltasse para dar só as estrelas apagava o
 * próprio texto.
 *
 * Linha nova por envio: nada é perdido, a autorização pertence à linha em que foi
 * dada, e dois textos diferentes assinados pela mesma pessoa aparecem no painel —
 * que é exatamente o que o fotógrafo precisa ver antes de publicar um depoimento.
 *
 * Devolve false quando a pessoa já estourou o teto, para a tela poder dizer isso
 * em português em vez de deixar o banco recusar.
 */
export async function gravarRecado(
  galeriaId: string,
  pessoaId: string,
  dados: RecadoGravado,
): Promise<boolean> {
  const quantos = await consultarUm<{ n: number }>(
    "select count(*)::int as n from recados where galeria_id = $1 and pessoa_id = $2",
    [galeriaId, pessoaId],
  );
  if ((quantos?.n ?? 0) >= MAX_RECADOS_POR_PESSOA) return false;

  await consultarUm(
    `insert into recados (galeria_id, pessoa_id, texto, notas, autoriza_depoimento)
          values ($1, $2, $3, $4::jsonb, $5)`,
    [galeriaId, pessoaId, dados.texto, JSON.stringify(dados.notas), dados.autoriza],
  );
  return true;
}

export interface RecadoNoPainel {
  id: string;
  texto: string | null;
  notas: Record<string, number>;
  autoriza: boolean;
  quando: Date;
  /**
   * Qual envio desta pessoa é este, e quantos ela mandou — "2 de 3".
   *
   * Existe porque a identidade não é verificada (migração 060): dois textos
   * diferentes assinados pelo mesmo e-mail é o sinal de que alguém digitou o
   * endereço de outra pessoa, e o fotógrafo tem de ver isso ANTES de publicar um
   * depoimento. Antes havia um `corrigido`, e ele dizia o contrário do que
   * acontecia — que o texto anterior tinha sido substituído.
   */
  ordem: number;
  total: number;
  nome: string | null;
  email: string | null;
}

/**
 * Os recados desta galeria, os novos primeiro — a leitura do painel.
 *
 * Quem autoriza é quem chama: esta função recebe um id de galeria já conferido
 * por `galeriaDoPainel` (que amarra `tenant_id`), do mesmo jeito que as outras
 * leituras do painel. Não existe caminho público para cá.
 */
export async function recadosDaGaleria(galeriaId: string): Promise<RecadoNoPainel[]> {
  const linhas = await consultar<{
    id: string;
    texto: string | null;
    notas: Record<string, number>;
    autoriza_depoimento: boolean;
    criado_em: Date;
    nome: string | null;
    email: string | null;
    ordem: number;
    total: number;
  }>(
    `select r.id, r.texto, r.notas, r.autoriza_depoimento, r.criado_em,
            p.nome, p.email,
            row_number() over (partition by r.pessoa_id order by r.criado_em)::int as ordem,
            count(*) over (partition by r.pessoa_id)::int as total
       from recados r
       join pessoas_da_galeria p on p.id = r.pessoa_id
      where r.galeria_id = $1
      order by r.criado_em desc`,
    [galeriaId],
  );
  return linhas.map((l) => ({
    id: l.id,
    texto: l.texto,
    notas: l.notas ?? {},
    autoriza: l.autoriza_depoimento,
    quando: l.criado_em,
    ordem: l.ordem,
    total: l.total,
    nome: l.nome,
    email: l.email,
  }));
}

/** Quantos recados esta galeria tem — para o selo da aba no painel. */
export async function quantosRecados(galeriaId: string): Promise<number> {
  const linha = await consultarUm<{ n: number }>(
    "select count(*)::int as n from recados where galeria_id = $1",
    [galeriaId],
  );
  return linha?.n ?? 0;
}
