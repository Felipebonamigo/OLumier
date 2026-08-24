"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarSessao, sessaoAtual } from "@/lib/auth";
import { criarGaleria, apagarGaleria } from "@/lib/tenants";
import { consultar } from "@/lib/db";
import { gerarHashSenhaGaleria } from "@/lib/galerias-publicas";
import { lerAparencia } from "@/config/aparencia";
import { PRAZOS } from "@/config/prazos";
import { marca } from "@/config/marca";
import { planoPorId, GB } from "@/config/planos";
import { buscarTenantPorId } from "@/lib/tenants";
import {
  asaasConfigurado,
  garantirCliente,
  criarAssinatura,
  atualizarAssinatura,
  cancelarAssinatura,
} from "@/lib/asaas";
import { conferirDocumento, soDigitos } from "@/lib/documento";
import { normalizarCor, normalizarNomeEstudio } from "@/lib/marca-estudio";
import { MINIMO_SENHA, trocarSenha } from "@/lib/senha";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";
import { definirPrazo, arquivarAgora, reativar } from "@/lib/cofre";
import { usoDoEstudio } from "@/lib/medias";
import {
  CAPITULOS_SUGERIDOS,
  apagarSecao,
  criarSecao,
  moverMediasParaSecao,
  moverSecao,
  renomearSecao,
} from "@/lib/secoes";

/** Toda action começa por aqui: quem não tem sessão válida não faz nada. */
async function exigirTenant(): Promise<string> {
  const id = await sessaoAtual();
  if (!id) redirect("/entrar");
  return id;
}

export interface EstadoGaleria {
  erro?: string;
  /** Só a edição usa: a tela fecha o formulário quando a gravação confirma. */
  ok?: boolean;
}

export async function criarGaleriaAction(
  _estado: EstadoGaleria,
  form: FormData,
): Promise<EstadoGaleria> {
  const tenantId = await exigirTenant();

  const titulo = String(form.get("titulo") ?? "").trim();
  if (!titulo) return { erro: "Dê um nome para a galeria." };

  const subtitulo = String(form.get("subtitulo") ?? "").trim();
  const dataEvento = String(form.get("data_evento") ?? "").trim();

  const galeria = await criarGaleria({ tenantId, titulo, subtitulo, dataEvento });
  revalidatePath("/painel");
  redirect(`/painel/galerias/${galeria!.id}`);
}

/**
 * Salva os controles de entrega. Recebe só o que mudou: a tela alterna uma coisa
 * por vez, e campo ausente significa "não mexer" — não "apagar".
 */
