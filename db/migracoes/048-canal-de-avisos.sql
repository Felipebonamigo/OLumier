-- CANAL DE AVISOS: contar ao outro lado que a entrega mudou de estado.
--
-- Até aqui a ligação com o Atomatiza era só de PUXAR: lá o fotógrafo clicava
-- "conferir" e a gente respondia como a entrega estava. Funciona, e é honesto —
-- a tela sempre disse "visto há tanto tempo". O que não funciona é o dia em que
-- ele publica a galeria aqui e o contrato lá continua dizendo "fora do ar" até
-- alguém lembrar de clicar. É esse o buraco que este canal fecha.
--
-- ── O SEGREDO É DE QUEM RECEBE, E CHEGA POR ELE ───────────────────────────
--
-- Não somos nós que inventamos o segredo: o Atomatiza gera o dele e registra
-- aqui, junto com o endereço para onde avisar (`POST /api/avisos`). É o mesmo
-- desenho do webhook do Asaas — quem recebe escolhe como quer ser reconhecido,
-- e quem envia só guarda e usa. Assim o outro lado pode girar o segredo quando
-- quiser, sem pedir nada a ninguém.
--
-- Ele fica CIFRADO (AES-256-GCM, `src/lib/cripto.ts`, chave em `AVISOS_ENC_KEY`).
-- A tabela já é inalcançável pela API, mas isso protege contra o acesso; a cifra
-- protege contra a CÓPIA — backup, dump, log de replicação. Um segredo em claro
-- num dump é um segredo vazado, e com ele dá para forjar aviso para o outro
-- sistema. Não é o fim do mundo (o aviso não move dinheiro nem troca link — ver
-- a rota lá), mas segredo é segredo.
--
-- ── UMA LINHA POR ESTÚDIO ─────────────────────────────────────────────────
--
-- `tenant_id` é chave primária: um estúdio avisa UM lugar. Dois canais para o
-- mesmo estúdio seriam duas verdades sobre para onde mandar, e o dia de
-- desconectar viraria adivinhação.
--
-- `ultimo_erro` e `ultimo_envio_em` existem para a pergunta que aparece quando
-- alguém reclama: "o aviso chegou?". Sem eles a resposta é dar de ombros —
-- avisar NUNCA derruba a ação que o disparou (ver `src/lib/avisos.ts`), então
-- uma falha some sem deixar rastro se ninguém a escrever.

create table if not exists avisos (
  tenant_id        uuid primary key references tenants (id) on delete cascade,
  url              text not null,
  segredo          text not null,          -- cifrado no app, nunca em claro
  criado_em        timestamptz not null default now(),
  ultimo_envio_em  timestamptz,
  ultimo_erro      text
);
