/**
 * O site do estúdio — o conteúdo da vitrine em `/e/<slug>`.
 *
 * Puro de propósito, como `marca-estudio.ts`: nada aqui toca banco, sessão ou
 * bucket, então cada regra é testável sem subir nada. (Não confundir com
 * `config/marca.ts`, que é a marca da Galeria Átomo.)
 *
 * ── Por que campos fixos, e não blocos livres ──────────────────────────────
 * Um construtor de blocos ("arraste um título, arraste uma foto") dá liberdade
 * e entrega feio: quem usa é fotógrafo, não designer, e a vitrine é a primeira
 * coisa que o casal vê. Com campos fixos, o layout é nosso e o texto é dele —
 * qualquer combinação de preenchimento sai apresentável. Preço: quem quiser uma
 * seção que não previmos não tem como criá-la. É a troca certa por ora.
 *
 * ── A parte perigosa ──────────────────────────────────────────────────────
 * Quase tudo aqui é texto que o React escapa sozinho ao desenhar. As exceções
 * são o WhatsApp e o Instagram, que viram `href`: um `javascript:` num href é
 * execução de script no domínio do estúdio, escolhida por quem preencheu o
 * campo. Por isso o banco NÃO guarda endereço — guarda dígitos e um nome de
 * usuário, e quem monta o endereço é `urlDoWhatsapp`/`urlDoInstagram`.
 */
import { OPCOES, type Tema, type Tipografia } from "@/config/aparencia";

export interface Depoimento {
  texto: string;
  autor: string;
}

export interface Site {
  /** Enquanto falso, `/e/<slug>` mostra só a lista de galerias, como antes. */
  ligado: boolean;

  // capa
  frase: string;
  selo: string;
  /** Slug da galeria cuja capa vira a foto do topo. Vazio = a mais recente. */
  capaGaleria: string;

  // sobre
  sobreTitulo: string;
  sobre: string;
  citacao: string;
  citacaoAutor: string;

  // depoimentos
  depoimentosTitulo: string;
  depoimentos: Depoimento[];

  // contato
  contatoTitulo: string;
  contatoTexto: string;
  /** Só dígitos, com país. Vazio quando não há ou quando o valor era inválido. */
  whatsapp: string;
  /** Só o usuário, sem @ e sem endereço. */
  instagram: string;
  email: string;

  // aparência da vitrine (mesmos eixos da galeria)
  tema: Tema;
  tipografia: Tipografia;
}

/**
 * Tetos de tamanho. Existem para o layout, não para a segurança: um "sobre" de
 * 40 mil caracteres não ataca ninguém, só transforma a vitrine numa parede de
 * texto e engorda a linha do banco sem motivo.
 */
export const LIMITES = {
  frase: 140,
  selo: 40,
  capaGaleria: 120,
  sobreTitulo: 80,
  sobre: 3000,
  citacao: 400,
  citacaoAutor: 120,
  depoimentosTitulo: 80,
  depoimentoTexto: 900,
  depoimentoAutor: 80,
  contatoTitulo: 80,
  contatoTexto: 800,
  email: 160,
} as const;

/** 24 depoimentos já são uma página longa; acima disso ninguém lê. */
export const MAX_DEPOIMENTOS = 24;

export const SITE_PADRAO: Site = {
  ligado: false,
  frase: "",
  selo: "",
  capaGaleria: "",
  sobreTitulo: "Sobre",
  sobre: "",
  citacao: "",
  citacaoAutor: "",
  depoimentosTitulo: "Depoimentos",
  depoimentos: [],
  contatoTitulo: "Contato",
  contatoTexto: "",
  whatsapp: "",
  instagram: "",
  email: "",
  tema: "noite",
  tipografia: "serifada",
};

// --- contato: texto do usuário virando endereço -------------------------------

/**
 * Devolve o número em dígitos, com código de país, ou null.
 *
 * Assume Brasil quando vêm 10 ou 11 dígitos (fixo com DDD e celular com DDD),
 * que é o formato que o fotógrafo digita. Doze ou mais já traz o país e passa
 * intacto — quem tem número de fora não fica de fora.
 */
export function normalizarWhatsapp(bruto: string): string | null {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  return null;
}

/**
 * Devolve só o usuário do Instagram. Aceita `@nome`, `nome` e o endereço
 * completo colado da barra do navegador — que é como a pessoa realmente tem
 * isso à mão.
 */
export function normalizarInstagram(bruto: string): string | null {
  const t = String(bruto ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(t) ? t : null;
}

/*
 * Os dois montadores validam DE NOVO antes de devolver o endereço.
 *
 * Parece redundante com a normalização acima, e é justamente esse o ponto: a
 * peneira da gravação não protege o que já está gravado. Um valor posto no
 * banco por outro caminho — psql na mão, uma importação, uma action futura que
 * esqueça de normalizar — chega aqui cru. Quem desenha o href é a última
 * fronteira, então é aqui que a garantia precisa valer.
 */
export function urlDoWhatsapp(numero: string): string | null {
  return /^\d{10,15}$/.test(String(numero ?? "")) ? `https://wa.me/${numero}` : null;
}

export function urlDoInstagram(usuario: string): string | null {
  return /^[A-Za-z0-9._]{1,30}$/.test(String(usuario ?? ""))
    ? `https://instagram.com/${usuario}`
    : null;
}

// --- leitura do que está no banco ---------------------------------------------

const texto = (v: unknown, limite: number): string =>
  typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, limite) : "";

