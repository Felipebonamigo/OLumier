/* eslint-disable @next/next/no-img-element -- página institucional: as fotos e
 * os prints são estáticos de /public, servidos como estão. */
import type { Metadata } from "next";
import { METADADOS_DO_APP } from "@/config/app-instalado";
import Link from "next/link";
import { Fragment } from "react";
import { marca } from "@/config/marca";
import { MarcaSimbolo, SeloBeta } from "@/components/marca-tile";
import { MontadorPlano } from "@/components/montador-plano";
import { Revelar } from "@/components/revelar";
import { FONTES_TITULO, OPCOES, PRESETS, variaveisDoTema } from "@/config/aparencia";
import { VALIDADE_DO_LINK_DA_GALERIA } from "@/config/links-assinados";
import { ESPACOS, formatarGb, formatarReais } from "@/config/planos";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { dadosEstruturadosDaCasa, jsonLd, metadadosDaCasa } from "@/lib/metadados";
import { DOMINIO_PROPRIO_LIBERADO, VIDEO_LIBERADO } from "@/config/lancamentos";
import {
  GALERIA_EM_DESTAQUE,
  IDENTIDADES,
  LUGAR_DO_COFRE,
  identidadePorId,
  type Identidade,
} from "@/config/home-demonstracao";
import { fotosDaHome } from "@/lib/fotos-da-home";
import { fonteTexto, fonteTitulo } from "@/components/home/fontes";
import { GaleriaDemo } from "@/components/home/galeria-demo";
import { HeroGalerias } from "@/components/home/hero-galerias";
import { TrocaIdentidade } from "@/components/home/troca-identidade";
import { SelecaoDemo } from "@/components/home/selecao-demo";
import { EncolherAoRolar } from "@/components/home/encolher-ao-rolar";
import { DaPastaAGaleria } from "@/components/home/da-pasta-a-galeria";
import { Conta, CofreEstados, Peca, RelogioDoLink } from "@/components/home/bento-recursos";
import { RETENCAO_POR_EXTENSO } from "@/config/retencao";
import { DESCONTO_DO_PACOTE } from "@/config/combo";
import { URL_ATOMATIZA } from "@/lib/ponte-atomatiza";

/*
 * ── A HOME NOVA (26/09/2026) ───────────────────────────────────────────────
 *
 * Construída a partir do briefing-mestre da camada estratégica
 * (`docs/briefing-home.md`) e da leitura crítica do lado técnico
 * (`docs/home-leitura-critica.md`), que registra o que mudou em relação ao
 * briefing e por quê. Leia os dois antes de mexer aqui.
 *
 * O princípio que organiza a página inteira é o §28 do briefing: NÃO ESCONDER
 * O SOFTWARE. Toda galeria que aparece aqui é a galeria de verdade — os mesmos
 * componentes que o cliente abre, com os estilos do editor (`GaleriaDemo`).
 *
 * EM MOVIMENTO desde 03/10/2026: a cena "Suba. Personalize. Entregue.", o
 * bloco de peças dos recursos, a faixa de provas e as esteiras do fecho. Todo
 * movimento mostra o produto; o registro está na seção 7 da leitura crítica.
 *
 * A outra regra é a de sempre desta página: só entra o que EXISTE e está
 * ligado. Vídeo e domínio próprio existem no código mas não estão validados
 * para anúncio; o interruptor de cada um mora em `config/lancamentos.ts`.
 *
 * A página alterna de propósito (briefing §22): texto → produto → fotografia →
 * produto → respiro. Se uma seção nova entrar, ela entra nesse ritmo.
 */

const DESCRICAO =
  "Crie galerias bonitas, intuitivas e personalizáveis para entregar seu trabalho com a sua marca, no seu endereço e do seu jeito.";

/*
 * `metadadosDaCasa` põe o canônico, o og:url e a imagem do cartão; o título e
 * a descrição continuam os do briefing. Ver `lib/metadados.ts`.
 */
export const metadata: Metadata = {
  ...metadadosDaCasa({
    titulo: `${marca.nome} — ${marca.tagline}`,
    descricao: DESCRICAO,
    caminho: "/",
    tituloInteiro: true,
  }),
  /* O ícone da tela de início e o app — ver `config/app-instalado.ts`. */
  ...METADADOS_DO_APP,
};

const MENOR_ESPACO = ESPACOS[0];

/* A faixa do desconto do combo, lida da tabela que o Asaas cobra: se o preço
   mudar lá, a frase da home muda junto. */
const DESCONTOS_DO_COMBO = Object.values(DESCONTO_DO_PACOTE).flatMap((linha) => Object.values(linha));
const COMBO_MENOR = Math.min(...DESCONTOS_DO_COMBO);
const COMBO_MAIOR = Math.max(...DESCONTOS_DO_COMBO);

/* Os botões. Pílula, porque o dono vetou o retângulo seco; tinta, porque a
   cor da página vem das fotos (ver `.home` em globals.css). */
const CTA =
  "inline-flex items-center justify-center rounded-full bg-[var(--h-tinta)] px-6 py-3 text-[15px] font-medium text-white transition hover:-translate-y-0.5 hover:bg-black";
const CTA_SECUNDARIO =
  "inline-flex items-center justify-center rounded-full border border-[var(--h-linha-forte)] px-6 py-3 text-[15px] font-medium text-[var(--h-tinta)] transition hover:border-[var(--h-tinta)]";
const SOBRANCELHA = "text-xs font-medium uppercase tracking-[0.16em] text-[var(--h-tinta-3)]";
const TITULO_SECAO =
  "home-titulo text-[clamp(2.1rem,4.4vw,3.6rem)] font-semibold leading-[1.02] text-[var(--h-tinta)]";
const TEXTO_SECAO = "text-lg leading-relaxed text-[var(--h-tinta-2)]";

const nomeDe = (eixo: keyof typeof OPCOES, id: string) =>
  (OPCOES[eixo] as readonly { id: string; nome: string }[]).find((o) => o.id === id)?.nome ?? id;

/* A combinação de cada galeria de exemplo, escrita com os nomes do editor —
   é a prova de que "várias identidades" são escolhas que o fotógrafo faz. */
function combinacao(i: Identidade) {
  const a = i.aparencia;
  const cor = a.cores ? "cores próprias" : `tema ${nomeDe("tema", a.tema).toLowerCase()}`;
  return [
    `capa ${nomeDe("capa", a.capa).toLowerCase()}`,
    nomeDe("tipografia", a.tipografia),
    cor,
    `grade ${nomeDe("grade", a.grade).toLowerCase()}`,
  ].join(" · ");
}

/*
 * A FAQ — a ordem é a do briefing (§19), e cada resposta foi conferida contra o
 * comportamento real: a lixeira segura 30 dias porque `PRAZO_LIXEIRA_DIAS`
 * diz 30, cancelar não apaga entrega na hora porque a conta encerrada guarda
 * por `RETENCAO_POR_EXTENSO` (`lib/contas-encerradas.ts`), e o domínio próprio responde conforme o interruptor dele.
 *
 * <details>/<summary> nativos: abrem sem JavaScript e entram no Ctrl+F.
 */
