# Pivot research: consumer vs SaaS, phone access, IPO assistant, real problems

Date: 2026-11-20. Status: research only, nothing decided. Input for a spec-kit `specify`.
Evidence quality is marked: **[strong]** official or several independent sources,
**[weak]** vendor blogs, app-store listings, self-reported claims.

## 0. Short answer

- **Don't pivot to cloud SaaS for consumers.** In India, consumer AI is given away free
  (ChatGPT, Gemini through Jio, Perplexity through Airtel) and paying users are still
  unproven. "Chat with a local model" loses to free frontier models on quality. Privacy is
  worth paying for only when the data is sensitive. Section 1.
- **Phone access is the best idea here.** It fits what we have already built. The phone
  apps that exist today connect to raw Ollama, which has no login and no encryption. Our
  gateway already has keys and per-user data. Section 2.
- **The day-trader-skill lesson is about packaging, not about trading.** It spread because
  it does one concrete job, gives a result you can screenshot, installs into a tool people
  already use, and has safety rails you can see. We should copy that with "packs": ready-made
  jobs built on top of our engine. Section 7. (IPO was only an example of a domain. If it is
  ever built, it must explain and never advise. Section 3.)
- **The strongest product that combines all of these is a private family records
  assistant.** The family's sensitive documents (insurance, FDs, Form 16 and AIS, medical
  reports, parents' papers) stay on a home machine. Family members ask about them from
  their phones, and get reminders and plain-language explanations. It combines documents
  (Phase 3), phone access, privacy that actually matters, and an India-specific need
  (caring for parents in another city, a top-10 itch). It still needs interviews to
  confirm. Section 4.
- **Keep building Phase 1a step 7.** Every option needs it.

## 1. Consumer vs SaaS

What we know:
- India's paid-AI market is a price war of free plans. ChatGPT had 180M monthly users in
  India in January 2026 and Gemini 118M. Jio gives Gemini Pro free for 18 months. When
  Airtel's free Perplexity offer closed, downloads fell sharply. Analysts: "Is India ready
  to pay subscription fees? Honestly, not yet." **[strong, several outlets]**
- Local-AI desktop apps are crowded and mostly free: Jan (open source, ~44k stars),
  AnythingLLM (~65k stars, document chat), LM Studio (free), Msty (freemium). No
  public user or revenue numbers. **[weak]**
- The roadmap already concluded that "a generic local LLM gateway on top of Ollama is
  crowded" (section 1a).

What follows:
- "SaaS" means our servers hold user data. That throws away the one thing we do
  differently (private, on your own machine). It also puts us against OpenAI and Google
  on their own ground, where we lose.
- People pay for privacy when the data is sensitive and the use is repeated: money,
  health, legal, and client files. That points to wedge B (small offices such as CA firms)
  and to section 4 (family records), not to general chat.
- One model that fits India: keep the personal version free, and charge for the
  household or small-office version (more users, phones, backup, support). Nobody has
  tested whether people will pay for it. The interviews should ask.

## 2. Using the laptop's AI from your phone

### What exists
- Third-party phone apps that talk to Ollama on the same Wi-Fi: Ollama Connect, Ollama
  Mobile (unofficial), Reins, LM Mini (being retired at the end of 2026), Off Grid AI.
  **[weak, vendor pages]**
- They all need `OLLAMA_HOST=0.0.0.0`, which opens Ollama to the whole network. Their own
  guides say that **Ollama's API has no authentication** and that traffic is plain HTTP.
  Anyone on the same Wi-Fi (a guest, a smart TV, a café network) can use the models. For
  access from outside the home they say "use a VPN". **[strong: documented by the vendors
  themselves]**

### Why we can do it better
The gateway already sits in front of Ollama with hashed keys, per-user data and rate
limits (roadmap 1a: "our gateway already fixes that"). Ollama itself can stay on
localhost. Only the gateway listens on the network, and only when the user turns that on.

