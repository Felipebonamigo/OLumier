# Product

<!-- impeccable:product-schema 1 -->

> Os títulos das seções ficam em inglês porque são o esquema que a ferramenta lê.
> O conteúdo fica em português, como o resto do repositório.

## Platform

web

## Users

**Primário — o fotógrafo ou filmaker.** Estúdio pequeno de casamento e evento no
Brasil: quase sempre uma pessoa, às vezes um casal de sócios. Fotografa,
seleciona, edita, e então precisa entregar centenas de fotos ou arquivos de
dezenas de gigabytes. Trabalha do notebook, entre um trabalho e o próximo, e a
entrega é a parte do ofício que menos gosta de fazer. Hoje resolve isso com
Pixellu, Pic-Time ou nuvem genérica (WeTransfer, Drive).

**Secundário — o casal e a família.** Abre a galeria pelo link que o fotógrafo
mandou, na maioria das vezes pelo celular, muitas vezes meses depois. Quer
salvar as fotos, mostrar para os outros e marcar as preferidas para o álbum.
**Nunca cria conta e nunca lê a palavra "Olumier"** — para essa pessoa, o
produto é o estúdio que ela contratou.

## Product Purpose

Entregar o trabalho pronto ao cliente final com a marca e o endereço do próprio
estúdio, e tirar o material do disco do fotógrafo sem perdê-lo.

Sucesso é duplo e precisa acontecer nos dois lados:

- o fotógrafo manda **um link** e para de administrar a entrega — sem reexportar,
  sem reenviar, sem responder "não consegui baixar" no WhatsApp;
- o casal abre no celular, salva e marca favoritas **sem precisar de ajuda**.

## Positioning

Três coisas que um concorrente vizinho não copia de graça:

1. **Vídeo pelo preço de foto.** R$ 249–349 nas faixas de 1 a 5 TB, onde a
   Pic-Time cobra R$ 275–468. É escolha deliberada, não acidente de tabela: acima
   de 2 TB de foto o projeto decidiu **não** competir por preço (concorrente
   oferece "ilimitado" por ~R$ 220), e apontou o esforço para vídeo. Fonte:
   `planejamento/custos-validado-v7.xlsx` (17/08/2026), espelhada em
   `src/config/planos.ts`.
2. **O endereço e a marca são do estúdio.** Cada conta ganha um subdomínio
   próprio — `siriusfotografia.olumier.com.br` — e cada galeria carrega a logo e
   a cor do estúdio. O oposto de mandar um link genérico de nuvem.
3. **Cofre automático: nada é apagado.** No prazo que o fotógrafo definir, a
   galeria sai do ar sozinha e desce para um armazenamento separado e mais
   barato. Reativar é um clique. O padrão do mercado é apagar no vencimento ou
   cobrar caro para manter no ar.

## Operating Context

- **O ciclo real é longo.** Casamento acontece, edição leva semanas, a entrega
  vive meses no ar e depois só é procurada de novo em aniversário. O produto é
  medido no dia da entrega e de novo um ano depois.
- **A conexão do fotógrafo é doméstica.** Subir 30 GB de filme por uma linha
  residencial que cai no meio é o caso normal, não a exceção.
- **O celular do convidado é o dispositivo principal do lado do cliente**, e a
  faixa de idade vai de 15 a 80 anos na mesma galeria.
- **iPhone gera HEIC**, que Chrome, Firefox e Android não desenham. Sem prévia
  gerada no envio, a foto vira espaço em branco para quem abrir fora do Safari.
- **O produto é operado por três sócios** (Felipe, Carol e Sirius), sendo dois
  deles fotógrafos e, portanto, também usuários do próprio sistema.

## Capabilities and Constraints

**O que já funciona, em produção:**

- multi-inquilino com subdomínio por estúdio, TLS sob demanda e roteamento em
  `src/proxy.ts`;
- envio direto do navegador para o armazenamento, em paralelo, com retomada
  automática depois de queda de conexão (inclusive multipart para arquivos
  grandes);
- galeria pública com senha opcional, prazo opcional, capítulos, aparência
  configurável e contagem de aberturas e downloads;
- salvar no rolo do celular (não na pasta "Arquivos", onde o usuário não acha);
- favoritas: o cliente marca com coração, sem criar conta, e o painel mostra a
  lista consolidada;
- cofre automático por prazo, com dois limites independentes (galeria no ar e
  cofre);
