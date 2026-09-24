// The week's report of what the chat was asked, pure: the entries in, Markdown out, with the
// Logging API's paging over an injected request so a test drives it. The boolean the owner
// reads, answered or not, is decided here and never by the server that wrote the entry, so
// the rule can change with the entries intact.
const DAY = 86_400_000;

export function weekOf(date) {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t - jan1) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const answered = (e) => Array.isArray(e.cited) && e.cited.length > 0 && e.refused == null;

// A cell holds one line and no bare pipe, whatever the visitor typed.
const cell = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

export function renderReport(entries, { week, from, to }) {
  const yes = entries.filter(answered);
  const no = entries.filter((e) => !answered(e));
  const byLang = new Map();
  for (const e of entries) {
    const l = e.lang ?? "—";
    const row = byLang.get(l) ?? { total: 0, answered: 0 };
    row.total++;
    if (answered(e)) row.answered++;
    byLang.set(l, row);
  }
  const cited = new Map();
  for (const e of entries) for (const id of e.cited ?? []) cited.set(id, (cited.get(id) ?? 0) + 1);
  const ranked = [...cited].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const lines = [
    `# Chat questions, week ${week}`,
    "",
    `From ${from.toISOString()} to ${to.toISOString()}. ${entries.length} questions, ${yes.length} answered, ${no.length} not.`,
  ];
  if (byLang.size) {
    lines.push("", "## By language", "", "| Language | Questions | Answered |", "| --- | --- | --- |");
    for (const [l, r] of [...byLang].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) lines.push(`| ${cell(l)} | ${r.total} | ${r.answered} |`);
  }
  if (ranked.length) {
    lines.push("", "## Most cited", "", "| Entity | Times |", "| --- | --- |");
    for (const [id, n] of ranked) lines.push(`| ${cell(id)} | ${n} |`);
  }
  if (no.length) {
    lines.push("", "## Not answered", "", "| Question | Language | Calls | Empty | Refused |", "| --- | --- | --- | --- | --- |");
    for (const e of no) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.calls ?? 0} | ${e.empty ?? 0} | ${cell(e.refused ?? "—")} |`);
  }
  return lines.join("\n") + "\n";
}

export async function listEntries(request, view, { from, to }) {
  const out = [];
  let pageToken;
  do {
    const body = {
      resourceNames: [view],
      filter: `timestamp >= "${from.toISOString()}" AND timestamp < "${to.toISOString()}"`,
      orderBy: "timestamp asc",
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    };
    const data = await request(body);
    for (const e of data.entries ?? []) if (e.jsonPayload?.kind === "question") out.push({ ...e.jsonPayload, timestamp: e.timestamp });
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Seven days back to now, named for the week of the day before now: a run on Monday morning
// names the week that ended on Sunday. Standard output carries counts and never a question,
// since a run's log in a public repository is public.
export async function runReport({ list, put, now = new Date(), out = console.log }) {
  const to = now;
  const from = new Date(now.getTime() - 7 * DAY);
  const week = weekOf(new Date(now.getTime() - DAY));
  const entries = await list({ from, to });
  const text = renderReport(entries, { week, from, to });
  const name = `reports/${week}.md`;
  await put(name, text);
  const yes = entries.filter(answered).length;
  out(`report ${week}: ${entries.length} questions, ${yes} answered, written to ${name}`);
  return { week, total: entries.length, answered: yes };
}
