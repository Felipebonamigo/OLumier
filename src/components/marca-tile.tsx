import { marca } from "@/config/marca";

/**
 * A marca: O FEIXE ATRAVESSANDO A LENTE.
 *
 * Um anel — a lente, e a órbita do átomo — cortado por um feixe de luz que entra
 * pela esquerda, atravessa e sai mais largo do outro lado. É a própria operação
 * do produto: a luz entra, passa pelo vidro, e chega maior do lado de fora.
 *
 * Nasceu junto com a paleta, não depois dela: o anel é PRATA (o vidro, a luz
 * fria da sala de projeção) e só o ponto focal é ÂMBAR. Mesma regra da
 * interface inteira — o âmbar é reservado ao que importa, então quando ele
 * aparece, quer dizer alguma coisa.
 *
 * A versão anterior (um anel com arco aceso, da era Fotônio recolorida) foi
 * descartada por isto: era desenho bonito herdando cor de outra ideia.
 *
 * SVG inline: escala sem pedido de rede, e o favicon (src/app/icon.svg) é este
 * mesmo desenho com fundo — mudou aqui, mude lá.
 */
/** As três órbitas. Mesma elipse, três giros — 60° entre elas é o que fecha a simetria. */
const ORBITAS = [30, 90, 150];

/*
 * Os elétrons ANDAM (27/08/2026, pedido do dono: "igual do atomatiza").
 *
 * O mecanismo é o mesmo da marca do Atomatiza, medido lá: cada elétron percorre
 * a própria elipse com <animateMotion>, dentro do <g> que gira a órbita — então
 * o caminho é UM só, e a rotação do grupo faz as três órbitas. As durações são
 * primas entre si e as largadas defasadas, para os três nunca se alinharem em
 * ciclo curto — alinhados, o átomo "pisca" em vez de girar.
 *
 * SMIL e não CSS porque CSS não anda sobre elipse sem truque de dupla rotação;
 * e SMIL ignora prefers-reduced-motion, então o <style> dentro do SVG esconde
 * os que andam e mostra os parados quando a pessoa pediu menos movimento — os
 * dois conjuntos existem no DOM, só um aparece.
 */
const CAMINHO_ORBITA = "M8.6,24 a15.4,6 0 1,0 30.8,0 a15.4,6 0 1,0 -30.8,0";
const RITMOS: { dur: string; begin: string }[] = [
  { dur: "1.8s", begin: "0s" },
  { dur: "2.3s", begin: "-0.7s" },
  { dur: "2.8s", begin: "-1.4s" },
];

/** Um elétron parado na ponta de cada órbita — o conjunto do reduced-motion. */
const ELETRONS = [
  [37.34, 31.7],
  [24, 8.6],
  [10.66, 31.7],
] as const;

