import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { consultar, consultarUm } from "./db";
import { criarTenant, buscarTenantPorEmail, type Tenant } from "./tenants";
import { gerarChave } from "./chaves-api";
import { criarPedido } from "./recuperacao";
import { enviarEmail, moldura } from "./email";
import { marca } from "@/config/marca";
import { PLANO_INICIAL } from "@/config/planos";

/**
 * PROVISIONAMENTO — o outro produto da casa cria a conta pelo fotógrafo.
 *
 * O aperto de mão normal (`GET /api/conta`) supõe que a conta daqui já existe:
 * quem tem a chave `ga_…` é o dono, e a posse é a prova. Isso resolve quem já
 * é cliente dos dois lados, e deixa de fora exatamente quem a gente quer
 * atrair — o fotógrafo que já usa o Atomatiza e ainda não tem galeria. Para
 * ele, ligar os dois significava preencher um segundo cadastro aqui, voltar
 * lá, gerar chave, colar. Quatro passos para dizer "sim".
 *
 * Aqui ele diz sim uma vez, e esta rota faz o resto.
 *
 * ── O QUE MUDA NA LEI DO PAREAMENTO, E O QUE NÃO MUDA ─────────────────────
 *
 * Muda que a posse da chave deixa de ser a ÚNICA prova: agora existe um
 * caminho em que a chave nasce já do lado de lá. O que substitui a prova é um
 * SEGREDO DE PLATAFORMA — não uma chave de estúdio —, e ele autoriza uma coisa
 * só: criar conta nova em teste. Não lê nada, não mexe em conta que já existe,
 * não publica galeria.
 *
 * Não muda o resto. Dinheiro não atravessa (a conta nasce no plano inicial, em
 * teste, sem preço nenhum no pedido). PII do casal não atravessa — o que vem é
 * o nome e o e-mail DO ESTÚDIO, que é a mesma pessoa dos dois lados. E senha
 * não atravessa em direção nenhuma: quem define a daqui é o fotógrafo, pelo
 * link que este módulo manda para o e-mail dele.
 *
 * ── POR QUE O ATOMATIZA NÃO ESCOLHE A SENHA ───────────────────────────────
 *
 * Seria mais simples: gerar uma senha lá, mandar junto, mostrar na tela. E
 * seria o outro produto sabendo a senha das contas daqui — para sempre, porque
 * ninguém troca senha que nunca soube que tinha. A conta nasce com uma senha
 * ALEATÓRIA que ninguém guarda e ninguém vê; o acesso vem pelo mesmo fluxo de
 * recuperação que já existe, e o primeiro a saber a senha é o dono dela.
 */

/** O segredo que autoriza criar conta. PRÓPRIO deste caminho.
 *
 *  Nunca o `SESSION_SECRET` (assina cookie e liberação de galeria) nem o
 *  `AVISOS_ENC_KEY` (cifra o segredo do canal): um segredo que serve a dois
 *  propósitos não pode ser girado por causa de um sem quebrar o outro. */
const SEGREDO = () => process.env.PROVISIONAMENTO_SEGREDO;

export function provisionamentoConfigurado(): boolean {
  return Boolean(SEGREDO());
}

/**
 * O cabeçalho traz o segredo certo?
 *
 * `timingSafeEqual` e não `!==` pelo motivo de sempre: a comparação de string
 * sai no primeiro byte diferente, e esse tempo entrega o segredo caractere a
 * caractere. Mesmo cuidado do webhook do Asaas.
 */
