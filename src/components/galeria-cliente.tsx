"use client";

import { useCallback, useEffect, useState } from "react";
import { GaleriaGrade } from "./galeria-grade";
import type { Aparencia } from "@/config/aparencia";
import {
  montarLotes,
  baixarNoComputador,
  deveOferecerSalvar,
  salvarNoCelular,
} from "@/lib/salvar-client";
import { usarSwipe } from "@/lib/usar-swipe";

export interface ItemGaleria {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  /** miniatura da grade (~50 KB) */
  url: string;
  /** versão do lightbox (~400 KB) */
  urlGrande: string;
  /** original, com nome de arquivo para salvar */
  /** null quando a galeria nao permite download — ver page.tsx */
  urlDownload: string | null;
  bytes: number;
  largura: number | null;
  altura: number | null;
}

export interface CapituloGaleria {
  id: string;
  nome: string;
  /** índices em `itens` — o lightbox continua percorrendo a galeria inteira */
  indices: number[];
}

/**
 * A galeria que o cliente final vê. Fotos em grade, lightbox com teclado,
 * vídeo com player, download individual e em lote.
 */
export function GaleriaCliente({
  itens,
  permiteDownload,
  galeriaId,
  aparencia,
  capitulos,
  celularProvavel,
  favoritasIniciais,
}: {
  itens: ItemGaleria[];
  permiteDownload: boolean;
  galeriaId: string;
  aparencia: Aparencia;
  capitulos: CapituloGaleria[];
  /** Palpite do servidor pelo user-agent, só para a primeira pintura não piscar. */
  celularProvavel: boolean;
  /**
   * Ids das fotos que ESTE visitante já marcou. Vem do servidor para a primeira
   * pintura já sair com os corações certos — buscar depois faria a galeria
   * inteira piscar de vazia para marcada a cada visita.
   */
  favoritasIniciais: string[];
}) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [baixandoTudo, setBaixandoTudo] = useState(false);
  const [progressoLote, setProgressoLote] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  /* O servidor chuta pelo user-agent para a primeira pintura já sair certa; ao
     montar, a detecção de recurso (canShare) corrige o palpite. Sem o chute, o
     celular mostraria "Baixar" por um instante antes de virar "Salvar". */
  const [modoSalvar, setModoSalvar] = useState(celularProvavel);
  useEffect(() => setModoSalvar(deveOferecerSalvar()), []);

  const [favoritas, setFavoritas] = useState<Set<string>>(() => new Set(favoritasIniciais));
  const [soFavoritas, setSoFavoritas] = useState(false);

  /*
   * Marca na tela ANTES de o servidor responder, e desfaz se falhar.
   *
   * Quem escolhe foto de álbum passa por centenas em sequência; esperar a ida e
   * volta a cada toque tornaria a tarefa insuportável, e numa rede de festa a
   * espera é longa. O pior caso aqui é um coração voltar sozinho — que a pessoa
   * vê acontecer, com o aviso explicando.
   */
  const alternarFavorita = useCallback(
    async (mediaId: string, eraFavorita: boolean) => {
      const mexer = (marcar: boolean) =>
        setFavoritas((atual) => {
          const nova = new Set(atual);
          if (marcar) nova.add(mediaId);
          else nova.delete(mediaId);
          return nova;
        });

      mexer(!eraFavorita);
      try {
        const r = await fetch("/api/g/" + galeriaId + "/favoritas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaId }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const d: { favorita: boolean } = await r.json();
        // O servidor é quem manda: se discordar do palpite, ele vence.
        mexer(d.favorita);
      } catch {
        mexer(eraFavorita);
        setAviso("Não consegui salvar a escolha. Confira sua conexão.");
      }
    },
    [galeriaId],
  );

  const fechar = useCallback(() => setAberto(null), []);
  const anterior = useCallback(
    () => setAberto((i) => (i === null ? null : (i - 1 + itens.length) % itens.length)),
    [itens.length],
  );
  const proximo = useCallback(
    () => setAberto((i) => (i === null ? null : (i + 1) % itens.length)),
    [itens.length],
  );

  // Setas e Esc: quem abre uma galeria de casamento navega no teclado.
  useEffect(() => {
    if (aberto === null) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowLeft") anterior();
      if (e.key === "ArrowRight") proximo();
    };
    window.addEventListener("keydown", aoTeclar);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = "";
    };
  }, [aberto, fechar, anterior, proximo]);

  /**
   * Pré-carrega a foto seguinte e a anterior enquanto o visitante olha a atual.
   * Quem navega de seta em seta vê a próxima aparecer instantaneamente, em vez
   * de esperar o download a cada clique.
   */
  useEffect(() => {
    if (aberto === null || itens.length < 2) return;
    for (const i of [(aberto + 1) % itens.length, (aberto - 1 + itens.length) % itens.length]) {
      const vizinho = itens[i];
      if (vizinho.tipo === "foto") new Image().src = vizinho.urlGrande;
    }
  }, [aberto, itens]);

  const registrar = (acao: string, mediaId?: string) => {
    // keepalive: o registro sobrevive à navegação que o download dispara.
    fetch(`/api/g/${galeriaId}/acesso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao, mediaId }),
      keepalive: true,
    }).catch(() => {});
  };

  /**
   * Uma foto: no celular abre o menu nativo (onde existe "Salvar imagem", que
   * grava nas Fotos); no computador baixa direto.
   */
  async function salvarUm(it: ItemGaleria) {
    // Sem URL = galeria com download bloqueado. O servidor nem gerou o link,
    // então não há o que baixar — e é assim que tem que ser.
    const url = it.urlDownload;
    if (!url) return;

    registrar("baixou", it.id);
    if (!modoSalvar) {
      baixarNoComputador(url, it.nome);
      return;
    }
    setAviso("preparando…");
    try {
      const r = await salvarNoCelular([{ url, nome: it.nome }]);
      if (r === "salvou") {
        setAviso("salvo ✓");
      } else if (r === "cancelou") {
        setAviso(null);
      } else {
        // sem-suporte, expirou ou sem-acesso: o menu nativo não rolou, mas a
        // foto não pode simplesmente não vir. Cai no download comum.
        baixarNoComputador(url, it.nome);
        setAviso(r === "expirou" ? "baixado — procure em Arquivos" : null);
      }
    } catch {
      setAviso(null);
      baixarNoComputador(url, it.nome);
    } finally {
      setTimeout(() => setAviso(null), 2500);
    }
  }

  /**
   * Galeria inteira.
   *
   * No celular, vai em lotes pelo menu nativo: a memória não aguenta 600 fotos
   * de uma vez, e cada lote termina nas Fotos em vez do app Arquivos.
   * No computador, dispara os downloads em sequência.
   *
   * Não geramos ZIP no servidor de propósito: empacotar exigiria puxar a galeria
   * inteira para o nosso servidor antes — lento para o casal e caro para nós.
   */
  async function salvarTudo() {
    // Só o que tem link de verdade. Numa galeria bloqueada a lista fica vazia e
    // o laço não roda — nada a baixar, nenhuma exceção.
    const baixaveis = itens
      .map((it) => ({ url: it.urlDownload, nome: it.nome, bytes: it.bytes }))
      .filter((x): x is { url: string; nome: string; bytes: number } => Boolean(x.url));
    if (baixaveis.length === 0) return;

    setBaixandoTudo(true);
    setProgressoLote(0);
    registrar("baixou_tudo");

    try {
      if (modoSalvar) {
        /*
         * Lotes por MEMÓRIA, não por contagem. O menu nativo precisa dos
         * arquivos carregados como Blob; vinte fotos de 8 MB já são 160 MB, e um
         * vídeo de casamento sozinho derrubaria a aba. O que é grande demais vai
         * pelo download comum, que o navegador escreve direto no disco.
         */
        const { lotes, grandes } = montarLotes(baixaveis);
        let feitos = 0;

        for (const g of grandes) {
          baixarNoComputador(g.url, g.nome);
          setProgressoLote(++feitos);
          await new Promise((r) => setTimeout(r, 700));
        }

        for (const lote of lotes) {
          const inicio = feitos;
          const r = await salvarNoCelular(lote, (baixados) =>
            setProgressoLote(inicio + baixados),
          );
          // Fechou o menu: entende-se como "chega", e não como erro.
          if (r === "cancelou") break;
          if (r !== "salvou") {
            // Antes só "sem-suporte" caía no download; "expirou" e "sem-acesso"
            // viravam erro vermelho e o casal ficava sem as fotos. Qualquer
            // desfecho que não seja "salvou" precisa entregar os arquivos.
            for (const it of lote) baixarNoComputador(it.url, it.nome);
            if (r === "expirou") {
              setAviso("baixados — procure em Arquivos");
            }
          }
          feitos += lote.length;
          setProgressoLote(feitos);
        }
      } else {
        for (let i = 0; i < baixaveis.length; i++) {
          baixarNoComputador(baixaveis[i].url, baixaveis[i].nome);
          setProgressoLote(i + 1);
          // Intervalo curto: o navegador ignora downloads disparados todos juntos.
          await new Promise((r) => setTimeout(r, 700));
        }
      }
    } catch {
      setAviso("não consegui salvar tudo. Tente em partes.");
      setTimeout(() => setAviso(null), 4000);
    } finally {
      setBaixandoTudo(false);
    }
  }

  // Arrastar para o lado troca de foto — o gesto que todo app de fotos tem.
  const swipe = usarSwipe(proximo, anterior);

  const item = aberto === null ? null : itens[aberto];

  return (
    <>
      {permiteDownload && itens.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={salvarTudo}
            disabled={baixandoTudo}
            className="rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-85 disabled:opacity-60"
            style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
          >
            {baixandoTudo
              ? `${modoSalvar ? "Salvando" : "Baixando"} ${progressoLote} de ${itens.length}…`
              : modoSalvar
                ? `Salvar as ${itens.length} fotos no celular`
                : `↓ Baixar tudo (${itens.length})`}
          </button>

          <span className="text-center text-xs" style={{ color: "var(--g-tenue)" }}>
            {aviso ??
              (modoSalvar
                ? "vai abrir o menu do seu celular — toque em “Salvar imagem”"
                : "sem limite de downloads — baixe quantas vezes quiser")}
          </span>
        </div>
      )}

      {/*
        Só aparece depois da primeira foto marcada. Antes disso seria um botão
        que não faz nada, ocupando o lugar mais nobre da tela — e explicando um
        recurso que a pessoa ainda não usou.
      */}
      {favoritas.size > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setSoFavoritas((v) => !v)}
            aria-pressed={soFavoritas}
            className="rounded-full px-4 py-2 text-sm transition hover:opacity-85"
            style={
              soFavoritas
                ? { background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }
                : { border: "1px solid var(--g-linha)", color: "var(--g-suave)" }
            }
          >
            {soFavoritas
              ? `Mostrando ${favoritas.size} ${favoritas.size === 1 ? "favorita" : "favoritas"} · ver todas`
              : `♥ Ver só as favoritas (${favoritas.size})`}
          </button>
        </div>
      )}

      {/* Menu de capítulos — o cliente pula direto ao momento que quer ver. */}
      {capitulos.length > 1 && (
        <nav
          className="sticky top-0 z-20 -mx-4 mt-8 overflow-x-auto px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
          style={{
            background: "color-mix(in srgb, var(--g-fundo) 88%, transparent)",
            borderBottom: "1px solid var(--g-linha)",
          }}
          aria-label="Capítulos da galeria"
        >
          <ul className="flex justify-center gap-1 whitespace-nowrap">
            {capitulos.map((c) => (
              <li key={c.id}>
                <a
                  href={`#cap-${c.id}`}
                  className="inline-block rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition hover:opacity-70"
                  style={{ color: "var(--g-suave)" }}
                >
                  {c.nome}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div id="fotos" className="mt-8 scroll-mt-4">
        {capitulos.map((capOriginal) => {
          /*
           * Com o filtro ligado, o capítulo mostra só o que foi marcado — e some
           * inteiro se nada ali foi. Manter um capítulo vazio com o título na
           * tela faria parecer que as fotos sumiram.
           */
          const indices = soFavoritas
            ? capOriginal.indices.filter((i) => favoritas.has(itens[i].id))
            : capOriginal.indices;
          if (indices.length === 0) return null;
          const cap = { ...capOriginal, indices };
          return (
          <section key={cap.id} id={`cap-${cap.id}`} className="mb-12 scroll-mt-16">
            {cap.nome && (
              <h2
                className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.3em]"
                style={{ color: "var(--g-destaque)" }}
              >
                {cap.nome}
              </h2>
            )}
            <GaleriaGrade
              aparencia={aparencia}
              quantidade={cap.indices.length}
              proporcao={(k) => {
                const it = itens[cap.indices[k]];
                return it.largura && it.altura ? it.largura / it.altura : 4 / 5;
              }}
              render={(k, estilo, classe) => {
                const i = cap.indices[k];
                const it = itens[i];
            // "linhas" e "editorial" definem a altura; nas outras a proporção
            // da própria foto manda, para o mural não ficar todo igual.
            const alturaPeloLayout =
              aparencia.grade === "linhas" || aparencia.grade === "editorial";
            const ehFavorita = favoritas.has(it.id);
            return (
              /*
               * O envoltório existe por uma razão simples: o coração é um botão,
               * a foto é um botão, e botão dentro de botão é HTML inválido — o
               * navegador desmonta a marcação e o clique passa a cair no lugar
               * errado. O estilo do layout vem para cá; a foto preenche.
               */
              <div key={it.id} style={estilo} className={`group relative ${classe}`}>
              <button
                type="button"
                onClick={() => {
                  setAberto(i);
                  /*
                   * Abrir uma FOTO não registra nada.
                   *
                   * Antes registrava "abriu" — a mesma ação que a carga da
                   * página usa. Um convidado que passasse por 200 fotos somava
                   * 200 aberturas, e o painel mostra esse número ao fotógrafo
                   * como prova de que a entrega chegou. O número ficava inflado
                   * a ponto de não significar nada, e a tabela de acessos
                   * crescia sem limite por causa disso.
                   *
                   * Vídeo continua registrando: "assistiu" é raro, é ação
                   * deliberada, e é informação que o fotógrafo realmente usa.
                   */
                  if (it.tipo === "video") registrar("assistiu", it.id);
                }}
                className="block h-full w-full overflow-hidden rounded-md"
                aria-label={`Abrir ${it.nome}`}
              >
                {it.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={it.url}
                    alt={it.nome}
                    // As primeiras já aparecem na tela: carregar na hora evita o
                    // "pisca cinza" de quem chega. O resto vem sob demanda.
                    loading={i < 8 ? "eager" : "lazy"}
                    fetchPriority={i < 4 ? "high" : "auto"}
                    decoding="async"
                    width={it.largura ?? undefined}
                    height={it.altura ?? undefined}
                    className={`transition duration-500 group-hover:scale-[1.03] ${
                      alturaPeloLayout
                        ? "h-full w-full object-cover"
                        : aparencia.grade === "quadrada"
                          ? "h-full w-full object-cover"
                          : "block h-auto w-full"
                    }`}
                  />
                ) : (
                  <span
                    className="grid h-full min-h-[180px] w-full place-items-center"
                    style={{ background: "var(--g-superficie)" }}
                  >
                    <span
                      className="grid h-14 w-14 place-items-center rounded-full"
                      style={{ border: "1px solid var(--g-destaque)" }}
                    >
                      <span
                        className="ml-1 border-y-[9px] border-y-transparent border-l-[15px]"
                        style={{ borderLeftColor: "var(--g-destaque)" }}
                      />
                    </span>
                  </span>
                )}
              </button>

              {/*
                O coração fica SEMPRE visível quando marcado, e só no hover
                quando não. Depender de hover para ver o que já foi escolhido
                deixaria a pessoa sem saber onde parou — e no celular não existe
                hover, então lá ele é sempre visível.
              */}
              <button
                type="button"
                onClick={() => alternarFavorita(it.id, ehFavorita)}
                aria-pressed={ehFavorita}
                aria-label={ehFavorita ? `Desmarcar ${it.nome}` : `Marcar ${it.nome} como favorita`}
                /* 44px no toque, 36px no mouse.
                 *
                 * O dedo não mira: 36px é menor que o mínimo de alvo que a
                 * Apple e o WCAG pedem, e este é o botão que o convidado mais
                 * usa — errar aqui abre a foto em tela cheia em vez de
                 * favoritar, que é o engano mais irritante possível no meio de
                 * uma galeria de casamento.
                 *
                 * Cresce só abaixo de 900px, que é a mesma fronteira que este
                 * arquivo já usa para decidir que não há hover. No desktop o
                 * ponteiro é preciso e o círculo menor pesa menos sobre a foto. */
                className={`absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full backdrop-blur transition max-[900px]:h-11 max-[900px]:w-11
                  ${ehFavorita ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"}`}
                style={{
                  background: "color-mix(in srgb, var(--g-fundo) 55%, transparent)",
                  color: ehFavorita ? "var(--g-destaque)" : "var(--g-texto)",
                }}
              >
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
                  fill={ehFavorita ? "currentColor" : "none"}
                  stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z" />
                </svg>
              </button>
              </div>
                );
              }}
            />
          </section>
          );
        })}
      </div>

      {/*
        Tela cheia. Tudo aqui é pintado com o tema DA GALERIA (--g-*), nunca com
        os tokens do painel: quem abre é o casal, e a cara é a que o fotógrafo
        escolheu. Com --void, a tela cheia passaria a seguir o claro/escuro do
        aparelho de quem está olhando — uma galeria "noite" abriria a foto
        sobre branco no celular de quem usa o tema claro.
      */}
      {item && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.nome}
          className="fixed inset-0 z-50 flex flex-col backdrop-blur"
          style={{ background: "color-mix(in srgb, var(--g-fundo) 97%, transparent)" }}
          onClick={fechar}
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
            <span className="truncate" style={{ color: "var(--g-suave)" }}>
              {aberto! + 1} de {itens.length}
            </span>
            <span className="flex items-center gap-2">
              {permiteDownload && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    salvarUm(item);
                  }}
                  className="rounded-lg border px-3 py-1.5 text-xs transition hover:opacity-70"
                  style={{ borderColor: "var(--g-linha)", color: "var(--g-texto)" }}
                >
                  {modoSalvar ? "Salvar no celular" : "↓ Baixar"}
                </button>
              )}
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="rounded-lg border px-3 py-1.5 text-xs transition hover:opacity-70"
                  style={{ borderColor: "var(--g-linha)", color: "var(--g-texto)" }}
              >
                Fechar ✕
              </button>
            </span>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
            {...swipe}
            onClick={(e) => e.stopPropagation()}
          >
            {item.tipo === "foto" ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
              <img
                src={item.urlGrande}
                alt={item.nome}
                fetchPriority="high"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <video
                src={item.urlGrande}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-lg"
              />
            )}
          </div>

          {itens.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  anterior();
                }}
                aria-label="Anterior"
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border transition"
                style={{
                  background: "color-mix(in srgb, var(--g-fundo) 70%, transparent)",
                  borderColor: "var(--g-linha)",
                  color: "var(--g-texto)",
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  proximo();
                }}
                aria-label="Próxima"
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border transition"
                style={{
                  background: "color-mix(in srgb, var(--g-fundo) 70%, transparent)",
                  borderColor: "var(--g-linha)",
                  color: "var(--g-texto)",
                }}
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
