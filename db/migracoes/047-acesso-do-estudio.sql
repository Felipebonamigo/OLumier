-- ============================================================================
--  QUANDO O FOTÓGRAFO ENTROU PELA ÚLTIMA VEZ
-- ============================================================================
--
--  A tabela do admin mostra, por estúdio, quando o CLIENTE abriu a galeria
--  (`max(acessos.criado_em)`) e quando o estúdio ALTEROU alguma coisa (o mais
--  recente entre editar galeria, subir foto e mexer na conta). Faltava a
--  terceira pergunta, que é a mais simples: essa pessoa ainda entra?
--
--  Não havia como responder. O login não deixava rastro: nem em `eventos`, que
--  registra o que MUDA, nem em `acessos`, que é do convidado da galeria. Um
--  estúdio que abre o painel toda semana e não mexe em nada era, no banco,
--  idêntico a um que sumiu em agosto.
--
--  Felipe, 29/09/2026, depois de eu apontar o custo: "pode fazer também".
--
--  ── POR QUE COLUNA, E NÃO UMA LINHA EM `eventos` ──────────────────────────
--
--  Porque a pergunta é "QUANDO foi a última vez", e não "quantas vezes". Uma
--  linha por passagem faria a tabela de auditoria crescer com o evento mais
--  frequente e menos informativo do sistema, e a leitura do admin viraria um
--  `max()` sobre milhões de linhas. Aqui é uma célula que se sobrescreve.
--
--  ── O CUSTO DE ESCRITA MORA NO CÓDIGO, NÃO AQUI ──────────────────────────
--
--  Escrever a cada requisição autenticada seria caro e inútil: são várias por
--  minuto de quem está trabalhando, todas gravando a mesma informação com um
--  segundo de diferença. `src/lib/acesso-do-estudio.ts` só grava quando a marca
--  tem mais de 15 minutos, e a comparação vive no `where` do próprio UPDATE —
--  duas requisições simultâneas não gravam as duas, porque a segunda casa zero
--  linhas. Ver `scripts/testar-ultimo-acesso-do-estudio.mjs`.
--
--  Nula = nunca entrou desde que isto existe. NÃO quer dizer conta abandonada:
--  toda conta criada antes de 29/09/2026 começa nula, e a tela precisa dizer
--  isso em vez de desenhar um travessão que parece ausência.

alter table tenants add column if not exists ultimo_acesso_em timestamptz;

comment on column tenants.ultimo_acesso_em is
  'Última requisição autenticada deste estúdio, com trava de 15 min. Nulo = sem passagem registrada (inclusive em toda conta anterior a 29/09/2026). Ver src/lib/acesso-do-estudio.ts.';
