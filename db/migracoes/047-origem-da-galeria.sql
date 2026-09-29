-- ORIGEM DA GALERIA: de onde ela veio, quando não nasceu no painel.
--
-- O Atomatiza (o outro produto da casa — contratos, agenda, cobrança) cria
-- galeria daqui pela chave de API, uma por contrato. Ver a rota
-- `POST /api/galerias` e docs/chave-de-api.md.
--
-- ── POR QUE DUAS COLUNAS, E NÃO SÓ UMA MARCA ───────────────────────────────
--
-- `origem` diz QUEM criou ("atomatiza"); `origem_ref` diz A PARTIR DE QUÊ — a
-- referência que o criador mandou (lá, o id do contrato). É a `origem_ref` que
-- torna a criação IDEMPOTENTE: o botão "criar galeria deste contrato" clicado
-- duas vezes, ou uma rede que engoliu a resposta e repetiu a chamada, encontra
-- a galeria que já existe em vez de fabricar "ana-pedro-2" ao lado dela.
--
-- A referência é OPACA para este lado: a gente guarda e devolve, nunca
-- interpreta. Nenhum dado do contrato (valor, cliente, telefone) atravessa —
-- dinheiro e PII do casal ficam no sistema onde nasceram.
--
-- ── O ÍNDICE É PARCIAL, E A LIXEIRA FICA DE FORA ──────────────────────────
--
-- Único por (tenant, origem, origem_ref) só ENQUANTO a galeria existe para o
-- fotógrafo. Galeria na lixeira não bloqueia a referência: quem apagou a
-- galeria errada precisa poder criá-la de novo a partir do mesmo contrato, sem
-- esperar os 30 dias da purga. O caso raro do restauro que colidiria com a
-- recriada é resolvido em `restaurarGaleria` — a restaurada volta sem o
-- vínculo, porque a referência já tem dona nova.
--
-- `origem is not null` deixa as galerias do painel fora do índice: para elas
-- as duas colunas são nulas e nada muda.

alter table galerias add column if not exists origem     text;
alter table galerias add column if not exists origem_ref text;

create unique index if not exists galerias_origem_unica
  on galerias (tenant_id, origem, origem_ref)
  where origem is not null and estado <> 'lixeira';