const FAQ: { pergunta: string; resposta: React.ReactNode }[] = [
  {
    pergunta: "Preciso pagar para testar?",
    resposta: (
      <>
        Não. São <strong>14 dias grátis e sem cartão</strong>. Dá para subir uma entrega de verdade
        e ver o seu cliente abrindo o link antes de decidir qualquer coisa. O cadastro pede o CPF
        ou CNPJ, porque o teste é um por pessoa. Se não assinar, nada é cobrado: os arquivos do
        teste são apagados 60 dias depois do fim dele, com dois avisos por e-mail antes.
      </>
    ),
  },
  {
    pergunta: "Meu cliente precisa criar uma conta?",
    resposta: (
      <>
        Não. Ele recebe um link e abre — no celular ou no computador, sem cadastro e sem
        aplicativo. Para marcar favoritas, informa só o e-mail, e a lista dele acompanha em
        qualquer aparelho. Se você quiser, o link também pede uma senha que só você define.
      </>
    ),
  },
  {
    pergunta: "Consigo personalizar a galeria com a minha marca?",
    resposta: (
      <>
        Sim. A sua logo na capa, as suas cores de fundo, texto e botões, {OPCOES.tipografia.length - 1}{" "}
        fontes de título ou a fonte do seu estúdio, e a capa, a grade e o espaçamento que combinam
        com o seu trabalho. São {PRESETS.length} estilos prontos para começar, e o seu desenho
        pode virar o padrão de toda galeria nova.
      </>
    ),
  },
  {
    pergunta: "Posso usar o meu próprio endereço?",
    resposta: DOMINIO_PROPRIO_LIBERADO ? (
      <>
        Sim. Cada estúdio ganha <strong>seuestudio.{marca.dominio}</strong>, e quem já tem um
        domínio pode apontá-lo e usar o seu — a prova de posse é por DNS e o certificado sai
        sozinho.
      </>
    ) : (
      <>
        Cada estúdio ganha um endereço próprio dentro da Galeria Átomo:{" "}
        <strong>seuestudio.{marca.dominio}</strong>. Usar um domínio seu, como
        galeria.seuestudio.com.br, ainda não está liberado.
      </>
    ),
  },
  {
    pergunta: "Como funciona o armazenamento?",
    resposta: (
      <>
        Você escolhe um espaço — {formatarGb(MENOR_ESPACO.gb)}, 500 GB ou 1 TB, e acima disso tera a
        tera — e ele vale para tudo o que o estúdio guarda: galerias no ar e galerias no Cofre
        usam o mesmo espaço. Os recursos são os mesmos em qualquer tamanho.
      </>
    ),
  },
  {
    pergunta: "O que acontece quando uma galeria vence?",
    resposta: (
      <>
        Ela vai para o <strong>Cofre</strong>: o link para de abrir para o cliente e nenhum arquivo
        é apagado. Um clique traz de volta, no mesmo endereço. Guardar no Cofre não custa a mais.
      </>
    ),
  },
  {
    pergunta: "O Cofre é um backup?",
    resposta: (
      <>
        Não. O que fica na Galeria Átomo é a cópia que o seu cliente recebe. Guarde os seus
        originais onde você já guarda — nenhum serviço deveria ser a sua única cópia, e o nosso
        também não.
      </>
    ),
  },
  {
    pergunta: "Apaguei uma galeria. Consigo recuperar?",
    resposta: (
      <>
        Sim. Ela vai para a lixeira e fica lá por <strong>{PRAZO_LIXEIRA_DIAS} dias</strong>, com os
        arquivos intactos. Restaurar devolve as mesmas fotos, os mesmos capítulos e a escolha do
        cliente — e ela volta como rascunho, para o link não reabrir sozinho.
      </>
    ),
  },
  {
    pergunta: "Posso cancelar quando quiser?",
    resposta: (
      <>
        Pode, pelo próprio painel. Até 7 dias depois de pagar, o dinheiro volta inteiro. O que você
        já entregou continua no ar por mais {RETENCAO_POR_EXTENSO} depois do fim do período pago, e
        avisamos por e-mail antes de apagar qualquer arquivo.
      </>
    ),
  },
  {
    pergunta: "Onde os arquivos ficam armazenados?",
    resposta: (
      <>
        Os originais ficam na Backblaze, em armazenamento profissional; as miniaturas e prévias, na
        Cloudflare, que é o que faz a galeria abrir rápido. Está tudo explicado, sem letra miúda,
        na <Link href="/seguranca">página de segurança</Link> — inclusive o que ainda não temos.
      </>
    ),
  },
  {
    pergunta: "Como funciona o suporte?",
    resposta: (
      <>
        Pelo WhatsApp <a href={marca.whatsappLink}>{marca.whatsappVisivel}</a>, em português. Quem
        responde é quem constrói a Galeria Átomo — com detalhe técnico, se você quiser.
      </>
    ),
  },
  ...(VIDEO_LIBERADO
    ? [
        {
          pergunta: "Posso entregar vídeos?",
          resposta: (
            <>
              Sim. Fotos e filmes ficam na mesma galeria, e o filme usa o espaço do plano, sem
              cobrança separada por hora.
            </>
          ),
        },
      ]
    : []),
];

/* O texto puro de um nó JSX — para o dado estruturado da FAQ. Anda pelo JSX que
   a página renderiza, então o bloco do Google não tem como divergir do que se
   lê na tela. */
function textoDe(no: React.ReactNode): string {
  if (no == null || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(textoDe).join("");
  if (typeof no === "object" && "props" in no) {
    return textoDe((no.props as { children?: React.ReactNode }).children);
  }
  return "";
}

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((p) => ({
    "@type": "Question",
    name: p.pergunta,
    acceptedAnswer: { "@type": "Answer", text: textoDe(p.resposta).replace(/\s+/g, " ").trim() },
  })),
};

/* As três perguntas do comparativo — o texto das perguntas é o do briefing
   (§17). Os tamanhos saem de `ESPACOS`: `testar-comparativo.mjs` confere. */
const PERGUNTAS = [
  {
    pergunta: "Quanto espaço eu realmente tenho?",
    resposta: `O número do plano, inteiro: de ${formatarGb(MENOR_ESPACO.gb)} para cima, de tera em tera. Galeria no ar e galeria no Cofre usam o mesmo espaço — guardar não custa a mais, e nenhum recurso fica atrás de um plano maior.`,
  },
  {
    pergunta: "O que acontece quando uma galeria vence?",
    resposta:
      "Ela sai do ar para o cliente e vai para o Cofre. Nada é apagado, e um clique traz de volta, no mesmo endereço.",
  },
  {
    pergunta: "Quem aparece mais para o meu cliente: o meu estúdio ou a plataforma?",
    resposta: `O seu estúdio. A capa leva a sua logo, as suas cores e o seu endereço; a ${marca.nome} aparece só num selo discreto no fim da galeria. Ela foi construída para que a identidade do fotógrafo permaneça protagonista na experiência de entrega.`,
  },
];

