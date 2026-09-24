// The MCP host, as a client sees it. One connection per process, made at start and made again
// when a call finds it gone, since the host scales to zero as this service does and a transport
// can be dropped between two messages. What the handshake gives every client is what the model
// is given: the instructions unchanged, the tools with their descriptions and schemas unchanged.
//
// A protocol error is the host answering — it is up, and it refused, an unknown tool name being
// the usual reason — so it is thrown on as it stands and nothing is reopened. Only an error that
// is not the host speaking reopens, and two calls that fail together share the one reopening
// rather than each making a connection of their own.
//
// Every answer carries the commit the host reports, and this service is stateless where the host
// is re-pinned under it, so the provenance is taken from each answer rather than from the
// handshake alone.
import { Client, StreamableHTTPClientTransport, ProtocolError } from "@modelcontextprotocol/client";
import { ChatError } from "./errors.mjs";
import { DEFAULT_QUESTION_INDEX_CHARS, QUESTION_PREFIX, QUESTION_OVERFLOW, quoteQuestionTitle } from "./prompt.mjs";

const down = (url, err) => new ChatError("host_down", `the MCP host at ${url} did not answer: ${err.message}`);

// The same style lib/http.mjs's own logInternal already uses: "chat: <what>", then the detail.
// Fired at most once a fetch, never once a request — the fetch happens on a commit move, the
// prompt's own line is built fresh every message from whatever that fetch last cached.
const logTitleTooLong = (cap) => console.error("chat: question index", `a title alone is longer than the CHAT_QUESTION_INDEX_CHARS cap (${cap}) and is left out`);

// The map of types the prompt carries: which types the model declares and how many entities
// each holds, so the model lists a type when asked about a kind of thing instead of searching
// for a word no entity says. Read at connect, and again when the host's commit moves, because
// the host is re-pinned without a deploy of this service.
const shapeTypes = (r) => (r.structuredContent?.types ?? []).map((t) => ({ type: t.type, count: t.count ?? 0, owner: t.owner ?? null }));

// A fixed number of pages a question-titles fetch reads before it gives up regardless of what
// the host still claims: the floor under the cap and the repeated-cursor check below, so a host
// that answers ten thousand questions, far more than any prompt could hold, costs this package
// at most this many round trips and not one page more.
const QUESTION_PAGE_LIMIT = 20;

// The model's question titles, beside the types: an older host carries no type `question` and
// would refuse it, so this is called only where `types` already says the type exists. `callFn`
// is `client.callTool` wrapped the same shape `host.call` answers in, `{ data, isError }`, so
// this reads the same whether it runs during the handshake or later over the open connection.
// A page follows `page.nextCursor` while `page.hasMore`, the entity's title arriving as `name`,
// the field every list_entities answer gives it.
//
// The fetch is bounded three ways, because a page is the host's own claim and none of the three
// is this package's to trust blind. `cap` stops it once the titles read so far, quoted and
// joined the way the prompt's own line joins them, would already fill the line a deployment
// allows — a further page after that could only hold titles the line has no room for. A cursor
// answered twice running is a host making no progress rather than a further page, and stops it.
// QUESTION_PAGE_LIMIT stops it after a fixed number of pages regardless, the floor under both of
// the above. Whichever of the three stops it early leaves `more: true`, so the line this is fed
// into still ends in the overflow sentence even where every title it was handed fits the cap on
// its own — what fits is not what there is.
//
// A failure anywhere in the pages — a refusal or a call that throws — is not this function's to
// raise: it answers `null`, and the caller keeps whatever the index answered last rather than
// going quiet on it, the same question asked again next time.
async function fetchQuestionTitles(callFn, cap) {
  const titles = [];
  let consumed = 0;
  let more = false;
  let cursor;
  try {
    for (let page = 0; page < QUESTION_PAGE_LIMIT; page++) {
      const r = await callFn("list_entities", cursor ? { type: "question", cursor } : { type: "question" });
      if (r.isError) return null;
      const data = r.data ?? {};
      const hasMore = data.page?.hasMore === true;
      const nextCursor = data.page?.nextCursor ?? null;
      // The host claiming its own next page is the page it was just asked for is not a page of
      // data, however many entities it lists: nothing here has moved, so none of it is taken,
      // rather than the same entities being added again every time this is followed.
      const repeated = hasMore && nextCursor !== null && nextCursor === (cursor ?? null);
      if (!repeated) {
        for (const e of data.entities ?? []) {
          if (typeof e.name !== "string") continue;
          const piece = (titles.length ? "; " : "") + quoteQuestionTitle(e.name);
          if (QUESTION_PREFIX.length + consumed + piece.length + QUESTION_OVERFLOW.length > cap) {
            if (titles.length === 0) logTitleTooLong(cap);
            more = true;
            break;
          }
          titles.push(e.name);
          consumed += piece.length;
        }
      }
      if (more || repeated) { more = true; break; }
      if (!hasMore || !nextCursor) break;
      if (page === QUESTION_PAGE_LIMIT - 1) { more = true; break; }
      cursor = nextCursor;
    }
    return { titles, more };
  } catch {
    return null;
  }
}

