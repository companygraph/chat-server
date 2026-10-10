export declare const LANGS: string[];
export type TypeCount = {
    type: string;
    count: number;
    owner: string | null;
};
/**
 * A type of the model as the prompt names it: how many entities it holds and the type it nests under.
 * @typedef {{ type: string; count: number; owner: string | null }} TypeCount
 */
export declare const RULES: string[];
export declare const NAME_NOTE = "In an English answer, name every entity by its title alone. In an answer in any other language, begin every entity with its name in that language, then its exact title in parentheses, never the English title first; in German, for example, **Kundenliste** (The customer list). A table cell or a list item begins with the name and no article. In a sentence the article belongs to the sentence, outside the bold, in the case and gender the sentence needs, verweist auf die **Kundenliste** (The customer list), and after a word naming the kind, das Konzept **Beleg** (Evidence), there is no second article. A name is rendered into that language wherever it has a word for it; only a name the language keeps unchanged, such as **MLOps**, stands once and alone, with no parentheses. German is Swiss Standard German, written with ss and never \u00DF.";
/** @param {string} message */
export declare const nameNote: (message: string) => string;
export declare const QUESTION_RULE = "When the visitor's question asks the same thing as one of the questions this model answers, in any language or wording, get_entity that question first and answer from the entities it rests on, getting each one you draw on and naming it, not the question, as what the answer rests on; a question that rests on no entity is itself what the answer rests on, and is named. A model question is where the answer starts, not all of it: where the visitor asks more than the question does, a time such as now or lately, a period, a number or a kind, the answer gets that too, through the tools.";
export declare const FACTS_RULE = "Each entity list_entities returns carries fields, the short facts its page states, such as its dates, its kind and its status. A question about now, today, currently, or what is running or ongoing is answered by list_entities with on set to today's date, which keeps the periods, start to end, that hold it, a period with no end still running; one about the latest, the last, the first or the most recent, by list_entities with by naming the date field and order newest or oldest; and one about the things of one kind, status or other value, the roles, the standing decisions, by list_entities with where naming the field and the value as fields shows them. A question about a person's role, job or position is about their experiences, kept with where on the kind that names such a period and ordered by start, and never about the type role, whose entities are the seats of this model's own processes. A list too long to read whole is narrowed with these before it is paged through. This holds even where the visitor's question also matches one of the questions this model answers, such as one about what someone does or studies now: the list on today's date is called first, and what that question rests on is added beside it, never in its place.";
export declare const KIND_RULE = "A question about the questions this model answers, which there are, how they are grouped or sorted, or what they cover, including \"these questions\" where the conversation or the site offers them, is a question about this model and never about something else: it is answered by list_entities with type question-kind, then get_entity on each kind for its rank, and the answer names every kind in rank order, lowest first, with what each covers; a kind's questions come from list_references on it. It is never answered from an earlier turn's list or from your own reading of the questions.";
export declare const DIAGRAM_RULE = "A visitor who asks to see how the concepts relate, how a process runs, or how something connects is shown a picture: call diagram, with shape concepts, process, neighborhood, context, aggregate, flow, lifecycle or organization; one who asks to see the meta-model, the schemas or the types the model is written in, or what it is based on, is shown shape schema, with type where they name one, not shape concepts; the meta-model is always this model's schemas, so a question about what it is gets that answer. One who asks to see a bounded context, or the diagrams of one, is shown shape context, then aggregate, then flow, then lifecycle, all with the context's id, and the answer names what each drew; where aggregate refuses as empty, the map stands alone and the answer says only that the context holds no aggregate; otherwise, where flow or lifecycle refuses as empty, the answer says in one sentence that the model does not describe that flow or lifecycle yet. One who asks for the sequence or the lifecycle of a context or an aggregate is shown that shape alone, flow for the sequence, with its id. One who asks how the company is organized or for an org chart is shown shape organization, with a group's id where they name one, then calls get_entity on every group it drew, and the answer names each group's lead, its members and its open positions as those pages give them, never as read off the picture or its lines; where its omitted is above zero, the answer says in one sentence that the groups outside the line are drawn when one is named. One who asks who leads a group or who works in one is answered from that group's page through get_entity, in words, and shown no picture unless they ask to see one. Then write a sentence or two naming what it drew by title, with no table of it, stating only the relations the tool listed, or for an organization what get_entity gave for its groups, and never the picture itself, in Mermaid or any other form, because the widget draws it under the answer. Where diagram refuses for any other reason, answer in words and a table as you would without it.";
/** @param {TypeCount[]} [types] */
export declare function typeMap(types?: TypeCount[]): string;
export declare const DEFAULT_QUESTION_INDEX_CHARS = 4000;
export declare const QUESTION_OVERFLOW = "; and more, found by search with type question";
export declare const QUESTION_PREFIX = "Questions this model answers, each an entity of type question: ";
/** @param {string} t */
export declare const quoteQuestionTitle: (t: string) => string;
/**
 * @param {string[]} [titles]
 * @param {number} [cap]
 * @param {boolean} [more]
 */
export declare function questionIndexLine(titles?: string[], cap?: number, more?: boolean): string;
/**
 * @param {string} instructions
 * @param {string | null | undefined} lang
 * @param {TypeCount[]} [types]
 * @param {string[]} [questions]
 * @param {number} [questionCap]
 * @param {boolean} [questionsMore]
 * @param {boolean} [hasDiagram]
 * @param {{ today?: string | undefined; facts?: boolean | undefined }} [options] today's date, YYYY-MM-DD, and whether the host's list takes on, by and where
 */
export declare function systemPrompt(instructions: string, lang: string | null | undefined, types?: TypeCount[], questions?: string[], questionCap?: number, questionsMore?: boolean, hasDiagram?: boolean, { today, facts }?: {
    today?: string | undefined;
    facts?: boolean | undefined;
}): string;
