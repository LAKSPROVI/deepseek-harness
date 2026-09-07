# Operate Equipe de agentes with Agent Teams

English | [中文](agent-teams.zh.md)

Agent Teams gives one Lead up to nine named teammates in the same workspace. Each teammate can use its own LLM provider, model, and persona. The Team keeps its roster, task board, peer messages, and structured debate in the Lead session, so the state survives a page reload and a cold resume.

Use Agent Teams when the task benefits from distinct roles, independent model routes, explicit criticism, or human-controlled synthesis. A Team coordinates work; it does not prove that an answer is correct, isolate files, or replace review.

## 1. Prepare the routes

Open **Settings → Models** and configure every provider and model you intend to assign. Test each route before starting important work. A teammate can be created with a valid route even when that provider later rejects a request because of quota, credentials, or service availability; the roster preserves the selected route and the child history preserves the provider error.

## 2. Start a Team session

Choose a workspace, select the **Equipe de agentes** Agent preset, and create a session. Send the Lead a concrete objective and state that you want an Agent Team. The Team tools are available only in this preset; selecting another preset does not add their schemas or collaboration policy.

The Lead is participant 1. The maximum roster is the Lead plus nine teammates. All members share the workspace and see file changes immediately.

## 3. Open the Equipe de agentes tab

After the first prompt is accepted, open **Equipe de agentes** beside **Chat** and **Trajectory**. The operational view uses Brazilian Portuguese labels and contains:

- **Integrantes** — durable names, roles, provider/model/persona, and live status;
- **Tarefas** — the shared task graph and advisory write scopes;
- **Debate** — topic, participants, phase, round, status, and transition history;
- **Criar integrante** — teammate identity, initial objective, context, and route;
- **Orientar integrante** — a durable quiet or waking message to one teammate.

Use **Atualizar status** when a teammate has finished, failed, or resumed outside the currently displayed state.

## 4. Create teammates

In **Criar integrante**, fill these fields:

| Field | Meaning |
|---|---|
| **Nome** | Immutable lower-kebab-case name such as `security-reviewer`; it cannot be `lead`, reused, renamed, or deleted. |
| **Descrição** | Short responsibility shown in the roster and child catalog. |
| **Instrução inicial** | The teammate's first objective. Include expected output and evidence. |
| **Contexto** | **Começar sem histórico** starts without Lead history. **Copiar histórico concluído** copies the Lead's completed-turn prefix once. |
| **Provider de LLM** | Select a configured provider, or keep **Herdar provider e modelo da líder** to inherit the Lead route at creation. |
| **Modelo** | Select one model from the chosen provider. An explicit provider requires an explicit model. |
| **Persona** | Additional system persona for this teammate only. |

Create distinct roles rather than duplicate generalists. A practical three-person roster is a Lead, an implementer, and a verifier using a different model or provider. Failed provisioning still reserves the name, so correct the route and use a new name.

## 5. Coordinate work

Give each teammate one responsibility, expected deliverable, and non-overlapping write scope. Write scopes are warnings, not locks: Bash, formatters, generators, and external programs can still modify the same files. The Lead must inspect the final diff and reconcile conflicts.

Use **Orientar integrante** with:

- **Apenas deixar na fila** to store guidance without waking an inactive teammate;
- **Acordar e orientar** to make the message the teammate's next turn and cold-resume it if needed.

A queued message is already durable. Do not resend it merely because immediate delivery did not occur. Use **Interromper tarefa** only to cancel that teammate's current turn; interruption does not pause the debate, clear queued guidance, or release task ownership.

## 6. Run a structured debate

Enter one decision or question, select two through ten active participants, choose the maximum rounds, and select **Iniciar debate**. The protocol advances in this order:

1. **posições** — each participant states a position and evidence.
2. **crítica** — participants identify weaknesses and missing evidence.
3. **réplica** — participants answer the critiques.
4. **verificação** — claims, tests, and sources are checked.
5. **síntese** — the Lead records agreement, disagreement, uncertainty, and next action.

Use **Avançar fase** only after the required contributions are present. **Pausar protocolo** freezes phase advancement but does not cancel running model turns. **Retomar protocolo** reopens advancement. **Concluir debate** is available from active synthesis; advancing the final synthesis begins another round until the configured round cap, then completes the debate.

Every transition uses the currently displayed revision. If another actor changed the debate first, refresh the state and apply the action again to the new revision instead of overwriting it.

## 7. Reload and continue

Reload the page or reopen the Lead session. The roster, teammate routes and personas, task board, current debate, and transition history reappear. An inactive teammate can be resumed by waking guidance. Changing the Lead's model later does not retarget teammates that have explicit routes.

## Read status correctly

- **em execução** — a model turn is active.
- **ocioso** — the teammate is live but has no active turn.
- **inativo** — the durable teammate exists but is not currently resident; waking guidance can resume it.
- **em criação/falhou** — creation has not reached an active member or ended with a durable failure.
- **debate ativo/pausado/concluído** — protocol state, independent of member runtime status.

## Troubleshooting

| Symptom | Action |
|---|---|
| The **Equipe de agentes** tab is absent | Confirm the session uses the **Equipe de agentes** preset and has accepted its first prompt. |
| A provider returns quota or authentication failure | Fix that provider in **Settings → Models**, then create a new teammate name or use a working route. The existing failure remains part of the durable record. |
| A teammate is inactive | Send **Acordar e orientar**. Do not recreate the same name. |
| Guidance says queued | Treat it as accepted durable work; do not retry. Wake the teammate when execution is required. |
| Debate action reports stale state | Refresh the Team view and retry against the displayed revision. |
| Pause did not stop a running response | This is expected. Use **Interromper tarefa** for the member; pause controls only protocol advancement. |
| Two agents edited the same file | Stop overlapping work, inspect the diff, assign explicit ownership, and reconcile manually. Write scopes are advisory. |
| State differs after restart | Reopen the exact Lead session. A different session is a different Team even in the same workspace. |

## Further reference

- [Agent Teams subsystem map](../../subsystems/agent-team.md)
- [Operating Agent Teams for agents and maintainers](../../cookbook/operating-agent-teams.md)
- [Configure model providers](providers.md)
