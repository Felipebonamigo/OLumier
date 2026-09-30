import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { VERSOES_LEGAIS, dataPorExtenso, operadorPorExtenso } from "@/config/documentos-legais";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";
import { PRAZO_DA_DEVOLUCAO } from "@/lib/devolucao";
import { DIAS_DE_ARREPENDIMENTO } from "@/config/devolucao";
import { AVISOS_ANTES_DE_APAGAR, RETENCAO_POR_EXTENSO, TOTAL_DE_AVISOS } from "@/config/retencao";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Regras de uso da ${marca.nome}.`,
};

/* A data é do TEXTO, não do arquivo: mexeu na regra, muda a versão em
 * `config/documentos-legais.ts`. Termo que diz ter sido atualizado em agosto e
 * fala de coisa decidida depois é desonesto — e é o tipo de detalhe que ninguém
 * confere e todo mundo repara. A mesma versão vai gravada no evento
 * `conta.criada`, como a que a pessoa aceitou. */
const ATUALIZADO_EM = dataPorExtenso(VERSOES_LEGAIS.termos);

export default function TermosPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Termos de Uso</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizados em {ATUALIZADO_EM}</p>

      <p>
        Estes termos valem entre você (o <strong>fotógrafo</strong> que contrata) e a {marca.nome},
        operado por {operadorPorExtenso()}. Ao criar uma conta, você concorda com eles.
      </p>

      <h2>O que o serviço faz — e o que ele não é</h2>
      <p>
        A {marca.nome} hospeda e entrega galerias de fotos e vídeos para os seus clientes, com a sua
        marca, em um endereço próprio do seu estúdio. Inclui o espaço contratado, que guarda tanto
        as galerias no ar quanto as que saíram do ar e foram para o cofre, e download sem limite de
        vezes para quem recebe o link.
      </p>
      {/*
        ISTO VEM NA PRIMEIRA SEÇÃO, e não no fim, de propósito.

        A frase já existia em quatro lugares — Disponibilidade, a seção de
        segurança, /seguranca e o aviso de beta — e nos quatro ela aparecia
        DEPOIS. Aviso que só chega no rodapé chega quando a expectativa já se
        formou, e a expectativa errada aqui é a que custa um casamento inteiro.

        `testar-termos.mjs` confere a POSIÇÃO, não só a presença: se um dia esta
        frase escorregar para o fim de novo, a suíte reclama.
      */}
      <p>
        <strong>
          É uma ferramenta de ENTREGA, não de backup. O seu arquivo aqui é a cópia que o seu cliente
          recebe, não a cópia que te salva.
        </strong>{" "}
        Mesmo o cofre é entrega: ele guarda a galeria fora do ar para você reativar quando o cliente
        pedir — não é uma segunda via dos seus originais. Guarde os seus originais no seu HD, no seu
        backup, onde você já guarda. Nenhum serviço deveria ser a sua única cópia, e o nosso também
        não.
      </p>

      <h2>Sua conta</h2>
      <ul>
        <li>Você é responsável por manter sua senha em segredo e pelo que acontece na sua conta.</li>
        <li>Uma conta é de um estúdio. Compartilhar acesso é por sua conta e risco.</li>
        <li>
          Você cancela a assinatura quando quiser, sozinho, em <strong>Conta</strong>, no painel
          (veja em Pagamento o que acontece com o dinheiro e com os arquivos). Para encerrar a conta
          e apagar os dados na hora, chame no{" "}
          <a href={marca.whatsappLink}>WhatsApp {marca.whatsappVisivel}</a>.
        </li>
      </ul>

      <h2>O conteúdo é seu — e a responsabilidade também</h2>
      <p>
        As fotos e vídeos que você envia continuam <strong>inteiramente seus</strong>. Não
        reivindicamos direito nenhum sobre eles, não os usamos para divulgação e não treinamos
        modelos com eles.
      </p>
      <p>Ao enviar, você declara que:</p>
      <ul>
        <li>tem os direitos sobre o material;</li>
        <li>
          tem <strong>autorização das pessoas retratadas</strong> para entregá-lo pela internet —
          essa autorização é entre você e elas, e não temos como verificar;
        </li>
        <li>o conteúdo não é ilegal.</li>
      </ul>
      <p>
        Conteúdo ilegal — em especial material de abuso infantil — leva a remoção imediata,
        encerramento da conta e comunicação às autoridades.
      </p>

      {/*
        UM ESPAÇO SÓ desde 25/08/2026, quando o cofre deixou de ser peça do
        plano (ver `config/planos.ts`). Até 29/09 esta seção ainda descrevia
        dois limites, um no ar e outro no cofre, e uma exceção para galeria
        vencida que passava do cofre — regra que o código já não tinha.
        Arquivar e reativar não recusam (`lib/cofre.ts`); o portão é o upload,
        que soma no ar, cofre e lixeira (`lib/medias.ts`, `lib/tenants.ts`).
      */}
      <h2>Espaço contratado</h2>
      <p>
        Cada plano tem <strong>um espaço só</strong>, e ele soma tudo o que a sua conta guarda: as
        galerias no ar, as que estão no cofre e as que estão na lixeira. Não há limite de
        quantidade de galerias; o limite é o espaço.
      </p>
      <p>
        Mandar uma galeria para o cofre tira o link do ar para o seu cliente, mas não libera
        espaço: os arquivos continuam guardados. Pelo mesmo motivo, reativar não ocupa nada a mais.
        Arquivar e reativar funcionam sempre, com o espaço cheio ou não, e a galeria que vence o
        prazo que você definiu vai para o cofre do mesmo jeito.
      </p>
      <p>
        Quando o espaço se esgota, param só os envios novos. Nada sai do ar e nada é apagado por
        isso. Para voltar a enviar, você muda de plano ou libera espaço apagando galerias que não
        precisa mais guardar. Galeria apagada fica {PRAZO_LIXEIRA_DIAS} dias na lixeira e continua
        contando no espaço durante esse prazo; se precisar do espaço antes, esvazie a lixeira.
      </p>

      <h2>Pagamento</h2>
      <ul>
        <li>
          O teste grátis dura 14 dias e não pede cartão. Pede o CPF ou CNPJ do titular: é um teste
          por documento.
        </li>
        <li>
          Se o teste terminar sem assinatura, as galerias saem do ar 15 dias depois, e os arquivos
          enviados durante o teste são apagados 60 dias depois do fim dele — com dois avisos por
          e-mail antes, o último com 7 dias de antecedência. A conta continua existindo.
        </li>
        <li>
          Depois, a assinatura é mensal ou anual, cobrada pelo Asaas (Pix, boleto ou cartão). No
          anual você paga 10 meses e usa 12.
        </li>
        <li>
          Aumentou o plano no meio do período: o espaço novo vale na hora, e você paga só a
          diferença entre os dois planos, proporcional aos dias que faltam do período já pago.
          Diminuiu: o que já foi pago não volta, e o preço menor vale a partir da próxima fatura.
        </li>
        <li>Preços podem mudar, com aviso de pelo menos 30 dias por e-mail.</li>
      </ul>

      {/*
        CANCELAMENTO E DEVOLUÇÃO — decisão do Felipe, 30/09/2026. Até então os
        Termos diziam só "cancelou, vale até o fim do período já pago", e nada
        sobre dinheiro de volta: o anual cancelado no 2º mês ficava sem regra,
        e sem o prazo de arrependimento que a lei dá a toda compra pela
        internet. Os números saem de `config/devolucao.ts`, a mesma regra que a
        tela de Conta usa para calcular.
      */}
      <h3>Cancelamento e devolução</h3>
      <ul>
        <li>
          Você cancela quando quiser, em <strong>Conta</strong>, no painel. A tela mostra o valor
          da devolução, se houver, antes de você confirmar.
        </li>
        <li>
          <strong>Até {DIAS_DE_ARREPENDIMENTO} dias depois de um pagamento</strong>, mensal ou
          anual, você pode receber tudo de volta.
        </li>
        <li>
          <strong>No anual, depois disso</strong>, você pode receber o que pagou menos os meses já
          começados, cada um pelo preço mensal que o anual implica: um décimo do valor pago, já que
          o anual cobra dez meses por doze. Por exemplo, num anual de R$ 1.000 cancelado no terceiro
          mês, três meses custam R$ 300 e voltam R$ 700. Do décimo mês em diante não sobra valor a
          devolver.
        </li>
        <li>
          No mensal, depois dos {DIAS_DE_ARREPENDIMENTO} dias, o mês começado é o mês inteiro: não
          há devolução, e o acesso continua até o fim do mês.
        </li>
        <li>
          Com a devolução, o período pago acaba no dia do cancelamento, e o dinheiro volta pelo
          mesmo meio de pagamento em até {PRAZO_DA_DEVOLUCAO}. Sem pedir devolução, você continua
          usando até o fim do período já pago.
        </li>
        <li>
          A diferença paga numa troca de plano no meio do período é tratada à parte: fale com a
          gente pelo <a href={marca.whatsappLink}>WhatsApp</a>.
        </li>
      </ul>

      <h3>Se o pagamento atrasar</h3>
      <p>
        Enquanto houver cobrança em aberto, você não consegue enviar arquivos novos. As galerias já
        publicadas <strong>continuam no ar</strong>: o casal que recebeu o link não tem nada a ver
        com a pendência, e não vamos tirar as fotos do casamento dele do ar para cobrar você. Se a
        pendência passar de {RETENCAO_POR_EXTENSO} do fim do período pago, vale a regra abaixo.
      </p>

      {/*
        O PRAZO DA CONTA ENCERRADA — decisão do Felipe, 30/09/2026: "3 meses,
        mas colocando vários avisos". Antes, nada apagava a conta cancelada e
        nenhum texto dizia até quando ela ficava. Números de
        `config/retencao.ts`, os mesmos que a rotina diária usa
        (`lib/contas-encerradas.ts`).
      */}
      <h3>Depois do fim da assinatura</h3>
      <p>
        Com a assinatura cancelada, ou com o pagamento em atraso, as galerias continuam no ar por{" "}
        <strong>{RETENCAO_POR_EXTENSO} depois do fim do período pago</strong>. Antes de apagar
        qualquer coisa, avisamos por e-mail {TOTAL_DE_AVISOS} vezes: no dia em que o período acaba,
        e a {AVISOS_ANTES_DE_APAGAR.slice(0, -1).join(", ")} e {AVISOS_ANTES_DE_APAGAR.at(-1)}{" "}
        {AVISOS_ANTES_DE_APAGAR.at(-1) === 1 ? "dia" : "dias"} da data. Se um aviso atrasar, a data
        muda para garantir essa antecedência.
      </p>
      <p>
        Reativar a assinatura até lá mantém tudo como está. Na data, as galerias saem do ar e os
        arquivos são apagados. A conta continua existindo, e você pode assinar de novo quando
        quiser. Antes da data, baixe o que quiser guardar pelo link de cada galeria, com o download
        ligado.
      </p>

      {/*
        A seção de segurança nos TERMOS existe porque termo é o que a pessoa
        aceita, e /seguranca é o que ela talvez leia. Os dois textos dizem a
        mesma coisa de propósito: no dia em que um deles mudar, o outro tem de
        mudar junto — e é por isso que o número de dias sai da configuração, e
        não escrito à mão aqui.
      */}
      <h2>Segurança: o que fazemos, e o que isso não cobre</h2>
      <p>O que existe hoje, e você pode conferir na página de{" "}
        <Link href="/seguranca" className="underline underline-offset-4">
          segurança
        </Link>
        :
      </p>
      <ul>
        <li>
          seus originais ficam em armazenamento profissional, com durabilidade declarada de onze
          noves pelo fornecedor;
        </li>
        <li>
          o cadastro da conta — quais galerias existem, quem tem acesso, o que está em cada capítulo
          — tem backup diário, cifrado, guardado fora do servidor e travado contra exclusão por 30
          dias;
        </li>
        <li>
          galeria apagada vai para a lixeira e fica {PRAZO_LIXEIRA_DIAS} dias antes de sumir de
          verdade, para que um clique errado seja reversível.
        </li>
      </ul>
      <p>
        E agora o que isso <strong>não</strong> cobre, dito aqui para você não ter de supor:
      </p>
      <ul>
        <li>
          <strong>seus originais têm UMA cópia.</strong> Não mantemos uma segunda cópia em outra
          empresa. Onze noves medem disco queimando — não cobrem conta encerrada, chave vazada,
          erro de programa nem exclusão feita por alguém com a sua senha;
        </li>
        <li>
          não há promessa de tempo de resposta, de recuperação nem de disponibilidade contratada;
        </li>
        <li>
          quem tem o link da galeria abre a galeria. É assim que o casal recebe as fotos sem criar
          conta, e é você quem decide se põe senha e para quem manda o link.
        </li>
      </ul>
      <p>
        Por isso, e sem constrangimento: <strong>guarde os seus originais</strong>. Nenhum serviço
        deveria ser a sua única cópia, nem o nosso.
      </p>

      <h2>Disponibilidade</h2>
      <p>
        Trabalhamos para manter tudo no ar o tempo todo, com monitoramento e backup diário do banco
        com cópia fora do servidor. Ainda assim, não prometemos funcionamento ininterrupto:
        manutenção, falha de fornecedor ou problema de rede podem causar indisponibilidade.
      </p>
      <p>
        <strong>Guarde suas cópias originais.</strong> A {marca.nome} é um serviço de entrega e de
        cofre, não substitui o seu backup — e nenhum serviço deveria ser sua única cópia.
      </p>

      <h2>Pelo que não nos responsabilizamos</h2>
      <p>
        A {marca.nome} é a plataforma que guarda e entrega os arquivos. O que está dentro deles é
        seu, e a responsabilidade por ele também. <strong>Não nos responsabilizamos</strong> por:
      </p>
      <ul>
        <li>
          <strong>o conteúdo que você envia</strong> — direitos de imagem, direitos autorais e a
          autorização das pessoas retratadas são seus e só seus. Não vemos, não conferimos e não
          temos como verificar o que sobe;
        </li>
        <li>
          o que o seu cliente faz com os arquivos depois de baixá-los, inclusive publicá-los ou
          repassá-los a terceiros;
        </li>
        <li>
          reclamação de terceiro sobre material que você enviou — de quem aparece na foto, de quem
          reivindica autoria, ou de quem quer que seja;
        </li>
      </ul>
      <p>
        Se alguém nos acionar por causa de material que você enviou, você responde por isso e nos
        mantém a salvo, incluindo custos de defesa.
      </p>
      <p>
        Esta seção é sobre o CONTEÚDO, que é seu. Falha do nosso serviço é outra coisa, e está na
        seção seguinte — dela não nos eximimos.
      </p>

      <h2>Limite de responsabilidade</h2>
      <p>
        Quando a falha for nossa — indisponibilidade, defeito, perda de arquivo — nós respondemos, e
        a responsabilidade fica limitada, em qualquer hipótese, ao valor que você pagou nos 12 meses
        anteriores ao fato. Não respondemos por lucros cessantes nem por prejuízos indiretos.
      </p>
      <p>
        O limite existe no lugar de uma isenção, e é uma escolha: o Código de Defesa do Consumidor
        não aceita que um fornecedor se exima de responder por falha do próprio serviço, e uma
        cláusula assim cairia por inteiro numa disputa — deixando você e nós sem régua nenhuma. Um
        teto que vale protege melhor que uma isenção que não vale. Nada aqui afasta o que a lei
        garante a você.
      </p>

      <h2>Encerramento</h2>
      <p>
        Você pode sair quando quiser. Podemos encerrar a sua conta se estes termos forem
        descumpridos — com aviso e prazo para você baixar seu conteúdo, exceto em caso de conteúdo
        ilegal, que é removido de imediato.
      </p>

      <h2>Foro</h2>
      <p>
        Aplica-se a lei brasileira, com foro da comarca de Gravataí/RS, salvo se você for consumidor
        e a lei garantir foro do seu domicílio.
      </p>

      <p className="mt-10 text-sm">
        Veja também a{" "}
        <Link href="/privacidade">Política de Privacidade</Link>.
      </p>
    </>
  );
}
