-- O STATUS `cortesia`: acesso de pagante, receita de zero.
--
-- ── DE ONDE VEIO (09/09/2026) ──────────────────────────────────────────────
--
-- A Carol bateu no teto de 10 GB do período de teste no meio de um envio de
-- 1401 fotos. A saída da hora foi marcá-la como `ativo`, e ela resolveu o
-- problema imediato — mas `ativo` quer dizer PAGANTE no resto do sistema: é o
-- que `receitaMensalCentavos` soma para responder "quanto entra por mês".
--
-- Uma conta de cortesia ali dentro é receita que não existe entrando na conta
-- que o dono usa para decidir. Com uma, dá para lembrar; com três — ele, a
-- Carol, o Juan — vira um erro permanente no número que mais importa.
--
-- ── POR QUE UM STATUS, E NÃO UMA COLUNA `cortesia boolean` ────────────────
--
-- Porque as situações são MUTUAMENTE EXCLUSIVAS, e o `check` da coluna já diz
-- isso. Uma bandeira separada permitiria `status='cancelado' AND cortesia=true`
-- — um estado que ninguém sabe ler, e que cada lugar do código resolveria de um
-- jeito. Somar um valor à lista mantém a pergunta única: "em que situação esta
-- conta está?".
--
-- ── O QUE MUDA, E O QUE NÃO MUDA ──────────────────────────────────────────
--
-- Não muda quase nada, e isso é o bom sinal: o código já perguntava "é trial?"
-- onde a pergunta certa era essa. `quotaEfetivaBytes` e `galeriasNoAr` liberam
-- qualquer status que não seja `trial`, então a cortesia entra sem toque.
-- `receitaMensalCentavos` filtra `= 'ativo'`, então a ignora sozinha.
--
-- O que precisou de mão foi `situacaoDoTenant`, que lista os status um a um: a
-- cortesia caía no `return` de status desconhecido — funcionava por acidente, e
-- um dia em que alguém trocasse esse padrão por um bloqueio, as contas de
-- cortesia parariam de enviar sem ninguém entender por quê.

alter table tenants drop constraint if exists tenants_status_check;

alter table tenants
  add constraint tenants_status_check
  check (status = any (array['trial', 'ativo', 'cortesia', 'inadimplente', 'cancelado']));
