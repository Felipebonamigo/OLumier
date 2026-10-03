"use client";
/* eslint-disable @next/next/no-img-element -- as fotos da home, servidas como estão. */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FONTES_TITULO } from "@/config/aparencia";
import type { FotosDaHome, Identidade } from "@/config/home-demonstracao";
import { useEhCelular, usePedeMenosMovimento } from "./usa-celular";

/**
 * SUBA. PERSONALIZE. ENTREGUE. — A PASTA VIRANDO GALERIA (03/10/2026).
 *
 * Era a seção dos três prints do painel. Virou uma narrativa presa à rolagem:
 * o texto dos três passos rola, e a cena ao lado fica parada, com as MESMAS
 * fotos andando de uma pasta para os capítulos, depois para a galeria e por
 * fim para dentro do celular do cliente. É o §28 do briefing — não esconder o
 * software — levado um passo além: o visitante vê o fluxo acontecer.
 *
 * O que é real e o que é ilustração: o comportamento é o do produto (seis
 * envios de cada vez, subpastas viram capítulos, o padrão de design, a contagem
 * de aberturas e downloads). Os nomes de arquivo e os números do painel são
 * exemplo, e a cena diz isso.
 *
 * Como funciona: cada passo do texto é observado; o que cruza a faixa do meio
 * da tela (no celular, a faixa logo abaixo da cena, que ocupa a metade de cima)
 * vira o passo da cena. As fotos são posicionadas em porcentagem da cena, e a
 * transição de `left/top/width/height` faz o resto — são onze fotos, não
 * precisa de biblioteca. No primeiro passo a pasta sobe e, um instante depois,
 * as fotos se separam em capítulos.
 *
 * No celular a cena gruda no topo (metade da tela) e os passos passam por
 * baixo. Sem prender a página: o Safari do iPhone briga com rolagem sequestrada.
 * Quem pediu menos movimento vê a cena trocar sem as fotos voarem.
 */

type Cena = "pasta" | "capitulos" | "galeria" | "entrega";

const CAPITULOS = [
  { nome: "Making of", de: 0, ate: 4 },
  { nome: "Cerimônia", de: 4, ate: 8 },
  { nome: "Festa", de: 8, ate: 11 },
];

const ENVIOS = [
  ["01 Making of/VK_0112.jpg", "8,4 MB"],
  ["01 Making of/VK_0118.jpg", "9,1 MB"],
  ["02 Cerimônia/VK_0431.jpg", "7,9 MB"],
  ["02 Cerimônia/VK_0440.jpg", "8,8 MB"],
  ["03 Festa/VK_0907.jpg", "10,2 MB"],
  ["03 Festa/VK_0921.jpg", "9,6 MB"],
];

/* [left, top, width, height, giro] em % da cena; `some` esconde. */
type Lugar = { l: number; t: number; w: number; h: number; g: number; some?: boolean };

function lugares(cena: Cena, quantas: number, celular: boolean): Lugar[] {
  return Array.from({ length: quantas }, (_, k): Lugar => {
    if (cena === "pasta") {
      return celular
        ? { l: 9 + k * 0.7, t: 30 + k * 1.5, w: 34, h: 40, g: k % 2 ? -5 : 4 }
        : { l: 10 + k * 0.7, t: 28 + k * 1.4, w: 28, h: 46, g: k % 2 ? -5 : 4 };
    }
    if (cena === "capitulos") {
      const c = CAPITULOS.findIndex((x) => k >= x.de && k < x.ate);
      const j = k - CAPITULOS[c].de;
      return celular
        ? { l: 6 + j * 22.5, t: 18 + c * 27, w: 20.5, h: 21, g: 0 }
        : { l: 6 + j * 17.5, t: 18 + c * 27, w: 15.5, h: 21, g: 0 };
    }
    if (cena === "galeria") {
      if (k === 0) return { l: 6, t: 12, w: 88, h: 42, g: 0 };
      const r = k - 1;
      const w = (88 - 4 * 1.5) / 5;
      return { l: 6 + (r % 5) * (w + 1.5), t: 57 + Math.floor(r / 5) * 20.5, w, h: 19, g: 0 };
    }
    /* entrega: tudo dentro do celular */
    const tl = celular ? 62 : 58;
    const L = tl + 33 * 0.08;
    const W = 33 * 0.84;
    if (k === 0) return { l: L, t: 10, w: W, h: 30, g: 0 };
    const r = k - 1;
    if (r > 5) return { l: L + W / 4, t: 78, w: W / 2, h: 10, g: 0, some: true };
    const w = (W - 2) / 2;
    return { l: L + (r % 2) * (w + 2), t: 42 + Math.floor(r / 2) * 16.5, w, h: 15, g: 0 };
  });
}

