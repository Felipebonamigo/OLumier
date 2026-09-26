import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { resolverEstudio } from "@/lib/endereco";
import { marca } from "@/config/marca";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { iconeDoEstudio } from "@/lib/icone-do-estudio";
import {
  buscarEstudio,
  enderecoDaVitrine,
  galeriaDoTopo,
  galeriasDaVitrine,
} from "@/lib/vitrine";
import { urlDeLeitura } from "@/lib/r2";
import { FONTES_TITULO, TEMAS } from "@/config/aparencia";
import {
  lerSite,
  paragrafos,
  rotuloDaSecao,
  secoesComConteudo,
  urlDoInstagram,
  urlDoWhatsapp,
  type Secao,
  type Site,
} from "@/lib/site-estudio";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ estudio: string }> };

/**
 * A raiz do subdomínio do estúdio (siriusfotografia.olumier.com.br).
 *
 * Duas páginas em uma, e a diferença é só quanto o fotógrafo escreveu:
 *
 *  - sem conteúdo (o padrão, e como esta página nasceu) é a lista de galerias
 *    públicas, com um cabeçalho e nada mais;
 *  - com o site ligado no painel, vira a vitrine inteira — capa, sobre,
 *    galerias, depoimentos e contato — que é o que o concorrente vende como
 *    produto separado.
 *
 * Não há um `if` de "layout novo/antigo" em lugar nenhum: as seções vazias
 * simplesmente não entram em `secoesComConteudo`, e o resultado de um site em
 * branco é exatamente a página de antes. Um segundo layout envelheceria sem
 * ninguém olhar.
 *
 * Mostra só as galerias PÚBLICAS e sem senha. Galeria protegida não aparece
 * aqui: listá-la entregaria a existência da entrega de um casal para qualquer
 * visitante, e a senha existe justamente para isso não acontecer.
 */

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);
  if (!t) return { title: "Estúdio" };
  const site = lerSite(t.site);
  // A frase da capa é o que o fotógrafo escolheu dizer primeiro — serve melhor
  // como resumo no Google e no WhatsApp que um texto genérico nosso.
  const descricao = site.frase || `Galerias de ${t.nome_estudio}`;
  const endereco = `${enderecoDaVitrine(t)}/`;

  /*
   * ── A VITRINE ANUNCIAVA A PLATAFORMA (26/09/2026) ───────────────────────
   *
   * Este bloco definia só `title` e `description`. O resto vinha do layout
   * raiz, e o Next herda o `openGraph` INTEIRO quando a página não tem o dela:
   * o fotógrafo punha o endereço do site no Instagram e o cartão dizia "Galeria
   * Átomo — Onde o instante permanece", com a nossa imagem e o `og:url` da
   * nossa home. É o defeito que a galeria teve até 06/09/2026, na página que
   * existe para o casal ACHAR o fotógrafo.
   *
   * E o `title` passava pelo modelo do layout (`%s · Galeria Átomo`): a aba e o
   * resultado de busca do estúdio terminavam no nome do fornecedor dele.
   * `absolute` pula o modelo.
   *
   * A imagem do cartão é a do `opengraph-image.tsx` ao lado — por isso o bloco
   * abaixo não declara `images`: declarar faria o Next ignorar o arquivo.
   */
  return {
    title: { absolute: t.nome_estudio },
    description: descricao,
    alternates: { canonical: endereco },
    openGraph: {
      type: "website",
      siteName: t.nome_estudio,
      locale: "pt_BR",
      url: endereco,
      title: t.nome_estudio,
      description: descricao,
    },
    twitter: { card: "summary_large_image", title: t.nome_estudio, description: descricao },
    icons: await iconeDoEstudio(t.logo_chave),
  };
}

