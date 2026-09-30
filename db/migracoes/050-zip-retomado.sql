-- ============================================================================
--  O ZIP QUE CAIU E VOLTOU, E O PEDAÇO QUE NÃO É ENTREGA
-- ============================================================================
--
--  Felipe, 29/09/2026, com o print do painel: "13 de 21 downloads de ZIP
--  caíram no meio". A conta estava certa sobre as CONEXÕES e errada sobre os
--  DOWNLOADS. O servidor de ZIP gravava:
--
--    · 'abortado' sempre que a conexão fechava antes do fim — inclusive quando
--      o próprio navegador fecha a primeira e abre outra (o Chrome do Android
--      passa o download para o gerenciador do sistema; o "Retomar" pede o
--      resto numa conexão nova);
--    · 'servido' sempre que uma resposta terminava — inclusive quando era só
--      um PEDAÇO do arquivo (um Range que não chega ao fim, como os de um
--      acelerador de download). Cada pedaço virava um "baixou tudo" na
--      Atividade do fotógrafo.
--
--  Duas mudanças:
--
--  1. 'trecho': um Range que terminou sem chegar ao fim do arquivo. Conta
--     tráfego, não conta entrega. 'servido' passa a querer dizer que o ZIP
--     chegou ao ÚLTIMO byte — na conexão inteira ou na que retomou.
--
--  2. `retomado`: o abortado que foi seguido de uma entrega completa do mesmo
--     ZIP pela mesma pessoa. É marcado NA HORA da entrega, e não calculado no
--     fim do mês, porque o que liga as duas linhas é o pedido — e o pedido é
--     apagado 12 h depois de criado (`pedido_id` vira nulo aqui).
--
--  Linhas anteriores ficam como estão: não há como saber, olhando para trás,
--  qual 'servido' era pedaço. O painel conta o mês corrente, e o mês vira em
--  01/10/2026.
-- ============================================================================

alter table entregas_zip drop constraint if exists entregas_zip_evento_check;
alter table entregas_zip
  add constraint entregas_zip_evento_check
  check (evento in ('montado','servido','abortado','despejo','trecho'));

alter table entregas_zip
  add column if not exists retomado boolean not null default false;

comment on column entregas_zip.retomado is
  'Só em ''abortado'': a mesma pessoa completou o mesmo ZIP depois (na mesma '
  'conexão retomada ou num clique novo, em até 12 h). Não é queda de verdade.';