/* Recursos que NÃO têm peça própria no bloco de recursos nem seção própria —
   o briefing listava também personalização, favoritos, cofre, domínio e
   segurança, e cada um já tem o seu lugar. Ver a redundância 2 em
   `docs/home-leitura-critica.md`. Desde 03/10/2026, "Prova de entrega" e
   "Capítulos pelas pastas" viraram peças do bloco e saem desta lista na hora
   de desenhar (`E_TAMBEM`). */
const RECURSOS = [
  {
    titulo: "Download completo",
    texto:
      "Foto a foto, por capítulo ou a galeria inteira de uma vez — sempre no arquivo original, quantas vezes o cliente quiser.",
  },
  {
    titulo: "Prova de entrega",
    texto: "Aberturas e downloads contados, com quem baixou. “Não recebi” deixa de ser conversa.",
  },
  {
    titulo: "Capítulos pelas pastas",
    texto:
      "Suba a pasta do trabalho e as subpastas viram capítulos, na ordem do dia: making of, cerimônia, festa.",
  },
  {
    titulo: "Envio que não recomeça",
    texto:
      "Centenas de fotos sobem em paralelo, direto do navegador. Se a conexão cair, o envio retoma de onde parou.",
  },
  {
    titulo: "O seu padrão de design",
    texto:
      "Acertou a combinação? Salve como padrão e toda galeria nova já nasce com a cara do seu estúdio.",
  },
  {
    titulo: "Vitrine do estúdio",
    texto:
      "O mesmo endereço das entregas vira a página do estúdio: capa, sobre, portfólio e contato, pronta para a bio.",
  },
];

const E_TAMBEM = RECURSOS.filter((r) => r.titulo !== "Prova de entrega" && r.titulo !== "Capítulos pelas pastas");

/*
 * A FAIXA DE PROVAS, logo abaixo do hero (03/10/2026).
 *
 * É o "logo cloud" dos sites de tecnologia, com fatos no lugar de logos: prova
 * antes de adjetivo (§27), e "brasileira" aparecendo cedo (estratégia §10). Só
 * entra o que está no ar — o preço e o prazo da lixeira saem da mesma fonte que
 * o resto da página, e "mais de 4.500 fotos" é a maior galeria do Juan, no ar
 * desde 01/10/2026.
 */
const PROVAS: React.ReactNode[] = [
  <>
    <strong className="font-semibold text-[var(--h-tinta)]">{formatarReais(MENOR_ESPACO.precoCentavos)}</strong> por mês no
    plano de {formatarGb(MENOR_ESPACO.gb)}
  </>,
  "Pix, boleto ou cartão",
  "WhatsApp de quem constrói",
  "As subpastas viram capítulos",
  <>
    Galerias com mais de <strong className="font-semibold text-[var(--h-tinta)]">4.500</strong> fotos
  </>,
  <>
    Lixeira de <strong className="font-semibold text-[var(--h-tinta)]">{PRAZO_LIXEIRA_DIAS} dias</strong>
  </>,
  "Senha e prazo por galeria",
  "Download no arquivo original",
  "Aberturas e downloads contados",
  `${OPCOES.tipografia.length - 1} fontes de título`,
];

/* O que o cliente faz na galeria — só recurso ligado (briefing §9). "Salvar
   direto no rolo da câmera" fica de fora até ser validado em todo aparelho. */
const DO_CLIENTE = [
  ["Abre em qualquer tela", "Celular, tablet ou computador, sem instalar nada e sem criar conta."],
  ["Favoritas com um toque", "O coração marca a foto, e a lista acompanha a pessoa em qualquer aparelho."],
  ["Download no original", "Foto a foto, por capítulo ou tudo de uma vez."],
  ["Seleção com número", "A galeria conta as escolhas e para no limite que você combinou."],
  ["Senha, se você quiser", "Definida por você, galeria por galeria."],
];

const SEGURANCA = [
  [
    "Nada é público",
    "Todo arquivo é entregue por um link assinado que expira sozinho. Link que vaza para de funcionar.",
  ],
  ["Senha por galeria", "Quando você quiser, além de um endereço impossível de adivinhar."],
  [
    `Lixeira de ${PRAZO_LIXEIRA_DIAS} dias`,
    "Apagou sem querer? Fotos, capítulos e a escolha do cliente voltam com um clique.",
  ],
  [
    "Backup diário do cadastro",
    "Criptografado, fora do servidor e travado contra exclusão por 30 dias. A restauração foi ensaiada, não só prometida.",
  ],
  [
    "Vigia a cada 5 minutos",
    "Site, banco e armazenamento conferidos o tempo todo. Se algo travar, reinicia sozinho e avisa.",
  ],
];

function Marcador({ children, claro = false }: { children: React.ReactNode; claro?: boolean }) {
  return <p className={claro ? "text-xs font-medium uppercase tracking-[0.16em] text-white/70" : SOBRANCELHA}>{children}</p>;
}

/*
 * ESTÁTICA, REGENERADA QUANDO A FOTO MUDA (28/09/2026).
 *
 * As fotos passaram a vir do banco — o admin troca em `/painel/admin/home` —,
 * e ler o banco a cada visita faria a página mais importante da plataforma
 * esperar uma consulta. A página continua pré-desenhada: a troca de foto chama
 * `revalidatePath("/")` (ver `api/admin/home/foto`), e a próxima visita já sai
 * com a foto nova. A hora abaixo é só a rede de segurança, caso a regeneração
 * pedida falhe.
 */
export const revalidate = 3600;

/* Os cartões das esteiras do fecho: a capa e mais duas fotos de cada galeria
   de exemplo, intercaladas para duas galerias iguais não ficarem lado a lado. */
const CARTOES_DO_FECHO = [0, 3, 6].flatMap((k) =>
  IDENTIDADES.map((ident) => ({ ident, lugar: k === 0 ? ident.capa : ident.fotos[k] })),
);

