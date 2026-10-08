"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { criarSessao, sessaoAtual } from "@/lib/auth";
import { gerarChave, listarChaves, revogarChave } from "@/lib/chaves-api";
import { criarGaleria, apagarGaleria, restaurarGaleria } from "@/lib/tenants";
import { consultar, consultarUm } from "@/lib/db";
import { gerarHashSenhaGaleria } from "@/lib/galerias-publicas";
/* O aviso ao outro lado. `avisarEntrega` NUNCA lança — ver lib/avisos.ts —, e é
 * por isso que ele pode ser chamado assim, solto, no fim de cada ação: nenhuma
 * delas passa a depender de o Atomatiza estar de pé. */
import { avisarEntrega, removerCanal } from "@/lib/avisos";
import { cifrarSenha } from "@/lib/senha-da-galeria";
import {
  gravarRascunho,
  promoverRascunhoSePendente,
  salvarPadraoDoEstudio,
  esquecerPadraoDoEstudio,
  aparenciaInicialDaGaleria,
  publicarAparencia,
} from "@/lib/aparencia-galeria";
import {
  apagarEstilo,
  renomearEstilo,
  salvarEstilo,
  tornarEstiloPadrao,
  type EstiloDoEstudio,
} from "@/lib/estilos-do-estudio";
import { aparenciaComFormato, type Aparencia } from "@/config/aparencia";
import { formatosLiberadosPara } from "@/lib/acesso-formatos";
import { assinarTenant, escolherPlanoAntesDeAssinar } from "@/lib/assinar";
import { assinarPacote, acrescentarAtomatiza } from "@/lib/pacote";
import { ehFaixaAtomatiza } from "@/config/combo";
import { cotarTroca, trocarPlano, RECADO_DO_PACOTE } from "@/lib/troca-de-plano";
import { PRAZOS } from "@/config/prazos";
import { marca } from "@/config/marca";
import { planoPorId, cicloDe, formatarReais } from "@/config/planos";
import { formaDaAssinatura } from "@/config/forma-assinatura";
import { buscarTenantPorId } from "@/lib/tenants";
import { cancelarAssinatura } from "@/lib/asaas";
import { enviarConfirmacao } from "@/lib/confirmacao-email";
import { situacaoDoTenant } from "@/lib/assinatura";
import { anotarDevolucao, cotarCancelamento, PRAZO_DA_DEVOLUCAO } from "@/lib/devolucao";
import { RETENCAO_POR_EXTENSO } from "@/config/retencao";
import { normalizarCor, normalizarNomeEstudio } from "@/lib/marca-estudio";
import { lerSite, normalizarInstagram, normalizarWhatsapp } from "@/lib/site-estudio";
import { MINIMO_SENHA, trocarSenha } from "@/lib/senha";
import { podeTentar, registrarErro, limparTentativas, emPalavras } from "@/lib/tentativas";
import { definirPrazo, arquivarAgora, reativar } from "@/lib/cofre";
import { registrarEvento, ACOES } from "@/lib/eventos";
import { ipDaRequisicao } from "@/lib/origem";
import {
  apagarSecao,
  apagarTodasAsSecoes,
  criarSecao,
  garantirSecoes,
  moverMediasParaSecao,
  moverSoltasParaSecao,
  moverSecao,
  reordenarSecoes,
  renomearSecao,
  renomearGrupoSolto,
  ordenarFotosDaSecao,
  definirCapaDaPasta,
  ORDENS_DAS_FOTOS,
  type OrdemDasFotos,
} from "@/lib/secoes";
import {
  galeriasParaMover,
  moverMediasParaOutraGaleria,
  opcoesDoDestino,
  ehUuid,
  MAXIMO_POR_MOVIMENTO,
  type DestinoPossivel,
  type EscopoDoMovimento,
  type OpcoesDoDestino,
  type ResultadoDoMovimento,
} from "@/lib/mover-entre-galerias";
import { definirRegrasSelecao, reabrirSelecao } from "@/lib/favoritas";
import { desligarRostos, fotosSemRosto, ligarRostos } from "@/lib/rostos";
import { armazemDe, urlDaDerivada } from "@/lib/armazem";
import { fotosDaPasta, type FotoDaPasta } from "@/lib/entrega-no-design";
import { definirTituloDoVideo } from "@/lib/medias";
import { videosParaPreparar } from "@/lib/videos-para-preparar";

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

  /*
   * ── O QUE O ASSISTENTE TRAZ JUNTO (04/09/2026) ──────────────────────────
   *
   * Estilo e capítulos passaram a ser perguntados na criação, em duas etapas
   * opcionais. As duas decisões já existiam — só ficavam escondidas em outra
   * tela, e muita gente nunca descobria que dava para tomá-las.
   *
   * As duas falham em SILÊNCIO de propósito: a galeria já existe e é o que a
   * pessoa pediu. Perder o estilo escolhido é chato e tem conserto num clique
   * em Design; recusar a criação inteira por causa de um preset inválido não
   * tem conserto nenhum — ela perderia o nome, a data e a vontade.
   */
  /*
   * ── O ESTILO ESCOLHIDO VENCE O PADRÃO DO ESTÚDIO ──────────────────────
   *
   * A ordem importa e é a única leitura possível: se a pessoa parou na etapa de
   * estilo e apontou um cartão, foi uma decisão TOMADA AGORA, sobre esta
   * galeria. O padrão do estúdio é a decisão de sempre, e serve para quem
   * passou direto — que é o caminho de quem já salvou o próprio padrão
   * justamente para não escolher de novo.
   *
   * Sem nenhum dos dois, a coluna fica no `'{}'` de sempre e `lerAparencia`
   * completa com o padrão do código.
   */
  /* Um estilo salvo do estúdio (até cinco, desde 28/09/2026) entra na mesma
     fila, entre o pronto e o padrão — ver `aparenciaInicialDaGaleria`. */
  /* E o formato (galeria, pastas, stream), escolhido na mesma etapa, por
     cima do estilo — ver `aparenciaComFormato`. */
  const aparenciaInicial = aparenciaComFormato(
    await aparenciaInicialDaGaleria(
      tenantId,
      String(form.get("preset") ?? ""),
      String(form.get("estilo") ?? ""),
    ),
    /* Quem não tem Pastas e Stream liberados não escolhe formato — o campo
       nem aparece, e o formulário é um endpoint. Ver `acesso-formatos`. */
    (await formatosLiberadosPara(tenantId)) ? String(form.get("formato") ?? "") : "",
  );
  if (aparenciaInicial) {
    await consultar("update galerias set aparencia = $1 where id = $2 and tenant_id = $3", [
      JSON.stringify(aparenciaInicial),
      galeria!.id,
      tenantId,
    ]).catch(() => {});
  }

  /* Uma linha por capítulo, na ordem em que a pessoa marcou. `garantirSecoes`
     já ignora nome repetido e vazio — ver lib/secoes.ts. */
  const capitulos = String(form.get("capitulos") ?? "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);
  if (capitulos.length > 0) {
    await garantirSecoes(galeria!.id, tenantId, capitulos).catch(() => []);
  }

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

  /*
   * PUBLICAR A GALERIA PUBLICA A APARÊNCIA PENDENTE JUNTO.
   *
   * Duas usuárias seguidas escolheram o tema claro, viram a prévia clara e
   * entregaram a galeria escura — o rascunho nunca foi publicado. Ver
   * `promoverRascunhoSePendente`, que explica por que isso não desfaz a
   * separação rascunho/publicado.
   *
   * Só ao LIGAR: tirar do ar não é hora de mexer no desenho de nada.
   */
  if (publicada === "1") {
    await promoverRascunhoSePendente(galeriaId, tenantId);
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

    /*
     * ── O LEMBRETE VAI JUNTO, NA MESMA INSTRUÇÃO (24/09/2026) ─────────────
     *
     * Juan: "ao colocar a senha, ela some e eu não sei mais qual a senha". O
     * hash é irreversível de propósito e continua sendo a AUTORIDADE — quem
     * confere quem entra na galeria é ele. Esta segunda coluna existe só para
     * a tela do fotógrafo poder mostrar o que ele digitou, e vai cifrada com o
     * segredo do servidor (ver `lib/senha-da-galeria.ts`).
     *
     * Escrever os dois no MESMO `update` não é economia, é correção: se um
     * gravasse sem o outro, a tela mostraria uma senha que não abre a galeria
     * — pior que não mostrar nada. Tirar a senha zera os dois pelo mesmo
     * motivo.
     */
    valores.push(senha ? cifrarSenha(senha) : null);
    campos.push(`senha_cifrada = $${valores.length}`);
  }

  if (campos.length === 0) return;

  valores.push(galeriaId, tenantId);
  await consultar(
    `update galerias set ${campos.join(", ")}, atualizado_em = now()
      where id = $${valores.length - 1} and tenant_id = $${valores.length}`,
    valores,
  );

  /* Publicar e despublicar são o evento que este canal existe para contar: é o
   * momento em que o link do casal começa (ou deixa) de abrir. Vai depois da
   * gravação, sempre — avisar sobre o que ainda não está no banco é prometer o
   * que pode não acontecer. */
  if (publicada !== null) await avisarEntrega(galeriaId);

  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/**
 * OS E-MAILS DA GALERIA (migração 059) — configuração, fila e cancelamento.
 *
 * Nenhuma destas três manda e-mail. Elas gravam a INTENÇÃO; quem manda é o
 * script diário (`scripts/enviar-emails-da-galeria.mjs`). A separação é o que
 * torna o reenvio impossível e o que permite ao fotógrafo ver a fila antes de
 * qualquer coisa chegar na caixa do casal.
 */
export async function salvarEmailConfigAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não identificada." };

  const { lerTemplate } = await import("@/config/email-da-galeria");
  const lembretes = form.get("lembretes") === "1";
  const template = lerTemplate(String(form.get("template") ?? ""));
  const mensagem = String(form.get("mensagem") ?? "").trim().slice(0, 600) || null;

  await consultar(
    `update galerias
        set email_lembretes = $1, email_template = $2, email_mensagem = $3, atualizado_em = now()
      where id = $4 and tenant_id = $5`,
    [lembretes, template, mensagem, galeriaId, tenantId],
  );

  /*
   * DESLIGAR OS LEMBRETES TIRA O QUE AINDA NÃO SAIU.
   *
   * Sem isto, desligar a chave não desligaria nada: a fila já estava gravada, e
   * o script diário continuaria mandando "faz seis meses" para quem o fotógrafo
   * acabou de dizer que não quer mais incomodar. O e-mail já enviado fica — ele
   * não se desfaz, e tirar a linha dele faria a tela mentir sobre o que o casal
   * recebeu.
   */
  if (!lembretes) {
    const { cancelarPendentes } = await import("@/lib/emails-da-galeria");
    await cancelarPendentes(galeriaId, tenantId, [
      "dia_do_evento",
      "feedback",
      "relembrar",
      "um_ano",
    ]);
  }

  revalidatePath(`/painel/galerias/${galeriaId}/entrega`);
  return {};
}