- cobrança recorrente ligada (Asaas, em produção desde 30/07/2026), teste grátis
  de 14 dias sem cartão;
- recuperação de senha por e-mail, com revogação das sessões anteriores;
- backup diário com cópia fora do servidor e restauração **ensaiada**, não
  apenas prometida.

**Restrições técnicas que trabalho futuro precisa respeitar:**

- o bucket **nunca** é público: todo acesso a arquivo passa por link assinado de
  validade curta;
- a marca vive **só** em `src/config/marca.ts`; bucket, tabelas e pastas usam
  termos neutros, para o nome poder mudar sem migração (foi exatamente o que
  permitiu a troca de Fotônio para Olumier sem tocar em dado);
- dinheiro é sempre inteiro em centavos, nunca ponto flutuante;
- SVG é recusado como logo de propósito — é documento, não imagem;
- mudança de estrutura de banco é aplicada por migração versionada, e o
  `deploy.sh` recusa publicar com migração pendente em produção.

**Decisões de produto ainda em aberto — não tratar como resolvidas:**

- a divisão da receita entre os três sócios (50/25/25 é proposta, não acordo
  fechado);
- revisão jurídica dos Termos de Uso e da Política de Privacidade;
- plano de 10 TB não é produto de prateleira — é sob consulta, e o formato dessa
  consulta não existe.

## Brand Commitments

- Nome **Olumier**, desde 24/08/2026, substituindo Fotônio. Domínio
  `olumier.com.br`.
- Assinatura: **"Sua luz, entregue."**
- Voz: direta e concreta, sem jargão de marketing e sem promessa que o sistema
  não cumpre. A interface fala de coisas que o fotógrafo reconhece — "a pasta do
  casamento", "o filme de 30 GB", "não recebi" — em vez de falar de recursos.
- A marca do produto **cede lugar** à do estúdio em toda tela que o cliente final
  vê. Essa é uma restrição de identidade, não uma preferência estética.
- Nomes do lado do servidor (`/opt/fotonio`, unidades systemd, banco
  `fotonio_dev`) continuam com o nome antigo por decisão registrada: renomear
  traria risco sem ganho.

## Evidence on Hand

**Ninguém usa o produto ainda.** Não há fotógrafo pagante, e nem os próprios
sócios migraram a operação — a primeira entrega real ainda não aconteceu. O
sistema está no ar em `olumier.com.br` com cobrança ligada de verdade, mas
faturamento real nunca foi provado.

Portanto **não existem**: depoimentos, nomes de clientes, número de usuários,
volume entregue, estudos de caso, prêmios ou menções de imprensa. Trabalho
futuro **não pode fabricar nenhum desses** — nem como texto de exemplo em tela
de marketing.

O que existe de material real: a tabela de planos, a planilha de custos que a
originou, a marca e o símbolo, e a documentação de operação em `docs/`.

## Product Principles

1. **O cliente final nunca cria conta.** Toda funcionalidade do lado do casal —
   baixar, favoritar, compartilhar — precisa funcionar sem cadastro, sem senha e
   sem aplicativo.
2. **Nada é apagado sem alguém pedir e nomear.** Vencimento manda para o cofre;
   não destrói. Quem apaga é o dono do arquivo.
3. **A marca da tela é a do estúdio.** Quando a nossa aparece na frente da dele,
   o produto errou.
4. **Prometer menos do que se cumpre.** Restauração ensaiada em vez de "backup
   garantido"; aviso honesto quando um recurso está desligado, em vez de botão
   que não faz nada.
5. **A entrega precisa sobreviver à vida real** — queda de conexão, HEIC do
   iPhone, celular antigo, galeria procurada um ano depois.

## Accessibility & Inclusion

**WCAG AA é piso, não meta.** Contraste abaixo do mínimo é defeito, não questão
de gosto, e vale para a interface do fotógrafo e para a galeria pública.

Estado medido hoje, sobre o fundo `#07080b`: texto 17,7:1, texto suave 8,9:1,
âmbar de ação 8,9:1 — todos acima do piso.

O motivo não é conformidade: a galeria de casamento é aberta pela família
inteira, incluindo gente de vista cansada em tela pequena, e uma vez só. Não há
segunda chance nem suporte para socorrer quem não conseguiu ler.

Quando o fotógrafo escolhe a cor da própria marca, o sistema **avisa** em que
tema ela some, mas não bloqueia — a identidade é dele, e um estúdio pode
legitimamente ter marca quase preta.