async function open(url, questionCap) {
  const client = new Client({ name: "companygraph-chat-server", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const instructions = client.getInstructions() ?? "";
  const title = client.getServerVersion()?.title ?? "";
  const { tools } = await client.listTools();
  const shaped = tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }));
  const callTool = async (name, args) => {
    const r = await client.callTool({ name, arguments: args ?? {} });
    return { data: r.structuredContent ?? null, isError: r.isError === true };
  };
  const types = await callTool("list_types", {});
  const shapedTypes = shapeTypes({ structuredContent: types.data });
  let questionTitles = [];
  let questionsMore = false;
  // Whether the questions half resolved at all this connect, distinct from resolving to "none":
  // a model with no type question resolves cleanly to no titles, and a fetch that failed has not
  // resolved and is retried on the first call after connect, the same as if this were the case
  // of a list_types failure at connect leaving nothing cached for types to retry from either.
  let questionsResolved = true;
  if (shapedTypes.some((t) => t.type === "question")) {
    const result = await fetchQuestionTitles(callTool, questionCap);
    if (result) { questionTitles = result.titles; questionsMore = result.more; }
    else questionsResolved = false;
  }
  return { client, instructions, title, tools: shaped, provenance: types.data?.model ?? null, types: shapedTypes, questionTitles, questionsMore, questionsResolved };
}

// A failed refresh's list_types is a real reconnect underneath — close, a full open(): handshake,
// listTools, list_types, and up to QUESTION_PAGE_LIMIT pages of question titles — so during an
// outage, each chat message that finds the cache stale would otherwise re-enter that whole
// reconnect before failing, and a busy moment's concurrent messages would multiply that load on a
// host that is already failing. This holds the next attempt off for a short while instead, thirty
// seconds being long enough that a burst of messages during an outage costs a handful of attempts
// and not one each, and short enough that a host's own recovery is found soon after it happens;
// the last good type map and question titles keep the prompt intact meanwhile.
export const REFRESH_FAILURE_COOLDOWN_MS = 30_000;

