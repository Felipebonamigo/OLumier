import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { PRAZO_LIXEIRA_DIAS } from "@/lib/tenants";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Regras de uso do ${marca.nome}.`,
};

/* A data é do TEXTO, não do arquivo: mexeu na regra, muda aqui. Termo que diz
 * ter sido atualizado em agosto e fala de coisa decidida depois é desonesto — e
 * é o tipo de detalhe que ninguém confere e todo mundo repara. */
const ATUALIZADO_EM = "27 de agosto de 2026";

export default function TermosPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Termos de Uso</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizados em {ATUALIZADO_EM}</p>

      <p>
        Estes termos valem entre você (o <strong>fotógrafo</strong> que contrata) e o {marca.nome},
        operado por Felipe Carboni Bonamigo. Ao criar uma conta, você concorda com eles.
      </p>

      <h2>O que o serviço faz — e o que ele não é</h2>
      <p>
        O {marca.nome} hospeda e entrega galerias de fotos e vídeos para os seus clientes, com a sua
        marca, em um endereço próprio do seu estúdio. Inclui armazenamento das galerias no ar,
        espaço de cofre para o que sai do ar, e download sem limite de vezes para quem recebe o
        link.
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
          Você pode encerrar quando quiser, chamando no{" "}
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

      <h2>Espaço contratado</h2>
      <p>
        Cada plano tem dois limites separados: o espaço das <strong>galerias no ar</strong> e o
        espaço do <strong>cofre</strong>. Mandar uma galeria para o cofre libera espaço no ar.
        Quando um limite se esgota, você libera espaço ou muda de plano.
      </p>
      <p>
        Uma exceção que vale explicar: quando uma galeria vence o prazo que você definiu, ela vai
        para o cofre <em>mesmo que isso ultrapasse o espaço de cofre contratado</em>. Preferimos
        cumprir o prazo que você combinou com seu cliente a segurar a galeria no ar contra a sua
        vontade. Você é avisado quando isso acontece e fica combinado que o excedente será
        regularizado.
      </p>

      <h2>Pagamento</h2>
      <ul>
        <li>O teste grátis dura 14 dias e não pede cartão nem documento.</li>
        <li>Depois, a assinatura é mensal, cobrada pelo Asaas (Pix, boleto ou cartão).</li>
        <li>Preços podem mudar, com aviso de pelo menos 30 dias por e-mail.</li>
        <li>Cancelou, vale até o fim do período já pago.</li>
      </ul>

      <h3>Se o pagamento atrasar</h3>
      <p>
        Enquanto houver cobrança em aberto, você não consegue enviar arquivos novos. As galerias já
        publicadas <strong>continuam no ar</strong>: o casal que recebeu o link não tem nada a ver
        com a pendência, e não vamos tirar as fotos do casamento dele do ar para cobrar você.
      </p>
      <p>
        Se a inadimplência se estender por muito tempo, entramos em contato antes de qualquer medida
        que afete o conteúdo. Nada é apagado sem aviso.
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
        <strong>Guarde suas cópias originais.</strong> O {marca.nome} é um serviço de entrega e de
        cofre, não substitui o seu backup — e nenhum serviço deveria ser sua única cópia.
      </p>

      <h2>Pelo que não nos responsabilizamos</h2>
      <p>
        O {marca.nome} é a plataforma que guarda e entrega os arquivos. O que está dentro deles é
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
