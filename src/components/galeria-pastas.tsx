import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  FONTES_TITULO,
  fonteDoDetalhe,
  pesoDoTitulo,
  type Aparencia,
} from "@/config/aparencia";

/**
 * A ENTREGA EM PASTAS — os capítulos como pastas, cada uma com a sua capa.
 *
 * ── DE ONDE VEIO (30/09/2026) ─────────────────────────────────────────────
 *
 * "Adicionar a forma de entregar em pastas (com capa na pasta e os arquivos
 * dentro), vamos pensar numa forma bonita de fazer isso." E no mesmo dia,
 * com a primeira versão no ar: "vamos pensar em estilos para pastas".
 *
 * ── NENHUM DOS DESENHOS É UM ÍCONE DE PASTA ───────────────────────────────
 *
 * O ícone de pasta amarela é do computador de quem RECEBE — e é justamente a
 * cara de "nuvem genérica" que a entrega do fotógrafo não pode ter (ver
 * `docs/estrategia-de-marca.md`, §12). Os quatro desenhos são quatro jeitos
 * de um capítulo se apresentar pelas FOTOS que tem dentro:
 *
 *   pilha     o maço de cópias na mesa — a capa e a borda das próximas;
 *   capas     o cartaz — uma foto alta, o nome escrito sobre ela;
 *   indice    o sumário de um livro — número, nome grande, uma tira de fotos;
 *   mosaico   a folha de contato — a capa e mais duas, e quantas faltam.
 *
 * Nada aqui é cor nossa: fundo, texto, canto e letra são os da galeria. A
 * mesma pasta sai clara e de canto vivo no estilo Revista, e escura e macia
 * no Átomo — a pasta é do fotógrafo. A única exceção é o texto das Capas, que
 * fica SOBRE a foto e por isso é branco sobre véu escuro em qualquer tema — a
 * mesma decisão da capa imersa.
 *
 * ── POR QUE NÃO TEM JAVASCRIPT ────────────────────────────────────────────
 *
 * Porque não precisa: cada pasta é um link para o capítulo, que abre a
 * galeria de sempre só com ele (`/…/<galeria>/<capitulo>`), com o menu de
 * baixar, as favoritas e o visualizador que já existem. Todo movimento é CSS,
 * e quem pediu menos movimento no sistema recebe tudo parado.
 */

export interface PastaDaEntrega {
  id: string;
  nome: string;
  href: string;
  fotos: number;
  videos: number;
  /** A capa primeiro (em tamanho de visualizador), depois até três
      miniaturas do mesmo capítulo. Pode vir vazia (pasta só com vídeos sem
      pôster): aí o desenho usa a cor da superfície no lugar da foto. */
  imagens: string[];
  /** Onde a CAPA desta pasta deve ser cortada, em porcentagem (migração 067).
   *  Vale só para a primeira imagem: as de trás são miniaturas pequenas, e um
   *  enquadramento escolhido para a capa não diz nada sobre elas. */
  foco: { x: number; y: number };
}

/** O corte da capa. Separado porque os CINCO desenhos o usam, e porque um deles
 *  esquecer é o tipo de diferença que ninguém nota até alguém reclamar que "só
 *  naquele estilo a foto sai torta". */
const corteDaCapa = (p: PastaDaEntrega) => ({ objectPosition: `${p.foco.x}% ${p.foco.y}%` });

