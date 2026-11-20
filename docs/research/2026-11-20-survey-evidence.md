# Survey evidence for the wedge decision

Date: 2026-11-20. Why this file exists: the owner has no users to interview yet, so this
collects published surveys as a stand-in. Surveys show what people **worry about**; they
don't show whether anyone would **pay for our product**. Treat this as a direction, not a
decision. Evidence quality: **[strong]** large named survey, **[medium]** smaller or
second-hand, **[weak]** vendor or blog.

## Summary

| Wedge | What surveys say | Strength |
| --- | --- | --- |
| **B. Small professional firm** (CA, legal, clinic, finance) | Privacy / confidentiality is a **top-2 barrier** to AI in every professional survey found. Firms already pay for software. India: data security is the top worry of hesitant small businesses. | **Best supported** |
| D. Family records | The problem is real and large (unclaimed money, heirs). No survey of willingness to pay. Indians are relatively **comfortable** sharing data with AI. | Problem yes, buyer unproven |
| C. Developers | 81% worry about data privacy with AI agents; Ollama is already the most used orchestration tool. Crowded and developers rarely pay. | Need yes, business weak |
| A. Everyday person (India) | India is the **most comfortable** country with companies using their data; free cloud AI is everywhere. | Weakest |

**Direction: wedge B**, a private AI for small professional firms, starting with Indian CA
firms. **Confidence: medium-low** until a few real firms confirm it.

## Wedge B: small professional firms

- Tax and accounting (Thomson Reuters, 2026 report): top concerns about GenAI are
  inaccurate answers 76.4%, **privacy and confidentiality of what is entered 70.5%**, data
  security 70.1%. Adoption in tax and accounting rose from 8% to 21% (2024 → 2025).
  **[strong, US-led]**
- Accountancy worldwide (Ipsos for Chartered Accountants Worldwide, April 2025; India in the
  sample): **data security is the main barrier** to wider AI use; senior staff (the buyers)
  worry more than juniors. **[strong, global]**
- Law firms (ILTA 2025, ~600 firms): **over 80%** name confidentiality/misuse and accuracy as
  their biggest GenAI concerns; only 48% have a firm policy. Law360 2025 (~400 attorneys):
  confidentiality is the second worry after ethics. **[strong, US]**
- Legal, finance, tax workers (BCG 2025, 300 people): **data privacy and confidentiality is
  the top impediment** to adoption. **[strong, US]**
- Indian CAs: a study of 200 CAs in Uttar Pradesh found trust in AI outputs but persistent
  privacy, confidentiality and breach concerns. **[medium, details unclear]** ICAI ran an AI
  adoption survey; no results published yet. The ICAI Code of Ethics requires protecting
  client information; most DPDP Act duties for firms apply from **13 May 2027**.
- Indian small businesses: only ~15% use AI; barriers are cost, skills and easy tools (ISAS,
  NUS, 2025) **[medium]**. Among digitally hesitant MSMEs, **81% worry about data security**
  (CyberMedia Research, ~400 firms) **[medium]**. NTT DATA: GenAI is costly for low-cost
  economies; private AI is gaining traction as a data-secure alternative **[weak, vendor]**.

What this means for us: the fear that blocks these firms is exactly what a local box
removes. The open questions are the ones surveys can't answer: will a CA firm pay, how much,
and is document search good enough on a small model.

## Wedge D: family records

- India holds about **₹1.82 lakh crore of unclaimed money**; the government ran a national
  campaign (Oct–Dec 2025, 477 districts) to help families trace it, and asks families to keep
  policy records and tell relatives about them. **[strong: government]**
- Estate guides: many transfer problems arise because property papers, bank records,
  insurance documents or the will went missing. **[weak]**
- Indian consumers are relatively relaxed about data: 64% would share health data and 49%
  financial data with a company's AI agent (32% globally); India is the most comfortable of
  23 countries with personalisation (Okta 2025, XM Institute 2025). **[medium]**

What this means: the problem is real, but "private" may not be the reason Indian families
choose a product. Reminders, organisation and the heirs problem might be. Unproven.

## Wedge C: developers

- Stack Overflow 2025: **81% worry about privacy and security of data** with AI agents;
  security/privacy is the **top deal-breaker**; **Ollama is the most used orchestration tool
  (51%)**. **[strong]**
- Local LLM adoption reasons: privacy first, then cost; evidence is forum analysis. **[weak]**

