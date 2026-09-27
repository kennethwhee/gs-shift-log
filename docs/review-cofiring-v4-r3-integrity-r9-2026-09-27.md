# Co-firing V4 R3 preservation completion R9 — 2026-09-27

- V15 R2 preservation baseline is discovered from Git history at `607e34a4191f40260e91961c283aa66007650f48`.
- Latest Worker commit is discovered dynamically at `af3b743a3a6af3276e8078fe4a5dbd133592ee03`.
- Worker runtime bytes are unchanged; required Windows worktree SHA-256: `a84b83ea1f024e779414ac647d3ad3dda7b0bc19888e91a6b18f90b53d1413aa`.
- Controller and Agent runtime bytes are unchanged. Before any test patch, their existing integrity pins must already match the current Windows worktree Worker/Controller bytes.
- The V15 R2 preservation helper is extended only for tests: when and only when the normalized source is the exact reviewed current Worker (`16ab7fa6fa1b20710a022caaf1dbe5fb7fe7b36bd2c7e51222af729b859553cb`), it maps in memory to the exact V15 R2 Worker text (`7cdb678cff9725930bd93522f5a58ae67e8a02a52b95c46b00dfd6b22d6e1839`) and then runs the existing Speed V1 inverse rules unchanged.
- The NativeOM preservation assertion now uses that same exact V15 R2 in-memory mapping because reviewed post-V15 V2/V3/V4 work intentionally changed NativeOM attachment.
- The historical preservation baseline hash is not rewritten.
- No Worker, Controller, Agent, API, database, Excel or process-control runtime code is changed.
- Focused preservation tests must pass with zero failures. Full project tests are run twice from the same HEAD: first unmodified baseline, then patched candidate. The candidate must introduce zero new failures. It may remove only the two targeted startup-preservation failures; every unrelated baseline failure must remain identical. If the baseline is clean, the candidate must also be clean. A web build must pass before repository files are written.
