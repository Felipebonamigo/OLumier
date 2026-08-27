/* eslint-disable @next/next/no-img-element -- página institucional: as fotos
 * são estáticas de /public, servidas como estão; o pipeline do next/image
 * adicionaria processamento e config para zero ganho aqui. */
import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { MontadorPlano } from "@/components/montador-plano";
import { MarcaTile, SeloBeta } from "@/components/marca-tile";
import { SeletorTema } from "@/components/seletor-tema";
import { TEMAS } from "@/config/aparencia";
import { Revelar } from "@/components/revelar";
import { ESPACOS, formatarGb } from "@/config/planos";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";

export const metadata: Metadata = {
  title: `${marca.nome} — ${marca.tagline}`,
};

/*
 * A página conta uma história em cinco atos: a promessa (hero, escuro), o
 * caminho (três gestos), o resultado na mão do casal (a seção clara — a luz
 * chega), a ferramenta do estúdio e o preço.
 *
 * ── A LINGUAGEM VISUAL: CINEMATOGRÁFICA (27/08/2026) ──────────────────────
 *
 * Quarta linguagem, e desta vez a decisão veio do dono: "site para fotógrafos,
 * eles contam muito com a beleza do sistema". As três anteriores tentaram
 * contar fotografia SEM fotografia — bento de cartões, tipografia austera,
 * objetos desenhados em CSS — e todas esbarraram no mesmo teto: numa página
 * para quem vive de olhar, gradiente fingindo ser foto é a primeira coisa que
 * o olho denuncia.
 *
 * O que vale agora:
 *
 *   · FOTOGRAFIA DE VERDADE carrega a página. Oito fotos de casamento
 *     (Unsplash, licença livre para uso comercial, em /public/home) — o hero
 *     em contraluz dourada foi escolhido porque a luz da foto é da mesma
 *     família do âmbar da marca: a página abre literalmente com "sua luz".
 *   · VIDRO E LUZ por cima: cabeçalho e cartões em .vidro (desfoque real de
 *     navegador, não simulado), overlays de gradiente sobre as fotos.
 *   · BOTÃO É PÍLULA. O retângulo seco morreu por veredito do dono ("botões
 *     quadrados"). O CTA âmbar ganha sombra da própria cor — luz, não borda.
 *   · A ESTEIRA: uma banda de fotos rolando devagar sob o hero, como a mesa
 *     de seleção de um estúdio. Pausa no hover, congela em reduced-motion.
 *
 * O que NÃO existe aqui, por honestidade: barra de logos de clientes e
 * depoimentos. O produto tem zero estúdios pagantes hoje — logo inventado e
 * depoimento inventado são mentira com tipografia bonita. Quando o Sirius e a
 * Carol estiverem usando de verdade, esta página ganha as palavras deles.
 */

/*
 * As três perguntas da seção de comparação.
 *
 * Os tamanhos saem de `ESPACOS`, nunca da mão de quem escreve o texto: se a
 * grade ganhar um degrau embaixo, a frase acompanha em vez de virar mentira
 * calada. É o mesmo motivo de `testar-comparativo.mjs` conferir que o número
 * escrito na página é o número da grade.
 */
const MENOR_ESPACO = ESPACOS[0];
const MAIOR_ESPACO = ESPACOS[ESPACOS.length - 1];

/*
 * A FAQ.
 *
 * Regra de conteúdo, a mesma da página de segurança: só entra o que EXISTE e
 * está ligado. Cada resposta abaixo foi conferida contra o comportamento real —
 * a lixeira segura 30 dias porque `PRAZO_LIXEIRA_DIAS` diz 30, e cancelar não
 * apaga entrega porque `cancelarAssinaturaAction` não apaga.
 *
 * Feita com <details>/<summary> nativos, e não com estado do React: abre sem
 * JavaScript, entra no Ctrl+F do navegador (que é como muita gente procura
 * resposta) e não custa um byte de script. É o degrau da escada em que o
 * recurso da plataforma já resolve.
 */