What this means: real need, but a crowded field (LiteLLM, OpenRouter, LM Studio) and a
group that rarely pays.

## Wedge A: everyday person (India)

- Free cloud AI everywhere (ChatGPT 180M, Gemini 118M monthly users in India; free bundles),
  paid conversion unproven (see `2026-11-20-pivot-research.md`). Indian consumers are among
  the most comfortable sharing data. Kaspersky 2025: 37% of Indian Gen Z discuss personal
  issues with AI. **[medium]**

What this means: privacy alone won't win everyday Indian users away from free tools.

## What surveys can't tell us, and the cheapest way to find out

1. **Will a small firm pay, and how much?** Talk to 3–5 CAs (family, friends of friends,
   LinkedIn, ICAI study circles). Even without users, this is reachable.
2. **Do they care enough to sign up?** A one-page site "Private AI for CA firms: nothing
   leaves your office" with a waitlist. Signups from strangers are real evidence.
3. **A short survey** for CAs and office staff in LinkedIn/WhatsApp groups (5 questions,
   below).

Draft survey (Google Form, under 2 minutes):
1. Your role and firm size (solo / 2–10 / 11–50 / 50+).
2. Does your firm use ChatGPT or similar today? (No / Some people / Officially)
3. Are there documents you would **never** paste into ChatGPT? Which kinds?
4. If an AI ran inside your office and nothing left it, what would you use it for first?
5. What do you pay today for software or IT support per month? (ranges)
   + Optional: email for a 20-minute call.

## Sources
- Thomson Reuters, tax and accounting AI: https://tax.thomsonreuters.com/blog/challenges-of-adopting-ai-in-accounting-firms-tri/ , https://tax.thomsonreuters.com/blog/the-impact-of-ai-on-the-tax-and-accounting-profession/
- Ipsos / Chartered Accountants Worldwide, AI in Accountancy (Apr 2025): https://www.ipsos.com/sites/default/files/ct/publication/documents/2025-04/CAW_AI%20in%20Accountancy_Apr2025.pdf
- BCG, GenAI in professional services (2025): https://www.bcg.com/publications/2025/gen-ai-in-professional-services
- ILTA 2025 / Bloomberg Law: https://news.bloomberglaw.com/bloomberg-government-news/legal-ai-revolution-moves-ahead-at-measured-pace-survey-says
- Law360 Pulse 2025 AI Survey: https://www.law360.com/pulse/articles/2299568
- Uttar Pradesh CA study: https://pdfs.semanticscholar.org/5332/54f3527069d70e940d60e9fdeed1385f3f6d.pdf
- ICAI and AI: https://indicanews.com/icai-charts-future-of-chartered-accountants-in-the-age-of-ai/
- ISAS (NUS), AI adoption in India: https://www.isas.nus.edu.sg/papers/ai-adoption-in-india-moving-the-needle-forward/
- DQ India / CyberMedia Research on MSMEs: https://www.dqindia.com/features/how-indias-msmes-are-embracing-tech-and-whats-holding-them-back-9648759
- NTT DATA via Entrepreneur India: https://india.entrepreneur.com/en-in/news-and-trends/genai-doesnt-always-fit-low-cost-economies-ntt-data/491380
- WEF / Ministry of MSME playbook (2025): https://psa.gov.in/CMS/web/sites/default/files/publication/WEF_Transforming_Small_Businesses_2025.pdf
- Unclaimed assets, PIB: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2208730&reg=3&lang=1 ; https://basispointinsight.com/Story/india-s-unclaimed-assets-reveal-a-trillion-rupee-crisis-demanding-reform_88e7e8c3e5ec.html
- Okta 2025 India: https://www.cioandleader.com/indias-digital-identity-surge-comes-with-rising-concerns-around-ai-and-trust-oktas-customer-identity-trends-report-2025/
- XM Institute 2025: https://www.qualtrics.com/m/www.xminstitute.com/wp-content/uploads/2025/03/XMI_RR-DS_ConsumerPreferencePrivacyPersonalization-2025.pdf
- Kaspersky / Business Standard 2025: https://www.business-standard.com/technology/artificial-intelligence/india-s-gen-z-shares-personal-issues-with-ai-despite-privacy-risks-report-126091100715_1.html
- Stack Overflow Developer Survey 2025: https://survey.stackoverflow.co/2025/ ; https://stackoverflow.blog/2025/07/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here
- Local LLM adoption (weak): https://vibe-data.com/intelligence/local-llm-ecosystem-nov-2025
