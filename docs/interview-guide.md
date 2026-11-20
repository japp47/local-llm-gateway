# Interview guide: choosing the wedge

Purpose: decide which wedge to build for (see `docs/product-roadmap-3.md`, section 1a)
from five real conversations, not from articles.

- A. Personal private workspace
- B. Private AI box for a small office
- C. Hybrid routing and prompt debugging for developers

## Who to talk to (five people, about 30 minutes each)

| # | Person | Why |
| --- | --- | --- |
| 1-2 | Small-firm owners or senior staff: a CA firm, a clinic, a small legal or finance office | Tests wedge B |
| 3-4 | Developers who already use AI tools daily | Tests wedge C, and the power layer |
| 5 | An everyday non-technical person who uses ChatGPT or similar | Tests wedge A |

## Rules for every interview

1. Ask about what they did last time, not what they would do. "Tell me about the last time
   you..." beats "Would you use...?"
2. Do not pitch or demo until the last five minutes. Once you describe the product, the
   answers stop being honest.
3. Listen for money, time and fear: what it costs them now, how long it takes, what they
   are worried about.
4. Write down their exact words for anything surprising.
5. A compliment is not evidence. A follow-up meeting, an introduction or an offer to pay is.

## Questions for small-firm owners (wedge B)

1. What does your team use AI tools for today, if anything? Which tools?
2. Tell me about the last time someone wanted to use AI on a client document. What
   happened?
3. Are there documents you would never paste into ChatGPT or similar? Why not? Who decided
   that?
4. Have clients, regulators or your own policies ever asked where client data goes? What
   did you answer?
5. How do you search your own past documents today (old returns, reports, case files)?
   How long does finding one take?
6. If a box in your office answered questions from your own files, and nothing left the
   office, who would use it and for what? (Ask this only after questions 1 to 5.)
7. Who would decide to buy something like this, and what do you pay today for similar
   software or IT support?
8. What would make you not trust it?

## Questions for developers (wedge C and the power layer)

1. Walk me through the last time you used an AI model while coding or debugging. Which
   tool, which model, what for?
2. Do you ever avoid sending code or data to a cloud model? What do you do instead?
3. Have you run local models (Ollama, LM Studio)? What did you stop using them for, and why?
4. When a prompt or model gives a bad answer, how do you investigate? Do you rerun with
   another model or prompt? How do you compare results?
5. How do you track cost or usage of AI APIs today, if at all?
6. Have you used a gateway such as LiteLLM or OpenRouter? What was missing?
7. What would a tool need to do for you to switch from what you use now?

## Questions for the everyday user (wedge A)

1. What did you last ask ChatGPT (or similar) about? How often do you use it?
2. Have you ever stopped yourself from asking something because of privacy? What was it?
3. Do you go back to old chats? How do you find them?
4. Has a long answer ever broken halfway or a chat been lost? What did you do?
5. Would you install an app that runs on your own laptop, if it were slower or less smart
   than ChatGPT? What would it need to be better at?
6. What laptop do you use, and how much memory does it have (if they know)?

## What to record after each interview

| Field | Notes |
| --- | --- |
| Person and role | |
| Current tools | |
| Biggest pain, in their words | |
| Privacy concern (none / mild / blocking) | |
| What they pay today for related tools | |
| Strongest signal (follow-up, intro, offer to pay, or none) | |
| Which wedge this supports | A / B / C / none |

## How to decide

- Choose B if both small-firm owners describe a real privacy blocker or document-search
  pain and at least one gives a strong signal (follow-up, intro, or a price).
- Choose C if both developers already rerun or compare prompts by hand and none is happy
  with an existing tool.
- Choose A if the everyday user shows a privacy-driven need and would accept a slower
  local model.
- If nothing is strong, keep A for learning, and run five more interviews in the most
  promising segment before Phase 1b.

Record the result and the reasons in `docs/product-roadmap-3.md` (section 1a and open
decision 1).
