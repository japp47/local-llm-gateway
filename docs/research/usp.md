# USP: what makes this product worth choosing

Date: 2026-11-24. Status: a hypothesis to test with 3 CA conversations, not a decision.
Inputs: `2026-11-20-pivot-research.md`, `2026-11-20-survey-evidence.md`.

## The hard truth: most of what exists is a commodity
- Chat with a local model: Ollama's app, LM Studio, Jan, Msty (mostly free).
- A web chat with logins that works in a phone browser: Open WebUI.
- Chat with your documents: AnythingLLM, Open WebUI.
- Better answers: ChatGPT and Gemini, free in India.

"Private local AI, now on your phone" is not a USP. A user comparing us with Open WebUI
would see no reason to switch.

## What users actually feel
- Fear: "I can't paste this client's ITR into ChatGPT. What if it leaks?"
- Time: "I spend an hour finding one clause in a 40-page policy."
- Control: "My junior left. Does he still have access to our files?"
- Setup pain: "Our IT person set up an AI tool; now nobody can fix it."
- Trust: "It says private, but how do I know?"

Competitors stop at "it runs locally". None turns that into proof, control and finished
jobs for a specific user.

## Three ingredients only we combine
1. **Proof of privacy, not a promise.** Every answer carries a privacy receipt ("answered
   on this computer, model X, 0 internet requests"); the owner can open a log of who asked
   what about which client file. Evidence for clients, and later for the DPDP Act (most
   business duties from 13 May 2027). Partly built: `meta` reports the provider per answer,
   every request is recorded per user and key; roadmap 2.6 "Trust & Privacy Center".
2. **Control a small office understands.** Staff phones paired by QR, removed in one click
   when someone leaves; later "staff A sees clients X and Y only". No IT person. Partly
   built: users and keys, revocable sessions, per-user isolation; the phone spec adds the
   device list.
3. **Finished jobs, not a chat box.** Packs for Indian documents: explain an insurance
   policy with page numbers, compare 26AS with the ITR, summarise a notice; English or
   Hindi; always the page cited. Not built: document search (Phase 3), earlier for wedge B.

## The sentence to test
> The private AI for Indian CA firms: answers from your client files with page citations,
> on a box in your office, usable from staff phones with no app, and nothing ever leaves,
> with proof.

Generic toolkits (Open WebUI, AnythingLLM) could do parts of it but need a technical
person; ChatGPT can't promise nothing leaves. Nobody owns proof + control + India-specific
document jobs + zero IT.

## What it changes in the plan
- Phone access: the value is "staff use it from their phones, and you cut off a departing
  employee in one click". Device list and revoke are the headline, the QR is the means.
- A privacy receipt is cheap and visible: right after phone access.
- Document search with page citations becomes the big next feature if CAs confirm.
- An always-on box (Mac mini in the office) removes "the laptop is asleep" and is the
  product shape for wedge B.

## How to prove or kill it (3 CAs)
Read the sentence, then ask:
1. Would this solve something you deal with today?
2. What's the first document you'd try it on?
3. Who in your firm would decide to buy it, and what do you pay today for similar tools?
Leaning in, naming a document or a price: it holds. A shrug: we know before building
document search.