export function MarcaSimbolo({ tamanho = 40 }: { tamanho?: number }) {
  /*
   * ── DUAS VERSÕES, E O MOTIVO ──────────────────────────────────────────
   * Três órbitas + seis lâminas + três elétrons são vinte e poucos traços. A
   * 76px isso é um desenho; a 16px — favicon e selo do rodapé da galeria — vira
   * borrão cinza. Marca que só funciona grande não é marca, é ilustração.
   *
   * Abaixo de 28px o desenho cai para o essencial: duas órbitas, o anel do
   * diafragma sem lâmina, e o núcleo âmbar. A silhueta continua a mesma, então
   * as duas se reconhecem como a mesma marca.
   */
  const miudo = tamanho < 28;

  /*
   * ── O FURO NO LUGAR DO DISCO ──────────────────────────────────────────
   * As órbitas passam POR DENTRO da câmera (a elipse tem ry=6, e a câmera tem
   * raio 7,5), então sem recorte o centro vira um emaranhado. Isso era
   * resolvido pintando um disco com `--marca-fundo`, a cor da página — e
   * funcionava enquanto o fundo fosse a página. Sobre FOTO virava um disco
   * branco (tema claro) ou preto (escuro) grudado na logo, que foi o que o
   * dono viu no print de 27/08/2026.
   *
   * A máscara esconde sem pintar: o furo é buraco de verdade, e a logo passa a
   * funcionar sobre qualquer fundo — página, foto, os dois temas.
   *
   * O raio do furo tem de cobrir a linha da câmera INTEIRA (raio + metade do
   * traço), senão sobra um fio de órbita rente à borda.
   *
   * O id leva o tamanho porque a marca aparece mais de uma vez na mesma página
   * (cabeçalho e rodapé). Dois símbolos do mesmo tamanho geram o mesmo id, e
   * isso é inofensivo de propósito: as máscaras são idênticas, então tanto faz
   * qual o navegador resolve.
   */
  const idFuro = `marca-furo-${tamanho}`;
  const raioFuro = miudo ? 8.6 : 8.4;

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .eletron-anda { display: none; }
          .eletron-parado { display: inline; }
        }
      `}</style>

      <defs>
        <mask id={idFuro} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect x="0" y="0" width="48" height="48" fill="#fff" />
          <circle cx="24" cy="24" r={raioFuro} fill="#000" />
        </mask>
      </defs>

      {/* as órbitas — o átomo, e a família — com o elétron andando em cada uma.
          Sob a máscara: o que passa atrás da câmera desaparece, inclusive o
          elétron na volta, que é o que se espera de quem passa por trás. */}
      <g mask={`url(#${idFuro})`}>
        {(miudo ? [30, 150] : ORBITAS).map((giro, i) => (
          <g key={giro} transform={`rotate(${giro} 24 24)`}>
            <ellipse
              cx="24"
              cy="24"
              rx="15.4"
              ry="6"
              stroke="var(--marca-traco)"
              strokeWidth={miudo ? 1.9 : 1.5}
              opacity={giro === 90 ? 0.85 : 1}
            />
            {!miudo && (
              <circle className="eletron-anda" r="1.5" fill="var(--marca-traco)">
                <animateMotion
                  dur={RITMOS[i].dur}
                  begin={RITMOS[i].begin}
                  repeatCount="indefinite"
                  path={CAMINHO_ORBITA}
                />
              </circle>
            )}
          </g>
        ))}

        {!miudo &&
          ELETRONS.map(([x, y]) => (
            <circle
              key={`${x}-${y}`}
              className="eletron-parado"
              style={{ display: "none" }}
              cx={x}
              cy={y}
              r="1.5"
              fill="var(--marca-traco)"
            />
          ))}
      </g>

      {/*
        A CÂMERA no núcleo é o que diz FOTOGRAFIA (27/08/2026, pedido do dono:
        "botar uma pequena câmera fotográfica no meio"). Substitui o diafragma
        de lâminas + faísca — o diafragma dizia "lente" para quem é do ofício;
        a câmera diz para qualquer um.

        A regra do âmbar continua a mesma da paleta inteira: ele é reservado à
        LUZ. Aqui, é o vidro da lente — a luz entra pela lente, que é a própria
        operação do produto.
      */}
      <circle
        cx="24"
        cy="24"
        r="7.5"
        fill="none"
        stroke="var(--marca-traco)"
        strokeWidth={miudo ? 2.1 : 1.8}
      />
      {miudo ? (
        /* Abaixo de 28px a câmera viraria borrão; fica o ponto de luz. */
        <circle cx="24" cy="24" r="3.1" fill="var(--acento)" />
      ) : (
        <>
          {/* o corpo, com o visor saltando do topo */}
          <rect
            x="19.6"
            y="21.7"
            width="8.8"
            height="5.6"
            rx="1.1"
            fill="none"
            stroke="var(--marca-traco)"
            strokeWidth="1.25"
          />
          <path
            d="M 22.4 21.7 L 23.1 20.4 L 24.9 20.4 L 25.6 21.7"
            fill="none"
            stroke="var(--marca-traco)"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          {/* a lente — e o único âmbar: a luz mora no vidro */}
          <circle
            cx="24"
            cy="24.5"
            r="1.95"
            fill="none"
            stroke="var(--marca-traco)"
            strokeWidth="1.1"
          />
          <circle cx="24" cy="24.5" r="0.95" fill="var(--acento)" />
        </>
      )}
    </svg>
  );
}

/** Compatível com os usos antigos. Hoje desenha o símbolo livre, sem moldura. */
export function MarcaTile({ tamanho = 56 }: { tamanho?: number }) {
  return <MarcaSimbolo tamanho={tamanho} />;
}

/**
 * O selo de beta.
 *
 * Some sozinho quando `marca.beta` virar false — não há segundo lugar para
 * lembrar de editar. Fica ao lado do nome, e não numa faixa no topo da tela:
 * faixa vira ruído que a pessoa aprende a não ver em dois dias, e este aviso
 * precisa continuar legível no dia em que alguém for subir um casamento.
 *
 * `title` em vez de texto extra porque o selo aparece em cabeçalho apertado; a
 * frase inteira mora no cadastro, que é onde a decisão acontece.
 */
export function SeloBeta() {
  if (!marca.beta) return null;
  return (
    <span
      title={marca.betaExplicacao}
      className="rounded-full border border-acento/40 px-2 py-0.5 font-mono text-[9px] uppercase leading-none tracking-[0.18em] text-acento-alto"
    >
      beta
    </span>
  );
}

export function MarcaLockup({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaSimbolo tamanho={tamanho} />
      <span>
        {/*
          O LOGOTIPO: duas palavras, dois pesos.

          "Galeria" leve e "Átomo" forte — é a hierarquia do nome. Galeria é o
          que a coisa É; Átomo é de quem ela é, e é a palavra que amarra na
          família. Ler nessa ordem, com esse contraste, diz a parceria sem
          precisar de uma linha explicando.

          Caixa alta e entreletra larga, como no lockup do Movimento Átomo. A
          Montserrat é a nossa e também a do site deles — não foi escolhida por
          isso, mas é o que faz as duas marcas parecerem da mesma casa sem
          copiar o desenho de ninguém.
        */}
        <span className="flex items-center gap-2">
          <span className="block text-[17px] uppercase leading-tight tracking-[0.2em]">
            {/* Derivado de `marca.nome`, nunca escrito à mão — é a regra do
                config/marca.ts. Nome de uma palavra só cai no peso forte
                inteiro, que continua sendo um logotipo válido. */}
            {(() => {
              const corte = marca.nome.lastIndexOf(" ");
              if (corte < 0) return <span className="font-semibold">{marca.nome}</span>;
              return (
                <>
                  <span className="font-light">{marca.nome.slice(0, corte)}</span>{" "}
                  <span className="font-semibold">{marca.nome.slice(corte + 1)}</span>
                </>
              );
            })()}
          </span>
          <SeloBeta />
        </span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-texto-faint">
          galerias de entrega
        </span>
      </span>
    </span>
  );
}
