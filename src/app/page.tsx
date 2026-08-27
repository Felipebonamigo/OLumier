import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { MontadorPlano } from "@/components/montador-plano";
import { MarcaTile, SeloBeta } from "@/components/marca-tile";
import { SeletorTema } from "@/components/seletor-tema";
import { TEMAS } from "@/config/aparencia";
import { Revelar } from "@/components/revelar";
import { ESPACOS, formatarGb } from "@/config/planos";
import { fotosDeDemonstracao } from "@/config/fotos-demonstracao";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";

export const metadata: Metadata = {
  title: `${marca.nome} — ${marca.tagline}`,
};

/*
 * A página conta uma história em cinco atos: a promessa (hero, escuro), o
 * caminho (três gestos, escuro), o resultado na mão do casal (creme — a única
 * seção clara, de propósito: é o momento em que a luz chega), a ferramenta do
 * estúdio e o preço.
 *
 * ── A LINGUAGEM VISUAL: EDITORIAL DE ESTÚDIO (27/08/2026) ─────────────────
 *
 * Terceira linguagem em dois dias, e desta vez o critério veio de fora: a
 * lista de padrões do impeccable.style — o catálogo do que toda página gerada
 * por IA faz — batida contra a versão anterior. Ela reprovava em quatro:
 *
 *   · o MARCADOR numerado de seção ("tiny numbered section labels");
 *   · o rótulo pequeno em cima do título do hero ("kicker/eyebrow label");
 *   · a tira de filme com fotos de GRADIENTE e o telefone de quadradinhos
 *     coloridos ("shape-assembled illustration") — página de fotógrafo com
 *     foto de mentira desenhada em CSS;
 *   · números de seção em âmbar, violando a regra da própria marca de que o
 *     âmbar é reservado a AÇÃO.
 *
 * O que vale agora: TIPOGRAFIA CARREGA TUDO. Cormorant em escala de display de
 * verdade (o salto entre título e corpo é a hierarquia — título tímido é o
 * defeito "flat type hierarchy"), espaço generoso, fio fino como única
 * estrutura, e o âmbar de volta ao posto: botão, link, foto marcada, uma
 * palavra por tela.
 *
 * A única imagem da página é a galeria que o PRODUTO mesmo renderiza: as fotos
 * de demonstração de `fotosDeDemonstracao` (proporções reais de câmera, tons
 * do tema creme), no telefone da seção clara. Não é mockup inventado — é o que
 * a prévia do fotógrafo mostra, com o mesmo código.
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

/* A ficha técnica do hero: o produto em seis células, como especificação de
 * câmera. Os números saem da grade real (`ESPACOS`) — se ela mudar, a ficha
 * acompanha sozinha. */
const FICHA: [string, string][] = [
  ["mídia", "foto e filme 4K"],
  ["espaço", `${formatarGb(MENOR_ESPACO.gb)} a ${formatarGb(MAIOR_ESPACO.gb)}`],
  ["downloads", "sem limite"],
  ["álbum", "escolha com trava"],
  ["endereço", "seu, com sua marca"],
  ["teste", "14 dias, sem cartão"],
];

/*
 * A galeria de demonstração, no tema creme — a MESMA função que alimenta a
 * prévia do fotógrafo. É a única imagem da página, e é honesta duas vezes: as
 * proporções são de câmera de verdade, e o código que a desenha é o código do
 * produto. Quatro molduras bastam para ler "galeria"; oito virariam catálogo.
 */
const FOTOS_DEMO = fotosDeDemonstracao("creme").slice(0, 4);

/* O botão de ação: retângulo seco. A página inteira é feita de fio e papel;
 * o único brilho que ela se permite é o feixe do projetor no hero. */
const CTA = "inline-block bg-acento px-7 py-3.5 font-semibold text-void transition-colors hover:bg-acento-alto";

