# CompanyGraph — Chat Server design

How the chat answers a visitor: the path one message takes from the page to the model and back, and how the prompt the model reads is put together. The code is the design; these pages are its map. Nothing here repeats a limit, a sentence of the prompt or a reason the source already states, so every entry names the file that says it, and why a rule reads as it does stays where it was decided: the commit that added it, and the spec under [`docs/superpowers/specs`](../superpowers/specs) where there is one.

What a client sends and receives, the request, the events and the refusals, is the [interface](../INTERFACE.md)'s subject, and how a deployment runs the server is the [README](../../README.md)'s.

## Pages

| Page | What it describes |
| --- | --- |
| [Answering](answering.md) | One message, from the page's request to the last event and the line that keeps the question |
| [The prompt](prompt.md) | The parts of the system prompt in order, the rules among them, and when each conditional rule is sent |

`test/design.test.mjs` holds [The prompt](prompt.md) to the order `systemPrompt()` builds, so a rule moved in the code and not on the page fails the suite.
