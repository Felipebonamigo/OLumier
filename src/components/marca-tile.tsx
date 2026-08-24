import { marca } from "@/config/marca";

/**
 * A marca: O FEIXE ATRAVESSANDO A LENTE.
 *
 * Um anel — o "O" de Olumier, e a lente — cortado por um feixe de luz que entra
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
export function MarcaSimbolo({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {/* o feixe que entra: fino, frio, vindo de fora do quadro */}
      <path
        d="M 2 24 H 15"
        stroke="var(--luz)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* o anel: a lente, e o O */}
      <circle cx="24" cy="24" r="11.5" stroke="var(--luz)" strokeWidth="2.2" />
      {/* o feixe que sai — aberto, porque a luz foi trabalhada */}
      <path
        d="M 34 24 H 46 M 34.5 18.5 L 45 14 M 34.5 29.5 L 45 34"
        stroke="var(--luz)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* o ponto focal — o único âmbar, onde a luz se concentra */}
      <circle cx="24" cy="24" r="3.4" fill="var(--acento)" />
    </svg>
  );
}

/** Compatível com os usos antigos. Hoje desenha o símbolo livre, sem moldura. */
export function MarcaTile({ tamanho = 56 }: { tamanho?: number }) {
  return <MarcaSimbolo tamanho={tamanho} />;
}

export function MarcaLockup({ tamanho = 40 }: { tamanho?: number }) {
  return (
    <span className="flex items-center gap-3">
      <MarcaSimbolo tamanho={tamanho} />
      <span>
        {/*
          Espaçamento largo entre as letras: o nome é francês na origem e ganha
          ar de letreiro de cinema quando respira. Peso leve porque a marca não
          precisa gritar — quem grita na tela é a foto do cliente.
        */}
        <span className="block text-lg font-medium leading-tight tracking-[0.14em]">
          {marca.nome}
        </span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-texto-faint">
          galerias de entrega
        </span>
      </span>
    </span>
  );
}