/**
 * Põe a entrega (e os lembretes, se ligados) na fila.
 *
 * O campo é texto livre, uma linha por pessoa, porque é assim que o fotógrafo
 * tem os endereços: copiados do WhatsApp ou do contrato. Aceita
 * `Ana <ana@exemplo.com>` para o e-mail poder dizer "Oi, Ana" — o formato que
 * todo cliente de e-mail do mundo já usa, em vez de dois campos por pessoa.
 */
export async function agendarEmailsAction(
  form: FormData,
): Promise<{ agendados: number; erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { agendados: 0, erro: "Galeria não identificada." };

  const { agendarEmails } = await import("@/lib/emails-da-galeria");
  const destinatarios = String(form.get("destinatarios") ?? "")
    .split(/[\n,;]+/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const comNome = linha.match(/^(.*?)<([^>]+)>$/);
      return comNome
        ? { nome: comNome[1].trim().replace(/^"|"$/g, "") || null, email: comNome[2].trim() }
        : { nome: null, email: linha };
    });

  if (destinatarios.length === 0) {
    return { agendados: 0, erro: "Escreva pelo menos um e-mail." };
  }

  const r = await agendarEmails(galeriaId, tenantId, destinatarios);
  revalidatePath(`/painel/galerias/${galeriaId}/entrega`);
  return r;
}

