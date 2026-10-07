import { marca } from "@/config/marca";
import { LINK_ATOMATIZA, URL_ATOMATIZA } from "@/lib/ponte-atomatiza";

/**
 * A PÁGINA-PONTE DO INSTAGRAM (`/bio`) — quais produtos ela oferece, e em que ordem.
 *
 * ── PEDIDO (07/10/2026) ───────────────────────────────────────────────────
 *
 * Juan: o perfil do Instagram passa a comunicar dois produtos, Atomatiza e
 * Galeria Átomo, e o link da bio não pode cair direto em nenhum dos dois. Uma
 * página mínima, pensada para o celular, onde a pessoa escolhe — e que ainda
 * mede o que chegou e para onde foi. "Precisamos conseguir inverter ou
 * reorganizar os produtos futuramente sem reconstruir a página."
 *
 * ── A ORDEM É A ORDEM DESTA LISTA ─────────────────────────────────────────
 *
 * Inverter os produtos é trocar duas linhas de lugar. O destaque de
 * "Lançamento" é um campo do produto, com data para acabar sozinho: passada a
 * data, o selo some na próxima visita, sem ninguém lembrar de tirar.
 *
 * Produto novo é um objeto novo aqui: a página, os redirecionadores
 * (`/bio/ir/<id>`), os nomes dos eventos e a leitura no admin saem desta lista.
 *
 * ── POR QUE TODO LINK PASSA POR `/bio/ir/…` ───────────────────────────────
 *
 * A página NÃO aponta direto para o produto. O botão vai para `/bio/ir/<id>`,
 * que conta o clique NO SERVIDOR e só então redireciona. Três razões:
 *   1. contar em JavaScript, antes de sair da página, perde cliques — o
 *      navegador de dentro do Instagram descarta a requisição quando a página
 *      muda; no servidor o clique já chegou;
 *   2. funciona sem JavaScript;
 *   3. o endereço de cada produto mora aqui, num lugar só: mudar o destino não
 *      mexe na página nem no que o Instagram divulga.
 */

export interface ProdutoDaBio {
  /** O caminho (`/bio/ir/<id>`), o rótulo do cookie e o nome da origem no cadastro. */
  id: string;
  /** O que a pessoa quer fazer — é a frase que ela reconhece, antes do nome. */
  intencao: string;
  nome: string;
  descricao: string;
  botao: string;
  /** O evento de clique no produto. */
  evento: string;
  /**
   * Para onde o botão leva. "/" ou "/entrar" são do NOSSO site; um endereço
   * completo é de outro sistema.
   */
  destino: string;
  /**
   * O destino é de outro DOMÍNIO. Cookie não atravessa domínio, então a origem
   * vai na URL (UTM) — e quem recebe precisa guardá-la. Para o nosso próprio
   * site a origem vai no cookie, e a URL fica limpa.
   */
  origemNaUrl: boolean;
  entrar: { rotulo: string; destino: string; evento: string };
  /** "Lançamento", por exemplo. `ate` (AAAA-MM-DD) é o último dia em que aparece. */
  destaque?: { rotulo: string; ate?: string };
}

export const NOME_DA_ATOMATIZA = "Atomatiza";

/**
 * Os produtos, na ordem em que aparecem.
 *
 * Neste primeiro momento a Galeria vem primeiro e leva o selo — está no
 * lançamento. O selo vale até o fim do ano; depois some sozinho.
 */
export const PRODUTOS_DA_BIO: readonly ProdutoDaBio[] = [
  {
    id: "galeria",
    intencao: "Quero entregar meu trabalho",
    nome: marca.nome,
    descricao: "Galerias de entrega personalizáveis.",
    botao: `Conhecer a ${marca.nome}`,
    evento: "click_galeria_atomo",
    destino: "/",
    origemNaUrl: false,
    entrar: { rotulo: `Entrar na ${marca.nome}`, destino: "/entrar", evento: "click_login_galeria" },
    destaque: { rotulo: "Lançamento", ate: "2026-12-31" },
  },
  {
    id: "atomatiza",
    intencao: "Quero organizar meu estúdio",
    nome: NOME_DA_ATOMATIZA,
    descricao: "Gestão e organização para fotógrafos.",
    botao: `Conhecer a ${NOME_DA_ATOMATIZA}`,
    evento: "click_atomatiza",
    destino: `${URL_ATOMATIZA}/`,
    origemNaUrl: true,
    entrar: { rotulo: `Entrar na ${NOME_DA_ATOMATIZA}`, destino: LINK_ATOMATIZA, evento: "click_login_atomatiza" },
  },
];

/** O selo do produto, se ainda vale hoje. `hoje` é AAAA-MM-DD (de Brasília). */
export function destaqueVigente(p: ProdutoDaBio, hoje: string): string | null {
  if (!p.destaque) return null;
  return !p.destaque.ate || hoje <= p.destaque.ate ? p.destaque.rotulo : null;
}

/** Tudo o que `/bio/ir/<alvo>` sabe fazer: um botão de produto ou um "entrar". */
export interface AlvoDaBio {
  /** O que vem depois de `/bio/ir/`. */
  caminho: string;
  evento: string;
  destino: string;
  produto: ProdutoDaBio;
  /** Botão do produto (grava o cookie de origem) ou "entrar" (cliente que já tem conta, sem origem). */
  tipo: "produto" | "entrar";
  origemNaUrl: boolean;
}

export const ALVOS_DA_BIO: readonly AlvoDaBio[] = PRODUTOS_DA_BIO.flatMap((p) => [
  { caminho: p.id, evento: p.evento, destino: p.destino, produto: p, tipo: "produto" as const, origemNaUrl: p.origemNaUrl },
  {
    caminho: `entrar-${p.id}`,
    evento: p.entrar.evento,
    destino: p.entrar.destino,
    produto: p,
    tipo: "entrar" as const,
    /* Quem já é cliente não está sendo conquistado: o login leva a URL limpa. */
    origemNaUrl: false,
  },
]);

export function alvoDaBio(caminho: string): AlvoDaBio | null {
  return ALVOS_DA_BIO.find((a) => a.caminho === caminho) ?? null;
}

/** Todo nome de evento que a medição aceita gravar. */
export const EVENTOS_DA_BIO: readonly string[] = ALVOS_DA_BIO.map((a) => a.evento);
