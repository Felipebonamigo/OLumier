-- Busca por rosto.
--
-- O convidado tira uma selfie e a galeria mostra só as fotos em que ele
-- aparece. Para isso, no ENVIO, o navegador do fotógrafo mede cada rosto e
-- guarda um vetor de 128 números por rosto. A selfie do convidado vira outro
-- vetor, no aparelho dele, e só os números sobem para comparar.
--
-- ── O QUE É GUARDADO, E O QUE NÃO É ────────────────────────────────────────
--
-- Guarda-se o VETOR e a caixa (onde na foto). Não se guarda recorte de rosto,
-- não se guarda a selfie de ninguém — ela nunca chega ao servidor. Mesmo assim
-- o vetor é dado biométrico, e a LGPD trata como dado sensível (art. 5º, II;
-- art. 11). Por isso:
--
--   rostos_ativos      só vira true quando o fotógrafo LÊ e ACEITA o texto de
--                      consentimento no painel. Sem isso, a rota que guarda
--                      vetor recusa, e a busca não existe para o convidado.
--   rostos_ligados_em  QUANDO ele aceitou — é a prova do consentimento.
--                      Desligar zera as duas colunas e APAGA todas as linhas
--                      de `rostos` da galeria: consentimento retirado, dado
--                      some junto.
--
-- ── POR QUE `real[]` E NÃO pgvector ────────────────────────────────────────
--
-- Uma galeria tem no máximo uns 2.000 rostos (192 fotos, medido em 27/08, com
-- até dez rostos aproveitáveis por foto). Comparar 2.000 vetores de 128 floats
-- em memória custa menos de um milissegundo; a extensão exigiria instalar no
-- VPS e virar dependência de deploy para ganhar nada nesta escala. Se um dia
-- houver galeria de 50.000 fotos, o índice HNSW entra — e a coluna já está
-- num formato que o pgvector lê.
--
-- ── A CAIXA É EM FRAÇÃO, NÃO EM PIXEL ──────────────────────────────────────
--
-- `caixa` guarda {x, y, w, h} como fração da imagem (0..1). O vetor é medido
-- no ORIGINAL do fotógrafo, mas quem exibe é a prévia de 2048 ou a miniatura
-- de 640 — pixel de uma não serve na outra. `px` guarda a largura do rosto na
-- imagem em que foi medido: é o que decide se ele passa o piso.

alter table galerias
  add column if not exists rostos_ativos     boolean not null default false,
  add column if not exists rostos_ligados_em timestamptz;

create table if not exists rostos (
  id          bigserial primary key,
  media_id    uuid not null references medias(id)   on delete cascade,
  galeria_id  uuid not null references galerias(id) on delete cascade,
  tenant_id   uuid not null references tenants(id)  on delete cascade,
  caixa       jsonb not null,                 -- {x,y,w,h} em fração da imagem
  px          int not null,                   -- largura do rosto onde foi medido
  vetor       real[] not null,                -- 128 números do face-api
  criado_em   timestamptz not null default now(),
  constraint rostos_vetor_128 check (array_length(vetor, 1) = 128)
);

-- A busca lê todos os rostos de UMA galeria; reindexar apaga os de UMA foto.
create index if not exists rostos_galeria_idx on rostos (galeria_id);
create index if not exists rostos_media_idx   on rostos (media_id);

comment on table rostos is
  'Vetor facial (dado biométrico, LGPD art. 11) de cada rosto de cada foto. '
  'Só existe em galeria com rostos_ativos; desligar apaga tudo. '
  'Nunca guarda imagem — só 128 números e a posição.';