### Proposed design (for a spec, not built)
1. **Off by default.** Settings has a switch, "Use from my phone". Only when it is on does
   the gateway listen on the local network address, in addition to 127.0.0.1.
2. **Pair with a QR code.** The laptop shows a QR code containing the address, a one-time
   pairing code and the certificate fingerprint. The phone scans it and receives **its own
   device key** (a new `api_keys` row labelled "Jappreet's iPhone"). Every device can be
   revoked from a "Devices" list. This fits the existing rule "never send a saved key to a
   gateway it was not saved for", because the key is bound to that gateway.
3. **Encryption is the hard part.** Phone browsers treat `http://192.168.x.x` as insecure,
   so a web app there cannot use the microphone, install as an app, or work offline.
   Options:
   - (a) A self-signed certificate. iPhones show scary warnings unless the user installs
     a profile. Bad for non-technical users.
   - (b) A small native phone app that trusts the certificate fingerprint from the QR code
     (certificate pinning). Best experience, but it is a second app to build.
   - (c) **Tailscale** (a private network between your own devices) with `tailscale serve`,
     which provides real HTTPS certificates and also works away from home. Easiest secure
     path today, but the user must install Tailscale on both devices.
   - Suggested order: (c) for power users first, then (b) when Phase 1b's web chat
     exists.
4. **Be honest about limits.** A MacBook Air sleeps with its lid closed, so the phone gets
   "your computer is asleep", never a silent failure. This is why a Mac mini or another
   always-on machine matters for families and offices.

