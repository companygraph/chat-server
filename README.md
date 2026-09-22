# CompanyGraph — Chat Server

A chat over any CompanyGraph MCP host. A visitor types a question on a site, this service asks the site's MCP host through its tools, and a language model writes the answer from what the tools said, naming the entity each claim rests on. It holds no model and pins no commit: what it answers is what the host answers, at the commit every answer of the host names.

The design is `docs/superpowers/specs/2026-09-22-chat-server-design.md`. The routes, the events and the codes are `docs/INTERFACE.md`.