/** Cancela tudo o que ainda não saiu desta galeria. O enviado fica. */
export async function cancelarEmailsAction(
  form: FormData,
): Promise<{ cancelados: number; erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { cancelados: 0, erro: "Galeria não identificada." };

  const { cancelarPendentes } = await import("@/lib/emails-da-galeria");
  const cancelados = await cancelarPendentes(galeriaId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}/entrega`);
  return { cancelados };
}

/**
 * A CONFIGURAÇÃO DO RECADO DO CLIENTE (migração 058).
 *
 * Fica fora de `salvarPublicacaoAction` porque não é controle de entrega: é o
 * que a aba Recados monta. E fica fora da APARÊNCIA pelos três motivos da
 * migração — aparência tem rascunho (o fotógrafo editaria o convite, não
 * publicaria, e o casal leria o texto velho), vira padrão do estúdio e vira
 * preset. Decisão de coletar dado pessoal não anda de carona num botão de
 * salvar visual.
 *
 * Devolve `{ erro }` pela mesma razão de `salvarAparenciaAction`: grava sozinha,
 * e quem salva sozinho tem de avisar quando não conseguiu.
 */
export async function salvarRecadoConfigAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não identificada." };

  const { lerPerguntas, TETO_DO_CONVITE } = await import("@/lib/recados");

  let perguntas: string[] = [];
  try {
    perguntas = lerPerguntas(JSON.parse(String(form.get("perguntas") ?? "[]")));
  } catch {
    return { erro: "Não entendi a lista de perguntas." };
  }

  const ativo = form.get("ativo") === "1";
  const estrelas = form.get("estrelas") === "1";
  /*
   * O ESTADO INVÁLIDO QUE A TELA NÃO PODE GRAVAR EM SILÊNCIO: estrelas ligadas
   * sem pergunta nenhuma montada é um formulário vazio na entrega de um
   * casamento. Avisa em vez de gravar — o fotógrafo ligaria num sábado e
   * descobriria na segunda que não pedia nada.
   */
  if (estrelas && perguntas.length === 0) {
    return { erro: "Escreva pelo menos uma pergunta antes de ligar as notas." };
  }

  const convite = String(form.get("convite") ?? "").trim().slice(0, TETO_DO_CONVITE) || null;

  await consultar(
    `update galerias
        set recado_ativo = $1, recado_estrelas = $2, recado_convite = $3,
            recado_perguntas = $4::jsonb, atualizado_em = now()
      where id = $5 and tenant_id = $6`,
    [ativo, estrelas, convite, JSON.stringify(perguntas), galeriaId, tenantId],
  );

  revalidatePath(`/painel/galerias/${galeriaId}/recados`);
  return {};
}

/** Salva a aparência. Valida antes de gravar — o JSON vem do navegador. */
/**
 * Grava a aparência. Devolve `{ erro }` em vez de nada.
 *
 * Enquanto havia botão "Salvar", devolver void bastava: quem apertava via o
 * botão voltar de "Salvando…" e conferia na prévia. Com o salvamento automático
 * ninguém aperta nada — e uma falha em silêncio vira o fotógrafo escolhendo a
 * aparência, saindo da tela e descobrindo dias depois que o cliente viu outra
 * coisa. Quem não avisa não pode salvar sozinho.
 */
export async function salvarAparenciaAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não identificada." };

  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return { erro: "Não consegui ler a aparência escolhida." };
  }

  const { ok } = await publicarAparencia(galeriaId, tenantId, bruto);
  if (!ok) return { erro: "Esta galeria não é sua, ou não existe mais." };

  revalidatePath(`/painel/galerias/${galeriaId}`);
  return {};
}

/**
 * Guarda a escolha que o fotógrafo ainda está experimentando.
 *
 * Grava sozinho, a cada mudança, e NÃO muda a galeria que o cliente está vendo.
 * É o que devolve ao editor a virtude que o salvamento automático tinha — nada
 * se perde ao sair da tela — sem devolver o defeito dele, que era publicar cada
 * passo do caminho. Ver `lib/aparencia-galeria.ts`.
 *
 * Não revalida caminho nenhum: rascunho não muda página que alguém esteja
 * vendo, e revalidar a cada tecla seria trabalho jogado fora.
 */
/**
 * PUBLICAR AS ALTERAÇÕES DE UMA GALERIA QUE JÁ ESTÁ NO AR.
 *
 * Felipe, 16/09/2026: "aqui, para poder ver a galeria, estamos precisando tirar
 * do ar e publicar novamente. Talvez um botão republicar com as atualizações ou
 * algo assim corrigiria."
 *
 * Ele descreveu o remédio junto com a queixa, e a queixa era de um buraco de
 * verdade. O cabeçalho tinha "Publicar galeria" enquanto ela fosse RASCUNHO, e
 * publicar promovia a aparência pendente junto (ver
 * `promoverRascunhoSePendente`). Depois de publicada, aquele botão virava
 * "tirar do ar" — e a única forma de promover um rascunho de aparência pelo
 * cabeçalho passou a ser DESPUBLICAR e publicar de novo, que é literalmente o
 * que eles estavam fazendo. Enquanto isso o link do casal ficava fora do ar.
 *
 * O caminho pelo Design existia e continua existindo; o que faltava era ele
 * existir de onde a pessoa está quando vê o aviso.
 */
/**
 * Guarda a aparência de agora como o padrão do estúdio.
 *
 * Felipe, 16/09/2026: "adicionar algum método de 'salvar padrão criado', para
 * sempre se repetir na hora do design da capa".
 *
 * Não mexe em galeria nenhuma — nem nesta. É uma decisão sobre o que vem
 * DEPOIS: a próxima galeria nasce assim. Mexer nas existentes seria reescrever
 * entregas já feitas a partir de um botão que diz "salvar".
 */
export async function salvarPadraoDoEstudioAction(form: FormData): Promise<{ ok?: string; erro?: string }> {
  const tenantId = await exigirTenant();
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return { erro: "Não consegui ler a aparência escolhida." };
  }
  await salvarPadraoDoEstudio(tenantId, bruto);
  /* O recado diz ONDE ele ficou. Salvar e não saber onde procurar depois foi
     a queixa de 26/09/2026. */
  return { ok: "Salvo. Está em Estilos como “Meu padrão”, e toda galeria nova vai nascer assim." };
}

/** Esquece o padrão: a galeria nova volta a nascer com o desenho da casa. */
export async function esquecerPadraoDoEstudioAction(): Promise<{ ok?: string }> {
  const tenantId = await exigirTenant();
  await esquecerPadraoDoEstudio(tenantId);
  return { ok: "As galerias novas voltam a nascer com o design padrão." };
}

/*
 * ── OS ESTILOS DO ESTÚDIO (28/09/2026) ──────────────────────────────────────
 *
 * Juan: "Ela pode salvar até 5 padrões próprios e dar nome pra eles. Eu criei
 * uns 3 que eu gostei, mas só pode salvar um." As regras (limite, nome, dono)
 * moram em `lib/estilos-do-estudio.ts`; estas são as cascas da tela. Todas
 * devolvem a lista inteira atualizada, para a tela não ter de adivinhar.
 */
type RespostaDosEstilos = { ok?: string; erro?: string; estilos?: EstiloDoEstudio[] };

export async function salvarEstiloAction(form: FormData): Promise<RespostaDosEstilos> {
  const tenantId = await exigirTenant();
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return { erro: "Não consegui ler a aparência escolhida." };
  }
  const r = await salvarEstilo(tenantId, form.get("nome"), bruto);
  if (!r.ok) return { erro: r.erro };
  return { ok: "Salvo em Meus estilos.", estilos: r.estilos };
}

export async function renomearEstiloAction(form: FormData): Promise<RespostaDosEstilos> {
  const tenantId = await exigirTenant();
  const r = await renomearEstilo(tenantId, String(form.get("id") ?? ""), form.get("nome"));
  if (!r.ok) return { erro: r.erro };
  return { ok: "Nome trocado.", estilos: r.estilos };
}

export async function apagarEstiloAction(form: FormData): Promise<RespostaDosEstilos> {
  const tenantId = await exigirTenant();
  const r = await apagarEstilo(tenantId, String(form.get("id") ?? ""));
  if (!r.ok) return { erro: r.erro };
  return { ok: "Estilo apagado. Nenhuma galeria mudou.", estilos: r.estilos };
}

/** Faz do estilo o padrão das galerias novas. Não mexe em galeria nenhuma. */
export async function tornarEstiloPadraoAction(
  form: FormData,
): Promise<{ ok?: string; erro?: string; padrao?: Aparencia }> {
  const tenantId = await exigirTenant();
  const aparencia = await tornarEstiloPadrao(tenantId, String(form.get("id") ?? ""));
  if (!aparencia) return { erro: "Esse estilo não existe mais." };
  return { ok: "Pronto: toda galeria nova vai nascer com este estilo.", padrao: aparencia };
}

export async function publicarAlteracoesAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não identificada." };

  const promoveu = await promoverRascunhoSePendente(galeriaId, tenantId);
  /* Sem rascunho não há erro nenhum: alguém publicou pelo Design enquanto esta
     aba estava aberta, e o resultado é o que a pessoa queria. O `refresh` do
     cliente some com o aviso. */
  if (promoveu) {
    revalidatePath(`/painel/galerias/${galeriaId}`);
    revalidatePath(`/painel/galerias/${galeriaId}/design`);
  }
  return {};
}

export async function salvarRascunhoAparenciaAction(
  form: FormData,
): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não identificada." };

  let bruto: unknown;
  try {
    bruto = JSON.parse(String(form.get("aparencia") ?? "{}"));
  } catch {
    return { erro: "Não consegui ler a aparência escolhida." };
  }

  const { ok } = await gravarRascunho(galeriaId, tenantId, bruto);
  return ok ? {} : { erro: "Esta galeria não é sua, ou não existe mais." };
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

/**
 * Define a foto de frente da pasta (capítulo) em que ela está — o formato
 * Pastas mostra essa capa. Ver `definirCapaDaPasta`.
 */
export async function definirCapaDaPastaAction(form: FormData): Promise<{ ok: boolean }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const mediaId = String(form.get("media_id") ?? "");
  if (!galeriaId || !mediaId) return { ok: false };
  const { ok, chaveAntiga } = await definirCapaDaPasta(galeriaId, tenantId, mediaId);
  /* A imagem enviada que acabou de perder a vez sai do bucket: arquivo pago que
     nenhuma linha cita é órfão, e desde 02/10 a varredura o PRESERVA em vez de
     recolher. */
  if (chaveAntiga) {
    const { apagarObjeto } = await import("@/lib/r2");
    await apagarObjeto(chaveAntiga).catch((e) =>
      console.error("[capa da pasta] a imagem enviada pode ter ficado no bucket:", e),
    );
  }
  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath(`/painel/galerias/${galeriaId}/design`);
  return { ok };
}

/**
 * As fotos de uma pasta, uma página por vez, para escolher a capa dela na aba
 * Design. Ver `fotosDaPasta` em `lib/entrega-no-design.ts`.
 */
export async function fotosDaPastaAction(
  galeriaId: string,
  secaoId: string,
  desde: number,
): Promise<{ fotos: FotoDaPasta[]; mais: boolean }> {
  const tenantId = await exigirTenant();
  if (!galeriaId || !secaoId) return { fotos: [], mais: false };
  return fotosDaPasta(galeriaId, tenantId, secaoId, Number(desde) || 0);
}

/**
 * O nome do vídeo na tela do Stream (migração 055). Vazio volta ao nome
 * tirado do arquivo. Ver `definirTituloDoVideo`.
 */
export async function renomearVideoAction(form: FormData): Promise<{ ok: boolean }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const mediaId = String(form.get("media_id") ?? "");
  if (!galeriaId || !mediaId) return { ok: false };
  const ok = await definirTituloDoVideo(galeriaId, tenantId, mediaId, String(form.get("titulo") ?? ""));
  revalidatePath(`/painel/galerias/${galeriaId}`);
  return { ok };
}

/**
 * Os vídeos desta galeria que ainda tocam o original, com o endereço para o
 * navegador converter a versão leve. Ver `lib/videos-para-preparar.ts`.
 */
export async function videosParaPrepararAction(galeriaId: string) {
  const tenantId = await exigirTenant();
  if (!galeriaId) return [];
  return videosParaPreparar(galeriaId, tenantId);
}

// --- seleção do álbum -------------------------------------------------------

/**
 * Limite e prazo da escolha do cliente.
 *
 * Campo vazio significa "sem regra", não zero: quem não quer limite deixa em
 * branco, e o banco tem um `check` que recusa limite <= 0 caso algo passe daqui.
 */
export async function salvarRegrasSelecaoAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");

  const limiteBruto = String(form.get("limite") ?? "").trim();
  const limite = limiteBruto ? Number(limiteBruto) : null;
  if (limite !== null && (!Number.isFinite(limite) || limite < 1)) {
    return { erro: "O limite precisa ser um número maior que zero — ou deixe em branco." };
  }

  const prazoBruto = String(form.get("prazo") ?? "").trim();
  /* `<input type=date>` manda "2026-09-30", que vira meia-noite UTC — no Brasil
   * isso é 21h do dia ANTERIOR, e a seleção fecharia um dia antes do combinado.
   * O fim do dia local é o que a data significa para quem digitou. */
  const prazo = prazoBruto ? new Date(`${prazoBruto}T23:59:59`) : null;
  if (prazo !== null && Number.isNaN(prazo.getTime())) {
    return { erro: "Data inválida." };
  }

  await definirRegrasSelecao(galeriaId, tenantId, { limite, prazo });
  revalidatePath(`/painel/galerias/${galeriaId}`);
  return {};
}

/** Reabre a escolha que o cliente encerrou. Cliente muda de ideia, e é normal. */
export async function reabrirSelecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  await reabrirSelecao(galeriaId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

// --- capítulos --------------------------------------------------------------

export async function criarSecaoAction(form: FormData): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const nome = String(form.get("nome") ?? "");
  const criada = await criarSecao(galeriaId, tenantId, nome);
  revalidatePath(`/painel/galerias/${galeriaId}`);

  /* `criarSecao` devolve null quando o nome está vazio ou já existe (ver
   * lib/secoes.ts). Sem esta mensagem a recusa é MUDA: o campo limpa, nada
   * aparece na lista, e o fotógrafo fica clicando achando que travou. Recusar em
   * silêncio é o defeito que a checagem de repetido teria criado. */
  if (!criada && nome.trim()) {
    return { erro: `Já existe um capítulo chamado “${nome.trim()}”.` };
  }
  return {};
}

/*
 * Aqui morava `criarCapitulosSugeridosAction`, que criava os seis capítulos de
 * um casamento num clique. Ela saiu em 29/09/2026 — ver `CAPITULOS_SUGERIDOS`
 * em `lib/secoes.ts`. As sugestões continuam na tela; cada uma passa por
 * `criarSecaoAction`, uma de cada vez.
 */

/**
 * Garante os capítulos que o envio de pasta encontrou e devolve os ids.
 *
 * Chamada UMA vez por envio, antes do primeiro arquivo subir: o envio precisa
 * saber em qual capítulo carimbar cada foto, e descobrir isso arquivo a arquivo
 * seriam centenas de idas ao servidor numa pasta de casamento.
 *
 * Recebe os nomes em JSON e não em campos de formulário porque a ordem importa
 * (é a ordem das pastas, que é a ordem da narrativa) e `FormData` com chaves
 * repetidas é um jeito ruim de carregar uma lista ordenada.
 */
export async function garantirSecoesAction(
  galeriaId: string,
  nomes: string[],
): Promise<{ nome: string; id: string }[]> {
  const tenantId = await exigirTenant();
  /* Teto de segurança: uma pasta com centenas de subpastas é engano do
   * fotógrafo (ou pasta errada arrastada), não um casamento com 300 capítulos.
   * Sem isto, um clique errado criaria centenas de linhas em `secoes`. */
  const capitulos = await garantirSecoes(galeriaId, tenantId, nomes.slice(0, 50));
  revalidatePath(`/painel/galerias/${galeriaId}`);
  return capitulos;
}

export async function renomearSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await renomearSecao(String(form.get("secao_id") ?? ""), tenantId, String(form.get("nome") ?? ""));
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

/**
 * Renomeia o grupo das fotos sem capítulo — o que a galeria mostra como
 * "Outras fotos" enquanto ninguém escrever outra coisa.
 *
 * Pedido do Juan em 18/09/2026. Campo vazio volta ao padrão; ver
 * `renomearGrupoSolto`.
 */
export async function renomearGrupoSoltoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  await renomearGrupoSolto(galeriaId, tenantId, String(form.get("nome") ?? ""));
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

export async function apagarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  await apagarSecao(String(form.get("secao_id") ?? ""), tenantId);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

/**
 * Apaga todos os capítulos da galeria — a saída de quem criou sem querer.
 *
 * Nenhuma foto some: `medias.secao_id` é `on delete set null`, então elas
 * voltam para "sem capítulo". Ver `apagarTodasAsSecoes` em `lib/secoes.ts`,
 * onde está escrito por que isto pode existir.
 *
 * A confirmação é da TELA, e não desta ação: quem chama a ação já decidiu.
 */
export async function apagarTodosOsCapitulosAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const quantos = await apagarTodasAsSecoes(galeriaId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}`);
  if (quantos === 0) return { erro: "Não havia capítulo nenhum para apagar." };
  return {};
}