export default async function EstudioPage({ params }: Props) {
  const { estudio } = await params;
  const t = await buscarEstudio(estudio);

  /*
   * Endereço antigo do estúdio ainda abre — mesma regra da galeria (migração
   * 025). A vitrine é o endereço que o fotógrafo põe no Instagram, e link de
   * perfil fica lá por anos: quebrá-lo numa troca de endereço apagaria o
   * caminho pelo qual os clientes dele chegam.
   *
   * `generateMetadata` acima NÃO precisa disto: quando o redirecionamento
   * acontece, o Next descarta a resposta e refaz tudo no endereço novo.
   */
  if (!t) {
    const dono = await resolverEstudio(estudio);
    if (dono?.ehAntigo) permanentRedirect(`/e/${dono.slugAtual}`);
    notFound();
  }

  const site = lerSite(t.site);

  const galerias = await galeriasDaVitrine(t.id);

  const comCapa = await Promise.all(
    galerias.map(async (g) => ({
      ...g,
      urlCapa: g.capa_original
        ? await urlDaDerivada(g.capa_thumb, g.capa_original, armazemDe(g.capa_armazem), 6 * 3600)
        : null,
    })),
  );

  const heroGaleria = galeriaDoTopo(galerias, site);

  const urlHero = heroGaleria?.capa_original
    ? await urlDaDerivada(
        heroGaleria.capa_preview ?? heroGaleria.capa_thumb,
        heroGaleria.capa_original,
        armazemDe(heroGaleria.capa_armazem),
        6 * 3600,
      )
    : null;

  // O bucket não tem endereço público: a logo é chave, e ganha link assinado a
  // cada render.
  const urlLogo = t.logo_chave ? await urlDeLeitura(t.logo_chave, 6 * 3600) : null;

  /*
   * `ligado` é o mesmo contrato de `publicada` na galeria: o fotógrafo escreve
   * em paz e decide quando o mundo vê. Enquanto está desligado, o que existe é
   * a capa e as galerias — o site de antes.
   */
  const secoes: Secao[] = site.ligado ? secoesComConteudo(site) : ["capa", "galerias"];
  const fonteTitulo = FONTES_TITULO[site.tipografia];

  return (
    <main
      className="min-h-dvh"
      style={{ ...TEMAS[site.tema], background: "var(--g-fundo)", color: "var(--g-texto)" }}
    >
      {secoes.length > 2 && (
        <Menu secoes={secoes} site={site} cor={t.cor_destaque} fonteTitulo={fonteTitulo} />
      )}

      <Capa
        nome={t.nome_estudio}
        urlLogo={urlLogo}
        urlHero={urlHero}
        site={site}
        cor={t.cor_destaque}
        fonteTitulo={fonteTitulo}
      />

      {secoes.includes("sobre") && (
        <Sobre site={site} cor={t.cor_destaque} fonteTitulo={fonteTitulo} />
      )}

      <Galerias galerias={comCapa} fonteTitulo={fonteTitulo} cor={t.cor_destaque} />

      {secoes.includes("depoimentos") && (
        <Depoimentos site={site} cor={t.cor_destaque} fonteTitulo={fonteTitulo} />
      )}

      {secoes.includes("contato") && (
        <Contato site={site} cor={t.cor_destaque} fonteTitulo={fonteTitulo} />
      )}

      <footer className="px-6 pb-16 pt-8 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-tenue)" }}
        >
          entregue com {marca.nome}
        </span>
      </footer>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Menu de âncoras, fixo no topo.
 *
 * Âncoras e não páginas separadas: a referência que o fotógrafo conhece tem
 * três páginas, e duas delas cabem em dois parágrafos — abrir uma navegação
 * inteira para isso faz a casa parecer vazia. Rolando, o conteúdo curto vira
 * ritmo em vez de página em branco.
 *
 * Só aparece quando há mais que capa e galerias: um menu com dois itens que
 * levam ao topo e ao meio da mesma tela é ruído.
 */
