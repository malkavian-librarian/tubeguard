# Publishing TubeGuard to the Chrome Web Store

A practical, TubeGuard-specific walkthrough. General Chrome Web Store (CWS) policy changes over
time — where a number could plausibly be stale, that's called out.

---

## 1. One-time setup: Developer Dashboard account

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   and sign in with the Google account you want to own the listing (a dedicated account, not a
   personal Gmail, is worth considering if you'll ever transfer ownership or add collaborators).
2. Pay the **one-time $5 USD registration fee**. This is charged once per *developer account*, not
   per extension — after paying it you can publish multiple items under that account (there's a cap,
   historically 20 published items per account, rarely relevant for a solo dev).
3. Verify your account (email + phone verification is generally required now; Google has tightened
   this over the past few years to fight spam/malware listings — expect an identity-verification
   step if you haven't published before).
4. Fill in the **account-level publisher details** (developer name shown on all your listings,
   contact email). This is separate from the per-item listing info in step 3 below.

**Source-check before you pay:** confirm the fee is still $5 at
https://developer.chrome.com/docs/webstore/register — Google has occasionally adjusted verification
requirements (not the fee itself, historically) and it's a 2-minute check.

---

## 2. Manifest & code requirements (TubeGuard-specific check)

Current `manifest.json` (read at review time):

```json
"manifest_version": 3
"permissions": ["storage", "alarms", "notifications", "tabs"]
"host_permissions": ["https://www.youtube.com/*", "https://openrouter.ai/*"]
"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'none';" }
"minimum_chrome_version": "120"
```

This is a strong starting position for review:

- **Manifest V3** — required; MV2 submissions are rejected outright.
- **Narrow host permissions** (`youtube.com` + `openrouter.ai`, not `<all_urls>`) — extensions with
  broad host patterns get slower, more scrutinized reviews (sometimes weeks). TubeGuard's scoped
  permissions should let it land in the fast lane — Google's own guidance says simple extensions
  with narrow permissions can clear review in under an hour, and ~90% of all submissions clear
  within 3 days.
- **No remote code** — the CSP forbids anything but `'self'`, and CLAUDE.md already bans
  `eval`/`Function()`/external CDN scripts. This directly avoids the #1 flagged violation
  ("remote code" / "arbitrary code execution") that CWS's automated scanner looks for.
- **No obfuscation** — `npm run build` uses esbuild's default bundling, not a minifier/obfuscator
  step. Keep it that way; obfuscated/minified-beyond-readability code is a common manual-review
  rejection trigger, separate from the automated scanner.

**Before you submit, double-check:**
- [ ] `tabs` permission — the dashboard's "permission justification" field (see §4) must explain
  *why* you need it (e.g. "to detect the active YouTube tab and query its URL for channel
  blocking"), not just restate the permission name. A justification that just repeats the
  manifest line is a common cause of a request for more info.
- [ ] `notifications` and `alarms` — same treatment, one sentence each.
- [ ] `host_permissions` for `openrouter.ai` — justify this explicitly as "the optional daily
  learning-analysis feature sends video evidence to the user's own OpenRouter API key, only when
  the user has opted in and configured a key; no data is sent otherwise." This is exactly the kind
  of permission a reviewer will otherwise flag as unclear-purpose.
- [ ] Single Purpose policy — CWS requires each extension to have one clearly stated purpose.
  TubeGuard does two things (blocking + watch-time tracking) that are tightly related to one
  purpose ("help you control your YouTube usage") — state it that way in the listing description,
  don't describe it as two separate tools bolted together.

---

## 3. Privacy — the part most likely to trip you up

TubeGuard is well-positioned here (local-only by default, `telemetry.enabled` defaults to `false`
per CLAUDE.md), but CWS **requires a privacy policy for any extension that handles user data**,
and "handles" is interpreted broadly enough to include local storage of browsing-adjacent data
(watch history, blocked channels) even if nothing leaves the device.

1. **Write and host a privacy policy** (a static page is fine — GitHub Pages, or a page in this
   repo's README rendered on GitHub). It must disclose:
   - What data is collected (blocked-channel list, watch-time stats, analysis run history — all
     local IndexedDB/`chrome.storage`).
   - That the OpenRouter API key and any evidence sent to OpenRouter is opt-in only, stored locally,
     and never logged/exported (this is already a hard rule in CLAUDE.md — the policy should just
     describe the real behavior).
   - That no data is sent to the developer or any third party except the user's own OpenRouter
     account, and only when the feature is explicitly enabled with a user-supplied key.
2. **Chrome Web Store's Limited Use requirements** apply because you request host permissions and
   handle what could be considered personal/usage data. In the Dashboard's Privacy tab you must:
   - Paste the privacy policy URL.
   - Fill in the **Data Usage** disclosure form (a checklist of data types collected — check only
     what's true: TubeGuard should be able to honestly check "does not sell or transfer user data
     to third parties" and "does not use or transfer data for purposes unrelated to the item's
     single purpose").
   - Certify compliance with the Developer Program Policies' Limited Use requirements.
3. This section of the Dashboard is the most common source of "needs more information" bounces —
   a plausible but generic privacy policy (e.g. a boilerplate template that doesn't actually
   mention the extension by name or its real data flows) gets rejected. Write it specific to
   TubeGuard's actual behavior.

---

## 4. Store listing assets

| Asset | Spec | Required? |
|---|---|---|
| Extension icon | 128×128 PNG (pack a 96×96 icon centered with 16px transparent padding per Google's guidance; also ship 16/48 for the toolbar — already present in `assets/icons/`) | Required |
| Screenshots | 1280×800 or 640×400 PNG/JPEG, 1–5 images | At least 1 required, 5 recommended |
| Small promo tile | 440×280 PNG/JPEG | Required |
| Marquee promo tile | 1400×560 PNG/JPEG | Optional — only needed if you want a shot at featured placement |
| Short description | ≤132 characters, shown in search results | Required |
| Detailed description | Longer body text on the listing page | Required |

TubeGuard's current icons (`assets/icons/icon16.png`, `icon48.png`, `icon128.png`) cover the
manifest requirement. You still need to **produce screenshots and promo tiles** — none exist in
this repo yet. Practical approach: load the unpacked extension, open the popup/stats/options pages
(once the Phase 4 brandbook theming lands — screenshot the final purple/neon look, not a
pre-redesign state), and capture at 1280×800.

Listing copy should lead with the single-purpose framing from §2: "block distracting YouTube
channels and see exactly how much time you're reclaiming" — not a feature list.

---

## 5. Review process

- Most submissions: reviewed within **24 hours**, ~90% within **3 days**. Narrow-permission
  extensions with `activeTab`-style scoping can clear in minutes to an hour; TubeGuard's
  `youtube.com`/`openrouter.ai`-only scoping should land closer to that fast end, not the
  multi-week tail reserved for `<all_urls>` extensions.
- First-time publishers and any extension requesting sensitive-sounding permissions may see an
  extra manual-review pass even if the code is clean — budget a few days for a first submission
  regardless.
- **Staged rollout**: the Dashboard supports publishing to a percentage of users first (useful for
  a v1 launch if you want to catch install-time issues before 100% exposure) — optional, not
  required.
- **Common rejection causes to avoid** (already largely avoided by this codebase, listed so you
  verify rather than assume):
  - Automated-scanner triggers: `eval`, dynamic `Function()`, remote script loading, unused
    declared permissions. CLAUDE.md already forbids all of these — the risk is regression, not a
    fresh violation.
  - Manual-reviewer triggers: vague single-purpose statement, broken/missing privacy policy link,
    screenshots that don't match actual functionality, permission justifications that just restate
    the permission name.
- If rejected, the Dashboard gives a specific policy citation — fix precisely that, resubmit; don't
  guess broadly at "safer" permission cuts that change functionality.

---

## 6. Monetization

**Chrome Web Store Payments (Google's built-in licensing/IAP API) was deprecated years ago** — new
paid items were blocked in 2020 and existing charges stopped February 1, 2021. It is not a current
option and nothing should be built against it. Extension monetization today happens **outside** the
Web Store, via your own backend or a third-party billing provider (Stripe, Paddle, or
extension-specific wrappers like ExtensionPay that handle the license-check-in-the-extension
pattern for you).

**Fit for TubeGuard specifically:** the whole value proposition is "local-only, no telemetry by
default, your data stays on your machine" (CLAUDE.md's `telemetry.enabled: false` default is a
stated design commitment). Monetization choices should not contradict that positioning:

- **Recommended: keep the core extension free, forever.** Blocking + watch-time tracking is cheap
  to run (no server cost) and is the trust-building layer — a free core is what makes the privacy
  claim credible in the first place.
- **Recommended: optional donation link** (GitHub Sponsors / Buy Me a Coffee / Ko-fi link in the
  popup footer or options page). Zero implementation cost, zero conflict with the privacy
  positioning, no billing/tax compliance burden.
- **Plausible: paid tier for the daily-learning-analysis feature's compute**, since it already
  requires the user's own OpenRouter API key — i.e. OpenRouter costs are already the user's, not
  yours, so there isn't an obvious "your infra cost" to recoup by gating it further. If you wanted
  a paid tier here, the honest version is a value-add (e.g. a hosted/managed API key with a markup,
  bypassing the "bring your own key" friction) rather than gating features that already work
  locally — done via your own backend issuing signed license tokens the extension checks
  client-side (never trust a client-side-only check for anything beyond soft feature gating).
- **Avoid:** anything that requires broadening host permissions or adding telemetry to support
  billing/analytics — that directly undermines the "no data leaves the machine unless you opt in"
  claim that's currently true and worth keeping true.
- **Avoid:** dark-pattern nags, forced account creation, or ad injection — all are both against CWS
  policy (User Data Privacy / Deceptive Installation policies) and against this extension's stated
  purpose (helping people spend less attention on manipulative UI, not adding more).

---

## 7. Pre-submission checklist

- [ ] `npm.cmd run build` succeeds, `npm.cmd test` and `npm.cmd run test:e2e` are green
- [ ] `manifest.json` version bumped from `0.1.0` to your intended release version
- [ ] Privacy policy written and hosted at a stable URL, describing TubeGuard's actual data flows
      (local storage, opt-in OpenRouter usage, `telemetry.enabled: false` default)
- [ ] Permission justifications drafted for `storage`, `alarms`, `notifications`, `tabs`, and the
      `youtube.com`/`openrouter.ai` host permissions (one sentence each, specific — not restating
      the permission name)
- [ ] Single-purpose statement drafted for the listing ("help you control your YouTube usage" —
      not "blocking tool" + "analytics tool" as two purposes)
- [ ] Screenshots captured (1280×800, at least 1, ideally 5) — popup, stats page, options page,
      and a live YouTube block button, ideally after the Phase 4 brandbook redesign lands
- [ ] Small promo tile (440×280) created; marquee tile (1400×560) optional
- [ ] Short description (≤132 chars) and full description written, leading with the single purpose
- [ ] Developer Dashboard account registered, $5 fee paid, identity verification completed
- [ ] Data Usage disclosure form in the Dashboard filled in honestly (no data sale/transfer, no use
      beyond the stated single purpose)
- [ ] `npm.cmd run zip` run to produce `tubeguard.zip`, and the zip's contents spot-checked
      (confirm `build/service-worker.js` and `build/content-main.js` are present and current)
- [ ] Optional: donation link decided and added to popup/options footer before this first release,
      if you want it live from day one rather than a follow-up update

---

## Sources

- [Register your developer account — Chrome for Developers](https://developer.chrome.com/docs/webstore/register)
- [Supplying Images — Chrome for Developers](https://developer.chrome.com/docs/webstore/images)
- [Creating a great listing page — Chrome for Developers](https://developer.chrome.com/docs/webstore/best-listing)
- [Complete your listing information — Chrome for Developers](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Chrome Web Store review process — Chrome for Developers](https://developer.chrome.com/docs/webstore/review-process)
- [Chrome Web Store Payments deprecation notice — chromium-extensions group](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/5ytB3XWuA8I)