const FAQ: { pergunta: string; resposta: React.ReactNode }[] = [
  {
    pergunta: "Preciso pagar para testar?",
    resposta: (
      <>
        Não. São <strong>14 dias grátis e sem cartão</strong> — você cria a conta, sobe uma entrega
        de verdade e vê o cliente abrindo o link antes de decidir qualquer coisa.
      </>
    ),
  },
  {
    pergunta: "Meu cliente precisa criar conta ou instalar alguma coisa?",
    resposta: (
      <>
        Não. Ele recebe <strong>um link</strong> e abre — no celular, no computador, sem cadastro e
        sem aplicativo. Se você quiser, o link também pede uma senha que só você define.
      </>
    ),
  },
  {
    pergunta: "O que acontece quando o prazo da galeria termina?",
    resposta: (
      <>
        Ela desce para o <strong>cofre</strong>: o link para de abrir para o cliente e{" "}
        <strong>nenhum arquivo é apagado</strong>. Um clique traz de volta, com o mesmo endereço.
        Guardar no cofre não custa a mais — é o mesmo espaço do plano.
      </>
    ),
  },
  {
    pergunta: "Apaguei uma galeria sem querer. Perdi tudo?",
    resposta: (
      <>
        Não. Ela vai para a lixeira e fica lá por <strong>{PRAZO_LIXEIRA_DIAS} dias</strong>, com os
        arquivos intactos no armazenamento. Restaurar devolve as mesmas fotos, o mesmo filme e os
        mesmos capítulos — e ela volta como rascunho, para o link do cliente não reabrir sozinho.
      </>
    ),
  },
  {
    pergunta: "Filme custa mais caro que foto?",
    resposta: (
      <>
        Não. Vídeo aqui é <strong>só espaço</strong>, igual à foto: sem cobrança por hora de vídeo e
        sem teto de resolução. Se o seu 4K couber no plano, ele sobe.
      </>
    ),
  },
  {
    pergunta: "Posso cancelar quando quiser?",
    resposta: (
      <>
        Pode, pelo próprio painel. <strong>O que você já entregou continua no ar</strong> — o que
        para é o envio de coisa nova. Apagar o casamento de um casal por causa de um cancelamento do
        fotógrafo seria punir quem não decidiu nada.
      </>
    ),
  },
  {
    pergunta: "Onde as fotos ficam guardadas?",
    resposta: (
      <>
        Em armazenamento profissional, com trava contra exclusão e backup diário do cadastro. Está
        tudo escrito, sem marketing, na <Link href="/seguranca">página de segurança</Link> —
        inclusive o que ainda <em>não</em> temos.
      </>
    ),
  },
];

const PERGUNTAS = [
  {
    pergunta: "Quanto cabe, no total?",
    aqui: `De ${formatarGb(MENOR_ESPACO.gb)} a ${formatarGb(MAIOR_ESPACO.gb)} — e o número é seu, não do pacote.`,
    olhar:
      "Onde o espaço vem embutido num plano, o teto costuma estar na casa das dezenas de GB. Um casamento fotografado e filmado passa disso sozinho, e teto não se compra separado: quando enche, a saída é mudar de serviço no meio da temporada.",
  },
  {
    pergunta: "A senha tranca a página ou o arquivo?",
    aqui: "O arquivo. Todo endereço é assinado e expira sozinho; o armazenamento não expõe nada.",
    olhar:
      "Dá para conferir em dez segundos, aqui ou em qualquer concorrente: abra uma foto da galeria numa aba anônima. Se ela carregar sem a senha, a senha trancava a porta — e o endereço da foto continua valendo depois que a entrega acabou.",
  },
  {
    pergunta: "O filme conta como o quê?",
    aqui: "Como espaço, igual à foto. Sem adicional por hora de vídeo e sem teto de resolução.",
    olhar:
      "É comum o vídeo ser cobrado por hora, à parte do espaço, e entregue só em HD. Para quem filma casamento em 4K, essa linha decide o preço do ano inteiro — e costuma aparecer depois da assinatura.",
  },
];

/* A ficha técnica do hero: o produto em seis células. Os números saem da grade
 * real (`ESPACOS`) — se ela mudar, a ficha acompanha sozinha. */
const FICHA: [string, string][] = [
  ["mídia", "foto e filme 4K"],
  ["espaço", `${formatarGb(MENOR_ESPACO.gb)} a ${formatarGb(MAIOR_ESPACO.gb)}`],
  ["downloads", "sem limite"],
  ["álbum", "escolha com trava"],
  ["endereço", "seu, com sua marca"],
  ["teste", "14 dias, sem cartão"],
];

