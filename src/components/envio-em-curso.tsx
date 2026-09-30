"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAvisoDeSaida } from "@/lib/aviso-de-saida-client";
import { useRouter } from "next/navigation";
import { gerarDerivadas } from "@/lib/derivadas-client";
import { dataDaFoto } from "@/lib/exif-client";
import type { RostoMedido } from "@/lib/rostos-client";
import { enviarEmPartes } from "@/lib/multipart-client";
import {
  PARALELOS,
  type ArquivoComCaminho,
  comRetentativa,
  erroDefinitivo,
  emParaleloDeFila,
  manterAcordado,
  ordenarNaturalPorCaminho,
  itemAceito,
  tamanhoDe,
} from "@/lib/fila-upload";
import { capitulosDaPasta } from "@/lib/capitulos-pasta";
import { LOTE_MAXIMO_DE_MEDIDAS, type MedidaDeEnvio } from "@/lib/velocidade-regras";
import { garantirSecoesAction } from "@/app/painel/actions";

/**
 * O ENVIO QUE SOBREVIVE À TROCA DE ABA.
 *
 * ── O EPISÓDIO ────────────────────────────────────────────────────────────
 *
 * 05/09/2026, Juan: "botei as fotos aqui e fui pro design, daí parou de subir
 * as fotos". Ele estava certo, e a causa era estrutural: a fila morava dentro
 * de `EnviarArquivos`, que é um componente da rota `/fotos`. Trocar para
 * `/design` DESMONTA a árvore daquela rota — e com ela o estado da fila, os
 * XMLHttpRequest em voo e o `manterAcordado`. Não era bug de lógica; era o
 * lugar errado.
 *
 * Ele descreveu a saída junto com a queixa: "no pixieset ele abre um tiquinho
 * ali embaixo que, independente da aba que eu tô mexendo, ele continua subindo
 * as fotos".
 *
 * ── POR QUE O LAYOUT RESOLVE ──────────────────────────────────────────────
 *
 * No App Router, o layout de `/painel/galerias/[id]` NÃO é remontado quando se
 * navega entre as quatro abas filhas — só o `children` troca. Um provedor
 * montado lá é exatamente o que continua vivo enquanto a pessoa vai para o
 * Design. A barra flutuante é filha dele, então aparece em qualquer aba.
 *
 * O componente da aba Fotos vira só a zona de arrastar: ele empurra os
 * arquivos para cá e não guarda estado de envio nenhum. É a razão de este
 * arquivo existir separado — se a fila voltar para dentro da aba, o defeito
 * volta junto, e `testar-upload.mjs` pergunta por isso.
 *
 * ── O QUE ISTO NÃO RESOLVE ────────────────────────────────────────────────
 *
 * Sair da galeria (ir para `/painel`, fechar a aba) continua matando o envio —
 * o `beforeunload` avisa, e é o que dá para prometer sem um Service Worker.
 * Enquanto a pessoa estiver DENTRO da galeria, o envio segue.
 */

type Situacao = "esperando" | "preparando" | "enviando" | "pronto" | "erro";

export interface ItemFila {
  id: string;
  /** A galeria para onde este arquivo vai — a importação manda para várias. */
  galeriaId: string;
  nome: string;
  bytes: number;
  progresso: number;
  situacao: Situacao;
  tentativa: number;
  /** Esperando a rede voltar — a tentativa não está sendo gasta. */
  semRede?: boolean;
  /** Por que a última tentativa falhou — aparece junto do "tentando de novo". */
  motivo?: string;
  /** O original foi pelo caminho alternativo (R2), porque o B2 não aceitou. */
  alternativo?: boolean;
  erro?: string;
  /** Quantos rostos a busca por rosto guardou desta foto. */
  rostos?: number;
}

export interface OpcoesDeEnvio {
  /**
   * Para qual galeria vai ESTE lote. Sem ele, vale a do provedor — que é o caso
   * da aba Fotos. A importação (`/painel/importar`) não tem galeria no provedor
   * e manda uma por lote: uma fila só para as 80 galerias, com a mesma pausa,
   * a mesma retentativa e os mesmos três envios de cada vez.
   */
  galeriaId?: string;
  /** Capítulo escolhido na tela, para os arquivos soltos (a pasta vence este). */
  destino?: string;
  /** A busca por rosto está ligada: cada foto é medida durante o envio. */
  rostosAtivos: boolean;
}

interface Envio {
  fila: ItemFila[];
  rodando: boolean;
  pausado: boolean;
  avisoRostos: string | null;
  /* Devolve quando o lote ENTROU na fila (capítulos criados, tarefas montadas),
     não quando terminou de subir. A importação espera cada um para as galerias
     entrarem na ordem da lista; a aba Fotos não precisa esperar. */
  enfileirar: (itens: ArquivoComCaminho[], opcoes: OpcoesDeEnvio) => Promise<void>;
  pausar: () => void;
  retomar: () => void;
  parar: () => void;
  /** Põe de volta na fila o que desistiu — sem arrastar a pasta de novo. */
  reenviarFalhas: () => void;
  limparConcluidos: () => void;
}

