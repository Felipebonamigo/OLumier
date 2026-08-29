# Galeria Átomo

Galerias de entrega para fotógrafos e filmakers. Multi-tenant: cada estúdio tem
seu endereço (`siriusfotografia.olumier.com.br`), sua marca e seu espaço.

## Banco novo, do zero

`db/schema.sql` é um RETRATO, e ele parou na migração 008. Levantar um banco
funcional é sempre em duas partes — só o retrato deixa o banco anos atrasado, e
só as migrações não têm o que migrar:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
node scripts/migrar.mjs --aplicar
```

É a receita que o CI usa, e é a única testada. (O `--marcar` serve para outra
coisa: registrar como aplicada uma migração que já foi rodada à mão. Num banco
novo ele PULA o que faltava aplicar de verdade.)

## Rodar

```bash
npm install
.\tunel.ps1          # túnel SSH para o Postgres do VPS (deixe aberto)
npm run dev          # http://localhost:3040
npm test             # as 62 suítes (as de HTTP precisam do `npm run dev` de pé)
npm test -- --exigir-tudo   # o mesmo, mas "pulado" conta como REPROVADO
```

`.env.local` a partir de `.env.local.example`. O banco de desenvolvimento é
`fotonio_dev`, no mesmo servidor do de produção — os testes **recusam** rodar
contra qualquer banco que não termine em `_dev`/`_teste`.

## Como está organizado

| Pasta | O que vive ali |
|---|---|
| `src/config/` | Decisões de negócio: planos, marca, aparência, sócios, subdomínios reservados |
| `src/lib/` | Banco, armazenamento (R2), sessão, cofre, cobrança, quota |
| `src/app/(auth)/` | Entrar e cadastrar |
| `src/app/painel/` | O que o fotógrafo usa |
| `src/app/g/`, `src/app/e/` | O que o cliente final vê |
| `src/proxy.ts` | Roteamento por subdomínio (o antigo `middleware.ts`) |
| `db/migracoes/` | Mudanças de estrutura, aplicadas por `scripts/migrar.mjs` |
| `ops/` | Backup e vigia — versionados aqui, instalados no servidor |
| `scripts/` | Testes e ferramentas de manutenção |

**A marca fica só em `src/config/marca.ts`.** Nada mais escreve "Galeria Átomo"
direto; bucket, tabelas e pastas usam termos neutros, para o nome poder mudar
sem migração.

## Publicar

```bash
bash deploy.sh
```

Publica o que está **commitado**. Recusa se houver migração pendente em
produção, se o build falhar, ou se o app subir sem falar com banco e R2.

## Documentação

- [`docs/operacao.md`](docs/operacao.md) — o que roda sozinho, ferramentas, o que falta
- [`docs/backup.md`](docs/backup.md) — backup e restauração (ensaiada)
- [`docs/subdominio-por-estudio.md`](docs/subdominio-por-estudio.md) — DNS, TLS e as armadilhas
- [`docs/ligar-cobranca.md`](docs/ligar-cobranca.md) — passo a passo do Asaas
- [`docs/experiencia-galeria.md`](docs/experiencia-galeria.md) — decisões da galeria pública

## Next 16

Este projeto usa Next 16, onde `middleware.ts` virou `proxy.ts` e `params` é uma
Promise. Ver `AGENTS.md` — os guias oficiais estão em `node_modules/next/dist/docs/`.