/*
 * A esteira de fotos, com o nome do arquivo dizendo o CONTEÚDO conferido a
 * olho (o nome de download nem sempre dizia): cada uma foi aberta e olhada
 * antes de entrar. Proporções misturadas de propósito — é o que faz ler como
 * mesa de seleção e não como grade de miniaturas.
 */
const ESTEIRA: { src: string; alta?: boolean }[] = [
  { src: "/home/noivos-beijo.jpg", alta: true },
  { src: "/home/maos-alianca.jpg" },
  { src: "/home/noiva-retrato.jpg", alta: true },
  { src: "/home/festa-mesa.jpg" },
  { src: "/home/vestido.jpg", alta: true },
  { src: "/home/madrinhas.jpg" },
  { src: "/home/cerimonia-arco.jpg" },
];

/* O botão de ação: pílula âmbar com sombra da própria cor — luz, não borda.
 * O retângulo seco da versão anterior saiu por veredito do dono. */
const CTA =
  "inline-block rounded-full bg-acento px-8 py-3.5 font-semibold text-void shadow-[0_10px_36px_-8px_var(--acento)] transition hover:-translate-y-0.5 hover:bg-acento-alto";
const CTA_FANTASMA =
  "inline-block rounded-full border border-linha-forte px-8 py-3.5 font-medium text-texto transition hover:border-texto-faint hover:bg-carbon/60";

/* O marcador de seção: número de série + fio + rótulo. O número existe porque
 * a página é uma sequência; seção sem posição na história usa a variante sem
 * número. */
function Marcador({ n, rotulo, claro = false }: { n?: string; rotulo: string; claro?: boolean }) {
  return (
    <p
      className={`flex items-center gap-4 text-[13px] tracking-wide ${
        claro ? "text-tinta-faint" : "text-texto-faint"
      }`}
    >
      {n && (
        <span
          className={`font-serif text-base font-semibold tabular-nums ${
            claro ? "text-ouro-tinta" : "text-acento"
          }`}
        >
          {n}
        </span>
      )}
      <span className={`h-px w-10 ${claro ? "bg-tinta/25" : "bg-linha-forte"}`} aria-hidden />
      {rotulo}
    </p>
  );
}

