# Spec: phone access v1

Status: built 2026-11-25 (steps 1-5), shipping in 0.3.0. Step 0 (the spike with real phones
and Tailscale) is still to do by the owner: see "Manual check" below. Step 3 of
"Next up" in the roadmap (moved up from Phase 5). Builds on the web chat (0.2.0): the phone
opens the same page.

Owner decisions (2026-11-24): **both connection paths** (home Wi-Fi and Tailscale); the
pairing QR appears in **the terminal (`llm phone`) and the laptop's web page**.

**Headline (from `docs/research/usp.md`): control, not just access.** "Use it from your
phone with no app, see every device that's signed in, and cut one off in one click."
Phone access alone is a commodity (Open WebUI works in a phone browser); the device list
with revoke, pairing only from the computer itself, and nothing exposed but the page are
what a small office (wedge B) values. The QR is the means.

## Product analysis

**Who uses it, by wedge** (the wedge is still undecided; this works for all):
- A, personal: ask the assistant from the sofa or bed while the laptop sits on the desk.
- B, small office (best supported by surveys): staff use the office box from their phones
  on office Wi-Fi; client files never leave the office. Needs per-device revoke (a staff
  member leaves), so the devices list is a must, not a nice-to-have.
- D, family records: a parent or sibling asks from their own phone.

**User stories**
1. "I scan a QR code on my laptop and I'm chatting on my phone, no app, no password."
2. "When I lose my phone or someone leaves, I remove that phone in one click."
3. "Away from home I can still reach my assistant, securely" (Tailscale path).
4. "My chats are the same on phone and laptop" (one database, already true).

**Existing phone apps** (see `docs/research/2026-11-20-pivot-research.md` section 2):
Ollama Connect, Ollama Mobile (unofficial), Reins, LM Mini (retired at the end of 2026),
Off Grid AI. They connect to **raw Ollama**: it must listen on all interfaces
(`OLLAMA_HOST=0.0.0.0`), has **no authentication** and uses plain HTTP; anyone on the Wi-Fi
can use the models; history lives on the phone only; for outside home, "use a VPN".

**What's unique in ours**
| | Existing apps | Ours |
| --- | --- | --- |
| Install on phone | An app | Nothing: the browser |
| Who can use it | Anyone on the Wi-Fi | Only paired phones (QR, one-time code) |
| Lose a phone | No control | Revoke that device |
| Ollama exposed to the network | Yes | Never (stays on 127.0.0.1) |
| History | Per phone | Shared with the laptop (same conversations) |
| Outside home, encrypted | "Set up a VPN" | Tailscale path, guided by `llm phone` |
| Errors | Generic | Plain language with the fix (same as the laptop) |

**Success measures**: pairing a phone takes under 1 minute from `llm phone` to the first
answer; zero requests accepted from an unpaired device in tests.

## Research findings
- A page on `http://<LAN IP>` is **not a secure context** in phone browsers: chat works,
  but no microphone (`getUserMedia`) and no service worker (offline page, proper PWA).
  Those need HTTPS.
- Trusted HTTPS on a LAN IP needs Plex-style infrastructure (own domain, per-install
  wildcard certificates, custom DNS), and breaks with routers that block DNS answers
  pointing at private IPs. Out of scope: the "no new infrastructure" rule.
