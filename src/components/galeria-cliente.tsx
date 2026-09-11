"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GaleriaGrade } from "./galeria-grade";
import type { Aparencia } from "@/config/aparencia";
import {
  entregarTudo,
  entregouUmaFoto,
  baixarNoComputador,
  deveOferecerSalvar,
  salvarNoCelular,
  prepararLote,
  acaoDeEntrega,
  compartilharPreparado,
} from "@/lib/salvar-client";
import { useSwipe } from "@/lib/usar-swipe";
import { EncontrarMe } from "./encontrar-me";
import { MenusDaGaleria } from "./menus-da-galeria";
import { fotoVisivel, indicesVisiveis, SEGUNDOS_POR_FOTO } from "@/lib/fotos-visiveis";
import { nomeComCapitulo, GRUPO_SEM_CAPITULO } from "@/lib/nome-de-arquivo";

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
/**
 * A sombra que separa um glifo branco de QUALQUER foto.
 *
 * Duas camadas de propósito: a de baixo, curta e opaca, desenha o contorno
 * imediato do ícone; a de cima, larga e fraca, escurece um halo maior para o
 * caso da foto estourada de sol. Uma sozinha falha num dos dois extremos.
 */
const GLIFO_SOBRE_FOTO = "drop-shadow(0 1px 1.5px rgba(0,0,0,.85)) drop-shadow(0 0 6px rgba(0,0,0,.45))";

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
  /*
   * O SEGUNDO TOQUE.
   *
   * `null` quando não há nada esperando. Com valor, a tela desenha um botão e
   * a entrega fica parada até a pessoa tocar nele — porque é DENTRO desse
   * toque que `share()` pode ser chamado. Ver `lib/salvar-client.ts`.
   */
  const [aguardandoToque, setAguardandoToque] = useState<{
    quantas: number;
    seguir: () => void;
  } | null>(null);
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

  /*
   * ── O SLIDESHOW (10/09/2026, pedido do Juan) ─────────────────────────────
   *
   * "Criar um sistema de SLIDESHOW com as fotos. Também pode ter nesse menu da
   * galeria." Não é tela nova: é o visualizador que já existe com um relógio em
   * cima. Ele já abre em tela cheia, já guarda a vizinha em cache, já anda de
   * seta e já fecha no Esc — o slideshow só decide QUANDO virar a página.
   *
   * Anda pelas fotos VISÍVEIS, e não por todas: com o filtro das favoritas
   * ligado, tocar a galeria inteira seria desfazer o filtro sem avisar.
   *
   * QUALQUER comando manual desliga o automático — seta, arrastar, fechar. Duas
   * mãos no mesmo volante é o defeito clássico deste recurso: a pessoa avança
   * uma foto, o relógio avança outra meio segundo depois, e ela perde a que
   * queria ver.
   */
  const [slideshow, setSlideshow] = useState(false);
  const filtros = useMemo(
    () => ({ soFavoritas, favoritas, encontradas }),
    [soFavoritas, favoritas, encontradas],
  );
  const ordemVisivel = useMemo(() => indicesVisiveis(itens, filtros), [itens, filtros]);

  const fechar = useCallback(() => {
    setSlideshow(false);
    setAberto(null);
  }, []);
  const anterior = useCallback(() => {
    setSlideshow(false);
    setAberto((i) => (i === null ? null : (i - 1 + itens.length) % itens.length));
  }, [itens.length]);
  const proximo = useCallback(() => {
    setSlideshow(false);
    setAberto((i) => (i === null ? null : (i + 1) % itens.length));
  }, [itens.length]);

  const tocarSlideshow = useCallback(() => {
    if (ordemVisivel.length < 2) return;
    setAberto(ordemVisivel[0]);
    setSlideshow(true);
  }, [ordemVisivel]);

  useEffect(() => {
    if (!slideshow || aberto === null) return;
    const relogio = setTimeout(() => {
      /* `indexOf` e não um contador próprio: a foto na tela é a verdade, e ela
         pode ter mudado por fora (o cliente marcou favorita e o filtro mexeu na
         lista). Quem sumiu da lista devolve -1, e a próxima é a primeira. */
      const posicao = ordemVisivel.indexOf(aberto);
      const proxima = ordemVisivel[(posicao + 1) % ordemVisivel.length];
      if (proxima === undefined) setSlideshow(false);
      else setAberto(proxima);
    }, SEGUNDOS_POR_FOTO * 1000);
    return () => clearTimeout(relogio);
  }, [slideshow, aberto, ordemVisivel]);

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
  /*
   * O NOME COM QUE O ARQUIVO CHEGA — a metade do celular (10/09/2026).
   *
   * No computador quem decide é o `Content-Disposition` assinado pela rota (a
   * URL é do armazém, outra origem, e aí o atributo `download` é ignorado). No
   * celular é o contrário: o arquivo vira `new File([blob], nome)` aqui dentro,
   * e o servidor não tem voz. São dois lugares decidindo o mesmo nome, e a
   * defesa contra divergirem é chamarem a MESMA função — ver
   * `lib/nome-de-arquivo.ts`.
   *
   * Só o nome do ARQUIVO. O nome de tela — legenda, `alt`, rótulo do botão —
   * continua sendo o que o fotógrafo enviou: prefixo ali seria ruído na
   * interface para resolver um problema que é da pasta de downloads.
   */
  const capituloDaFoto = useMemo(() => {
    const mapa = new Map<string, string>();
    /* Um grupo só não separa nada: todas levariam o mesmo prefixo. Mesma régua
       do menu de baixar e da rota que assina. */
    if (capitulos.length > 1) {
      for (const c of capitulos) {
        for (const i of c.indices) mapa.set(itens[i].id, c.nome || GRUPO_SEM_CAPITULO);
      }
    }
    return mapa;
  }, [capitulos, itens]);

  const nomeDeArquivo = useCallback(
    (it: ItemGaleria) => nomeComCapitulo(it.nome, capituloDaFoto.get(it.id) ?? null),
    [capituloDaFoto],
  );

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

    if (!modoSalvar) {
      registrar("baixou", it.id);
      baixarNoComputador(url, nomeDeArquivo(it));
      return;
    }
    setAviso("preparando…");
    try {
      /* O registro espera o desfecho pelo mesmo motivo do "baixar tudo": até
         05/09/2026 ele vinha antes de abrir o menu, então fechar o menu
         contava um download que nunca aconteceu. Ver `entregouUmaFoto`. */
      const r = await salvarNoCelular([{ url, nome: nomeDeArquivo(it) }]);
      if (entregouUmaFoto(r)) registrar("baixou", it.id);
      if (r === "salvou") {
        setAviso("salvo ✓");
      } else if (r === "cancelou") {
        setAviso(null);
      } else {
        // sem-suporte, expirou ou sem-acesso: o menu nativo não rolou, mas a
        // foto não pode simplesmente não vir. Cai no download comum.
        baixarNoComputador(url, nomeDeArquivo(it));
        setAviso("baixada — procure em Arquivos ou Downloads");
      }
    } catch {
      setAviso(null);
      registrar("baixou", it.id);
      baixarNoComputador(url, nomeDeArquivo(it));
    } finally {
      setTimeout(() => setAviso(null), 2500);
    }
  }

  /**
   * Um lote de fotos: a galeria inteira, ou UMA PASTA dela.
   *
   * No celular, vai em lotes pelo menu nativo: a memória não aguenta 600 fotos
   * de uma vez, e cada lote termina nas Fotos em vez do app Arquivos.
   * No computador, dispara os downloads em sequência.
   *
   * Não geramos ZIP no servidor de propósito: empacotar exigiria puxar a galeria
   * inteira para o nosso servidor antes — lento para o casal e caro para nós.
   * É também por isso que "separado em pastas" (pedido do Juan em 10/09) não é
   * um zip por capítulo: é o mesmo caminho, com a lista menor.
   */
  async function salvarLoteDeFotos(fotos: ItemGaleria[]) {
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
        fotos.map((it) => it.id),
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
    const baixaveis = fotos
      .map((it) => ({ url: cache.get(it.id), nome: nomeDeArquivo(it), bytes: it.bytes }))
      .filter((x): x is { url: string; nome: string; bytes: number } => Boolean(x.url));
    if (baixaveis.length === 0) {
      setBaixandoTudo(false);
      return;
    }

    /*
     * O REGISTRO VEM DEPOIS, e não aqui.
     *
     * Ficava exatamente neste ponto — logo após assinar as URLs — e por isso
     * contava o CLIQUE. O Juan tentou baixar tudo no celular em 05/09/2026,
     * não veio nada, e a aba Atividade marcou 1 download. A Atividade é prova
     * de entrega para o fotógrafo; número que sobe sem entrega é prova falsa,
     * e ela aparece justamente na conversa em que o cliente diz que não
     * recebeu.
     *
     * Toda a orquestração mora em `entregarTudo` (lib/salvar-client.ts), que é
     * pura e devolve o desfecho — é o que permite `testar-salvar-mobile.mjs`
     * perguntar "e se a pessoa fechar o menu?" sem um celular na mão.
     */
    try {
      const desfecho = await entregarTudo(baixaveis, {
        peloMenu: modoSalvar,
        /*
         * PREPARAR, PEDIR O TOQUE, COMPARTILHAR — nesta ordem, e é a correção
         * de 10/09/2026.
         *
         * `salvarNoCelular` fazia as três coisas de uma vez, e o Safari
         * recusava o menu porque a busca das fotos passava da janela do gesto.
         * O resultado era cair no download um a um: um diálogo de confirmação
         * por foto, que o Juan teve de clicar doze vezes.
         *
         * Aqui a parte lenta acontece primeiro e a tela mostra um botão. O
         * toque nele é um gesto NOVO, e os arquivos já estão na memória.
         */
        salvarLote: async (lote) => {
          const prontos = await prepararLote(lote, setProgressoLote);
          if (!prontos) return "sem-acesso";
          await new Promise<void>((seguir) =>
            setAguardandoToque({ quantas: prontos.length, seguir }),
          );
          setAguardandoToque(null);
          return compartilharPreparado(prontos);
        },
        baixar: baixarNoComputador,
        esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
        aoProgredir: setProgressoLote,
      });

      /* Baixar uma pasta não é baixar tudo — ver `acaoDeEntrega`. */
      if (desfecho.entregues > 0) registrar(acaoDeEntrega(fotos.length, itens.length));

      /* Cancelar é escolha da pessoa e não vira mensagem. O resto vira: quem
         batia em CORS via o contador chegar ao fim e nada acontecer, sem uma
         palavra — era o "não deu" dito em silêncio. */
      const aviso = desfecho.cancelado
        ? null
        : (desfecho.aviso ??
          (desfecho.entregues === 0 ? "não consegui salvar. Tente em partes." : null));
      if (aviso) {
        setAviso(aviso);
        setTimeout(() => setAviso(null), 4000);
      }
    } catch {
      setAviso("não consegui salvar tudo. Tente em partes.");
      setTimeout(() => setAviso(null), 4000);
    } finally {
      setBaixandoTudo(false);
    }
  }

  /*
   * AS PASTAS DO MENU DE BAIXAR (10/09/2026): "todas de uma única vez ou
   * separado em pastas", nas palavras do Juan.
   *
   * As pastas já existiam — são os CAPÍTULOS, que o envio por pasta do
   * Lightroom cria sozinho. Faltava poder baixar um só.
   *
   * Com UM capítulo apenas não há o que escolher: baixar a pasta é baixar a
   * galeria, e o item repetiria o de cima com outro nome.
   *
   * Cada pasta leva a lista CHEIA do capítulo, e não a filtrada: este menu fala
   * da galeria como o fotógrafo a organizou, e o número no rótulo é exatamente
   * o que vai vir. Quem está com o filtro das favoritas ligado lê "Cerimônia
   * (42)" e recebe 42.
   */
  const pastasParaBaixar =
    capitulos.length > 1
      ? capitulos.map((c) => ({
          id: c.id,
          nome: c.nome,
          quantas: c.indices.length,
          baixar: () => salvarLoteDeFotos(c.indices.map((i) => itens[i])),
        }))
      : [];

  // Arrastar para o lado troca de foto — o gesto que todo app de fotos tem.
  const swipe = useSwipe(proximo, anterior);

  const item = aberto === null ? null : itens[aberto];
  /* O preview da foto aberta: o já conhecido, o que a rota devolveu, ou nada
     ainda — e aí a foto mostra a miniatura e o vídeo avisa que está vindo. */
  const urlGrandeAberta = item ? (item.urlGrande ?? previews.get(item.id)) : undefined;

  return (
    <>
      {/*
        A BARRA DE MENUS (10/09/2026, pedido do Juan).

        Os comandos que antes vinham empilhados aqui — baixar tudo, filtrar
        favoritas, encerrar a escolha, pular de capítulo — moraram numa pilha de
        cinco blocos que empurrava as fotos meia tela para baixo. Agora moram
        atrás de dois nomes numa barra que acompanha a rolagem.

        O que continua FORA dela é o que não é comando: o aviso do limite, o
        recado de escolha encerrada, a busca por rosto e o botão do segundo
        toque — este porque nasce no meio de uma entrega em curso e precisa
        estar na frente dos olhos, não guardado.
      */}
      <MenusDaGaleria
        capitulos={capitulos}
        tocarSlideshow={ordemVisivel.length > 1 ? tocarSlideshow : null}
        favoritas={
          /* Sem escolha aberta e sem nenhuma marcada não há o que oferecer, e
             um menu com só o recado "escolha encerrada" dentro é enfeite. */
          selecao.aberta || favoritas.size > 0
            ? {
                quantas: favoritas.size,
                soFavoritas,
                alternarFiltro: () => setSoFavoritas((v) => !v),
                selecaoAberta: selecao.aberta,
                limite,
                cheia,
                encerrar: encerrarSelecao,
                fechando,
              }
            : null
        }
        baixar={
          permiteDownload && itens.length > 0
            ? {
                quantas: itens.length,
                modoSalvar,
                baixando: baixandoTudo,
                progresso: progressoLote,
                baixarTudo: () => salvarLoteDeFotos(itens),
                pastas: pastasParaBaixar,
              }
            : null
        }
      />

      {permiteDownload && itens.length > 0 && (aguardandoToque || aviso) && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {/*
            O BOTÃO DO SEGUNDO TOQUE.

            Aparece quando as fotos já estão na memória e só falta abrir o menu
            do celular. Existe porque o Safari exige que `share()` seja chamado
            de dentro de um gesto, e a busca das fotos passa dessa janela — sem
            este toque, a entrega caía no download um a um, com um diálogo de
            confirmação por foto (doze toques, no caso do Juan).

            Fica ACIMA do texto de ajuda e com a cor de ação: é o único lugar da
            tela que importa enquanto ele está lá, e a pessoa acabou de ver um
            contador andando — ela precisa entender na hora que a vez é dela.
          */}
          {aguardandoToque && (
            <button
              type="button"
              onClick={aguardandoToque.seguir}
              className="rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-85"
              style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
            >
              Salvar {aguardandoToque.quantas}{" "}
              {aguardandoToque.quantas === 1 ? "foto" : "fotos"} no celular
            </button>
          )}

          {/* Só o RECADO da vez. A ajuda permanente ("sem limite de
              downloads…") virou o rodapé do menu de baixar: dita ali, ela chega
              no momento em que a pessoa escolhe como baixar, e não como uma
              linha cinza fixa embaixo de uma barra. */}
          {aviso && (
            <span className="text-center text-xs" style={{ color: "var(--g-tenue)" }}>
              {aviso}
            </span>
          )}
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

      {/*
        O FILTRO LIGADO, dito fora do menu.

        Ligar "ver só as favoritas" esconde fotos, e quem esconde tem de avisar:
        sem esta linha, o cliente que ligou o filtro e rolou a página encontra
        uma galeria com um terço das fotos e nenhuma explicação à vista — o
        menu que ele usou já fechou.
      */}
      {soFavoritas && (
        <p className="mt-6 text-center text-sm" style={{ color: "var(--g-suave)" }}>
          Mostrando {favoritas.size} {favoritas.size === 1 ? "favorita" : "favoritas"} ·{" "}
          <button
            type="button"
            onClick={() => setSoFavoritas(false)}
            className="underline transition hover:opacity-70"
            style={{ color: "var(--g-destaque)" }}
          >
            ver todas
          </button>
        </p>
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

      {/* Os capítulos mudaram de casa: agora são a segunda linha da barra de
          menus, lá em cima. Duas faixas grudadas no topo brigariam pelo mesmo
          lugar — ver `menus-da-galeria.tsx`. */}

      <div id="fotos" className="mt-8 scroll-mt-4">
        {capitulos.map((capOriginal) => {
          /*
           * Com o filtro ligado, o capítulo mostra só o que foi marcado — e some
           * inteiro se nada ali foi. Manter um capítulo vazio com o título na
           * tela faria parecer que as fotos sumiram.
           */
          /* Os dois filtros somam: "só as favoritas" E "só onde eu apareço"
             podem estar ligados ao mesmo tempo, e o resultado é a interseção.
             A regra mora em `lib/fotos-visiveis.ts` porque o slideshow precisa
             da mesma resposta — duas cópias dela é como filtros discordam. */
          const indices = capOriginal.indices.filter((i) => fotoVisivel(itens[i].id, filtros));
          if (indices.length === 0) return null;
          const cap = { ...capOriginal, indices };
          return (
          <section key={cap.id} id={`cap-${cap.id}`} className="mb-12 scroll-mt-16">
            {cap.nome && (
              /*
                O NOME DO CAPÍTULO SEGUE O ALINHAMENTO, E NÃO É DA COR DO BOTÃO.

                Duas queixas do Juan atravessam a capa e continuavam valendo
                aqui embaixo — e eu tinha corrigido só a metade de cima:

                  "deixei os botões verdinhos e gostei, mas a logo também ficou
                   verde"  → era `--g-destaque`, a mesma variável do botão. Com
                   a cor escolhida, "Making Of" e "Cerimônia" ficavam verdes
                   junto. `--g-suave` é o secundário do tema, com contraste
                   medido em `variaveisDoTema`.

                  "queria que TODOS os textos estivessem alinhados pra esse
                   lado" → era `text-center` cravado. Com o eixo à esquerda, a
                   capa ia para a esquerda e o capítulo ficava no meio: "cada
                   coisa de um jeito", só que rolando a página para baixo.
              */
              <h2
                className={`mb-4 font-mono text-[11px] uppercase tracking-[0.3em] ${
                  aparencia.alinhamento === "esquerda" ? "text-left" : "text-center"
                }`}
                style={{ color: "var(--g-suave)" }}
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
                className="block h-full w-full overflow-hidden rounded-[var(--g-canto,6px)]"
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
                Os dois botões do card, no mesmo canto.

                O de BAIXAR é de 04/09/2026, e o pedido era literal: "sem
                precisar abrir individualmente". Quem escolhe foto de álbum
                passa por centenas em sequência, e abrir–baixar–fechar por foto
                é o atrito que faz o casal desistir e pedir tudo por WhatsApp.

                Ele só existe com download liberado — o mesmo interruptor que a
                rota `/urls` obedece. Botão que aparece e depois falha seria
                pior que botão nenhum.
              */}
              <span className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
              {permiteDownload && (
                <button
                  type="button"
                  onClick={() => salvarUm(it)}
                  aria-label={`Baixar ${it.nome}`}
                  /*
                    NO TOQUE ELE NÃO APARECE — e é a metade do conserto de
                    08/09/2026.

                    No computador ele custa zero enquanto o ponteiro está longe:
                    só existe no hover. No celular não existe hover, então ele
                    ficava permanente em TODA foto, ao lado do coração — dois
                    ícones por miniatura, na tela em que a miniatura é menor. O
                    Felipe mandou o print: "os botões de favorito e download
                    poluíram muito a imagem".

                    Sai do card, não do produto: abrir a foto e tocar em "Salvar
                    no celular" é um toque a mais, e o "Baixar tudo" continua no
                    topo. `testar-urls-sob-demanda.mjs` confere que esse caminho
                    existe — sem ele, tirar o botão deixaria o celular sem saída.
                  */
                  className="grid h-9 w-9 place-items-center rounded-full opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:hidden"
                  style={{ color: "#fff", filter: GLIFO_SOBRE_FOTO }}
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
                    fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16" />
                  </svg>
                </button>
              )}

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
                /* O posicionamento saiu daqui para o <span> que agrupa os dois
                   botões — senão o de baixar e o coração se sobreporiam no
                   mesmo canto. */
                className={`grid h-9 w-9 place-items-center rounded-full transition max-[900px]:h-11 max-[900px]:w-11
                  ${ehFavorita ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-[900px]:opacity-100"}
                  ${!selecao.aberta && !ehFavorita ? "hidden" : ""}`}
                /*
                  GLIFO COM SOMBRA, E NÃO DISCO ATRÁS DO ÍCONE.

                  O ícone precisa se destacar de qualquer foto — clara, escura,
                  contrastada. O jeito antigo era desenhar um círculo de
                  `--g-fundo` a 55% com desfoque atrás dele; num tema claro isso
                  é uma bolha branca leitosa, e no print do Felipe elas caíam em
                  cima dos rostos.
                  
                  A sombra faz o mesmo trabalho ocupando quase nenhuma área: o
                  glifo branco se separa do fundo pela borda escura, não por uma
                  mancha. O alvo de 44px no toque continua o mesmo — o que
                  encolheu foi o que se VÊ, não o que se acerta com o dedo.

                  Marcado, o coração fica na cor de destaque do estúdio; a
                  sombra é o que garante que ele se leia mesmo quando a cor
                  escolhida é clara (o verde pálido do Juan, por exemplo).
                */
                style={{
                  color: ehFavorita ? "var(--g-destaque)" : "#fff",
                  filter: GLIFO_SOBRE_FOTO,
                }}
              >
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
                  fill={ehFavorita ? "currentColor" : "none"}
                  stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M12 20.5 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z" />
                </svg>
              </button>
              </span>
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
          {/*
            FECHAR À ESQUERDA, pedido do sócio em 04/09/2026.

            Não é só gosto: em tela cheia o polegar do celular alcança o canto
            inferior e a lateral ESQUERDA sem trocar a mão, e é de onde vem o
            gesto de voltar em todo aplicativo de fotos. À direita ele dividia o
            canto com "Baixar" — dois alvos vizinhos, um que fecha e outro que
            salva, no lugar onde a pessoa toca às pressas para sair.

            O contador vai para o meio: ele é informação, não ação, e no meio
            não disputa canto com botão nenhum.
          */}
          <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className="rounded-lg border px-3 py-1.5 text-xs transition hover:opacity-70"
              style={{ borderColor: "var(--g-linha)", color: "var(--g-texto)" }}
            >
              ✕ Fechar
            </button>
            {/* Com o automático ligado, o contador diz também POR QUE a foto
                troca sozinha — sem isso, a primeira virada parece defeito. */}
            <span className="truncate" style={{ color: "var(--g-suave)" }}>
              {slideshow && "▶ "}
              {aberto! + 1} de {itens.length}
              {slideshow && " · as setas assumem o controle"}
            </span>
            {permiteDownload ? (
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
            ) : (
              /* Espaço vazio do tamanho do botão: sem ele o `justify-between`
                 puxaria o contador para a direita e ele mudaria de lugar
                 conforme a galeria permitir download ou não. */
              <span aria-hidden="true" className="w-16" />
            )}
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
                className="max-h-full max-w-full rounded-[var(--g-canto,6px)] object-contain"
              />
            ) : urlGrandeAberta ? (
              <video
                src={urlGrandeAberta}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-[var(--g-canto,6px)]"
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