const umDe = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
  opcoes.includes(v as T) ? (v as T) : padrao;

function lerDepoimentos(bruto: unknown): Depoimento[] {
  if (!Array.isArray(bruto)) return [];
  return (
    bruto
      .map((d) => ({
        texto: texto((d as Depoimento)?.texto, LIMITES.depoimentoTexto),
        autor: texto((d as Depoimento)?.autor, LIMITES.depoimentoAutor),
      }))
      /* Sem texto não é depoimento: desenharia um bloco de aspas vazio na
       * página, que é pior que a ausência da seção. O autor pode faltar. */
      .filter((d) => d.texto.length > 0)
      .slice(0, MAX_DEPOIMENTOS)
  );
}

/**
 * Lê o JSON do banco garantindo um `Site` válido — mesma postura de
 * `lerAparencia`: nunca lança, nunca devolve campo faltando.
 *
 * Aqui o contrato pesa mais que na galeria: esta página é a vitrine PÚBLICA do
 * estúdio. Um `throw` por causa de uma chave estranha não é uma tela de painel
 * quebrada, é o site do fotógrafo fora do ar para os clientes dele.
 */
export function lerSite(bruto: unknown): Site {
  const o = (bruto ?? {}) as Record<string, unknown>;
  return {
    ligado: Boolean(o.ligado),

    frase: texto(o.frase, LIMITES.frase),
    selo: texto(o.selo, LIMITES.selo),
    capaGaleria: texto(o.capaGaleria, LIMITES.capaGaleria),

    sobreTitulo: texto(o.sobreTitulo, LIMITES.sobreTitulo) || SITE_PADRAO.sobreTitulo,
    sobre: texto(o.sobre, LIMITES.sobre),
    citacao: texto(o.citacao, LIMITES.citacao),
    citacaoAutor: texto(o.citacaoAutor, LIMITES.citacaoAutor),

    depoimentosTitulo:
      texto(o.depoimentosTitulo, LIMITES.depoimentosTitulo) || SITE_PADRAO.depoimentosTitulo,
    depoimentos: lerDepoimentos(o.depoimentos),

    contatoTitulo: texto(o.contatoTitulo, LIMITES.contatoTitulo) || SITE_PADRAO.contatoTitulo,
    contatoTexto: texto(o.contatoTexto, LIMITES.contatoTexto),
    // A MESMA peneira do formulário, de novo na leitura: ver o comentário dos
    // montadores de endereço acima.
    whatsapp: normalizarWhatsapp(String(o.whatsapp ?? "")) ?? "",
    instagram: normalizarInstagram(String(o.instagram ?? "")) ?? "",
    email: texto(o.email, LIMITES.email),

    tema: umDe(
      o.tema,
      OPCOES.tema.map((x) => x.id),
      SITE_PADRAO.tema,
    ),
    tipografia: umDe(
      o.tipografia,
      OPCOES.tipografia.map((x) => x.id),
      SITE_PADRAO.tipografia,
    ),
  };
}

// --- o que a página desenha ---------------------------------------------------

export type Secao = "capa" | "sobre" | "galerias" | "depoimentos" | "contato";

/**
 * Quais seções têm conteúdo — a página e o menu leem daqui.
 *
 * Seção vazia não pode virar título com nada embaixo: é o defeito clássico de
 * gerador de site, e apaga a diferença entre "o fotógrafo não preencheu" e "o
 * site está quebrado".
 *
 * `galerias` está sempre na lista, e essa é a vantagem que o concorrente não
 * tem: o portfólio dele é escolhido à mão e envelhece parado, o nosso é a
 * própria lista de entregas publicadas. Mesmo com o site inteiro em branco, a
 * vitrine tem o que mostrar.
 */
export function secoesComConteudo(site: Site): Secao[] {
  const temContato = Boolean(site.whatsapp || site.instagram || site.email || site.contatoTexto);
  return [
    "capa" as const,
    site.sobre || site.citacao ? ("sobre" as const) : null,
    "galerias" as const,
    site.depoimentos.length > 0 ? ("depoimentos" as const) : null,
    temContato ? ("contato" as const) : null,
  ].filter((s): s is Secao => s !== null);
}

/** Rótulo de cada seção no menu do topo. */
export function rotuloDaSecao(secao: Secao, site: Site): string {
  const mapa: Record<Secao, string> = {
    capa: "Início",
    sobre: site.sobreTitulo,
    galerias: "Galerias",
    depoimentos: site.depoimentosTitulo,
    contato: site.contatoTitulo,
  };
  return mapa[secao];
}

/** Quebra o texto em parágrafos. Linha em branco separa; linha só quebra. */
export function paragrafos(bruto: string): string[] {
  return bruto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
