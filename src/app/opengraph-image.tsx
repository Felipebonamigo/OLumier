import { ImageResponse } from "next/og";
import { marca } from "@/config/marca";

/*
 * Convenção nativa do Next: este arquivo VIRA a og:image do site — 1200×630,
 * o quadro que o WhatsApp desdobra quando alguém cola o link.
 *
 * Desenhada em JSX e renderizada pelo próprio Next (satori) em vez de um PNG
 * exportado de editor: o nome e a tagline saem de `config/marca.ts`, então a
 * imagem acompanhou as DUAS trocas de marca que este produto já viveu sem
 * ninguém lembrar de reexportar arte. Marca que mudou duas vezes em dois meses
 * não pode morar num arquivo estático.
 *
 * O visual é o do lockup: fundo escuro fixo (como a tira de filme — filme é
 * escuro nos dois temas), o nome em caixa alta com entreletra larga, o âmbar
 * só no que importa. Sem fonte carregada à mão: a padrão do renderizador
 * segura caixa alta com tracking bem, e cada fonte embutida aqui é peso que a
 * geração paga em toda visita de robô.
 */
export const alt = `${marca.nome} — ${marca.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  /* Derivado de `marca.nome`, nunca escrito à mão — mesma regra do lockup em
   * marca-tile.tsx: a última palavra é a forte. Nome de uma palavra cai
   * inteiro no peso forte. */
  const corte = marca.nome.lastIndexOf(" ");
  const leve = corte < 0 ? "" : marca.nome.slice(0, corte);
  const forte = corte < 0 ? marca.nome : marca.nome.slice(corte + 1);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #16130e 0%, #0d0c0a 55%, #050505 100%)",
          color: "#f4efe6",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: 76,
            letterSpacing: 14,
            textTransform: "uppercase",
          }}
        >
          {leve ? <span style={{ color: "#cfc8bb" }}>{leve}</span> : null}
          <span style={{ color: "#ffffff" }}>{forte}</span>
        </div>
        <div
          style={{
            marginTop: 30,
            fontSize: 34,
            color: "#d9a441",
            letterSpacing: 3,
          }}
        >
          {marca.tagline}
        </div>
        {/* Uma TEMPLATE STRING, e nao texto + expressao lado a lado: dois
            filhos num div sem display:flex derrubam o satori — e no dev a queda
            vira um "failed to pipe response" sem pilha, que custou uma bissecao
            de cinco passos para achar. letterSpacing em NUMERO (px) pelo mesmo
            motivo: o satori nao aceita em. */}
        <div
          style={{
            marginTop: 64,
            fontSize: 22,
            color: "#8a8378",
            letterSpacing: 6,
            textTransform: "uppercase",
          }}
        >
          {`galerias de entrega · ${marca.dominio}`}
        </div>
      </div>
    ),
    size,
  );
}
