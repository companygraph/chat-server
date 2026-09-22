// Server-sent events on a Node response: one `event:` line, one `data:` line of JSON, a blank
// line. The headers go out on the first send, so a refusal decided before any event can still
// be an ordinary JSON answer.
export function sse(res) {
  let open = false;
  return {
    send(event, data) {
      if (!open) {
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
        open = true;
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    get opened() { return open; },
    end() { res.end(); },
  };
}
