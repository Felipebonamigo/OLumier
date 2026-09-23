"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { enderecoNaGaleria } from "@/lib/endereco-na-galeria";
import { GaleriaGrade } from "./galeria-grade";
import type { Aparencia } from "@/config/aparencia";
import {
  entregarTudo,
  entregouUmaFoto,
  baixarNoComputador,
  modoDeEntrega,
  salvarNoCelular,
  acaoDeEntrega,
  compartilharPreparado,
  buscarFoto,
  chaveDoProgresso,
  lerProgresso,
  gravadorDeProgresso,
  apagarProgresso,
  travaDeTela,
  recadoDoFim,
  escopoDasFavoritas,
  enviarParaOComputador,
  partesPrevistas,
  tamanhoLegivel,
  type FotoParaEntregar,
  type ProgressoDaEntrega,
} from "@/lib/salvar-client";
import type { ModoDeEntrega } from "@/lib/modo-de-entrega";
import { useSwipe } from "@/lib/usar-swipe";
import { EncontrarMe } from "./encontrar-me";
import { MenusDaGaleria } from "./menus-da-galeria";
import { fotoVisivel, indicesVisiveis, SEGUNDOS_POR_FOTO } from "@/lib/fotos-visiveis";
import { capitulosComOsExtras } from "@/lib/capitulos-da-rolagem";
import { nomeComCapitulo, GRUPO_SEM_CAPITULO } from "@/lib/nome-de-arquivo";

export interface ItemGaleria {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  /** miniatura da grade (~50 KB) */
  url: string;
  /**
   * `url` é uma IMAGEM, e não o arquivo original servindo de reserva.
   *
   * Só importa para vídeo, e importa muito: sem derivada, `url` é o próprio
   * filme — e pendurar isso num `<img>` faz o navegador baixar o arquivo
   * inteiro para descobrir que não sabe desenhá-lo. Num filme de 4K isso é
   * dezenas de gigabytes no 4G do convidado, para mostrar nada.
   *
   * Vídeo enviado antes de 16/09/2026 não tem pôster e cai em `false`, onde a
   * grade volta ao bloco da cor do tema com o círculo de play.
   */
  temPoster: boolean;
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
  /**
   * Em que capítulo esta foto está. Null = solta.
   *
   * Existe desde a rolagem infinita (16/09/2026): as fotos que chegam depois da
   * primeira tela precisam saber onde entrar, e recalcular os índices dos
   * capítulos a partir daqui é o que mantém UMA fonte de verdade — antes o
   * servidor mandava os índices prontos, e uma lista que cresce no cliente
   * deixaria os dois discordando.
   */
  secaoId?: string | null;
}

