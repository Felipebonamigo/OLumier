import Link from "next/link";
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
 * dentro), vamos pensar numa forma bonita de fazer isso."
 *
 * ── O DESENHO: UMA PILHA DE CÓPIAS, NÃO UM ÍCONE DE PASTA ─────────────────
 *
 * O ícone de pasta amarela é do computador de quem RECEBE — e é justamente a
 * cara de "nuvem genérica" que a entrega do fotógrafo não pode ter (ver
 * `docs/estrategia-de-marca.md`, §12). O que uma pasta de casamento é, na mão,
 * é um maço de cópias: a foto da frente e, atrás dela, a borda das próximas.
 *
 * Então cada pasta é a CAPA (a escolhida no painel, ou a primeira foto) com
 * duas fotos do mesmo capítulo aparecendo atrás, levemente tortas. Ao passar o
 * mouse elas se abrem em leque, e a capa sobe um pouco — o gesto de folhear
 * antes de abrir. Em telas de toque não há hover, e a pilha parada já diz
 * "tem mais aqui dentro".
 *
 * Nada aqui é cor nossa: fundo, texto, canto e letra são os da galeria. A
 * mesma pasta sai clara e de canto vivo no estilo Revista, e escura e macia
 * no Átomo — a pasta é do fotógrafo.
 *
 * ── POR QUE NÃO TEM JAVASCRIPT ────────────────────────────────────────────
 *
 * Porque não precisa: cada pasta é um link para o capítulo, que abre a
 * galeria de sempre só com ele (`/…/<galeria>/<capitulo>`), com o menu de
 * baixar, as favoritas e o visualizador que já existem. O leque é CSS puro.
 */

export interface PastaDaEntrega {
  id: string;
  nome: string;
  href: string;
  fotos: number;
  videos: number;
  /** A capa primeiro, depois até duas que aparecem atrás. Pode vir vazia
      (pasta só com vídeos sem pôster): aí a pilha é de papel, sem foto. */
  imagens: string[];
}

function contagem(fotos: number, videos: number): string {
  const partes: string[] = [];
  if (fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
  if (videos) partes.push(`${videos} ${videos === 1 ? "vídeo" : "vídeos"}`);
  return partes.join(" · ") || "vazia";
}

export function GaleriaPastas({
  pastas,
  aparencia,
  permiteDownload,
}: {
  pastas: PastaDaEntrega[];
  aparencia: Aparencia;
  permiteDownload: boolean;
}) {
  const fonteTitulo = FONTES_TITULO[aparencia.tipografia];
  const peso = pesoDoTitulo(aparencia.tipografia, aparencia.peso);
  const detalhe = fonteDoDetalhe(aparencia);
  const alinhamento = aparencia.alinhamento === "esquerda" ? "text-left" : "text-center";

  return (
    <section aria-label="Pastas" className="mx-auto max-w-[1200px] pt-12 sm:pt-16">
      {/*
        O `--i` de cada pasta atrasa a entrada dela em 60 ms: as pastas chegam
        uma depois da outra, como cópias postas na mesa. Quem pediu menos
        movimento no sistema recebe tudo parado — ver o `motion-reduce`.
      */}
      <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-8 sm:gap-y-14 lg:grid-cols-3">
        {pastas.map((p, i) => (
          <li
            key={p.id}
            className="pasta-entra motion-reduce:animate-none"
            style={{ ["--i" as string]: i }}
          >
            <Link
              href={p.href}
              className="group block rounded-[var(--g-canto,6px)] outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
              style={{ ["--tw-ring-color" as string]: "var(--g-destaque)", ["--tw-ring-offset-color" as string]: "var(--g-fundo)" }}
            >
              <div className="relative mx-auto aspect-[4/5] w-[86%]">
                {/* As duas de trás. Sem foto, a borda vira papel da cor da
                    superfície — a pilha continua dizendo "tem coisa aqui". */}
                {[2, 1].map((camada) => {
                  const src = p.imagens[camada];
                  const giro = camada === 2 ? "-rotate-[5deg] group-hover:-rotate-[11deg] group-hover:-translate-x-[9%]" : "rotate-[4deg] group-hover:rotate-[10deg] group-hover:translate-x-[9%]";
                  return (
                    <span
                      key={camada}
                      aria-hidden
                      className={`absolute inset-0 overflow-hidden rounded-[var(--g-canto,6px)] shadow-[0_10px_30px_-12px_rgba(0,0,0,.45)] transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none ${giro}`}
                      style={{ background: "var(--g-superficie)", border: "1px solid var(--g-linha)" }}
                    >
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém, fora do otimizador do Next
                        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-90" />
                      )}
                    </span>
                  );
                })}
                <span
                  className="absolute inset-0 overflow-hidden rounded-[var(--g-canto,6px)] shadow-[0_18px_40px_-14px_rgba(0,0,0,.55)] transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:-translate-y-[3%] group-hover:scale-[1.02] motion-reduce:transition-none"
                  style={{ background: "var(--g-superficie)" }}
                >
                  {p.imagens[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém, fora do otimizador do Next
                    <img
                      src={p.imagens[0]}
                      alt=""
                      loading={i < 4 ? "eager" : "lazy"}
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-3xl" style={{ color: "var(--g-tenue)" }}>
                      ▶
                    </span>
                  )}
                </span>
              </div>

              <div className={`mt-6 px-1 ${alinhamento}`}>
                <span
                  className={`block text-[11px] uppercase tracking-[0.2em] ${detalhe ? "" : "font-mono"}`}
                  style={{ color: "var(--g-tenue)", ...(detalhe ? { fontFamily: detalhe } : {}) }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="mt-1 block text-xl leading-tight sm:text-2xl"
                  style={{ fontFamily: fonteTitulo, fontWeight: peso, color: "var(--g-texto)" }}
                >
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
