-- ============================================================================
--  A ENTREGA POR E-MAIL, E O SISTEMA "REMEMBER"
-- ============================================================================
--
--  Juan, 01/10/2026: "estruturar um sistema de entrega de galeria, notificando
--  por email. Ter templates prontos de entrega (…). O envio acontecerá para
--  entrega da galeria quando ela estiver pronta. Esse sistema de email também
--  pode contar com emails sendo enviados 03 meses depois, pedindo feedback. 06
--  meses depois do evento (…) para relembrar da galeria e estimular o casal a
--  assistir novamente. 12 meses depois do evento também. Relembrando 'amanhã'
--  completará UM ANO do seu evento! E também um email enviado no próprio dia do
--  casamento. Talvez possamos desenvolver esse sistema de REMEMBER (…). Algo que
--  destaque as fotos mais baixadas talvez?"
--
--  ── UMA LINHA POR E-MAIL, AGENDADA, E NUNCA DUAS ──────────────────────────
--
--  A tabela guarda a INTENÇÃO de enviar, com data. Quem envia é um script
--  diário (`scripts/enviar-emails-da-galeria.mjs`, pelo timer
--  `fotonio-emails`), que pega o que venceu e ainda não saiu.
--
--  Isto não é fila por elegância: é a única forma de o reenvio não acontecer. A
--  chave única `(galeria_id, tipo, para)` significa que a mesma pessoa não
--  recebe o mesmo tipo duas vezes pela mesma galeria — nem se o script rodar
--  duas vezes, nem se o servidor reiniciar no meio, nem se alguém apertar o
--  botão de novo. Mandar "sua galeria está pronta" duas vezes para a noiva é o
--  tipo de erro que o fotógrafo não perdoa.
--
--  `enviado_em` nulo e `erro` nulo = pendente. Com `erro`, o script tentou e
--  falhou; a próxima rodada tenta de novo (o Resend pode estar fora do ar), e a
--  tela do fotógrafo mostra o motivo em vez de esconder.
--
--  ── POR QUE O DESTINATÁRIO É TEXTO, E NÃO UMA CHAVE ───────────────────────
--
--  Porque o e-mail do casal pode não existir em `pessoas_da_galeria`: o
--  fotógrafo digita o endereço na hora de entregar, antes de qualquer pessoa ter
--  aberto a galeria. Guardar o endereço como ele escreveu é o que permite
--  agendar a entrega de uma galeria que ninguém abriu ainda.
--
--  ── O AGENDAMENTO É DATA, NÃO INSTANTE ───────────────────────────────────
--
--  `agendado_para` é `date` e não `timestamptz`: "três meses depois" não tem
--  hora, e o script roda uma vez por dia. Guardar instante daria a falsa
--  impressão de precisão e levantaria a pergunta errada (em que fuso?). O fuso
--  do produto é o do Brasil — ver `src/config/fuso.ts`.

alter table galerias
  -- O fotógrafo ligou os e-mails de lembrete (o "REMEMBER") nesta galeria?
  -- A entrega é sempre manual: ele aperta o botão. Os lembretes são automáticos,
  -- e automático em cima do cliente de outra pessoa pede autorização explícita.
  add column if not exists email_lembretes boolean not null default false,
  -- O desenho do e-mail: ver `TEMPLATES` em `src/config/email-da-galeria.ts`.
  add column if not exists email_template text,
  -- O recado do fotógrafo dentro do e-mail de entrega. Vazio usa o texto pronto.
  add column if not exists email_mensagem text;

create table if not exists emails_da_galeria (
  id uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references galerias(id) on delete cascade,
  -- 'entrega' | 'dia_do_evento' | 'feedback' | 'relembrar' | 'um_ano'
  -- Texto e não enum: tipo novo é uma linha de código, e `alter type` em
  -- produção com o app no ar é a operação que ninguém quer às 23h.
  tipo text not null,
  para text not null,
  -- O nome, como o fotógrafo escreveu. Para o "Oi, Ana" do e-mail.
  nome text,
  agendado_para date not null,
  enviado_em timestamptz,
  -- O motivo da última tentativa falha. Nulo = nunca falhou.
  erro text,
  criado_em timestamptz not null default now(),
  -- A trava do reenvio. Ver o cabeçalho.
  unique (galeria_id, tipo, para)
);

-- A consulta do script diário: o que venceu e ainda não saiu.
create index if not exists idx_emails_pendentes
  on emails_da_galeria (agendado_para)
  where enviado_em is null;
