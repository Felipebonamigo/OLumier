-- ============================================================================
--  AS FOTOS DA PÁGINA INICIAL PASSAM A SER TROCADAS PELO ADMIN
-- ============================================================================
--
--  Felipe, 28/09/2026: "queremos também mudar as fotos que aparecem nessa
--  página inicial, aonde estão elas? eu consigo alterar no painel admin?" — e,
--  mandando as primeiras fotos autorais: "também crie na tela de admin".
--
--  As fotos moravam só no repositório (`src/config/home-demonstracao.ts`), e
--  trocar uma era mudar código e publicar. Continuam lá, como PADRÃO de cada
--  lugar da página. Esta tabela guarda a troca: uma linha por lugar que o
--  admin substituiu, e o lugar sem linha mostra o padrão.
--
--  ── POR QUE UMA LINHA POR LUGAR, E NÃO UMA LISTA DE FOTOS ─────────────────
--
--  A página não é um carrossel: cada foto tem um papel — a capa de um exemplo
--  de galeria, o cartão da seção do cofre, a foto grande do fim. O lugar é a
--  chave, e trocar a foto de um lugar não mexe em nenhum outro.
--
--  ── OS ARQUIVOS ───────────────────────────────────────────────────────────
--
--  Ficam no bucket em `plataforma/home/<lugar>/`, fora da pasta de qualquer
--  estúdio: são da plataforma. A varredura de órfãos (`varrer-orfaos`) só
--  reconhece dono pelo primeiro pedaço da chave, e "plataforma" não é id de
--  estúdio nenhum — então ela passa longe desses arquivos em vez de
--  classificá-los como lixo. Ver `deOutroAmbiente` em
--  `scripts/varrer-orfaos-regras.mjs`.
--
--  Duas chaves por foto: a do tamanho grande (capa e foto do fim) e a da
--  miniatura (a grade das galerias de exemplo), as mesmas duas derivadas que o
--  envio de uma galeria gera no navegador.

create table if not exists fotos_da_home (
  lugar            text primary key,
  chave            text not null,
  chave_miniatura  text,
  largura          int  not null check (largura > 0),
  altura           int  not null check (altura > 0),
  descricao        text not null default '',
  -- Onde a capa larga centraliza o recorte de uma foto vertical, em %.
  foco_x           smallint not null default 50 check (foco_x between 0 and 100),
  foco_y           smallint not null default 50 check (foco_y between 0 and 100),
  trocada_em       timestamptz not null default now(),
  trocada_por      uuid references tenants(id) on delete set null
);

comment on table fotos_da_home is
  'Fotos da página inicial trocadas pelo admin, por lugar. Lugar sem linha usa o padrão de src/config/home-demonstracao.ts.';