/**
 * Reordena as fotos de UM capítulo por um critério.
 *
 * Felipe, 16/09/2026: "poder organizar por ordem de upload/adição // por ordem
 * cronológica // por nome A-Z // por nome Z-A".
 *
 * `secao_id` vazio é o grupo das fotos SEM capítulo — ele aparece na mesma
 * lista da tela e tem o mesmo direito de ser ordenado.
 */
export async function ordenarFotosDaSecaoAction(form: FormData): Promise<{ aviso?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const secaoId = String(form.get("secao_id") ?? "") || null;
  const criterio = String(form.get("criterio") ?? "") as OrdemDasFotos;
  if (!ORDENS_DAS_FOTOS.some((o) => o.id === criterio)) return {};

  const r = await ordenarFotosDaSecao(galeriaId, tenantId, secaoId, criterio);
  revalidatePath(`/painel/galerias/${galeriaId}`);
  if (!r.ok) return {};

  /*
   * O aviso é honesto sobre o que a ordem cronológica conseguiu.
   *
   * Foto sem data da câmera cai na data de ENVIO — vídeo, PNG, foto exportada
   * sem metadados e tudo que subiu antes da migração 035. Ordenar 600 fotos e
   * não dizer que 200 delas foram pelo envio é entregar uma sequência que
   * parece cronológica e não é.
   */
  if (r.semData > 0) {
    return {
      aviso:
        `${r.semData} de ${r.quantas} ${r.semData === 1 ? "foto não tem" : "fotos não têm"} a data ` +
        `da câmera e ${r.semData === 1 ? "entrou" : "entraram"} pela ordem de envio. ` +
        `Fotos enviadas antes de 16/09/2026 não guardaram essa data.`,
    };
  }
  return {};
}

export async function moverSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const direcao = form.get("direcao") === "cima" ? "cima" : "baixo";
  await moverSecao(String(form.get("secao_id") ?? ""), tenantId, direcao);
  revalidatePath(`/painel/galerias/${form.get("galeria_id")}`);
}

/**
 * A ordem inteira dos capítulos, como ficou depois de arrastar.
 *
 * Carol pediu em 11/09/2026: com sete capítulos, subir a "Festa" ao topo eram
 * seis cliques na seta e seis recarregamentos. A lista chega separada por
 * vírgula porque é o que cabe num FormData sem inventar formato.
 *
 * Nada do que vem aqui é usado sem passar pelo banco — `reordenarSecoes`
 * amarra cada id à galeria e ao tenant antes de gravar.
 */
export async function reordenarSecoesAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const ids = String(form.get("ordem") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  await reordenarSecoes(galeriaId, tenantId, ids);
  revalidatePath(`/painel/galerias/${galeriaId}`);
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
  /*
   * `unknown` e não `Ciclo`: isto vem da tela, atravessando uma server action, e
   * ali o tipo é promessa do cliente. `cicloDe` fecha a lista, e o lado seguro é
   * o MENSAL — o anual reserva doze meses de custo contra dez de preço, e
   * reservar de menos seria pagar sócio com o dinheiro da fatura da Backblaze.
   */
  cicloBruto: unknown = "mensal",
  /*
   * A escolha crua da tela, não o `billingType`. Traduzir aqui, e não no
   * componente, é o que garante a tradução: o cliente pode mandar o que quiser,
   * e `formaDaAssinatura` fecha a lista — lixo cai em UNDEFINED, que é o lado
   * de NÃO guardar o cartão de quem não pediu. Ver `config/forma-assinatura.ts`.
   */
  escolhaDaForma?: unknown,
  /* O tamanho escolhido no formulário. Ausente → o plano que a conta já tem. */
  planoIdBruto?: unknown,
): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();
  try {
    const recusa = await escolherPlanoAntesDeAssinar(tenantId, planoIdBruto, await ipDaRequisicao());
    if (recusa) return { erro: recusa };
    const r = await assinarTenant(tenantId, {
      documento,
      ciclo: cicloDe(cicloBruto),
      forma: formaDaAssinatura(escolhaDaForma),
    });
    if (!r.ok) return r.jaAssina ? undefined : { erro: r.erro };
    revalidatePath("/painel/conta");
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "nao consegui criar a assinatura" };
  }
}

/**
 * "Assinar o pacote": a Galeria daqui e o Atomatiza pela ponte, no mesmo
 * clique. A ordem e as regras estão em `lib/pacote.ts` e `docs/pacote.md`.
 *
 * `galeriaAssinada` avisa a tela que, mesmo com erro, a assinatura daqui
 * nasceu — e a página precisa recarregar para mostrar a fatura.
 */
export async function assinarPacoteAction(
  documento: string,
  cicloBruto: unknown,
  escolhaDaForma: unknown,
  faixaBruta: unknown,
  aceitouTermos: boolean,
  planoIdBruto?: unknown,
): Promise<{ erro?: string; galeriaAssinada?: boolean; contaNova?: boolean }> {
  const tenantId = await exigirTenant();
  if (!ehFaixaAtomatiza(faixaBruta)) return { erro: "Escolha a faixa do Atomatiza." };
  try {
    const recusa = await escolherPlanoAntesDeAssinar(tenantId, planoIdBruto, await ipDaRequisicao());
    if (recusa) return { erro: recusa };
    const r = await assinarPacote(tenantId, {
      faixa: faixaBruta,
      ciclo: cicloDe(cicloBruto),
      forma: escolhaDaForma,
      documento,
      aceitouTermos: aceitouTermos === true,
    });
    revalidatePath("/painel/conta");
    if (!r.ok) return { erro: r.erro, galeriaAssinada: r.galeriaAssinada };
    return { contaNova: r.atomatiza.contaNova };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui assinar o pacote" };
  }
}

