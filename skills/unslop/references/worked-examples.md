# Worked examples

The rules live in `../SKILL.md`. This file holds the longer before-and-after examples for the rules that need one. Read it when you are auditing text you already wrote, or editing a document, rather than when you are drafting a reply.

## 14. Colon overuse

"If you're coming from traditional automation: instead of registering event handlers, you describe conditions" adds nothing with the colon. "Describing when the scheduler should fire works best as plain English." Same meaning, no crutch punctuation.

## 16. Inline-header lists

The tell is a bold label and colon that restates the line: "**Performance:** Performance improved...". Convert those to prose. A bold lead-in that ends in a period, names the item, and is followed by genuinely new detail ("**Schema in TypeScript.** Tables live in one file.") is fine, not a tell.

## 27. Say what it does, not how it feels

"the database stays close at hand", "SQL you can read", "types that follow your schema" name a feeling. The mechanism or the number replaces it: "`.toSQL()` returns the exact string sent to the database", "a column rename fails the build".

## 29. Active voice

"queries are validated" becomes "the compiler validates queries", "the file is parsed by the loader" becomes "the loader parses the file". Passive is fine only when the actor is unknown or genuinely doesn't matter.

## 33. Over-compression

"Parser rejects bad date → exit 2, no write" becomes "The parser rejects a bad date, exits with code 2, and writes nothing."
