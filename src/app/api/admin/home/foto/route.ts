import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { adminDaRequisicao } from "@/lib/portao-admin";
import { consultarUm } from "@/lib/db";
import { ACOES, registrarEvento } from "@/lib/eventos";
import { apagarObjeto, armazenamentoConfigurado, conferirObjeto, urlDeUpload } from "@/lib/r2";
import { ehLugarDaHome, type LugarDaHome } from "@/config/home-demonstracao";
import {
  MIME_FOTO_DA_HOME,
  chaveDaFotoDaHome,
  dimensaoValida,
  ehChaveDaFotoDaHome,
  normalizarDescricao,
  normalizarFoco,
  recusaDaFotoDaHome,
} from "@/lib/fotos-da-home-regras";

/**
 * TROCAR AS FOTOS DA PÁGINA INICIAL — só o administrador.
 *
 * O mesmo modelo da logo do estúdio (`api/marca/logo`): o navegador manda o
 * arquivo DIRETO para o bucket com URL assinada, e só depois confirma aqui.
 * O que sobe são as duas derivadas que o navegador gera (`gerarDerivadas`, a
 * mesma função do envio de uma galeria), não o original.
 *
 *   POST   → duas URLs de envio (foto e miniatura)
 *   PUT    → confere o que REALMENTE chegou e grava o lugar
 *   PATCH  → descrição e foco de uma foto já trocada; só o foco, se ainda for
 *            a padrão (tabela `focos_da_home`); `voltarFoco` devolve o do site
 *   DELETE → volta o lugar para a foto padrão
 *
 * Quem não é admin recebe 404, como nas páginas do admin (ver
 * `lib/portao-admin.ts`): de fora, esta rota não existe.
 *
 * Toda mudança chama `revalidatePath("/")`: a home é estática, e é isso que
 * faz a próxima visita já ver a foto nova.
 */

const NAO_EXISTE = () => NextResponse.json({ erro: "Não encontrado." }, { status: 404 });

