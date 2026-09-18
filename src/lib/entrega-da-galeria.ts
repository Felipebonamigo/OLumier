import { NextResponse } from "next/server";
import { consultarUm } from "@/lib/db";
import { listarMediasPublicas, temAcessoLiberado } from "@/lib/galerias-publicas";
import { listarSecoes } from "@/lib/secoes";
import { favoritasDaPessoa, pessoaAtual } from "@/lib/favoritas";
import { nomeComCapitulo, nomeDoGrupoSolto, vaiPrefixar } from "@/lib/nome-de-arquivo";
import { galeriasNoAr } from "@/lib/assinatura";
import { TETO_DE_ESCOLHIDAS } from "@/config/fatia-galeria";

/**
 * O QUE UM PEDIDO DE DOWNLOAD LEVA — a galeria, uma pasta ou as favoritas de
 * quem pediu — e as travas de sempre na frente.
 *
 * ── POR QUE É UM LUGAR SÓ (16/09/2026) ────────────────────────────────────
 *
 * Nasceu dentro da rota do zip. No mesmo dia o celular precisou da MESMA
 * lista, sem os bytes (`api/g/[id]/lista`): até ali ele montava o lote com o
 * que estava na tela, e numa galeria fatiada a tela é um pedaço — o menu dizia
 * 2108 e entregava 600. Duas rotas escolhendo fotos cada uma do seu jeito é a
 * receita para o zip do computador e o celular discordarem sobre o que é "a
 * pasta Festa"; aqui eles não têm como.
 *
 *   (nada)            a galeria inteira
 *   ?cap=<id>         uma pasta; `sem-capitulo` é o grupo das soltas
 *   ?favoritas=1      as favoritas da pessoa identificada (428 sem ela)
 *   ?fotos=<ids>      as fotos que a busca por rosto achou (até TETO_DE_ESCOLHIDAS)
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MediaDaEntrega = Awaited<ReturnType<typeof listarMediasPublicas>>[number];

export interface Entrega {
  titulo: string;
  fotos: MediaDaEntrega[];
  /** Nome de cada capítulo da galeria, como o fotógrafo escreveu. */
  capitulos: Map<string, string>;
  /** Sufixo que diz o que é: "", " - Festa", " - favoritas". */
  sufixo: string;
  tipo: "tudo" | "capitulo" | "favoritas" | "recorte";
  /** O nome do arquivo leva o capítulo? Mesma régua de `api/g/[id]/urls`. */
  prefixar: boolean;
  /**
   * Como as fotos sem capítulo se chamam NESTA galeria (migração 037).
   *
   * Viaja na entrega em vez de sair de uma constante porque o que o cliente
   * escolhe no menu ("Galeria completa (318)") e o que ele recebe no nome do
   * arquivo têm de ser a mesma palavra. Antes eram os dois `GRUPO_SEM_CAPITULO`
   * e não tinham como divergir; agora que o texto é do fotógrafo, é a entrega
   * que os mantém juntos.
   */
  grupoSolto: string;
}

