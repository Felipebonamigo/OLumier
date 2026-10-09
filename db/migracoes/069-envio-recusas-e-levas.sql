-- ============================================================================
--  O ENVIO: RECUSA NÃO É QUEDA, E A LEVA INTEIRA TEM VELOCIDADE PRÓPRIA
-- ============================================================================
--
--  Felipe, 09/10/2026, olhando "Velocidade real": "como podemos melhorar a
--  velocidade dos downloads e envio de fotos?". O cartão vermelho dizia 153
--  envios que desistiram em 3 estúdios, e sete das oito últimas linhas eram a
--  mesma: "No período de teste o espaço é de 10 GB". Não era rede. Era um
--  estúdio no teste tentando passar do teto, e cada foto da pasta batendo no
--  mesmo 507 e virando uma "desistência".
--
--  ── RECUSA ────────────────────────────────────────────────────────────────
--
--  `recusa` marca o que o SERVIDOR recusou (espaço do plano, teste vencido,
--  e-mail por confirmar, sessão, tipo de arquivo): a fila não tenta de novo,
--  porque a resposta seria a mesma. É o `erroDefinitivo` de
--  `lib/fila-upload.ts`, decidido no navegador. O painel conta à parte — quem
--  bate no teto é conversa comercial, não problema de velocidade.
--
--  As linhas de antes não têm a marca. A atualização abaixo reconhece as
--  recusas pelos textos que a rota de envio devolve (o painel olha 7 dias, e
--  é esta semana que estava errada). O texto fica guardado com teto de 200
--  caracteres, então a comparação é pelo começo.
--
--  ── LEVA ──────────────────────────────────────────────────────────────────
--
--  `envios_medidos.ms` mede um arquivo só, e só o PUT do original, com outros
--  cinco subindo junto. 3 MB/s por arquivo pode ser a internet inteira do
--  fotógrafo ocupada — ou não; daquele número não dá para saber. O que ele
--  sente é outra coisa: "a pasta levou quanto?".
--
--  `envios_levas` é uma linha por vez que a fila corre do começo ao fim: os
--  bytes que subiram e o tempo de relógio, com miniatura, preparo, confirmação
--  e retentativa dentro. Leva pausada, parada ou que ficou sem rede não vira
--  linha: o relógio dela mede a pessoa, não o envio.
-- ============================================================================

alter table envios_medidos add column if not exists recusa boolean not null default false;

update envios_medidos
   set recusa = true
 where not ok
   and not recusa
   and (
        erro like 'No período de teste o espaço é de %'
     or erro like 'Espaço insuficiente no plano%'
     or erro like 'Seu teste grátis terminou%'
     or erro like 'Há uma cobrança em aberto%'
     or erro like 'Sua assinatura foi cancelada%'
     or erro like 'Confirme seu e-mail para começar%'
     or erro like 'Sessão expirada%'
     or erro like 'Esta galeria está no cofre%'
     or erro like 'Galeria não encontrada%'
     or erro like '%: tipo não aceito.%'
     or erro like '% passa de 100 GB, o limite por arquivo.%'
   );

create table if not exists envios_levas (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- Só o que SUBIU: o arquivo que desistiu não entrega byte nenhum.
  bytes       bigint not null check (bytes >= 0),
  ms          integer not null check (ms > 0),
  arquivos    integer not null check (arquivos >= 0),
  falhas      integer not null default 0 check (falhas >= 0),
  -- Quantos a fila mandava ao mesmo tempo: se o número mudar, a série muda.
  paralelos   smallint not null check (paralelos > 0),
  navegador   text,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_envios_levas_quando on envios_levas(criado_em desc);
