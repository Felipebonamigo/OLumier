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
