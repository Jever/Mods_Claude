# Mods para Claude Code

Cinco mods e uma status line para o Claude Code. Cada mod mexe em uma parte da tela do chat: a faixa acima do prompt, o painel lateral, ou um comando novo. Todos vêm do marketplace `jeverjm` e podem ser ligados e desligados pelo `/mods`. A status line é uma configuração pessoal versionada na pasta `statusline/`.

| Mod | Versão | O que faz | Como abrir |
| --- | --- | --- | --- |
| [cache-keeper](#cache-keeper) | 0.2.6 | Contagem até o cache esfriar, Manter aquecido e Limpar Sessão | botões acima do prompt |
| [prompt-enhancer](#prompt-enhancer) | 0.3.0 | Reescreve o rascunho do prompt sem enviar e copia para a área de transferência | botão Aprimorar, `/aprimorar` |
| [plan-progress](#plan-progress) | 0.10.0 | Aba Planos (spec e marcos) e aba Subagentes | `/planos`, `/subagentes` |
| [screen-share](#screen-share) | 0.2.0 | Mascara e-mails, telefones, valores e nomes na tela | `/screen-share` |
| [mods](#mods) | 0.4.0 | Painel para ligar e desligar cada mod | `/mods` |

- [Requisitos](#requisitos)
- [Instalação](#instalacao)
- [Como cada mod funciona](#como-cada-mod-funciona)
- [Status line](#status-line)
- [Acompanhamento de planos](#acompanhamento-de-planos)
- [Imagens de uso](#imagens-de-uso)
- [Solução de problemas](#solucao-de-problemas)

## Requisitos

- Claude Code 2.1.287 ou superior. Testado no 2.1.308.
- `python3` no PATH, usado pelo cache-keeper para descobrir se o cache do chat é de 5 minutos ou de 1 hora.
- Para os painéis abrirem sozinhos, o terminal precisa ter pelo menos 144 colunas. Abaixo disso, o painel só abre pelo comando.

<a id="instalacao"></a>
## Instalação

Os mods estão neste repositório, que é também o marketplace `jeverjm`.

### Todos de uma vez

No prompt do Claude Code:

```
/plugin marketplace add Jever/Mods_Claude
/plugin install cache-keeper@jeverjm
/plugin install prompt-enhancer@jeverjm
/plugin install plan-progress@jeverjm
/plugin install screen-share@jeverjm
/plugin install mods@jeverjm
```

Ou pelo terminal, de uma vez:

```bash
claude plugin marketplace add Jever/Mods_Claude
for p in cache-keeper prompt-enhancer plan-progress screen-share mods; do
  claude plugin install "$p@jeverjm"
done
```

Depois, reinicie o Claude Code ou rode `/reload-plugins`.

### Individualmente

Instale só o que quiser. Cada mod funciona sozinho:

```
/plugin install cache-keeper@jeverjm
```

O `mods` é opcional, mas é o único jeito de ligar e desligar os outros pela tela. Sem ele, use `/screen-share` e os comandos de cada mod.

### Remover

```
/plugin uninstall cache-keeper@jeverjm
```

### Atualizar

Quem já instalou pelo GitHub atualiza em duas etapas: primeiro o marketplace, depois os plugins.

No terminal:

```bash
claude plugin marketplace update jeverjm
for p in cache-keeper prompt-enhancer plan-progress screen-share mods; do
  claude plugin update "$p@jeverjm"
done
```

No Claude Code:

```
/plugin marketplace update jeverjm
/plugin update cache-keeper@jeverjm
```

Reinicie o Claude Code depois. A atualização só vale após o reinício.

## Como cada mod funciona

### cache-keeper

Mostra acima do prompt quanto tempo falta até o cache do chat esfriar. O cache é o que deixa a próxima mensagem barata. Depois de esfriar, a próxima mensagem relê o chat inteiro pelo preço cheio.

- **Contagem:** `◷ Cache aquecido 3:12` com uma barra que esvazia. Ao esfriar, mostra `❄ Frio há 7 min`. A duração (5 minutos ou 1 hora) vem do que o Claude gravou nas respostas do chat. Até a primeira resposta, o mod assume 5 minutos.
- **Manter aquecido:** manda um ping pequeno cerca de 45 segundos antes de o cache esfriar. Para sozinho depois de 30 pings, depois de 2 horas, ou quando você envia uma mensagem. Também pelo comando `/keepwarm` e `/keepwarm off`.
- **Limpar Sessão:** gera um briefing do chat, limpa a sessão e cola o briefing no prompt para você continuar em um chat limpo. Também pelo comando `/handoff`. `/handoff colar` recola o último briefing.
- **Handoff automático:** `/autohandoff 75` faz o handoff sozinho quando o contexto chega a 75%. `/autohandoff off` desliga.
- **Aviso de qualidade:** avisa quando o contexto passa de 60%. O valor é configurável no momento da instalação.

Enquanto o chat está respondendo, a faixa mostra `◷ Respondendo...`, porque o cache está sendo usado.

### prompt-enhancer

Reescreve o rascunho que você digitou no prompt, sem enviar. Você revisa e envia depois.

- **Botão Aprimorar** acima do prompt, ou tecla `a`.
- **`/aprimorar`** com o rascunho como argumento, ou sem argumento para usar o texto do prompt.
- **Copia para a área de transferência:** além de preencher a caixa, o resultado é copiado para colar em um bloco de notas ou compartilhar. Um aviso confirma a cópia.

Exemplo ilustrativo. O texto reescrito sai com cinco seções: tarefa, skills sugeridas, contexto do projeto, decisões a confirmar e resultado esperado. Usa o CLAUDE.md, o README e a lista de skills instaladas como contexto. O modelo padrão é `sonnet`, e pode ser trocado na instalação.

Exemplo, com o rascunho `arruma o login`:

```
Tarefa: corrigir o fluxo de login que falha após a expiração do token.
Skills sugeridas: (nenhuma)
Contexto do projeto: ...
Decisões a confirmar comigo antes de começar: ...
Resultado final esperado: o login renova o token sem pedir a senha de novo.
```

### plan-progress

Duas abas no painel lateral: **Planos** e **Subagentes**.

A aba **Planos** mostra a spec e os marcos do projeto. Cada marco tem título, barra de progresso, porcentagem e a lista de tasks expansível. O progresso vem de três fontes, e qualquer uma que marque o marco como concluído conta:

- o roadmap em `docs/superpowers/plans/*roadmap*.md` (coluna "Estado");
- as branches mescladas no git (`git branch --merged`);
- os ledgers de ciclo em `.superpowers/sdd/<ciclo>/progress.md`.

Sem spec e planos do superpowers, a aba cai no plano da sessão (TodoWrite/TaskCreate).

A aba **Subagentes** mostra um card por subagente (nome, tipo, modelo, passo atual, últimos passos, barra e tempo), agrupados em Em execução, Concluídos e Interrompidos, mais recentes no topo. Também mostra os totais: Custo do chat, Tokens totais, Tokens dos subagentes e Tempo.

- `/planos` abre a aba Planos; `/subagentes` abre a aba Subagentes.
- As abas abrem sozinhas quando há plano ou subagente.

O **Custo do chat** é calculado pelos tokens de cada modelo e os preços em `~/.claude/mods-state/cost-models.json`, criado na primeira abertura com uma lista inicial. Edite o arquivo para ajustar os valores. Modelos fora da lista saem do total e aparecem como "Custo parcial".

O custo corrigido também é gravado em `~/.claude/mods-state/cost-<sessão>.json`, que a status line personalizada lê (veja `statusline/README.md`).

### screen-share

Para gravar a tela ou mostrar o chat a alguém, sem vazar dados. Enquanto o modo está ligado, e-mails, telefones, valores em moeda e nomes de pessoas aparecem como barras sombreadas. O Claude continua lendo os dados reais: a mascara é só na tela.

- `/screen-share` liga e desliga. A confirmação diz o estado atual.
- Datas não são mascaradas.

Use o texto de teste abaixo para conferir antes de gravar:

```
Cliente: Ana Exemplo
E-mail de contato: ana.exemplo@example.com
Telefone: +55 11 98765-4321
Receita do mês: R$ 12.345,67
Data de vencimento: 15/03/2027
```

### mods

Painel para ligar e desligar cada mod, sem editar arquivos. Abra com `/mods`.

- **On / Off:** desliga o mod em todos os chats. Vale em até 3 segundos.
- **Shown / Hidden:** para mods que escondem a faixa ou o painel.
- **Open:** para mods com painel lateral, para abri-lo daqui.

Mods instalados que o painel não conhece aparecem no fim da lista, com o nome do plugin. O painel não se mostra na própria lista.

<a id="status-line"></a>
## Status line

A pasta `statusline/` traz a configuração da status line personalizada: o script e a setting `statusLine`. Ela mostra pasta, branch, custo, duração, contexto e modelo, e o custo (💰) vem do `cost-<sessão>.json` gravado pelo plan-progress, já calculado por modelo.

Para instalar, siga o [`statusline/README.md`](statusline/README.md). Em resumo:

1. `cp statusline/statusline-command.sh ~/.claude/statusline-command.sh` e `chmod +x`.
2. No `~/.claude/settings.json`, adicione o bloco `statusLine` com `type: "command"`, `command: "~/.claude/statusline-command.sh"`, `padding: 0` e `refreshInterval: 30`.

Sem a status line, o custo corrigido continua visível na aba Subagentes.

<a id="acompanhamento-de-planos"></a>
## Acompanhamento de planos

Para a aba **Planos** ter utilidade real, o Claude precisa criar e manter os arquivos que ela lê (spec, roadmap, planos e ledgers). A forma mais simples é adicionar esta instrução ao `~/.claude/CLAUDE.md`, que vale em toda sessão nova, em qualquer diretório:

````markdown
## Acompanhamento de planos (plan-progress)

Quando a tarefa for substancial (vários passos ou marcos), crie e mantenha no diretório do projeto os arquivos que o mod plan-progress lê, nesta forma exata:

- Spec: `docs/superpowers/specs/YYYY-MM-DD-<assunto>-design.md`, título na primeira linha (`# <título>`).
- Roadmap: `docs/superpowers/plans/YYYY-MM-DD-roadmap.md`, com uma tabela `| MNN <descrição> | <arquivo-do-plano> | <Estado> |`, onde Estado é `Concluído`, `A iniciar` ou `Planejado`.
- Plano por marco: `docs/superpowers/plans/YYYY-MM-DD-<assunto>-mNN-<slug>.md`, com `# Plano MNN: <título>` e `### Task N: <título>`. O `mNN` precisa estar no nome do arquivo.
- Ledger de ciclo: `.superpowers/sdd/<ciclo>/progress.md` com `Task MNN: complete` por marco concluído, e `.superpowers/sdd/<ciclo>/plan.md` com `### Task MNN: <título>`.
- Git: um branch por marco com `mNN` no nome; o merge conta como concluído.

Fluxo: antes de agir, leia a spec, o roadmap, os planos e `git branch --merged`; crie a linha no roadmap e o arquivo de plano antes de executar um marco novo; execute em branch; ao concluir, marque `Task MNN: complete` no ledger, mude o roadmap para `Concluído` e faça o merge. Nunca deixe esses arquivos desatualizados em relação ao que foi feito.
````

Se você usa o superpowers, os skills `writing-plans` e `executing-plans` automatizam boa parte desse fluxo.

## Solução de problemas

- **Não aparece nada acima do prompt:** confira no `/mods` se o mod está On. Depois rode `/reload-plugins`.
- **O painel não abre sozinho:** o terminal pode estar com menos de 144 colunas. Use `/planos` ou `/subagentes`.
- **O cache não mostra contagem:** é preciso ter pelo menos uma resposta do Claude no chat. Antes disso aparece `◷ Cache ainda não`.
- **A contagem mostra 5 minutos mesmo com assinatura:** o mod só mostra o que o Claude gravou no chat. Se as respostas gravaram cache de 5 minutos, a contagem fica em 5. Dá para conferir no log `~/.claude/mods-logs/cache-keeper.log`, e em `~/.claude/projects/` nas linhas `ephemeral_1h_input_tokens` e `ephemeral_5m_input_tokens`.
- **`python3` não encontrado:** o cache-keeper continua funcionando, mas assume cache de 5 minutos. Instale o `python3` e reinicie o Claude Code.
- **A aba Planos está vazia ou com marcos zerados:** o projeto não tem os arquivos que a aba lê (spec, roadmap, planos e ledgers), ou eles estão desatualizados. Veja [Acompanhamento de planos](#acompanhamento-de-planos).

## Desenvolvimento

Cada mod é uma pasta com `.claude-plugin/plugin.json`, `hooks/` e `types/`. Para rodar os testes de um mod:

```bash
claude plugin test ./cache-keeper
claude plugin validate ./cache-keeper
```