export async function prepararEntrega(
  id: string,
  busca: URLSearchParams,
): Promise<Entrega | NextResponse> {
  const galeria = await consultarUm<{
    titulo: string;
    senha_hash: string | null;
    estado: string;
    permite_download: boolean;
    expira_em: string | null;
    grupo_solto: string | null;
    estudio_status: string;
    estudio_trial_ate: string | null;
  }>(
    `select g.titulo, g.senha_hash, g.estado, g.permite_download, g.expira_em, g.grupo_solto,
            t.status as estudio_status, t.trial_ate as estudio_trial_ate
       from galerias g join tenants t on t.id = g.tenant_id
      where g.id = $1 and g.publicada`,
    [id],
  );
  if (!galeria) return NextResponse.json({ erro: "sem acesso" }, { status: 404 });
  /*
   * As mesmas portas da PÁGINA, na mesma ordem (revisão de 16/09/2026): trial
   * abandonado e prazo vencido. A página mostra "fora do ar" e "o prazo
   * terminou"; sem estas linhas, quem guardou o id da galeria baixava tudo pelo
   * zip mesmo assim.
   */
  if (!galeriasNoAr({ status: galeria.estudio_status, trial_ate: galeria.estudio_trial_ate })) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.estado !== "online") return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  if (galeria.expira_em && new Date(galeria.expira_em) < new Date()) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 409 });
  }
  if (galeria.senha_hash && !(await temAcessoLiberado(id, galeria.senha_hash))) {
    return NextResponse.json({ erro: "sem acesso" }, { status: 401 });
  }
  if (!galeria.permite_download) {
    return NextResponse.json({ erro: "download não permitido nesta galeria" }, { status: 403 });
  }

  const cap = busca.get("cap");
  const querFavoritas = busca.get("favoritas") === "1";
  const recorte = (busca.get("fotos") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s))
    .slice(0, TETO_DE_ESCOLHIDAS);

  const [medias, secoes] = await Promise.all([listarMediasPublicas(id), listarSecoes(id)]);
  const capitulos = new Map(secoes.map((s) => [s.id, s.nome]));

  /* Grupos da GALERIA, não do pedido: a pasta Festa baixada sozinha continua
     levando "Festa - " no nome, como leva pelo link assinado. */
  const prefixar = vaiPrefixar(new Set(medias.map((m) => m.secao_id ?? null)).size);
  const grupoSolto = nomeDoGrupoSolto(galeria.grupo_solto);

  if (querFavoritas) {
    const pessoa = await pessoaAtual(id);
    if (!pessoa) {
      return NextResponse.json({ erro: "identifique-se", precisaEmail: true }, { status: 428 });
    }
    const minhas = new Set(await favoritasDaPessoa(id, pessoa));
    return {
      titulo: galeria.titulo,
      fotos: medias.filter((m) => minhas.has(m.id)),
      capitulos,
      sufixo: " - favoritas",
      tipo: "favoritas",
      prefixar,
      grupoSolto,
    };
  }

  /* As da busca por rosto. `medias` é desta galeria: id de outra não casa.
     Pedido de recorte sem id válido é recorte VAZIO, e não a galeria inteira —
     quem pediu "estas fotos" não pode receber 2108. */
  if (busca.has("fotos")) {
    const pedidas = new Set(recorte);
    return {
      titulo: galeria.titulo,
      fotos: medias.filter((m) => pedidas.has(m.id)),
      capitulos,
      sufixo: " - fotos escolhidas",
      tipo: "recorte",
      prefixar,
      grupoSolto,
    };
  }

  if (cap) {
    return {
      titulo: galeria.titulo,
      /* `m.secao_id === cap` sobre as mídias DESTA galeria: um capítulo de
         outra galeria simplesmente não casa com foto nenhuma. */
      fotos:
        cap === "sem-capitulo"
          ? medias.filter((m) => !m.secao_id)
          : medias.filter((m) => m.secao_id === cap),
      capitulos,
      sufixo: ` - ${cap === "sem-capitulo" ? grupoSolto : (capitulos.get(cap) ?? "capítulo")}`,
      tipo: "capitulo",
      prefixar,
      grupoSolto,
    };
  }

  return {
    titulo: galeria.titulo,
    fotos: medias,
    capitulos,
    sufixo: "",
    tipo: "tudo",
    prefixar,
    grupoSolto,
  };
}

/** O nome com que o arquivo chega — o mesmo do `Content-Disposition` assinado. */
export function nomeNaEntrega(m: MediaDaEntrega, entrega: Entrega): string {
  if (!entrega.prefixar) return m.nome_original;
  const capitulo = m.secao_id ? entrega.capitulos.get(m.secao_id) : null;
  return nomeComCapitulo(m.nome_original, capitulo ?? entrega.grupoSolto);
}
