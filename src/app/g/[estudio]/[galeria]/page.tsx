import type { Metadata } from "next";
import { FUSO } from "@/config/fuso";
import { cookies, headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { marca } from "@/config/marca";
import { CAMINHO_PUBLICO } from "@/proxy";
import { COOKIE_PREVIA } from "@/config/previa";
import { urlDeLeitura } from "@/lib/r2";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { fotosDeDemonstracao } from "@/config/fotos-demonstracao";
import {
  estadoSelecao,
  favoritasDaPessoa,
  pessoaAtual,
  dadosDaPessoa,
} from "@/lib/favoritas";
import { galeriasNoAr } from "@/lib/assinatura";
import { asaasConfigurado } from "@/lib/asaas";
import { resolverEstudio } from "@/lib/endereco";
import { resolverGaleriaDoEstudio } from "@/lib/endereco-galeria";
import {
  buscarGaleriaPublica,
  listarMediasPublicas,
  temAcessoLiberado,
  registrarAcesso,
} from "@/lib/galerias-publicas";
import { listarSecoes, secaoPeloApelido } from "@/lib/secoes";
import { nomeDoGrupoSolto } from "@/lib/nome-de-arquivo";
import { fatiarGaleria, FOTOS_POR_TELA, TETO_DE_ESCOLHIDAS } from "@/config/fatia-galeria";
import { sessaoAtual } from "@/lib/auth";
import {
  GaleriaCliente,
  type ItemGaleria,
  type CapituloGaleria,
} from "@/components/galeria-cliente";
import { GaleriaCapa } from "@/components/galeria-capa";
import {
  lerAparencia,
  AMOSTRA_PREVIA,
  variaveisDaEntrega,
  variaveisDeForma,
  FONTES_TEXTO,
} from "@/config/aparencia";
import { FAMILIA_PROPRIA } from "@/lib/fonte-estudio";
import { lerSite } from "@/lib/site-estudio";
import { modoPeloUserAgent } from "@/lib/modo-de-entrega";
import { enderecoNaGaleria } from "@/lib/endereco-na-galeria";
import {
  telaDaEntrega,
  voltaDaGaleria,
  tituloDoEpisodio,
  type ConteudoParaFormato,
} from "@/lib/formato-da-entrega";
import { GaleriaPastas, VoltarAsPastas, type PastaDaEntrega } from "@/components/galeria-pastas";
import { GaleriaStream, type FileiraDoStream } from "@/components/galeria-stream";
import { AncoraDeChegada } from "@/components/ancora-de-chegada";
import { aparenciaPermitida } from "@/lib/acesso-formatos";
import { configDoRecado } from "@/config/recado";
import { escolherCapa, urlDaCapa } from "@/lib/capa-publica";
import { PortaoDeSenha } from "./portao";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ estudio: string; galeria: string }>;
  /* `capa` é declarado e NUNCA lido: a prévia da aba Design o carrega só para
     que o endereço mude quando a capa muda, e o iframe recarregue. Está aqui
     para que quem vir o parâmetro na URL saiba que ele não faz nada aqui. */
  /*
   * `cap` e `fotos` existem por causa do defeito de 11/09/2026 — ver
   * `config/fatia-galeria.ts`. Galeria acima do teto não cabe num documento
   * só, e o corte tem de ser AQUI: mandar tudo e esconder no cliente não tira
   * um byte do que estourou o Safari da Carol.
   *
   *   cap    o capítulo escolhido no menu
   *   fotos  uma lista de ids — é como a busca por rosto entrega o resultado
   *          numa galeria fatiada, sem depender de a foto estar no capítulo
   *          que por acaso está carregado
   *   (o `parte` de 16/09/2026 saiu no mesmo dia: a rolagem infinita o
   *    substituiu — ver o comentário em `fatiarGaleria` abaixo)
   */
  searchParams: Promise<{
    previa?: string;
    amostra?: string;
    ap?: string;
    capa?: string;
    cap?: string;
    fotos?: string;
    /* `ver=galeria`: o "Ver as fotos" da entrega em stream. Ver
       `lib/formato-da-entrega.ts`. */
    ver?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio, galeria } = await params;
  const g = await buscarGaleriaPublica(estudio, galeria);
  if (!g) return { title: "Galeria" };

  /*
   * ── O CARTÃO DO WHATSAPP É DO FOTÓGRAFO, NÃO NOSSO (06/09/2026) ─────────
   *
   * Até aqui esta função definia só o `title` — o da aba do navegador. Sem um
   * bloco `openGraph` próprio, o Next herda o da raiz, e o cartão que o casal
   * recebia dizia "Galeria Átomo — Onde o instante permanece" com o subtítulo
   * "Galerias inteligentes para fotógrafos". A entrega mais pessoal que o
   * fotógrafo faz no ano chegava anunciando o fornecedor dele.
   *
   * A imagem já era da galeria desde 31/08/2026 (ver `opengraph-image.tsx`);
   * faltava o texto ao lado dela. A Carol mandou o print em 06/09/2026 por
   * outro motivo — a cor —, e os dois estavam no mesmo cartão.
   *
   * `siteName` também vira o nome do estúdio: em alguns aplicativos ele
   * aparece por cima do título, e era mais um lugar dizendo a marca errada.
   */
  const dataEvento = g.data_evento
    ? new Date(g.data_evento).toLocaleDateString("pt-BR", { timeZone: FUSO,
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;
  const descricao = [g.subtitulo, dataEvento, `Fotos por ${g.estudio_nome}`]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${g.titulo} · ${g.estudio_nome}`,
    // Galeria é pessoal: nunca deve aparecer em busca, mesmo com o link vazado.
    robots: { index: false, follow: false },
    description: descricao,
    openGraph: {
      type: "website",
      siteName: g.estudio_nome,
      title: g.titulo,
      description: descricao,
    },
    twitter: { card: "summary_large_image", title: g.titulo, description: descricao },
  };
}

export default async function GaleriaPublicaPage({ params, searchParams }: Props) {
  const { estudio, galeria: galeriaSlug } = await params;
  const { previa, amostra, ap, cap, fotos, ver } = await searchParams;

  /*
   * PRÉVIA DO DONO.
   *
   * O fotógrafo escolhe a aparência enquanto a galeria ainda é rascunho — e até
   * agora a prévia do painel mostrava a página de 404, fazendo o recurso parecer
   * quebrado no momento em que era mais útil.
   *
   * A permissão vem da SESSÃO, não do parâmetro: `?previa=1` sozinho não abre
   * nada. Só quem está logado como o dono daquela galeria vê o rascunho — e,
   * mais abaixo, também pula o portão de senha, porque pedir a própria senha
   * para o dono conferir o próprio trabalho não faz sentido.
   *
   * O PEDIDO chega de três jeitos (29/09/2026, ver `config/previa.ts`):
   *   - `?previa=1`, que continua valendo — é o que a caixinha do editor usa;
   *   - o cookie em que o proxy troca esse parâmetro, para a barra do navegador
   *     mostrar o link do cliente e não o do dono;
   *   - a galeria ainda não publicada: ali não existe versão do cliente, então o
   *     dono logado vê o rascunho mesmo sem pedir, e o cookie vencer no meio da
   *     conferência não vira 404.
   */
  const rascunho = await buscarGaleriaPublica(estudio, galeriaSlug, true);
  const pedePrevia =
    Boolean(previa) ||
    (await cookies()).get(COOKIE_PREVIA)?.value === "1" ||
    rascunho?.publicada === false;
  const sessao = pedePrevia && rascunho ? await sessaoAtual() : null;
  const ehDono = Boolean(sessao && rascunho && sessao === rascunho.tenant_id);

  const galeria = ehDono ? rascunho : await buscarGaleriaPublica(estudio, galeriaSlug);

  /*
   * O ENDEREÇO ANTIGO DO ESTÚDIO ainda abre — este é o ponto de toda a migração
   * 025.
   *
   * Quem trocou de endereço tem links já entregues apontando para o anterior, e
   * link de casamento não se reenvia: ele está num grupo de WhatsApp que ninguém
   * vai reabrir. Se a galeria não foi encontrada, pode ser porque o visitante
   * veio pelo apelido — e aí ele é mandado ao endereço de hoje, com 301
   * permanente, para o navegador e o buscador aprenderem a troca.
   *
   * Só depois disso é 404. A ordem importa: o `notFound()` antes daqui é o que
   * quebrava o link.
   */
  if (!galeria) {
    const dono = await resolverEstudio(estudio);
    if (dono?.ehAntigo) {
      permanentRedirect(`/g/${dono.slugAtual}/${galeriaSlug}`);
    }
    /*
     * O ENDEREÇO ANTIGO DA GALERIA (05/09/2026, migração 030).
     *
     * A mesma história do estúdio, um nível abaixo: o fotógrafo trocou o
     * endereço da galeria e o link que o casal tem no WhatsApp é o anterior.
     * Sem isto, trocar o endereço mataria o link — que é exatamente por que o
     * campo era travado.
     *
     * Vem DEPOIS da tentativa pelo endereço do estúdio porque as duas trocas
     * podem ter acontecido: quem chega por `/g/<estudio-antigo>/<galeria-antiga>`
     * é mandado primeiro para o estúdio de hoje, e a segunda passada resolve a
     * galeria. Dois redirecionamentos permanentes em vez de um, e cada um deles
     * é uma verdade que o navegador aprende.
     */
    if (dono) {
      const antiga = await resolverGaleriaDoEstudio(dono.tenantId, galeriaSlug);
      if (antiga?.ehAntigo) {
        permanentRedirect(`/g/${dono.slugAtual}/${antiga.slugAtual}`);
      }
    }
    notFound();
  }

  /*
   * O estúdio testou, sumiu, e a carência acabou.
   *
   * Vem ANTES do arquivamento e da senha de propósito: o portão da senha
   * pediria a chave para abrir uma porta que não abre mais, e o visitante
   * concluiria que errou a senha.
   *
   * O dono continua vendo — é a tela onde ele descobre por que a galeria dele
   * sumiu, e de onde ele sai para assinar.
   */
  if (!ehDono && !galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate }, asaasConfigurado())) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">{galeria.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">
          Esta galeria está fora do ar no momento. Fale com {galeria.estudio_nome} para reabri-la —
          nada foi perdido.
        </p>
      </main>
    );
  }

  if (galeria.estado === "arquivada") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">{galeria.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">
          Esta galeria está guardada no cofre. Fale com {galeria.estudio_nome} para reativá-la —
          nada foi perdido.
        </p>
      </main>
    );
  }

  if (galeria.expira_em && new Date(galeria.expira_em) < new Date()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
        <h1 className="font-serif text-2xl font-bold">{galeria.titulo}</h1>
        <p className="mt-3 text-sm text-texto-soft">
          O prazo desta galeria terminou. Fale com {galeria.estudio_nome}.
        </p>
      </main>
    );
  }

  // O dono não precisa passar pela própria senha para conferir o próprio trabalho.
  if (!ehDono && galeria.senha_hash && !(await temAcessoLiberado(galeria.id, galeria.senha_hash))) {
    return (
      <PortaoDeSenha
        estudio={estudio}
        galeria={galeriaSlug}
        titulo={galeria.titulo}
        nomeEstudio={galeria.estudio_nome}
        /*
          A APARÊNCIA PUBLICADA, e só ela (01/10/2026).

          O portão passou a desenhar com o tema, as fontes e o acabamento da
          galeria — pedido do Juan e do Felipe: "o design da página que coloca a
          senha tem que seguir o padrão escolhido pra galeria".

          `lerAparencia(galeria.aparencia)` sem passar pelo rascunho nem pelo
          `?ap=`: os dois são do DONO, e o dono nunca vê esta tela (ele entra na
          própria galeria sem senha, na condição logo acima). Ler o rascunho
          aqui seria mostrar ao casal um desenho que o fotógrafo ainda não
          publicou.
        */
        aparencia={lerAparencia(galeria.aparencia)}
      />
    );
  }

  const todasAsMedias = await listarMediasPublicas(galeria.id);

  /*
   * A APARÊNCIA QUE AINDA NÃO FOI PUBLICADA.
   *
   * O editor gravava a cada clique, e o motivo era esta linha: a prévia desenha
   * a partir do BANCO, então mostrar a escolha exigia gravá-la antes. Quem
   * estava experimentando publicava, sem querer, cada passo do caminho.
   *
   * Com `?ap=`, a escolha pendente viaja na URL e é desenhada sem tocar no
   * banco — publicar volta a ser um ato. `lerAparencia` valida campo a campo,
   * então JSON torto vira o padrão em vez de quebrar a página.
   *
   * SÓ PARA O DONO, e isso não é detalhe: sem a trava, qualquer pessoa com o
   * link montaria a galeria alheia com outra aparência e mandaria o print para
   * o casal, como se fosse o trabalho do fotógrafo.
   */
  let aparencia = lerAparencia(galeria.aparencia);

  /*
   * ── A PRÉVIA EM TELA CHEIA MOSTRA O RASCUNHO (16/09/2026) ───────────────
   *
   * Felipe: "quando trocar as variações da grade, ele não está salvando
   * automaticamente. Eu clico em 'visualizar a galeria' e ele mostra o modo
   * antigo, não o último selecionado."
   *
   * O rascunho ESTAVA gravando — em `aparencia_rascunho`, como o editor
   * promete. O que faltava era esta linha: `?previa=1` lia `aparencia`, a
   * publicada, e o botão devolvia fielmente a galeria de ontem. Da caixa do
   * editor a escolha chegava pela URL (`?ap=`), então o defeito aparecia só no
   * botão que abre em tela cheia — o lugar em que ele foi conferir.
   *
   * O rascunho vale MENOS que o `?ap=`, e a ordem importa: quem está com o
   * editor aberto tem na tela uma escolha mais nova que a gravada, e é ela que
   * a prévia deve desenhar.
   */
  if (ehDono && galeria.aparencia_rascunho) {
    aparencia = lerAparencia(galeria.aparencia_rascunho);
  }
  if (ehDono && ap) {
    try {
      aparencia = lerAparencia(JSON.parse(ap));
    } catch {
      /* Parâmetro ilegível não derruba a prévia: vale o que está gravado. */
    }
  }
  /* Pastas e Stream só para contas liberadas (30/09/2026) — inclusive na
     prévia do dono: o que ele não pode entregar, ele não deve ver pronto.
     Galeria de sempre não consulta nada. Ver `config/formatos-liberados.ts`. */
  aparencia = await aparenciaPermitida(aparencia, galeria.tenant_id);

  /*
   * ── A AMOSTRA DA PRÉVIA (31/08/2026) ─────────────────────────────────────
   *
   * A prévia do editor de aparência é esta mesma página num iframe de 460 px, e
   * isso é qualidade do produto: o fotógrafo vê o que o cliente vê, sem
   * imitação para sair do lugar. O que não fazia sentido era o CUSTO — a cada
   * troca de fonte ou de grade, a galeria inteira era montada de novo: com 192
   * fotos, 576 URLs assinadas no servidor e 192 miniaturas baixadas numa caixa
   * onde cabem seis. A Carol reclamou da demora, e ela estava certa.
   *
   * `amostra` corta isso pela raiz: poucas fotos, e sem assinar o que a caixa
   * não usa. O `ehDono` na frente não é zelo excessivo — sem ele, qualquer
   * pessoa com o link poderia pedir a galeria pela metade, e o parâmetro
   * passaria a ser uma forma de ESCONDER fotos do cliente.
   *
   * `previa` e `amostra` são separados de propósito. O botão "Visualizar
   * galeria" abre `?previa=1` e promete "do jeito que o seu cliente vê"; se a
   * amostra pegasse carona no mesmo parâmetro, essa frase viraria mentira.
   * `scripts/testar-previa.mjs` existe principalmente para prender essa
   * diferença.
   */
  const amostrando = ehDono && Boolean(amostra);

  /*
   * ── A GALERIA QUE NÃO CABE NUM DOCUMENTO SÓ (11/09/2026) ─────────────────
   *
   * Ver `config/fatia-galeria.ts` para a medida. Resumo: ~3,2 KB de documento
   * por foto, e as 2108 fotos da galeria da Ana & Kaio davam 6,35 MB — o
   * suficiente para o Safari do iPhone estourar e desistir de recarregar.
   *
   * `fotos=` vem ANTES do capítulo porque é a busca por rosto entregando o
   * resultado dela: o convidado tirou uma selfie, o servidor achou 37 fotos, e
   * elas não têm por que estar todas no capítulo que por acaso está aberto.
   * Sem isto, a tela diria "você aparece em 37 fotos" e mostraria nove — a
   * fatia virando mentira em vez de economia.
   */
  const pedidas = (fotos ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, TETO_DE_ESCOLHIDAS);
  const escolhidas = new Set(pedidas);

  /*
   * ── COM CAPÍTULO, A GALERIA ABRE NO PRIMEIRO (30/09/2026) ──────────────
   *
   * Juan, sobre a galeria de uma storymaker: "assim que abre a galeria ele tá
   * aparecendo todos os capítulos. Os vídeos dela estão separados em 3
   * capítulos, mas assim que abre aparece tudo junto, deveria mostrar apenas o
   * do capítulo".
   *
   * O corte por capítulo já valia em qualquer tamanho desde 21/09 — o que
   * faltava era o PADRÃO. Sem `?cap=`, `fatiarGaleria` recebia `undefined` e
   * devolvia a galeria inteira; acima de 600 itens a barra escolhia o primeiro
   * capítulo por conta, e abaixo não. O produto mudava de natureza entre 599 e
   * 601 itens, e quem tem 8 vídeos caía no lado errado: três capítulos
   * empilhados viram uma tira alta, e o capítulo deixa de significar alguma
   * coisa.
   *
   * Decisão do Felipe em 30/09: o mesmo comportamento em qualquer tamanho.
   *
   * ── AS TRÊS RESSALVAS ─────────────────────────────────────────────────
   *
   * 1. Só quando há capítulo COM FOTO. Abrir num capítulo vazio entregaria uma
   *    galeria que parece não ter nada — pior do que o que se está consertando.
   * 2. Nunca sobre uma BUSCA (`?fotos=`). A busca por rosto e o "ver só as
   *    favoritas" respondem sobre a galeria inteira; prendê-las ao capítulo de
   *    abertura devolveria um subconjunto silencioso, e o convidado veria 1 de
   *    3 acreditando que são todas.
   * 3. Nunca na amostra da prévia, que é outro corte e menor.
   *
   * `scripts/testar-abre-no-primeiro-capitulo.mjs` prende as três.
   */
  const secoes = await listarSecoes(galeria.id);
  const primeiroComFoto = secoes.find((s) => (s.total ?? 0) > 0)?.id ?? null;
  const capPadrao =
    !cap && !amostrando && escolhidas.size === 0 ? primeiroComFoto : null;

  /*
   * ── O `?cap=` ACEITA O APELIDO E O ID (16/09/2026) ─────────────────────
   *
   * O link de hoje leva `cap=cerimonia`; o de ontem leva o UUID da seção. Os
   * dois têm de abrir o mesmo capítulo — link de capítulo já mandado para o
   * casal não se reenvia, que é a mesma razão dos apelidos de endereço das
   * migrações 025 e 030. `secaoPeloApelido` tenta o apelido primeiro.
   *
   * Só consulta quando há `cap`: a galeria sem parâmetro é o caminho comum e
   * não paga nada por isto.
   */
  const capSecaoId = cap ? await secaoPeloApelido(galeria.id, cap) : undefined;

  /*
   * ── QUE TELA ESTA ENTREGA MOSTRA (30/09/2026) ────────────────────────────
   *
   * Galeria, pastas ou stream — o formato que o fotógrafo escolheu, corrigido
   * pelo que a galeria de fato tem. A regra inteira mora em
   * `lib/formato-da-entrega.ts`.
   *
   * Decide ANTES de assinar as miniaturas: as pastas e o stream não desenham a
   * grade, e assinar 600 fotos para não mostrar nenhuma seria pagar a conta da
   * galeria sem entregar a galeria.
   */
  const conteudo: ConteudoParaFormato = {
    grupos: new Set(todasAsMedias.map((m) => m.secao_id ?? "")).size,
    videos: todasAsMedias.filter((m) => m.tipo === "video").length,
  };
  const pedidoDaTela = {
    capituloAberto: Boolean(capSecaoId),
    recorte: pedidas.length > 0,
    verGaleria: ver === "galeria",
  };
  /*
   * O recado do cliente (migração 058) — lido da linha que já veio, sem consulta
   * nova. Desligado é o estado de toda galeria já entregue.
   *
   * `null` quando desligado, e não o objeto com `ativo: false`: ele é prop de
   * componente de cliente, e prop de cliente viaja serializada no HTML público.
   * Com o objeto inteiro, as perguntas do fotógrafo ("o preço ficou dentro do que
   * você esperava?") ficavam legíveis no código-fonte da página de quem tem o
   * link — mesmo com o recurso desligado, e mesmo depois de ele desligar.
   */
  const configRecado = configDoRecado(galeria);
  const recado = configRecado.ativo ? configRecado : null;

  const tela = telaDaEntrega(aparencia.formato, conteudo, pedidoDaTela);
  const volta = voltaDaGaleria(aparencia.formato, conteudo, pedidoDaTela);
  /* O que fica da consulta nos links que esta página monta: o que é do dono
     (prévia, amostra, aparência pendente) e mais nada — ver `enderecoNaGaleria`. */
  const consultaDoDono = new URLSearchParams(
    Object.entries({ previa, amostra, ap }).filter((par): par is [string, string] => Boolean(par[1])),
  ).toString();

  const fatia = escolhidas.size
    ? {
        itens: todasAsMedias.filter((m) => escolhidas.has(m.id)),
        total: todasAsMedias.length,
        fatiada: true,
        restantes: 0,
      }
    : /*
       * SEMPRE A PRIMEIRA PARTE (16/09/2026).
       *
       * Havia `?parte=N`, e era a paginação que o Felipe pediu para tirar:
       * "remover paginação dentro do mesmo capítulo, tem apenas que rolar até o
       * final". O documento continua nascendo com uma tela de fotos — o corte
       * de 11/09 existe porque 2108 fotos davam 6,35 MB e o Safari estourava —
       * e o resto chega rolando, por `api/g/[id]/mais`.
       *
       * Link antigo com `?parte=3` na mão de alguém não quebra: ele abre no
       * começo do capítulo e a rolagem leva ao mesmo lugar. Continuar honrando o
       * parâmetro é que seria o problema — o cliente conta quantas fotos já tem
       * para pedir as próximas, e ele nasceria contando errado.
       */
      fatiarGaleria(todasAsMedias, capSecaoId ?? capPadrao, FOTOS_POR_TELA);

  const medias = amostrando ? todasAsMedias.slice(0, AMOSTRA_PREVIA) : fatia.itens;

  /* A amostra da prévia já é um corte próprio, e menor: ali a fatia não tem o
     que fazer, e dizer que a galeria está fatiada mudaria o menu do editor. */
  const fatiada = !amostrando && fatia.fatiada;

  /*
   * ── UM CAPÍTULO SÓ, EM QUALQUER TAMANHO (21/09/2026) ────────────────────
   *
   * `fatiada` responde "a galeria passou do teto e o resto chega rolando".
   * Esta responde outra coisa: "a tela está mostrando UM capítulo, e não a
   * galeria". Eram a mesma variável até hoje, e é por isso que o produto mudava
   * de comportamento entre 599 e 601 fotos — abaixo do teto a pastilha era uma
   * âncora, e o visitante entrava no capítulo seguinte sem escolher.
   *
   * Onde o menu precisa falar da GALERIA (quantas fotos cada capítulo tem, quais
   * capítulos existem), as duas valem: nos dois casos `medias` é um pedaço.
   */
  /*
   * ── O ENDEREÇO QUE O CASAL COPIA ────────────────────────────────────────
   *
   * `/g/<estudio>/<galeria>` é a forma INTERNA. Num estúdio com domínio próprio
   * ou subdomínio o visitante vê só `/<galeria>`, e o proxy recusa servir `/g/`
   * naquele host — montar link a partir dela quebraria justamente quem paga
   * pelo endereço. Por isso quem sabe é o proxy, e ele diz no cabeçalho.
   *
   * Sem cabeçalho é o domínio principal, onde a forma interna É o endereço.
   */
  const enderecoBase =
    (await headers()).get(CAMINHO_PUBLICO) ?? `/g/${estudio}/${galeriaSlug}`;

  /*
   * O capítulo PADRÃO conta aqui também (30/09/2026).
   *
   * Sem isto, `pedacoDaGaleria` ficava falso na galeria pequena que passou a
   * abrir no primeiro capítulo — e o que decide se um capítulo SEM foto
   * carregada continua na barra é justamente ele. O efeito foi imediato no
   * teste: abrindo a galeria, "Cerimônia" e "Festa" sumiam das pastilhas e a
   * pessoa ficava PRESA no primeiro capítulo, sem caminho de volta.
   *
   * É a mesma razão pela qual a galeria fatiada já mantinha as seções vazias e
   * escondidas: o menu precisa enxergar o capítulo antes de a foto dele chegar.
   */
  const soUmCapitulo = !amostrando && Boolean(capSecaoId ?? capPadrao);
  const pedacoDaGaleria = fatiada || soUmCapitulo;

  /*
   * Três tamanhos por foto, cada um no seu lugar:
   *   grade     → thumb (~50 KB) — é o que faz a galeria abrir rápido
   *   lightbox  → preview (~400 KB) — nítido em tela cheia
   *   download  → original — só quando o cliente pede de fato
   * Derivada nula (vídeo, foto antiga) cai no original, sem quebrar nada.
   *
   * ── SÓ A MINIATURA É ASSINADA AQUI (03/09/2026) ──────────────────────────
   *
   * As outras duas eram assinadas também, e iam no HTML. Medido na galeria
   * real de 111 fotos: 454 KB de página, 62 % de URL assinada, e preview +
   * original — que a primeira pintura não usa — eram 147 KB. Agora elas são
   * pedidas a `/api/g/<id>/urls` quando o lightbox abre ou quando alguém
   * clica em baixar. A régua de acesso (senha, download permitido) mudou de
   * casa junto: mora na rota. Ver o cabeçalho dela.
   *
   * O que isso resolve de segurança, de carona: a URL do original nunca mais
   * vai no HTML, nem com download liberado. Antes, "download bloqueado" era o
   * que decidia se ela ia; esconder o botão não é proteger, e agora o link
   * nem chega a nascer sem alguém pedir.
   */
  const VALIDADE = 6 * 3600;

  const itens: ItemGaleria[] = await Promise.all(
    (tela === "galeria" ? medias : []).map(async (m) => {
      /* A miniatura sai do R2 (borda perto do Brasil, grid rápido). Quando a
       * derivada não existe, o fallback É o original e segue o armazém dele —
       * ver lib/armazem.ts. */
      const thumb = await urlDaDerivada(m.chave_thumb, m.chave, armazemDe(m.armazem), VALIDADE);
      return {
        id: m.id,
        nome: m.nome_original,
        tipo: m.tipo,
        bytes: Number(m.bytes),
        largura: m.largura,
        altura: m.altura,
        url: thumb,
        /* Sem derivada, `thumb` É o original — ver `urlDaDerivada`. Em vídeo
           isso faz diferença na grade: ver `ItemGaleria.temPoster`. */
        temPoster: Boolean(m.chave_thumb),
        /* Na amostra da prévia a miniatura faz as vezes do preview: a caixa de
           460 px nunca amplia nada, e pedir à rota seria uma ida e volta para
           nada. Fora da amostra fica em aberto, e o lightbox pede quando abre. */
        urlGrande: amostrando ? thumb : undefined,
        /*
         * ── DE QUAL CAPÍTULO É ESTA FOTO (17/09/2026) ──────────────────────
         *
         * Faltava, e o buraco só aparecia na rolagem infinita — que é onde ele
         * era catastrófico.
         *
         * O servidor manda os índices de cada capítulo prontos, então aqui o
         * campo parecia dispensável. Só que, quando o primeiro pedaço acaba e
         * `carregarMais` traz o seguinte, o cliente RECALCULA os capítulos a
         * partir da lista inteira — e a conta é `it.secaoId === c.id`. As fotos
         * da rota `/mais` trazem `secaoId`; estas não traziam.
         *
         * Resultado: no instante em que a segunda parte chegava, as 600
         * primeiras fotos deixavam de pertencer a capítulo nenhum e SUMIAM da
         * tela. Juan, rolando o Making Of de um casamento entregue: "to
         * descendo as fotos do making of e buga, vai para as fotos da decoração
         * e diminui a página do making of". Medido no navegador: 601 imagens
         * viram 121, e a página cai de 192.661 px para 42.275.
         *
         * `scripts/testar-rolagem-infinita.mjs` prende os dois lados agora.
         */
        secaoId: m.secao_id,
      };
    }),
  );

  const cabecalhos = await headers();
  // O fotógrafo conferindo a própria prévia NÃO conta como entrega: o número de
  // aberturas é a prova de que o casal recebeu, e ele inflado não prova nada.
  if (!ehDono) {
    await registrarAcesso({
      galeriaId: galeria.id,
      acao: "abriu",
      ip: cabecalhos.get("x-forwarded-for") ?? cabecalhos.get("x-real-ip"),
      userAgent: cabecalhos.get("user-agent"),
    });
  }

  // Palpite pelo user-agent só para a primeira pintura já sair com o botão certo;
  // no navegador, a detecção de recurso corrige se o palpite estiver errado.
  const modoProvavel = modoPeloUserAgent(cabecalhos.get("user-agent") ?? "");
  /* O tamanho da galeria INTEIRA, dito no menu do celular antes do primeiro
     toque: 2108 fotos são gigas, e quem está no 4G precisa saber antes. */
  const bytesDaGaleria = todasAsMedias.reduce((soma, m) => soma + Number(m.bytes), 0);

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", { timeZone: FUSO,
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;


  /*
   * As favoritas DESTE visitante, lidas no servidor.
   *
   * Buscar depois de montar faria a galeria inteira aparecer sem corações e
   * enchê-los meio segundo depois — em 600 fotos isso é um pisca que faz a
   * pessoa duvidar se a escolha dela foi guardada.
   *
   * Quem nunca marcou nada não tem cookie, e isto devolve lista vazia sem tocar
   * o banco.
   */
  /*
   * ── "MINHAS" PASSOU A QUERER DIZER MINHAS (15/09/2026, migração 033) ─────
   *
   * Até aqui isto lia a lista da galeria inteira, e era o defeito que o Felipe
   * descreveu: qualquer pessoa com o link via — e desmarcava — a escolha da
   * noiva. Agora a lista é da PESSOA identificada pelo e-mail; sem
   * identificação, é vazia, e a tela oferece o campo na primeira marcação.
   */
  const pessoaId = await pessoaAtual(galeria.id);
  const eu = pessoaId ? await dadosDaPessoa(galeria.id, pessoaId) : null;
  const favoritasIniciais = await favoritasDaPessoa(galeria.id, pessoaId);
  const selecao = await estadoSelecao(galeria.id, pessoaId);

  /*
   * Agrupa as fotos em capítulos preservando os índices do array original: o
   * lightbox continua percorrendo a galeria INTEIRA de ponta a ponta, mesmo
   * quem abriu uma foto no meio da "Festa" chega no "Making Of" pela seta.
   */
  const indicePorId = new Map(medias.map((m, i) => [m.id, i]));

  const semCapitulo = medias
    .filter((m) => !m.secao_id)
    .map((m) => indicePorId.get(m.id)!)
    .filter((i) => i !== undefined);

  const capitulos: CapituloGaleria[] = [];
  /*
   * ── A FOTO SOLTA SÓ GANHA NOME QUANDO CONVIVE COM CAPÍTULO (04/09/2026) ──
   *
   * Antes o grupo das soltas entrava sempre com `nome: ""`. Numa galeria de
   * fluxo único isso é certo — não se inventa um "Diversos" para a galeria
   * inteira. Mas quando HÁ capítulos, o menu do cliente (que aparece com dois
   * ou mais) desenhava uma pastilha VAZIA no meio das outras: um botão sem
   * texto que leva a algum lugar. Era o "ou organiza isso" do sócio.
   *
   * A saída não é obrigar a escolher no envio (atrito no pior momento) nem
   * mover as fotos sozinho (mexer no trabalho dele sem pedir): é dar nome ao
   * grupo quando ele precisa de um. Quem quiser arrumar tem, no painel, o
   * botão de mover todas de uma vez.
   *
   * ── E O NOME PASSOU A SER DELE (18/09/2026, migração 037) ───────────────
   *
   * Juan: "aqui fica aparecendo 'outras fotos' (…) não tem como trocar pra
   * esse nome, tipo galeria completa ou algo assim. Não criei nenhuma pasta
   * com esse nome". Não criou mesmo — este grupo é calculado, e até aqui o
   * texto era nosso. `nomeDoGrupoSolto` devolve o que o fotógrafo escreveu no
   * painel e cai em "Outras fotos" quando ele não escreveu nada, que é como
   * todas as galerias de antes continuam.
   */
  /* Mostrando um pedaço, a pergunta "há fotos soltas?" é sobre a GALERIA, não
     sobre o pedaço: senão a pastilha "Outras fotos" apareceria e sumiria
     conforme o capítulo aberto. */
  const haSoltasNaGaleria = todasAsMedias.some((m) => !m.secao_id);
  if (semCapitulo.length > 0 || (pedacoDaGaleria && haSoltasNaGaleria)) {
    const temCapitulo = (pedacoDaGaleria ? todasAsMedias : medias).some((m) => m.secao_id);
    capitulos.push({
      id: "sem-capitulo",
      /* Já é curto e legível — este grupo nunca teve UUID, porque não é uma
         linha do banco: é um nome que esta página inventa. */
      apelido: "sem-capitulo",
      nome: temCapitulo ? nomeDoGrupoSolto(galeria.grupo_solto) : "",
      indices: semCapitulo,
      total: pedacoDaGaleria ? todasAsMedias.filter((m) => !m.secao_id).length : semCapitulo.length,
    });
  }
  for (const s of secoes) {
    const indices = medias
      .filter((m) => m.secao_id === s.id)
      .map((m) => indicePorId.get(m.id)!)
      .filter((i) => i !== undefined);

    /*
     * ── NUMA GALERIA FATIADA O MENU PRECISA DOS CAPÍTULOS VAZIOS ───────────
     *
     * Sem fatia, capítulo sem foto é capítulo que não existe, e desenhá-lo
     * seria uma seção em branco — a regra de sempre, e ela continua valendo
     * abaixo do teto.
     *
     * Acima do teto ela se inverte: os capítulos que NÃO vieram nesta fatia
     * são exatamente os que o convidado precisa poder escolher. Um menu que
     * só mostra o capítulo já aberto é um menu com um item.
     *
     * `indices` vazio é o sinal para o cliente não desenhar a seção e ainda
     * assim oferecer a pastilha. Ver `menus-da-galeria.tsx`.
     */
    /* `total` é o tamanho do capítulo na GALERIA, não nesta fatia: é ele que
       o menu de baixar mostra, e mostrar `indices.length` fazia o capítulo que
       não veio aparecer como "(0)". */
    const total = todasAsMedias.filter((m) => m.secao_id === s.id).length;
    if (indices.length > 0 || (pedacoDaGaleria && total > 0)) {
      capitulos.push({ id: s.id, apelido: s.slug, nome: s.nome, indices, total });
    }
  }

  /*
   * A CAPA, em três degraus (migração 029):
   *
   *   1. o arquivo ENVIADO só para ser capa — uma arte, um convite, um cartão
   *      com o nome do casal. Vence os outros porque é a decisão mais
   *      explícita: ninguém sobe uma capa por acidente;
   *   2. a foto da galeria que o fotógrafo marcou como capa;
   *   3. a primeira foto, quando ele não escolheu nada.
   *
   * A enviada não é uma `media`: não entra na grade, não conta como entrega e
   * não vai no "baixar tudo". Ver `lib/capa-galeria.ts`.
   *
   * A BUSCA É NA LISTA INTEIRA, e não em `medias` (10/09/2026). Na prévia da
   * aba Design `medias` são só as 12 primeiras, e a capa da galeria do Juan é a
   * foto 300 de 1400: procurá-la ali dentro não achava nada, caía no degrau 3 e
   * desenhava a primeira foto. A prévia mostrava a foto errada exatamente na
   * tela em que ele acabara de escolher a certa — e a galeria publicada, com a
   * lista inteira, mostrava a certa. Assinar essa URL não desfaz a economia da
   * amostra: é UMA foto, que a capa ia assinar de qualquer jeito.
   */
  const capa = escolherCapa(todasAsMedias, galeria.capa_media_id, medias);
  const urlCapa = galeria.capa_chave
    ? await urlDeLeitura(galeria.capa_chave, VALIDADE)
    : capa
      ? await urlDaCapa(capa, VALIDADE)
      : null;

  /*
   * A fonte só é assinada quando VAI SER USADA.
   *
   * Assinar sempre custaria uma chamada por página em toda galeria de todo
   * estúdio que já enviou um arquivo — inclusive nas que escolheram Bodoni. A
   * condição é a mesma que decide se o `@font-face` entra no HTML.
   *
   * São DOIS pedidos possíveis desde 05/09/2026, e basta um: o título (eixo
   * `tipografia`) ou o corpo (eixo `fonteTexto`). Ler só o primeiro deixaria a
   * galeria de título em Bodoni e corpo na fonte da marca pedindo uma família
   * que o navegador nunca recebeu.
   */
  const querFontePropria =
    aparencia.tipografia === "propria" || aparencia.fonteTexto === "propria";
  const fonteDoEstudio =
    querFontePropria && galeria.estudio_fonte
      ? await urlDeLeitura(galeria.estudio_fonte, VALIDADE)
      : null;

  // A logo é guardada como CHAVE, não como URL: este bucket não tem endereço
  // público, então todo link é assinado na hora de desenhar a página.
  const urlLogo = galeria.estudio_logo
    ? await urlDeLeitura(galeria.estudio_logo, VALIDADE)
    : null;

  /*
   * A BUSCA POR ROSTO só existe quando o fotógrafo a ligou — e nunca na
   * amostra da prévia, que mostra doze fotos de um total maior: "você aparece
   * em 2 fotos" sobre uma amostra seria mentira.
   *
   * O contato é o do estúdio, como ele preencheu no site. A tela de
   * consentimento diz ao convidado com quem falar sobre as fotos dele, e a
   * resposta certa é o fotógrafo, não nós.
   */
  const site = lerSite(galeria.estudio_site);
  const contatoEstudio = site.whatsapp
    ? `WhatsApp ${site.whatsapp.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3")}`
    : site.email || (site.instagram ? `@${site.instagram}` : null);
  const buscaPorRosto =
    galeria.rostos_ativos && !amostrando
      ? { nomeEstudio: galeria.estudio_nome, contato: contatoEstudio }
      : null;

  /*
   * ── AS PASTAS E O STREAM (30/09/2026) ─────────────────────────────────────
   *
   * Os dois leem a GALERIA INTEIRA (`todasAsMedias`), e não a fatia: a pasta
   * conta as fotos que tem, e o stream lista os vídeos de todos os capítulos.
   * O que se assina é pouco e é só imagem — até três por pasta, um pôster por
   * vídeo —, nunca o original: o filme é pedido à rota `urls` quando o play é
   * apertado, pela mesma régua de acesso do visualizador.
   */
  type MediaPublica = (typeof todasAsMedias)[number];
  /* A imagem de uma mídia, ou null. Vídeo só tem imagem quando tem pôster —
     sem ele a "imagem" seria o próprio filme (ver `ItemGaleria.temPoster`). */
  const imagemDa = (m: MediaPublica, grande: boolean): Promise<string> | null => {
    if (m.tipo === "video") {
      return m.chave_thumb ? urlDeLeitura(m.chave_thumb, VALIDADE) : null;
    }
    return urlDaDerivada(grande ? m.chave_preview : m.chave_thumb, m.chave, armazemDe(m.armazem), VALIDADE);
  };
  const temImagem = (m: MediaPublica) => m.tipo === "foto" || Boolean(m.chave_thumb);

  /* Os grupos na ordem da galeria — as soltas primeiro, depois os capítulos
     na ordem do painel —, a mesma de `capitulos` e do menu. */
  const grupos: {
    id: string;
    apelido: string;
    nome: string;
    capaId: string | null;
    /** Capa enviada como arquivo (migração 057) — vence a foto escolhida. */
    capaChave: string | null;
    medias: MediaPublica[];
  }[] = [];
  if (tela !== "galeria") {
    const soltas = todasAsMedias.filter((m) => !m.secao_id);
    if (soltas.length) {
      grupos.push({
        id: "sem-capitulo",
        apelido: "sem-capitulo",
        nome: nomeDoGrupoSolto(galeria.grupo_solto),
        capaId: null,
        /* As soltas não são um capítulo: não há linha em `secoes` onde
           guardar uma capa própria delas. A primeira foto segue valendo. */
        capaChave: null,
        medias: soltas,
      });
    }
    for (const sec of secoes) {
      const doGrupo = todasAsMedias.filter((m) => m.secao_id === sec.id);
      if (doGrupo.length) {
        grupos.push({
          id: sec.id,
          apelido: sec.slug,
          nome: sec.nome,
          capaId: sec.capa_media_id ?? null,
          capaChave: sec.capa_chave ?? null,
          medias: doGrupo,
        });
      }
    }
  }

  const pastas: PastaDaEntrega[] =
    tela === "pastas"
      ? await Promise.all(
          grupos.map(async (g) => {
            /* A capa escolhida, se ainda está NESTE capítulo e tem imagem; senão
               a primeira foto; senão o primeiro vídeo com pôster. Ver a
               migração 052 para por que a conferência é na leitura também. */
            const escolhida = g.capaId ? g.medias.find((m) => m.id === g.capaId && temImagem(m)) : undefined;
            const capaDaPasta =
              escolhida ?? g.medias.find((m) => m.tipo === "foto") ?? g.medias.find(temImagem);
            /* Três atrás da capa: a Pilha usa duas, o Índice e o Mosaico usam as
               três. Miniatura, não visualizador — são imagens pequenas. */
            const atras = g.medias.filter((m) => m !== capaDaPasta && temImagem(m)).slice(0, 3);
            /* Arquivo enviado vence a foto escolhida (migração 057): é uma
               imagem que NÃO está na entrega, então não sai de `g.medias` —
               só a frente troca, e as três de trás continuam sendo fotos do
               capítulo. */
            const imagens = await Promise.all([
              ...(g.capaChave
                ? [urlDeLeitura(g.capaChave, VALIDADE)]
                : capaDaPasta
                  ? [imagemDa(capaDaPasta, true)]
                  : []),
              ...atras.map((m) => imagemDa(m, false)),
            ]);
            const fotosDaPasta = g.medias.filter((m) => m.tipo === "foto").length;
            return {
              id: g.id,
              nome: g.nome,
              /* `#conteudo` pula a capa: quem escolheu a pasta quer as fotos
                 dela, e não a capa da galeria de novo. */
              href: `${enderecoNaGaleria(enderecoBase, consultaDoDono, { cap: g.apelido })}#conteudo`,
              fotos: fotosDaPasta,
              videos: g.medias.length - fotosDaPasta,
              imagens: imagens.filter((u): u is string => Boolean(u)),
            };
          }),
        )
      : [];

  /* O "Ver as fotos" do stream e o "Voltar aos vídeos" da galeria que ele
     abre. `ver` fica na consulta — e `enderecoNaGaleria` a preserva ao andar
     entre capítulos, então a pessoa continua nas fotos. */
  const comConsulta = (extra: Record<string, string>) => {
    const q = new URLSearchParams(consultaDoDono);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    const texto = q.toString();
    return `${enderecoBase.replace(/\/+$/, "")}${texto ? `?${texto}` : ""}`;
  };

  let fileiras: FileiraDoStream[] = [];
  let amostraDeFotos: string[] = [];
  let fundoDoStream: string | null = null;
  const fotosNaGaleria = todasAsMedias.filter((m) => m.tipo === "foto").length;
  if (tela === "stream") {
    let numero = 0;
    const comVideo = grupos.filter((g) => g.medias.some((m) => m.tipo === "video"));
    fileiras = await Promise.all(
      comVideo.map(async (g) => ({
        id: g.id,
        /* A fileira dos vídeos soltos leva o nome que o fotógrafo escreveu
           no Design (Juan, 30/09/2026: "poder mudar o título 'Episódios'").
           Sem nome escrito e com uma fileira só, o nome do grupo das soltas
           ("Outras fotos") não diz nada sobre vídeos: vira "Episódios".
           Capítulo continua com o nome do capítulo. */
        nome:
          g.id !== "sem-capitulo"
            ? g.nome
            : aparencia.nomeDosVideos || (comVideo.length === 1 ? "Episódios" : g.nome),
        frase: g.id === "sem-capitulo" && aparencia.fraseDosVideos ? aparencia.fraseDosVideos : undefined,
        episodios: await Promise.all(
          g.medias
            .filter((m) => m.tipo === "video")
            .map(async (m) => ({
              id: m.id,
              numero: ++numero,
              titulo: m.titulo ?? tituloDoEpisodio(m.nome_original),
              nomeDoArquivo: m.nome_original,
              duracao: m.duracao_seg,
              poster: m.chave_thumb ? await urlDeLeitura(m.chave_thumb, VALIDADE) : null,
              bytes: Number(m.bytes),
            })),
        ),
      })),
    );
    /* Uma amostra de fotos para a fileira delas — doze, a mesma medida da
       prévia: o bastante para mostrar que existem, e o resto está a um clique. */
    amostraDeFotos = (
      await Promise.all(
        todasAsMedias
          .filter((m) => m.tipo === "foto")
          .slice(0, 12)
          .map((m) => imagemDa(m, false)),
      )
    ).filter((u): u is string => Boolean(u));
    /* O fundo da tela de cinema: a capa da galeria quando há, senão o pôster
       do primeiro episódio. O pôster tem 640 px — num monitor grande fica
       macio, e por isso a capa vem antes. */
    fundoDoStream = urlCapa ?? fileiras[0]?.episodios.find((e) => e.poster)?.poster ?? null;
  }

  /* A entrega em stream, desenhada com a capa da própria sala ou embaixo da
     capa do grupo Capa — ver `CapaDoStream`. */
  const streamDaEntrega =
    tela === "stream" ? (
      <GaleriaStream
        galeriaId={galeria.id}
        aparencia={aparencia}
        titulo={galeria.titulo}
        subtitulo={galeria.subtitulo}
        dataFormatada={dataEvento}
        estudio={galeria.estudio_nome}
        logoUrl={urlLogo}
        logoLargura={galeria.estudio_logo_largura}
        logoAltura={galeria.estudio_logo_altura}
        fundo={fundoDoStream}
        focoX={galeria.capa_foco_x}
        focoY={galeria.capa_foco_y}
        fileiras={fileiras}
        fotos={{
          total: fotosNaGaleria,
          amostra: amostraDeFotos,
          href: `${comConsulta({ ver: "galeria" })}#conteudo`,
        }}
        permiteDownload={galeria.permite_download}
        identificado={Boolean(eu)}
      />
    ) : null;

  return (
    /*
     * O tema vive em variáveis CSS neste elemento. Assim a galeria pode ser
     * clara enquanto o painel segue escuro, sem um tema brigar com o outro —
     * e trocar de tema é trocar cinco valores, não reescrever componentes.
     */
    <main
      className="min-h-dvh"
      style={{
        /* O tema, e a sala escura quando a entrega é o stream em Cinema —
           ver `variaveisDaEntrega`. */
        ...variaveisDaEntrega(aparencia, tela),
        ...variaveisDeForma(aparencia),
        background: "var(--g-fundo)",
        color: "var(--g-texto)",
        /*
          A FONTE DO CORPO fica aqui, e não numa classe, porque é herança: tudo
          o que a galeria desenha mora dentro deste <main> e não há portal
          nenhum saindo dele (o visualizador de foto inclusive). Uma linha, e o
          título continua decidindo a dele por `FONTES_TITULO`.

          `propria` sem arquivo enviado não é caso a tratar: a família do
          estúdio simplesmente não existe, e a lista de reserva de
          `FONTES_TEXTO` responde.
        */
        fontFamily: FONTES_TEXTO[aparencia.fonteTexto],
      }}
    >
      {/*
        A FONTE DO ESTÚDIO, quando existe e quando foi escolhida.

        O arquivo mora no bucket do fotógrafo e o link é assinado como qualquer
        outro — por isso o `@font-face` é escrito aqui, na página, e não numa
        folha de estilo: o endereço muda a cada visita.

        `font-display: swap` de propósito: o título aparece na hora, com a
        serifada de reserva, e troca quando a fonte chega. O contrário (`block`)
        deixaria o nome do casal invisível por até três segundos no 4G do
        salão de festas.

        Só entra quando os DOIS lados existem — a galeria pediu `propria` e o
        estúdio tem arquivo. Quem removeu a fonte depois de escolhê-la cai na
        serifada de reserva sem que nada quebre.
      */}
      {fonteDoEstudio && (
        <style>{`@font-face{font-family:"${FAMILIA_PROPRIA}";src:url("${fonteDoEstudio}");font-display:swap}`}</style>
      )}
      {tela === "stream" && aparencia.capaStream === "sala" ? (
        /*
          A SALA TRAZ A PRÓPRIA CAPA: a tela de cinema É a capa — foto de
          fundo, logo, título na letra da galeria e o botão de assistir. Duas
          capas seguidas empurrariam os episódios para a segunda tela.
        */
        streamDaEntrega
      ) : (
        <>
          {/* A marca em destaque é a do fotógrafo. A nossa assina discreta no rodapé. */}
          <GaleriaCapa
            aparencia={aparencia}
            dados={{
              titulo: galeria.titulo,
              subtitulo: galeria.subtitulo,
              dataFormatada: dataEvento,
              estudio: galeria.estudio_nome,
              logoUrl: urlLogo,
              logoLargura: galeria.estudio_logo_largura,
              logoAltura: galeria.estudio_logo_altura,
              /* No stream sem capa escolhida, o pôster do primeiro vídeo —
                 a mesma régua do fundo da sala (`fundoDoStream`). */
              urlImagem: tela === "stream" ? fundoDoStream : urlCapa,
              /*
               * ESCOLHIDA, e não herdada.
               *
               * A capa jornal só mostra foto quando o fotógrafo apontou uma — o
               * arquivo enviado ou a foto marcada. A terceira via desta página (a
               * primeira foto da galeria, quando ninguém escolheu nada) NÃO conta:
               * se contasse, toda galeria que hoje usa o preset Revista ganharia
               * uma foto de capa da noite para o dia, incluindo as já entregues.
               */
              capaEscolhida: Boolean(galeria.capa_chave || galeria.capa_media_id),
              focoX: galeria.capa_foco_x,
              focoY: galeria.capa_foco_y,
              chamada: tela === "stream" ? "Ver os vídeos" : undefined,
            }}
          />
          {/*
            O STREAM COM A CAPA DO GRUPO CAPA (Juan, 30/09/2026: "corrigir os
            formatos de CAPA quando o formato de entrega foi o STREAM"). A sala
            começa embaixo, sem a capa dela. `id="fotos"` é o alvo do "Ver os
            vídeos" das capas que têm chamada; a camada com fundo cobre a capa
            fixa. `relative` SEM `z-index`: vir depois da capa no documento já
            a põe por cima, e um `z-10` aqui criaria um contexto de
            empilhamento que prenderia o player (`fixed`, z-60) embaixo do
            rodapé.
          */}
          {tela === "stream" && (
            <div id="fotos" className="relative scroll-mt-4" style={{ background: "var(--g-fundo)" }}>
              {streamDaEntrega}
            </div>
          )}
        </>
      )}

      {/*
        A GALERIA PASSA POR CIMA DA CAPA — quando a capa é fixa.

        Felipe, 16/09/2026: "permitir fixar o título da capa na galeria". A capa
        vira `sticky` (ver `CapaFixa`), e é ESTA camada que a cobre: sem
        `z-10` a ordem de quem tapa quem passaria a depender da ordem do
        documento, e sem fundo próprio a capa apareceria por trás das fotos.

        Com a capa rolando — o padrão — as duas classes não mudam nada: `z-10`
        sem ninguém disputando é só um número, e o fundo é o mesmo da página.

        ── DE BORDA A BORDA (28/09/2026) ──────────────────────────────────

        O fundo estava na mesma caixa que limita as fotos a 1500 px. Numa tela
        mais larga — o MacBook de 16" tem 1728 — sobravam 114 px de cada lado
        sem fundo, e a capa grudada aparecia por ali: na dividida, uma faixa
        da foto da noiva ao lado da grade. Felipe: "achei um pouco estranho a
        foto continuar só um pedaço ali". A camada que cobre agora ocupa a
        largura toda; quem limita as fotos é a caixa de dentro. O rodapé e o
        respiro do fim (o `pb-20`, que era do <main>) entram nela também —
        fora dela, eram mais dois lugares por onde a capa aparecia.
      */}
      <div className="relative z-10 pb-20" style={{ background: "var(--g-fundo)" }}>
      <div className="mx-auto max-w-[1500px] px-4 sm:px-6">
        {/*
          O CAMINHO DE VOLTA, quando esta galeria é um pedaço de outro formato:
          dentro de uma pasta, ou nas fotos de uma entrega em stream. O
          `id="conteudo"` é o alvo do link que abriu esta tela — ele pula a capa.
        */}
        {(volta || tela !== "galeria") && <AncoraDeChegada />}
        {volta === "pastas" && (
          <div id="conteudo" className="scroll-mt-4">
            <VoltarAsPastas
              href={`${comConsulta({})}#pastas`}
              nome={capitulos.find((c) => c.id === capSecaoId)?.nome ?? null}
              aparencia={aparencia}
            />
          </div>
        )}
        {volta === "stream" && (
          <div id="conteudo" className="scroll-mt-4 pt-8">
            <Link
              href={comConsulta({})}
              className="inline-block rounded-[var(--g-pilula,9999px)] px-4 py-2 text-sm transition hover:opacity-75"
              style={{ border: "1px solid var(--g-linha)", color: "var(--g-suave)" }}
            >
              ← Voltar aos vídeos
            </Link>
          </div>
        )}
        {tela === "stream" ? null : tela === "pastas" ? (
          <div id="pastas" className="scroll-mt-4">
            <GaleriaPastas
              pastas={pastas}
              aparencia={aparencia}
              permiteDownload={galeria.permite_download}
            />
          </div>
        ) : itens.length === 0 && ehDono ? (
          /*
           * A prévia com a galeria vazia mostrava só "as fotos estão sendo
           * preparadas" — bem no momento em que o fotógrafo está escolhendo capa,
           * tipografia, grade e densidade. Ele decidia a aparência olhando para
           * uma frase cinza, e só via o resultado depois de subir o casamento.
           *
           * Agora entram fotos de mentira, com proporções variadas de propósito:
           * é o que faz a grade "colunas" e a "editorial" mostrarem o que
           * realmente fazem. Só na prévia do DONO — o cliente nunca vê isto.
           */
          <>
            <p
              className="pt-8 text-center text-xs"
              style={{ color: "var(--g-tenue)" }}
            >
              Fotos de exemplo, só para você ver o resultado — o cliente não vê esta tela.
            </p>
            <GaleriaCliente
              favoritasIniciais={[]}
              selecaoInicial={{ limite: null, aberta: false, motivo: null, combinada: false }}
              itens={fotosDeDemonstracao(aparencia.tema)}
              permiteDownload={false}
              galeriaId={galeria.id}
              aparencia={aparencia}
              /* Sem recado nesta tela: são fotos de exemplo, e um convite aqui
                 gravaria um recado de verdade na galeria do próprio fotógrafo. */
              capitulos={[]}
              modoProvavel={modoProvavel}
            enderecoBase={enderecoBase}
            />
          </>
        ) : itens.length === 0 ? (
          <p className="py-20 text-center text-sm" style={{ color: "var(--g-suave)" }}>
            As fotos ainda estão sendo preparadas. Volte em breve.
          </p>
        ) : (
          <GaleriaCliente
            favoritasIniciais={favoritasIniciais}
            eu={eu ? { email: eu.email, nome: eu.nome } : null}
            selecaoInicial={{
              limite: selecao.limite,
              aberta: selecao.aberta,
              motivo: selecao.motivo,
              combinada: selecao.combinada,
            }}
            itens={itens}
            permiteDownload={galeria.permite_download}
            galeriaId={galeria.id}
            aparencia={aparencia}
            recado={recado}
            capitulos={capitulos}
            modoProvavel={modoProvavel}
            enderecoBase={enderecoBase}
            buscaPorRosto={buscaPorRosto}
            bytesDaGaleria={bytesDaGaleria}
            totalNaGaleria={todasAsMedias.length}
            recorte={escolhidas.size > 0 && !amostrando}
            /* O capítulo aberto vale em qualquer galeria, fatiada ou não —
               ver `capituloAberto` em galeria-cliente. */
            capituloAberto={capSecaoId ?? null}
            fatia={
              fatiada
                ? {
                    total: fatia.total,
                    /* O ID resolvido, e não o texto da URL: quem compara com
                       ele é `capitulos[].id`, e um link com apelido nunca
                       casaria. */
                    capituloAtivo: capSecaoId ?? null,
                  }
                : null
            }
          />
        )}
      </div>

      <footer className="mt-20 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-[var(--g-pilula,9999px)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ border: "1px solid var(--g-linha)", color: "var(--g-tenue)" }}
        >
          <span
            className="grid h-4 w-4 place-items-center rounded-[3px] text-[8px] font-bold"
            style={{ border: "1px solid var(--g-linha)", color: "var(--g-destaque)" }}
          >
            {marca.simbolo}
          </span>
          entregue com {marca.nome}
        </span>
      </footer>
      </div>
    </main>
  );
}