export interface CapituloGaleria {
  id: string;
  /**
   * O que vai no LINK (`?cap=cerimonia`), em vez do id.
   *
   * Felipe, 16/09/2026: "o link do capítulo está muito extenso, temos que
   * diminuir e ficar mais simples, para quando mandar". Era o UUID da seção —
   * 36 caracteres para dizer "Cerimônia", com cara de link de rastreamento no
   * meio de uma mensagem de WhatsApp.
   *
   * O `id` continua existindo e continua sendo o do DOM (`#cap-<id>`): âncora
   * de página é coisa interna, e trocá-la por um texto que a pessoa escolhe
   * abriria a porta para um capítulo chamado "fotos" colidir com outro
   * elemento. O apelido é só para o que sai daqui. Ver migração 034.
   */
  apelido: string;
  nome: string;
  /**
   * Índices em `itens`, ou seja: as fotos deste capítulo QUE ESTÃO NESTA TELA.
   *
   * Vem vazio nos capítulos que não couberam na fatia (ver
   * `config/fatia-galeria.ts`) — o menu precisa deles para navegar, a grade
   * não os desenha. Até 11/09/2026 o visualizador percorria a galeria inteira
   * de ponta a ponta; hoje ele percorre a FATIA, e esta linha existe para a
   * próxima pessoa não confiar na promessa antiga.
   */
  indices: number[];
  /** Quantas fotos o capítulo tem na GALERIA — não nesta fatia. */
  total: number;
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
/** Link assinado mais velho que isto é pedido de novo — a rota assina por 6 h. */
const VALE_NO_CACHE = 4 * 3600 * 1000;

const GLIFO_SOBRE_FOTO = "drop-shadow(0 1px 1.5px rgba(0,0,0,.85)) drop-shadow(0 0 6px rgba(0,0,0,.45))";

export function GaleriaCliente({
  itens: itensIniciais,
  permiteDownload,
  galeriaId,
  aparencia,
  capitulos: capitulosIniciais,
  modoProvavel,
  bytesDaGaleria = 0,
  favoritasIniciais,
  selecaoInicial,
  buscaPorRosto = null,
  fatia = null,
  capituloAberto = null,
  enderecoBase,
  recorte = false,
  eu: euInicial = null,
}: {
  itens: ItemGaleria[];
  permiteDownload: boolean;
  galeriaId: string;
  aparencia: Aparencia;
  capitulos: CapituloGaleria[];
  /** Palpite do servidor pelo user-agent, só para a primeira pintura não piscar. */
  modoProvavel: ModoDeEntrega;
  /** Soma dos originais da galeria INTEIRA — dita antes de salvar no celular. */
  bytesDaGaleria?: number;
  /**
   * A busca por rosto, quando o fotógrafo ligou. Null = o botão não existe.
   * O contato é do estúdio: é com ele que o convidado fala sobre as fotos.
   */
  buscaPorRosto?: { nomeEstudio: string; contato: string | null } | null;
  /**
   * Preenchido só quando a galeria não coube num documento — ver
   * `config/fatia-galeria.ts`. `null` quer dizer "veio inteira", e é o caso
   * de quase toda galeria: nada muda de comportamento.
   */
  fatia?: { total: number; capituloAtivo: string | null } | null;
  /**
   * O capítulo aberto (`?cap=`), pelo ID — ou `null` na galeria inteira.
   *
   * Separado da `fatia` de propósito: a fatia só existe acima de 600 fotos, e o
   * recorte por capítulo existe em qualquer galeria. Amarrar um ao outro faria
   * a saída do fim do capítulo sumir nas galerias pequenas.
   */
  capituloAberto?: string | null;
  /**
   * O endereço PÚBLICO desta galeria, sem capítulo — a base dos links das
   * pastilhas e do botão de fim de capítulo.
   *
   * Vem da página porque só ela sabe: no domínio próprio o visitante vê
   * `/<galeria>`, e a forma interna `/g/<estudio>/<galeria>` é recusada naquele
   * host. Ver `lib/endereco-na-galeria.ts`.
   */
  enderecoBase: string;
  /**
   * A tela é um recorte por `?fotos=` — o resultado da busca por rosto numa
   * galeria fatiada. Aí `itens` são exatamente as fotos achadas, e o menu de
   * baixar as oferece antes da galeria inteira.
   */
  recorte?: boolean;
  /** Quem se identificou por e-mail nesta galeria. Null = ninguém ainda. */
  eu?: { email: string | null; nome: string | null } | null;
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
  /*
   * ── A ROLAGEM QUE NÃO TERMINA (16/09/2026) ──────────────────────────────
   *
   * Felipe: "remover paginação dentro do mesmo capítulo, tem apenas que rolar
   * até o final".
   *
   * A página continua nascendo com uma tela de fotos — o corte de 11/09 existe
   * porque 2108 fotos davam 6,35 MB de DOCUMENTO e o Safari do iPhone
   * estourava. O que muda é o resto: em vez de "parte 3 de 4", as fotos
   * seguintes chegam em JSON conforme a pessoa rola, e viram nós do DOM sem
   * passar pelo documento. Ver `api/g/[id]/mais`.
   *
   * `itens` e `capitulos` deixam de ser props e viram valores derivados com o
   * MESMO nome: as três dezenas de usos abaixo continuam lendo o que sempre
   * leram, e a lista simplesmente cresce por baixo deles.
   */
  const [extras, setExtras] = useState<ItemGaleria[]>([]);
  const itens = useMemo(
    () => (extras.length === 0 ? itensIniciais : [...itensIniciais, ...extras]),
    [itensIniciais, extras],
  );

  /*
   * Os índices dos capítulos, com as fotos que a rolagem trouxe.
   *
   * Aqui morava uma RECONTAGEM do zero, e ela apagava a galeria: ver o bloco
   * inteiro em `lib/capitulos-da-rolagem.ts`. Agora os índices do servidor
   * ficam como estão e só as fotos novas são classificadas — uma foto que já
   * está na tela não tem como sair dela.
   *
   * `total` continua vindo do servidor: é o tamanho do capítulo na GALERIA, e o
   * menu de baixar mostra esse número, não o do que já foi rolado.
   */
  const capitulos = useMemo(
    () => capitulosComOsExtras(capitulosIniciais, itensIniciais.length, extras),
    [capitulosIniciais, itensIniciais.length, extras],
  );

  /* Navegar é como a galeria fatiada mostra um recorte — capítulo, favoritas,
     resultado da selfie. `router.push` e não `location.href`: o Next troca só
     o que mudou, e é o caminho que o próprio framework pede. */
  const router = useRouter();
  const caminho = usePathname();

  const [aberto, setAberto] = useState<number | null>(null);
  /*
   * A ENTREGA EM CURSO NO CELULAR (16/09/2026).
   *
   * `null` quando nada está saindo. Com valor, um painel fixo na base da tela
   * mostra o progresso — e, no iPhone, o botão do toque de cada lote, que é
   * DENTRO do qual `share()` pode ser chamado (ver `lib/salvar-client.ts`).
   *
   * O botão morava logo abaixo da barra de menus. Com a página rolada ele ficava
   * fora da tela, e a entrega parecia travada esperando um toque que a pessoa
   * não via.
   */
  const [entrega, setEntrega] = useState<{
    rotulo: string;
    progresso: ProgressoDaEntrega;
    bytes: number;
    jaTinham: number;
    suaVez: { seguir: () => void; parar: () => void } | null;
    /* Um AbortController por entrega, guardado com ela: uma entrega nova não
       herda o pedido de parada da anterior. */
    parar: () => void;
    /* Apaga o progresso guardado e para — ver `recomecar` em iniciarEntrega. */
    recomecar: () => void;
  } | null>(null);
  /* O recado de quando a entrega termina: onde as fotos foram parar. Fica até a
     pessoa fechar — some sozinho só o que não exige ação. */
  const [fimDaEntrega, setFimDaEntrega] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /* O servidor chuta pelo user-agent para a primeira pintura já sair certa; ao
     montar, a detecção de recurso corrige o palpite. */
  const [modo, setModo] = useState<ModoDeEntrega>(modoProvavel);
  /* eslint-disable-next-line react-hooks/set-state-in-effect --
     A cascata é o objetivo, não efeito colateral: a detecção depende de API do
     navegador que não existe no servidor. Sem o palpite do user-agent na
     primeira pintura, o botão sairia errado por um instante; sem a correção ao
     montar, o palpite errado ficaria. Uma renderização extra, uma vez, ao abrir. */
  useEffect(() => setModo(modoDeEntrega()), []);

  const [favoritas, setFavoritas] = useState<Set<string>>(() => new Set(favoritasIniciais));
  const [soFavoritas, setSoFavoritas] = useState(false);
  /* As fotos em que o convidado se achou pela selfie. Null = sem filtro. Vive
     só nesta página: fechar a aba apaga, que é o que o texto prometeu. */
  const [encontradas, setEncontradas] = useState<Set<string> | null>(null);
  /*
   * ── QUEM ESTÁ ESCOLHENDO (15/09/2026) ───────────────────────────────────
   *
   * `eu` vem do servidor (cookie assinado); `pedindoEmail` guarda a foto que
   * disparou o pedido, para marcá-la assim que a pessoa se identificar — sem
   * isso ela digita o e-mail e tem de procurar a foto de novo.
   */
  const [eu, setEu] = useState(euInicial);
  const [pedindoEmail, setPedindoEmail] = useState<{
    mediaId: string;
    eraFavorita: boolean;
  } | null>(null);
  const [emailDigitado, setEmailDigitado] = useState("");
  const [nomeDigitado, setNomeDigitado] = useState("");
  const [identificando, setIdentificando] = useState(false);

  /*
   * ── QUEM ESTÁ BAIXANDO (23/09/2026) ─────────────────────────────────────
   *
   * Juan: "gostaria de saber quem está baixando. Quais fotos estão sendo
   * baixadas". Felipe, decidindo o preço disso para o convidado: "quando for
   * baixar pedir nome e email opcional, pelo menos um dos dois para baixar a
   * primeira vez".
   *
   * "A primeira vez" é a parte que faz isto valer a pena: a resposta vira o
   * mesmo cookie das favoritas, então quem já se identificou para escolher uma
   * foto não vê nada, e quem se identificou para baixar não vê de novo.
   *
   * A porta devolve uma PROMESSA em vez de mandar um callback: as três entradas
   * de download (`salvarUm`, `iniciarEntrega`, `baixarZip`) já são funções
   * inteiras e legíveis, e um `if (!(await exigirIdentidade())) return;` na
   * primeira linha de cada uma diz o que faz sem partir nenhuma em duas.
   */
  const [pedindoParaBaixar, setPedindoParaBaixar] = useState(false);
  const respostaDaPorta = useRef<((seguiu: boolean) => void) | null>(null);

  function exigirIdentidade(): Promise<boolean> {
    if (eu) return Promise.resolve(true);
    setPedindoParaBaixar(true);
    return new Promise<boolean>((resolver) => {
      respostaDaPorta.current = resolver;
    });
  }

  /* Fechar sem dizer quem é CANCELA o download — "pelo menos um dos dois para
     baixar". A promessa precisa ser resolvida de todo jeito, senão a função que
     esperava por ela fica pendurada para sempre. */
  function fecharPorta(seguiu: boolean) {
    setPedindoParaBaixar(false);
    respostaDaPorta.current?.(seguiu);
    respostaDaPorta.current = null;
  }

  /** Diz quem está baixando. Aceita nome OU e-mail — ver a rota `eu`. */
  async function identificarParaBaixar() {
    if (identificando) return;
    const email = emailDigitado.trim();
    const nome = nomeDigitado.trim();
    if (!email && !nome) {
      setAviso("escreva o seu nome ou o seu e-mail");
      setTimeout(() => setAviso(null), 3000);
      return;
    }
    setIdentificando(true);
    try {
      const r = await fetch(`/api/g/${galeriaId}/eu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, nome, motivo: "baixar" }),
      });
      const d = await r.json();
      if (!r.ok) {
        setAviso(d?.erro ?? "não consegui guardar. Tente de novo.");
        setTimeout(() => setAviso(null), 4000);
        return;
      }
      setEu(d.pessoa);
      setFavoritas(new Set<string>(d.favoritas ?? []));
      setEmailDigitado("");
      setNomeDigitado("");
      fecharPorta(true);
    } catch {
      setAviso("não consegui guardar. Confira sua conexão.");
      setTimeout(() => setAviso(null), 4000);
    } finally {
      setIdentificando(false);
    }
  }

  const [selecao, setSelecao] = useState(selecaoInicial);
  const [fechando, setFechando] = useState(false);

  const limite = selecao.limite;
  const cheia = limite !== null && favoritas.size >= limite;

  /**
   * Diz quem está escolhendo, e marca a foto que estava esperando.
   *
   * O e-mail não é conferido — não há código, não há senha, não há conta. Ele
   * separa a lista da noiva da lista do convidado, que é o problema real; contra
   * quem QUEIRA mexer na dela sabendo o endereço, não protege, e a tela não
   * promete que protege.
   */
  async function identificar() {
    if (identificando) return;
    setIdentificando(true);
    try {
      const r = await fetch(`/api/g/${galeriaId}/eu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailDigitado, nome: nomeDigitado }),
      });
      const d = await r.json();
      if (!r.ok) {
        setAviso(d?.erro ?? "não consegui guardar o seu e-mail. Tente de novo.");
        setTimeout(() => setAviso(null), 4000);
        return;
      }

      setEu(d.pessoa);
      /* A lista dela vem na resposta: quem se identifica no segundo aparelho
         espera reencontrar o que já escolheu, e sem isto a tela ficaria vazia
         até o próximo carregamento. */
      setFavoritas(new Set<string>(d.favoritas ?? []));

      const esperando = pedindoEmail;
      setPedindoEmail(null);
      setEmailDigitado("");
      setNomeDigitado("");
      if (esperando) await alternarFavorita(esperando.mediaId, esperando.eraFavorita);
    } catch {
      setAviso("não consegui guardar o seu e-mail. Confira sua conexão.");
      setTimeout(() => setAviso(null), 4000);
    } finally {
      setIdentificando(false);
    }
  }

  /**
   * Quantas fotos a GALERIA tem — que desde 11/09/2026 não é `itens.length`.
   *
   * Com o corte por fatia, `itens` virou "o pedaço que coube nesta tela". Quem
   * precisa do número inteiro é a prova de entrega: baixar as 600 de uma
   * galeria de 2.108 não pode contar como ter levado o casamento.
   */
  const totalDaGaleria = fatia?.total ?? itens.length;

  /**
   * Baixa um zip montado no servidor — ver `api/g/[id]/zip`.
   *
   * Um link com `download`, e não `fetch`: o zip de um capítulo passa de 2 GB,
   * e buscar isso para a memória da aba derrubaria o navegador. Com o link, o
   * próprio navegador escreve direto no disco, mostra a barra de progresso (a
   * rota anuncia o tamanho exato) e deixa a pessoa continuar olhando a galeria
   * enquanto baixa.
   *
   * O registro na Atividade acontece no SERVIDOR, quando o zip termina de ser
   * entregue — cancelar no meio não conta como entrega.
   */
  async function baixarZip(consulta: string) {
    if (!(await exigirIdentidade())) return;
    baixarNoComputador(`/api/g/${galeriaId}/zip${consulta}`, "galeria.zip");
  }

  /**
   * "Baixar tudo no computador", tocado no celular: manda o link da galeria —
   * sem o `?cap=` nem nada da tela — para a própria pessoa abrir lá.
   */
  async function mandarParaOComputador() {
    const r = await enviarParaOComputador(
      `${window.location.origin}${window.location.pathname}`,
      document.title,
    );
    if (r === "copiou") setFimDaEntrega("link copiado — abra no computador e clique em ↓ Baixar");
    if (r === "falhou") {
      setFimDaEntrega("não consegui abrir o compartilhar — copie o endereço desta página e abra no computador");
    }
  }

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

  /*
   * Quando cada link foi assinado. A rota assina por 6 h, e uma entrega de 2108
   * fotos pelo iPhone — ou uma aba esquecida aberta desde a manhã — passa disso:
   * link vencido é foto que não vem. Acima de 4 h, pede de novo.
   */
  const assinadoEm = useRef(new Map<string, number>());

  const assinar = useCallback(
    async (ids: string[], tipo: "preview" | "download"): Promise<Map<string, string>> => {
      const cache = tipo === "preview" ? cachePreview.current : cacheOriginal.current;
      const agora = Date.now();
      // Foto de demonstração não existe no banco; pedir por ela seria 400.
      const faltam = ids.filter(
        (id) =>
          !id.startsWith("demo:") &&
          (!cache.has(id) || agora - (assinadoEm.current.get(`${tipo}:${id}`) ?? 0) > VALE_NO_CACHE),
      );
      if (faltam.length > 0) {
        const r = await fetch(`/api/g/${galeriaId}/urls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: faltam, tipo }),
        });
        if (!r.ok) throw new Error(String(r.status));
        const { urls } = (await r.json()) as { urls: Record<string, string> };
        for (const [id, url] of Object.entries(urls)) {
          cache.set(id, url);
          assinadoEm.current.set(`${tipo}:${id}`, agora);
        }
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
         * ── 428: FALTA DIZER QUEM VOCÊ É (15/09/2026) ──────────────────────
         *
         * Desde a migração 033 a favorita tem dona, e o servidor recusa marcar
         * de quem não se identificou. Não é erro para mostrar — é um passo que
         * falta: o coração volta ao lugar, o campo do e-mail abre, e a foto
         * fica guardada para ser marcada assim que a pessoa disser o nome.
         *
         * Guardar a foto importa: sem isso a pessoa digita o e-mail e descobre
         * que ainda precisa achar de novo a foto que ela tinha acabado de
         * escolher.
         */
        if (r.status === 428) {
          mexer(eraFavorita);
          setPedindoEmail({ mediaId, eraFavorita });
          return;
        }

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
    if (!(await exigirIdentidade())) return;
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

    /* Computador e Android: download direto. No Android o menu de compartilhar
       não tem "salvar na galeria" — a foto baixada cai na pasta Download, que
       a Galeria mostra. Ver `lib/modo-de-entrega.ts`. */
    if (modo !== "menu") {
      registrar("baixou", it.id);
      baixarNoComputador(url, nomeDeArquivo(it));
      if (modo === "download") {
        setAviso("baixada — está na pasta Download");
        setTimeout(() => setAviso(null), 2500);
      }
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
   * Salvar VÁRIAS fotos no celular: a galeria, uma pasta ou as favoritas.
   *
   * ── A LISTA VEM INTEIRA DO SERVIDOR (16/09/2026) ─────────────────────────
   *
   * Até aqui a entrega saía de `itens` — o que estava na tela. Numa galeria
   * fatiada isso é um pedaço: "Salvar as 600" numa galeria de 2108, a pasta de
   * 800 entregando 600, as favoritas de outros capítulos exigindo navegar
   * antes. Agora quem diz o que vai é `api/g/[id]/lista`, com as mesmas regras
   * do zip do computador (`lib/entrega-da-galeria.ts`).
   *
   * No computador nada disto roda: lá é o zip. Ver `baixarZip`.
   *
   * ── O REGISTRO VEM DEPOIS ────────────────────────────────────────────────
   *
   * O Juan tentou baixar tudo no celular em 05/09/2026, não veio nada, e a aba
   * Atividade marcou 1 download: o registro contava o CLIQUE. Toda a
   * orquestração mora em `entregarTudo`, que devolve o desfecho — e só depois
   * dele se registra.
   */
  async function iniciarEntrega(pedido: { escopo: string; consulta: string; rotulo: string }) {
    if (entrega || modo === "computador") return;
    if (!(await exigirIdentidade())) return;
    /* Um AbortController por entrega. O motivo diz o que a pessoa pediu: parar
       (e continuar depois) ou recomeçar do zero. */
    const parada = new AbortController();
    setFimDaEntrega(null);
    const inicio: ProgressoDaEntrega = {
      feitas: 0,
      total: 0,
      parte: 0,
      partes: 0,
      fase: "preparando",
      preparadas: 0,
      doLote: 0,
    };
    setEntrega({
      rotulo: pedido.rotulo,
      progresso: inicio,
      bytes: 0,
      jaTinham: 0,
      suaVez: null,
      parar: () => parada.abort("parar"),
      recomecar: () => parada.abort("recomecar"),
    });

    let fotos: FotoParaEntregar[];
    try {
      const r = await fetch(`/api/g/${galeriaId}/lista${pedido.consulta}`, { cache: "no-store" });
      if (r.status === 428) {
        setEntrega(null);
        setFimDaEntrega("diga o seu e-mail marcando uma foto — as favoritas são de quem escolheu");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      fotos = ((await r.json()) as { fotos: FotoParaEntregar[] }).fotos;
    } catch {
      setEntrega(null);
      setFimDaEntrega("não consegui preparar as fotos. Confira sua conexão e tente de novo.");
      return;
    }
    if (fotos.length === 0) {
      setEntrega(null);
      setFimDaEntrega("não há fotos para salvar aqui.");
      return;
    }

    /* Continuar de onde parou: o progresso é deste aparelho, por pedido. Só
       conta o que ainda está na lista — foto que o fotógrafo tirou da galeria
       não pode inflar o "já tinham ido". */
    let armazem: Storage | null = null;
    try {
      armazem = window.localStorage;
    } catch {
      armazem = null;
    }
    const chave = chaveDoProgresso(galeriaId, pedido.escopo);
    const naLista = new Set(fotos.map((f) => f.id));
    const jaEntregues = new Set([...lerProgresso(armazem, chave)].filter((id) => naLista.has(id)));
    const progressoGuardado = gravadorDeProgresso(armazem, chave, jaEntregues);

    const bytes = fotos.reduce((s, f) => s + f.bytes, 0);
    const pendentes = fotos.filter((f) => !jaEntregues.has(f.id));
    setEntrega(
      (e) =>
        e && {
          ...e,
          bytes,
          jaTinham: jaEntregues.size,
          progresso: {
            ...e.progresso,
            total: fotos.length,
            feitas: jaEntregues.size,
            parte: 1,
            partes: modo === "menu" ? Math.max(1, partesPrevistas(pendentes)) : 1,
          },
        },
    );

    const tela = travaDeTela();
    await tela.ligar();
    try {
      const desfecho = await entregarTudo(fotos, {
        modo,
        assinar: (ids) => assinar(ids, "download"),
        buscar: buscarFoto,
        /*
         * PREPARAR, PEDIR O TOQUE, COMPARTILHAR — nesta ordem (10/09/2026).
         *
         * O Safari recusa o menu quando a busca das fotos passa da janela do
         * gesto. A parte lenta acontece primeiro e o painel mostra um botão; o
         * toque nele é um gesto NOVO, e os arquivos já estão na memória.
         *
         * Esperando o toque, nada está saindo: a tela pode apagar.
         */
        pedirToque: (p) => {
          void tela.desligar();
          return new Promise((responder) =>
            setEntrega(
              (e) =>
                e && {
                  ...e,
                  progresso: p,
                  suaVez: {
                    seguir: () => {
                      setEntrega((x) => x && { ...x, suaVez: null });
                      responder("seguir");
                    },
                    parar: () => responder("parar"),
                  },
                },
            ),
          );
        },
        /* `share()` é chamado aqui dentro ANTES de qualquer espera — a trava da
           tela volta depois, sem roubar a janela do toque. */
        compartilhar: (arquivos) => {
          const resultado = compartilharPreparado(arquivos);
          void tela.ligar();
          return resultado;
        },
        baixar: baixarNoComputador,
        esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
        aoProgredir: (p) => setEntrega((e) => e && { ...e, progresso: p }),
        aoEntregar: (ids) => progressoGuardado.marcar(ids),
        jaEntregues,
        sinal: parada.signal,
      });

      /*
       * Baixar uma pasta não é baixar tudo — ver `acaoDeEntrega`. E o total é o
       * da GALERIA, não o de `itens` (11/09/2026): numa galeria fatiada `itens`
       * é o pedaço na tela, e 600 de 600 virava BAIXOU TUDO. Entrega parada no
       * meio também não é "tudo", mesmo que o pedido fosse.
       */
      if (desfecho.entregues > 0) {
        registrar(desfecho.completo ? acaoDeEntrega(fotos.length, totalDaGaleria) : "baixou");
      }

      if (parada.signal.reason === "recomecar") {
        /* "Recomeçar do zero": quem escolheu "Salvar em Arquivos" no menu por
           engano não pode ficar com aquelas fotos puladas por uma semana. */
        apagarProgresso(armazem, chave);
        setFimDaEntrega("pronto para começar do zero — toque em salvar de novo");
      } else {
        if (desfecho.completo) apagarProgresso(armazem, chave);
        else progressoGuardado.gravar();
        setFimDaEntrega(recadoDoFim(desfecho, modo));
      }
    } catch {
      progressoGuardado.gravar();
      setFimDaEntrega("não consegui salvar tudo. Toque em salvar de novo para continuar de onde parou.");
    } finally {
      await tela.desligar();
      setEntrega(null);
    }
  }

  /*
   * AS PASTAS DO MENU DE BAIXAR (10/09/2026): "todas de uma única vez ou
   * separado em pastas", nas palavras do Juan. As pastas são os CAPÍTULOS.
   * Com UM capítulo apenas não há o que escolher.
   *
   * A contagem é a da GALERIA (`total`), e a entrega é a pasta INTEIRA, esteja
   * ela nesta fatia ou não: no computador num zip, no celular pela lista que
   * vem do servidor. Até 16/09/2026 o celular entregava a parte carregada — uma
   * pasta de 800 fotos virava 600.
   */
  const pastasParaBaixar =
    capitulos.length > 1
      ? capitulos.map((c) => ({
          id: c.id,
          nome: c.nome,
          quantas: c.total,
          baixar: () =>
            modo === "computador"
              ? baixarZip(`?cap=${encodeURIComponent(c.id)}`)
              : iniciarEntrega({
                  escopo: `cap:${c.id}`,
                  consulta: `?cap=${encodeURIComponent(c.id)}`,
                  rotulo: c.nome || "Pasta",
                }),
        }))
      : [];

  /*
   * ── AS PARTES DE UMA PASTA MAIOR QUE A TELA (16/09/2026) ─────────────────
   *
   * O corte por fatia serve no máximo `FOTOS_POR_TELA` fotos por documento, e
   * o teto vale dentro do capítulo. Até hoje nada levava ao resto: numa pasta
   * "Festa" de 800 fotos, da 601ª em diante não havia tela onde aparecessem —
   * e numa galeria de 2000 fotos sem capítulo, 1400 sumiam. Links de verdade,
   * como as pastilhas de capítulo: cada parte é outro documento, pequeno.
   *
   * Em cima E embaixo da grade: quem chega ao fim das 600 procura a
   * continuação ali, e quem entra quer saber de cara que a pasta tem partes.
   */
  /*
   * ── QUEM BUSCA O PRÓXIMO PEDAÇO ─────────────────────────────────────────
   *
   * Um pedido de cada vez (`buscando`), e ele para quando a rota diz que não
   * sobrou nada. Sem a trava, chegar ao fim da página com o observador ainda
   * disparando pediria a mesma página três vezes.
   *
   * `desde` conta as fotos JÁ CARREGADAS do mesmo recorte — é o que a rota usa
   * para cortar. Sai de `itensIniciais.length + extras.length` e não de
   * `itens.length` para deixar claro que a conta é sobre o que veio do
   * servidor, não sobre o que a tela está filtrando (favoritas, busca por
   * rosto).
   */
  const [buscando, setBuscando] = useState(false);
  const [acabou, setAcabou] = useState(!fatia);
  const sentinela = useRef<HTMLDivElement | null>(null);

  const carregarMais = useCallback(async () => {
    if (buscando || acabou) return;
    setBuscando(true);
    try {
      const busca = new URLSearchParams();
      if (fatia?.capituloAtivo) busca.set("cap", fatia.capituloAtivo);
      busca.set("desde", String(itensIniciais.length + extras.length));
      const r = await fetch(`/api/g/${galeriaId}/mais?${busca}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { fotos: ItemGaleria[]; restantes: number };
      /* Pedaço vazio também encerra: sem isso, um `restantes` errado deixaria o
         observador pedindo para sempre. */
      if (d.fotos.length === 0 || d.restantes === 0) setAcabou(true);
      if (d.fotos.length > 0) setExtras((atual) => [...atual, ...d.fotos]);
    } catch {
      /* Rede caiu no meio da rolagem: para de tentar sozinho e deixa o botão.
         Insistir em laço numa conexão ruim é o que trava o celular do
         convidado no salão. */
      setAcabou(true);
    } finally {
      setBuscando(false);
    }
  }, [buscando, acabou, fatia, galeriaId, itensIniciais.length, extras.length]);

  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || acabou) return;
    /*
     * `rootMargin` de 800 px embaixo: o pedido sai quando o fim está a uma
     * dobra de distância, não quando já chegou. É a diferença entre a galeria
     * parecer infinita e a galeria parecer lenta.
     */
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void carregarMais();
      },
      { rootMargin: "0px 0px 800px 0px" },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [carregarMais, acabou]);


  /*
   * ── O FIM DA GALERIA, EM VEZ DA PAGINAÇÃO (16/09/2026) ──────────────────
   *
   * Felipe: "remover paginação dentro do mesmo capítulo, tem apenas que rolar
   * até o final".
   *
   * Aqui moravam as pastilhas "parte 1 2 3 4" e o "próxima parte ›". Cada uma
   * era um link para outro documento: a pessoa chegava ao fim de 600 fotos,
   * clicava, a página recarregava e a rolagem voltava ao topo. No meio de uma
   * escolha de álbum, isso é perder o lugar.
   *
   * O que fica é uma sentinela invisível. Quando ela entra na área de visão —
   * com 800 px de antecedência — o próximo pedaço é pedido e as fotos entram no
   * fim da grade. Ver `carregarMais`.
   *
   * O texto SÓ aparece enquanto está buscando ou quando a rede falhou: uma
   * linha permanente dizendo "fim da galeria" é ruído embaixo de toda entrega,
   * e a ausência de mais fotos já diz isso.
   */
  /*
   * ── O FIM DE UM CAPÍTULO PRECISA TER SAÍDA (17/09/2026) ─────────────────
   *
   * Felipe: "no fim do capítulo tem que ter um botão: 'próximo capítulo' ou
   * 'continuar'".
   *
   * Vendo UM capítulo, a última foto é um beco: a pessoa rola, as fotos acabam,
   * e o que sobra é o rodapé. Continuar exige rolar de volta até o menu lá em
   * cima — e num capítulo de 700 fotos isso é a galeria inteira de volta.
   *
   * Só no recorte de um capítulo. Na galeria inteira os capítulos já emendam um
   * no outro, e um botão "próximo" ali apontaria para onde a rolagem já vai.
   *
   * Capítulo vazio é pulado: mandar a pessoa para uma tela sem foto é pior que
   * não oferecer saída nenhuma. E no último a saída é a galeria inteira, que é
   * de onde ela veio.
   */
  /*
   * Qual capítulo está aberto — e ele NÃO sai da fatia.
   *
   * Sair dela amarraria a saída do capítulo ao tamanho da galeria: `fatia` só
   * existe acima de 600 fotos, e o recorte por capítulo existe em qualquer
   * galeria. O botão do fim sumiria justamente nas pequenas, que são a maioria.
   *
   * Fora do `useMemo` porque o compilador do React não preserva a memoização
   * quando a dependência é um acesso encadeado opcional.
   */
  const capituloAtivo = capituloAberto ?? null;
  const saidaDoCapitulo = useMemo(() => {
    if (!capituloAtivo) return null;
    const comFoto = capitulos.filter((c) => c.total > 0);
    const i = comFoto.findIndex((c) => c.id === capituloAtivo);
    if (i < 0) return null;
    const proximo = comFoto[i + 1] ?? null;
    return proximo
      ? {
          texto: `Próximo capítulo: ${proximo.nome}`,
          para: enderecoNaGaleria(enderecoBase, "", { cap: proximo.apelido }),
        }
      : { texto: "Ver a galeria inteira", para: enderecoNaGaleria(enderecoBase, "", { cap: null }) };
  }, [capitulos, capituloAtivo]);

  const fimDaGaleria = (
    <>
      {fatia && !acabou ? (
        <div ref={sentinela} className="my-8 text-center text-xs" aria-live="polite">
          {buscando && <span style={{ color: "var(--g-tenue)" }}>carregando mais fotos…</span>}
        </div>
      ) : null}
      {/* Só depois que as fotos deste capítulo acabaram: oferecer a saída no
          meio do carregamento é convidar a pessoa a sair antes de ver o que
          ainda está vindo. */}
      {saidaDoCapitulo && (!fatia || acabou) && (
        <div className="my-10 text-center">
          <Link
            href={saidaDoCapitulo.para}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm transition"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-texto)" }}
          >
            {saidaDoCapitulo.texto}
            <span aria-hidden>→</span>
          </Link>
        </div>
      )}
    </>
  );

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
      {/*
        ── BAIXAR SÓ AS FAVORITAS (11/09/2026) ──────────────────────────────

        Pedido do Felipe junto com o coração no visualizador. Numa galeria
        inteira é filtrar `itens` e pronto.

        Numa galeria FATIADA não é: `itens` é o capítulo carregado, e as
        favoritas do casal estão espalhadas pela entrega toda. Filtrar aqui
        entregaria "as favoritas" que por acaso estão nesta parte — o número
        certo no rótulo e as fotos erradas no telefone, a mesma mentira que a
        busca por rosto quase virou em 11/09.

        Desde 16/09/2026 "baixar as favoritas" não depende mais da tela: o zip
        e a lista do celular vêm do servidor, com as favoritas de quem está
        escolhendo, de todos os capítulos. O `?fotos=` continua sendo a tela
        da busca por rosto, e ali o menu oferece "estas N fotos" — ver
        `recorte`.
      */}
      <MenusDaGaleria
        enderecoBase={enderecoBase}
        capitulos={capitulos}
        fatia={fatia}
        tocarSlideshow={ordemVisivel.length > 1 ? tocarSlideshow : null}
        favoritas={
          /* Sem escolha aberta e sem nenhuma marcada não há o que oferecer, e
             um menu com só o recado "escolha encerrada" dentro é enfeite. */
          selecao.aberta || favoritas.size > 0
            ? {
                quantas: favoritas.size,
                soFavoritas,
                /* Fatiada, "ver só as favoritas" não pode ser um filtro da
                   tela: ele esconderia as favoritas dos outros capítulos em vez
                   de mostrá-las. Vai buscar pelo endereço, como o `?fotos=` da
                   busca por rosto. */
                alternarFiltro: () => {
                  if (!fatia) return setSoFavoritas((v) => !v);
                  router.push(
                    soFavoritas || favoritas.size === 0
                      ? caminho
                      : `${caminho}?fotos=${[...favoritas].join(",")}`,
                  );
                },
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
                modo,
                quantasNaGaleria: totalDaGaleria,
                /* As que a selfie achou, na tela `?fotos=`. Sem este item, "tudo"
                   era a única entrega em lote — 2108 fotos para quem aparece
                   em 37. */
                recorte:
                  recorte && itens.length > 0
                    ? {
                        quantas: itens.length,
                        baixar: () => {
                          const consulta = `?fotos=${itens.map((it) => it.id).join(",")}`;
                          if (modo === "computador") return baixarZip(consulta);
                          void iniciarEntrega({
                            escopo: `fotos:${itens.length}:${itens[0].id}`,
                            consulta,
                            rotulo: "Suas fotos",
                          });
                        },
                      }
                    : null,
                bytesDaGaleria,
                progresso: entrega
                  ? { feitas: entrega.progresso.feitas, total: entrega.progresso.total }
                  : null,
                /* A galeria INTEIRA, não a fatia desta tela: no computador num
                   zip montado no servidor, no celular pela lista que vem dele. */
                baixarTudo: () =>
                  modo === "computador"
                    ? baixarZip("")
                    : iniciarEntrega({ escopo: "tudo", consulta: "", rotulo: "Galeria" }),
                /* No celular o zip é opção a mais: ele não cai no app Fotos nem
                   na Galeria, que é onde a noiva procura. */
                baixarZip: modo !== "computador" ? () => baixarZip("") : undefined,
                enviarParaOComputador:
                  modo !== "computador" ? () => void mandarParaOComputador() : undefined,
                pastas: pastasParaBaixar,
                favoritas: favoritas.size,
                /* As favoritas de QUEM ESTÁ ESCOLHENDO, de todos os capítulos —
                   a lista vem do servidor, não do que está nesta tela. */
                baixarFavoritas: () =>
                  modo === "computador"
                    ? baixarZip("?favoritas=1")
                    : iniciarEntrega({
                        escopo: escopoDasFavoritas(eu?.email ?? ""),
                        consulta: "?favoritas=1",
                        rotulo: "Favoritas",
                      }),
              }
            : null
        }
      />

      {/*
        QUEM ESTÁ ESCOLHENDO, DITO NA TELA.

        Sem isto, a pessoa que abre a galeria no notebook da casa não tem como
        saber que está vendo a lista do marido — e "sumiram as minhas fotos" é
        exatamente a queixa que a identificação veio resolver. O "não sou eu"
        ao lado é o que faz dois moradores dividirem o mesmo computador.
      */}
      {eu && (
        <p className="mt-3 text-center text-xs" style={{ color: "var(--g-tenue)" }}>
          escolhendo como <strong style={{ color: "var(--g-suave)" }}>{eu.nome || eu.email}</strong>
          {" · "}
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/g/${galeriaId}/eu`, { method: "DELETE" }).catch(() => {});
              setEu(null);
              setFavoritas(new Set());
              router.refresh();
            }}
            className="underline underline-offset-4 transition hover:opacity-70"
          >
            não sou eu
          </button>
        </p>
      )}

      {permiteDownload && itens.length > 0 && aviso && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {/* Só o RECADO da vez. A ajuda permanente ("sem limite de
              downloads…") mora no rodapé do menu de baixar. */}
          <span className="text-center text-xs" style={{ color: "var(--g-tenue)" }}>
            {aviso}
          </span>
        </div>
      )}

      {/*
        ── O PAINEL DA ENTREGA, FIXO NA BASE DA TELA (16/09/2026) ─────────────

        Tudo o que a pessoa precisa enquanto as fotos saem, num lugar que não
        some quando a página rola:

          · quantas já foram, de quantas, e em que parte — acumulado. O
            contador antigo voltava a zero a cada lote, e 53 lotes pareciam
            53 recomeços;
          · o tamanho, antes do primeiro toque: 2108 fotos são gigas;
          · no iPhone, o botão do toque de cada lote. Ele morava embaixo da
            barra de menus e ficava fora da tela com a página rolada — a
            entrega parecia travada esperando um toque que ninguém via;
          · parar, e o recado final dizendo ONDE as fotos foram parar.
      */}
      {(entrega || fimDaEntrega) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div
            className="mx-auto max-w-md rounded-2xl p-4 shadow-2xl"
            style={{
              background: "var(--g-fundo)",
              border: "1px solid var(--g-linha)",
              color: "var(--g-texto)",
            }}
          >
            {entrega ? (
              <PainelDaEntrega
                entrega={entrega}
                modo={modo}
                aoParar={() => {
                  entrega.parar();
                  entrega.suaVez?.parar();
                }}
                aoRecomecar={() => {
                  entrega.recomecar();
                  entrega.suaVez?.parar();
                }}
              />
            ) : (
              <div className="flex items-start justify-between gap-3 text-sm">
                <p>{fimDaEntrega}</p>
                <button
                  type="button"
                  onClick={() => setFimDaEntrega(null)}
                  aria-label="Fechar"
                  className="shrink-0 rounded-lg px-2 py-1 text-xs transition hover:opacity-70"
                  style={{ color: "var(--g-suave)" }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
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

      {/*
        ── QUEM É VOCÊ, PEDIDO NA HORA DE ESCOLHER ─────────────────────────

        Não é uma porta na entrada da galeria. Quem só quer VER as fotos nunca
        vê este campo — ele aparece no primeiro coração, que é o instante em
        que a pergunta faz sentido e a pessoa já quer alguma coisa.

        O nome é opcional de propósito: o que separa as listas é o e-mail, e
        cada campo obrigatório a mais é uma chance de a pessoa desistir de
        escolher as fotos do próprio casamento.
      */}
      {pedindoEmail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Quem está escolhendo"
          className="fixed inset-0 z-[60] flex items-center justify-center p-5 backdrop-blur"
          style={{ background: "color-mix(in srgb, var(--g-fundo) 92%, transparent)" }}
          onClick={() => setPedindoEmail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border p-5"
            style={{ borderColor: "var(--g-linha)", background: "var(--g-superficie)" }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--g-texto)" }}>
              Quem está escolhendo?
            </p>
            <p className="mt-1 text-xs leading-snug" style={{ color: "var(--g-suave)" }}>
              Seu e-mail guarda as SUAS escolhas. Assim ninguém desmarca as suas, e você
              reencontra a lista ao abrir no computador.
            </p>

            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={emailDigitado}
              onChange={(e) => setEmailDigitado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && identificar()}
              placeholder="seu@email.com"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--g-linha)",
                background: "var(--g-fundo)",
                color: "var(--g-texto)",
              }}
            />
            <input
              type="text"
              autoComplete="name"
              value={nomeDigitado}
              onChange={(e) => setNomeDigitado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && identificar()}
              placeholder="seu nome (opcional)"
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--g-linha)",
                background: "var(--g-fundo)",
                color: "var(--g-texto)",
              }}
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPedindoEmail(null)}
                className="rounded-lg border px-3 py-2 text-xs transition hover:opacity-70"
                style={{ borderColor: "var(--g-linha)", color: "var(--g-suave)" }}
              >
                agora não
              </button>
              <button
                type="button"
                onClick={identificar}
                disabled={identificando}
                className="rounded-lg px-4 py-2 text-xs font-semibold transition hover:opacity-85 disabled:opacity-60"
                style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
              >
                {identificando ? "guardando…" : "escolher esta foto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        ── A PORTA DO DOWNLOAD ─────────────────────────────────────────────

        Mesma caixa do "quem está escolhendo", outro texto e outra regra: aqui
        nome OU e-mail basta. A frase diz POR QUE se pede, porque um formulário
        sem motivo na frente da foto do casamento de alguém parece cobrança.
      */}
      {pedindoParaBaixar && (
        <div
          onClick={() => fecharPorta(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.55)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border p-5"
            style={{ borderColor: "var(--g-linha)", background: "var(--g-superficie)" }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--g-texto)" }}>
              Quem está baixando?
            </p>
            <p className="mt-1 text-xs leading-snug" style={{ color: "var(--g-suave)" }}>
              Só desta vez — o fotógrafo acompanha quem recebeu as fotos. Basta o nome
              ou o e-mail.
            </p>

            <input
              type="text"
              autoComplete="name"
              autoFocus
              value={nomeDigitado}
              onChange={(e) => setNomeDigitado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && identificarParaBaixar()}
              placeholder="seu nome"
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--g-linha)",
                background: "var(--g-fundo)",
                color: "var(--g-texto)",
              }}
            />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={emailDigitado}
              onChange={(e) => setEmailDigitado(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && identificarParaBaixar()}
              placeholder="seu@email.com (opcional)"
              className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--g-linha)",
                background: "var(--g-fundo)",
                color: "var(--g-texto)",
              }}
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => fecharPorta(false)}
                className="rounded-lg border px-3 py-2 text-xs transition hover:opacity-70"
                style={{ borderColor: "var(--g-linha)", color: "var(--g-suave)" }}
              >
                agora não
              </button>
              <button
                type="button"
                onClick={identificarParaBaixar}
                disabled={identificando}
                className="rounded-lg px-4 py-2 text-xs font-semibold transition hover:opacity-85 disabled:opacity-60"
                style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
              >
                {identificando ? "guardando…" : "baixar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {buscaPorRosto && (
        <EncontrarMe
          galeriaId={galeriaId}
          nomeEstudio={buscaPorRosto.nomeEstudio}
          contatoEstudio={buscaPorRosto.contato}
          encontradas={encontradas}
          /*
           * NUMA GALERIA FATIADA O RESULTADO VIRA ENDEREÇO.
           *
           * O servidor procura no acervo inteiro e devolve, digamos, 37 fotos.
           * Filtrar a fatia carregada mostraria as nove que por acaso estão
           * nela, embaixo de um texto dizendo 37 — a fatia virando mentira.
           * Levando os ids na URL, a página volta com exatamente as 37.
           */
          aoEncontrar={(ids) => {
            if (!fatia) return setEncontradas(ids);
            router.push(ids?.size ? `${caminho}?fotos=${[...ids].join(",")}` : caminho);
          }}
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
                  /*
                   * O VÍDEO MOSTRA UM QUADRO DELE MESMO (16/09/2026).
                   *
                   * Era um retângulo da cor do tema com um círculo de play no
                   * meio — Felipe: "aperto play e ele já abre uma tela
                   * estranha". Metade do estranho estava aqui: o casal via um
                   * bloco cinza onde a grade inteira mostra fotografia, e não
                   * dava para saber qual filme era aquele.
                   *
                   * Desde que o envio extrai um quadro do arquivo
                   * (`derivadas-client.ts`), `it.url` é uma imagem de verdade,
                   * e o círculo passa a ser o que sempre deveria ter sido: um
                   * selo POR CIMA da imagem, dizendo que aquilo se assiste.
                   *
                   * O vídeo enviado antes desta data não tem quadro nenhum, e
                   * ali `it.url` é o PRÓPRIO FILME. Por isso `temPoster` e não
                   * um `onError`: pendurar o original num `<img>` faria o
                   * navegador baixar o arquivo inteiro para descobrir que não
                   * sabe desenhá-lo. Sem pôster, a galeria já entregue volta ao
                   * bloco de antes, sem baixar nada.
                   */
                  <span
                    className="relative grid h-full min-h-[180px] w-full place-items-center overflow-hidden"
                    style={{ background: "var(--g-superficie)" }}
                  >
                    {it.temPoster && (
                      // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                      <img
                        src={it.url}
                        alt={it.nome}
                        loading={i < 8 ? "eager" : "lazy"}
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                    )}
                    <span
                      className="relative grid h-14 w-14 place-items-center rounded-full"
                      style={{
                        border: "1px solid var(--g-destaque)",
                        /* Sobre foto o círculo vazado some. O véu escuro é o
                           mesmo recurso do botão de baixar logo abaixo. */
                        background: "color-mix(in srgb, var(--g-fundo) 55%, transparent)",
                      }}
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

      {/* A sentinela fica DEPOIS de todos os capítulos, e só uma vez: é o fim da
          rolagem, não o fim de cada seção. Ver `fimDaGaleria`. */}
      {fimDaGaleria}

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
              {/* "de {itens.length}" sozinho passa a fatia por total: numa
                  galeria de 2108 o convidado lia "3 de 600" e concluía que já
                  tinha visto quase tudo. */}
              {aberto! + 1} de {itens.length}
              {fatia ? " desta parte" : ""}
              {slideshow && " · as setas assumem o controle"}
            </span>
            <span className="flex items-center gap-2">
            {/*
              ── O CORAÇÃO COM A FOTO ABERTA (11/09/2026) ────────────────────

              Felipe: "na galeria, quando abre a foto, não estamos conseguindo
              marcar como favorito". Não era defeito de gravação — o coração
              nunca existiu aqui dentro. Ele estava só no canto da miniatura, e
              é ABRINDO a foto que se decide se ela entra no álbum: na grade a
              pessoa vê um selo, aberta ela vê a foto.

              Fica ao lado de "Baixar" e não sobre a imagem: a foto ocupa a
              tela inteira e qualquer botão em cima dela tapa justamente o que
              está sendo julgado. Com rótulo escrito, porque aqui há espaço — e
              porque "Escolher" diz o que o coração sozinho só sugere.
            */}
            {(selecao.aberta || favoritas.has(item.id)) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  alternarFavorita(item.id, favoritas.has(item.id));
                }}
                disabled={!selecao.aberta}
                aria-pressed={favoritas.has(item.id)}
                aria-label={
                  favoritas.has(item.id) ? `Desmarcar ${item.nome}` : `Escolher ${item.nome}`
                }
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition hover:opacity-70 disabled:opacity-60"
                style={{
                  borderColor: favoritas.has(item.id) ? "var(--g-destaque)" : "var(--g-linha)",
                  color: favoritas.has(item.id) ? "var(--g-destaque)" : "var(--g-texto)",
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
                  fill={favoritas.has(item.id) ? "currentColor" : "none"}
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20s-7-4.6-7-9.3A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.7c0 4.7-7 9.3-7 9.3Z" />
                </svg>
                {favoritas.has(item.id) ? "Escolhida" : "Escolher"}
              </button>
            )}
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
                {modo === "menu" ? "Salvar no celular" : "↓ Baixar"}
              </button>
            ) : (
              /* Espaço vazio do tamanho do botão: sem ele o `justify-between`
                 puxaria o contador para a direita e ele mudaria de lugar
                 conforme a galeria permitir download ou não. */
              <span aria-hidden="true" className="w-16" />
            )}
            </span>
          </div>

          {/*
            O RECADO DA ESCOLHA, POR CIMA DA FOTO.

            `aviso` é onde a regra fala — "você já escolheu 30 fotos, que é o
            combinado". Ele é desenhado acima da grade, que fica ATRÁS desta
            tela cheia: quem batesse no limite com a foto aberta tocaria o
            coração, veria nada acontecer e não saberia por quê. O botão ganhou
            um lugar aqui dentro, e o motivo dele ter recusado também precisa.
          */}
          {aviso && (
            <p
              className="px-5 pb-1 text-center text-xs"
              style={{ color: "var(--g-tenue)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {aviso}
            </p>
          )}

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
                /*
                 * O PÔSTER É A OUTRA METADE DO CONSERTO (16/09/2026).
                 *
                 * `autoPlay` com som é BLOQUEADO por todo navegador desde 2018,
                 * e o resultado era o que o Sirius descreveu — "clicou para
                 * abrir e o sistema não roda": a tela ficava preta, parada, com
                 * uma barra de controles em cima. Parecia player quebrado, e
                 * era política de autoplay.
                 *
                 * Com `poster`, a tela abre no quadro do filme e o play fica
                 * evidente. O `autoPlay` continua: quando o navegador permite
                 * (e ele costuma permitir logo depois de um clique), o filme
                 * começa sozinho; quando não, a pessoa vê a imagem certa e um
                 * botão, em vez de um retângulo preto.
                 */
                poster={item.temPoster ? item.url : undefined}
                controls
                autoPlay
                playsInline
                preload="metadata"
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

/**
 * O miolo do painel fixo enquanto as fotos saem. Separado para o JSX do
 * componente grande não carregar a conta dos rótulos.
 */
function PainelDaEntrega({
  entrega,
  modo,
  aoParar,
  aoRecomecar,
}: {
  entrega: {
    rotulo: string;
    progresso: ProgressoDaEntrega;
    bytes: number;
    jaTinham: number;
    suaVez: { seguir: () => void; parar: () => void } | null;
    /* Um AbortController por entrega, guardado com ela: uma entrega nova não
       herda o pedido de parada da anterior. */
    parar: () => void;
    /* Apaga o progresso guardado e para — ver `recomecar` em iniciarEntrega. */
    recomecar: () => void;
  };
  modo: ModoDeEntrega;
  aoParar: () => void;
  aoRecomecar: () => void;
}) {
  const { progresso: p, bytes, jaTinham, suaVez, rotulo } = entrega;
  const listaChegou = p.total > 0;
  const fracao = listaChegou ? p.feitas / p.total : 0;
  const comecando = listaChegou && p.feitas === jaTinham && p.parte <= 1;

  let detalhe: string;
  if (!listaChegou) detalhe = "preparando a lista…";
  else if (suaVez) detalhe = "as fotos já estão prontas — toque para abrir o menu e escolha “Salvar imagens”";
  else if (p.fase === "baixando") detalhe = "baixando — deixe esta tela aberta até terminar";
  else detalhe = `preparando ${p.preparadas} de ${p.doLote}…`;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">
          {rotulo}
          {listaChegou && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {`: ${p.feitas} de ${p.total}`}
            </span>
          )}
        </p>
        {modo === "menu" && p.partes > 1 && (
          <p className="shrink-0 text-xs" style={{ color: "var(--g-suave)" }}>
            parte {p.parte} de {p.partes}
          </p>
        )}
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--g-linha)" }}
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.round(fracao * 100)}%`, background: "var(--g-destaque)" }}
        />
      </div>

      <p className="text-xs" style={{ color: "var(--g-tenue)" }}>
        {comecando && bytes > 0 && `${tamanhoLegivel(bytes)} · `}
        {jaTinham > 0 && comecando && `${jaTinham} já tinham ido antes — continuando · `}
        {detalhe}
      </p>

      {suaVez && (
        <button
          type="button"
          onClick={suaVez.seguir}
          className="w-full rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-85"
          style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
        >
          Salvar {p.preparadas} {p.preparadas === 1 ? "foto" : "fotos"} no celular
        </button>
      )}

      <div className="flex items-center justify-center gap-4 text-xs">
        <button
          type="button"
          onClick={aoParar}
          className="underline underline-offset-4 transition hover:opacity-70"
          style={{ color: "var(--g-suave)" }}
        >
          parar
        </button>
        {/* Só quando está continuando uma entrega anterior: é a saída de quem
            escolheu "Salvar em Arquivos" no menu por engano e agora teria
            aquelas fotos puladas. */}
        {jaTinham > 0 && (
          <button
            type="button"
            onClick={aoRecomecar}
            className="underline underline-offset-4 transition hover:opacity-70"
            style={{ color: "var(--g-suave)" }}
          >
            recomeçar do zero
          </button>
        )}
      </div>
    </div>
  );
}