function contagem(fotos: number, videos: number): string {
  const partes: string[] = [];
  if (fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
  if (videos) partes.push(`${videos} ${videos === 1 ? "vídeo" : "vídeos"}`);
  return partes.join(" · ") || "vazia";
}

const numero = (i: number) => String(i + 1).padStart(2, "0");

/** A movimentação que todos os desenhos usam — lenta e sem rebote. */
const SUAVE = "transition duration-500 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none";

/* Foto de pasta: `<img>` e não `next/image`, porque a URL é assinada no
   armazém e muda a cada visita — o otimizador do Next não tem o que guardar. */
function Foto({
  src,
  className = "",
  eager = false,
  style,
}: {
  src: string | undefined;
  className?: string;
  eager?: boolean;
  /* Só o `objectPosition` da capa passa por aqui (migração 067). É um objeto
     montado por `corteDaCapa`, a partir de dois inteiros que o banco mantém
     entre 0 e 100 — e não um estilo livre vindo de quem quer que seja. */
  style?: CSSProperties;
}) {
  if (!src) return <span className={`block ${className}`} style={{ background: "var(--g-superficie)" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
    <img
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      style={style}
      className={`block object-cover ${className}`}
    />
  );
}

interface Letras {
  titulo: CSSProperties;
  detalhe: { className: string; style: CSSProperties };
}

function letrasDa(aparencia: Aparencia): Letras {
  const detalhe = fonteDoDetalhe(aparencia);
  return {
    titulo: {
      fontFamily: FONTES_TITULO[aparencia.tipografia],
      fontWeight: pesoDoTitulo(aparencia.tipografia, aparencia.peso),
    },
    detalhe: {
      className: `uppercase tracking-[0.2em] ${detalhe ? "" : "font-mono"}`,
      style: detalhe ? { fontFamily: detalhe } : {},
    },
  };
}

/** O anel de foco dos links — na cor de ação da galeria, sobre o fundo dela. */
const FOCO: CSSProperties = {
  ["--tw-ring-color" as string]: "var(--g-destaque)",
  ["--tw-ring-offset-color" as string]: "var(--g-fundo)",
};
const CLASSE_FOCO = "outline-none focus-visible:ring-2 focus-visible:ring-offset-4";

export function GaleriaPastas({
  pastas,
  aparencia,
  permiteDownload,
}: {
  pastas: PastaDaEntrega[];
  aparencia: Aparencia;
  permiteDownload: boolean;
}) {
  const letras = letrasDa(aparencia);
  const alinhamento = aparencia.alinhamento === "esquerda" ? "text-left" : "text-center";

  let desenho: ReactNode;
  switch (aparencia.estiloPastas) {
    case "capas":
      desenho = <PastasEmCapas pastas={pastas} letras={letras} />;
      break;
    case "indice":
      desenho = <PastasEmIndice pastas={pastas} letras={letras} />;
      break;
    case "mosaico":
      desenho = <PastasEmMosaico pastas={pastas} letras={letras} />;
      break;
    case "feed":
      desenho = <PastasEmFeed pastas={pastas} letras={letras} />;
      break;
    default:
      desenho = <PastasEmPilha pastas={pastas} letras={letras} alinhamento={alinhamento} />;
  }

  return (
    <section aria-label="Pastas" className="mx-auto max-w-[1200px] pt-12 sm:pt-16">
      {desenho}

      {/*
        O MENU DE BAIXAR MORA DENTRO DAS PASTAS, e esta linha diz isso.

        Ele já oferece as duas coisas que alguém quer daqui — "esta pasta" e
        "a galeria inteira" —, com a porta do nome, o celular que salva no
        rolo e o zip do computador. Repeti-lo aqui seria uma segunda porta de
        download para manter igual à primeira para sempre.
      */}
      {permiteDownload && (
        <p className={`mt-14 px-1 text-xs ${alinhamento}`} style={{ color: "var(--g-tenue)" }}>
          Para baixar, abra uma pasta — dá para levar só ela ou a galeria inteira.
        </p>
      )}
    </section>
  );
}

/* ── PILHA ────────────────────────────────────────────────────────────────
 *
 * A capa com duas cópias do mesmo capítulo atrás, levemente tortas. Ao passar
 * o mouse elas se abrem em leque e a capa sobe — o gesto de folhear antes de
 * abrir. Em telas de toque não há hover, e a pilha parada já diz "tem mais
 * aqui dentro". O `--i` de cada pasta atrasa a entrada dela em 60 ms: as
 * pastas chegam uma depois da outra, como cópias postas na mesa.
 */
function PastasEmPilha({
  pastas,
  letras,
  alinhamento,
}: {
  pastas: PastaDaEntrega[];
  letras: Letras;
  alinhamento: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-8 sm:gap-y-14 lg:grid-cols-3">
      {pastas.map((p, i) => (
        <li key={p.id} className="pasta-entra" style={{ ["--i" as string]: i }}>
          <Link href={p.href} className={`group block rounded-[var(--g-canto,6px)] ${CLASSE_FOCO}`} style={FOCO}>
            <div className="relative mx-auto aspect-[4/5] w-[86%]">
              {[2, 1].map((camada) => (
                <span
                  key={camada}
                  aria-hidden
                  className={`absolute inset-0 overflow-hidden rounded-[var(--g-canto,6px)] shadow-[0_10px_30px_-12px_rgba(0,0,0,.45)] ${SUAVE} ${
                    camada === 2
                      ? "-rotate-[5deg] group-hover:-translate-x-[9%] group-hover:-rotate-[11deg]"
                      : "rotate-[4deg] group-hover:translate-x-[9%] group-hover:rotate-[10deg]"
                  }`}
                  style={{ background: "var(--g-superficie)", border: "1px solid var(--g-linha)" }}
                >
                  {p.imagens[camada] && <Foto src={p.imagens[camada]} className="h-full w-full opacity-90" />}
                </span>
              ))}
              <span
                className={`absolute inset-0 overflow-hidden rounded-[var(--g-canto,6px)] shadow-[0_18px_40px_-14px_rgba(0,0,0,.55)] group-hover:-translate-y-[3%] group-hover:scale-[1.02] ${SUAVE}`}
                style={{ background: "var(--g-superficie)" }}
              >
                <Foto style={corteDaCapa(p)} src={p.imagens[0]} eager={i < 4} className="h-full w-full" />
              </span>
            </div>

            <div className={`mt-6 px-1 ${alinhamento}`}>
              <span className={`block text-[11px] ${letras.detalhe.className}`} style={{ color: "var(--g-tenue)", ...letras.detalhe.style }}>
                {numero(i)}
              </span>
              <span className="mt-1 block text-xl leading-tight sm:text-2xl" style={{ ...letras.titulo, color: "var(--g-texto)" }}>
                {p.nome}
              </span>
              <span className="mt-1 block text-xs" style={{ color: "var(--g-suave)" }}>
                {contagem(p.fotos, p.videos)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── CAPAS ────────────────────────────────────────────────────────────────
 *
 * Cada pasta é um cartaz: a foto alta ocupa o cartão inteiro e o nome vem
 * escrito sobre ela, embaixo, na letra do título. É o desenho em que a foto
 * mais manda — o capítulo se apresenta pela melhor foto dele.
 *
 * O texto é branco sobre um véu escuro que sobe do pé da foto, em qualquer
 * tema: é a regra da capa imersa, e pelo mesmo motivo — texto sobre foto não
 * pode depender da foto. No hover a foto se aproxima devagar e aparece um
 * "abrir", que é o que o cartão faz.
 */
function PastasEmCapas({ pastas, letras }: { pastas: PastaDaEntrega[]; letras: Letras }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
      {pastas.map((p, i) => (
        <li key={p.id} className="pasta-entra" style={{ ["--i" as string]: i }}>
          <Link
            href={p.href}
            className={`group relative block aspect-[4/5] overflow-hidden rounded-[var(--g-canto,6px)] ${CLASSE_FOCO}`}
            style={{ ...FOCO, background: "var(--g-superficie)" }}
          >
            <Foto style={corteDaCapa(p)} src={p.imagens[0]} eager={i < 3} className={`absolute inset-0 h-full w-full group-hover:scale-[1.05] ${SUAVE} !duration-[1200ms]`} />
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.28) 38%, rgba(0,0,0,0) 62%)",
              }}
            />
            <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-white sm:p-6">
              <span className="min-w-0">
                <span className={`block text-[10px] text-white/70 ${letras.detalhe.className}`} style={letras.detalhe.style}>
                  {numero(i)} · {contagem(p.fotos, p.videos)}
                </span>
                <span className="mt-1.5 block text-3xl leading-[1.05] [text-wrap:balance] sm:text-4xl" style={letras.titulo}>
                  {p.nome}
                </span>
              </span>
              <span
                aria-hidden
                className={`mb-1 shrink-0 translate-x-2 text-xs opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${SUAVE}`}
              >
                abrir →
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── ÍNDICE ───────────────────────────────────────────────────────────────
 *
 * O sumário de um livro de fotografia: uma linha por pasta, com o número
 * grande e apagado, o nome na letra do título — grande, porque aqui a
 * tipografia é o desenho — e, do lado, uma tira com a capa e três fotos do
 * capítulo. É o mais editorial dos quatro, e o que mais depende da fonte que
 * o fotógrafo escolheu: com uma serifada vira livro, com uma sem serifa vira
 * catálogo.
 *
 * No hover a linha ganha o fundo da superfície e o nome anda um pouco para a
 * direita — o dedo correndo o índice.
 */
function PastasEmIndice({ pastas, letras }: { pastas: PastaDaEntrega[]; letras: Letras }) {
  return (
    <ol className="border-t" style={{ borderColor: "var(--g-linha)" }}>
      {pastas.map((p, i) => (
        <li key={p.id} className="pasta-entra border-b" style={{ ["--i" as string]: i, borderColor: "var(--g-linha)" }}>
          <Link
            href={p.href}
            className={`group grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-4 rounded-[var(--g-canto,6px)] px-2 py-6 sm:grid-cols-[5rem_1fr_auto] sm:gap-x-8 sm:px-4 sm:py-8 ${CLASSE_FOCO} hover:bg-[var(--g-superficie)] ${SUAVE}`}
            style={FOCO}
          >
            <span
              className="text-3xl leading-none tabular-nums sm:text-5xl"
              style={{ ...letras.titulo, color: "var(--g-tenue)" }}
            >
              {numero(i)}
            </span>
            <span className={`min-w-0 group-hover:translate-x-1.5 ${SUAVE}`}>
              <span className="block text-3xl leading-[1.05] [text-wrap:balance] sm:text-5xl" style={{ ...letras.titulo, color: "var(--g-texto)" }}>
                {p.nome}
              </span>
              <span className={`mt-2 block text-[11px] ${letras.detalhe.className}`} style={{ color: "var(--g-suave)", ...letras.detalhe.style }}>
                {contagem(p.fotos, p.videos)}
              </span>
            </span>
            <span className="col-span-2 flex gap-1.5 sm:col-span-1 sm:gap-2">
              {[0, 1, 2, 3].map((k) =>
                p.imagens[k] || k === 0 ? (
                  <span
                    key={k}
                    className={`block aspect-[4/5] overflow-hidden rounded-[var(--g-canto,6px)] ${k === 0 ? "w-24 sm:w-28" : "w-16 sm:w-20"} ${
                      k > 0 ? "self-end opacity-80 group-hover:opacity-100" : ""
                    } ${SUAVE}`}
                  >
                    <Foto style={k === 0 ? corteDaCapa(p) : undefined} src={p.imagens[k]} eager={i < 3 && k === 0} className="h-full w-full" />
                  </span>
                ) : null,
              )}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/* ── FEED ─────────────────────────────────────────────────────────────────
 *
 * Juan, 07–08/10/2026, com o vídeo da Flor da Luz no celular: "eu queria poder
 * ver as pastas sem ser assim, tipo uma versão compacta". E depois, vendo a
 * primeira resposta: "a distribuição visual do capas poderia ser mais
 * compacta, pois no computador fica lindo, no celular não. No celular fica
 * apenas uma por tela, poderia ser 2 ou 3. Semelhante à distribuição visual do
 * feed do instagram".
 *
 * ── O QUE FOI MEDIDO, NUM CELULAR DE 375 × 812 ────────────────────────────
 *
 *   Capas     1 por fileira · 429 px · 12 pastas em 7,7 telas
 *   Índice    1 por fileira · 429 px · as 20 da Flor da Luz em 12 telas
 *   Pilha     2 por fileira · 263 px · 12 pastas em 3,4 telas
 *
 * A densidade não é novidade — o Pilha, que é o PADRÃO, já põe duas por
 * fileira. O que o Feed traz é outra coisa: quadrado e colado. O retrato 4/5 e
 * os 40 px de respiro entre as linhas do Pilha são o que fazem a página andar;
 * aqui a altura da fileira é metade da largura e o vão é de 6 px.
 *
 * ── A PRIMEIRA TENTATIVA FOI UMA LISTA, E ELE RECUSOU ─────────────────────
 *
 * Saiu antes uma "Lista", de uma linha por pasta. Juan: "o formato lista tá
 * muito parecido com o índice. Entre eles o índice tá mais bonito." Ela foi
 * retirada — nasceu de uma recomendação minha, não de um pedido, e nenhuma
 * galeria a usava quando saiu (conferido em produção antes de tirar).
 *
 * ── E O CAPAS CONTINUA COMO ESTÁ ──────────────────────────────────────────
 *
 * Era UMA LINHA pôr o Capas em duas colunas no celular, e três galerias já
 * entregues mudariam de cara sem os donos terem pedido. Quem quiser a grade
 * escolhe o Feed.
 */
function PastasEmFeed({ pastas, letras }: { pastas: PastaDaEntrega[]; letras: Letras }) {
  return (
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
      {pastas.map((p, i) => (
        <li key={p.id} className="pasta-entra" style={{ ["--i" as string]: i }}>
          <Link
            href={p.href}
            className={`group relative block aspect-square overflow-hidden rounded-[var(--g-canto,6px)] ${CLASSE_FOCO}`}
            style={{ ...FOCO, background: "var(--g-superficie)" }}
          >
            <Foto style={corteDaCapa(p)} src={p.imagens[0]}
              eager={i < 6}
              className={`absolute inset-0 h-full w-full group-hover:scale-[1.05] ${SUAVE} !duration-[1200ms]`}
            />
            {/* O véu só embaixo, e só o quanto o nome precisa: num quadrado
                pequeno, escurecer a foto inteira apagaria justamente o que
                diferencia uma pasta da outra. */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1/2"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0))" }}
            />
            <span className="absolute inset-x-0 bottom-0 p-2 sm:p-2.5">
              {/* `line-clamp-2`: "Casa na Chácara" cabe em duas linhas sem
                  esticar o quadrado, que é o que mantém a fileira alinhada. */}
              <span className="line-clamp-2 text-xs leading-tight text-white sm:text-sm" style={letras.titulo}>
                {p.nome}
              </span>
              <span
                className={`mt-0.5 block text-[10px] text-white/70 ${letras.detalhe.className}`}
                style={letras.detalhe.style}
              >
                {contagem(p.fotos, p.videos)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── MOSAICO ──────────────────────────────────────────────────────────────
 *
 * A folha de contato: a capa grande à esquerda, duas fotos empilhadas à
 * direita, e na última o número do que falta ver ("+81"). O capítulo se
 * apresenta pelo conjunto, não por uma foto só — é o desenho para quem acha
 * que a melhor foto não conta a pasta inteira.
 *
 * O papel da folha é a cor da superfície do tema, com uma margem fina em
 * volta das fotos: a mesma pasta é papel branco no tema claro e cartão
 * escuro no noite.
 */
function PastasEmMosaico({ pastas, letras }: { pastas: PastaDaEntrega[]; letras: Letras }) {
  return (
    <ul className="grid gap-6 md:grid-cols-2 md:gap-8 xl:grid-cols-3">
      {pastas.map((p, i) => {
        const total = p.fotos + p.videos;
        const faltam = total - Math.min(total, 3);
        return (
          <li key={p.id} className="pasta-entra" style={{ ["--i" as string]: i }}>
            <Link href={p.href} className={`group block rounded-[var(--g-canto,6px)] ${CLASSE_FOCO}`} style={FOCO}>
              <span
                className={`grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-1 overflow-hidden rounded-[var(--g-canto,6px)] p-1 group-hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,.5)] ${SUAVE}`}
                style={{ background: "var(--g-superficie)", border: "1px solid var(--g-linha)" }}
              >
                <span className="col-span-2 row-span-2 overflow-hidden rounded-[calc(var(--g-canto,6px)*.6)]">
                  <Foto style={corteDaCapa(p)} src={p.imagens[0]} eager={i < 3} className={`h-full w-full group-hover:scale-[1.03] ${SUAVE}`} />
                </span>
                {[1, 2].map((k) => (
                  <span key={k} className="relative overflow-hidden rounded-[calc(var(--g-canto,6px)*.6)]">
                    <Foto style={k === 0 ? corteDaCapa(p) : undefined} src={p.imagens[k]} className={`h-full w-full group-hover:scale-[1.06] ${SUAVE}`} />
                    {k === 2 && faltam > 0 && (
                      <span
                        className="absolute inset-0 grid place-items-center text-xl tabular-nums text-white sm:text-2xl"
                        style={{ background: "rgba(0,0,0,.45)", ...letras.titulo }}
                      >
                        +{faltam}
                      </span>
                    )}
                  </span>
                ))}
              </span>
              <span className="mt-4 flex items-baseline justify-between gap-4 px-1">
                <span className="min-w-0 truncate text-xl sm:text-2xl" style={{ ...letras.titulo, color: "var(--g-texto)" }}>
                  {p.nome}
                </span>
                <span className={`shrink-0 text-[10px] ${letras.detalhe.className}`} style={{ color: "var(--g-tenue)", ...letras.detalhe.style }}>
                  {numero(i)}
                </span>
              </span>
              <span className="mt-0.5 block px-1 text-xs" style={{ color: "var(--g-suave)" }}>
                {contagem(p.fotos, p.videos)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A faixa no alto de uma pasta aberta: o caminho de volta e o nome dela.
 *
 * Link comum para o endereço da galeria — a tela das pastas é a galeria sem
 * capítulo, então voltar é só ir para lá.
 */
export function VoltarAsPastas({
  href,
  nome,
  aparencia,
}: {
  href: string;
  nome: string | null;
  aparencia: Aparencia;
}) {
  return (
    <nav aria-label="Pastas" className="flex flex-wrap items-baseline gap-x-4 gap-y-2 pt-8">
      <Link
        href={href}
        className="rounded-[var(--g-pilula,9999px)] px-4 py-2 text-sm transition hover:opacity-75"
        style={{ border: "1px solid var(--g-linha)", color: "var(--g-suave)" }}
      >
        ← Todas as pastas
      </Link>
      {nome && (
        <h2
          className="text-2xl leading-tight"
          style={{
            fontFamily: FONTES_TITULO[aparencia.tipografia],
            fontWeight: pesoDoTitulo(aparencia.tipografia, aparencia.peso),
          }}
        >
          {nome}
        </h2>
      )}
    </nav>
  );
}
