import { NextResponse, type NextRequest } from "next/server";
import { galeriaLiberada } from "@/lib/acesso-galeria-publica";
import { pessoaAtual } from "@/lib/favoritas";
import { hashDeIp } from "@/lib/ip";
import { podeTentar, registrarUso, emPalavras } from "@/lib/tentativas";
import { configDaGaleria, gravarRecado, notasValidas, TETO_DO_RECADO } from "@/lib/recados";
import { avisarRecado } from "@/lib/avisos";

/**
 * O RECADO DO CLIENTE — a única porta por onde ele entra (migração 058).
 *
 * POST só. Esta rota NÃO devolve recado nenhum, e a ausência de GET é a metade
 * técnica do "só o fotógrafo lê": a leitura mora no painel, atrás de
 * `galeriaDoPainel`, que amarra `tenant_id`. Se um dia alguém precisar ler aqui,
 * está escrito que isso quebra a regra.
 *
 * ── OS CÓDIGOS, E POR QUE CADA UM ─────────────────────────────────────────
 *
 *   404/409/401  a galeria não está aberta — ver `galeriaLiberada`;
 *   409          aberta, mas o recado está DESLIGADO nesta galeria. É o mesmo
 *                código do cofre porque é a mesma natureza: existe, não serve;
 *   428          falta dizer quem é (o mesmo das favoritas: não é erro, é um
 *                passo que falta — recado anônimo seria linha que o fotógrafo
 *                não pode responder);
 *   422          nada a gravar: sem texto e sem nota válida;
 *   429          volume demais da mesma origem.
 */

/**
 * Quantos recados a mesma origem pode GRAVAR em 15 minutos.
 *
 * Quinze porque a origem é um IP, e um IP é uma casa: noiva, noivo, mãe, sogra e
 * duas irmãs no mesmo wi-fi, cada uma escrevendo e corrigindo uma vez, chega
 * perto de dez sem ninguém fazer nada de errado. O que o freio existe para
 * barrar é o laço — centenas —, e esse estoura quinze do mesmo jeito.
 */
const RECADOS_POR_JANELA = 15;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const permissao = await galeriaLiberada(id);
  if (!permissao.ok) return NextResponse.json({ erro: "sem acesso" }, { status: permissao.status });

  const config = await configDaGaleria(id);
  if (!config?.ativo) {
    return NextResponse.json({ erro: "recado desligado nesta galeria" }, { status: 409 });
  }

  const pessoaId = await pessoaAtual(id);
  if (!pessoaId) {
    return NextResponse.json({ erro: "diga quem você é primeiro" }, { status: 428 });
  }

  /*
   * O freio. Conta ACERTO, não erro — ver `registrarUso`. A chave junta a
   * galeria e o IP em hash: quem tem o link cria identidades à vontade
   * (`pessoaPorEmail` aceita qualquer coisa com arroba), e o índice único por
   * pessoa não segura nada contra isso.
   */
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const chaveDoFreio = `recado:${id}:${ip ? hashDeIp(ip) : "sem-ip"}`;
  /* A conferência aqui NÃO conta nada: `podeTentar` só lê. Quem conta é o
     `registrarUso` depois da gravação — pedido recusado por falta de texto não
     é recado, e consumir a cota com ele faria a trava cair sobre quem está
     tentando acertar. */
  const freio = podeTentar(chaveDoFreio);
  if (!freio.permitido) {
    return NextResponse.json(
      { erro: `Muitos recados seguidos. Tente de novo em ${emPalavras(freio.esperarSeg ?? 60)}.` },
      { status: 429 },
    );
  }

  let corpo: { texto?: unknown; notas?: unknown; autoriza?: unknown };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: "requisição inválida" }, { status: 400 });
  }

  /*
   * Cada metade só entra se o fotógrafo pediu aquela metade. A tela já esconde o
   * que ele desligou; isto é a trava do lado do servidor, e as duas existem
   * porque a tela é do navegador de outra pessoa.
   */
  const texto = config.escrito
    ? String(corpo.texto ?? "").trim().slice(0, TETO_DO_RECADO) || null
    : null;
  const notas = config.estrelas ? notasValidas(corpo.notas, config.perguntas) : {};

  if (!texto && Object.keys(notas).length === 0) {
    return NextResponse.json({ erro: "escreva algo ou dê uma nota" }, { status: 422 });
  }

  /* A autorização é um SIM explícito e nada mais: qualquer outro valor é não. */
  const gravou = await gravarRecado(id, pessoaId, {
    texto,
    notas,
    autoriza: corpo.autoriza === true,
  });
  if (!gravou) {
    /* O teto por identidade (migração 060). 409 e não 429: não é volume de
       origem, é esta pessoa já ter dito o que tinha para dizer. */
    return NextResponse.json(
      { erro: "Você já deixou os seus recados nesta galeria." },
      { status: 409 },
    );
  }

  registrarUso(chaveDoFreio, RECADOS_POR_JANELA);

  /*
   * O OUTRO LADO FICA SABENDO — DEPOIS da resposta, e só quando a galeria veio de
   * um contrato.
   *
   * `after` e não `await`, e a diferença é de quem paga a espera. Quem está nesta
   * rota é o CASAL, no celular, esperando o "recado enviado": o canal tem até
   * quatro segundos de teto (`TEMPO_MAXIMO_MS`), e somar isso ao clique dele para
   * avisar o CRM do fotógrafo é cobrar de quem não tem nada com aquilo. O recado
   * já está gravado quando esta linha roda — a resposta não depende do aviso.
   *
   * Em `avisarEntrega` é `await` porque lá quem espera é o fotógrafo publicando,
   * e ele quer saber se o aviso saiu. Aqui não há ninguém para informar.
   *
   * O `try` existe porque `after` só vale dentro de uma requisição; fora dela
   * (um script, a suíte) o aviso simplesmente não acontece, como já não acontecia.
   */
  try {
    const { after } = await import("next/server");
    after(() => avisarRecado(id));
  } catch {
    await avisarRecado(id);
  }
  return NextResponse.json({ ok: true });
}
