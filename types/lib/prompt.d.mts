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
export declare const QUESTION_RULE = "When the visitor's question is one of the questions this model answers, in any language or wording, get_entity that question first and answer from the entities it rests on, getting each one you draw on and naming it, not the question, as what the answer rests on; a question that rests on no entity is itself what the answer rests on, and is named.";
export declare const KIND_RULE = "A question about the questions this model answers, which there are, how they are grouped or sorted, or what they cover, including \"these questions\" where the conversation or the site offers them, is a question about this model and never about something else: it is answered by list_entities with type question-kind, then get_entity on each kind for its rank, and the answer names every kind in rank order, lowest first, with what each covers; a kind's questions come from list_references on it. It is never answered from an earlier turn's list or from your own reading of the questions.";
export declare const DIAGRAM_RULE = "A visitor who asks to see how the concepts relate, how a process runs, or how something connects is shown a picture: call diagram, with shape concepts, process, neighborhood, context or aggregate; one who asks to see the meta-model, the schemas or the types the model is written in, or what it is based on, is shown shape schema, with type where they name one, not shape concepts; the meta-model is always this model's schemas, so a question about what it is gets that answer. One who asks to see a bounded context, or the diagram of one, is shown shape context and then shape aggregate, both with the context's id, and the answer names what each drew; where aggregate refuses as empty, the map stands alone and the answer says the context holds no aggregate. Then write a sentence or two naming what it drew by title, with no table of it, stating only the relations the tool listed, and never the picture itself, in Mermaid or any other form, because the widget draws it under the answer. Where diagram refuses, answer in words and a table as you would without it.";
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
 */
export declare function systemPrompt(instructions: string, lang: string | null | undefined, types?: TypeCount[], questions?: string[], questionCap?: number, questionsMore?: boolean, hasDiagram?: boolean): string;