/** Quem já assina a Galeria acrescenta o Atomatiza, pela ponte. */
export async function acrescentarAtomatizaAction(
  cicloBruto: unknown,
  escolhaDaForma: unknown,
  faixaBruta: unknown,
  aceitouTermos: boolean,
): Promise<{ erro?: string }> {
  const tenantId = await exigirTenant();
  if (!ehFaixaAtomatiza(faixaBruta)) return { erro: "Escolha a faixa do Atomatiza." };
  try {
    const r = await acrescentarAtomatiza(tenantId, {
      faixa: faixaBruta,
      ciclo: cicloDe(cicloBruto),
      forma: escolhaDaForma,
      aceitouTermos: aceitouTermos === true,
    });
    revalidatePath("/painel/conta");
    return r.ok ? {} : { erro: r.erro };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui acrescentar o Atomatiza" };
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
  cotadoCentavos?: number | null,
): Promise<{ erro?: string; ok?: string; urlDaDiferenca?: string | null } | void> {
  const tenantId = await exigirTenant();

  /* O fluxo inteiro — a diferença proporcional, o cartão salvo ou a fatura, e
   * a volta atrás se o Asaas recusar — mora em `lib/troca-de-plano.ts`, onde
   * dá para testar sem sessão. Ver `config/troca-de-plano.ts` para a regra. */
  const r = await trocarPlano(tenantId, novoPlanoId, { ip: await ipDaRequisicao(), cotadoCentavos });
  if ("erro" in r) return { erro: r.erro };

  revalidatePath("/painel/conta");
  revalidatePath("/painel");
  return { ok: r.ok, urlDaDiferenca: r.diferenca && !r.diferenca.noCartao ? r.diferenca.url : null };
}

/**
 * Quanto a troca vai custar, antes do clique. A tela mostra isto na
 * confirmação — ninguém descobre a cobrança da diferença depois.
 */
export async function cotarTrocaDePlanoAction(novoPlanoId: string): Promise<
  | { erro: string }
  | {
      tipo: "subida" | "descida";
      diferencaCentavos: number;
      cobrar: boolean;
      ate: string | null;
      precoNovoCentavos: number;
      anual: boolean;
      cartao: string | null;
    }
> {
  const tenantId = await exigirTenant();
  const plano = planoPorId(novoPlanoId);
  if (!plano) return { erro: "Plano inválido." };
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  try {
    const c = await cotarTroca(tenant, plano);
    return {
      tipo: c.cotacao.tipo,
      diferencaCentavos: c.cotacao.diferencaCentavos,
      cobrar: c.cotacao.cobrar,
      ate: c.cotacao.ate?.toISOString() ?? null,
      precoNovoCentavos: c.precoNovoCentavos,
      anual: c.ciclo === "anual",
      cartao: c.cartao,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui consultar a assinatura" };
  }
}

/**
 * Quanto voltaria se a conta cancelasse agora — para a tela explicar ANTES de
 * a pessoa confirmar. A regra é `config/devolucao.ts`.
 */
export async function cotarCancelamentoAction(): Promise<
  | { erro: string }
  | {
      regra: "arrependimento" | "proporcional" | "nada";
      devolverCentavos: number;
      mesesUsados: number;
      /** O fim do período pago, só se ainda estiver no futuro. */
      usoAte: string | null;
      prazoDaDevolucao: string;
    }
> {
  const tenantId = await exigirTenant();
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (!tenant.asaas_assinatura_id) return { erro: "Não há assinatura ativa para cancelar." };
  if (tenant.pacote_atomatiza_id) return { erro: RECADO_DO_PACOTE };
  try {
    const c = await cotarCancelamento(tenant);
    return {
      regra: c.regra,
      devolverCentavos: c.devolverCentavos,
      mesesUsados: c.mesesUsados,
      usoAte:
        tenant.pago_ate && new Date(tenant.pago_ate).getTime() > Date.now()
          ? new Date(tenant.pago_ate).toISOString()
          : null,
      prazoDaDevolucao: PRAZO_DA_DEVOLUCAO,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui consultar o Asaas" };
  }
}

/**
 * Cancela a assinatura.
 *
 * O `cancelarAssinatura` existia no código desde o início e nunca foi chamado
 * por ninguém — não havia como cancelar pelo painel, só escrevendo para o
 * suporte. Os Termos prometem "cancele quando quiser"; agora é verdade.
 *
 * Duas saídas, e quem escolhe é a pessoa (30/09/2026):
 *
 * · SEM devolução — cancelar para a RENOVAÇÃO, não o acesso. `pago_ate` fica
 *   de pé: quem pagou doze meses e cancela no segundo continua enviando até o
 *   fim do período. Até 26/08/2026 o envio parava no mesmo instante — dinheiro
 *   recebido, serviço não entregue. `scripts/testar-periodo-pago.mjs` vigia.
 *
 * · COM devolução — quando `config/devolucao.ts` diz que sobra dinheiro (até 7
 *   dias, tudo; depois, o pago menos os meses começados). O dinheiro volta e o
 *   período acaba HOJE: `pago_ate` vira agora. Os dois juntos seriam pagar de
 *   volta um serviço que continua sendo prestado.
 *
 * `devolverCentavos` é o valor que a TELA mostrou. A cotação é refeita aqui, e
 * se o número mudou no meio do caminho (virou o dia, virou o mês), nada
 * acontece e a pessoa confirma de novo — ninguém aceita um valor e recebe
 * outro.
 *
 * O conteúdo NÃO é apagado agora. A conta encerrada guarda tudo no ar por
 * `RETENCAO_POR_EXTENSO` depois do fim do período, com avisos por e-mail
 * antes de apagar (`lib/contas-encerradas.ts`).
 */
export async function cancelarAssinaturaAction(
  devolverCentavos: number | null = null,
): Promise<{ erro?: string; ok?: string } | void> {
  const tenantId = await exigirTenant();

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (!tenant.asaas_assinatura_id) return { erro: "Não há assinatura ativa para cancelar." };
  if (tenant.pacote_atomatiza_id) return { erro: RECADO_DO_PACOTE };

  let devolucao: Awaited<ReturnType<typeof cotarCancelamento>> | null = null;
  if (devolverCentavos !== null) {
    try {
      devolucao = await cotarCancelamento(tenant);
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "não consegui consultar o Asaas" };
    }
    if (devolucao.devolverCentavos <= 0 || devolucao.regra === "nada" || !devolucao.cobrancaId) {
      return { erro: "Não há valor a devolver neste período. Nada foi cancelado — confira de novo." };
    }
    if (devolucao.devolverCentavos !== devolverCentavos) {
      return {
        erro: `O valor da devolução mudou para ${formatarReais(devolucao.devolverCentavos)}. Nada foi cancelado — confira e confirme de novo.`,
      };
    }
  }

  try {
    await cancelarAssinatura(tenant.asaas_assinatura_id);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui cancelar no Asaas" };
  }

  await consultar(
    `update tenants
        set status = 'cancelado', asaas_assinatura_id = null, combo_atomatiza = null,
            pago_ate = case when $2 then least(pago_ate, now()) else pago_ate end,
            atualizado_em = now()
      where id = $1`,
    [tenantId, devolucao !== null],
  );

  await registrarEvento({
    tenantId,
    estudio: tenant.nome_estudio,
    ator: "estudio",
    acao: ACOES.ASSINATURA_CANCELADA,
    alvoTipo: "conta",
    alvoId: tenantId,
    detalhe: {
      plano: tenant.plano_id,
      assinaturaAsaas: tenant.asaas_assinatura_id,
      /* Guardado porque é a resposta de uma reclamação previsível — "cancelei e
       * fui cortado na hora". Sem isto, o banco depois só mostra o status. */
      periodoPagoAte: tenant.pago_ate,
      comDevolucao: devolucao !== null,
    },
    ip: await ipDaRequisicao(),
  });

  revalidatePath("/painel/conta");

  if (devolucao && devolucao.cobrancaId && devolucao.regra !== "nada") {
    await anotarDevolucao({
      tenantId,
      estudio: tenant.nome_estudio,
      cobrancaId: devolucao.cobrancaId,
      centavos: devolucao.devolverCentavos,
      regra: devolucao.regra,
    });
    await registrarEvento({
      tenantId,
      estudio: tenant.nome_estudio,
      ator: "estudio",
      acao: ACOES.DEVOLUCAO_PEDIDA,
      alvoTipo: "conta",
      alvoId: tenantId,
      detalhe: {
        cobranca: devolucao.cobrancaId,
        centavos: devolucao.devolverCentavos,
        regra: devolucao.regra,
        mesesUsados: devolucao.mesesUsados,
        mesCentavos: devolucao.mesCentavos,
        periodo: { inicio: devolucao.inicio?.toISOString() ?? null, fim: devolucao.fim?.toISOString() ?? null },
      },
      ip: await ipDaRequisicao(),
    });
    return {
      ok:
        `Assinatura cancelada. ${formatarReais(devolucao.devolverCentavos)} voltam para você em até ${PRAZO_DA_DEVOLUCAO}, ` +
        `pelo mesmo meio de pagamento. As galerias publicadas ficam no ar por mais ${RETENCAO_POR_EXTENSO}; ` +
        "antes de apagar qualquer coisa, avisamos por e-mail.",
    };
  }

  /* O recado diz até quando, e a data vem do banco, não de uma promessa: quem
   * cancelou no meio de um anual precisa saber que os meses pagos não sumiram. */
  const restante = situacaoDoTenant(
    { status: "cancelado", trial_ate: null, pago_ate: tenant.pago_ate },
    true,
  );
  if (restante.aviso) return { ok: restante.aviso };
  return {
    ok: `Assinatura cancelada. Suas galerias publicadas ficam no ar por mais ${RETENCAO_POR_EXTENSO}; antes de apagar qualquer coisa, avisamos por e-mail.`,
  };
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

  // O cofre tira a galeria do ar sem ninguém ter despublicado nada.
  await avisarEntrega(galeriaId);
  revalidatePath(`/painel/galerias/${galeriaId}`);
  revalidatePath("/painel");
}

export async function reativarAction(form: FormData): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const r = await reativar(galeriaId, tenantId);
  if (!r.ok) return { erro: r.erro };

  await avisarEntrega(galeriaId);
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

export interface EstadoEndereco {
  erro?: string;
  ok?: string;
}

/**
 * Troca o endereço do estúdio, guardando o anterior como apelido.
 *
 * A regra inteira mora em `lib/endereco.ts`, testada sem servidor; aqui fica só
 * a sessão e o que a tela precisa saber. É de propósito: esta é a única ação do
 * painel que pode quebrar um link já entregue a um casal, e regra que não dá
 * para exercitar num teste acaba não sendo exercitada.
 *
 * Os quatro caminhos revalidados são os quatro lugares onde o endereço aparece.
 * Esquecer um deixaria a pessoa vendo o endereço antigo na tela depois de trocar
 * — e concluindo que não salvou.
 */
export async function trocarEnderecoAction(
  _estado: EstadoEndereco,
  form: FormData,
): Promise<EstadoEndereco> {
  const tenantId = await exigirTenant();
  const { trocarEndereco } = await import("@/lib/endereco");

  const r = await trocarEndereco(tenantId, String(form.get("endereco") ?? ""));
  if (r.erro) return { erro: r.erro };

  revalidatePath("/painel/conta");
  revalidatePath("/painel");
  revalidatePath("/painel/site");
  revalidatePath(`/e/${r.slug}`);

  return {
    ok: `Endereço trocado para /${r.slug}. O anterior continua abrindo e leva para cá — os links que você já entregou não quebram.`,
  };
}

// --- site do estúdio (a vitrine em /e/<slug>) -------------------------------

export interface EstadoSite {
  erro?: string;
  ok?: string;
}

/**
 * Grava o conteúdo da vitrine.
 *
 * O objeto inteiro passa por `lerSite` ANTES de virar JSON no banco. Não é
 * cinto e suspensório com a validação de cima: `lerSite` corta tamanho, joga
 * fora depoimento vazio e descarta chave que não existe no formato — então o
 * que entra no banco tem exatamente a forma que a página pública espera ler.
 * Sem esse funil, um campo novo no formulário poderia gravar uma chave que
 * `lerSite` ignora, e o fotógrafo veria "salvo" sem nada mudar na tela.
 *
 * WhatsApp e Instagram são conferidos aqui SEPARADAMENTE, antes, só para poder
 * dizer o que está errado: `lerSite` trata valor inválido como ausente (o que é
 * certo para a página pública, que não pode quebrar), e ausente em silêncio é
 * exatamente o que não serve num formulário.
 */
export async function salvarSiteAction(
  _estado: EstadoSite,
  form: FormData,
): Promise<EstadoSite> {
  const tenantId = await exigirTenant();
  const campo = (nome: string) => String(form.get(nome) ?? "").trim();

  const whatsappBruto = campo("whatsapp");
  const whatsapp = whatsappBruto ? normalizarWhatsapp(whatsappBruto) : "";
  if (whatsapp === null) {
    return { erro: "WhatsApp inválido. Use DDD + número, como (54) 99999-8888." };
  }

  const instagramBruto = campo("instagram");
  const instagram = instagramBruto ? normalizarInstagram(instagramBruto) : "";
  if (instagram === null) {
    return { erro: "Instagram inválido. Use só o usuário, como sirius.fotografia." };
  }

  const email = campo("email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { erro: "E-mail de contato inválido." };
  }

  /*
   * Os depoimentos chegam como JSON num campo escondido — a tela monta a lista
   * e serializa. Um `catch` que devolve erro em vez de deixar estourar: o campo
   * é escondido, então JSON quebrado aqui significa tela com defeito, e o
   * fotógrafo precisa ver isso em vez de uma página de erro do servidor.
   */
  let depoimentos: unknown;
  try {
    depoimentos = JSON.parse(form.get("depoimentos") ? String(form.get("depoimentos")) : "[]");
  } catch {
    return { erro: "Não consegui ler os depoimentos. Recarregue a página e tente de novo." };
  }

  const site = lerSite({
    ligado: form.get("ligado") === "on",
    frase: campo("frase"),
    selo: campo("selo"),
    capaGaleria: campo("capaGaleria"),
    sobreTitulo: campo("sobreTitulo"),
    sobre: String(form.get("sobre") ?? ""),
    citacao: campo("citacao"),
    citacaoAutor: campo("citacaoAutor"),
    depoimentosTitulo: campo("depoimentosTitulo"),
    depoimentos,
    contatoTitulo: campo("contatoTitulo"),
    contatoTexto: String(form.get("contatoTexto") ?? ""),
    whatsapp,
    instagram,
    email,
    tema: campo("tema"),
    tipografia: campo("tipografia"),
  });

  await consultar("update tenants set site = $1, atualizado_em = now() where id = $2", [
    JSON.stringify(site),
    tenantId,
  ]);

  revalidatePath("/painel/site");
  return { ok: site.ligado ? "Site salvo e no ar." : "Site salvo (ainda não publicado)." };
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
   * Evento de segurança: troca de senha derruba todas as outras sessões. Se
   * alguém perder acesso à conta, esta é a primeira linha a procurar — e o hash
   * do IP diz se veio do mesmo lugar de sempre. A senha em si nunca entra aqui,
   * nem a antiga nem a nova.
   */
  await registrarEvento({
    tenantId,
    ator: "estudio",
    acao: ACOES.SENHA_TROCADA,
    alvoTipo: "conta",
    alvoId: tenantId,
    detalhe: { outrasSessoesEncerradas: true },
    ip: await ipDaRequisicao(),
  });

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

  // Vai para a LIXEIRA, não some: o arquivo continua no bucket por 30 dias.
  // O apagarGaleria filtra por tenant_id também — id adivinhado não alcança galeria alheia.
  await apagarGaleria(tenantId, galeriaId);
  /* Vai para a lixeira: para o casal ela já não existe. Este é o aviso mais
   * importante de todos — sem ele o contrato lá continuaria mostrando "no ar"
   * com um link que devolve 404. */
  await avisarEntrega(galeriaId);
  revalidatePath("/painel");
  revalidatePath("/painel/conta");

  /*
   * O redirecionamento é PEDIDO por quem chama, não automático.
   *
   * Na tela da galeria ele é obrigatório: a página que a pessoa está olhando
   * acabou de virar lixeira, e ficar nela mostraria uma galeria fantasma. Na
   * lista da Conta seria o oposto — quem está apagando três galerias seria
   * expulso da tela na primeira, e teria de voltar duas vezes.
   *
   * O padrão é FICAR: sair da página é a decisão que precisa de motivo.
   */
  if (String(form.get("voltar") ?? "") === "1") redirect("/painel");
}

/** Tira a galeria da lixeira. Volta como rascunho — republicar é decisão de quem restaurou. */
/**
 * Apaga de vez, antes do prazo da lixeira — e é irreversível.
 *
 * A lixeira já protege do clique errado: 30 dias, e restaurar traz tudo. Esta
 * ação existe para o outro caso, que também é real: o fotógrafo que apagou por
 * engano do CLIENTE, ou que precisa liberar espaço agora e sabe exatamente o que
 * está fazendo. Sem ela, "apagar" não apaga — e quem quer o espaço de volta
 * hoje não tem caminho nenhum.
 *
 * Os arquivos são lidos ANTES do delete, dentro de `destruirGaleria` — com o
 * armazém de cada original e a capa. Depois não haveria como saber o que tirar
 * do armazém, e o arquivo viraria lixo invisível que só aparece na fatura.
 *
 * O filtro por `tenant_id` está na consulta, e não só na tela: id adivinhado
 * não alcança galeria alheia.
 */
export async function destruirGaleriaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const alvo = await consultarUm<{ id: string }>(
    `select g.id from galerias g
      where g.id = $1 and g.tenant_id = $2 and g.estado = 'lixeira'`,
    [galeriaId, tenantId],
  );
  /* Só destrói o que ESTÁ na lixeira. Sem essa condição, um formulário montado à
   * mão apagaria de vez uma galeria no ar, pulando os 30 dias inteiros. */
  if (!alvo) return;

  const { destruirGaleria } = await import("@/lib/tenants");
  await destruirGaleria(alvo.id, "estudio");

  revalidatePath("/painel");
  revalidatePath("/painel/conta");
}

export async function restaurarGaleriaAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  await restaurarGaleria(tenantId, galeriaId);
  /* Depois de restaurar, e não antes: `restaurarGaleria` pode LARGAR o vínculo
   * quando a referência já tem dona nova (ver lib/tenants.ts). Avisando depois,
   * a galeria sem vínculo simplesmente não gera aviso — que é o certo, porque
   * ela não representa mais aquele contrato. */
  await avisarEntrega(galeriaId);
  revalidatePath("/painel");
}

