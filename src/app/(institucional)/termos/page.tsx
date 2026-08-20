import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Regras de uso do ${marca.nome}.`,
};

const ATUALIZADO_EM = "20 de agosto de 2026";

export default function TermosPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Termos de Uso</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizados em {ATUALIZADO_EM}</p>

      <p>
        Estes termos valem entre você (o <strong>fotógrafo</strong> que contrata) e o {marca.nome},
        operado por Felipe Carboni Bonamigo. Ao criar uma conta, você concorda com eles.
      </p>

      <h2>O que o serviço faz</h2>
      <p>
        O {marca.nome} hospeda e entrega galerias de fotos e vídeos para os seus clientes, com a sua
        marca, em um endereço próprio do seu estúdio. Inclui armazenamento das galerias no ar,
        espaço de cofre para o que sai do ar, e download sem limite de vezes para quem recebe o
        link.
      </p>

      <h2>Sua conta</h2>
      <ul>
        <li>Você é responsável por manter sua senha em segredo e pelo que acontece na sua conta.</li>
        <li>Uma conta é de um estúdio. Compartilhar acesso é por sua conta e risco.</li>
        <li>Você pode encerrar quando quiser, escrevendo para <a href={`mailto:${marca.email}`}>{marca.email}</a>.</li>
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

      <h2>Limite de responsabilidade</h2>
      <p>
        Nossa responsabilidade, em qualquer hipótese, fica limitada ao valor que você pagou nos 12
        meses anteriores ao fato. Não respondemos por lucros cessantes ou por prejuízos indiretos.
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
