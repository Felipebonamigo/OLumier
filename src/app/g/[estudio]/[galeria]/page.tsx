import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { marca } from "@/config/marca";
import { urlDeLeitura } from "@/lib/r2";
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
import { lerAparencia, TEMAS } from "@/config/aparencia";
import { PortaoDeSenha } from "./portao";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ estudio: string; galeria: string }>;
  searchParams: Promise<{ previa?: string }>;
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
  const { previa } = await searchParams;

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
  if (!galeria) notFound();

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

  const medias = await listarMediasPublicas(galeria.id);

  /*
   * Três tamanhos por foto, cada um no seu lugar:
   *   grade     → thumb (~50 KB) — é o que faz a galeria abrir rápido
   *   lightbox  → preview (~400 KB) — nítido em tela cheia
   *   download  → original — só quando o cliente pede de fato
   * Derivada nula (vídeo, foto antiga) cai no original, sem quebrar nada.
   */
  const VALIDADE = 6 * 3600;

  /*
   * A URL do ORIGINAL só é gerada quando o download é permitido.
   *
   * Antes ela era gerada sempre e o componente apenas escondia os botões — mas o
   * link ia no HTML da página do mesmo jeito, válido por 6 horas. Quem abrisse
   * "ver código-fonte" baixava tudo em resolução cheia numa galeria com download
   * bloqueado. Esconder o botão não é proteger: o interruptor precisa apagar o
   * link, não só o desenho dele.
   */
  const itens: ItemGaleria[] = await Promise.all(
    medias.map(async (m) => {
      const [thumb, preview, download] = await Promise.all([
        urlDeLeitura(m.chave_thumb ?? m.chave, VALIDADE),
        urlDeLeitura(m.chave_preview ?? m.chave, VALIDADE),
        galeria.permite_download
          ? urlDeLeitura(m.chave, VALIDADE, m.nome_original)
          : Promise.resolve(null),
      ]);
      return {
        id: m.id,
        nome: m.nome_original,
        tipo: m.tipo,
        bytes: Number(m.bytes),
        largura: m.largura,
        altura: m.altura,
        url: thumb,
        urlGrande: preview,
        urlDownload: download,
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

  const aparencia = lerAparencia(galeria.aparencia);

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
  const urlCapa = capa ? await urlDeLeitura(capa.chave_preview ?? capa.chave, VALIDADE) : null;

  // A logo é guardada como CHAVE, não como URL: este bucket não tem endereço
  // público, então todo link é assinado na hora de desenhar a página.
  const urlLogo = galeria.estudio_logo
    ? await urlDeLeitura(galeria.estudio_logo, VALIDADE)
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
        {itens.length === 0 ? (
          <p className="py-20 text-center text-sm" style={{ color: "var(--g-suave)" }}>
            As fotos ainda estão sendo preparadas. Volte em breve.
          </p>
        ) : (
          <GaleriaCliente
            itens={itens}
            permiteDownload={galeria.permite_download}
            galeriaId={galeria.id}
            aparencia={aparencia}
            capitulos={capitulos}
            celularProvavel={celularProvavel}
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