/* ── Chaves de API ─────────────────────────────────────────────────────────
 *
 * A credencial de quem não é navegador — plugin do Lightroom, script do próprio
 * fotógrafo. Ver docs/chave-de-api.md.
 */

export interface EstadoChave {
  erro?: string;
  /**
   * O segredo recém-criado, para a tela mostrar UMA vez.
   *
   * Ele existe só nesta resposta: o banco guardou o hash, e não há rota que o
   * devolva de novo. Se a pessoa fechar a página sem copiar, o caminho é revogar
   * e criar outra — que é o certo, e é o que a tela diz.
   */
  segredo?: string;
}

export async function criarChaveApiAction(
  _estado: EstadoChave,
  form: FormData,
): Promise<EstadoChave> {
  const tenantId = await exigirTenant();

  const nome = String(form.get("nome") ?? "").trim();
  if (!nome) return { erro: "Dê um nome à chave — “Lightroom do notebook”, por exemplo." };

  const escopo = form.get("escopo") === "leitura" ? "leitura" : "envio";

  /* Um teto por estúdio. Não é segurança — é higiene: lista de vinte chaves
   * ninguém audita, e chave que ninguém audita é chave que fica viva depois de
   * vazar. */
  const ativas = await listarChaves(tenantId);
  if (ativas.length >= 10) {
    return { erro: "Você já tem 10 chaves ativas. Revogue uma antes de criar outra." };
  }

  const chave = await gerarChave(tenantId, nome, escopo);
  revalidatePath("/painel/conta");
  return { segredo: chave.segredo };
}