function Menu({
  secoes,
  site,
  cor,
  fonteTitulo,
}: {
  secoes: Secao[];
  site: Site;
  cor: string;
  fonteTitulo: string;
}) {
  return (
    <nav
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        background: "color-mix(in srgb, var(--g-fundo) 82%, transparent)",
        borderBottom: "1px solid var(--g-linha)",
      }}
    >
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-7 gap-y-1 px-4 py-3.5">
        {secoes.map((s) => (
          <li key={s}>
            {/*
              A cor do estúdio entra como variável e só é usada no hover — é o
              único lugar do menu onde ela cabe sem competir com as fotos. Cor
              base por CLASSE, não por `style`: um `color` inline venceria o
              `hover:` por especificidade e o efeito não aconteceria.
            */}
            <a
              href={`#${s}`}
              className="text-[11px] uppercase tracking-[0.2em] text-[var(--g-suave)] transition-colors hover:text-[var(--c-estudio)]"
              style={{ ["--c-estudio" as string]: cor, fontFamily: fonteTitulo }}
            >
              {rotuloDaSecao(s, site)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A capa. Com foto ocupa quase a tela inteira; sem foto vira capa tipográfica.
 *
 * O degradê no rodapé da foto não é enfeite: o nome do estúdio pousa em cima da
 * imagem, e sem ele o texto fica ilegível exatamente nas fotos claras — que são
 * a maioria em casamento (vestido branco, luz de dia).
 */
function Capa({
  nome,
  urlLogo,
  urlHero,
  site,
  cor,
  fonteTitulo,
}: {
  nome: string;
  urlLogo: string | null;
  urlHero: string | null;
  site: Site;
  cor: string;
  fonteTitulo: string;
}) {
  const identidade = (
    <>
      {site.selo && (
        <span
          className="mb-7 inline-block rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em]"
          style={{ border: `1px solid ${cor}`, color: cor }}
        >
          {site.selo}
        </span>
      )}

      {/*
        O `<h1>` envolve a logo TAMBÉM, e não só o nome escrito.

        Enquanto foram dois caminhos — `<img>` de um lado, `<h1>` do outro —,
        todo estúdio que enviou logo tinha a sua página pública sem `<h1>`
        nenhum: sem o título que o buscador lê primeiro, e sem cabeçalho para um
        leitor de tela anunciar. Justamente a página que existe para o casal
        ACHAR o fotógrafo. Não dava para ver lendo o código, só contando as tags
        do HTML pronto — ver `scripts/testar-vitrine.mjs`.
      */}
      <h1
        className={
          urlLogo ? "" : "text-[clamp(2.25rem,7vw,4.75rem)] font-medium leading-[1.05] tracking-tight"
        }
        style={urlLogo ? undefined : { fontFamily: fonteTitulo }}
      >
        {urlLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
          <img
            src={urlLogo}
            alt={nome}
            className="mx-auto max-h-24 w-auto max-w-[min(20rem,80vw)] object-contain"
          />
        ) : (
          nome
        )}
      </h1>

      {site.frase && (
        <p
          className="mx-auto mt-6 max-w-xl text-[clamp(1rem,2.2vw,1.35rem)] leading-relaxed"
          style={{ color: urlHero ? "rgba(255,255,255,.88)" : "var(--g-suave)" }}
        >
          {site.frase}
        </p>
      )}
    </>
  );

  if (!urlHero) {
    return (
      <header id="capa" className="px-6 py-24 text-center sm:py-32">
        {identidade}
        <div
          className="mx-auto mt-12 h-px w-16"
          style={{ background: "var(--g-linha)" }}
          aria-hidden
        />
      </header>
    );
  }

  return (
    <header id="capa" className="relative flex min-h-[34rem] items-end justify-center">
      <div className="absolute inset-0 h-[88vh] min-h-[34rem]">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
        <img src={urlHero} alt="" className="h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,.34) 0%, rgba(0,0,0,.05) 38%, rgba(0,0,0,.72) 100%)",
          }}
        />
      </div>

      <div className="relative h-[88vh] min-h-[34rem] w-full">
        <div className="absolute inset-x-0 bottom-0 px-6 pb-20 text-center text-white sm:pb-24">
          {identidade}
        </div>
      </div>
    </header>
  );
}

/** Rótulo pequeno que abre cada seção. Repetido em três lugares, então mora aqui. */
function TituloDeSecao({
  children,
  cor,
  fonteTitulo,
}: {
  children: React.ReactNode;
  cor: string;
  fonteTitulo: string;
}) {
  return (
    <h2
      className="text-center font-mono text-[10px] uppercase tracking-[0.28em]"
      style={{ color: cor, fontFamily: fonteTitulo }}
    >
      {children}
    </h2>
  );
}

function Sobre({ site, cor, fonteTitulo }: { site: Site; cor: string; fonteTitulo: string }) {
  const textos = paragrafos(site.sobre);

  return (
    <section id="sobre" className="mx-auto max-w-2xl scroll-mt-16 px-6 py-24 sm:py-32">
      <TituloDeSecao cor={cor} fonteTitulo={fonteTitulo}>
        {site.sobreTitulo}
      </TituloDeSecao>

      {textos.length > 0 && (
        <div className="mt-10 space-y-6 text-[1.0625rem] leading-[1.85]" style={{ color: "var(--g-suave)" }}>
          {textos.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {site.citacao && (
        <blockquote
          className="mt-16 border-t pt-14 text-center"
          style={{ borderColor: "var(--g-linha)" }}
        >
          <p
            className="text-[clamp(1.25rem,3vw,1.75rem)] italic leading-snug"
            style={{ fontFamily: fonteTitulo }}
          >
            {/* Aspas desenhadas aqui e não digitadas pelo fotógrafo: metade das
                pessoas escreve com aspas, metade sem, e o resultado ficaria
                desalinhado entre um estúdio e outro. */}
            &ldquo;{site.citacao}&rdquo;
          </p>
          {site.citacaoAutor && (
            <cite
              className="mt-5 block font-mono text-[11px] not-italic uppercase tracking-[0.18em]"
              style={{ color: "var(--g-tenue)" }}
            >
              — {site.citacaoAutor}
            </cite>
          )}
        </blockquote>
      )}
    </section>
  );
}

function Galerias({
  galerias,
  cor,
  fonteTitulo,
}: {
  galerias: { slug: string; titulo: string; subtitulo: string | null; data_evento: Date | null; urlCapa: string | null }[];
  cor: string;
  fonteTitulo: string;
}) {
  return (
    <section id="galerias" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
      <TituloDeSecao cor={cor} fonteTitulo={fonteTitulo}>
        Galerias
      </TituloDeSecao>

      {galerias.length === 0 ? (
        <p className="mt-10 text-center text-sm" style={{ color: "var(--g-suave)" }}>
          Nenhuma galeria pública no momento.
        </p>
      ) : (
        <ul className="mt-12 grid gap-x-5 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">
          {galerias.map((g) => (
            <li key={g.slug}>
              <a href={`/${g.slug}`} className="group block">
                <span
                  className="block aspect-[3/4] overflow-hidden rounded-md"
                  style={{ background: "var(--g-superficie)" }}
                >
                  {g.urlCapa && (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                    <img
                      src={g.urlCapa}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-[900ms] ease-out group-hover:scale-[1.04]"
                    />
                  )}
                </span>
                <span
                  className="mt-4 block text-xl leading-tight"
                  style={{ fontFamily: fonteTitulo }}
                >
                  {g.titulo}
                </span>
                <span
                  className="mt-1 block font-mono text-[10px] uppercase tracking-[0.16em]"
                  style={{ color: "var(--g-tenue)" }}
                >
                  {[
                    g.data_evento
                      ? new Date(g.data_evento).toLocaleDateString("pt-BR", {
                          month: "long",
                          year: "numeric",
                        })
                      : null,
                    g.subtitulo,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Depoimentos em colunas de altura livre.
 *
 * `columns` e não `grid`: os textos têm tamanhos muito diferentes (de uma linha
 * a um parágrafo inteiro), e numa grade todos os cartões de uma fileira ficam
 * da altura do maior — o que enche a tela de espaço vazio embaixo dos curtos.
 */
function Depoimentos({ site, cor, fonteTitulo }: { site: Site; cor: string; fonteTitulo: string }) {
  return (
    <section
      id="depoimentos"
      className="scroll-mt-16 py-24 sm:py-32"
      style={{ background: "var(--g-superficie)" }}
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <TituloDeSecao cor={cor} fonteTitulo={fonteTitulo}>
          {site.depoimentosTitulo}
        </TituloDeSecao>

        <div className="mt-12 gap-6 sm:columns-2 lg:columns-3 [&>*]:mb-6">
          {site.depoimentos.map((d, i) => (
            <figure
              key={i}
              className="break-inside-avoid rounded-lg p-6"
              style={{ background: "var(--g-fundo)", border: "1px solid var(--g-linha)" }}
            >
              <blockquote className="text-[0.9375rem] leading-[1.75]" style={{ color: "var(--g-suave)" }}>
                &ldquo;{d.texto}&rdquo;
              </blockquote>
              {d.autor && (
                <figcaption
                  className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em]"
                  style={{ color: cor }}
                >
                  {d.autor}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Contato.
 *
 * Os endereços são MONTADOS a partir do que está guardado (dígitos, usuário),
 * nunca ecoados — ver o comentário em `src/lib/site-estudio.ts`. `urlDoWhatsapp`
 * e `urlDoInstagram` devolvem null para qualquer coisa fora do formato, e o
 * botão simplesmente não aparece.
 */
function Contato({ site, cor, fonteTitulo }: { site: Site; cor: string; fonteTitulo: string }) {
  const whatsapp = urlDoWhatsapp(site.whatsapp);
  const instagram = urlDoInstagram(site.instagram);
  const textos = paragrafos(site.contatoTexto);

  return (
    <section id="contato" className="mx-auto max-w-2xl scroll-mt-16 px-6 py-24 text-center sm:py-32">
      <TituloDeSecao cor={cor} fonteTitulo={fonteTitulo}>
        {site.contatoTitulo}
      </TituloDeSecao>

      {textos.length > 0 && (
        <div className="mt-10 space-y-5 text-[1.0625rem] leading-[1.8]" style={{ color: "var(--g-suave)" }}>
          {textos.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: cor, color: "var(--g-sobre-destaque)" }}
          >
            Falar no WhatsApp
          </a>
        )}
        {instagram && (
          <a
            href={instagram}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full px-6 py-3 text-sm transition-colors"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
          >
            @{site.instagram}
          </a>
        )}
        {site.email && (
          <a
            href={`mailto:${site.email}`}
            className="rounded-full px-6 py-3 text-sm transition-colors"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
          >
            {site.email}
          </a>
        )}
      </div>
    </section>
  );
}
