# AGENTS.md — Sviluppo meteo-italia-mcp

## Identità

Progetto: **meteo-italia-mcp** — Analisi meteo multi-modello Italia.
Stack: TypeScript MCP server (Open-Meteo, DPC, ARPA, CheckWX, DMI, floods.it).
Le istruzioni per l'agente vivono nel server (`instructions`, prompt MCP), non in file skill.

## Regole Sviluppo

### 1. CAVEMAN MODE OBBLIGATORIO

Tutta la comunicazione con l'agente DEVE usare **caveman mode** (stile compresso).
- Niente preamboli, niente fluff, niente status narration.
- Output compatti, tecnici, diretti al punto.
- `skill(name="caveman")` se necessario per attivazione esplicita.

### 2. MCP-First

- Usa tool MCP dedicati per ogni dato meteo.
- Se MCP non disponibile → stima interna dichiarata come tale.

### 3. Codice

- **TypeScript strict**. Nessun `as any`, `@ts-ignore`, `@ts-expect-error`.
- **Error handling**: usa `MeteoError` per errori strutturati. Mai catch vuoti.
- **Niente over-engineering**: fix minimale, niente refactor mentre si fixa.
- **Duplicazione > astrazione prematura**.
- **Sync documentazione**: ogni modifica ai tool MCP (nuovo tool, rename, cambio firma, cambio comportamento) DEVE essere riflessa in `README.md` (tool table + breaking changes) e, se cambia il flusso d'uso, in `mcp/src/instructions.ts`. Nessuna eccezione.

### 4. Git

- **Commit atomici**: ogni commit = un cambiamento logico. Separa fix, refactor, feature in commit distinti.
- **Push solo a task completato**: mai pushare lavoro in corso. Accumula commit locali, poi push unico al termine.
- Su richiesta esplicita: commit messaggi conventional commit con caveman-commit.
- Mai `--no-verify`, mai force-push.
- Prima di commit: `git status`, `git diff`, `git log --oneline -10`.

### 5. Workflow

- **Todo**: obbligatorio per task multi-step. `todowrite` prima di iniziare.
- **Verifica**: `lsp_diagnostics` + build + test. Mai "should work".
- **Background parallel**: esplorazioni indipendenti vanno in parallelo.

### 6. Struttura

```
mcp/           — MCP server TypeScript (npm, tsc, node dist/index.js)
  src/          — sorgenti
    __tests__/  — test
  dist/         — build (gitignored)
.omo/          — configurazione OpenCode
AGENTS.md      — questo file
```

### 7. Comandi Rapidi

| Comando | Azione |
|---------|--------|
| `/caveman` | Comunicazione compressa |
| `/caveman-commit` | Commit message compresso |
| `/review-work` | Review post-implementazione |
| `/verification-before-completion` | Verifica prima di claim done |

### 8. Categorie Delega

| Dominio | Categoria |
|---------|-----------|
| UI / frontend | `visual-engineering` |
| Logica complessa | `ultrabrain` |
| Ricerca + implementazione | `deep` |
| Fix semplice (1 file) | `quick` |
| Documentazione | `writing` |

---

**Principio guida**: output compresso, zero sprechi, massima efficienza.
Parla come un senior engineer — tecnico, diretto, senza fronzoli.