const Contexto = createContext<Envio | null>(null);

/** A fila desta galeria. Fora do provedor não existe envio — e isso é um erro. */
export function useEnvio(): Envio {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useEnvio fora do ProvedorDeEnvio");
  return ctx;
}

/**
 * Envia o arquivo direto para o bucket com XMLHttpRequest.
 * O `fetch` seria mais moderno, mas não reporta progresso de upload — e para
 * arquivo grande, barra de progresso não é enfeite: sem ela o usuário acha que
 * travou e recarrega a página no meio.
 */
function enviarComProgresso(
  url: string,
  arquivo: Blob,
  aoProgredir: (pct: number) => void,
  /*
   * O TIPO QUE O SERVIDOR DECIDIU, quando ele decidiu.
   *
   * A URL é assinada COM o content-type: se o servidor assinar `image/heic` e
   * daqui sair o cabeçalho vazio, o armazém recusa a assinatura. E vazio é
   * exatamente o que o Windows dá para um HEIC — ver `reconhecerArquivo`.
   * Sem o parâmetro vale o do arquivo, que é o caso de sempre.
   */
  mime?: string,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime || arquivo.type);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) aoProgredir(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      /* O armazém responde em XML com um código ("AccessDenied",
         "SignatureDoesNotMatch", teto de armazenamento…). É esse código que
         diz a nós o que houve — "HTTP 403" sozinho não diz. */
      const codigo = /<Code>([^<]{1,80})<\/Code>/.exec(xhr.responseText ?? "")?.[1];
      reject(new Error(`o armazenamento recusou (HTTP ${xhr.status}${codigo ? ` · ${codigo}` : ""})`));
    });
    /* Sem resposta nenhuma: a conexão caiu, ou a resposta veio sem permissão
       de CORS e o navegador a escondeu. Daqui não dá para saber qual. */
    xhr.addEventListener("error", () => reject(new Error("conexão interrompida")));
    xhr.addEventListener("abort", () => reject(new Error("envio cancelado")));
    xhr.send(arquivo);
  });
}

export const formatarBytesCurto = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
};

const duracao = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};

