import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { metadadosDaCasa } from "@/lib/metadados";

export const metadata: Metadata = metadadosDaCasa({
  titulo: "Segurança e backup",
  descricao: `Como a ${marca.nome} guarda as fotos e os filmes que você entrega: armazenamento profissional, trava contra exclusão e lixeira de ${PRAZO_LIXEIRA_DIAS} dias.`,
  caminho: "/seguranca",
});

const ATUALIZADO_EM = "25 de agosto de 2026";

/**
 * A página que responde ao medo real do fotógrafo: "e se eu perder tudo?".
 *
 * Existe porque as proteções construídas — Object Lock, lixeira, backup do
 * cadastro com restauração ensaiada — não vendem nada enquanto estiverem só no
 * `docs/`. Nenhum concorrente afirma isto publicamente, e é o argumento que
 * justifica não sermos os mais baratos em toda faixa.
 *
 * A lista já incluiu "segunda cópia em outro fornecedor". O espelho de arquivos
 * foi cancelado em 27/08/2026 (ver `scripts/testar-sem-espelho.mjs`) e o
 * parágrafo que o prometia foi trocado por um que diz que ele NÃO existe. Pela
 * regra abaixo, essa era a única saída: a página havia se comprometido a mudar
 * "no mesmo dia", e uma promessa de segurança que envelhece em silêncio é
 * exatamente o que ela existe para não ser.
 *
 * Regra de conteúdo desta página: só entra o que EXISTE e está ligado. Promessa
 * de segurança que não se cumpre é pior que silêncio — e, num processo, vira
 * prova contra. Se um mecanismo for desligado, o parágrafo sai daqui no mesmo
 * dia.
 *
 * ── CORREÇÃO DE 25/08/2026 ────────────────────────────────────────────────
 * O texto dizia que a trava impede a exclusão "mesmo por quem tem a senha da
 * conta". Isso descreve Object Lock em modo COMPLIANCE. O que existe é
 * GOVERNANCE, que uma credencial com a capacidade `bypassGovernance` remove —
 * e a Backblaze concede essa capacidade por padrão a chaves criadas pelo
 * painel. A frase era, literalmente, a promessa mais forte da página apoiada no
 * mecanismo mais fraco.
 *
 * Governance é escolha, não descuido: compliance é IRREVERSÍVEL e impediria
 * atender pedido de exclusão do titular (LGPD) dentro dos 30 dias. O texto
 * agora diz o que a trava faz (barra o programa e o invasor) e o que ela não
 * faz (barrar o administrador), e explica por quê. Ver
 * `docs/arquitetura-armazenamento.md`.
 */
