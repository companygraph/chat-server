// The week's report of what the chat was asked, pure: the entries in, Markdown out, with the
// entries read by the platform's own source. The boolean the owner reads, answered or not, is
// decided here and never by the server that wrote the entry, so the rule can change with the
// entries intact.
const DAY = 86_400_000;

/**
 * A question the chat kept, as the log line holds it; `timestamp` is where the platform's own
 * source read it from. The fields after `question` are what the loop saw, and a line written
 * before one existed lacks it.
 * @typedef {{ kind?: string; question: string; lang?: string | null; cited?: string[]; calls?: number; empty?: number; rounds?: number; refused?: string | null; claims?: number; unsupported?: number; timestamp?: string }} KeptQuestion
 */
/**
 * Where a platform keeps the questions: what to say of the place, the entries of a range read from
 * it, and a named file written to it.
 * @typedef {{ where: string; list: (range: { from: Date; to: Date }) => Promise<KeptQuestion[]>; put: (name: string, text: string) => Promise<void> }} QuestionSource
 */

/** @param {Date} date */
export function weekOf(date) {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  // @ts-expect-error a Date minus a number of milliseconds is the milliseconds between
  const week = Math.ceil(((t - jan1) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// The ISO week's own bounds: its Monday at midnight UTC to the next, so a report named for a
// week holds that week and nothing else, whatever the hour a run starts. A name that is not a
// week, or a week the year does not have, is refused with what a week looks like.
/** @param {unknown} week */
export function weekRange(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week ?? ""));
  /** @type {() => never} */
  const bad = () => { throw new Error(`a week is YYYY-Www, an ISO week the year has: not "${week}"`); };
  if (!m) bad();
  const year = Number(m[1]), n = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday1 = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY);
  const from = new Date(monday1.getTime() + (n - 1) * 7 * DAY);
  if (n < 1 || weekOf(from) !== `${year}-W${m[2]}`) bad();
  return { from, to: new Date(from.getTime() + 7 * DAY) };
}

// Answered: not refused, and the model had material from the tools, either an entity it cited
// or a call that found something. A cite is made only from an entity answer, so a list answer,
// the skills, the phases, cites nothing though the model had every row; the counts say so.
/** @param {KeptQuestion} e */
export const answered = (e) => e.refused == null && ((Array.isArray(e.cited) && e.cited.length > 0) || (Number.isFinite(e.calls) && Number.isFinite(e.empty) && /** @type {number} */ (e.calls) > /** @type {number} */ (e.empty)));

// A cell holds one line, no bare pipe and no markup, whatever the visitor typed: the backslash
// goes first so a typed one cannot swallow the pipe's escape, and a tag is shown as its text,
// since not every renderer of a Markdown file strips HTML.
/** @param {unknown} s */
const cell = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * @param {KeptQuestion[]} entries
 * @param {{ week: string; from: Date; to: Date }} range
 */
export function renderReport(entries, { week, from, to }) {
  const yes = entries.filter(answered);
  const no = entries.filter((e) => !answered(e));
  /** @type {Map<string, { total: number; answered: number }>} */
  const byLang = new Map();
  for (const e of entries) {
    const l = e.lang ?? "—";
    const row = byLang.get(l) ?? { total: 0, answered: 0 };
    row.total++;
    if (answered(e)) row.answered++;
    byLang.set(l, row);
  }
  /** @type {Map<string, number>} */
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
  // The answer check's counts, where it ran: how many claims the checked answers made and how
  // many their evidence did not carry, and every question whose answer had one of those.
  const checked = /** @type {(KeptQuestion & { claims: number; unsupported: number })[]} */ (entries.filter((e) => Number.isFinite(e.claims) && Number.isFinite(e.unsupported)));
  if (checked.length) {
    const claims = checked.reduce((n, e) => n + e.claims, 0), unsupported = checked.reduce((n, e) => n + e.unsupported, 0);
    lines.push("", "## Claims", "", `${checked.length} answers checked, ${claims} claims, ${unsupported} not carried by their evidence.`);
    const flagged = checked.filter((e) => e.unsupported > 0);
    if (flagged.length) {
      lines.push("", "| Question | Language | Claims | Not carried |", "| --- | --- | --- | --- |");
      for (const e of flagged) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.claims} | ${e.unsupported} |`);
    }
  }
  if (no.length) {
    lines.push("", "## Not answered", "", "| Question | Language | Calls | Empty | Refused |", "| --- | --- | --- | --- | --- |");
    for (const e of no) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.calls ?? 0} | ${e.empty ?? 0} | ${cell(e.refused ?? "—")} |`);
  }
  return lines.join("\n") + "\n";
}

// The week that holds the day before now, or the week named: a run on Monday, at whatever hour
// the schedule fires, names the week that ended on Sunday and covers exactly it, so two runs
// write the same file and a week can be rebuilt from the bucket while its lines are kept.
// Standard output carries counts and never a question, since a run's log in a public
// repository is public.
/**
 * @param {{ list: QuestionSource["list"]; put: QuestionSource["put"]; now?: Date; out?: (line: string) => void; week?: string }} run
 */
export async function runReport({ list, put, now = new Date(), out = console.log, week = weekOf(new Date(now.getTime() - DAY)) }) {
  const { from, to } = weekRange(week);
  const entries = await list({ from, to });
  const text = renderReport(entries, { week, from, to });
  const name = `reports/${week}.md`;
  await put(name, text);
  const yes = entries.filter(answered).length;
  out(`report ${week}: ${entries.length} questions, ${yes} answered, written to ${name}`);
  return { week, total: entries.length, answered: yes };
}
