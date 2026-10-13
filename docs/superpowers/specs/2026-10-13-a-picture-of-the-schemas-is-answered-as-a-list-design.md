# A picture of the schemas is answered as a list — design

> The answer check cannot see a wrong relation in an answer about the schemas: the answer packs several relations into one sentence, and the judge passes the sentence. Stated one to a list item, the same relations are read correctly, and the check as it stands marks a wrong one. This asks for that form in the note the model reads for a picture of the schemas, and changes nothing in the check.

Status: proposed. Decided on 2026-10-13 with the owner against this repository at `de35909`, from the measurements recorded below.

---

## 1. The gap

An answer about a unit of the meta-model is written from the note `diagramNote()` builds in `lib/loop.mjs`, which holds each reference of the schemas as a sentence and, for a unit, the closed groups `owns` and `shared`. The note asks for two or three sentences, so the model joins five to eight relations in each. The check reads an answer sentence by sentence, and a sentence of that kind with one wrong relation in it reads as supported: of the sentences holding a wrong relation in the answers measured for the note, the judge passed every one, eight of eight. Put to it as a sentence of its own, it called four of five of the same wrong relations contradicted and every true one supported.

The gap is this kind of answer and no other. A fault planted in one clause of a long sentence of an ordinary answer, about a person, a process, a requirement or what is kept of a message, was called contradicted in eight of eight real answers, at 0.73 to 0.99. So a claim stays a sentence, a list item or a table row, as [the answer is checked](2026-09-26-the-answer-is-checked-design.md) set it, and what changes is what an answer about the schemas is made of.

**What the change buys is an answer about the schemas whose every relation is a claim of its own, which the check can read.**

## 2. The answer is a list

For a picture of the schemas, of a unit, of one type or of the whole, the note asks for one sentence saying what the picture shows and then the relations that carry its structure as a Markdown list of at most six items, never every relation. An item states one relation and no more: one sentence of `owns` or `shared`, or one relation's `says`, as that sentence states it, in the answer's language, never two joined. The sentences after the list stay as they are: what every other type declares, which unit this is and which units can be shown next. The note's opening line asks every picture for one or two sentences; the schemas' own line says that for this picture the list takes their place.

The model copies the note's sentences into the items and does not rephrase them, which is what keeps a relation from being turned around, so an item reads as the note states it: "domain-event declares the field emitted-by, which names exactly one aggregate". The sentences of `owns` and `shared` therefore lose their closing words, "and no other type of this unit" and "and no other type of this unit does", which were written for the model and read badly in an answer; the note's line on the groups already says that each is closed and that a type a sentence does not name has no such nesting or field.

The form is asked of the schemas alone. Every other picture keeps its sentences, since no measurement says the check misses a relation there, and a list under a process or an organization chart would change answers nobody has found wrong.

## 3. What stays, and what was set aside

The check, the judge, the threshold, the `verdict` event, the widget and `docs/INTERFACE.md` do not change. A list item is a claim already, and one that names no entity and that the judge finds absent or contradicted is `unnamed`, which the widget marks.

Two ways of making the check read a sentence clause by clause were set aside. Asking the judge once for each type a sentence names, against that type's statements alone, was tried: it answered `partial` for 38 of 59 sentences with nothing wrong in them, since a sentence about several types is only partly carried by the statements of one. A model that cuts a sentence into statements would break the rule that a claim is found without a model, add a call to every answer and overrun the second the check has.

## 4. Tests and what is measured

`test/loop.test.mjs`: the schemas' line of the note asks for the list, for one relation to an item and for at most six; the sentences of `owns` and `shared` carry no closing words; a picture of any other shape asks for no list.

The form was measured on 2026-10-13 before this was written, in a throwaway copy with the line above, on "Show me the meta-model for the software pack" over companygraph/mental-model, thirty answers through the loop and the model. Read by hand, none held a wrong relation in 177 items, and every item stated one relation. The check as it stands, with Jev 1.13.0, marked none of their 259 claims, and marked a wrong item planted in each, thirty of thirty. The judge answered in 241 ms at the median and 432 at most. An answer cost 6,309 of the meter's units at the mean, against 6,205 before.

The same is measured again on the text as built, since the closing words leave the group sentences here and had not in the copy: thirty answers for the software pack read by hand, the check run on them as written and with a wrong item planted in each. Beside them, ten answers for core, where six items are chosen from many relations, and ten in German, where an item is the model's rendering of the sentence, are read by hand for the form and for a wrong relation. The numbers go into the pull request.

## 5. What this leaves

A slip in the sentences around the list, core called a pack or a count of types that does not match the types listed, is not a relation and is not addressed; it came up in about one answer in six. A fault in an ordinary answer that the judge finds below the threshold is not addressed either: of the eight planted, one, ninety days written as thirty, was called contradicted at 0.73 to 0.78 and would not have been marked.

## 6. Release

No route, event or code changes, so this is a minor, and the release that carries it is the owner's to call. Release notes to write at tagging: an answer under a picture of the schemas states its relations as a short list, one to an item.