export default async function Home() {
  const fotos = await fotosDaHome();
  const [delicada, editorial, classica] = IDENTIDADES;
  /* A galeria de fotos de verdade (Vanessa & Kalil) é a que representa o
     produto sozinha: a troca de identidade, o celular, a seleção e o cofre. */
  const destaque = identidadePorId(GALERIA_EM_DESTAQUE) ?? delicada;

  return (
    <main className={`home overflow-x-clip ${fonteTitulo.variable} ${fonteTexto.variable}`}>
      {/* ── cabeçalho ───────────────────────────────────────────────────
          Fixo, claro, com poucos itens (briefing §4). No celular a navegação
          some — as âncoras são atalhos, a página inteira é o caminho — e o
          selo de beta também: o beta é contado com palavras em "Brasileira
          desde o começo", e no cabeçalho do celular ele empurrava o botão de
          criar conta para fora da tela, que era o defeito da página antiga.

          PÍLULA DE VIDRO (03/10/2026): solta das bordas, translúcida, e
          encolhe quando a página rola (`EncolherAoRolar`, desenho em
          `.home-topo`). O logo é o de sempre — símbolo, nome e selo — por
          pedido do Felipe: "mantenha o nosso logo". */}
      <header
        id="topo-da-home"
        className="home-topo sticky top-3 z-50 mx-3 mt-3 max-w-7xl rounded-full border border-transparent bg-[color-mix(in_srgb,var(--h-papel)_80%,transparent)] backdrop-blur-xl sm:mx-auto"
      >
        <div className="flex h-14 items-center justify-between gap-3 pl-4 pr-2 sm:pl-5">
          <Link href="/" className="flex min-w-0 items-center gap-2" aria-label={`${marca.nome}, início`}>
            {/* O âmbar da lente é da marca, não da página: continua âmbar. */}
            <span style={{ ["--acento" as string]: "#d9a441" }}>
              <MarcaSimbolo tamanho={28} />
            </span>
            <span className="home-titulo truncate text-[16px] font-semibold tracking-tight sm:text-[17px]">
              {marca.nome}
            </span>
            <span className="hidden sm:inline">
              <SeloBeta />
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-[var(--h-tinta-2)] md:flex" aria-label="Seções">
            <a href="#exemplos" className="transition hover:text-[var(--h-tinta)]">Exemplos</a>
            <a href="#recursos" className="transition hover:text-[var(--h-tinta)]">Recursos</a>
            <a href="#planos" className="transition hover:text-[var(--h-tinta)]">Planos</a>
          </nav>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <Link href="/entrar" className="text-sm text-[var(--h-tinta-2)] transition hover:text-[var(--h-tinta)]">
              Entrar
            </Link>
            <Link
              href="/cadastrar"
              className="rounded-full bg-[var(--h-tinta)] px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-black sm:px-4 sm:text-sm"
            >
              Começar grátis
            </Link>
          </div>
        </div>
      </header>
      <EncolherAoRolar alvo="topo-da-home" />

      {/* ── 1 · hero ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 md:pt-16 lg:pb-28">
        <div className="grid items-center gap-12 lg:grid-cols-[9fr_14fr] lg:gap-12">
          <div>
            <p className={SOBRANCELHA}>Galeria brasileira para fotógrafos</p>
            {/* Entra palavra por palavra, saindo do desfoque (`.home-palavra`).
                O texto é o mesmo de sempre, com os espaços entre as palavras:
                busca e leitor de tela leem a frase inteira. */}
            <h1 className="home-titulo mt-5 text-[clamp(2.5rem,4.3vw,4.1rem)] font-semibold leading-[1.0]">
              {/* O espaço fica FORA da palavra: dentro de um inline-block o
                  espaço do fim é engolido e as palavras grudariam. */}
              {"Sua fotografia tem identidade.".split(" ").map((p, i) => (
                <Fragment key={i}>
                  <span className="home-palavra" style={{ ["--i" as string]: i }}>
                    {p}
                  </span>{" "}
                </Fragment>
              ))}
              <span className="text-[var(--h-tinta-3)]">
                {"Sua entrega também.".split(" ").map((p, i, todas) => (
                  <Fragment key={i}>
                    <span className="home-palavra" style={{ ["--i" as string]: i + 4 }}>
                      {p}
                    </span>
                    {i < todas.length - 1 ? " " : ""}
                  </Fragment>
                ))}
              </span>
            </h1>
            <p className="mt-6 max-w-[44ch] text-lg leading-relaxed text-[var(--h-tinta-2)]">
              {DESCRICAO}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/cadastrar" className={CTA}>
                Começar grátis
              </Link>
              <a href="#como-funciona" className={CTA_SECUNDARIO}>
                Ver como funciona
              </a>
            </div>
            <p className="mt-4 text-sm text-[var(--h-tinta-3)]">14 dias grátis · sem cartão</p>
          </div>
          <HeroGalerias identidades={[delicada, editorial, classica]} fotos={fotos} />
        </div>
      </section>

      {/* ── 1b · faixa de provas (03/10/2026) ─────────────────────────────
          Esteira lenta, que para com o mouse em cima. A segunda cópia da
          lista só existe para a volta não ter emenda — o leitor de tela não
          a lê, e quem pediu menos movimento não a vê. */}
      <div className="home-provas overflow-hidden border-y border-[var(--h-linha)] bg-white py-4">
        <div className="home-provas-trilho">
          {[false, true].map((copia) => (
            <ul key={String(copia)} className="flex shrink-0" aria-hidden={copia || undefined}>
              {PROVAS.map((prova, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3.5 whitespace-nowrap px-5 text-[14.5px] text-[var(--h-tinta-2)] before:block before:size-[5px] before:rounded-full before:bg-[var(--h-tinta-3)] before:content-['']"
                >
                  <span>{prova}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      {/* ── 2 · uma galeria, várias identidades ─────────────────────────── */}
      <section id="exemplos" className="scroll-mt-16 border-t border-[var(--h-linha)] bg-white py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Revelar className="grid gap-6 lg:grid-cols-2 lg:items-end">
            <div>
              <Marcador>Exemplos</Marcador>
              <h2 className={`${TITULO_SECAO} mt-4`}>Uma galeria. Várias identidades.</h2>
            </div>
            <div className="space-y-3">
              <p className={TEXTO_SECAO}>
                Sua fotografia não precisa caber na estética de uma plataforma.
                <br />A plataforma deve acompanhar a sua.
              </p>
              <p className="text-[var(--h-tinta-2)]">
                Personalize a experiência para que cada entrega continue carregando o DNA da sua
                marca.
              </p>
            </div>
          </Revelar>
        </div>

        {/* A fila rola de lado no celular e mostra duas e meia no computador:
            a galeria precisa estar grande o bastante para a grade aparecer, e
            não só a capa (briefing §6). */}
        <div className="mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-[max(1.5rem,calc((100vw_-_80rem)/2_+_1.5rem))]">
          {IDENTIDADES.map((ident) => (
            <figure key={ident.id} className="w-[84%] shrink-0 snap-start sm:w-[58%] lg:w-[42%]">
              <GaleriaDemo
                identidade={ident}
                fotos={fotos}
                className="aspect-[4/5] w-full rounded-xl ring-1 ring-black/10"
              />
              <figcaption className="mt-4">
                <p className="font-medium">{ident.rotulo}</p>
                <p className="mt-1 text-sm text-[var(--h-tinta-3)]">{combinacao(ident)}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <p className="text-sm text-[var(--h-tinta-3)]">
            Galerias de demonstração, montadas com os estilos do editor.
          </p>
          <a href="#sua-marca" className="text-sm font-medium underline underline-offset-4">
            Explorar possibilidades →
          </a>
        </div>
      </section>

      {/* ── 3 · sua marca na frente ─────────────────────────────────────── */}
      <section id="sua-marca" className="scroll-mt-16 py-24 lg:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[4fr_8fr] lg:gap-14">
          <Revelar className="lg:sticky lg:top-28 lg:self-start">
            <Marcador>Sua marca continua na frente</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Seu trabalho. Sua marca. Seu endereço.</h2>
            <p className={`${TEXTO_SECAO} mt-6`}>
              A tecnologia faz a entrega acontecer. A identidade que o cliente percebe continua sendo
              a sua.
            </p>
            <p className="mt-4 text-[var(--h-tinta-2)]">
              Da capa ao endereço, a Galeria Átomo foi pensada para acompanhar a identidade do seu
              estúdio sem competir com ela.
            </p>
            <p className="mt-8 text-sm text-[var(--h-tinta-3)]">
              Troque a capa, a fonte e as cores: é a galeria de verdade, redesenhada na hora.
            </p>
          </Revelar>
          <TrocaIdentidade base={destaque} fotos={fotos} />
        </div>
      </section>

      {/* ── 4 · como funciona ──────────────────────────────────────────────
          O título era "Da pasta ao cliente." (briefing §8); Felipe pediu outra
          frase em 28/09/2026. O título nomeia os três passos que vêm abaixo.

          EM MOVIMENTO (03/10/2026): os três prints do painel deram lugar a
          uma cena que acompanha a rolagem — as mesmas fotos saem da pasta,
          viram capítulos, viram a galeria e entram no celular do cliente. Ver
          `da-pasta-a-galeria.tsx`. */}
      <section id="como-funciona" className="scroll-mt-16 border-y border-[var(--h-linha)] bg-white py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Revelar className="max-w-2xl">
            <Marcador>Como funciona</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Suba. Personalize. Entregue.</h2>
            <p className={`${TEXTO_SECAO} mt-5`}>
              Um fluxo intuitivo para transformar um trabalho pronto em uma entrega pronta.
            </p>
          </Revelar>
          <DaPastaAGaleria
            identidade={destaque}
            fotos={fotos}
            endereco={`seuestudio.${marca.dominio}/${destaque.slug}`}
          />
        </div>
      </section>

      {/* ── 5 · intuitiva para quem entrega, e para quem recebe ─────────── */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[5fr_6fr]">
          {/* O celular é a galeria do cliente de verdade, num iframe do tamanho
              de um telefone: dá para rolar, abrir foto e passar de uma para
              outra. Ver `app/demonstracao/[identidade]/page.tsx`. */}
          <div className="order-2 flex justify-center lg:order-1">
            <div className="relative w-[300px] rounded-[2.6rem] bg-[#141414] p-2.5 shadow-[0_40px_90px_-30px_rgba(20,20,20,0.55)]">
              <div className="relative h-[620px] overflow-hidden rounded-[2.1rem] bg-white">
                <iframe
                  src={`/demonstracao/${destaque.id}`}
                  title="Galeria de demonstração, como o cliente vê no celular"
                  loading="lazy"
                  width={390}
                  height={806}
                  className="absolute left-0 top-0 origin-top-left border-0"
                  style={{ transform: "scale(0.7436)" }}
                />
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <Revelar>
              <Marcador>A experiência do cliente</Marcador>
              <h2 className={`${TITULO_SECAO} mt-4`}>
                Intuitiva para quem entrega.
                <br />
                Intuitiva para quem recebe.
              </h2>
              <p className={`${TEXTO_SECAO} mt-6 max-w-[46ch]`}>
                Seu cliente abre o link e encontra o trabalho sem precisar aprender uma ferramenta nova
                para receber as próprias fotografias.
              </p>
            </Revelar>
            <dl className="mt-10 divide-y divide-[var(--h-linha)] border-y border-[var(--h-linha)]">
              {DO_CLIENTE.map(([t, d]) => (
                <div key={t} className="grid gap-1 py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
                  <dt className="font-medium">{t}</dt>
                  <dd className="text-[var(--h-tinta-2)]">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-[var(--h-tinta-3)]">
              O celular é a galeria de verdade: role, toque numa foto, passe para a próxima.
            </p>
          </div>
        </div>
      </section>

      {/* ── 6 · recursos, em peças (03/10/2026) ─────────────────────────────
          Seleção, "Brasileira desde o começo", Cofre e Recursos eram quatro
          seções, cada uma com a sua altura de tela. Viraram um bloco de peças
          de tamanhos diferentes, e cada peça é uma demonstração viva do
          recurso (§2 do briefing: demonstração real, nunca ícone genérico).
          O briefing pede para não virar "sequência infinita de cards" (§22):
          é um bloco só, no meio da página, cercado de seções abertas.

          PROVA > ADJETIVO (§27) continua: o preço sai de `ESPACOS`, o número
          de `marca.ts`, o prazo do link de `config/links-assinados.ts`.

          A FOTO DA EQUIPE AINDA NÃO EXISTE. O briefing sugere imagens reais
          das pessoas por trás do produto; foto de banco no lugar delas seria a
          única mentira da peça "Brasileira". Quando chegarem, o lugar é nela. */}
      <section id="recursos" className="scroll-mt-16 py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Revelar className="max-w-2xl">
            <Marcador>Recursos</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Tudo o que sustenta a entrega.</h2>
            <p className={`${TEXTO_SECAO} mt-5`}>Funcionando aqui mesmo, do jeito que funciona na sua galeria.</p>
          </Revelar>

          <div className="mt-14 grid gap-3.5 lg:grid-cols-6">
            {/* A seleção — a galeria de verdade, com os corações marcando. */}
            <Peca className="lg:col-span-4">
              <Marcador>Favoritos e seleção</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">
                A seleção acontece dentro da própria galeria.
              </h3>
              <p className="max-w-[56ch] text-[var(--h-tinta-2)]">
                Seu cliente marca as favoritas enquanto navega, e você recebe a escolha organizada para
                continuar o trabalho. Ideal também para a escolha das fotos do álbum.
              </p>
              <div className="mt-3 grid items-start gap-6 md:grid-cols-[6fr_5fr]">
                <SelecaoDemo identidade={destaque} fotos={fotos} />
                <ul className="space-y-3 text-[15px] text-[var(--h-tinta-2)]">
                  <li>
                    <strong className="font-medium text-[var(--h-tinta)]">Sem limite, ou o número combinado.</strong>{" "}
                    Se você definir um número, a galeria conta e para nele, com prazo se você quiser.
                  </li>
                  <li>
                    <strong className="font-medium text-[var(--h-tinta)]">Cada pessoa com a sua lista.</strong>{" "}
                    Família e convidados abrem o mesmo link sem mexer na escolha do cliente.
                  </li>
                  <li>
                    <strong className="font-medium text-[var(--h-tinta)]">Escolha encerrada, lista travada.</strong>{" "}
                    Mudaram de ideia? Você reabre em um clique.
                  </li>
                  <li>
                    <strong className="font-medium text-[var(--h-tinta)]">Direto para o Lightroom.</strong> Um botão
                    copia os nomes dos arquivos, prontos para colar no filtro.
                  </li>
                </ul>
              </div>
            </Peca>

            {/* O Cofre — os quatro estados, um aceso de cada vez. */}
            <Peca className="lg:col-span-2">
              <Marcador>Cofre</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">Sai do ar. Não precisa desaparecer.</h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Quando o prazo termina, a galeria sai do ar para o cliente e vai para o Cofre. Nada é
                apagado, e um clique traz de volta, no mesmo endereço.
              </p>
              <CofreEstados foto={fotos[LUGAR_DO_COFRE]} titulo={destaque.titulo} />
              <p className="text-xs text-[var(--h-tinta-3)]">O Cofre não substitui uma estratégia profissional de backup.</p>
            </Peca>

            {/* O link que vence — o relógio conta o prazo de verdade. */}
            <Peca className="lg:col-span-2">
              <Marcador>Segurança</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">Nada é público.</h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Toda foto chega por um link assinado que vence sozinho. Copiou o endereço para mandar fora
                da galeria? Ele para de abrir.
              </p>
              <RelogioDoLink segundos={VALIDADE_DO_LINK_DA_GALERIA} />
              <p className="font-mono text-xs text-[var(--h-tinta-3)]">até o link desta foto vencer</p>
            </Peca>

            {/* A prova de entrega — números de exemplo, e a peça diz que são. */}
            <Peca className="lg:col-span-2">
              <Marcador>Prova de entrega</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">Você sabe que chegou.</h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Aberturas e downloads contados, com quem baixou. “Não recebi” deixa de ser conversa.
              </p>
              <svg viewBox="0 0 200 56" preserveAspectRatio="none" className="mt-auto h-14 w-full" aria-hidden>
                <path d="M0 50 L25 44 L50 46 L75 30 L100 34 L125 18 L150 22 L175 10 L200 8 L200 56 L0 56 Z" fill="rgba(20,20,20,0.06)" />
                <path
                  d="M0 50 L25 44 L50 46 L75 30 L100 34 L125 18 L150 22 L175 10 L200 8"
                  fill="none"
                  stroke="var(--h-tinta)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="flex gap-6">
                <p>
                  <span className="home-titulo block text-3xl font-semibold leading-none">
                    <Conta ate={14} />
                  </span>
                  <span className="text-xs text-[var(--h-tinta-3)]">aberturas</span>
                </p>
                <p>
                  <span className="home-titulo block text-3xl font-semibold leading-none">
                    <Conta ate={312} />
                  </span>
                  <span className="text-xs text-[var(--h-tinta-3)]">downloads · exemplo</span>
                </p>
              </div>
            </Peca>

            {/* A lixeira — a galeria vai e volta. */}
            <Peca className="lg:col-span-2">
              <Marcador>Lixeira</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">Lixeira de {PRAZO_LIXEIRA_DIAS} dias.</h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Apagou uma galeria sem querer? Fotos, capítulos e a escolha do cliente voltam com um clique.
              </p>
              <div className="relative mt-auto flex h-20 items-center justify-between" aria-hidden>
                <div className="home-lixo-arquivo flex items-center gap-2.5 rounded-xl bg-[var(--h-papel)] py-2 pl-2 pr-3 ring-1 ring-[var(--h-linha)]">
                  <img
                    src={fotos[destaque.capa].miniatura ?? fotos[destaque.capa].src}
                    alt=""
                    loading="lazy"
                    className="h-11 w-8 rounded object-cover"
                  />
                  <span className="text-[13px] font-medium">{destaque.titulo}</span>
                </div>
                <div className="grid h-16 w-14 place-items-end justify-center rounded-b-xl border-[1.5px] border-t-[5px] border-[var(--h-tinta-3)] pb-1.5 font-mono text-[10px] text-[var(--h-tinta-3)]">
                  {PRAZO_LIXEIRA_DIAS} d
                </div>
              </div>
            </Peca>

            {/* Os capítulos — a árvore de pastas vira as abas da galeria. */}
            <Peca className="lg:col-span-3">
              <Marcador>Capítulos</Marcador>
              <h3 className="home-titulo text-2xl font-semibold leading-tight">As subpastas viram capítulos.</h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Suba a pasta do trabalho: a organização que você fez no computador chega igual ao cliente,
                na ordem do dia.
              </p>
              <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4" aria-hidden>
                <ul className="font-mono text-[12.5px] leading-[1.9] text-[var(--h-tinta-2)]">
                  <li className="truncate">Casamento/</li>
                  <li className="truncate">├ 01 Making of/</li>
                  <li className="truncate">├ 02 Cerimônia/</li>
                  <li className="truncate">└ 03 Festa/</li>
                </ul>
                <span className="text-[var(--h-tinta-3)]">→</span>
                <div className="flex flex-col gap-1.5 text-[13px]">
                  <span className="truncate rounded-lg bg-[var(--h-tinta)] px-2.5 py-1.5 text-white">Making of</span>
                  <span className="truncate rounded-lg bg-[var(--h-papel)] px-2.5 py-1.5 ring-1 ring-[var(--h-linha)]">Cerimônia</span>
                  <span className="truncate rounded-lg bg-[var(--h-papel)] px-2.5 py-1.5 ring-1 ring-[var(--h-linha)]">Festa</span>
                </div>
              </div>
            </Peca>

            {/* Brasileira — fatos conferíveis, no papel quente de antes. */}
            <Peca className="home-peca-quente lg:col-span-3">
              <Marcador>Feita no Brasil</Marcador>
              <h3 className="home-titulo text-[clamp(1.9rem,3vw,2.6rem)] font-semibold leading-[1]">
                Brasileira desde o começo.
              </h3>
              <p className="text-[15px] text-[var(--h-tinta-2)]">
                Desenvolvida no Brasil, a partir da rotina de quem também trabalha com fotografia.
              </p>
              <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-4 pt-2">
                {[
                  {
                    t: "Preço em real",
                    v: formatarReais(MENOR_ESPACO.precoCentavos),
                    d: `por mês, no plano de ${formatarGb(MENOR_ESPACO.gb)}`,
                  },
                  { t: "Pagamento no Brasil", v: "Pix, boleto ou cartão", d: "Cobrança recorrente em real" },
                  { t: "Atendimento em português", v: marca.whatsappVisivel, d: "Quem responde é quem constrói" },
                  { t: "Evolução junto", v: "Em beta", d: "Perto o suficiente para ouvir quem usa" },
                ].map((p) => (
                  <div key={p.t} className="min-w-0">
                    <dt className="text-xs text-[var(--h-tinta-3)]">{p.t}</dt>
                    <dd>
                      <span className="home-titulo block text-xl font-semibold leading-tight tabular-nums">{p.v}</span>
                      <span className="block text-[13px] text-[var(--h-tinta-2)]">{p.d}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Peca>
          </div>

          {/* O que não ganhou peça própria continua dito, em uma linha cada. */}
          <div className="mt-10 grid gap-x-10 border-t border-[var(--h-linha)] sm:grid-cols-2 lg:grid-cols-4">
            {E_TAMBEM.map((r, i) => (
              <Revelar key={r.titulo} atraso={(i % 4) * 80}>
                <div className="py-6">
                  <h3 className="home-titulo text-lg font-semibold">{r.titulo}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--h-tinta-2)]">{r.texto}</p>
                </div>
              </Revelar>
            ))}
          </div>
        </div>
      </section>

      {/* ── 10 · foto + filme — só quando o vídeo for validado ──────────── */}
      {VIDEO_LIBERADO && (
        <section className="py-24 lg:py-32">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <Marcador>Foto + filme</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Um trabalho. Uma entrega.</h2>
            <p className={`${TEXTO_SECAO} mt-6`}>
              Fotografias e filmes podem compartilhar a mesma experiência de entrega. O vídeo utiliza
              o espaço do plano, sem cobrança separada por hora.
            </p>
          </div>
        </section>
      )}

      {/* ── 11 · respiro ──────────────────────────────────────────────────
          A foto desliza devagar enquanto passa pela tela (03/10/2026) — só
          onde o navegador anima pela rolagem (`.home-respiro-foto`). */}
      <section className="relative isolate overflow-hidden">
        <img
          src={fotos.respiro.src}
          alt={fotos.respiro.descricao}
          loading="lazy"
          width={fotos.respiro.largura}
          height={fotos.respiro.altura}
          className="home-respiro-foto h-[78svh] min-h-[420px] w-full object-cover"
          style={{ objectPosition: `${fotos.respiro.focoX}% ${fotos.respiro.focoY}%` }}
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.55),transparent_45%)]"
          aria-hidden
        />
        <p className="home-titulo absolute bottom-10 left-4 right-4 mx-auto max-w-7xl text-[clamp(2rem,4.5vw,3.6rem)] font-semibold leading-[1.02] text-white sm:left-6 sm:right-6">
          O trabalho é seu.
          <br />A entrega também.
        </p>
      </section>

      {/* ── 12 · planos ─────────────────────────────────────────────────── */}
      <section id="planos" className="scroll-mt-16 py-24 lg:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[4fr_7fr]">
          <Revelar className="lg:sticky lg:top-28 lg:self-start">
            <Marcador>Planos</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Escolha o espaço. O resto vem junto.</h2>
            <p className={`${TEXTO_SECAO} mt-6`}>
              Encontre o armazenamento que acompanha o volume do seu estúdio.
            </p>
            <p className="mt-4 text-[var(--h-tinta-2)]">
              Os recursos essenciais acompanham os planos. O que muda é o espaço disponível.
            </p>
            <div className="mt-8">
              <Link href="/cadastrar" className={CTA}>
                Começar grátis
              </Link>
              <p className="mt-3 text-sm text-[var(--h-tinta-3)]">14 dias grátis · sem cartão</p>
            </div>
          </Revelar>
          <MontadorPlano comFilme={VIDEO_LIBERADO} explicarCofre={false} />
        </div>

        {/*
          ── A ATOMATIZA, NA HORA DO PREÇO (30/09/2026) ──────────────────────

          Juan: "adicionar na página inicial algo que envolva 'conheça também o
          nosso sistema de gestão Atomatiza'". Mora aqui, embaixo dos planos,
          porque o motivo concreto de conhecer é o desconto do combo — que
          existe e já cobra no Asaas (`config/combo.ts`). Um bloco discreto, e
          não uma seção: a estratégia pede personalidade própria para cada
          marca, e a Galeria não pode virar vitrine da Atomatiza. O texto usa a
          proposta da marca ("cadastrar menos vezes") em vez de uma lista de
          funções que a home não tem como conferir.
        */}
        <div className="mx-auto mt-16 max-w-7xl px-4 sm:px-6 lg:mt-20">
          <Revelar className="flex flex-col gap-6 rounded-3xl border border-[var(--h-linha)] bg-white p-6 sm:p-8 md:flex-row md:items-center md:justify-between md:gap-10">
            <div className="max-w-2xl">
              <p className={SOBRANCELHA}>Também de quem faz a Galeria Átomo</p>
              <h3 className="home-titulo mt-3 text-2xl font-semibold text-[var(--h-tinta)] sm:text-3xl">
                Conheça também a Atomatiza.
              </h3>
              <p className="mt-3 leading-relaxed text-[var(--h-tinta-2)]">
                Gestão para estúdios de fotografia, feita para as partes da empresa conversarem
                entre si: cadastrar menos vezes, procurar menos e enxergar melhor o próprio estúdio.
                Quem assina as duas paga de {formatarReais(COMBO_MENOR)} a {formatarReais(COMBO_MAIOR)} a
                menos por mês.
              </p>
            </div>
            <a
              href={URL_ATOMATIZA}
              target="_blank"
              rel="noopener"
              className={`${CTA_SECUNDARIO} shrink-0 self-start md:self-auto`}
            >
              Conhecer a Atomatiza
            </a>
          </Revelar>
        </div>
      </section>

      {/* ── 13 · três perguntas ─────────────────────────────────────────── */}
      <section id="comparativo" className="scroll-mt-16 border-t border-[var(--h-linha)] bg-white py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Revelar className="max-w-3xl">
            <Marcador>Antes de decidir</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>
              Três perguntas para fazer a qualquer galeria. Inclusive à nossa.
            </h2>
          </Revelar>
          <ol className="mt-14 border-t border-[var(--h-linha)]">
            {PERGUNTAS.map((p, i) => (
              <Revelar key={p.pergunta} atraso={i * 80}>
                <li className="grid gap-4 border-b border-[var(--h-linha)] py-9 md:grid-cols-[1fr_1fr] md:gap-12">
                  <div className="flex gap-5">
                    <span className="font-mono text-sm text-[var(--h-tinta-3)]" aria-hidden>
                      0{i + 1}
                    </span>
                    <h3 className="home-titulo text-2xl font-semibold leading-snug">{p.pergunta}</h3>
                  </div>
                  <p className="text-lg leading-relaxed text-[var(--h-tinta-2)]">{p.resposta}</p>
                </li>
              </Revelar>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 14 · segurança — só mecanismo que existe (briefing §18) ─────── */}
      <section className="py-24 lg:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[5fr_7fr]">
          <Revelar>
            <Marcador>Segurança</Marcador>
            <h2 className={`${TITULO_SECAO} mt-4`}>Seu trabalho precisa estar em boas mãos.</h2>
            <p className={`${TEXTO_SECAO} mt-6`}>
              O que protege cada entrega, dito sem marketing — e o que ainda não existe, dito também.
            </p>
            <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-[var(--h-linha)]">
              <p className="font-medium">O teste dos dez segundos</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--h-tinta-2)]">
                Em qualquer galeria com senha — a nossa inclusive —, abra uma foto numa aba anônima.
                Se ela carregar sem pedir a senha, a senha trancava só a porta.
              </p>
            </div>
          </Revelar>
          <div>
            <dl className="divide-y divide-[var(--h-linha)] border-y border-[var(--h-linha)]">
              {SEGURANCA.map(([t, d]) => (
                <div key={t} className="grid gap-1 py-5 sm:grid-cols-[14rem_1fr] sm:gap-6">
                  <dt className="font-medium">{t}</dt>
                  <dd className="text-[var(--h-tinta-2)]">{d}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 leading-relaxed text-[var(--h-tinta-2)]">
              Os originais ficam em armazenamento profissional, numa cópia só — não mantemos uma
              segunda cópia em outra empresa. Por isso: guarde os seus originais. A {marca.nome} é a
              entrega, não o backup.
            </p>
            <Link href="/seguranca" className="mt-6 inline-block font-medium underline underline-offset-4">
              Tudo explicado na página de segurança →
            </Link>
          </div>
        </div>
      </section>

      {/* ── 15 · perguntas frequentes ───────────────────────────────────── */}
      <section id="perguntas" className="scroll-mt-16 border-t border-[var(--h-linha)] bg-white py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Marcador>Dúvidas frequentes</Marcador>
          <h2 className={`${TITULO_SECAO} mt-4`}>Antes de começar.</h2>
          {/* O `<` escapado: um `</script>` dentro de uma resposta fecharia a
              tag. Conteúdo é nosso, mas a blindagem custa um replace. */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD).replace(/</g, "\\u003c") }}
          />
          {/* Quem é a casa (site, organização, produto) — ver
              `dadosEstruturadosDaCasa` em lib/metadados.ts. */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLd(dadosEstruturadosDaCasa(DESCRICAO)) }}
          />
          <div className="mt-10 border-t border-[var(--h-linha)]">
            {FAQ.map((p) => (
              <details key={p.pergunta} className="group border-b border-[var(--h-linha)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-lg font-medium">
                  {p.pergunta}
                  <span
                    aria-hidden
                    className="shrink-0 text-2xl leading-none text-[var(--h-tinta-3)] transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-[62ch] pb-6 leading-relaxed text-[var(--h-tinta-2)] [&_a]:underline [&_a]:underline-offset-4">
                  {p.resposta}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 16 · fecho ────────────────────────────────────────────────────
          Briefing §20 e §23: no fim, as identidades de novo, se deslocando
          devagar. Desde 03/10/2026 são duas esteiras em sentidos opostos, cada
          cartão com a fonte e as cores da sua galeria — a última imagem da
          página é a variedade dos fotógrafos, não a nossa marca. Cartões leves
          (capa e título), e não a galeria inteira: são muitos, e andando. */}
      <section className="overflow-hidden py-24 lg:py-32">
        <div className="home-esteiras grid gap-4">
          {[CARTOES_DO_FECHO, [...CARTOES_DO_FECHO].reverse()].map((fila, n) => (
            <div key={n} className={`home-esteira ${n === 1 ? "home-esteira-volta" : ""}`}>
              {[false, true].map((copia) => (
                <div key={String(copia)} className="flex shrink-0 gap-4" aria-hidden={copia || undefined}>
                  {fila.map(({ ident, lugar }) => {
                    const f = fotos[lugar];
                    return (
                      <div
                        key={lugar}
                        className="w-[15rem] shrink-0 overflow-hidden rounded-xl ring-1 ring-black/10"
                        style={{
                          ...variaveisDoTema(ident.aparencia),
                          background: "var(--g-fundo)",
                          color: "var(--g-texto)",
                        }}
                        data-demo-pb={ident.pretoEBranco ? "" : undefined}
                      >
                        <img
                          src={f.miniatura ?? f.src}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-36 w-full object-cover"
                          style={{ objectPosition: `${f.focoX}% ${f.focoY}%` }}
                        />
                        <div className="px-3 pb-3 pt-2.5">
                          <p
                            className="truncate text-[19px] leading-tight"
                            style={{ fontFamily: FONTES_TITULO[ident.aparencia.tipografia] }}
                          >
                            {ident.titulo}
                          </p>
                          <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] opacity-70">
                            {ident.rotulo}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Revelar className="mx-auto mt-16 max-w-2xl text-center">
            <h2 className={TITULO_SECAO}>Sua próxima entrega pode começar aqui.</h2>
            <p className={`${TEXTO_SECAO} mt-6`}>
              Crie sua primeira galeria e veja como ela fica com a sua fotografia e a sua marca.
            </p>
            <div className="mt-8">
              <Link href="/cadastrar" className={CTA}>
                Começar grátis
              </Link>
              <p className="mt-3 text-sm text-[var(--h-tinta-3)]">14 dias grátis · sem cartão</p>
            </div>
            <p className="home-titulo mt-14 text-lg font-semibold">
              {marca.nome}
              <span className="block text-sm font-normal text-[var(--h-tinta-3)]">Feita no Brasil.</span>
            </p>
          </Revelar>
        </div>
      </section>

      {/* ── 17 · rodapé ─────────────────────────────────────────────────────
          Sem "central de ajuda" e sem Instagram: nenhum dos dois existe hoje
          (conflitos C8 e C9 da leitura crítica). O canal que responde é o
          WhatsApp. */}
      <footer className="border-t border-[var(--h-linha)] bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 text-sm sm:px-6 md:grid-cols-4">
          <div>
            <p className="flex items-center gap-2">
              <span style={{ ["--acento" as string]: "#d9a441" }}>
                <MarcaSimbolo tamanho={24} />
              </span>
              <span className="home-titulo font-semibold">{marca.nome}</span>
            </p>
            <p className="mt-3 text-[var(--h-tinta-3)]">Galerias de entrega para fotógrafos. Feita no Brasil.</p>
          </div>
          <nav aria-label="Produto">
            <p className="font-medium">Produto</p>
            <ul className="mt-3 space-y-2 text-[var(--h-tinta-2)]">
              <li><a href="#exemplos" className="hover:text-[var(--h-tinta)]">Exemplos</a></li>
              <li><a href="#recursos" className="hover:text-[var(--h-tinta)]">Recursos</a></li>
              <li><a href="#planos" className="hover:text-[var(--h-tinta)]">Planos</a></li>
            </ul>
          </nav>
          <nav aria-label="Suporte">
            <p className="font-medium">Suporte</p>
            <ul className="mt-3 space-y-2 text-[var(--h-tinta-2)]">
              <li><a href={marca.whatsappLink} className="hover:text-[var(--h-tinta)]">WhatsApp {marca.whatsappVisivel}</a></li>
              <li><a href="#perguntas" className="hover:text-[var(--h-tinta)]">Dúvidas frequentes</a></li>
              <li><Link href="/entrar" className="hover:text-[var(--h-tinta)]">Entrar</Link></li>
            </ul>
          </nav>
          <nav aria-label="Legal">
            <p className="font-medium">Legal</p>
            <ul className="mt-3 space-y-2 text-[var(--h-tinta-2)]">
              <li><Link href="/termos" className="hover:text-[var(--h-tinta)]">Termos de uso</Link></li>
              <li><Link href="/privacidade" className="hover:text-[var(--h-tinta)]">Privacidade</Link></li>
              <li><Link href="/seguranca" className="hover:text-[var(--h-tinta)]">Segurança</Link></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-[var(--h-linha)]">
          <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-[var(--h-tinta-3)] sm:px-6">
            © {new Date().getFullYear()} {marca.nome}
          </p>
        </div>
      </footer>
    </main>
  );
}