- **Tailscale `serve`** gives a real Let's Encrypt certificate for
  `https://<machine>.<tailnet>.ts.net`, proxies **only to 127.0.0.1**, keeps running with
  `--bg` (also after reboots), and adds a `Tailscale-User-Login` header (stripped from
  clients, so it can't be faked). Needs MagicDNS and "Enable HTTPS" in the Tailscale admin
  console; machine names appear in public certificate logs. Result: the gateway never
  opens a network port.
- `.local` names: iOS resolves them; Android only since a late-2025 resolver update, so the
  **QR carries the IP address**, with the `.local` name shown as a hint.
- Chrome's Local Network Access prompt (Chrome 142) gates requests from public sites to
  local addresses. Our page and API share one origin, so it shouldn't apply. Verify on a
  real phone.

## Design

**Two paths, one pairing system**
1. **Home Wi-Fi** (plain HTTP, home only): off by default; `llm start --phone` (or
   `PHONE_ACCESS=wifi`) makes the gateway listen on the local network too. Clear caveat:
   use it only on a Wi-Fi you trust, because traffic is not encrypted. macOS may ask
   whether node may accept incoming connections: say so in the output.
2. **Tailscale** (HTTPS, anywhere): the gateway stays on 127.0.0.1; the user runs
   `tailscale serve --bg 3000`; the gateway detects its ts.net name
   (`tailscale status --json`, best effort) and allows that host. `llm phone` prints the
   Tailscale steps when Tailscale isn't set up.

**Pairing by QR**
- `llm phone` (QR in the terminal, with the `qrcode` package, 1.5.4, MIT) and a **"Connect
  a phone"** button on the laptop's page (QR as a `data:` image, which the current
  Content-Security-Policy already allows).
