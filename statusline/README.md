# Status line

Configuração da status line personalizada do Claude Code. O script desenha a linha de baixo com pasta, branch, custo, duração, contexto e modelo.

## Instalação

1. Copie o script para a pasta home:

   ```
   cp statusline/statusline-command.sh ~/.claude/statusline-command.sh
   chmod +x ~/.claude/statusline-command.sh
   ```

2. Adicione ao `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "~/.claude/statusline-command.sh",
       "padding": 0
     }
   }
   ```

## Custo por modelo

O valor de 💰 sai do `~/.claude/mods-state/cost-usd.json`, gravado pelo plan-progress com o custo já calculado por modelo. Sem esse arquivo, o script usa o custo do engine. Um `⚠` indica custo parcial, com modelo fora da lista de preços.
