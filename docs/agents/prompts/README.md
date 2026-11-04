# Prompts de delegação

Modelos de brief para cada papel do ciclo (`../ciclo-de-desenvolvimento.md`). Um subagente do T3 Code recebe **só o prompt da tarefa**: não herda o `AGENTS.md` nem o histórico de quem delegou. Por isso cada modelo manda ler o que precisa e é autocontido.

| Arquivo | Papel | Quem delega | Alvo no T3 Code |
|---|---|---|---|
| `planejador.md` | Planejador e orquestrador de uma issue | Orquestrador (sessão principal) | Thread da issue (`t3_thread_launch` com worktree) |
| `backend.md` | Implementador de backend, sync e tarefas mecânicas | Planejador | `delegate_task`, `role: implementation` |
| `ui.md` | Implementador de UI | Planejador | `delegate_task`, `role: implementation` |
| `revisor.md` | Revisor independente e dono da esteira | Planejador | `delegate_task`, `role: review`, **sempre novo** |

## Como usar

1. Copie o modelo e troque os campos `{{...}}` (nº da issue, branch, arquivos, critérios).
2. Passe o texto como `task` do `delegate_task` (ou como `message` do `t3_thread_launch`, no planejador). O modelo vai em `target`, conforme a tabela de papéis do manual.
3. As skills (`/implement`, `/tdd`, `/code-review`, `pr`) vêm de `.agents/skills/`; o brief manda invocá-las.
4. Mudou a regra do ciclo? Atualize o manual e estes modelos juntos.