export default function SegurancaPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Segurança e backup</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizado em {ATUALIZADO_EM}</p>

      <p>
        Você entrega o casamento de alguém. Se esse arquivo sumir, não tem como refazer — e quem
        responde ao casal é você. Por isso esta página conta, sem marketing, o que acontece com
        cada foto e cada filme depois que você aperta enviar.
      </p>

      <h2>Onde suas fotos ficam</h2>
      <p>
        Seus arquivos ficam na <strong>Backblaze</strong>, em armazenamento profissional com{" "}
        <strong>99,999999999% de durabilidade</strong> declarada — em dez milhões de arquivos, a
        expectativa é perder um a cada dez mil anos. As miniaturas e as prévias que você vê ao
        navegar ficam na <strong>Cloudflare</strong>, que tem servidores perto do Brasil e é o que
        faz a galeria abrir rápido.
      </p>
      <p>
        Aquele número de onze noves mede disco queimando, e vale a pena dizer que não é assim que
        dado some de verdade. Some quando uma conta é encerrada, um cartão é recusado, uma chave
        vaza ou um programa faz besteira. É contra isso que existe o resto desta página.
      </p>
      <p>
        Sendo exatos sobre o que existe: <strong>seus originais têm uma cópia</strong>, no
        armazenamento acima. <strong>Não mantemos uma segunda cópia em outra empresa</strong> — e
        escrevemos isso aqui, em vez de deixar você supor que mantemos. O que está protegido em
        dois lugares é o seu cadastro, do jeito descrito logo abaixo.
      </p>
      <p>
        Por isso repetimos abaixo, e sem constrangimento: <strong>guarde os seus originais</strong>.
        Nenhum serviço deveria ser a sua única cópia, nem o nosso.
      </p>

      <h2>Travado contra exclusão</h2>
      <p>
        O backup do seu cadastro — quais galerias existem, quem tem acesso, o que está em cada
        capítulo — fica sob <strong>Object Lock por 30 dias</strong>: uma trava do próprio
        fornecedor, aplicada no armazenamento e não no nosso programa. Um comando errado da nossa
        parte, ou um invasor que roube uma credencial do sistema, não consegue apagar o que está
        travado — o armazenamento recusa.
      </p>
      <p>
        A trava é do tipo que <strong>nós ainda podemos remover</strong>, com uma credencial de
        administrador que não fica no servidor. É o que nos permite atender de verdade um pedido seu
        de apagar tudo: se a trava fosse absoluta, nem você conseguiria sair antes dos 30 dias.
        Existe uma modalidade mais rígida, que nem o dono da conta desfaz — não usamos por essa
        razão, e preferimos escrever isso a deixar você achar que é outra coisa.
      </p>
      <p>
        Além dela, nossos programas de limpeza automática têm um limite próprio: <strong>nenhuma
        rotina apaga mais que uma fração pequena das cópias de uma vez</strong>. Se uma faxina
        noturna fosse remover muito mais que o normal, ela para sozinha e chama uma pessoa em vez de
        continuar.
      </p>

      <h2>Apagou sem querer? Tem {PRAZO_LIXEIRA_DIAS} dias</h2>
      <p>
        Quando você apaga uma galeria, ela vai para a <strong>lixeira</strong>. Sai da sua lista, o
        link para de abrir para o cliente — e <strong>nenhum arquivo é removido</strong>. Você tem{" "}
        {PRAZO_LIXEIRA_DIAS} dias para restaurar tudo com um clique, com as mesmas fotos, o mesmo
        filme e os mesmos capítulos.
      </p>
      <p>
        Essa é a proteção mais usada de todas, porque o jeito mais comum de perder trabalho não é
        falha de servidor: é a mão errada na hora errada.
      </p>

      <h2>O que segura o resto</h2>
      <ul>
        <li>
          <strong>Backup diário do banco</strong> — quais galerias existem, quem tem acesso, o que
          está em cada capítulo. Sai do servidor criptografado, e a restauração foi{" "}
          <strong>ensaiada de verdade</strong>, não apenas prometida.
        </li>
        <li>
          <strong>Nada é público.</strong> O armazenamento não expõe arquivo nenhum: todo acesso
          passa por um link assinado e de validade curta. Link que vaza para de funcionar sozinho.
        </li>
        <li>
          <strong>Senha na galeria</strong>, quando você quiser, além do endereço impossível de
          adivinhar.
        </li>
        <li>
          <strong>Vigia a cada 5 minutos</strong>, conferindo que o site, o banco e o armazenamento
          respondem. Se travar, reinicia sozinho e avisa.
        </li>
      </ul>

      <h2>O que nós não fazemos — e você deveria</h2>
      <p>
        Nenhum serviço deveria ser a sua única cópia, e a {marca.nome} não é exceção.{" "}
        <strong>Guarde os originais.</strong> O que está aqui é a entrega ao seu cliente e o arquivo
        do que já foi entregue — não o backup do seu computador, dos seus RAW nem do seu cartão.
      </p>
      <p>
        Para o acervo bruto, um backup automático do computador (existem serviços ilimitados por
        preço fixo) continua sendo a ferramenta certa. Somos a camada de entrega, não a primeira
        cópia.
      </p>

      <h2>Se ainda assim algo der errado</h2>
      <p>
        Nenhum sistema é infalível, e quem promete isso está vendendo. As proteções desta página —
        armazenamento de onze noves, trava de exclusão, lixeira de {PRAZO_LIXEIRA_DIAS} dias, backup
        do cadastro com restauração ensaiada — cobrem os modos de falha que existem na prática:
        disco, comando errado, mão errada na hora errada. E os limites da nossa responsabilidade
        estão escritos, sem letra miúda, nos <Link href="/termos">Termos de Uso</Link>.
      </p>

      <p>
        Dúvida sobre qualquer coisa desta página?{" "}
        <a href={marca.whatsappLink}>WhatsApp {marca.whatsappVisivel}</a> — respondemos com detalhe
        técnico se você quiser.
      </p>
    </>
  );
}
