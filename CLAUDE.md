@AGENTS.md
@docs/estrategia-de-marca.md

# O nome é Galeria Átomo

O sistema se chama **Galeria Átomo** — domínio `galeriaatomo.com.br`. Fotônio e
Olumier são nomes antigos: continuam só onde trocar quebraria algo (cookie,
buckets, `/opt/fotonio`, o domínio legado em `config/dominios.ts`) e **nunca**
voltam a texto que alguém lê. O nome vem sempre de `marca.nome`
(`src/config/marca.ts`), nunca escrito à mão.

# E ele precisa ser achado no Google

Pedido do Felipe (02/10/2026): a Galeria Átomo tem de aparecer quando alguém
busca por ela. O estado, o que falta e de quem é cada parte estão em
[`docs/seo.md`](docs/seo.md). Ao mexer em página pública:

- página nova da casa usa `metadadosDaCasa` (`src/lib/metadados.ts`): título,
  descrição, canônico e cartão de link próprios — e entra em `src/app/sitemap.ts`;
- página do estúdio (vitrine, galeria) mostra a marca DELE, não a nossa;
- `scripts/testar-seo.mjs` tem de continuar verde, e muda junto quando a regra
  muda — nunca afrouxado para passar.

# E o CI custa minuto

A cota de Actions do repositório privado (2.000 min/mês) acabou em 10/10/2026.
O `Verificar` roda a suíte inteira, ~10 min por rodada; cada push num PR pronto
paga isso de novo.

- **PR nasce rascunho** (`draft: true`). Push em rascunho não roda o `Verificar`.
- Antes de marcar pronto, rode **na própria sessão** `npm run lint` e
  `npm run typecheck`, e as suítes da área mexida que a sessão conseguir subir
  (`scripts/testar-<area>.mjs`). Na sessão é de graça; no CI, não.
- **Marque pronto uma vez, no fim**, com o trabalho inteiro já empurrado. Um push
  depois disso roda a suíte de novo.
- **Uma tarefa, um PR.** Ajuste, correção ou pedido novo dentro da mesma tarefa
  entra no PR que já existe, não num PR novo. Cada PR custa ao menos uma suíte.
- **PR só com o trabalho terminado.** Explorar, testar hipótese e perguntar se é
  isso mesmo acontecem na sessão, antes do PR.
- **Merge não publica.** Publicar é o workflow `Publicar` (`workflow_dispatch`),
  disparado só quando o Felipe pede.
