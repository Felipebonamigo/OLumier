-- ============================================================================
--  O FOCO DAS FOTOS PADRÃO DA PÁGINA INICIAL PASSA A SER AJUSTÁVEL
-- ============================================================================
--
--  Juan, 07/10/2026, gravando um vídeo da home: "Eu não tô conseguindo arrumar
--  o centro focal. De nenhuma das fotos." e "tá cortando a cabeça da mulher".
--
--  A tela do admin (`/painel/admin/home`) só deixava marcar o foco numa foto
--  TROCADA — o foco mora na linha de `fotos_da_home`, que só existe para foto
--  trocada. As fotos padrão têm o foco escrito no código
--  (`config/home-demonstracao.ts`), e a tela dizia "o foco da foto padrão vem
--  do site". Só que as fotos de verdade da Carol e do Juan SÃO as padrão: quem
--  quisesse mexer no recorte tinha de trocá-las por elas mesmas, ou pedir uma
--  publicação de código por foto.
--
--  ── POR QUE UMA TABELA À PARTE, E NÃO UMA LINHA EM `fotos_da_home` ────────
--
--  Aquela linha É a troca: `chave` é obrigatória e a mescla ignora linha sem
--  chave válida ("linha ruim"). Afrouxar a regra faria toda a lógica da troca
--  (a tela dizendo "trocada", a varredura de órfãos, o "Voltar à padrão" que
--  apaga o arquivo) passar a conviver com uma linha que não é troca nenhuma.
--
--  Aqui é só o ajuste: uma linha por lugar cujo foco o admin mexeu, valendo POR
--  CIMA do foco do código. Foto trocada continua com o foco da própria linha —
--  este aqui só vale enquanto o lugar usa a foto padrão. Apagar a linha devolve
--  o foco que vem com o site.

create table if not exists focos_da_home (
  lugar        text primary key,
  foco_x       smallint not null check (foco_x between 0 and 100),
  foco_y       smallint not null check (foco_y between 0 and 100),
  ajustado_em  timestamptz not null default now(),
  ajustado_por uuid references tenants(id) on delete set null
);

comment on table focos_da_home is
  'Foco (em %) das fotos PADRÃO da página inicial que o admin ajustou, por lugar. Vale por cima do foco de src/config/home-demonstracao.ts; foto trocada usa o foco de fotos_da_home.';
