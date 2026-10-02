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

/**
 * Grava (ou corrige) o recado desta pessoa nesta galeria.
 *
 * `on conflict` no par (galeria, pessoa): voltar e escrever de novo CORRIGE o
 * que ela disse, em vez de acrescentar um segundo depoimento da mesma pessoa.
 */
export async function gravarRecado(
  galeriaId: string,
  pessoaId: string,
  dados: RecadoGravado,
): Promise<void> {
  await consultarUm(
    `insert into recados (galeria_id, pessoa_id, texto, notas, autoriza_depoimento)
          values ($1, $2, $3, $4::jsonb, $5)
     on conflict (galeria_id, pessoa_id)
     do update set texto = excluded.texto,
                   notas = excluded.notas,
                   autoriza_depoimento = excluded.autoriza_depoimento,
                   atualizado_em = now()`,
    [galeriaId, pessoaId, dados.texto, JSON.stringify(dados.notas), dados.autoriza],
  );
}

export interface RecadoNoPainel {
  id: string;
  texto: string | null;
  notas: Record<string, number>;
  autoriza: boolean;
  quando: Date;
  corrigido: boolean;
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
    atualizado_em: Date;
    nome: string | null;
    email: string | null;
  }>(
    `select r.id, r.texto, r.notas, r.autoriza_depoimento, r.criado_em, r.atualizado_em,
            p.nome, p.email
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
    /* "Corrigido" e não "editado": é o que aconteceu, e o fotógrafo precisa
       saber que o texto mudou depois de escrito. A diferença de um segundo é
       ruído — `atualizado_em` nasce igual a `criado_em`. */
    corrigido: l.atualizado_em.getTime() - l.criado_em.getTime() > 1000,
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