export function segredoConfere(recebido: string | null | undefined): boolean {
  const esperado = SEGREDO();
  if (!esperado) return false;
  const a = Buffer.from(recebido ?? "");
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * O retrato da conta que sai daqui — e é ESTREITO de propósito.
 *
 * `criarTenant` devolve a linha inteira, `senha_hash` incluído. Devolver esse
 * objeto para quem chama seria pendurar o hash da senha num valor que a rota
 * serializa: hoje ela escolhe campo a campo e nada vaza, mas basta alguém
 * escrever `json(r.tenant)` num dia apertado. Mesma razão de `estadoDoCanal`
 * ser separada de `canalDoEstudio` — o que não precisa sair, não sai.
 */
export interface ContaProvisionada {
  id: string;
  slug: string;
  nomeEstudio: string;
  origem: string;
  origemRef: string;
}

export type ResultadoProvisionamento =
  | { ok: true; conta: ContaProvisionada; chave: string; jaExistia: boolean }
  | { ok: false; motivo: "email_ja_usado" };

/** A conta desta referência, se já foi provisionada antes. */
async function porReferencia(origem: string, ref: string): Promise<Tenant | null> {
  return (
    (await consultarUm<Tenant>(
      "select * from tenants where origem = $1 and origem_ref = $2",
      [origem, ref],
    )) ?? null
  );
}

/**
 * Cria (ou reencontra) a conta do estúdio, e devolve uma chave pronta para uso.
 *
 * Três caminhos, e a ordem entre eles é a parte que importa:
 *
 *   1. JÁ PROVISIONADA (mesma referência) — devolve o mesmo estúdio e uma
 *      chave NOVA. É o retry, e é por isso que a migração 047 existe.
 *   2. E-MAIL JÁ EM USO por uma conta que não veio desta referência — recusa.
 *      Nunca cria a segunda conta: seria o fotógrafo com as galerias dele
 *      espalhadas em dois estúdios, e sem jeito de juntar depois.
 *   3. Livre — cria, manda o e-mail de definir senha, devolve a chave.
 *
 * A chave sai com escopo `envio` porque é o que o consumidor precisa: criar
 * galeria. `envio` já implica `leitura` (ver auth-api.ts), então uma chave só
 * serve para tudo que a ponte faz.
 */
export async function provisionarEstudio(dados: {
  nomeEstudio: string;
  email: string;
  origem: string;
  referencia: string;
}): Promise<ResultadoProvisionamento> {
  const email = dados.email.trim().toLowerCase();

  const jaProvisionada = await porReferencia(dados.origem, dados.referencia);
  if (jaProvisionada) {
    const chave = await gerarChave(jaProvisionada.id, nomeDaChave(dados.origem), "envio");
    return { ok: true, conta: retrato(jaProvisionada), chave: chave.segredo, jaExistia: true };
  }

  const doEmail = await buscarTenantPorEmail(email);
  if (doEmail) return { ok: false, motivo: "email_ja_usado" };

  /*
   * Senha aleatória de 32 bytes, que ninguém guarda e ninguém vê.
   *
   * A coluna é `not null`, e deixar um hash vazio ou previsível seria pior que
   * uma senha forte desconhecida: a conta ficaria alcançável por quem
   * descobrisse o padrão. Assim ela nasce inalcançável por senha, e o único
   * caminho para dentro é o link que sai logo abaixo.
   */
  const tenant = await criarTenant({
    nomeEstudio: dados.nomeEstudio.trim(),
    email,
    senha: randomBytes(32).toString("base64url"),
    planoId: PLANO_INICIAL,
  });

  await consultar("update tenants set origem = $1, origem_ref = $2 where id = $3", [
    dados.origem,
    dados.referencia,
    tenant.id,
  ]);

  /*
   * O e-mail NÃO derruba o provisionamento se falhar.
   *
   * `enviarEmail` já não lança (ver lib/email.ts). A conta existe, a chave
   * existe, e a ligação do outro lado vai funcionar — o que falta é o
   * fotógrafo conseguir entrar aqui, e para isso o "esqueci minha senha" da
   * tela de login sempre esteve disponível. Devolver erro aqui apagaria uma
   * conta boa por causa de um provedor de e-mail fora do ar.
   */
  await enviarConviteDeSenha(tenant);

  const chave = await gerarChave(tenant.id, nomeDaChave(dados.origem), "envio");
  return {
    ok: true,
    conta: retrato({ ...tenant, origem: dados.origem, origem_ref: dados.referencia }),
    chave: chave.segredo,
    jaExistia: false,
  };
}

/** A linha do banco vira o retrato estreito. Um lugar só faz a conversão, e é
 *  onde se decide o que nunca sai daqui. */
function retrato(t: Tenant): ContaProvisionada {
  return {
    id: t.id,
    slug: t.slug,
    nomeEstudio: t.nome_estudio,
    origem: t.origem ?? "",
    origemRef: t.origem_ref ?? "",
  };
}

/** O nome que aparece na lista de chaves do painel. Quem olhar depois precisa
 *  saber de onde aquilo veio sem ter de adivinhar. */
function nomeDaChave(origem: string): string {
  return `Conexão ${origem === "atomatiza" ? "Atomatiza" : origem}`;
}

/**
 * "Sua conta está criada; defina sua senha."
 *
 * Não reaproveita `enviarEmailDeRecuperacao` de propósito: aquele texto diz
 * "alguém pediu para redefinir a senha", e quem acabou de criar a conta a
 * partir do outro produto nunca teve senha para redefinir. Recado que não bate
 * com o que a pessoa fez é o que faz e-mail legítimo parecer golpe.
 */
async function enviarConviteDeSenha(tenant: Tenant): Promise<void> {
  const { token } = await criarPedido(tenant.id, "provisionamento");
  const link = `https://${marca.dominio}/recuperar/${token}`;

  const corpo = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#a4adbd">
      A conta de <strong style="color:#eef1f6">${tenant.nome_estudio}</strong> no
      ${marca.nome} foi criada a partir do Atomatiza, e já está ligada a ele.
      Falta só você escolher uma senha para entrar aqui.
    </p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#d9a441;color:#07080b;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
        Definir minha senha
      </a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6f7787">
      O link vale por uma hora. Depois disso, use "Esqueci minha senha" na tela
      de entrada — leva ao mesmo lugar. Se não foi você quem pediu, pode
      ignorar: sem definir a senha, ninguém entra nesta conta.
    </p>`;

  await enviarEmail({
    para: tenant.email,
    assunto: `Sua conta no ${marca.nome} está pronta`,
    html: moldura("Falta definir sua senha", corpo),
    texto:
      `A conta de ${tenant.nome_estudio} no ${marca.nome} foi criada a partir do ` +
      `Atomatiza e já está ligada a ele. Defina sua senha: ${link}\n\n` +
      `O link vale por uma hora.`,
  });
}