export default function Home() {
  return (
    <main className="overflow-x-clip">
      {/* ── cabeçalho ─────────────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7">
        {/* A home monta a marca à mão (serifada e maior que o lockup padrão),
            então o selo entra aqui também — não sai de graça pelo MarcaLockup. */}
        <span className="flex items-center gap-3">
          <MarcaTile tamanho={38} />
          <span className="font-serif text-xl font-bold tracking-tight">{marca.nome}</span>
          <SeloBeta />
        </span>
        <nav className="flex items-center gap-4 text-sm sm:gap-5">
          {/* Antes do login, e antes de qualquer conta: quem chegou decide como
              quer ler. Sem escolha, a página já abre no tema do sistema. */}
          <SeletorTema />
          <Link href="/entrar" className="text-texto-soft transition hover:text-texto">
            Entrar
          </Link>
          <Link
            href="/cadastrar"
            className="bg-acento px-4 py-2 font-medium text-void transition-colors hover:bg-acento-alto"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      {/* ── ato 1: a promessa ─────────────────────────────────────────────
          Só tipografia. O título em escala de display é a imagem do hero — numa
          página para quem vive de olhar, a coragem tipográfica É o portfólio.
          A descrição funcional fica ABAIXO do título (em cima seria o
          "eyebrow" de toda landing gerada), e o âmbar aparece uma vez. */}
      <section className="relative mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28 lg:pt-36">
        <div className="feixe" aria-hidden />

        <div className="relative">
          <h1 className="max-w-[10ch] text-balance font-serif text-[17vw] font-semibold leading-[0.94] tracking-[-0.015em] sm:text-8xl lg:text-[9rem]">
            Sua luz, <span className="text-acento-alto">entregue.</span>
          </h1>

          <div className="mt-12 grid gap-10 lg:mt-16 lg:grid-cols-[1fr_auto] lg:items-end">
            <p className="max-w-[46ch] text-lg leading-relaxed text-texto-soft sm:text-xl">
              Galerias de entrega para fotógrafos e filmakers. O dia passa, as fotos ficam —{" "}
              {marca.nome} é o lugar onde elas chegam ao casal: com a sua marca, no seu endereço,
              direto na galeria do celular deles.
            </p>
            <div className="flex flex-wrap items-center gap-6 lg:pb-1">
              <Link href="/cadastrar" className={CTA}>
                Começar grátis
              </Link>
              <Link
                href="#planos"
                className="text-sm text-texto-soft underline underline-offset-4 transition hover:text-texto"
              >
                Ver planos
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* A ficha técnica: uma RÉGUA de fio fino atravessando a página, como a
          linha de especificação de um catálogo — não uma caixa de métricas.
          Seis células, fio vertical entre elas, nada de moldura. */}
      <section className="border-y border-linha">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 px-6 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-linha">
          {FICHA.map(([rotulo, valor]) => (
            <div key={rotulo} className="py-5 lg:px-5 lg:first:pl-0 lg:last:pr-0">
              <dt className="text-[11px] tracking-wide text-texto-faint">{rotulo}</dt>
              <dd className="mt-1 text-sm text-texto">{valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── ato 2: o caminho — coluna fixa à esquerda, gestos à direita ── */}
      <section className="border-y border-linha bg-carbon/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[2fr_3fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
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
                  <span className="font-serif text-2xl font-semibold tabular-nums text-texto-faint">
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
        </div>
      </section>

      {/* ── ato 3: a luz chega — a ÚNICA seção clara da página ─────────── */}
      <section className="bg-marfim text-tinta">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid items-center gap-14 lg:grid-cols-[6fr_5fr]">
            <Revelar>
              <h2 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
                O casal abre no celular.
                <br />E fica tudo bem.
              </h2>
              {/* Lista pautada, não balinhas: o termo à esquerda como verbete,
                  o fio como pauta — mesmo desenho do índice da ferramenta. */}
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

            {/* O telefone, com a galeria que o PRODUTO renderiza: as fotos de
                demonstração do tema creme, nas proporções reais de câmera, em
                duas colunas como a grade da galeria de verdade. Papel é claro
                nos dois temas — cor fixa, como no mundo físico. A favorita
                marcada e o contador são o produto falando: escolha com trava. */}
            <Revelar atraso={120} className="justify-self-center">
              <div
                className="w-72 rounded-[2.2rem] border border-marfim-2 bg-white p-3 shadow-[0_30px_60px_-20px_rgba(42,35,24,0.25)]"
                aria-hidden
              >
                <div className="rounded-[1.6rem] bg-marfim px-4 pb-4 pt-5">
                  <p className="text-center font-script text-3xl text-tinta">Ana &amp; Pedro</p>
                  <p className="mt-1 text-center text-[8px] uppercase tracking-[0.22em] text-tinta-faint">
                    21 de março · Serra Gaúcha
                  </p>
                  <div className="mt-4 grid grid-cols-2 items-start gap-2">
                    <div className="grid gap-2">
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={FOTOS_DEMO[0].url} alt="" className="w-full rounded-sm" />
                        <span className="absolute right-1.5 top-1.5 text-xs text-erro">♥</span>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={FOTOS_DEMO[1].url} alt="" className="w-full rounded-sm" />
                    </div>
                    <div className="grid gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={FOTOS_DEMO[2].url} alt="" className="w-full rounded-sm" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={FOTOS_DEMO[3].url} alt="" className="w-full rounded-sm" />
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

      {/* ── ato 3½: da escolha ao álbum ─────────────────────────────────
          Seção própria porque é um FLUXO, não um recurso: começa no contrato
          ("40 fotos inclusas"), passa pelo casal e termina no Lightroom. É
          também a resposta ao concorrente que vende "seleção" — só que aqui
          ela termina onde o trabalho de verdade continua: na sua mesa.

          Três colunas separadas por fio, como colunas de jornal — a ordem
          importa e a numeração fica no verbete, não num numeral gigante. */}
      <section className="border-y border-linha bg-carbon/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Revelar>
            <h2 className="max-w-[22ch] font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
              O álbum se escolhe na galeria. A lista chega pronta no Lightroom.
            </h2>
          </Revelar>

          <div className="mt-12 grid border-y border-linha lg:grid-cols-3 lg:divide-x lg:divide-linha max-lg:divide-y max-lg:divide-linha">
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
              /* O recuo mora no PRÓPRIO Revelar, que é quem participa da grade.
                 No div interno, `first:` sempre casava — ele é o único filho do
                 embrulho — e o pl-0 valia para as TRÊS colunas: o texto
                 encostava no fio divisor. Visto no tema claro, 27/08/2026. */
              <Revelar
                key={p.n}
                atraso={i * 90}
                className="h-full py-8 lg:px-8 lg:first:pl-0 lg:last:pr-0"
              >
                <div>
                  <h3 className="font-serif text-2xl font-semibold tracking-tight">
                    <span className="mr-3 text-lg text-texto-faint">{p.n}.</span>
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
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Revelar>
          <h2 className="max-w-[20ch] font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
            O estúdio continua seu. Só o trabalho pesado muda de dono.
          </h2>
        </Revelar>

        {/* Sem cartão nenhum: verbete à esquerda, descrição à direita, um fio
            entre cada linha — o índice de um catálogo de exposição. O desenho
            do cofre e as amostras de tema moram DENTRO da própria linha, como
            figura de verbete. */}
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

          {/* Endereço — ganhou o domínio próprio, que entrou no ar em 26/08:
              a home vendia só o subdomínio e o produto já entrega mais. */}
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
                  <code className="border border-linha bg-void px-3 py-2 text-acento-alto">
                    seuestudio.{marca.dominio}
                  </code>
                  <code className="border border-linha bg-void px-3 py-2 text-texto-soft">
                    www.seuestudio.com.br
                  </code>
                </p>
              </div>
            </div>
          </Revelar>

          {/* Aparência — as amostras saem de TEMAS, os temas de galeria de
              verdade, não de tokens da interface: mostram o que o CASAL vê. */}
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
                      className="h-8 w-8 ring-1 ring-linha-forte"
                      style={{ background: TEMAS[t]["--g-fundo"] }}
                    />
                  ))}
                  <span
                    className="h-8 w-8 ring-1 ring-linha-forte"
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
                texto:
                  "Aberturas e downloads contados. “Não recebi” deixa de ser conversa.",
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

      {/* ── ato 5: preço ───────────────────────────────────────────────── */}
      <section id="planos" className="scroll-mt-8 border-t border-linha bg-carbon/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Revelar>
            <div className="max-w-2xl">
              <h2 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
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

          {/* ── a objeção, respondida onde ela nasce ────────────────────────
              Vem DEPOIS do montador de propósito: a pergunta "por que não é
              mais barato?" só existe depois de o preço aparecer.

              Três decisões que valem mais que a diagramação:

              1. Ninguém é citado pelo nome. Pacote fechado de concorrente muda
                 de teto sem avisar, e uma tabela com o número deles envelhece
                 em silêncio — vira mentira nossa por descuido alheio. Citar
                 também dá palco de graça a quem ainda não tem o nosso.

              2. Toda linha da coluna "aqui" é sobre NÓS, e cada uma é presa por
                 teste: o espaço sai de `ESPACOS`, o filme por preço é
                 `testar-planos`, o link assinado é `testar-galeria-publica`.
                 Marketing que a suíte não alcança é onde a mentira mora.

              3. A pergunta é feita "a qualquer galeria, a nossa inclusive". Não
                 é falsa modéstia: é o que torna a seção verificável em dez
                 segundos por quem está lendo, e o que a mantém honesta quando
                 alguém empatar conosco.

              `scripts/testar-comparativo.mjs` prende os três pontos. */}
          <Revelar>
            <div id="comparativo" className="mt-24 max-w-2xl scroll-mt-8">
              <h2 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
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
                      className="mt-1 font-serif text-xl font-semibold tabular-nums text-texto-faint"
                    >
                      {i + 1}.
                    </span>
                    <h3 className="font-serif text-2xl font-semibold tracking-tight">
                      {p.pergunta}
                    </h3>
                  </div>

                  <div>
                    {/* Rótulo em bloco, não colado no texto: como <span> inline
                        o leitor de tela emenda "AquiDe 100 GB" numa palavra só,
                        e o espaço só existia como margem visual. */}
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
        <div className="mx-auto max-w-3xl px-6 py-24">
          <Revelar>
            <div className="max-w-2xl">
              <h2 className="font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
                Perguntas frequentes
              </h2>
            </div>
          </Revelar>

          <div className="mt-10 border-t border-linha">
            {FAQ.map((p, i) => (
              <Revelar key={p.pergunta} atraso={Math.min(i, 4) * 60}>
                {/* `group` + `open:` deixam a seta girar sem uma linha de JS. */}
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

      {/* ── fecho ──────────────────────────────────────────────────────── */}
      <section className="border-t border-linha">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Revelar>
            <h2 className="max-w-[16ch] text-balance font-serif text-6xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
              A próxima entrega já podia ser{" "}
              <span className="text-acento-alto">assim</span>.
            </h2>
            <div className="mt-9 flex flex-wrap items-center gap-6">
              <Link href="/cadastrar" className={CTA}>
                Criar conta grátis
              </Link>
              <p className="text-sm text-texto-faint">14 dias grátis · sem cartão</p>
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
