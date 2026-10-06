<!-- conventions · v1.44.0 -->
Shared conventions of the robertblust, guestgraph and companygraph organizations live in `conventions/`, vendored from robertblust/conventions at the release `conventions.json` names. Read them before writing or committing anything here.

- `conventions/WRITING.md` — how we write: one voice, three registers, English and German.
- `conventions/WORKING.md` — how we work with git and GitHub.
- `conventions/REPOSITORIES.md` — the family: what each repository is and what pins what.
- `conventions/PINS.md` — what a member pins and how the family resync moves it.
- `conventions/WRITER.md`, `conventions/TRANSLATOR.md`, `conventions/EDITOR.md`,
  `conventions/BACKREADER.md`, `conventions/GLOSSARY.md`, `conventions/GERMAN.md` — the four roles
  that make a text, the terms they keep and the German they write.

Everything below this block is this repository's own. `sh conventions/conventions-sync check` says whether the copy matches the release, `sync` brings it to the release the pin names, and `sh conventions/conventions-check` holds this repository's own Markdown to `WRITING.md`, and `sh conventions/conventions-format` to its one form, which `fix` writes. Edit a shared file in robertblust/conventions, never here.
<!-- end conventions -->

A change to `/chat`'s request, events or codes is a change to `docs/INTERFACE.md` and, where it breaks, to the release notes' `Interface` section, in the same pull request. `lib/` and `bin/` name no instance and no entity: the portability test holds them to the meta-model's worked example and the words `blust.ch`, `mental-model` and `Robert`.

The JavaScript in `lib/`, `bin/` and `deploy/` is the source and what runs, and its types are JSDoc in the same files. A TypeScript consumer reads the declarations `npm run build` writes from that JSDoc into `types/`, and they are committed, because a consumer takes the package from a tag and builds nothing. So a change to a type is made in the JSDoc, built, and committed with what the build wrote, and a file in `types/` is never edited by hand; `npm run build:check`, which the `test` job runs before its suite, writes the declarations into a temporary folder and fails on one in `types/` that differs or that no module writes, and `npm run typecheck` is the compiler's verdict on the JSDoc alone. The JavaScript itself does not change for a type: a JSDoc cast adds parentheses and nothing else, and a declaration that cannot be said without changing the code is a reason to ask first. TypeScript and Node's types are devDependencies and nothing else is. Why the types are JSDoc rather than TypeScript source is in meta-model's `docs/superpowers/specs/2026-09-30-types-from-jsdoc-design.md`.