export async function connectHost(url, { questionCap = DEFAULT_QUESTION_INDEX_CHARS, now = () => Date.now() } = {}) {
  let conn;
  try { conn = await open(url, questionCap); } catch (err) { throw down(url, err); }

  let typeList, questionTitles, questionsMore, typesAt, questionsAt;

  // The commit types and questions are each known fresh as of. `questionsAt` is set apart from
  // `typesAt` on purpose: `undefined`, a value neither ever otherwise takes (both are a real
  // commit string or `null`, never the bare word), so a connect whose question fetch failed
  // reads as stale precisely because nothing — not even `null` — could accidentally equal it.
  const applyConn = () => {
    typeList = conn.types;
    typesAt = conn.provenance?.commit ?? null;
    questionTitles = conn.questionTitles;
    questionsMore = conn.questionsMore;
    questionsAt = conn.questionsResolved ? typesAt : undefined;
  };
  applyConn();

  let reopening = null;
  const reopen = () => {
    reopening ??= (async () => {
      conn.client.close().catch(() => {});
      conn = await open(url, questionCap);
      host.provenance = conn.provenance;
      host.title = conn.title;
      applyConn();
    })().finally(() => { reopening = null; });
    return reopening;
  };

  // Types and the question index share one commit gate but are refreshed independently within
  // it. A failed list_types leaves both exactly as they were and is retried whole on the next
  // call, as before this type existed. A list_types that succeeds but a question fetch that then
  // fails leaves the titles as they were too, not cleared — the index is a pointer a visitor's
  // answer can do without, the titles are worth keeping — and only the question half stays
  // stale, so the next call retries that alone and does not repeat the list_types call the first
  // one already answered. Two calls that both find it stale share the one refresh, the way a
  // lost connection's reopen is shared above, so a burst of requests after a commit move costs
  // one list_types call and not one per request.
  //
  // A refresh that fails, whichever half failed, marks the moment in `refreshFailedAt`; while
  // REFRESH_FAILURE_COOLDOWN_MS has not yet passed since it, `ensureFresh` answers at once with
  // whatever was last good — the same cache a healthy call would have read — rather than
  // attempting a call the host has just shown it cannot answer. A refresh that reaches full
  // freshness clears the mark, so the very next commit move is tried without waiting out a
  // cooldown left over from an outage already past.
  let refreshing = null;
  let refreshFailedAt = null;
  const stale = () => {
    const at = host.provenance?.commit ?? null;
    return !(typeList.length && at === typesAt && typesAt === questionsAt);
  };
  const cooling = () => refreshFailedAt !== null && now() - refreshFailedAt < REFRESH_FAILURE_COOLDOWN_MS;
  const ensureFresh = () => {
    if (!stale() || cooling()) return Promise.resolve();
    refreshing ??= (async () => {
      try {
        const at = host.provenance?.commit ?? null;
        if (!(typeList.length && at === typesAt)) {
          const r = await host.call("list_types", {});
          if (r.isError) { refreshFailedAt = now(); return; }
          typeList = shapeTypes({ structuredContent: r.data });
          typesAt = r.data?.model?.commit ?? at;
        }
        if (typesAt !== questionsAt) {
          if (!typeList.some((t) => t.type === "question")) {
            questionTitles = [];
            questionsMore = false;
            questionsAt = typesAt;
          } else {
            const result = await fetchQuestionTitles(host.call, questionCap);
            if (!result) { refreshFailedAt = now(); return; }
            questionTitles = result.titles;
            questionsMore = result.more;
            questionsAt = typesAt;
          }
        }
        refreshFailedAt = null;
      } catch (err) {
        refreshFailedAt = now();
        throw err;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  };

  const host = {
    url,
    instructions: conn.instructions,
    title: conn.title,
    tools: conn.tools,
    provenance: conn.provenance,
    // The types as of the commit the host last answered from; a re-pin of the host moves the
    // provenance on the next answer, and the message after that reads the map again.
    async types() {
      await ensureFresh();
      return typeList;
    },
    // The model's question titles as of the same commit as types(), read the same way and kept
    // beside it: `titles`, empty wherever the type map carries no question or nothing has been
    // fetched yet, and `more`, true where the fetch itself stopped before the host's own list
    // did — a cap reached, a repeated page, or the fixed page limit — so the prompt still ends
    // the line in the overflow sentence even though every title it is handed fits the cap.
    async questions() {
      await ensureFresh();
      return { titles: questionTitles, more: questionsMore };
    },
    async call(name, args) {
      const once = async () => {
        const r = await conn.client.callTool({ name, arguments: args ?? {} });
        if (r.structuredContent?.model) host.provenance = r.structuredContent.model;
        const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        return { text, data: r.structuredContent ?? null, isError: r.isError === true };
      };
      try { return await once(); }
      catch (err) {
        if (err instanceof ProtocolError) throw err;
        try { await reopen(); } catch (e) { throw down(url, e); }
        try { return await once(); } catch (e) { if (e instanceof ProtocolError) throw e; throw down(url, e); }
      }
    },
    async close() { await conn.client.close(); },
  };
  return host;
}
