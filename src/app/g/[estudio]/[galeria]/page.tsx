import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { marca } from "@/config/marca";
import { urlDeLeitura } from "@/lib/r2";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { fotosDeDemonstracao } from "@/config/fotos-demonstracao";
import { estadoSelecao, minhasFavoritas } from "@/lib/favoritas";
import { galeriasNoAr } from "@/lib/assinatura";
import { resolverEstudio } from "@/lib/endereco";
import {
  buscarGaleriaPublica,
  listarMediasPublicas,
  temAcessoLiberado,
  registrarAcesso,
} from "@/lib/galerias-publicas";
import { listarSecoes } from "@/lib/secoes";
import { sessaoAtual } from "@/lib/auth";
import {
  GaleriaCliente,
  type ItemGaleria,
  type CapituloGaleria,
} from "@/components/galeria-cliente";
import { GaleriaCapa } from "@/components/galeria-capa";
import { lerAparencia, TEMAS, AMOSTRA_PREVIA } from "@/config/aparencia";
import { FAMILIA_PROPRIA } from "@/lib/fonte-estudio";
import { lerSite } from "@/lib/site-estudio";
import { PortaoDeSenha } from "./portao";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ estudio: string; galeria: string }>;
  searchParams: Promise<{ previa?: string; amostra?: string; ap?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { estudio, galeria } = await params;
  const g = await buscarGaleriaPublica(estudio, galeria);
  if (!g) return { title: "Galeria" };
  return {
    title: `${g.titulo} · ${g.estudio_nome}`,
    // Galeria é pessoal: nunca deve aparecer em busca, mesmo com o link vazado.
    robots: { index: false, follow: false },
  };
}

export default async function GaleriaPublicaPage({ params, searchParams }: Props) {
  const { estudio, galeria: galeriaSlug } = await params;
  const { previa, amostra, ap } = await searchParams;

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
   */
  const rascunho = await buscarGaleriaPublica(estudio, galeriaSlug, true);
  const sessao = previa && rascunho ? await sessaoAtual() : null;
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
  if (!ehDono && !galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate })) {
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
      />
    );
  }

  const todasAsMedias = await listarMediasPublicas(galeria.id);

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
  const medias = amostrando ? todasAsMedias.slice(0, AMOSTRA_PREVIA) : todasAsMedias;

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
    medias.map(async (m) => {
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
        /* Na amostra da prévia a miniatura faz as vezes do preview: a caixa de
           460 px nunca amplia nada, e pedir à rota seria uma ida e volta para
           nada. Fora da amostra fica em aberto, e o lightbox pede quando abre. */
        urlGrande: amostrando ? thumb : undefined,
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
  const celularProvavel = /android|iphone|ipad|ipod/i.test(cabecalhos.get("user-agent") ?? "");

  const dataEvento = galeria.data_evento
    ? new Date(galeria.data_evento).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

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
  if (ehDono && ap) {
    try {
      aparencia = lerAparencia(JSON.parse(ap));
    } catch {
      /* Parâmetro ilegível não derruba a prévia: vale o que está gravado. */
    }
  }

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
  const favoritasIniciais = await minhasFavoritas(galeria.id);
  const selecao = await estadoSelecao(galeria.id);

  /*
   * Agrupa as fotos em capítulos preservando os índices do array original: o
   * lightbox continua percorrendo a galeria INTEIRA de ponta a ponta, mesmo
   * quem abriu uma foto no meio da "Festa" chega no "Making Of" pela seta.
   */
  const secoes = await listarSecoes(galeria.id);
  const indicePorId = new Map(medias.map((m, i) => [m.id, i]));

  const semCapitulo = medias
    .filter((m) => !m.secao_id)
    .map((m) => indicePorId.get(m.id)!)
    .filter((i) => i !== undefined);

  const capitulos: CapituloGaleria[] = [];
  // Fotos soltas abrem a galeria, sem título — não inventamos um "Diversos".
  if (semCapitulo.length > 0) {
    capitulos.push({ id: "sem-capitulo", nome: "", indices: semCapitulo });
  }
  for (const s of secoes) {
    const indices = medias
      .filter((m) => m.secao_id === s.id)
      .map((m) => indicePorId.get(m.id)!)
      .filter((i) => i !== undefined);
    // Capítulo vazio não vira seção em branco na página do cliente.
    if (indices.length > 0) capitulos.push({ id: s.id, nome: s.nome, indices });
  }

  // Capa escolhida pelo fotógrafo; sem escolha, a primeira foto da galeria.
  const capa =
    medias.find((m) => m.id === galeria.capa_media_id && m.tipo === "foto") ??
    medias.find((m) => m.tipo === "foto");
  const urlCapa = capa
    ? await urlDaDerivada(capa.chave_preview, capa.chave, armazemDe(capa.armazem), VALIDADE)
    : null;

  /*
   * A fonte só é assinada quando VAI SER USADA.
   *
   * Assinar sempre custaria uma chamada por página em toda galeria de todo
   * estúdio que já enviou um arquivo — inclusive nas que escolheram Bodoni. A
   * condição é a mesma que decide se o `@font-face` entra no HTML.
   */
  const fonteDoEstudio =
    aparencia.tipografia === "propria" && galeria.estudio_fonte
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

  return (
    /*
     * O tema vive em variáveis CSS neste elemento. Assim a galeria pode ser
     * clara enquanto o painel segue escuro, sem um tema brigar com o outro —
     * e trocar de tema é trocar cinco valores, não reescrever componentes.
     */
    <main
      className="min-h-dvh pb-20"
      style={{ ...TEMAS[aparencia.tema], background: "var(--g-fundo)", color: "var(--g-texto)" }}
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
      {/* A marca em destaque é a do fotógrafo. A nossa assina discreta no rodapé. */}
      <GaleriaCapa
        aparencia={aparencia}
        dados={{
          titulo: galeria.titulo,
          subtitulo: galeria.subtitulo,
          dataFormatada: dataEvento,
          estudio: galeria.estudio_nome,
          logoUrl: urlLogo,
          urlImagem: urlCapa,
        }}
      />

      <div className="mx-auto max-w-[1500px] px-4 sm:px-6">
        {itens.length === 0 && ehDono ? (
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
              selecaoInicial={{ limite: null, aberta: false, motivo: null }}
              itens={fotosDeDemonstracao(aparencia.tema)}
              permiteDownload={false}
              galeriaId={galeria.id}
              aparencia={aparencia}
              capitulos={[]}
              celularProvavel={celularProvavel}
            />
          </>
        ) : itens.length === 0 ? (
          <p className="py-20 text-center text-sm" style={{ color: "var(--g-suave)" }}>
            As fotos ainda estão sendo preparadas. Volte em breve.
          </p>
        ) : (
          <GaleriaCliente
            favoritasIniciais={favoritasIniciais}
            selecaoInicial={{
              limite: selecao.limite,
              aberta: selecao.aberta,
              motivo: selecao.motivo,
            }}
            itens={itens}
            permiteDownload={galeria.permite_download}
            galeriaId={galeria.id}
            aparencia={aparencia}
            capitulos={capitulos}
            celularProvavel={celularProvavel}
            buscaPorRosto={buscaPorRosto}
          />
        )}
      </div>

      <footer className="mt-20 text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
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
    </main>
  );
}
