# Importar galerias — o acervo de outro lugar, de uma vez

**Status (30/09/2026):** construída e testada na bancada (Chromium de verdade,
banco e armazém locais). **Ainda não foi usada com um acervo real**, nem com um
ZIP baixado do Pixieset — ver "O que falta validar".

Tela: `/painel/importar`, com o botão "Importar várias" ao lado de "Nova
galeria".

## Por que existe

Felipe, 30/09/2026: "o usuário que tem umas 80 galerias vai ter que baixar 80
zips e abrir 80 coisas diferentes, é muito trabalhoso". E: "criar várias
galerias de uma vez, apenas colocando a pasta, e o nome da galeria que quer
salvar, com a data opcional".

## Como funciona

1. A pessoa escolhe (ou arrasta) **uma pasta** e/ou **vários ZIPs**. Pode somar.
2. A tela propõe as galerias:
   - **pasta**: cada subpasta é uma galeria; as pastas de dentro dela viram
     capítulos, pela mesma regra do envio comum (`lib/capitulos-pasta.ts`).
     Para a pasta de um casamento só, há a opção "é UMA galeria só";
   - **ZIP**: cada ZIP é uma galeria; as pastas de dentro (os sets) viram
     capítulos;
   - a **data** sai do nome da pasta quando ele traz uma data que existe
     ("2025-03-14 Ana e Pedro", "Ana 14.03.2025");
   - **linhas com o mesmo nome viram uma galeria só**. É o que junta as partes
     de um ZIP dividido ("… - Part 2.zip" já sugere o mesmo nome).
3. A pessoa confere nome e data (opcional) de cada linha e aperta "Criar N
   galerias e enviar".
4. As galerias nascem **sem publicar**, com o padrão de aparência do estúdio. A
   fila de envio é a mesma da aba Fotos: três de cada vez, com retentativa e
   pausa, direto do navegador para o armazenamento.

**Rodar de novo é seguro.** Se já existe uma galeria com o mesmo nome, os
arquivos vão para ela, e os que já estão lá (pelo nome) são pulados. É o
caminho para quando a conexão cai no meio de 400 GB: importar a mesma pasta de
novo. Para criar outra galeria de mesmo nome, basta mudar o nome na linha.

## As peças

| Arquivo | O que faz |
|---|---|
| `src/lib/zip-leitor.ts` | Lê ZIP no navegador sem biblioteca: só o índice no começo; cada arquivo é aberto na vez dele (fatia do `File` se guardado, `DecompressionStream` se comprimido). ZIP64 incluso. |
| `src/lib/importacao.ts` | As regras: pasta/ZIP → linhas → galerias. Só lógica. |
| `src/components/envio-em-curso.tsx` | A fila passou a aceitar uma galeria por lote e arquivos "adiados" (de dentro de ZIP). A aba Fotos não mudou de comportamento. |
| `src/app/painel/importar/actions.ts` | Cria as galerias (ou reencontra as existentes) antes do primeiro arquivo subir, depois do mesmo portão de cobrança da rota de envio. |
| `src/components/importar-galerias.tsx` | A tela. |
| `src/components/migrar-do-pixieset.tsx` | A seção "Vindo do Pixieset?". |

Testes: `scripts/testar-zip-leitor.mjs` (ZIPs do Info-ZIP, do Python e do nosso
escritor, com e sem compressão, com ZIP64, com senha, cortados) e
`scripts/testar-importacao.mjs` (as regras).

## Limites conhecidos

- **A página precisa ficar aberta até o fim.** Sair dela para o envio (o aviso
  de saída pergunta antes). É o mesmo limite do envio comum, agora com mais
  tempo em jogo.
- **Busca por rosto não roda na importação.** As fotos importadas entram na
  fila de "ainda não medidas" da galeria, se ela ligar a busca depois.
- **ZIP dentro de pasta arrastada é ignorado**: ZIPs precisam ser soltos ou
  escolhidos diretamente.
- **Nome de ZIP que não é UTF-8 nem marcado** (ZIPs antigos do Windows) é lido
  como latin-1: acento pode sair trocado no nome do capítulo. A pessoa corrige
  o nome da galeria na revisão; o do capítulo, depois, no painel.

## Pixieset com login e senha — NÃO ligado

Felipe pediu a opção "com login e senha, mas avise dos riscos, e que o
recomendado é colocar o zip". A tela mostra a opção, os riscos e a
recomendação — e diz que **ainda não está disponível**, com os campos
desativados. Não há código que entre no Pixieset.

Por quê:

- o Pixieset não tem API pública nem OAuth. A única documentação é de
  terceiros, por engenharia reversa
  ([Trozz/pixieset-api-docs](https://github.com/Trozz/pixieset-api-docs)), e
  **não descreve o login nem o download do original**;
- o ambiente onde isto foi construído **não alcança o pixieset.com** (bloqueio
  de rede), então não havia como mapear nem testar nada. Escrever o conector
  às cegas seria entregar um botão que provavelmente não funciona;
- pelo que a busca indicou, os termos do Pixieset não permitem acesso por
  endereços não documentados. O texto exato precisa ser lido por alguém.

Para ligar, nesta ordem:

1. **Decisão dos sócios, com leitura jurídica** dos termos do Pixieset: o risco
   de bloqueio é da conta do fotógrafo, e a senha dele trafega pelo nosso
   sistema.
2. **Uma conta real do Pixieset** com algumas coleções, para mapear no
   navegador (ferramentas de desenvolvedor) como é o login (há captcha? duas
   etapas?), como listar as coleções e como baixar o original.
3. **Uma máquina à parte para copiar**, no molde do servidor de ZIP
   (`docs/servidor-zip.md`): o arquivo não pode passar pelo VPS. Ela também
   precisaria gerar as miniaturas, que hoje só o navegador gera
   (`lib/derivadas-client.ts`).
4. A senha **nunca** gravada: usada uma vez para abrir a sessão e descartada.

## O que falta validar

- **Um ZIP de verdade do Pixieset.** Não confirmamos se os sets vêm em pastas
  dentro do ZIP, nem como as partes de uma coleção grande são nomeadas. Se os
  sets não vierem em pastas, a importação funciona, mas sem capítulos. Se as
  partes tiverem outro padrão de nome, a pessoa junta à mão dando o mesmo nome.
- **Um acervo grande** (dezenas de galerias, centenas de GB) numa conexão de
  casa, do começo ao fim.
- **Nomes com acento via seletor de pasta**: coberto no teste do ZIP e das
  regras; no navegador automatizado, o Playwright entrega arquivo de pasta com
  acento com 0 bytes (defeito dele — o arquivo no disco tem o tamanho certo),
  então essa combinação foi conferida com nome sem acento.

## Marca e comunicação

A importação é recurso **em teste**, não validado. Pela estratégia de marca
(`docs/estrategia-de-marca.md`, §20 e o aviso do topo), ela não entra em
comunicação pública ("migre do Pixieset") antes de passar por um acervo real,
e citar concorrente pelo nome em material público é decisão da camada
estratégica. Dentro do painel, o nome "Pixieset" aparece porque é a palavra que
o fotógrafo que vem de lá procura.