export default function Home() {
  return (
    <main className="overflow-x-clip">
      {/* ── cabeçalho: flutua sobre a foto do hero, e SÓ sobre ela ────────
          Fixo foi tentado e descartado: ao rolar, o vidro escuro virava uma
          barra opaca tapando a seção clara. O overlay do topo do hero já dá
          o contraste que os links precisam. */}
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-3">
            <MarcaTile tamanho={34} />
            <span className="font-serif text-xl font-bold tracking-tight">{marca.nome}</span>
            <SeloBeta />
          </span>
          <nav className="flex items-center gap-4 text-sm sm:gap-5">
            <SeletorTema />
            <Link href="/entrar" className="text-texto-soft transition hover:text-texto">
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="rounded-full bg-acento px-5 py-2 font-medium text-void shadow-[0_6px_24px_-6px_var(--acento)] transition hover:-translate-y-0.5 hover:bg-acento-alto"
            >
              Criar conta
            </Link>
          </nav>
        </div>
      </header>

      {/* ── ato 1: a promessa — a foto É o hero ──────────────────────────
          Contraluz dourada de fim de tarde: a luz da foto é da mesma família
          do âmbar da marca, então a página abre com "sua luz" duas vezes — no
          título e na imagem. O overlay escurece de baixo para cima para o
          texto assentar sem roubar a foto. */}
      <section className="relative isolate flex min-h-[100svh] items-end">
        <img
          src="/home/hero-casamento.jpg"
          alt="Casal em contraluz dourada segurando o buquê"
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          fetchPriority="high"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,var(--void)_4%,color-mix(in_srgb,var(--void)_62%,transparent)_38%,color-mix(in_srgb,var(--void)_18%,transparent)_70%,color-mix(in_srgb,var(--void)_40%,transparent)_100%)]"
          aria-hidden
        />

        <div className="mx-auto w-full max-w-6xl px-6 pb-16 pt-40">
          <p className="text-[13px] tracking-[0.22em] text-texto-soft uppercase">
            Galerias de entrega para fotógrafos e filmakers
          </p>
          <h1 className="mt-5 font-serif text-6xl font-bold leading-[0.98] tracking-tight sm:text-8xl">
            Sua luz,
            <br />
            <span className="text-acento-alto">entregue.</span>
          </h1>
          <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-texto sm:text-xl">
            O dia passa, as fotos ficam. {marca.nome} é o lugar onde elas chegam ao casal: com a
            sua marca, no seu endereço, direto na galeria do celular deles.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/cadastrar" className={CTA}>
              Começar grátis
            </Link>
            <Link href="#planos" className={CTA_FANTASMA}>
              Ver planos
            </Link>
          </div>

          {/* A ficha técnica em vidro, flutuando sobre o pé da foto. */}
          <dl className="vidro mt-14 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl sm:grid-cols-3 lg:grid-cols-6">
            {FICHA.map(([rotulo, valor]) => (
              <div key={rotulo} className="px-4 py-3">
                <dt className="text-[11px] tracking-wide text-texto-faint">{rotulo}</dt>
                <dd className="mt-0.5 text-sm text-texto">{valor}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── a esteira: a mesa de seleção do estúdio ──────────────────────
          Fotos de verdade passando devagar. `aria-hidden` porque é atmosfera:
          quem navega por leitor de tela não perde conteúdo nenhum aqui. */}
      <section className="overflow-hidden border-y border-linha bg-carbon/40 py-6" aria-hidden>
        <div className="esteira flex w-max gap-4">
          {[...ESTEIRA, ...ESTEIRA].map((f, i) => (
            <img
              key={i}
              src={f.src}
              alt=""
              loading="lazy"
              className={`${f.alta ? "aspect-[3/4]" : "aspect-[3/2]"} h-44 rounded-xl object-cover sm:h-56`}
            />
          ))}
        </div>
      </section>

      {/* ── ato 2: o caminho — coluna fixa à esquerda, gestos à direita ── */}
      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-28 lg:grid-cols-[2fr_3fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Marcador n="01" rotulo="Da pasta ao link" />
          <h2 className="mt-5 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
            Três gestos.
            <br />
            Nenhum deles é &ldquo;exportar de novo&rdquo;.
          </h2>
          <p className="mt-5 max-w-[36ch] text-texto-soft">
            Entregar não deveria ser a parte difícil do trabalho. Aqui ela cabe entre um café e o
            próximo ensaio.
          </p>
        </div>

        <ol>
          {[
            {
              n: "1",
              titulo: "Arraste a pasta do casamento",
              texto:
                "Centenas de fotos sobem em paralelo, direto do navegador — e as subpastas viram capítulos sozinhas: Making Of, Cerimônia, Festa, na ordem do dia. A conexão caiu? O envio retoma de onde parou, inclusive o filme de 30 GB.",
            },
            {
              n: "2",
              titulo: "Escolha a cara da entrega",
              texto:
                "Quatro estilos prontos ou a sua combinação: capa, cores, grade, espaçamento e nove fontes de título — cada uma mostrada nela mesma. A prévia já abre com fotos, para você decidir vendo, e a sua logo assina o topo.",
            },
            {
              n: "3",
              titulo: "Mande um link",
              texto: `seuestudio.${marca.dominio}/ana-pedro. Um endereço seu, não um link genérico de nuvem. Com senha, se você quiser; com prazo, se você definir.`,
            },
          ].map((g, i) => (
            <Revelar key={g.n} atraso={i * 90}>
              <li className="grid grid-cols-[3rem_1fr] border-t border-linha py-9 first:border-t-0">
                <span className="font-serif text-2xl font-semibold tabular-nums text-acento">
                  {g.n}.
                </span>
                <div>
                  <h3 className="font-serif text-2xl font-semibold tracking-tight">{g.titulo}</h3>
                  <p className="mt-3 max-w-[54ch] leading-relaxed text-texto-soft">{g.texto}</p>
                </div>
              </li>
            </Revelar>
          ))}
        </ol>
      </section>

      {/* ── ato 3: a luz chega — a ÚNICA seção clara da página ─────────── */}
      <section className="bg-marfim text-tinta">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <div className="grid items-center gap-14 lg:grid-cols-[6fr_5fr]">
            <Revelar>
              <Marcador n="02" rotulo="Do outro lado do link" claro />
              <h2 className="mt-5 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
                O casal abre no celular.
                <br />E fica tudo bem.
              </h2>
              <dl className="mt-9 divide-y divide-tinta/15 border-y border-tinta/15">
                {[
                  [
                    "Salvar de verdade",
                    "um toque e a foto cai no rolo do iPhone ou do Android — não no app “Arquivos”, onde ninguém acha depois.",
                  ],
                  [
                    "O filme junto das fotos",
                    "o casal assiste em 4K na própria galeria, com os capítulos do lado — sem link de nuvem perdido no e-mail.",
                  ],
                  [
                    "A escolha do álbum",
                    "eles marcam as favoritas com um coração, no celular de cada um, numa lista só — e a galeria conta e trava no número combinado.",
                  ],
                  [
                    "Sem limite",
                    "a galeria é deles. Baixam tudo, quantas vezes quiserem, na melhor resolução — sem custo extra pra você.",
                  ],
                ].map(([t, d]) => (
                  <div key={t} className="grid gap-1 py-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <dt className="font-semibold text-tinta">{t}</dt>
                    <dd className="text-tinta-suave">{d}</dd>
                  </div>
                ))}
              </dl>
            </Revelar>

            {/* O telefone, com fotos DE VERDADE dentro — a galeria como o casal
                vê. Papel é claro nos dois temas: cor fixa, como no físico. */}
            <Revelar atraso={120} className="justify-self-center">
              <div
                className="w-72 rounded-[2.4rem] border border-marfim-2 bg-white p-3 shadow-[0_44px_90px_-28px_rgba(42,35,24,0.45)]"
                aria-hidden
              >
                <div className="rounded-[1.8rem] bg-marfim px-4 pb-4 pt-5">
                  <p className="text-center font-script text-3xl text-tinta">Ana &amp; Pedro</p>
                  <p className="mt-1 text-center text-[8px] uppercase tracking-[0.22em] text-tinta-faint">
                    21 de março · Serra Gaúcha
                  </p>
                  <div className="mt-4 grid grid-cols-2 items-start gap-2">
                    <div className="grid gap-2">
                      <div className="relative">
                        <img
                          src="/home/noivos-beijo.jpg"
                          alt=""
                          loading="lazy"
                          className="w-full rounded-lg"
                        />
                        <span className="absolute right-1.5 top-1.5 text-xs text-erro drop-shadow">
                          ♥
                        </span>
                      </div>
                      <img
                        src="/home/maos-alianca.jpg"
                        alt=""
                        loading="lazy"
                        className="w-full rounded-lg"
                      />
                    </div>
                    <div className="grid gap-2">
                      <img
                        src="/home/noiva-retrato.jpg"
                        alt=""
                        loading="lazy"
                        className="w-full rounded-lg"
                      />
                      <img
                        src="/home/madrinhas.jpg"
                        alt=""
                        loading="lazy"
                        className="w-full rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-[10px] font-medium text-tinta-suave">
                    <span>♥ 12 de 40</span>
                    <span className="rounded-full bg-tinta px-4 py-1.5 font-semibold text-marfim">
                      Salvar as 347 fotos
                    </span>
                  </div>
                </div>
              </div>
            </Revelar>
          </div>
        </div>
      </section>

      {/* ── ato 3½: da escolha ao álbum — três cartões de vidro ─────────── */}
      <section className="border-b border-linha bg-carbon/40">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <Revelar>
            <Marcador n="03" rotulo="Da escolha ao álbum" />
            <h2 className="mt-5 max-w-[26ch] font-serif text-4xl font-bold tracking-tight sm:text-5xl">
              O álbum se escolhe na galeria. A lista chega pronta no Lightroom.
            </h2>
          </Revelar>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              {
                n: "1",
                titulo: "Você define o combinado",
                texto:
                  "O contrato diz 40 fotos? A galeria conta — “12 de 40” — e trava no teto: a 41ª pede para desmarcar uma. Com prazo, se você quiser: passou a data, a escolha fecha sozinha.",
              },
              {
                n: "2",
                titulo: "O casal fecha junto",
                texto:
                  "A lista é uma só: a noiva no celular e o noivo no notebook veem a mesma escolha. Quando terminam, eles encerram — e a lista trava, para o álbum não mudar depois de diagramado. Mudaram de ideia? Você reabre em um clique.",
              },
              {
                n: "3",
                titulo: "Os nomes caem no Lightroom",
                texto:
                  "Um botão copia os nomes dos arquivos, na ordem da galeria, prontos para colar no filtro do Lightroom. Sem planilha, sem print de WhatsApp, sem conferir foto por foto.",
              },
            ].map((p, i) => (
              <Revelar key={p.n} atraso={i * 90} className="h-full">
                <div className="vidro h-full rounded-2xl p-7">
                  <span className="font-serif text-3xl font-semibold tabular-nums text-acento">
                    {p.n}.
                  </span>
                  <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight">
                    {p.titulo}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-texto-soft">{p.texto}</p>
                </div>
              </Revelar>
            ))}
          </div>
        </div>
      </section>

      {/* ── ato 4: a ferramenta — índice de catálogo, linha a linha ────── */}
      <section className="mx-auto max-w-6xl px-6 py-28">
        <Revelar>
          <Marcador n="04" rotulo="Do seu lado do balcão" />
          <h2 className="mt-5 max-w-[24ch] font-serif text-4xl font-bold tracking-tight sm:text-5xl">
            O estúdio continua seu. Só o trabalho pesado muda de dono.
          </h2>
        </Revelar>

        <div className="mt-12 border-t border-linha">
          {/* Cofre — o verbete com figura: a linha do tempo da entrega */}
          <Revelar>
            <div className="grid gap-x-10 gap-y-2 border-b border-linha py-8 md:grid-cols-[15rem_1fr]">
              <h3 className="font-serif text-xl font-semibold tracking-tight">Cofre automático</h3>
              <div>
                <p className="max-w-[54ch] leading-relaxed text-texto-soft">
                  No prazo que você definir, a galeria sai do ar sozinha: o link fecha para o
                  cliente e <strong className="text-texto">nada é apagado</strong>. Fica guardada no
                  seu espaço, sem custar a mais, e reativar é um clique.
                </p>
                <div className="mt-5 max-w-sm" aria-hidden>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-acento" />
                    <span className="h-px flex-1 bg-gradient-to-r from-luz/60 to-linha" />
                    <span className="h-2 w-2 rounded-full border border-linha-forte" />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                    <span>no ar · 12 meses</span>
                    <span>guardado · pra sempre</span>
                  </div>
                </div>
              </div>
            </div>
          </Revelar>

          {/* Endereço — o domínio próprio entrou no ar em 26/08 */}
          <Revelar>
            <div className="grid gap-x-10 gap-y-2 border-b border-linha py-8 md:grid-cols-[15rem_1fr]">
              <h3 className="font-serif text-xl font-semibold tracking-tight">
                Seu endereço, sua marca
              </h3>
              <div>
                <p className="max-w-[54ch] leading-relaxed text-texto-soft">
                  Cada estúdio ganha um subdomínio próprio e cada galeria carrega a sua logo. E se
                  você já tem um domínio, aponte e use o seu: a prova de posse é por DNS e o
                  certificado sai sozinho.
                </p>
                <p className="mt-4 flex flex-wrap gap-2 font-mono text-xs" aria-hidden>
                  <code className="rounded-full border border-linha bg-void px-4 py-2 text-acento-alto">
                    seuestudio.{marca.dominio}
                  </code>
                  <code className="rounded-full border border-linha bg-void px-4 py-2 text-texto-soft">
                    www.seuestudio.com.br
                  </code>
                </p>
              </div>
            </div>
          </Revelar>

          {/* Aparência — as amostras saem de TEMAS, os temas de galeria de
              verdade: mostram o que o CASAL vê. */}
          <Revelar>
            <div className="grid gap-x-10 gap-y-2 border-b border-linha py-8 md:grid-cols-[15rem_1fr]">
              <h3 className="font-serif text-xl font-semibold tracking-tight">
                Quatro estilos, nove fontes
              </h3>
              <div>
                <p className="max-w-[54ch] leading-relaxed text-texto-soft">
                  Ou a sua combinação: capa, cores, grade e espaçamento — com a prévia abrindo já
                  com fotos, para decidir vendo.
                </p>
                <div className="mt-4 flex gap-2" aria-hidden>
                  {(["noite", "claro", "creme"] as const).map((t) => (
                    <span
                      key={t}
                      className="h-8 w-8 rounded-full ring-1 ring-linha-forte"
                      style={{ background: TEMAS[t]["--g-fundo"] }}
                    />
                  ))}
                  <span
                    className="h-8 w-8 rounded-full ring-1 ring-linha-forte"
                    style={{
                      background: `linear-gradient(135deg, ${TEMAS.noite["--g-destaque"]}, ${TEMAS.creme["--g-fundo"]})`,
                    }}
                  />
                </div>
              </div>
            </div>
          </Revelar>

          {/* Os verbetes curtos: dois por linha em tela larga, com o mesmo fio */}
          <div className="grid md:grid-cols-2 md:gap-x-14">
            {[
              {
                titulo: "Prova de entrega",
                texto: "Aberturas e downloads contados. “Não recebi” deixa de ser conversa.",
              },
              {
                titulo: `Lixeira de ${PRAZO_LIXEIRA_DIAS} dias`,
                texto:
                  "Apagou sem querer? Restaurar traz tudo de volta — fotos, filme, capítulos e a escolha do casal.",
              },
              {
                titulo: "API para o seu fluxo",
                texto:
                  "Crie galerias e envie arquivos por API, com chaves que nascem e morrem no seu painel.",
              },
              {
                titulo: "A vitrine do estúdio",
                texto:
                  "O mesmo endereço das entregas é o seu cartão de visita: capa, sobre, depoimentos e botão de WhatsApp — pronto para a bio, sem montar site em outro lugar.",
              },
            ].map((v) => (
              <Revelar key={v.titulo}>
                <div className="grid gap-x-6 gap-y-1 border-b border-linha py-7 sm:grid-cols-[11rem_1fr]">
                  <h3 className="font-semibold">{v.titulo}</h3>
                  <p className="text-sm leading-relaxed text-texto-soft">{v.texto}</p>
                </div>
              </Revelar>
            ))}
          </div>

          {/* Segurança — fecha o índice apontando para a página que assina */}
          <Revelar>
            <div className="grid gap-x-10 gap-y-2 border-b border-linha py-8 md:grid-cols-[15rem_1fr]">
              <h3 className="font-serif text-xl font-semibold tracking-tight">
                Guardado como coisa séria
              </h3>
              <p className="max-w-[54ch] leading-relaxed text-texto-soft">
                Senha por galeria, links assinados que expiram, backup diário com cópia fora do
                servidor — e restauração ensaiada, não prometida. Está tudo escrito, sem letra
                miúda, na{" "}
                <Link href="/seguranca" className="text-acento underline underline-offset-4">
                  página de segurança
                </Link>
                .
              </p>
            </div>
          </Revelar>
        </div>
      </section>

      {/* ── interlúdio cinematográfico: a foto respira entre ferramenta e
          preço. `bg-fixed` fica de fora de propósito — quebra no iOS; o
          parallax aqui é só a foto maior que a janela, presa pelo overflow. */}
      <section className="relative isolate overflow-hidden">
        <img
          src="/home/festa-mesa.jpg"
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,var(--void)_0%,color-mix(in_srgb,var(--void)_55%,transparent)_45%,var(--void)_100%)]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-36 text-center">
          <p className="mx-auto max-w-[24ch] text-balance font-serif text-4xl font-bold tracking-tight sm:text-5xl">
            O dia acontece uma vez. A entrega fica para sempre.
          </p>
        </div>
      </section>

      {/* ── ato 5: preço ───────────────────────────────────────────────── */}
      <section id="planos" className="scroll-mt-8 border-t border-linha bg-carbon/40">
        <div className="mx-auto max-w-6xl px-6 py-28">
          <Revelar>
            <div className="max-w-2xl">
              <Marcador n="05" rotulo="Planos" />
              <h2 className="mt-5 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
                Um número só: quanto espaço você quer
              </h2>
              <p className="mt-4 text-texto-soft">
                Sem pacote pronto pra caber à força, e sem segunda conta pra fazer. Galeria no ar e
                entrega guardada usam o mesmo espaço — arquivar não custa a mais.
              </p>
            </div>
          </Revelar>

          <Revelar>
            <div className="mt-12">
              <MontadorPlano />
            </div>
          </Revelar>

          {/* A objeção, respondida onde ela nasce — depois do preço. Ninguém é
              citado pelo nome: pacote de concorrente muda sem avisar, e a
              tabela envelheceria em silêncio. Toda linha da coluna "aqui" é
              sobre NÓS e presa por teste; a pergunta vale para qualquer
              galeria, a nossa inclusive. `testar-comparativo.mjs` prende. */}
          <Revelar>
            <div id="comparativo" className="mt-24 max-w-2xl scroll-mt-8">
              <Marcador rotulo="Antes de escolher" />
              <h2 className="mt-5 font-serif text-4xl font-bold tracking-tight">
                Três perguntas para fazer a qualquer galeria — a nossa inclusive
              </h2>
              <p className="mt-4 text-texto-soft">
                Pacote fechado quase sempre parece mais barato, e continua parecendo até a primeira
                entrega grande. Estas são as perguntas que mudam a conta.
              </p>
            </div>
          </Revelar>

          <ol className="mt-12 border-t border-linha">
            {PERGUNTAS.map((p, i) => (
              <Revelar key={p.pergunta} atraso={i * 90}>
                <li className="grid gap-x-10 gap-y-4 border-b border-linha py-8 md:grid-cols-[1.1fr_1fr]">
                  <div className="flex gap-4">
                    <span
                      aria-hidden
                      className="mt-1 font-serif text-xl font-semibold tabular-nums text-acento"
                    >
                      {i + 1}.
                    </span>
                    <h3 className="font-serif text-2xl font-semibold tracking-tight">
                      {p.pergunta}
                    </h3>
                  </div>

                  <div>
                    <p className="text-[13px] tracking-wide text-acento-alto">Aqui —</p>
                    <p className="mt-1.5 max-w-[46ch] leading-relaxed text-texto">{p.aqui}</p>
                    <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-texto-soft">
                      {p.olhar}
                    </p>
                  </div>
                </li>
              </Revelar>
            ))}
          </ol>
        </div>
      </section>

      {/* ── perguntas frequentes ───────────────────────────────────────── */}
      <section id="perguntas" className="scroll-mt-8 border-t border-linha">
        <div className="mx-auto max-w-3xl px-6 py-28">
          <Revelar>
            <div className="max-w-2xl">
              <Marcador rotulo="Antes de decidir" />
              <h2 className="mt-5 font-serif text-4xl font-bold tracking-tight">
                Perguntas frequentes
              </h2>
            </div>
          </Revelar>

          <div className="mt-10 border-t border-linha">
            {FAQ.map((p, i) => (
              <Revelar key={p.pergunta} atraso={Math.min(i, 4) * 60}>
                <details className="group border-b border-linha">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left font-medium transition hover:text-acento-alto">
                    {p.pergunta}
                    <span
                      aria-hidden
                      className="shrink-0 text-xl leading-none text-texto-faint transition group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-[62ch] pb-6 text-sm leading-relaxed text-texto-soft">
                    {p.resposta}
                  </p>
                </details>
              </Revelar>
            ))}
          </div>

          <p className="mt-8 text-sm text-texto-soft">
            Ficou faltando alguma?{" "}
            <a href={`mailto:${marca.email}`} className="text-acento underline underline-offset-4">
              {marca.email}
            </a>{" "}
            — respondemos com detalhe técnico se você quiser.
          </p>
        </div>
      </section>

      {/* ── fecho: a última foto e o convite ───────────────────────────── */}
      <section className="relative isolate overflow-hidden border-t border-linha">
        <img
          src="/home/cerimonia-arco.jpg"
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,var(--void)_0%,color-mix(in_srgb,var(--void)_72%,transparent)_55%,var(--void)_100%)]"
          aria-hidden
        />
        <div className="mx-auto max-w-6xl px-6 py-32">
          <Revelar>
            <h2 className="max-w-[22ch] font-serif text-4xl font-bold tracking-tight sm:text-6xl">
              A próxima entrega já podia ser{" "}
              <span className="text-acento-alto">assim</span>.
            </h2>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <Link href="/cadastrar" className={CTA}>
                Criar conta grátis
              </Link>
              <p className="text-sm text-texto-soft">14 dias grátis · sem cartão</p>
            </div>
          </Revelar>
        </div>
      </section>

      <footer className="border-t border-linha">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10 text-xs text-texto-faint">
          <span className="flex items-center gap-2.5">
            <MarcaTile tamanho={26} />
            <span>
              {marca.nome} · {marca.tagline}
            </span>
          </span>
          <p>
            <Link href="/seguranca" className="hover:text-texto-soft">
              Segurança
            </Link>
            {" · "}
            <Link href="/privacidade" className="hover:text-texto-soft">
              Privacidade
            </Link>
            {" · "}
            <Link href="/termos" className="hover:text-texto-soft">
              Termos de uso
            </Link>
            {" · "}
            <a href={`mailto:${marca.email}`} className="hover:text-texto-soft">
              {marca.email}
            </a>
          </p>
          <p>© {new Date().getFullYear()}</p>
        </div>
      </footer>
    </main>
  );
}