export function ProvedorDeEnvio({
  galeriaId,
  escopo,
  children,
}: {
  /** A galeria da aba Fotos. Ausente na importação, que diz a galeria a cada lote. */
  galeriaId?: string;
  /** O pedaço do painel que NÃO é saída — ver `useAvisoDeSaida`. */
  escopo?: string;
  children: React.ReactNode;
}) {
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [rodando, setRodando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [avisoRostos, setAvisoRostos] = useState<string | null>(null);
  const [inicio, setInicio] = useState<number | null>(null);
  /* Começa em 0, não em Date.now(): ler o relógio durante a renderização é
   * impuro (o servidor e o cliente leem instantes diferentes) e o valor era
   * lixo de qualquer forma — só serve depois que a fila começa. */
  const [agora, setAgora] = useState(0);

  /*
   * Pausa e parada vivem em `ref`, não em estado, e a razão é o portão.
   *
   * O portão é uma função criada UMA vez, quando a fila começa; se ela lesse
   * `pausado` do estado, leria o valor congelado daquele instante e o botão não
   * teria efeito nenhum sobre uma fila já em andamento. A `ref` é a mesma caixa
   * do começo ao fim. O estado existe em paralelo só para a tela redesenhar.
   */
  const pausadoRef = useRef(false);
  const paradoRef = useRef(false);
  const router = useRouter();

  const atualizar = (id: string, mudanca: Partial<ItemFila>) =>
    setFila((f) => f.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));

  // Relógio só enquanto a fila roda — alimenta a estimativa de tempo restante.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rodando]);

  /*
   * Sair no meio de 600 fotos perde o que faltava: avisa antes.
   *
   * Passou a cobrir também a navegação DENTRO do painel — clicar em "←
   * Galerias" com o envio rodando matava a fila em silêncio, porque o App
   * Router não recarrega a página e o `beforeunload` não dispara. Ver
   * `lib/aviso-de-saida-client.ts`.
   */
  useAvisoDeSaida(
    rodando,
    "O envio ainda está em andamento. Se sair agora, os arquivos que faltam não sobem.",
    /*
     * As quatro abas DESTA galeria não são saída: este provedor mora no layout
     * delas e não é remontado na troca — é o que o bloco "POR QUE O LAYOUT
     * RESOLVE" lá em cima garante. Perguntar ali ensinaria que não se pode
     * mexer no Design durante o envio, que é o contrário do que foi construído.
     *
     * A barra alta continua: sair da galeria mata a fila, e aí o aviso vale.
     */
    escopo ?? `/painel/galerias/${galeriaId}/`,
  );

  /*
   * ── UMA FILA, VÁRIOS LOTES (16/09/2026) ─────────────────────────────────
   *
   * Felipe: "não consigo enviar simultaneamente fotos para making of,
   * cerimônia, decoração, etc. Tenho que esperar subir as fotos de um dos
   * capítulos pra depois conseguir continuar subindo nos outros." E depois:
   * "não bloquear o 'enviar para capítulo'".
   *
   * O seletor de capítulo ficava desabilitado durante o envio, e a trava não
   * era capricho: `enfileirar` era uma corrida FECHADA. Ele montava o array do
   * lote, chamava `emParalelo` sobre ele e, no fim, desligava o "enviando".
   * Chamá-lo duas vezes criava duas corridas independentes — seis envios
   * simultâneos onde a rede comporta três, e a primeira a terminar apagando o
   * estado da outra.
   *
   * Agora `enfileirar` só PREPARA e EMPURRA: resolve os capítulos da pasta,
   * carrega o modelo de rosto se for o caso, monta as tarefas e as põe no fim
   * de `pendentes`. Quem envia é um trabalhador só (`trabalhar`), que puxa da
   * lista até ela secar. Um segundo lote no meio do primeiro entra na mesma
   * fila, e o seletor pode ficar livre.
   *
   * `pendentes` é ref e não estado: quem lê é o laço de envio, a cada arquivo,
   * e um estado daria a ele a lista congelada do render em que nasceu.
   */
  type Tarefa = {
    item: ItemFila;
    galeriaId: string;
    arquivo: File;
    /** Arquivo de dentro de um ZIP: o conteúdo só sai de lá na vez dele. */
    abrir?: () => Promise<File>;
    /** Já resolvido: a pasta vence o seletor da tela. */
    secaoId?: string;
    indice: number;
    /** O envio de que esta tarefa faz parte. Ver `loteAtual`. */
    lote?: string | null;
    medidor?: (bitmap: ImageBitmap) => Promise<RostoMedido[]>;
  };
  const pendentes = useRef<Tarefa[]>([]);
  /*
   * O QUE DESISTIU, GUARDADO PARA O "REENVIAR" (30/09/2026).
   *
   * A Alícia viu uma fileira de "conexão interrompida" e o único caminho era
   * arrastar a pasta de novo — e descobrir quais tinham subido. A tarefa
   * inteira fica aqui (o arquivo aberto, o capítulo, a posição na galeria),
   * então reenviar é devolvê-la à fila, na mesma ordem de antes.
   */
  const falhas = useRef(new Map<string, Tarefa>());
  /*
   * A MEDIDA DE CADA ARQUIVO (30/09/2026, migração 053).
   *
   * Felipe: "temos que ter velocidade e funcionar". O envio vai direto para o
   * armazém, e o servidor não via nem a velocidade nem as desistências — da
   * Alícia soubemos por foto. Cada arquivo que termina vira uma medida; elas
   * vão juntas, de tempos em tempos, e o painel de administração mostra.
   * Mandar e esquecer: falhar aqui não pode atrapalhar envio nenhum.
   */
  const medidas = useRef<MedidaDeEnvio[]>([]);
  const enviarMedidas = useCallback(() => {
    if (medidas.current.length === 0) return;
    const lote = medidas.current.splice(0, LOTE_MAXIMO_DE_MEDIDAS);
    fetch("/api/envio/medidas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medidas: lote }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  const anotar = useCallback(
    (m: MedidaDeEnvio) => {
      medidas.current.push(m);
      if (medidas.current.length >= 25) enviarMedidas();
    },
    [enviarMedidas],
  );
  /* Quem fecha a aba no meio ainda manda o que já mediu. */
  useEffect(() => {
    window.addEventListener("pagehide", enviarMedidas);
    return () => window.removeEventListener("pagehide", enviarMedidas);
  }, [enviarMedidas]);
  const trabalhandoRef = useRef(false);
  /*
   * A ORDEM continua de onde parou entre lotes.
   *
   * O índice vira posição na galeria (ver `criarMediaPendente`). Se o segundo
   * lote recomeçasse do zero enquanto o primeiro ainda sobe, as duas metades
   * disputariam as mesmas posições e a narrativa do casamento sairia
   * embaralhada. O contador só zera quando a fila seca.
   *
   * Um contador POR GALERIA: a posição é dentro da galeria, e na importação a
   * segunda galeria começaria na posição 600 da primeira.
   */
  const proximoIndice = useRef(new Map<string, number>());
  /*
   * O LOTE — um nome para ESTE envio, e o par do contador acima.
   *
   * O índice diz "sou o arquivo 37"; o lote diz "de qual envio". Sem os dois, o
   * servidor não tem como saber onde a galeria terminava antes de o envio
   * começar, e a base da posição escorrega conforme o lote vai ficando pronto —
   * era o que embaralhava as 286 fotos do Juan. Ver `criarMediaPendente` e a
   * migração 038.
   *
   * Nasce quando a fila sai do zero e zera junto com o contador, pelo mesmo
   * motivo: enquanto houver arquivo subindo, é tudo o mesmo envio.
   */
  const loteAtual = useRef<string | null>(null);

  const enviarUm = useCallback(
    async (tarefa: Tarefa) => {
      /*
       * O preparo acontece UMA vez, mesmo com várias tentativas.
       *
       * Antes ele estava dentro do `comRetentativa`: uma queda de rede durante
       * o envio fazia a tentativa seguinte chamar /upload de novo e nascer uma
       * SEGUNDA linha em `medias`. A primeira ficava pendente para sempre,
       * segurando espaço da quota por um arquivo que nunca existiu.
       */
      type Preparo = {
        mediaId: string;
        urlThumb?: string;
        urlPreview?: string;
        /* O tipo que o servidor decidiu — ver `reconhecerArquivo`. */
        mime?: string;
      } & (
        | { emPartes: true; tamanhoParte: number }
        | { emPartes: false; url: string }
      );
      let preparado: Preparo | null = null;
      let arquivo = tarefa.arquivo;
      /* O tempo do envio do ORIGINAL na tentativa que deu certo — a parte que
         depende da rede. Ver `medidas`. */
      let envioMs: number | null = null;
      /*
       * O CAMINHO ALTERNATIVO (30/09/2026). A Alícia ficou com "0 de 38": o
       * PUT do original para o B2 caía SEMPRE na máquina dela, com 675 fotos
       * já enviadas antes. Depois de duas falhas no armazém, a mídia pendente é
       * solta e o arquivo pede outra vaga, agora no R2 (ver a rota de upload).
       * Uma vez só por arquivo: se o R2 também falhar, é a rede dela, e a
       * retentativa segue como sempre.
       */
      let alternativo = false;
      let falhasNoArmazem = 0;

      try {
        /* Fora da retentativa: um ZIP que não abre este arquivo não abre na
           segunda vez, e o erro diz qual foi. */
        if (tarefa.abrir) {
          atualizar(tarefa.item.id, { situacao: "preparando", progresso: 0 });
          arquivo = await tarefa.abrir();
        }
        await comRetentativa(
          async () => {
            atualizar(tarefa.item.id, { situacao: "preparando", progresso: 0 });
            /*
             * A data da câmera sai do EXIF junto com as derivadas — mesmo
             * momento em que o arquivo já está aberto no navegador. Depois do
             * envio ele mora no bucket, e ler o cabeçalho de volta custaria
             * banda por foto. Ver `lib/exif-client.ts`.
             *
             * Em paralelo com a derivada porque são trabalhos independentes: um
             * lê 128 KB do começo do arquivo, o outro decodifica a imagem.
             */
            const [derivadas, tiradaEm] = await Promise.all([
              gerarDerivadas(arquivo, { medirRostos: tarefa.medidor }),
              dataDaFoto(arquivo),
            ]);

            atualizar(tarefa.item.id, { situacao: "enviando" });

            if (!preparado) {
              const preparo = await fetch(`/api/galerias/${tarefa.galeriaId}/upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  nome: arquivo.name,
                  mime: arquivo.type,
                  bytes: arquivo.size,
                  comDerivadas: Boolean(derivadas),
                  /* Vídeo manda pôster e não manda preview: sem este aviso a
                     rota reservaria a chave do preview e a mídia ficaria com um
                     `chave_preview` apontando para um arquivo que nunca sobe —
                     e o lightbox pediria esse arquivo em vez do filme. */
                  comPreview: Boolean(derivadas?.preview),
                  /* A data que a CÂMERA gravou, para a ordenação cronológica
                     do capítulo. Nula em vídeo, PNG e foto exportada sem
                     metadados — e aí a ordem cai na de envio, dizendo quantas.
                     Ver `lib/exif-client.ts` e a migração 035. */
                  tiradaEm: tiradaEm?.toISOString(),
                  largura: derivadas?.largura,
                  altura: derivadas?.altura,
                  /* Só vídeo: o cartão do episódio no formato Stream. */
                  duracao: derivadas?.duracao,
                  /* A pasta manda: o capítulo lido do disco vence o seletor
                   * da tela, que é o palpite para arquivos soltos. */
                  secaoId: tarefa.secaoId,
                  // A ordem que o fotógrafo escolheu é a narrativa do casamento.
                  indice: tarefa.indice,
                  /* E o lote é o que impede a base da posição de subir no meio
                     do envio. Ver `criarMediaPendente` e a migração 038. */
                  lote: tarefa.lote ?? undefined,
                  alternativo: alternativo || undefined,
                }),
              });
              const corpo = await preparo.json().catch(() => ({}));
              if (!preparo.ok) {
                /* Sem espaço (507), tipo recusado, grande demais, e-mail por
                   confirmar, assinatura vencida, galeria no cofre, sessão
                   expirada: insistir não resolve, e a pessoa precisa ler o
                   motivo AGORA, não depois de dois minutos de "tentando de
                   novo". Só 408 e 429 (e o 5xx) valem outra tentativa. */
                const definitivo =
                  preparo.status === 507 ||
                  (preparo.status >= 400 && preparo.status < 500 && preparo.status !== 408 && preparo.status !== 429);
                const mensagem = corpo.erro ?? `não foi possível preparar o envio (HTTP ${preparo.status})`;
                throw definitivo ? erroDefinitivo(mensagem) : new Error(mensagem);
              }
              preparado = corpo;
            }
            const dados = preparado!;

            /*
             * As DERIVADAS sobem JUNTO com o original, não depois dele.
             * Medido em 03/09/2026: enfileirá-las atrás do original custava
             * 0,8 s por foto para 300 KB. Não é banda, é latência.
             */
            /*
             * O PREVIEW PODE NÃO EXISTIR, e isso é vídeo (16/09/2026).
             *
             * Vídeo gera pôster e não gera arquivo de 2048 px — ver
             * `Derivadas.preview`. As duas subidas viraram uma lista
             * montada, em vez de um par fixo: com o par, um `urlPreview`
             * nulo derrubava a miniatura do vídeo junto, e a grade voltava
             * ao retângulo cinza que o Felipe fotografou.
             */
            const paraSubir: Array<Promise<unknown>> = [];
            if (derivadas && dados.urlThumb) {
              paraSubir.push(enviarComProgresso(dados.urlThumb, derivadas.thumb, () => {}));
            }
            if (derivadas?.preview && dados.urlPreview) {
              paraSubir.push(enviarComProgresso(dados.urlPreview, derivadas.preview, () => {}));
            }
            const derivadasSubindo = paraSubir.length
              ? Promise.allSettled(paraSubir)
              : Promise.resolve();

            // Arquivo grande (filme 4K) vai em partes; o resto num envio só.
            const inicioDoEnvio = performance.now();
            if (dados.emPartes) {
              await enviarEmPartes(dados.mediaId, arquivo, dados.tamanhoParte, (pct) =>
                atualizar(tarefa.item.id, { progresso: pct }),
              );
            } else {
              try {
                await enviarComProgresso(
                  dados.url,
                  arquivo,
                  (pct) => atualizar(tarefa.item.id, { progresso: pct }),
                  dados.mime,
                );
              } catch (e) {
                falhasNoArmazem++;
                if (!alternativo && falhasNoArmazem >= 2) {
                  /* Solta a vaga no armazém principal e a próxima tentativa
                     pede outra no alternativo. */
                  await fetch(`/api/medias/${dados.mediaId}/confirmar`, { method: "DELETE" }).catch(() => {});
                  preparado = null;
                  alternativo = true;
                  atualizar(tarefa.item.id, { alternativo: true });
                }
                throw e;
              }
            }
            envioMs = performance.now() - inicioDoEnvio;
            await derivadasSubindo;

            // O envio em partes já se confirma ao fechar; o simples precisa deste passo.
            if (!dados.emPartes) {
              const conf = await fetch(`/api/medias/${dados.mediaId}/confirmar`, {
                method: "POST",
              });
              if (!conf.ok) {
                const c = await conf.json();
                throw new Error(c.erro ?? "o arquivo não foi confirmado");
              }
            }

            /*
             * Os rostos sobem DEPOIS da confirmação e fora da retentativa: a
             * foto já está entregue, e falhar aqui não pode desfazê-la.
             */
            if (tarefa.medidor && derivadas?.rostos) {
              const rostos = await derivadas.rostos.catch(() => null);
              if (rostos) {
                const r = await fetch(`/api/medias/${dados.mediaId}/rostos`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rostos }),
                }).catch(() => null);
                if (r?.ok) {
                  const { salvos } = (await r.json()) as { salvos: number };
                  atualizar(tarefa.item.id, { rostos: salvos });
                }
              }
            }
          },
          (tentativa, semRede, erro) =>
            atualizar(tarefa.item.id, {
              tentativa,
              semRede,
              situacao: "esperando",
              progresso: 0,
              motivo: erro instanceof Error ? erro.message : undefined,
            }),
        );

        atualizar(tarefa.item.id, { situacao: "pronto", progresso: 100, semRede: false, motivo: undefined });
        anotar({ galeriaId: tarefa.galeriaId, bytes: arquivo.size, ms: envioMs, ok: true, erro: null });
      } catch (e) {
        /*
         * Desistiu de vez: solta a reserva agora em vez de deixar o espaço
         * preso até a limpeza diária passar.
         */
        const p = preparado as { mediaId: string; emPartes: boolean } | null;
        if (p?.mediaId) {
          const rota = p.emPartes
            ? `/api/medias/${p.mediaId}/partes`
            : `/api/medias/${p.mediaId}/confirmar`;
          await fetch(rota, { method: "DELETE" }).catch(() => {});
        }
        atualizar(tarefa.item.id, {
          situacao: "erro",
          semRede: false,
          erro: e instanceof Error ? e.message : "falhou",
        });
        falhas.current.set(tarefa.item.id, tarefa);
        anotar({
          galeriaId: tarefa.galeriaId,
          bytes: arquivo.size,
          ms: null,
          ok: false,
          /* "também pelo R2" separa, no painel, a rede de quem envia (os dois
             caminhos falharam) de um problema só do B2. */
          erro: `${e instanceof Error ? e.message : "falhou"}${alternativo ? " (também pelo R2)" : ""}`,
        });
      }
    },
    [anotar],
  );

  const trabalhar = useCallback(async () => {
    if (trabalhandoRef.current) return;
    trabalhandoRef.current = true;
    setRodando(true);
    setInicio((atual) => atual ?? Date.now());
    setAgora(Date.now()); // sem isto, o primeiro segundo mostraria tempo negativo

    const soltar = await manterAcordado();
    await emParaleloDeFila(
      () => pendentes.current.shift() ?? null,
      PARALELOS,
      enviarUm,
      async () => (paradoRef.current ? "parar" : pausadoRef.current ? "esperar" : "seguir"),
    );
    soltar();
    enviarMedidas();

    trabalhandoRef.current = false;
    setRodando(false);
    setPausado(false);
    proximoIndice.current = new Map();
    loteAtual.current = null;
    /* O que ficou em "esperando" quando alguém parou não vai subir: dizer isso
       é melhor que deixar a linha girando para sempre. */
    if (paradoRef.current) {
      /* O que não chegou a sair também pode ser reenviado depois. */
      for (const t of pendentes.current) falhas.current.set(t.item.id, t);
      pendentes.current = [];
      setFila((f) =>
        f.map((i) =>
          i.situacao === "esperando" || i.situacao === "preparando" || i.situacao === "enviando"
            ? { ...i, situacao: "erro", erro: "parado por você" }
            : i,
        ),
      );
    }
    router.refresh();
  }, [enviarUm, enviarMedidas, router]);

  const enfileirar = useCallback(
    async (brutos: ArquivoComCaminho[], opcoes: OpcoesDeEnvio) => {
      const alvo = opcoes.galeriaId ?? galeriaId;
      if (!alvo) return;
      const itens = ordenarNaturalPorCaminho(brutos.filter(itemAceito));
      if (itens.length === 0) return;

      paradoRef.current = false;
      pausadoRef.current = false;
      setPausado(false);

      /*
       * A pasta do fotógrafo JÁ está organizada — "01 Making Of", "02 Cerimônia".
       * Ler isso aqui é o que evita ele refazer no painel o que já fez no disco.
       *
       * Acontece antes do primeiro arquivo subir, numa chamada só: descobrir o
       * capítulo arquivo a arquivo seriam centenas de idas ao servidor.
       * Se falhar, o envio segue para o destino escolhido na tela — perder o
       * capítulo é chato, perder o casamento inteiro é inaceitável.
       */
      const porCaminho = new Map<string, string>();
      const capitulos = capitulosDaPasta(itens.map((i) => i.caminho));
      if (capitulos.length > 0) {
        try {
          const criados = await garantirSecoesAction(
            alvo,
            capitulos.map((c) => c.nome),
          );
          const idPorNome = new Map(criados.map((c) => [c.nome, c.id]));
          for (const c of capitulos) {
            const id = idPorNome.get(c.nome);
            if (id) for (const caminho of c.caminhos) porCaminho.set(caminho, id);
          }
        } catch {
          // segue sem capítulo; o fotógrafo move depois, e nada se perde
        }
      }

      /*
       * A BUSCA POR ROSTO entra aqui, e só aqui: com ela ligada, cada foto é
       * medida no ORIGINAL enquanto está aberta para gerar as derivadas. É o
       * único momento em que o original está decodificado no navegador — depois
       * ele mora no B2, e cada byte lido de lá é cobrado.
       *
       * O modelo (12 MB) é baixado uma vez por sessão. Se não carregar (sem
       * WebGL, rede ruim), o envio SEGUE sem medir: a foto entra na fila de
       * "ainda não medidas" do painel.
       */
      let medidor: ((bitmap: ImageBitmap) => Promise<RostoMedido[]>) | undefined;
      if (opcoes.rostosAtivos) {
        try {
          const rostosClient = await import("@/lib/rostos-client");
          await rostosClient.carregarModelos("fotografo");
          medidor = rostosClient.medirRostos;
          setAvisoRostos(
            rostosClient.backendEmUso() === "webgl"
              ? null
              : "Este computador está sem aceleração gráfica: medir os rostos leva uns 12 segundos por foto.",
          );
        } catch {
          setAvisoRostos(
            "Não consegui carregar o reconhecimento de rosto. As fotos sobem normalmente; dá para medi-las depois, em “Busca por rosto”.",
          );
        }
      }

      /* `randomUUID` exige contexto seguro; em http://…:3040 de bancada ele não
         existe. Sem lote a conta volta a ser a antiga, que é pior mas funciona
         — envio não pode falhar por causa disto. */
      loteAtual.current ??= globalThis.crypto?.randomUUID?.() ?? null;

      const base = proximoIndice.current.get(alvo) ?? 0;
      const lote = itens.map((it, k) => {
        const item: ItemFila = {
          /* O `k` sozinho repetia entre lotes enfileirados no mesmo
             milissegundo; o índice mais a galeria não repetem nunca. */
          id: `${Date.now()}-${alvo}-${base + k}-${it.arquivo.name}`,
          galeriaId: alvo,
          nome: it.arquivo.name,
          bytes: tamanhoDe(it),
          progresso: 0,
          situacao: "esperando" as const,
          tentativa: 0,
        };
        return {
          item,
          galeriaId: alvo,
          arquivo: it.arquivo,
          abrir: it.deZip?.abrir,
          /* A pasta manda: o capítulo lido do disco vence o seletor da tela,
             que é o palpite para arquivos soltos. Resolvido AQUI e guardado na
             tarefa — na hora do envio o seletor já pode estar em outro
             capítulo, que é justamente o que esta mudança libera. */
          secaoId: porCaminho.get(it.caminho) || opcoes.destino || undefined,
          indice: base + k,
          lote: loteAtual.current,
          medidor,
        };
      });
      proximoIndice.current.set(alvo, base + lote.length);

      pendentes.current.push(...lote);
      setFila((f) => [...f, ...lote.map((t) => t.item)]);
      void trabalhar();
    },
    [galeriaId, trabalhar],
  );

  const valor = useMemo<Envio>(
    () => ({
      fila,
      rodando,
      pausado,
      avisoRostos,
      enfileirar,
      pausar: () => {
        pausadoRef.current = true;
        setPausado(true);
      },
      retomar: () => {
        pausadoRef.current = false;
        setPausado(false);
      },
      parar: () => {
        paradoRef.current = true;
        pausadoRef.current = false;
        setPausado(false);
      },
      reenviarFalhas: () => {
        const lista = [...falhas.current.values()].sort((a, b) => a.indice - b.indice);
        if (lista.length === 0) return;
        falhas.current.clear();
        const ids = new Set(lista.map((t) => t.item.id));
        setFila((f) =>
          f.map((i) =>
            ids.has(i.id)
              ? { ...i, situacao: "esperando", progresso: 0, tentativa: 0, semRede: false, motivo: undefined, alternativo: false, erro: undefined }
              : i,
          ),
        );
        paradoRef.current = false;
        pendentes.current.push(...lista);
        void trabalhar();
      },
      limparConcluidos: () => {
        falhas.current.clear();
        setFila([]);
      },
    }),
    [fila, rodando, pausado, avisoRostos, enfileirar, trabalhar],
  );

  const enviados = fila.filter((i) => i.situacao === "pronto").length;
  const comErro = fila.filter((i) => i.situacao === "erro").length;
  const restantes = fila.length - enviados - comErro;
  const decorrido = inicio ? agora - inicio : 0;
  const restante =
    enviados >= 2 && restantes > 0 ? duracao((decorrido / enviados) * restantes) : null;

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/*
        O ESPAÇADOR QUE DEVOLVE O FIM DA PÁGINA.

        Felipe, 16/09/2026, com a foto: "a barra do rodapé tá em cima do botão".
        Ele estava no fim da aba de Entrega, e o "Apagar galeria" desaparecia
        sob a barra de envio.

        É o preço do `fixed`: a barra sai do fluxo, e o navegador termina a
        página como se ela não existisse. A resposta é reservar em BAIXO o
        espaço que ela ocupa — um bloco vazio no fluxo, irmão do conteúdo.

        A altura é a da barra RECOLHIDA, que é como ela passa a maior parte do
        tempo. Aberta ela cresce, mas aí a pessoa está olhando para a lista de
        arquivos, não para o pé da página; reservar a altura máxima deixaria um
        buraco permanente embaixo de toda tela durante o envio inteiro.

        `aria-hidden` porque não há nada para ler aqui: quem usa leitor de tela
        não tem barra por cima de botão nenhum.
      */}
      {fila.length > 0 && <div aria-hidden className="h-16" />}
      {fila.length > 0 && (
        <BarraDeEnvio
          fila={fila}
          enviados={enviados}
          comErro={comErro}
          restante={restante}
          rodando={rodando}
          pausado={pausado}
          aoPausar={valor.pausar}
          aoRetomar={valor.retomar}
          aoParar={valor.parar}
          aoReenviar={valor.reenviarFalhas}
          aoLimpar={valor.limparConcluidos}
        />
      )}
    </Contexto.Provider>
  );
}

/**
 * A barra de baixo — "o tiquinho ali embaixo" do Pixieset.
 *
 * `fixed`, e não um bloco na página: ela precisa estar visível no Design e na
 * Entrega, onde a página é outra. Recolhida por padrão porque o normal é a
 * pessoa estar fazendo outra coisa — é uma barra de status, não uma tela.
 */
function BarraDeEnvio({
  fila,
  enviados,
  comErro,
  restante,
  rodando,
  pausado,
  aoPausar,
  aoRetomar,
  aoParar,
  aoReenviar,
  aoLimpar,
}: {
  fila: ItemFila[];
  enviados: number;
  comErro: number;
  restante: string | null;
  rodando: boolean;
  pausado: boolean;
  aoPausar: () => void;
  aoRetomar: () => void;
  aoParar: () => void;
  aoReenviar: () => void;
  aoLimpar: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const pct = fila.length ? (enviados / fila.length) * 100 : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-linha bg-carbon/95 backdrop-blur">
      <div className="mx-auto max-w-5xl px-6 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setAberta((v) => !v)}
            aria-expanded={aberta}
            className="flex items-center gap-2 text-sm font-medium transition hover:text-acento"
          >
            <span aria-hidden className="text-texto-faint">
              {aberta ? "▾" : "▸"}
            </span>
            {rodando
              ? pausado
                ? "Envio pausado"
                : "Enviando…"
              : comErro > 0
                ? "Envio concluído com falhas"
                : "Envio concluído"}
          </button>

          <span className="text-xs tabular-nums text-texto-soft">
            {enviados} de {fila.length}
            {comErro > 0 ? ` · ${comErro} com erro` : ""}
            {restante ? ` · ~${restante} restantes` : ""}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {rodando ? (
              <>
                <button
                  type="button"
                  onClick={pausado ? aoRetomar : aoPausar}
                  className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2"
                >
                  {pausado ? "Continuar" : "Pausar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Parar o envio? O que ainda não subiu não vai subir.")) aoParar();
                  }}
                  className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs text-alerta transition hover:bg-carbon-2"
                >
                  Parar
                </button>
              </>
            ) : (
              <>
                {comErro > 0 && (
                  <button
                    type="button"
                    onClick={aoReenviar}
                    className="rounded-lg border border-acento px-3 py-1.5 text-xs text-acento-alto transition hover:bg-acento/10"
                  >
                    Reenviar {comErro === 1 ? "o que falhou" : `os ${comErro} que falharam`}
                  </button>
                )}
              <button
                type="button"
                onClick={aoLimpar}
                className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
              >
                Fechar
              </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-carbon-2">
          <div
            className={`h-full rounded-full transition-[width] ${pausado ? "bg-alerta" : "bg-acento"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {aberta && (
          <ul className="mt-2.5 flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
            {fila.map((item) => (
              <li key={item.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{item.nome}</span>
                  <span className="shrink-0 tabular-nums text-texto-faint">
                    {item.situacao === "erro" ? (
                      <span className="text-erro">{item.erro}</span>
                    ) : item.situacao === "pronto" ? (
                      <span className="text-ok">
                        enviado
                        {item.rostos !== undefined &&
                          ` · ${item.rostos} ${item.rostos === 1 ? "rosto" : "rostos"}`}
                      </span>
                    ) : item.semRede ? (
                      <span className="text-alerta">sem internet — continua quando voltar</span>
                    ) : item.tentativa > 0 && item.situacao === "esperando" ? (
                      <span className="text-alerta">
                        tentando de novo ({item.tentativa})…
                        {item.motivo && ` ${item.motivo}`}
                        {item.alternativo && " · agora por outro caminho"}
                      </span>
                    ) : item.situacao === "preparando" ? (
                      "preparando…"
                    ) : (
                      `${item.progresso}% · ${formatarBytesCurto(item.bytes)}${
                        item.tentativa > 0 ? ` · tentativa ${item.tentativa + 1}` : ""
                      }${item.alternativo ? " · outro caminho" : ""}`
                    )}
                  </span>
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-carbon-2">
                  <div
                    className={`h-full transition-[width] ${
                      item.situacao === "erro"
                        ? "bg-erro"
                        : item.situacao === "pronto"
                          ? "bg-ok"
                          : "bg-acento"
                    }`}
                    style={{ width: `${item.situacao === "erro" ? 100 : item.progresso}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