export async function revogarChaveApiAction(form: FormData) {
  const tenantId = await exigirTenant();
  const id = String(form.get("chave_id") ?? "");
  if (!id) return;

  await revogarChave(id, tenantId);
  revalidatePath("/painel/conta");
}

/**
 * Desliga o canal de avisos deste estúdio.
 *
 * O canal é registrado por quem RECEBE (o Atomatiza, por `POST /api/avisos`),
 * mas quem desliga tem de poder ser o dono do estúdio, aqui, sem depender de o
 * outro sistema estar de pé — é a conta dele que está mandando coisa para fora.
 * É a mesma assimetria de "revogar chave": criar exige o fluxo, revogar é um
 * clique.
 *
 * Desligar NÃO quebra nada do outro lado: a ficha do contrato guarda o link
 * como dado copiado, e o botão "conferir" de lá continua resolvendo. O que se
 * perde é o retrato se atualizar sozinho — que é o que a tela explica antes de
 * a pessoa clicar.
 */
export async function desligarAvisosAction() {
  const tenantId = await exigirTenant();
  await removerCanal(tenantId);
  revalidatePath("/painel/conta");
}

// ── busca por rosto ──────────────────────────────────────────────────────────

/**
 * Liga a busca por rosto. É o ATO DE CONSENTIMENTO do fotógrafo (LGPD art.
 * 11): só chega aqui quem leu o texto e marcou que aceita — e o `aceito` é
 * conferido de novo, porque o formulário é do navegador.
 *
 * O evento registra QUANDO. É a resposta para "o estúdio consentiu?", que um
 * dia alguém pode perguntar.
 */
export async function ligarBuscaPorRostoAction(form: FormData): Promise<{ erro?: string } | void> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return { erro: "Galeria não informada." };
  if (form.get("aceito") !== "1") {
    return { erro: "Para ligar, é preciso aceitar as condições." };
  }

  const ok = await ligarRostos(galeriaId, tenantId);
  if (!ok) return { erro: "Galeria não encontrada." };

  await registrarEvento({
    tenantId,
    ator: "estudio",
    acao: ACOES.ROSTOS_LIGADOS,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    ip: await ipDaRequisicao(),
  });
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/**
 * Desliga E apaga os vetores. As duas coisas são uma só — ver `desligarRostos`.
 * O evento diz quantos foram apagados: é a prova de que o dado sumiu.
 */
export async function desligarBuscaPorRostoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  if (!galeriaId) return;

  const apagados = await desligarRostos(galeriaId, tenantId);
  await registrarEvento({
    tenantId,
    ator: "estudio",
    acao: ACOES.ROSTOS_DESLIGADOS,
    alvoTipo: "galeria",
    alvoId: galeriaId,
    detalhe: { rostosApagados: apagados },
    ip: await ipDaRequisicao(),
  });
  revalidatePath(`/painel/galerias/${galeriaId}`);
}

/**
 * As fotos que ainda não passaram pela medição, com o link da PRÉVIA de cada
 * uma — é o que o navegador do fotógrafo baixa para medir as fotos que já
 * estavam na galeria antes de a busca ser ligada.
 *
 * Prévia, não original: a prévia sai do R2, onde a saída não custa nada; o
 * original mora no B2 e cada byte lido é cobrado. O preço é que rosto pequeno
 * demais na prévia fica de fora — a tela avisa isso.
 */
export async function fotosSemRostoAction(
  galeriaId: string,
): Promise<{ id: string; url: string }[]> {
  const tenantId = await exigirTenant();
  const fotos = await fotosSemRosto(galeriaId, tenantId);
  return Promise.all(
    fotos.map(async (f) => ({
      id: f.id,
      url: await urlDaDerivada(f.chave_preview, f.chave, armazemDe(f.armazem), 3600),
    })),
  );
}

/**
 * Manda todas as fotos sem capítulo para um capítulo, de uma vez.
 *
 * Pedido do sócio em 04/09/2026: "as fotos subidas sem capítulo devem ir
 * obrigatoriamente para um capítulo. Ou organizar isso." Obrigar na hora do
 * envio seria atrito no pior momento — quem está subindo 600 fotos não quer
 * responder pergunta. Um botão que arruma depois resolve o mesmo, sem cobrar
 * nada de quem não se importa.
 */
