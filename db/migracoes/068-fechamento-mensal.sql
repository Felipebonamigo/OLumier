-- ============================================================================
--  O FECHAMENTO MENSAL DA PLATAFORMA
-- ============================================================================
--
--  Felipe, 09/10/2026, olhando a Administração: "aqui vamos separar por mês as
--  contas também, para termos o controle dos custos, gastos, etc."
--
--  A tela mostra o mês de HOJE: quantos pagam, quanto entra, quanto custa o que
--  está guardado, quanto sobra. Nada disso tinha memória — no dia 1º o número
--  de ontem sumia, e "quanto custou setembro?" não tinha resposta. O Caixa dos
--  sócios já separa o DINHEIRO por mês, mas lendo o Asaas; o que o Asaas não
--  sabe (quantas contas pagavam, quanto espaço estava guardado, quanto era o
--  custo fixo) só existe como retrato do dia.
--
--  Esta tabela é a memória: uma linha por mês (AAAA-MM, em Brasília), com os
--  MESMOS números que a tela mostra, calculados pelas mesmas funções
--  (`resumoDaPlataforma`) — para o mês fechado não discordar do mês aberto.
--
--  ── COMO UMA LINHA NASCE E FECHA ──────────────────────────────────────────
--
--  O temporizador diário que já roda às 04:50 (`limpar-lixeira.mjs`) regrava a
--  linha do mês CORRENTE. No último dia do mês ela fica com o retrato da
--  madrugada dele, e no dia 1º a escrita passa para a linha seguinte: a anterior
--  nunca mais é tocada (`gravarFechamentoDoMes` só escreve no mês de hoje).
--  `registrado_em` diz quando foi a última escrita — a tela mostra, para
--  ninguém tomar por número de fim de mês o retrato de uma semana antes.
--
--  ── O QUE NÃO ESTÁ AQUI, DE PROPÓSITO ─────────────────────────────────────
--
--  Mês anterior à primeira escrita NÃO é reconstruído. Quantas contas pagavam
--  em julho não é recuperável: o banco guarda o status de HOJE, não o de
--  julho. Um número estimado por trás passaria por medido — a tela mostra
--  "sem registro" nesses meses, e só os cadastros (que têm data) são exatos.
--
--  Nem o dinheiro de caixa mora aqui: o recebido de um mês é lido do Asaas no
--  Caixa dos sócios, que é a fonte. Aqui está a RECEITA RECORRENTE (o que as
--  contas que pagam rendem por mês), a mesma do bloco Dinheiro.

create table if not exists fechamentos_mensais (
  mes                      text primary key
                           check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  registrado_em            timestamptz not null default now(),

  -- as contas
  estudios                 integer not null check (estudios >= 0),
  novos                    integer not null check (novos >= 0),
  pagando                  integer not null check (pagando >= 0),
  em_teste                 integer not null check (em_teste >= 0),
  inadimplentes            integer not null check (inadimplentes >= 0),
  cancelados               integer not null check (cancelados >= 0),
  cortesias                integer not null check (cortesias >= 0),

  -- o espaço
  bytes_guardados          bigint  not null check (bytes_guardados >= 0),

  -- o dinheiro, em centavos, como o bloco Dinheiro (`resumoDaPlataforma`)
  receita_centavos         integer not null,
  custo_guardado_centavos  integer not null,
  custo_fixo_centavos      integer not null,
  cortesias_centavos       integer not null,
  resultado_centavos       integer not null
);

comment on table fechamentos_mensais is
  'Uma linha por mês (AAAA-MM, Brasília) com os números do painel de administração. Regravada todo dia no mês corrente e congelada quando o mês vira. Mês sem linha = sem registro (nada é reconstruído).';