export async function salvarPublicacaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const campos: string[] = [];
  const valores: unknown[] = [];

  const publicada = form.get("publicada");
  if (publicada !== null) {
    valores.push(publicada === "1");
    campos.push(`publicada = $${valores.length}`);
  }

  const permiteDownload = form.get("permite_download");
  if (permiteDownload !== null) {
    valores.push(permiteDownload === "1");
    campos.push(`permite_download = $${valores.length}`);
  }

  if (form.get("mexeu_senha") === "1") {
    const senha = String(form.get("senha") ?? "").trim();
    // Campo vazio tira a senha; com texto, grava o hash.
    valores.push(senha ? gerarHashSenhaGaleria(senha, galeriaId) : null);
    campos.push(`senha_hash = $${valores.length}`);
  }

  if (campos.length === 0) return;

  valores.push(galeriaId, tenantId);
  await consultar(
    `update galerias set ${campos.join(", ")}, atualizado_em = now()
      where id = $${valores.length - 1} and tenant_id = $${valores.length}`,
    valores,
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Salva a aparência. Valida antes de gravar — o JSON vem do navegador. */
export async function salvarAparenciaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return;
  }

  // lerAparencia descarta qualquer chave desconhecida ou valor inválido:
  // o que é gravado é sempre um objeto que o renderizador sabe desenhar.
  const limpa = lerAparencia(bruto);

  await consultar(
    `update galerias set aparencia = $1, atualizado_em = now()
      where id = $2 and tenant_id = $3`,
    [JSON.stringify(limpa), galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Define qual foto abre a galeria. */
export async function definirCapaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const mediaId = String(form.get("media_id") ?? "");
  if (!galeriaId || !mediaId) return;

  await consultar(
    `update galerias g set capa_media_id = $1, atualizado_em = now()
      where g.id = $2 and g.tenant_id = $3
        and exists (select 1 from medias m where m.id = $1 and m.galeria_id = g.id)`,
    [mediaId, galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

// --- capítulos --------------------------------------------------------------

export async function criarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const nome = String(form.get("nome") ?? "");
  await criarSecao(galeriaId, tenantId, nome);
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/** Cria os capítulos sugeridos de uma vez — a estrutura típica de um casamento. */
export async function criarCapitulosSugeridosAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  for (const nome of CAPITULOS_SUGERIDOS) {
    await criarSecao(galeriaId, tenantId, nome);
  }
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

export async function renomearSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await renomearSecao(String(form.get("secao_id") ?? ""), tenantId, String(form.get("nome") ?? ""));
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function apagarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await apagarSecao(String(form.get("secao_id") ?? ""), tenantId);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function moverSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const direcao = form.get("direcao") === "cima" ? "cima" : "baixo";
  await moverSecao(String(form.get("secao_id") ?? ""), tenantId, direcao);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

export async function moverMediasAction(form: FormData) {
  const tenantId = await exigirTenant();
  const ids = String(form.get("media_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const destino = String(form.get("secao_id") ?? "");
  await moverMediasParaSecao(ids, destino || null, tenantId);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

// --- cobranca --------------------------------------------------------------

/**
 * Cria a assinatura no Asaas para o estudio logado.
 * Guarda os ids no banco: sem isso, uma segunda chamada criaria assinatura
 * duplicada e o fotografo pagaria duas vezes.
 */
export async function criarAssinaturaAction(
  documento: string,
): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();

  if (!asaasConfigurado()) return { erro: "A cobranca ainda nao foi ligada." };

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta nao encontrada." };
  if (tenant.asaas_assinatura_id) return; // ja tem

  const plano = planoPorId(tenant.plano_id);
  if (!plano) return { erro: "Plano invalido." };

  // O Asaas recusa cliente sem CPF/CNPJ. Conferir aqui em vez de deixar a API
  // devolver erro em inglês que não diz à pessoa o que fazer.
  const doc = soDigitos(documento || tenant.cpf_cnpj || "");
  const problema = conferirDocumento(doc);
  if (problema) return { erro: problema };

  try {
    const cliente = await garantirCliente({
      tenantId,
      nome: tenant.nome_estudio,
      email: tenant.email,
      cpfCnpj: doc,
    });

    // Guardar só depois do Asaas aceitar: documento recusado não deve ficar
    // gravado como se fosse válido.
    await consultar("update tenants set cpf_cnpj = $1, atualizado_em = now() where id = $2", [
      doc,
      tenantId,
    ]);

    // Primeiro vencimento quando o teste acabar; se ja acabou, em 3 dias.
    const fimTrial = tenant.trial_ate ? new Date(tenant.trial_ate) : new Date();
    const minimo = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const vencimento = fimTrial > minimo ? fimTrial : minimo;

    const assinatura = await criarAssinatura({
      clienteAsaasId: cliente.id,
      tenantId,
      planoId: plano.id,
      precoCentavos: plano.precoCentavos,
      descricao: `${marca.nome} — ${plano.nome}`,
      primeiroVencimento: vencimento,
    });

    await consultar(
      `update tenants
          set asaas_cliente_id = $1, asaas_assinatura_id = $2,
              assinatura_criada_em = now(), atualizado_em = now()
        where id = $3`,
      [cliente.id, assinatura.id, tenantId],
    );

    revalidatePath("/painel/conta");
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "nao consegui criar a assinatura" };
  }
}

/**
 * Muda o plano do estúdio.
 *
 * O erro de quota manda "aumente o plano" desde sempre — e até agora não havia
 * como fazer isso dentro do app. A pessoa lia uma instrução impossível de
 * cumprir.
 *
 * DESCER de plano só é permitido se o que já está guardado couber no tamanho
 * novo. Aceitar e deixar o estúdio instantaneamente acima do limite criaria uma
 * conta travada que ninguém sabe destravar — pior que recusar com clareza.
 */
export async function trocarPlanoAction(
  novoPlanoId: string,
): Promise<{ erro?: string; ok?: string } | void> {
  const tenantId = await exigirTenant();

  const plano = planoPorId(novoPlanoId);
  if (!plano) return { erro: "Plano inválido." };

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (tenant.plano_id === plano.id) return { erro: "Você já está neste plano." };

  const novaQuotaAr = BigInt(plano.quotaGb) * BigInt(GB);
  const novaQuotaCofre = BigInt(plano.cofreGb) * BigInt(GB);
  const uso = await usoDoEstudio(tenantId);

  if (uso.noAr > novaQuotaAr) {
    const excesso = Number(uso.noAr - novaQuotaAr) / 1024 ** 3;
    return {
      erro: `Suas galerias no ar ocupam ${excesso.toFixed(1)} GB a mais do que o ${plano.nome} permite. Arquive ou apague algo antes de descer de plano.`,
    };
  }
  if (uso.noCofre > novaQuotaCofre) {
    const excesso = Number(uso.noCofre - novaQuotaCofre) / 1024 ** 3;
    return {
      erro: `Seu cofre ocupa ${excesso.toFixed(1)} GB a mais do que o ${plano.nome} permite. Apague algo do cofre antes de descer de plano.`,
    };
  }

  // A assinatura primeiro: se o Asaas recusar, o plano no banco não muda e o
  // estúdio não fica com espaço que ninguém está cobrando.
  if (asaasConfigurado() && tenant.asaas_assinatura_id) {
    try {
      await atualizarAssinatura({
        assinaturaId: tenant.asaas_assinatura_id,
        planoId: plano.id,
        precoCentavos: plano.precoCentavos,
        descricao: `${marca.nome} — ${plano.nome}`,
      });
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "não consegui atualizar a assinatura" };
    }
  }

  await consultar(
    `update tenants
        set plano_id = $1, quota_bytes = $2, quota_cofre_bytes = $3, atualizado_em = now()
      where id = $4`,
    [plano.id, novaQuotaAr.toString(), novaQuotaCofre.toString(), tenantId],
  );

  revalidatePath("/painel/conta");
  revalidatePath("/painel");
  return { ok: `Agora você está no ${plano.nome}.` };
}

/**
 * Cancela a assinatura.
 *
 * O `cancelarAssinatura` existia no código desde o início e nunca foi chamado
 * por ninguém — não havia como cancelar pelo painel, só escrevendo para o
 * suporte. Os Termos prometem "cancele quando quiser"; agora é verdade.
 *
 * O conteúdo NÃO é apagado: o estúdio deixa de poder enviar coisa nova, e o que
 * já foi entregue continua no ar. Apagar foto de casamento por causa de um
 * cancelamento seria punir o casal por uma decisão do fotógrafo.
 */
export async function cancelarAssinaturaAction(): Promise<{ erro?: string; ok?: string } | void> {
  const tenantId = await exigirTenant();

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (!tenant.asaas_assinatura_id) return { erro: "Não há assinatura ativa para cancelar." };

  try {
    await cancelarAssinatura(tenant.asaas_assinatura_id);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui cancelar no Asaas" };
  }

  await consultar(
    `update tenants
        set status = 'cancelado', asaas_assinatura_id = null, atualizado_em = now()
      where id = $1`,
    [tenantId],
  );

  revalidatePath("/painel/conta");
  return { ok: "Assinatura cancelada. Suas galerias publicadas continuam no ar." };
}

// --- cofre ----------------------------------------------------------------

export async function definirPrazoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const bruto = String(form.get("meses") ?? "");
  // "" significa sem prazo; qualquer outro valor precisa estar na lista oferecida.
  const meses = bruto === "" ? null : Number(bruto);
  if (meses !== null && !PRAZOS.some((p) => p.meses === meses)) return;

  await definirPrazo(galeriaId, tenantId, meses);
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

export async function arquivarAgoraAction(form: FormData): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  // O resultado precisa chegar à tela: "não coube no cofre" resolvido em
  // silêncio deixaria a pessoa clicando de novo sem entender por que nada muda.
  const r = await arquivarAgora(galeriaId, tenantId);
  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
}

export async function reativarAction(form: FormData): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const r = await reativar(galeriaId, tenantId);
  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
}

/**
 * Corrige os dados da galeria depois de criada.
 *
 * Antes isto só existia no momento da criação: um erro no nome do casal exigia
 * apagar a galeria e reenviar tudo de novo. Custava horas para consertar uma
 * letra.
 *
 * O SLUG NÃO MUDA — de propósito, e essa é a decisão que importa aqui. O
 * endereço já foi mandado no WhatsApp do casal, e provavelmente repassado para a
 * família inteira. Renomear a galeria não pode transformar um link que está
 * circulando em página de erro. Título é o que se lê; slug é o endereço, e
 * endereço entregue não se mexe.
 */
export async function editarGaleriaAction(
  _estado: EstadoGaleria,
  form: FormData,
): Promise<EstadoGaleria> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não encontrada." };

  const titulo = String(form.get("titulo") ?? "").trim();
  if (!titulo) return { erro: "Dê um nome para a galeria." };

  const subtitulo = String(form.get("subtitulo") ?? "").trim();
  const dataEvento = String(form.get("data_evento") ?? "").trim();

  await consultar(
    `update galerias
        set titulo = $1, subtitulo = $2, data_evento = $3, atualizado_em = now()
      where id = $4 and tenant_id = $5`,
    [titulo.slice(0, 120), subtitulo.slice(0, 160) || null, dataEvento || null, galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
  return { ok: true };
}

// --- marca do estúdio -------------------------------------------------------

export interface EstadoMarca {
  erro?: string;
  ok?: string;
}

/**
 * Nome do estúdio e cor de destaque. A logo vai por outro caminho
 * (/api/marca/logo), porque arquivo não cabe no corpo de um server action.
 *
 * O SLUG TAMBÉM NÃO MUDA AQUI, pelo mesmo motivo da galeria: ele é o endereço
 * (siriusfotografia.olumier.com.br) de todas as galerias já entregues. Trocar o
 * nome do estúdio muda o que aparece escrito, não onde as coisas moram.
 */
export async function salvarMarcaAction(
  _estado: EstadoMarca,
  form: FormData,
): Promise<EstadoMarca> {
  const tenantId = await exigirTenant();

  const nome = normalizarNomeEstudio(String(form.get("nome_estudio") ?? ""));
  if (!nome) return { erro: "O nome do estúdio precisa de pelo menos 2 letras." };

  const cor = normalizarCor(String(form.get("cor_destaque") ?? ""));
  if (!cor) return { erro: "Cor inválida. Use o seletor ou um código como #e6c17a." };

  await consultar("update tenants set nome_estudio = $1, cor_destaque = $2 where id = $3", [
    nome,
    cor,
    tenantId,
  ]);

  revalidatePath("/painel/conta");
  revalidatePath("/painel");
  return { ok: "Marca salva." };
}

// --- trocar a própria senha ------------------------------------------------

export interface EstadoSenha {
  erro?: string;
  ok?: string;
}

/**
 * Troca a senha de quem está logado.
 *
 * Pede a senha ATUAL mesmo quem já está dentro. Não é burocracia: sessão aberta
 * num computador emprestado, ou cookie roubado, viraria conta tomada para sempre
 * se bastasse estar logado para trocar a senha. Saber a senha atual é o que
 * separa "é o dono" de "está no navegador do dono".
 */
export async function trocarSenhaAction(
  _estado: EstadoSenha,
  form: FormData,
): Promise<EstadoSenha> {
  const tenantId = await exigirTenant();

  const atual = String(form.get("senha_atual") ?? "");
  const nova = String(form.get("senha_nova") ?? "");
  const repetida = String(form.get("senha_repetida") ?? "");

  // Freio: sem ele, quem pegasse uma sessão aberta poderia testar a senha atual
  // à vontade por aqui, sem passar pela tela de entrada, que já é freada.
  const chave = `trocar-senha:${tenantId}`;
  const antes = podeTentar(chave);
  if (!antes.permitido) {
    return { erro: `Muitas tentativas. Tente de novo em ${emPalavras(antes.esperarSeg!)}.` };
  }

  const r = await trocarSenha(tenantId, atual, nova, repetida);
  if (!r.ok) {
    const recados: Record<string, string> = {
      curta: `A senha nova precisa de pelo menos ${MINIMO_SENHA} caracteres.`,
      diferentes: "As duas senhas novas não são iguais.",
      "igual-a-atual": "A senha nova é igual à atual.",
      "sem-conta": "Conta não encontrada.",
      "atual-errada": "A senha atual está incorreta.",
    };
    // Só errar a senha ATUAL conta como tentativa: digitar duas senhas novas
    // diferentes é engano de digitação, não alguém adivinhando.
    if (r.motivo === "atual-errada") {
      const depois = registrarErro(chave);
      if (!depois.permitido) {
        return { erro: `Muitas tentativas. Tente de novo em ${emPalavras(depois.esperarSeg!)}.` };
      }
    }
    return { erro: recados[r.motivo] };
  }
  limparTentativas(chave);

  /*
   * Cookie novo para ESTE aparelho.
   *
   * A troca derruba toda sessão emitida antes — inclusive a de quem está
   * trocando agora. Sem emitir um cookie novo, a pessoa seria deslogada no
   * instante em que trocasse a senha, sem entender o motivo. Os outros aparelhos
   * caem, que é justamente o ponto.
   */
  await criarSessao(tenantId);

  revalidatePath("/painel/conta");
  return { ok: "Senha alterada. Os outros aparelhos foram desconectados." };
}

export async function apagarGaleriaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  // O apagarGaleria filtra por tenant_id também — id adivinhado não apaga galeria alheia.
  await apagarGaleria(tenantId, galeriaId);
  revalidatePath("/painel");
  redirect("/painel");
}