async function corpoDe(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const c = await request.json();
    return c && typeof c === "object" ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function lugarDe(corpo: Record<string, unknown> | null): LugarDaHome | null {
  return corpo && ehLugarDaHome(corpo.lugar) ? corpo.lugar : null;
}

function revalidarHome() {
  revalidatePath("/");
  revalidatePath("/painel/admin/home");
}

export async function POST(request: NextRequest) {
  if (!(await adminDaRequisicao())) return NAO_EXISTE();
  if (!armazenamentoConfigurado) {
    return NextResponse.json({ erro: "Armazenamento não configurado." }, { status: 503 });
  }
  const lugar = lugarDe(await corpoDe(request));
  if (!lugar) return NextResponse.json({ erro: "Lugar inválido." }, { status: 400 });

  const foto = chaveDaFotoDaHome(lugar, "foto");
  const miniatura = chaveDaFotoDaHome(lugar, "miniatura");
  const [urlFoto, urlMiniatura] = await Promise.all([
    urlDeUpload(foto, MIME_FOTO_DA_HOME, 600),
    urlDeUpload(miniatura, MIME_FOTO_DA_HOME, 600),
  ]);
  return NextResponse.json({
    foto: { url: urlFoto, chave: foto },
    miniatura: { url: urlMiniatura, chave: miniatura },
  });
}

export async function PUT(request: NextRequest) {
  const admin = await adminDaRequisicao();
  if (!admin) return NAO_EXISTE();

  const corpo = await corpoDe(request);
  const lugar = lugarDe(corpo);
  if (!corpo || !lugar) return NextResponse.json({ erro: "Lugar inválido." }, { status: 400 });

  const { chave, chaveMiniatura, largura, altura } = corpo;
  /* As chaves vêm do navegador: só valem as DESTE lugar, criadas pelo POST.
     Ver `ehChaveDaFotoDaHome` para o que um pedido forjado faria sem isto. */
  if (!ehChaveDaFotoDaHome(chave, lugar, "foto") || !ehChaveDaFotoDaHome(chaveMiniatura, lugar, "miniatura")) {
    return NextResponse.json({ erro: "Envio inválido." }, { status: 400 });
  }
  if (!dimensaoValida(largura) || !dimensaoValida(altura)) {
    return NextResponse.json({ erro: "Medidas da foto inválidas." }, { status: 400 });
  }

  /* Confere o que CHEGOU ao bucket, não o que o navegador disse que ia mandar. */
  let recusa: string | null;
  try {
    const [f, m] = await Promise.all([conferirObjeto(chave), conferirObjeto(chaveMiniatura)]);
    recusa = recusaDaFotoDaHome(f.mime, f.bytes) ?? recusaDaFotoDaHome(m.mime, m.bytes);
  } catch {
    return NextResponse.json({ erro: "A foto não chegou. Tente de novo." }, { status: 409 });
  }
  if (recusa) {
    await Promise.all([apagarObjeto(chave), apagarObjeto(chaveMiniatura)]).catch(() => {});
    return NextResponse.json({ erro: recusa }, { status: 415 });
  }

  /* A anterior é lida ANTES da troca: depois do upsert não há mais como saber
     que objetos ficaram sem dono. */
  const antes = await consultarUm<{ chave: string; chave_miniatura: string | null }>(
    "select chave, chave_miniatura from fotos_da_home where lugar = $1",
    [lugar],
  );
  const descricao = normalizarDescricao(corpo.descricao);
  await consultarUm(
    `insert into fotos_da_home
       (lugar, chave, chave_miniatura, largura, altura, descricao, foco_x, foco_y, trocada_em, trocada_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     on conflict (lugar) do update set
       chave = excluded.chave, chave_miniatura = excluded.chave_miniatura,
       largura = excluded.largura, altura = excluded.altura, descricao = excluded.descricao,
       foco_x = excluded.foco_x, foco_y = excluded.foco_y,
       trocada_em = now(), trocada_por = excluded.trocada_por`,
    [
      lugar,
      chave,
      chaveMiniatura,
      largura,
      altura,
      descricao,
      normalizarFoco(corpo.focoX),
      normalizarFoco(corpo.focoY),
      admin.id,
    ],
  );

  const velhas = [antes?.chave, antes?.chave_miniatura].filter(
    (c): c is string => Boolean(c) && c !== chave && c !== chaveMiniatura,
  );
  await Promise.all(velhas.map((c) => apagarObjeto(c).catch(() => {})));

  await registrarEvento({
    tenantId: admin.id,
    estudio: admin.nome_estudio,
    ator: "estudio",
    acao: ACOES.HOME_FOTO_TROCADA,
    alvoTipo: "home",
    alvoId: lugar,
    detalhe: { lugar, descricao, largura, altura },
  });
  revalidarHome();
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest) {
  const admin = await adminDaRequisicao();
  if (!admin) return NAO_EXISTE();
  const corpo = await corpoDe(request);
  const lugar = lugarDe(corpo);
  if (!corpo || !lugar) return NextResponse.json({ erro: "Lugar inválido." }, { status: 400 });

  /* Devolve o foco que vem com o site. Idempotente, e vale para qualquer
     lugar: sem linha, não há o que apagar. */
  if (corpo.voltarFoco === true) {
    await consultarUm("delete from focos_da_home where lugar = $1", [lugar]);
    revalidarHome();
    return NextResponse.json({ ok: true });
  }

  /* A foto TROCADA tem descrição e foco na própria linha. A padrão tem a
     descrição no repositório — que o admin não muda daqui — e o foco ajustado
     vai para `focos_da_home`, e não para uma linha de `fotos_da_home` sem
     foto (migração 062). */
  const r = await consultarUm<{ lugar: string }>(
    `update fotos_da_home set
       descricao = coalesce($2, descricao),
       foco_x = coalesce($3, foco_x),
       foco_y = coalesce($4, foco_y)
     where lugar = $1 returning lugar`,
    [
      lugar,
      "descricao" in corpo ? normalizarDescricao(corpo.descricao) : null,
      "focoX" in corpo ? normalizarFoco(corpo.focoX) : null,
      "focoY" in corpo ? normalizarFoco(corpo.focoY) : null,
    ],
  );
  if (!r) {
    if ("descricao" in corpo) {
      return NextResponse.json(
        { erro: "A descrição da foto padrão vem do site — troque a foto para escrever outra." },
        { status: 409 },
      );
    }
    if (!("focoX" in corpo) || !("focoY" in corpo)) {
      return NextResponse.json({ erro: "Marque o foco na foto." }, { status: 400 });
    }
    await consultarUm(
      `insert into focos_da_home (lugar, foco_x, foco_y, ajustado_em, ajustado_por)
       values ($1, $2, $3, now(), $4)
       on conflict (lugar) do update set
         foco_x = excluded.foco_x, foco_y = excluded.foco_y,
         ajustado_em = now(), ajustado_por = excluded.ajustado_por`,
      [lugar, normalizarFoco(corpo.focoX), normalizarFoco(corpo.focoY), admin.id],
    );
  }
  revalidarHome();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const admin = await adminDaRequisicao();
  if (!admin) return NAO_EXISTE();
  const lugar = lugarDe(await corpoDe(request));
  if (!lugar) return NextResponse.json({ erro: "Lugar inválido." }, { status: 400 });

  /* `delete ... returning` devolve a linha como ela ERA — com as chaves que
     precisam sair do bucket. */
  const antes = await consultarUm<{ chave: string; chave_miniatura: string | null }>(
    "delete from fotos_da_home where lugar = $1 returning chave, chave_miniatura",
    [lugar],
  );
  if (antes) {
    const chaves = [antes.chave, antes.chave_miniatura].filter((c): c is string => Boolean(c));
    await Promise.all(chaves.map((c) => apagarObjeto(c).catch(() => {})));
    await registrarEvento({
      tenantId: admin.id,
      estudio: admin.nome_estudio,
      ator: "estudio",
      acao: ACOES.HOME_FOTO_RESTAURADA,
      alvoTipo: "home",
      alvoId: lugar,
      detalhe: { lugar },
    });
  }
  revalidarHome();
  return NextResponse.json({ ok: true });
}