Roadmap fit: this is in Phase 5 today ("reach your home Mac from a phone over a private
link"). It is the most visible consumer feature we could ship, so consider moving it to
right after Phase 1b.

## 3. The reference repo, and IPO as an example domain

The owner raised IPOs only as an example of a popular domain, not as a direction. The
main question is how to grow the product (section 7). The notes below are kept in case
the domain comes back.

### About the reference repo (day-trader-skill)
- These are **11 Claude Code skills**, not 11 agents that talk to each other. Each one is
  a prompt plus a Python script. They run as a pipeline (scanner → news → entry → exit →
  simulation → budget → risk → broker) and pass JSON files between steps. There is no
  debate between agents.
- The good ideas to copy are: **a hard gate** (the risk skill's BLOCK is final), a
  **human approval** for every action, deterministic scripts for the numbers with the LLM
  only explaining them, and a strong "not financial advice" section.
- It uses unofficial Yahoo endpoints and is US-only. MIT licensed, about 8.8k stars, one
  squashed commit visible.

### The risk assumption needs correcting
"IPOs are almost no risk" is not true:
- In 2025 India had about 104–108 mainboard IPOs. The **median listing gain fell to about
  4–5%**, from about 15% in 2024. One analysis found **59% of 2025 IPOs trading below
  their listing price** later. **[medium: IPO data sites; their counts differ slightly]**
- Losers exist even on listing day (for example −36% and −35% in 2025). Popular retail
  IPOs are heavily oversubscribed, so the chance of allotment is low.

### Regulation: the line we must not cross
- A tool that says "apply" or "avoid", or predicts listing gains, is doing research-analyst
  or adviser work. In India that needs SEBI registration. Using AI does not move the
  responsibility off the people running it. SEBI has acted against "education" businesses
  that were really giving advice (December 2025 order). **[medium: legal commentary; read
  SEBI's own circulars before building]**
- Existing apps already cover live data: GMP (grey market premium), subscription and
  allotment trackers (IPO Prime, IPO Market, Chittorgarh). IPOGyani sells AI listing
  predictions. That is the risky side. **[weak]**

### The version that is legal and useful
**"Explain this IPO in plain language"**, with no verdict:
- It reads the RHP (red herring prospectus: the company's official offer document, often
  hundreds of pages) and answers with page citations: what the company does; how much
  money goes to the company versus to existing shareholders selling out (offer for sale);
  what the money will be used for; the top risk factors; pending court cases; the revenue
  and profit trend; and how the company's own "basis for issue price" section compares it
  to listed peers.
- A checklist of factual flags taken from the document, with the page for each, for
  example "promoters are selling 80% of their stake".
- A **compliance gate**, like the repo's risk skill: the output is blocked if it contains
  recommendation words ("buy", "apply", "will list at").
- Answers in Hindi and other regional languages.

### Honest fit with this product
- **Privacy is not the selling point here.** A prospectus is public. A cloud model would be
  more accurate, and a 3B model on 16 GB will struggle with a 400-page legal document.
- **It is a strong portfolio project** for fintech roles: PDF parsing, extracting tables,
  answers with citations, an evaluation set, and a compliance gate. It also tests the
  Phase 3 document pipeline on a hard, real document.
- Recommendation: build it as **one assistant (persona) in the gallery** or as a separate
  side project, not as the product's direction.

## 4. Real problems (Razorpay "Fix My Itch")

Full dataset: `spikes/fix-my-itch/problems.csv` / `.json`, produced by
`spikes/fix-my-itch/scrape.mjs`. That script decodes the page's Framer CMS chunk; robots.txt
allows the page.

About the data **[weak]**:
- The page claims "10,000+ verified problems", but only **141** are published, across 17
  categories with 5–10 each. The top-10 section is hard-coded separately, so "caring for
  aging parents" is not in the 141.
- Each problem has an itch score (overall, 0–100) and severity, frequency, TAM (market
  size), competition and whitespace (room left for a new product). The scores are
  AI-generated ("AI-powered curation"), and **TAM uses 1–10 in some categories and 10–100
  in others**. Compare scores only within a category.
- The problem titles are useful as ideas. The scores are not evidence of demand.

Problems that fit a private, document-aware assistant (itch score in brackets):

| Problem | Category | Fit |
| --- | --- | --- |
| Why do people struggle to track where their money goes each month? (90.5) | FinTech | Reads bank statements locally |
| Why don't people understand the insurance policies they buy? (82; frequency 10, whitespace 9) | FinTech | Explains the policy document in plain language |
| Why does investing feel intimidating to ordinary people? (81.5) | FinTech | Investment explainer (the IPO idea), education only |
| Why can't heirs access bank accounts easily after a death? (80) | FinTech | Family record of accounts, nominees, papers |
| How do users reconcile bank statement transactions monthly? (79.5) | Payment Issues | Bank statements are private data |
| Why can't patients access digital copies of medical records? (73.5) | HealthTech | Family health records |
| Why do patients lack tools to compare conflicting diagnoses confidently? (82.5) | HealthTech | Explaining reports. Medical-advice risk |
| Why do families lose track of wedding gift money? (73.5) | FinTech | Household ledger |
| Why can't households easily access digital proof for in-warranty product repairs? (65.5) | Consumer Services | Bills and warranty cards |
| Why do micro-SMEs waste 10+ hours weekly on invoice management? (67.5) | B2B Services | Wedge B (small office) |
| Why can't SMEs access fractional CFO services affordably? (71.8) | Professional Services | Wedge B |
| Why do meetings waste 4 hours daily instead of summaries? (64) | SaaS | Private meeting notes |
| Why don't global learning platforms support high-quality regional language instruction? (85.5) | EdTech | Regional-language answers |
| Top 10 (no score): caring for aging parents across cities | Healthcare | Family records plus phone access |

**What this suggests:** the cluster with the most problems here is *the household's money
and papers*: insurance, bank statements, heirs and nominees, medical records, warranties
and parents. That is section 4's candidate below. Nothing in the list is about IPOs
specifically. The closest problem is "investing feels intimidating".

### Candidate that combines everything: private family records assistant
- **Problem:** an Indian family's important papers are scattered across WhatsApp, email and
  paper: insurance policies, FD receipts, property papers, Form 16 / AIS / 26AS, the
  parents' medical reports and pension papers. When something happens to the parents, a
  child in another city cannot find anything.
- **Why private and local matters here:** these documents contain Aadhaar, PAN, bank and
  health data, the most sensitive things a family has. "It never leaves your home machine"
  is a real reason to choose us. India's DPDP Rules (notified November 2025) raise
  awareness of this. For personal or domestic use the obligations largely fall on companies,
  not on the family.
- **What it would do:** add a document (from the phone camera or a PDF), and the assistant
  extracts key facts (policy number, renewal date, maturity date, nominee) and asks the
  owner to confirm them. Family members ask questions from their phones ("when does Papa's
  health policy renew?") and get reminders. Explanations are in plain Hindi or English. It
  gives no financial advice.
- **Reuses:** server mode's multi-user isolation (household mode), Phase 3 documents with
  citations, the phone access in section 2, session recovery and backup.
- **Unknowns:** competitors (DigiLocker holds government documents; family vault apps were
  not researched yet), willingness to pay, and whether small models extract dates and
  amounts reliably.
- This sits between wedges A and B. It could be called wedge D. A CA firm (wedge B) has the
  same problem with client documents, so the engine is shared.

## 5. Process: spec-kit

GitHub spec-kit workflow: `constitution` → `specify` → `clarify` → `plan` (writes
`research.md`) → `checklist` → `tasks` → `analyze` (checks that spec, plan and tasks agree)
→ `implement`. Only `specify` is required before `plan`. The others are quality gates.
`CLAUDE.md` and roadmap section 6a are a natural starting `constitution`.

On "much cleaner code": the storage was just refactored into ports with a shared contract
suite. A rewrite would throw away tested work. Better: a review that lists concrete
problems, and fix those as spec-kit tasks.

## 6. Decisions for the owner
1. Wedge: A (personal), B (small office), or D (family records, section 4)? The five
   interviews in `docs/interview-guide.md` should include D questions before deciding.
2. Phone access: move it from Phase 5 to right after 1b?
3. Packs (section 7): adopt the pack format as the way the product grows, with Statement
   Detective as the first pack?
4. spec-kit: set it up now (`specify init`), with the constitution drawn from `CLAUDE.md`?

Agreed on 2026-11-20: finish Phase 1a (step 7 onward) first. The specs for phone access and
packs come after.

## 7. Beyond the wedge: home AI, phone, packs

### Why day-trader-skill spread (about 8.8k stars)
Not because of trading. Because of how it is packaged:
- It does **one concrete job from start to finish** ("find a setup, check the risk, place
  the order"), not an open chat box.
- It is **easy to show**: one command gives a result you can screenshot and share.
- It **installs into a tool people already use** (Claude Code). There is nothing new to set
  up.
- Its **safety is visible**: a risk gate that blocks, and a human "yes" before every action.

Lesson: people share **packs**, not engines. The Phase 2 assistant gallery is the start of
this.

### The picture
The laptop is the engine. The phone is where people use it. Packs are what they use it for.

```
        Packs (one job each, shareable)
   ┌──────────┬───────────┬──────────────┐
 Phone    Web chat     CLI / API / MCP   ← ways in
   └──────────┴─────┬─────┴──────────────┘
          Gateway on your laptop (keys, limits, queue, storage)
                    │
                  Ollama (or another engine later)
```

### Ideas for everyday users
1. **"Send to my AI" from the phone's share menu.** Share any PDF, photo or screenshot to
   the home machine, which explains it, files it and sets reminders. This is the headline
   use of phone access.
2. **Statement Detective:** share a bank statement PDF, see where the money went. It never
   reaches a server. (Itch: "where does my money go", 90.5.)
3. **Policy Explainer:** "Does my health policy cover X? What is the waiting period?", with
   the page cited. (Itch: "people don't understand insurance they buy", 82, frequency 10.)
4. **Family Folder:** parents' medical reports, accounts and nominees, warranty bills. A
   sibling in another city can ask from their phone. (Itches: heirs and bank accounts,
   medical records, warranties, aging parents.)
5. **Ask by voice in Hindi or a regional language** from the phone. (Itch: regional language
   learning, 85.5.)
6. **"Is this a scam?"** Forward a suspicious WhatsApp message or SMS for a private check.
   Our own idea, not in the itch list. The size of the problem is unverified.

### Ideas for developers
1. **Use the local model from Claude Code, Cursor and similar tools** through an MCP server
   or an OpenAI-compatible endpoint, for cheap and private small jobs (summarising logs,
   drafting commit messages). Overlaps with wedge C.
2. **Approve from the phone.** When a coding agent or a pack wants to do something risky,
   the phone shows Allow or Deny, plus "your job finished" notifications. This makes Phase
   5's permission prompts and audit log a phone feature.
3. **A pack format others can publish:** instructions, scripts, the permissions it needs,
   and test prompts. Developers write a pack once, and everyday users run it from their
   phones. This is how the product grows without us building every feature.

### Limits, so we don't oversell
- **The machine must be on.** A MacBook Air sleeps with its lid shut. Packs suit an
  always-on Mac mini or an old laptop, which is also the step up to the office box (wedge B).
- **Several people at once means a queue.** On 16 GB, four family members asking at the same
  time wait in line. The existing admission control (Semaphore) handles that well, which is
  a strength.
- **Small models make mistakes.** Every pack shows its sources and says what it doesn't
  know. No financial or medical advice.

### Order, using spec-kit
1. Finish Phase 1a (step 7 onward). Every option needs it.
2. Spec for phone access: pairing, a key per device, Tailscale, the share menu.
3. Spec for the pack format, with Statement Detective as the first pack. It is the easiest
   to demo and the most private, which is how day-trader-skill spread.

## Sources
- day-trader-skill: https://github.com/jakeschincariol/day-trader-skill
- Razorpay Fix My Itch: https://razorpay.com/m/fix-my-itch/#all-problems
- spec-kit: https://github.github.com/spec-kit/reference/agentic-sdd.html ,
  https://www.mintlify.com/github/spec-kit/commands/overview
- IPO 2025 performance: https://www.indmoney.com/blog/ipo/ipo-2025-overview-listing-gains-fell-most-below-listing ,
  https://www.business-standard.com/markets/ipo/india-2025-ipos-record-listings-mixed-returns-check-top-winners-losers-125123000057_1.html ,
  https://theipoatlas.com/stats , https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp?exchange=mainline&year=2025
- SEBI and AI advice: https://taxguru.in/sebi/sebi-regulate-ai-generated-investment-advice-big-compliance-challenge-india.html ,
  https://www.mondaq.com/india/securities/1726258/sebis-crackdown-on-finfluencers-regulations-and-enforcement ,
  https://univest.in/blogs/sebi-finfluencer-rules-explained
- IPO apps: https://apps.apple.com/us/app/-/id6742342926 , https://www.ipomarket.in/ ,
  https://ipogyani.pages.dev/
- Phone clients: https://pocketgrove.com/blog/run-llm-locally-use-from-phone/ ,
  https://ollamamobile.com/blog/use-ollama-on-your-phone/ , https://lmmini.com/ ,
  https://www.promptquorum.com/power-local-llm/best-local-llm-apps-iphone-2026
- Local AI apps: https://www.storagereview.com/best/local-llm-tools ,
  https://atomic.chat/blog/guides/best-local-llm-apps
- Indian AI pricing: https://techcrunch.com/2026/08/18/perplexitys-free-ai-offer-left-it-with-millions-more-users-in-india/ ,
  https://inc42.com/features/openai-perplexity-google-unleash-discount-war-indian-market ,
  https://www.businesstoday.in/technology/news/story/from-free-for-a-year-to-card-on-file-how-airtel-and-perplexitys-ai-bundle-is-testing-consumer-trust-510521-2026-01-12
- DPDP Rules 2025: https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf ,
  https://theleaflet.in/explainer/indias-new-digital-personal-data-protection-rules-2025-a-detailed-reading