export function DaPastaAGaleria({
  identidade,
  fotos,
  endereco,
}: {
  identidade: Identidade;
  fotos: FotosDaHome;
  endereco: string;
}) {
  const celular = useEhCelular();
  const menosMovimento = usePedeMenosMovimento();
  const [passo, setPasso] = useState(0);
  const [separou, setSeparou] = useState(false);
  const passos = useRef<(HTMLLIElement | null)[]>([]);

  /* A capa primeiro, depois a grade — na ordem do dia. */
  const lista = [identidade.capa, ...identidade.fotos].slice(0, 11).map((id) => fotos[id]);
  const titulo = FONTES_TITULO[identidade.aparencia.tipografia];

  useEffect(() => {
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          const i = passos.current.indexOf(e.target as HTMLLIElement);
          if (i < 0) continue;
          /* Voltar ao primeiro passo recomeça a pasta. */
          if (i === 0) setSeparou(false);
          setPasso(i);
        }
      },
      { rootMargin: celular ? "-62% 0px -28% 0px" : "-45% 0px -45% 0px" },
    );
    for (const el of passos.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [celular]);

  /* No primeiro passo, a pasta sobe e depois se separa em capítulos. Quem
     pediu menos movimento já vê os capítulos. */
  useEffect(() => {
    if (passo !== 0 || separou || menosMovimento) return;
    const t = setTimeout(() => setSeparou(true), 2200);
    return () => clearTimeout(t);
  }, [passo, separou, menosMovimento]);

  const separado = separou || menosMovimento;
  const cena: Cena = passo === 0 ? (separado ? "capitulos" : "pasta") : passo === 1 ? "galeria" : "entrega";
  const posicoes = lugares(cena, lista.length, celular);

  const TEXTOS = [
    {
      n: "01 · Suba",
      titulo: "Arraste a pasta do trabalho inteira.",
      texto:
        "Seis arquivos sobem ao mesmo tempo, direto do navegador, e as subpastas viram capítulos na ordem do dia. Se a conexão cair, o envio retoma de onde parou.",
    },
    {
      n: "02 · Personalize",
      titulo: "Escolha a cara da entrega.",
      texto:
        "Capa, fonte, cores e grade, com a prévia da galeria de verdade. Acertou a combinação? Salve como padrão e a próxima galeria já nasce assim.",
    },
    {
      n: "03 · Entregue",
      titulo: "Mande o link e acompanhe.",
      texto:
        "O cliente abre no celular, sem instalar nada. Com senha e prazo, se você quiser. E você vê quantas vezes a galeria abriu e quantos downloads saíram.",
    },
  ];

  return (
    <div className="home-historia mt-14 grid gap-0 lg:mt-16 lg:grid-cols-[5fr_7fr] lg:gap-16">
      <ol className="order-2 lg:order-1">
        {TEXTOS.map((t, i) => (
          <li
            key={t.n}
            ref={(el) => {
              passos.current[i] = el;
            }}
            className={`home-passo flex min-h-[52vh] flex-col gap-3 pt-6 transition-opacity duration-500 lg:min-h-[78vh] lg:justify-center lg:pt-0 ${
              passo === i ? "opacity-100" : "opacity-35"
            }`}
          >
            <p className="font-mono text-xs tracking-[0.14em] text-[var(--h-tinta-3)]">{t.n.toUpperCase()}</p>
            <h3 className="home-titulo text-[1.9rem] font-semibold leading-tight">{t.titulo}</h3>
            <p className="max-w-[46ch] text-lg leading-relaxed text-[var(--h-tinta-2)]">{t.texto}</p>
          </li>
        ))}
      </ol>

      <div className="home-historia-palco order-1 lg:order-2">
        <div className="home-cena" data-cena={cena} aria-hidden>
          <p className="home-cena-rotulo">
            passo <b>0{passo + 1}</b> / 03
          </p>

          {/* pasta + envio */}
          <div className="home-cena-camada" data-camada="pasta">
            <div className="home-pasta">
              <p>
                <span className="home-icone-pasta" />
                Casamento {identidade.titulo}/
              </p>
            </div>
            <div className="home-envios">
              {ENVIOS.map(([nome, peso], k) => (
                <div key={nome} className="home-envio" style={{ ["--k" as string]: k } as CSSProperties}>
                  <span>{nome}</span>
                  <span>{peso}</span>
                  <i>
                    <b />
                  </i>
                </div>
              ))}
              <p className="home-envios-resumo">6 de cada vez · exemplo</p>
            </div>
          </div>

          {/* rótulos dos capítulos */}
          <div className="home-cena-camada home-cena-acima" data-camada="capitulos">
            {CAPITULOS.map((c, i) => (
              <span key={c.nome} className="home-cap-rotulo" style={{ top: `${12 + i * 27}%` }}>
                {c.nome}
                <em>{c.ate - c.de} fotos</em>
              </span>
            ))}
          </div>

          {/* o título da galeria, na fonte dela */}
          <div className="home-cena-camada home-cena-acima" data-camada="galeria">
            <p className="home-cena-titulo" style={{ fontFamily: titulo }}>
              {identidade.titulo}
            </p>
          </div>

          {/* o link e o que o painel conta */}
          <div className="home-cena-camada" data-camada="entrega">
            <div className="home-link">
              <small>link da entrega</small>
              {endereco}
            </div>
            <div className="home-metricas">
              <div>
                <b>14</b>
                <span>vezes aberta</span>
              </div>
              <div>
                <b>312</b>
                <span>downloads · exemplo</span>
              </div>
            </div>
            <div className="home-celular" style={{ left: celular ? "62%" : "58%" }} />
          </div>

          {lista.map((f, k) => {
            const p = posicoes[k];
            return (
              <div
                key={k}
                className="home-ladrilho"
                style={
                  {
                    "--k": k,
                    left: `${p.l}%`,
                    top: `${p.t}%`,
                    width: `${p.w}%`,
                    height: `${p.h}%`,
                    transform: `rotate(${p.g}deg)`,
                    opacity: p.some ? 0 : 1,
                  } as CSSProperties
                }
              >
                <img
                  src={f.miniatura ?? f.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: `${f.focoX}% ${f.focoY}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