- QR = `<base>/#code=<one-time code>`, where the base is the Tailscale URL if available,
  else `http://<LAN IP>:<port>`. The code works once, for **5 minutes** (longer than
  `llm open`'s 60 seconds: scanning takes time). The phone's page exchanges it for a
  session cookie, as the laptop's does today.
- Only an **API key, or a session from this laptop (loopback)**, may create pairing
  codes. A phone session cannot pair more devices.

**Devices**
- Each phone is one web session with a **device name** (from the browser, editable).
  `GET /v1/web/sessions` (mine: name, created, last seen, "this device"),
  `DELETE /v1/web/sessions/{id}` (revoke). Page: a "Devices" panel. CLI: `llm devices`,
  `llm devices revoke <id>`.

**Security rules for requests from the network (not loopback)**
- The host allow-list grows automatically: this machine's LAN IPv4 addresses,
  `<hostname>.local`, the Tailscale name. `WEB_HOSTS` still adds more. The Origin check is
  unchanged.
- From the network, only: the page and `/assets/*`, `POST /web/session`, and `/v1/*` with a
  valid session or key. `/metrics` stays loopback-only in single-user mode.
- Behind `tailscale serve`: trust forwarded headers **only from 127.0.0.1**; mark the
  cookie `Secure` when the original request was HTTPS.

**Phone page polish**: a drawer-style conversation list on narrow screens, safe-area
padding, large tap targets. Offline page / add-to-home-screen (PWA) and voice: **v2**, on
the Tailscale (HTTPS) path only.

**Out of scope (v1)**: a native phone app, the share sheet ("Send to my AI"), push
notifications, access from outside home without Tailscale, Plex-style certificates.

## Build order (one commit each, all suites green)
0. **Spike (1 hour, before code):** on the owner's Mac with Tailscale: which Host, Origin
   and `X-Forwarded-*` reach the gateway behind `tailscale serve`; does a real phone (iOS
   and Android) sign in over the Wi-Fi IP and over ts.net. Record the results here.
1. **Device sessions:** columns, list and revoke endpoints, pairing-code purpose and
   lifetime, the key-or-loopback rule; storage contract and integration tests.
2. **Network access:** the `--phone` listener, the automatic host allow-list (LAN IPs,
   `.local`, Tailscale), loopback-only `/metrics`, forwarded headers from loopback only.
3. **CLI:** `llm phone` (terminal QR, Wi-Fi or Tailscale URL, Tailscale steps), `llm devices`.
4. **Page:** "Connect a phone" (QR), "Devices" panel, phone layout.
5. **Ship:** package smoke test and e2e, README, CHANGELOG, release 0.3.0.

## Tasks
**Step 0, spike** (no code kept)
- T0.1 Tailscale on the Mac: `tailscale serve --bg 3000`; log the Host, Origin,
  `X-Forwarded-*` and `Tailscale-User-Login` the gateway sees.
- T0.2 iPhone and Android: sign in over `http://<LAN IP>:3000` and over ts.net.
- T0.3 The macOS firewall prompt wording. Results go into this spec.

**Step 1, device sessions**
- T1.1 Schema: `web_codes.purpose` (`open` | `pair`), `web_sessions.device_name`,
  `web_sessions.created_from` (`loopback` | `network`); `npm run db:generate` (both DBs).
- T1.2 Port and adapters: `listSessions(userId, now)`, `revokeSessionById(userId, id, now)`.
- T1.3 Service: lifetime by purpose (60 s / 5 min); `redeem(code, deviceName, fromLoopback)`.
- T1.4 Routes: `POST /v1/web/codes {purpose}` (key, or a loopback session for `pair`),
  `GET /v1/web/sessions`, `DELETE /v1/web/sessions/{id}`; schemas, endpoints, OpenAPI.
- T1.5 Tests: storage contract (list and revoke scoped by user); web auth (a phone session
  can't make codes; a revoked device gets 401); contract coverage.

**Step 2, network access**
- T2.1 `networkHosts(interfaces, hostname, tailscaleName)`: a pure function that builds the
  allow-list; unit test.
- T2.2 Tailscale name detection (`tailscale status --json`, with a timeout, best effort).
- T2.3 `--phone` / `PHONE_ACCESS=wifi`: listen on the LAN addresses as well (a second
  listener, or `0.0.0.0` plus checks: decided from the spike); a startup log line with the
  phone URL.
- T2.4 Network-request guard: requests from the network are limited to the page, assets,
  `/web/session` and authenticated `/v1/*`; `/metrics` loopback-only in single-user mode.
- T2.5 Trust forwarded headers from 127.0.0.1 only; a `Secure` cookie when the original
  request was HTTPS.
- T2.6 Tests with `inject({ remoteAddress })`, on both backends.

**Step 3, CLI**
- T3.1 The `qrcode` dependency; `llm phone` (URL choice: Tailscale, else Wi-Fi, else help text).
- T3.2 `llm devices [revoke <id>]`.
- T3.3 CLI tests (URL choice, output).

**Step 4, page**
- T4.1 "Connect a phone" dialog (QR from `qrcode`, expiry countdown, a new-code button).
- T4.2 "Devices" panel (names, revoke, "this device").
- T4.3 Phone layout (drawer list, safe area, tap targets).
- T4.4 Unit tests for the page logic.

**Step 5, ship**
- T5.1 Package smoke test (pair through the API, list devices).
- T5.2 e2e with `--phone` through the machine's own LAN IP.
- T5.3 README "Use it from your phone", CHANGELOG, version 0.3.0.
- T5.4 A manual walk with real phones.

## Analyze (consistency check before building)
- Every user story has tasks and tests: QR pairing (T1.3, T1.4, T3.1, T4.1; e2e T5.2),
  revoke (T1.2, T1.4, T4.2; tests T1.5), outside home (T2.2, T2.5, T3.1; manual T0, T5.4),
  same history (already true; the e2e checks that a chat started on the phone appears
  through the API key).
- Project rules respected: no auth bypass for "local" (pairing uses one-time codes, every
  request is authenticated); never send a saved key elsewhere (phones never get an API
  key, only a revocable session); no new infrastructure (Tailscale is the user's own and
  optional; the only new package is `qrcode`); DNS rebinding (the host allow-list stays
  explicit).
- Both modes: device sessions and pairing work in server mode too (an office box); the
  `--phone` listener is single-user only (server mode already chooses its `HOST`).
- Open risks, settled by the spike: the Host and forwarded headers behind
  `tailscale serve`; IP addresses changing after a router restart (re-pair; the `.local`
  hint); Wi-Fi client isolation on guest or office networks blocks the Wi-Fi path
  (Tailscale still works).
- Not covered in v1 on purpose: offline page and PWA, voice, share sheet, native app.

## Manual check (step 0, with real devices)
Built to be safe whichever way `tailscale serve` forwards requests: a request counts as
"this computer" only from 127.0.0.1 with a loopback Host and no forwarding headers;
forwarded Host and protocol are trusted only from 127.0.0.1. To confirm on real devices:
1. Same Wi-Fi: `llm start --phone`, `llm phone`, scan with an iPhone and an Android phone,
   send a message, then `llm devices revoke <id>` and reload the phone (signed out).
2. Tailscale: Tailscale on Mac and phone (HTTPS enabled in the admin console),
   `tailscale serve --bg 3000`, restart the assistant, `llm phone` (it now shows the ts.net
   address), scan on mobile data, send a message.
3. Write down the macOS firewall prompt, if any.

**Results so far (2026-11-26, Pixel 10 on home Wi-Fi, Chrome):**
- Pairing from the web page's QR worked; the phone signed in.
- Bug found and fixed: chats didn't show on the phone. Chrome's `scrollIntoView` returns
  a Promise, an effect returned it, and React called it as the cleanup (Safari returns
  nothing, so the Mac was fine). Effects now use block bodies; `web/src/effects.test.ts`
  guards it. Also fixed: `/` was cached for a year (sendFile overrode `no-cache`).
- The terminal QR in macOS Terminal didn't scan: Terminal leaves thin gaps between lines
  of block characters with many fonts, which stripes a half-block QR. `llm phone` now draws
  a "sharp" code from coloured spaces when the window is big enough (about 74x42), says
  how big otherwise, and `llm phone --browser` shows the QR as an image on the web page.

## Done when
- A phone on the same Wi-Fi scans the QR, is signed in, and streams an answer; a phone
  without a code can't; a revoked phone is signed out on its next request.
- The same with Tailscale over mobile data (outside home), over HTTPS.
- Tests: `inject({ remoteAddress: '192.168.1.20' })` for the network-only rules; a phone
  session can't create codes; `/metrics` refused from the network; the host allow-list
  built from given interfaces (pure function); the contract test covers the new endpoints;
  both backends.
- e2e: start with `--phone` and call the gateway through the machine's own LAN IP (not
  loopback).

## Existing code to reuse
- `src/services/web-session.service.ts` (codes, redeem, sessions): add a lifetime per
  purpose and a device name. `src/storage/ports.ts` `WebSessionsStore`, both adapters
  (`storage/{postgres,sqlite}/web-sessions.ts`) and `schema.ts` (new columns; migrations
  with `npm run db:generate`).
- `src/plugins/web-guard.ts` (`allowedHost`, `sameOrigin`) and `config.webHosts`
  (`src/config.ts`): extend the allow-list.
- `src/routes/web-session.ts` (`/v1/web/codes`, `/web/session`): pairing purpose, devices
  routes. `src/api/{schemas,endpoints}.ts`, then `npm run openapi`.
- `cli/src/commands/open.ts` (`browserCommand`, the code flow): the base for `llm phone`
  and `llm devices`.
- `web/src/App.tsx` (sign-in from `#code=`) works unchanged on the phone; new "Connect a
  phone" and "Devices" UI. `src/server.ts` `listen` for the extra listener.

## Sources
- Secure context required for the microphone:
  https://caniuse.com/mdn-api_mediadevices_getusermedia_secure_context_required ; a LAN-IP
  report: https://github.com/PerryLink/dsh-talk/issues/26 ; PWAs on iOS: https://firt.dev/ios-14/
- How Plex does HTTPS for every user: https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/ ;
  Let's Encrypt and local devices: https://community.letsencrypt.org/t/using-lets-encrypt-for-local-network-devices/101256 ;
  a community version: https://github.com/supersat/tlsmy.net
- Tailscale HTTPS certificates: https://tailscale.com/kb/1153/enabling-https/ ; Tailscale
  Serve: https://tailscale.com/kb/1312/serve ; identity headers: https://tailscale.com/s/serve-headers ;
  a Mac dev server on a phone: https://flaviocopes.com/tailscale-dev-server-phone.md
- `.local` on Android: https://www.esper.io/blog/android-dessert-bites-26-mdns-local-47912385 ;
  https://community.home-assistant.io/t/detail-mdns-android-os-limitations-on-the-web-server-components-documentation/374099
- Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access ;
  https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
- Existing phone apps for Ollama: https://pocketgrove.com/blog/run-llm-locally-use-from-phone/ ;
  https://ollamamobile.com/blog/use-ollama-on-your-phone/ ; https://lmmini.com/
- QR codes: the `qrcode` npm package, 1.5.4, MIT.
