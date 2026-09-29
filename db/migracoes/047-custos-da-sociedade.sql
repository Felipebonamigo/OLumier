-- ============================================================================
--  OS CUSTOS DA SOCIEDADE — Galeria Átomo e Atomatiza numa lista só
-- ============================================================================
--
--  Felipe, 29/09/2026: "talvez seja melhor unificar em uma página admin os
--  custos, receitas e etc, falando de atomatiza e galeria juntos. Porque é os
--  mesmos 3 sócios nos 2 sistemas. Só muda a porcentagem de cada um para cada
--  sistema." — e, com a proposta na mão: "sim, faz a página caixa dos sócios".
--
--  A receita a página lê do Asaas, que é uma conta só para os dois produtos.
--  O custo não tem de onde ler: a Galeria tinha os fixos dela escritos em
--  código (`src/config/custos-fixos.ts`) e o Atomatiza não tinha nenhum. Esta
--  tabela é a lista que os sócios mantêm pela tela, sem precisar publicar.
--
--  ── O CUSTO DOS DOIS É CONTADO UMA VEZ ────────────────────────────────────
--
--  DAS-MEI e VPS são do mesmo CNPJ e do mesmo servidor para os dois produtos.
--  Em `custos-fixos.ts` eles entram INTEIROS na conta da Galeria, de propósito
--  (é o número conservador: se a Galeria se paga carregando a conta toda, se
--  paga em qualquer rateio). Numa conta da sociedade, somar de novo
--  do lado do Atomatiza contaria duas vezes a mesma fatura — por isso
--  `sistema = 'os-dois'`.
--
--  ── O PONTO DE PARTIDA ────────────────────────────────────────────────────
--
--  As linhas abaixo são os valores de `custos-fixos.ts` nesta data, com a
--  mesma marca de "estimativa". Os do Atomatiza não existem em lugar nenhum
--  do código; ficam para os sócios cadastrarem na tela. `chave` só serve para
--  a semente não se repetir se a migração rodar de novo.

create table if not exists custos_da_sociedade (
  id                uuid primary key default gen_random_uuid(),
  chave             text unique,
  nome              text not null check (length(btrim(nome)) between 1 and 80),
  sistema           text not null check (sistema in ('galeria', 'atomatiza', 'os-dois')),
  centavos_por_mes  integer not null check (centavos_por_mes between 0 and 10000000),
  confirmado        boolean not null default false,
  nota              text not null default '' check (length(nota) <= 300),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid references tenants(id) on delete set null
);

comment on table custos_da_sociedade is
  'Custos mensais dos dois produtos (Galeria Átomo e Atomatiza), mantidos pelo admin em /painel/admin/caixa. sistema = os-dois conta uma vez só.';

insert into custos_da_sociedade (chave, nome, sistema, centavos_por_mes, confirmado, nota) values
  ('das-mei', 'DAS-MEI', 'os-dois', 7600, false,
   'Estimativa: muda todo ano com o salário mínimo. Conferir no carnê do MEI. Mesmo CNPJ para os dois produtos.'),
  ('vps', 'VPS Hostinger KVM2', 'os-dois', 5000, false,
   'Estimativa: conferir na fatura da Hostinger. Hospeda a Galeria, o Atomatiza e outros sites.'),
  ('dominio', 'Domínio olumier.com.br', 'galeria', 333, false,
   'Estimativa: ~R$ 40/ano no Registro.br, diluídos em 12 meses.'),
  ('servidor-zip', 'Servidor de ZIP (Hetzner Cloud)', 'galeria', 6500, false,
   'Estimativa: ~€ 9 a 10/mês com IOF. Conferir na fatura da Hetzner.'),
  ('contabilidade', 'Contabilidade', 'os-dois', 0, true,
   'MEI não exige contador. Vira custo no dia em que a empresa virar ME.')
on conflict (chave) do nothing;