export async function moverSoltasAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const secaoId = String(form.get("secao_id") ?? "");
  if (!galeriaId || !secaoId) return;

  await moverSoltasParaSecao(galeriaId, secaoId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}/fotos`);
}

/**
 * Arrastar uma foto para outra posição na aba Fotos.
 *
 * Pedido de 28/09/2026: encaixar as analógicas reveladas depois no lugar
 * cronológico certo, sem reenviar a galeria inteira na ordem nova. A conta mora
 * em `moverMediaNaOrdem`, e ela mexe só na POSIÇÃO — trocar de capítulo
 * continua sendo o "mover para".
 */
export async function moverFotoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const arrastado = String(form.get("arrastado") ?? "");
  const alvo = String(form.get("alvo") ?? "");
  if (!galeriaId || !arrastado || !alvo) return;

  const { moverMediaNaOrdem } = await import("@/lib/medias");
  await moverMediaNaOrdem(galeriaId, tenantId, arrastado, alvo);
  revalidatePath(`/painel/galerias/${galeriaId}/fotos`);
}

/**
 * Várias fotos de uma vez: o arrastar com várias marcadas, e os botões "para o
 * início" e "para o fim" da barra de seleção. Ver `moverBlocoNaOrdem`.
 */
export async function moverFotosAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const ids = String(form.get("media_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10_000);
  const destino = String(form.get("destino") ?? "");
  if (!galeriaId || ids.length === 0 || !destino) return;

  const { moverBlocoNaOrdem } = await import("@/lib/medias");
  await moverBlocoNaOrdem(galeriaId, tenantId, ids, destino);
  revalidatePath(`/painel/galerias/${galeriaId}/fotos`);
}

/**
 * ── MOVER PARA OUTRA GALERIA (08/10/2026) ─────────────────────────────────
 *
 * Uma aluna manda só as prévias do ensaio numa galeria e, quando o resto fica
 * pronto, leva essas fotos para a final — sem subir tudo de novo. A regra
 * inteira mora em `lib/mover-entre-galerias.ts`; aqui há a sessão, a conversão
 * do que veio do navegador e a revalidação.
 *
 * Duas leituras e uma gravação, e as leituras são ações (e não dados da página)
 * de propósito: a aba Fotos é a mais pesada do painel, e a lista de galerias do
 * estúdio só interessa a quem abre o modal.
 */
function escopoDoMovimento(bruto: unknown): EscopoDoMovimento | null {
  if (!bruto || typeof bruto !== "object") return null;
  const e = bruto as Record<string, unknown>;
  if (e.tipo === "soltas") return { tipo: "soltas" };
  if (e.tipo === "capitulo" && ehUuid(e.secaoId)) return { tipo: "capitulo", secaoId: e.secaoId };
  if (e.tipo === "ids" && Array.isArray(e.ids)) {
    const ids = e.ids.filter(ehUuid).slice(0, MAXIMO_POR_MOVIMENTO);
    return ids.length > 0 ? { tipo: "ids", ids } : null;
  }
  return null;
}

export async function galeriasParaMoverAction(origemId: string): Promise<DestinoPossivel[]> {
  const tenantId = await exigirTenant();
  if (!ehUuid(origemId)) return [];
  return galeriasParaMover(tenantId, origemId);
}

export async function opcoesDoDestinoAction(
  origemId: string,
  destinoId: string,
): Promise<OpcoesDoDestino | null> {
  const tenantId = await exigirTenant();
  return opcoesDoDestino(tenantId, origemId, destinoId);
}

export async function moverParaOutraGaleriaAction(dados: {
  origemId: string;
  destinoId: string;
  /** Nulo/vazio = "Outras fotos" do destino. */
  secaoDestinoId: string | null;
  escopo: unknown;
}): Promise<ResultadoDoMovimento> {
  const tenantId = await exigirTenant();
  const escopo = escopoDoMovimento(dados?.escopo);
  if (!escopo) return { ok: false, erro: "Não há fotos para mover." };

  const r = await moverMediasParaOutraGaleria({
    tenantId,
    origemId: String(dados.origemId ?? ""),
    destinoId: String(dados.destinoId ?? ""),
    secaoDestinoId: dados.secaoDestinoId ? String(dados.secaoDestinoId) : null,
    escopo,
  });
  if (r.ok) {
    /* As duas pontas mudaram: a que perdeu as fotos e a que as recebeu. */
    for (const id of [dados.origemId, dados.destinoId]) {
      revalidatePath(`/painel/galerias/${id}`);
      revalidatePath(`/painel/galerias/${id}/fotos`);
    }
  }
  return r;
}

/**
 * Chamada pelo envio quando a fila seca, se a pasta tinha arquivos que já
 * estavam na galeria: o que subiu agora volta para o meio dela, na ordem da
 * pasta. Ver `lib/encaixe-da-pasta.ts`.
 *
 * Sem `revalidatePath`: quem chama faz `router.refresh()` logo depois, e
 * revalidar aqui desenharia a página duas vezes (ver `grade-medias.tsx`).
 */
export async function encaixarNaOrdemDaPastaAction(
  galeriaId: string,
  lote: string,
  pasta: { nome: string; bytes: number }[],
): Promise<number> {
  const tenantId = await exigirTenant();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(galeriaId) || !uuid.test(lote) || !Array.isArray(pasta)) return 0;
  const lista = pasta
    .slice(0, 20_000)
    .filter((a) => typeof a?.nome === "string" && Number.isFinite(a?.bytes))
    .map((a) => ({ nome: a.nome, bytes: Number(a.bytes) }));
  const { encaixarNaOrdemDaPasta } = await import("@/lib/medias");
  return encaixarNaOrdemDaPasta(galeriaId, tenantId, lote, lista);
}

/**
 * O caminho de volta: as fotos do capítulo voltam a ser "sem capítulo".
 *
 * Par do `moverSoltasAction` acima, pedido em 28/09/2026. O capítulo continua
 * existindo — esvaziar não é apagar, e quem vai reorganizar quer o nome de pé.
 */
export async function esvaziarSecaoAction(form: FormData) {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const secaoId = String(form.get("secao_id") ?? "");
  if (!galeriaId || !secaoId) return;

  const { esvaziarSecao } = await import("@/lib/secoes");
  await esvaziarSecao(galeriaId, secaoId, tenantId);
  revalidatePath(`/painel/galerias/${galeriaId}/fotos`);
}

/**
 * Troca o endereço da galeria. O anterior deixa de abrir.
 *
 * A regra inteira mora em `lib/endereco-galeria.ts`, inclusive o que acontece
 * com o endereço que sai — nada, ele morre ali. Aqui só há a sessão, a
 * revalidação e o texto que a tela mostra.
 */
export async function trocarEnderecoGaleriaAction(
  _estado: { ok?: string; erro?: string },
  form: FormData,
): Promise<{ ok?: string; erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const pedido = String(form.get("slug") ?? "");
  if (!galeriaId) return { erro: "Galeria não encontrada." };

  const { trocarEnderecoDaGaleria } = await import("@/lib/endereco-galeria");
  const r = await trocarEnderecoDaGaleria(galeriaId, tenantId, pedido);
  if (!r.ok) return { erro: r.erro };

  revalidatePath(`/painel/galerias/${galeriaId}/entrega`);
  revalidatePath("/painel");
  return { ok: `Endereço agora é /${r.slug}.` };
}

/**
 * Apaga um endereço antigo da galeria: ele deixa de abrir.
 *
 * Felipe, 16/09/2026: "quando alterar o endereço da galeria, apagar o antigo" e
 * "pode apagar sempre o endereço antigo". A troca em si já não guarda apelido
 * nenhum; esta ação é para os que ficaram das trocas anteriores, e serve agora
 * em vez de esperar a próxima troca — o que importa quando o link vazou.
 */
export async function esquecerApelidoGaleriaAction(
  _estado: { ok?: string; erro?: string },
  form: FormData,
): Promise<{ ok?: string; erro?: string }> {
  const tenantId = await exigirTenant();
  const galeriaId = String(form.get("galeria_id") ?? "");
  const slug = String(form.get("slug") ?? "");
  if (!galeriaId || !slug) return { erro: "Endereço não identificado." };

  const { esquecerApelidoDaGaleria } = await import("@/lib/endereco-galeria");
  const r = await esquecerApelidoDaGaleria(galeriaId, tenantId, slug);
  if (!r.ok) return { erro: "Este endereço já não estava guardado." };

  revalidatePath(`/painel/galerias/${galeriaId}/entrega`);
  return { ok: `/${slug} deixou de abrir esta galeria.` };
}

// --- confirmação do e-mail ----------------------------------------------------

export interface EstadoReenvio {
  erro?: string;
  enviado?: boolean;
}

/**
 * Manda de novo o link de confirmação do e-mail (migração 045).
 *
 * Dois freios, porque cada clique aqui manda um e-mail de verdade, pago e
 * contado contra a reputação do domínio: um intervalo mínimo entre dois envios
 * — lido do banco, então vale mesmo depois de reiniciar o app — e o limite de
 * tentativas de sempre, para ninguém transformar o botão em disparador.
 */
export async function reenviarConfirmacaoAction(): Promise<EstadoReenvio> {
  const tenantId = await exigirTenant();
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  if (tenant.email_confirmado_em) return { enviado: true };

  const chave = `reenvio-confirmacao:${tenantId}`;
  const veredito = podeTentar(chave);
  if (!veredito.permitido) {
    return { erro: `Muitos pedidos seguidos. Tente de novo em ${emPalavras(veredito.esperarSeg!)}.` };
  }
  const recente = await consultarUm(
    "select 1 from confirmacoes_email where tenant_id = $1 and criado_em > now() - interval '1 minute'",
    [tenantId],
  );
  if (recente) return { erro: "Acabamos de mandar um link. Confira a caixa de entrada e o spam." };

  registrarErro(chave);
  const saiu = await enviarConfirmacao(tenant);
  if (!saiu) {
    return {
      erro: `Não conseguimos mandar o e-mail agora. Tente em alguns minutos — ou fale com a gente pelo WhatsApp ${marca.whatsappVisivel}.`,
    };
  }
  return { enviado: true };
}
