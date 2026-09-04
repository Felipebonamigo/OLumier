"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GaleriaGrade } from "./galeria-grade";
import type { Aparencia } from "@/config/aparencia";
import {
  montarLotes,
  baixarNoComputador,
  deveOferecerSalvar,
  salvarNoCelular,
} from "@/lib/salvar-client";
import { useSwipe } from "@/lib/usar-swipe";
import { EncontrarMe } from "./encontrar-me";

export interface ItemGaleria {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  /** miniatura da grade (~50 KB) */
  url: string;
  /**
   * Versão do lightbox (~400 KB). Só vem preenchida quando já é conhecida —
   * fotos de demonstração e a amostra da prévia. Nas outras, o lightbox pede à
   * rota `/api/g/<id>/urls` ao abrir e mostra a miniatura até chegar. O
   * original nunca vem: é pedido à mesma rota na hora de baixar.
   */
  urlGrande?: string;
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
  selecaoInicial,
  buscaPorRosto = null,
}: {
  itens: ItemGaleria[];
  permiteDownload: boolean;
  galeriaId: string;
  aparencia: Aparencia;
  capitulos: CapituloGaleria[];
  /** Palpite do servidor pelo user-agent, só para a primeira pintura não piscar. */
  celularProvavel: boolean;
  /**
   * A busca por rosto, quando o fotógrafo ligou. Null = o botão não existe.
   * O contato é do estúdio: é com ele que o convidado fala sobre as fotos.
   */
  buscaPorRosto?: { nomeEstudio: string; contato: string | null } | null;
  /**
   * Ids das fotos já escolhidas NESTA galeria. Desde a migração 019 a lista é
   * uma só, compartilhada: a noiva no celular e o noivo no notebook veem a mesma
   * escolha. Vem do servidor para a primeira pintura já sair com os corações
   * certos — buscar depois faria a galeria piscar de vazia para marcada.
   */
  favoritasIniciais: string[];
  /** Regras que o fotógrafo definiu para a escolha do álbum. */
  selecaoInicial: {
    limite: number | null;
    aberta: boolean;
    motivo: "fechada" | "prazo" | null;
  };
}) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [baixandoTudo, setBaixandoTudo] = useState(false);
  const [progressoLote, setProgressoLote] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  /* O servidor chuta pelo user-agent para a primeira pintura já sair certa; ao
     montar, a detecção de recurso (canShare) corrige o palpite. Sem o chute, o
     celular mostraria "Baixar" por um instante antes de virar "Salvar". */
  const [modoSalvar, setModoSalvar] = useState(celularProvavel);
  /* eslint-disable-next-line react-hooks/set-state-in-effect --
     A cascata é o objetivo, não efeito colateral: a detecção depende de API do
     navegador que não existe no servidor. Sem o palpite do user-agent na
     primeira pintura, o botão sairia errado por um instante; sem a correção ao
     montar, o palpite errado ficaria. Uma renderização extra, uma vez, ao abrir. */
  useEffect(() => setModoSalvar(deveOferecerSalvar()), []);

  const [favoritas, setFavoritas] = useState<Set<string>>(() => new Set(favoritasIniciais));
  const [soFavoritas, setSoFavoritas] = useState(false);
  /* As fotos em que o convidado se achou pela selfie. Null = sem filtro. Vive
     só nesta página: fechar a aba apaga, que é o que o texto prometeu. */
  const [encontradas, setEncontradas] = useState<Set<string> | null>(null);
  const [selecao, setSelecao] = useState(selecaoInicial);
  const [fechando, setFechando] = useState(false);

  const limite = selecao.limite;
  const cheia = limite !== null && favoritas.size >= limite;

  /*
   * URLs assinadas SOB DEMANDA (03/09/2026).
   *
   * O HTML traz só a miniatura; preview e original são pedidos à rota quando
   * precisam — ver `api/g/[id]/urls`. Os dois caches vivem em ref (é o que a
   * lógica consulta); `previews` é o espelho em estado, para a tela reagir
   * quando o preview de uma foto aberta chega. O original só é lido dentro de
   * ações, então não precisa de espelho.
   */
  const cachePreview = useRef(new Map<string, string>());
  const cacheOriginal = useRef(new Map<string, string>());
  const [previews, setPreviews] = useState<Map<string, string>>(() => new Map());

  const assinar = useCallback(
    async (ids: string[], tipo: "preview" | "download"): Promise<Map<string, string>> => {
      const cache = tipo === "preview" ? cachePreview.current : cacheOriginal.current;
      // Foto de demonstração não existe no banco; pedir por ela seria 400.
      const faltam = ids.filter((id) => !cache.has(id) && !id.startsWith("demo:"));
      if (faltam.length > 0) {
        const r = await fetch(`/api/g/${galeriaId}/urls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: faltam, tipo }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const { urls } = (await r.json()) as { urls: Record<string, string> };
        for (const [id, url] of Object.entries(urls)) cache.set(id, url);
        if (tipo === "preview") setPreviews(new Map(cache));
      }
      return cache;
    },
    [galeriaId],
  );

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

        /*
         * 409 é regra da seleção, não falha de rede: a lista encheu, o prazo
         * venceu ou alguém já clicou em "terminei" no outro aparelho. Cada um
         * tem sua frase — "não consegui salvar" mandaria a pessoa conferir a
         * conexão por um limite que o fotógrafo escolheu.
         */
        if (r.status === 409) {
          const d: { erro: "cheia" | "fechada" | "prazo"; limite: number | null } = await r.json();
          mexer(eraFavorita);
          if (d.erro === "cheia") {
            setAviso(
              `Você já escolheu ${d.limite} fotos, que é o combinado. Desmarque uma para trocar.`,
            );
          } else {
            /* Guardado fora do callback: dentro dele o TypeScript não mantém o
             * estreitamento do `else`, e "cheia" voltaria ao tipo. */
            const motivo = d.erro;
            setSelecao((s) => ({ ...s, aberta: false, motivo }));
            setAviso(
              motivo === "prazo"
                ? "O prazo para escolher terminou. Fale com quem enviou o link."
                : "A escolha foi encerrada. Fale com quem enviou o link.",
            );
          }
          return;
        }

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

  /**
   * "Terminei minha escolha" — o sinal que faltava para o fotógrafo.
   *
   * Confirma antes porque é uma porta que o cliente não reabre sozinho: depois
   * disso a lista tranca, e só o fotógrafo destranca.
   */
  const encerrarSelecao = useCallback(async () => {
    if (
      !confirm(
        `Encerrar a escolha com ${favoritas.size} ${favoritas.size === 1 ? "foto" : "fotos"}?\n\n` +
          "Depois disso a lista fica travada e quem fez as fotos é avisado. Para mudar, será preciso pedir a ele.",
      )
    ) {
      return;
    }
    setFechando(true);
    try {
      const r = await fetch("/api/g/" + galeriaId + "/favoritas", { method: "PUT" });
      if (!r.ok) throw new Error(String(r.status));
      setSelecao((s) => ({ ...s, aberta: false, motivo: "fechada" }));
      setAviso(null);
    } catch {
      setAviso("Não consegui encerrar agora. Confira sua conexão e tente de novo.");
    } finally {
      setFechando(false);
    }
  }, [galeriaId, favoritas.size]);

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
   * Ao abrir uma foto, pede o preview dela E dos vizinhos numa chamada só, e
   * pré-carrega os vizinhos. Quem navega de seta em seta vê a próxima aparecer
   * na hora, em vez de esperar o download a cada clique.
   *
   * Enquanto o preview não chega, a tela mostra a miniatura — que o navegador
   * já tem, porque acabou de pintá-la na grade. Ninguém vê tela em branco.
   */
  useEffect(() => {
    if (aberto === null) return;
    const vizinhos = [
      aberto,
      (aberto + 1) % itens.length,
      (aberto - 1 + itens.length) % itens.length,
    ];
    const ids = [...new Set(vizinhos)]
      .map((i) => itens[i])
      .filter((it) => !it.urlGrande)
      .map((it) => it.id);

    let cancelado = false;
    (async () => {
      try {
        const cache = ids.length > 0 ? await assinar(ids, "preview") : cachePreview.current;
        if (cancelado) return;
        for (const i of vizinhos.slice(1)) {
          const v = itens[i];
          const url = v.urlGrande ?? cache.get(v.id);
          if (v.tipo === "foto" && url) new Image().src = url;
        }
      } catch {
        /* A miniatura continua na tela; a próxima seta tenta de novo. */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [aberto, itens, assinar]);

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
    /*
     * O link do original nasce AGORA, pedido à rota — que recusa quando o
     * download está bloqueado. Antes o servidor decidia isso ao montar a
     * página; agora decide ao ser pedido, e o HTML nunca carrega o link.
     */
    let url: string | undefined;
    try {
      url = (await assinar([it.id], "download")).get(it.id);
    } catch {
      url = undefined;
    }
    if (!url) {
      setAviso("não consegui preparar o download. Tente de novo.");
      setTimeout(() => setAviso(null), 3000);
      return;
    }

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
    setBaixandoTudo(true);
    setProgressoLote(0);

    /*
     * Os links da galeria inteira, numa chamada só. Seiscentas URLs assinadas
     * são uns 400 KB de JSON — que só quem clicou em "baixar tudo" paga, em
     * vez de todo visitante pagar no HTML.
     */
    let cache: Map<string, string>;
    try {
      cache = await assinar(
        itens.map((it) => it.id),
        "download",
      );
    } catch {
      setAviso("não consegui preparar os downloads. Confira sua conexão e tente de novo.");
      setTimeout(() => setAviso(null), 4000);
      setBaixandoTudo(false);
      return;
    }

    // Só o que tem link de verdade. Numa galeria bloqueada a rota não entrega
    // nada, a lista fica vazia e o laço não roda — nada a baixar, nenhuma exceção.
    const baixaveis = itens
      .map((it) => ({ url: cache.get(it.id), nome: it.nome, bytes: it.bytes }))
      .filter((x): x is { url: string; nome: string; bytes: number } => Boolean(x.url));
    if (baixaveis.length === 0) {
      setBaixandoTudo(false);
      return;
    }

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
  const swipe = useSwipe(proximo, anterior);

  const item = aberto === null ? null : itens[aberto];
  /* O preview da foto aberta: o já conhecido, o que a rota devolveu, ou nada
     ainda — e aí a foto mostra a miniatura e o vídeo avisa que está vindo. */
  const urlGrandeAberta = item ? (item.urlGrande ?? previews.get(item.id)) : undefined;

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
        O combinado, dito ANTES da primeira marcação.

        A barra abaixo só nasce depois da primeira foto — e isso está certo para
        o BOTÃO de filtrar favoritas, que sem nenhuma favorita não faz nada. Mas
        o contador viajava junto, e contador não é botão: é a REGRA. O casal
        abria a galeria, marcava à vontade e descobria o limite ao ser recusado
        na foto seguinte. Regra que só aparece quando você a quebra não é aviso,
        é pegadinha.

        Some sozinho na primeira marcação, porque a partir dali quem conta é o
        contador da barra — dois números dizendo a mesma coisa competiriam.
        `scripts/testar-selecao.mjs` prende os dois lados: que o aviso existe com
        limite, e que ele NÃO aparece sem limite.
      */}
      {limite !== null && selecao.aberta && favoritas.size === 0 && (
        <p className="mt-6 text-center text-sm" style={{ color: "var(--g-suave)" }}>
          Escolha até <strong style={{ color: "var(--g-destaque)" }}>{limite} fotos</strong> para o
          álbum — toque no coração das que você quer.
        </p>
      )}

      {buscaPorRosto && (
        <EncontrarMe
          galeriaId={galeriaId}
          nomeEstudio={buscaPorRosto.nomeEstudio}
          contatoEstudio={buscaPorRosto.contato}
          encontradas={encontradas}
          aoEncontrar={setEncontradas}
        />
      )}

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

          {/*
            O contador só existe quando há limite. Sem limite ele seria um número
            crescendo sozinho, sem nada a dizer — e o botão ao lado já mostra
            quantas foram escolhidas.
          */}
          {limite !== null && selecao.aberta && (
            <span
              className="text-sm"
              style={{ color: cheia ? "var(--g-destaque)" : "var(--g-suave)" }}
            >
              {favoritas.size} de {limite}
              {cheia && " · desmarque uma para trocar"}
            </span>
          )}

          {selecao.aberta && (
            <button
              type="button"
              onClick={encerrarSelecao}
              disabled={fechando}
              className="rounded-full px-4 py-2 text-sm transition hover:opacity-85 disabled:opacity-50"
              style={{ border: "1px solid var(--g-linha)", color: "var(--g-suave)" }}
            >
              {fechando ? "Encerrando…" : "Terminei minha escolha"}
            </button>
          )}
        </div>
      )}

      {/*
        Seleção trancada. Aparece mesmo com zero fotos marcadas: quem abre o link
        depois do prazo precisa entender por que os corações não respondem — sem
        isto, o botão simplesmente não faz nada e parece defeito.
      */}
      {!selecao.aberta && selecao.motivo && (
        <p className="mt-6 text-center text-sm" style={{ color: "var(--g-suave)" }}>
          {selecao.motivo === "prazo"
            ? "O prazo para escolher as fotos terminou."
            : `Escolha encerrada${favoritas.size > 0 ? ` com ${favoritas.size} ${favoritas.size === 1 ? "foto" : "fotos"}` : ""}.`}{" "}
          Para mudar alguma coisa, fale com quem enviou o link.
        </p>
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
          /* Os dois filtros somam: "só as favoritas" E "só onde eu apareço"
             podem estar ligados ao mesmo tempo, e o resultado é a interseção. */
          const indices = capOriginal.indices.filter((i) => {
            const id = itens[i].id;
            if (soFavoritas && !favoritas.has(id)) return false;
            if (encontradas && !encontradas.has(id)) return false;
            return true;
          });
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
                /* Trancada, o coração vira só indicação do que foi escolhido.
                 * Deixar clicável para o servidor recusar depois faria o coração
                 * piscar e voltar — parece defeito, não regra. As marcadas
                 * continuam visíveis; o que some é a possibilidade de mexer. */
                disabled={!selecao.aberta}
                aria-label={
                  !selecao.aberta
                    ? `${it.nome}${ehFavorita ? " — escolhida" : ""}`
                    : ehFavorita
                      ? `Desmarcar ${it.nome}`
                      : `Marcar ${it.nome} como favorita`
                }
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
                  ${ehFavorita ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"}
                  ${!selecao.aberta && !ehFavorita ? "hidden" : ""}`}
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
                /* A miniatura segura o lugar até o preview chegar: mesma foto,
                   menos nítida, já em cache — melhor que tela vazia. */
                src={urlGrandeAberta ?? item.url}
                alt={item.nome}
                fetchPriority="high"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : urlGrandeAberta ? (
              <video
                src={urlGrandeAberta}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-lg"
              />
            ) : (
              <span className="text-sm" style={{ color: "var(--g-suave)" }}>
                preparando o vídeo…
              </span>
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
