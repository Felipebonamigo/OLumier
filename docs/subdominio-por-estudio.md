# Subdomínio por estúdio

`siriusfotografia.fotonio.com.br/lu-marino` — cada estúdio com seu endereço.

## Estado

| Parte | Situação |
|---|---|
| Código (roteamento, página do estúdio, porteiro do certificado) | ✅ pronto e testado |
| Caddy no servidor | ✅ configurado, todos os sites verificados no ar |
| Registros DNS na Cloudflare | ❌ **falta você criar** |
| Troca de nameservers | ❌ **falta você fazer** |

## O que falta — na ordem (a ordem importa!)

### 1. Criar os registros NA CLOUDFLARE (antes de trocar qualquer coisa)

A zona da Cloudflare está **vazia de registros A** — ela só importou os MX/TXT
que existiam quando o site foi adicionado. Os registros A você criou depois, no
Registro.br. **Trocar os nameservers agora derrubaria o domínio.**

Cloudflare → `fotonio.com.br` → DNS → Add record:

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `@` | `179.197.233.184` | **DNS only (cinza)** |
| A | `www` | `179.197.233.184` | **DNS only (cinza)** |
| A | `*` | `179.197.233.184` | **DNS only (cinza)** |

O `*` é o motivo de precisarmos da Cloudflare: o Registro.br **não aceita
curinga** (a tela dele avisa: *"Não são aceitos os caracteres '@' e '*'"*).

⚠️ Nuvem **cinza**. Com o proxy laranja, o Caddy não consegue emitir certificado.

### 2. Desativar o DNSSEC no Registro.br

Trocar os nameservers com DNSSEC ativo faz o domínio **parar de resolver**, com
erro difícil de diagnosticar.

### 3. Trocar os nameservers no Registro.br

Para `dayana.ns.cloudflare.com` e `rodrigo.ns.cloudflare.com`.

Como os registros já vão estar esperando na Cloudflare, a troca é sem queda.

## Como funciona o certificado (e por que NÃO é curinga)

Cada estúdio ganha seu próprio certificado na primeira visita (*on-demand TLS*).

**Por que não curinga:** um certificado `*.fotonio.com.br` exige desafio DNS-01,
que exige o módulo de DNS da Cloudflare compilado no Caddy. O binário do servidor
não tem esse módulo, e trocá-lo num servidor com sete sites em produção seria
risco desnecessário.

### ⚠️ A armadilha que já nos mordeu

A primeira tentativa usou `*.fotonio.com.br` como **endereço do site** no
Caddyfile. Isso faz o Caddy tentar obter um certificado curinga de verdade por
ACME — que falha sem o módulo de DNS — e **essa falha derrubou o TLS do
`www.fotonio.com.br`**, que estava funcionando.

A configuração correta usa `https://` genérico com **matcher de host**:

```caddy
https:// {
	tls {
		on_demand
	}
	@estudio header_regexp host Host ^[a-z0-9-]+\.fotonio\.com\.br$
	route @estudio {
		encode gzip
		reverse_proxy localhost:3300
	}
	route {
		abort
	}
}
```

Assim o Caddy não tenta certificado curinga; cada subdomínio recebe o seu.

### O porteiro (`/api/tls/permitir`)

Sem ele, o Caddy tentaria emitir certificado para **qualquer** domínio apontado
ao nosso IP. Alguém apontando mil subdomínios nos levaria ao limite de emissão da
Let's Encrypt — derrubando a emissão de **todos os sites do servidor**.

Só respondemos "pode" para subdomínio de estúdio que existe no banco.

## Como conferir depois do DNS pronto

```bash
node --env-file=.env.local scripts/testar-subdominio.mjs
```

E na prática: criar uma conta em produção e abrir `<slug>.fotonio.com.br`.
O certificado é emitido na primeira visita (leva alguns segundos).

## Detalhes do comportamento

- A **raiz** do subdomínio lista as galerias públicas e **sem senha** do estúdio.
  Galeria protegida não aparece: listá-la entregaria a existência da entrega de
  um casal para qualquer visitante.
- O **painel** não abre por subdomínio de estúdio — redireciona para o domínio
  principal, senão haveria dois endereços para a mesma tela e o cookie de sessão
  não valeria nos dois.
- É **reescrita**, não redirecionamento: o visitante continua vendo o endereço
  bonito.
- Subdomínios reservados (`www`, `app`, `admin`, `api`…) nunca viram estúdio.

## Backups do Caddyfile no servidor

- `/etc/caddy/Caddyfile.antes-subdominio` — antes de qualquer mudança
- `/etc/caddy/Caddyfile.com-curinga` — a tentativa que quebrou o www (não usar)
