# Design note — how the scraping was made reliable

This note covers the three things the assignment asks for: how reliability was
achieved, what trade-offs were made, and what the AI tooling got wrong on the
first attempt and how it was corrected.

Everything here is from measurements against the live mock store, not from
assumptions. Where a number appears, it came from an actual run.

---

## 1. Why a headless browser, not lightweight HTTP

The assignment says to prefer lightweight HTTP fetching and reach for a browser
only where the page genuinely requires it. I started by trying to avoid the
browser, and the investigation is what ruled it out.

The store is a React SPA (`<div id="root"></div>` and nothing else), so I looked
for the JSON API behind it. It exists, and it is generous:

| Endpoint | Returns |
|---|---|
| `GET /api/catalog?page&pageSize` | id, slug, name, brand, category, sku, description |
| `GET /api/product/:id` | the above plus specs and reviews |
| `GET /api/layout` | the rotating CSS class-name map |

**None of them return price or stock.** That omission is deliberate. The real
price comes from `GET /api/products/:id/price`, and getting a usable response
from it requires all of the following:

1. `GET /api/challenge` returns a salt, a difficulty, a signature, **and a WASM
   module** encoded in the response.
2. The client must solve a proof-of-work nonce, **execute that WASM module** and
   return its output, and attach a browser **attestation**: canvas fingerprint,
   WebGL fingerprint, `hardwareConcurrency`, screen metrics and frame timings.
3. `POST /api/session` validates all of that and returns a token bound to one
   method + path + product id, valid for **30 seconds**.
4. Only then does the price endpoint answer, and the body is **encrypted** — the
   page decrypts it in JS.

On top of the network flow there is a UI gate. From the store's own bundle:

```js
new Ar({ minMoves: 8, minDwellMs: 600 })
// ...
c = e => { o.current = e.nativeEvent.isTrusted; Xn(() => void s())() }
```

The Reveal button stays `disabled` until at least 8 mouse moves and 600ms of
dwell have been recorded over the price area, and the handler records
`event.isTrusted` — so a JS-dispatched click is ignored.

Reimplementing steps 1–4 in Node would mean porting obfuscated crypto and
fabricating a GPU fingerprint, and it would break the moment the store rotated
its WASM payload. Driving a real browser lets the page do that work, so the
scraper only has to solve the part that is actually stable: **finding the right
number in the DOM**.

So: lightweight HTTP for the catalogue (cheap, stable, no price), Playwright for
price and stock. That split is the judgment call, and it is the honest reading of
"only where the page genuinely requires it".

---

## 2. The DOM is adversarial

Having got the price to render, reading it is its own problem. The store plants
**three decoy prices** in the same container as the real one:

```html
<span class="price-value" aria-hidden="true" style="display:none">₹26,262</span>
<span class="mr-k2" style="text-decoration:line-through">₹25,761</span>   <!-- MRP -->
<span class="sl-k2">Deal price ₹23,443</span>                            <!-- VISIBLE decoy -->
<div class="vf29sqg pv-k2">₹​2​1​,​1​2​4</div>                          <!-- the real price -->
<span class="amount" data-price="true" aria-hidden="true"
      style="display:none">₹14,278</span>
```

Three separate traps, each defeating a different naive approach:

- **`[data-price="true"]`** is bait for anyone reaching for the obvious
  attribute. It is `display:none` and holds a wrong number.
- **`.price-value`** is bait for anyone reaching for the obvious class name.
  Also hidden, also wrong.
- **`Deal price ₹23,443`** is the nasty one: it is *visible*, so a visibility
  filter alone does not save you.

The real price is additionally **split into per-character `<span>`s with
zero-width spaces (U+200B) between every digit**, so `textContent` returns
`"₹​2​1​,​1​2​4"`. A naive `parseFloat` gets `NaN`.

And the class names rotate. `/api/layout` publishes the current mapping with a
`validUntil` roughly 40 minutes out:

```json
{"revision":625003,"variant":1,
 "classes":{"priceValue":"pv-k2","mrp":"mr-k2","sale":"sl-k2","stock":"st-k2",...},
 "priceTag":"div","priceCarrier":"split"}
```

Hardcoding `.pv-k2` would work for about forty minutes and then silently start
returning nothing.

**The approach that survives all of this:**

1. Fetch `/api/layout` every run and look up `classes.priceValue`. Never hardcode.
2. Select **only** `priceValue` — never fall back to `sale`.
3. Filter to genuinely visible elements (`display`, `visibility`, `opacity`,
   `aria-hidden`, and a non-zero bounding box).
4. Strip zero-width characters before parsing.
5. A **decoy tripwire**: if the number we selected equals one of the hidden decoy
   values, refuse the scrape rather than store it. If the selector ever drifts
   onto a trap, we record a failure instead of a plausible-looking wrong price.

`priceCarrier` also has a non-`split` variant and `priceTag` varies between
`div` and `span`; selecting by class and reading `textContent` handles both
without special-casing.

---

## 3. Retry, timeout and failure handling

Two layers of retry exist, and it matters that they are distinct:

- **The store's own**, inside the page — up to 6 internal attempts, visible in
  the UI as `Retrying (attempt n/6)…` and finally `Loaded in N attempts`.
- **Ours**, around the whole page load — 3 attempts with exponential backoff
  (1.5s base, 15s cap) and **±30% jitter**.

Jitter is not decoration. The cron run scrapes several products; without jitter a
store-wide hiccup makes every product retry in lockstep and hammer the store in
synchronised bursts.

Errors are typed with a machine-readable code (`gate_not_satisfied`,
`price_resolve_timeout`, `reveal_click_ignored`, `validation_failed`,
`decoy_price_selected`, `navigation_failed`, `product_not_found`, …) and carry a
`retryable` flag. A 404 is not retried — burning three attempts on a product that
does not exist helps nobody.

**Validation before storage.** A price must parse, be finite, and sit inside sane
bounds. Stock must be positively recognised — and this is the distinction the
assignment calls out specifically:

> a missing element is **not** "out of stock".

`parseStock` returns `null` for anything it does not positively recognise, and
`null` is treated as a scrape failure. Only an explicit `out-stock` class or an
explicit "Out of stock" string produces `inStock: false`. Guessing here would
silently corrupt the stock history with fake out-of-stock events.

**What is written on failure:** a `scrape_logs` row, and nothing else. No
`price_history` row, and `tracked_products.last_price` is left untouched. The
dashboard then shows the last known good price with an explicit "Latest scrape
failed" banner, rather than a blank or a zero.

---

## 4. Why the cron is external

Render's free tier sleeps. An in-process `setInterval` would stop with it and
silently never fire again — the exact "silently stop" failure the assignment
warns about.

So scheduling lives outside the app: `POST /api/cron/scrape`, authenticated with
a shared secret compared in **constant time** (`timingSafeEqual`), called by
cron-job.org every 2 hours. The secret is accepted via `Authorization: Bearer` or
`X-Cron-Secret` — never a query parameter, because query strings land in access
logs.

Two concurrency protections:

- A **run-in-flight guard**: a second cron firing while the first is still
  working returns `200 {skipped: true}` rather than double-scraping. It returns
  200 deliberately — a cron service treats non-2xx as "retry", and retrying a
  half-finished run would double-write history.
- **Per-product due-time checks**, so a cron that fires early, or twice, does not
  produce duplicate history rows.

Concurrency within a run is capped at 2. Each product drives a real browser
context; launching one per product would exhaust the free tier's memory long
before it got faster.

---

## 5. What the AI tooling got wrong on the first attempt

These are real mistakes from this build, in the order they happened. None of them
were caught by reading the code — all four were caught by running it.

### 5.1 Grabbing the visible "Deal price" decoy

My first extractor selected `.{priceValue}, .{sale}` and took the first visible
match. On some renders the `sale` element comes first in DOM order, so it
returned **`Deal price ₹23,443`** when the real price was **₹21,124**.

This is the failure mode the store is built to produce, and it is dangerous
precisely because the result *looks* fine — a plausible rupee value, correctly
formatted. It only surfaced because I was cross-checking against MRP and the
numbers stopped reconciling.

**Fix:** select strictly `classes.priceValue`, never `sale`, plus the decoy
tripwire in §2 so a future drift fails loudly instead of quietly.

### 5.2 Inventing a validation rule that did not hold

I hypothesised that `(1 − price/mrp) × 100` should always be an exact integer,
and briefly used it as a **price validator**. Measured against the store:

- it held for roughly 8 products in 10, and broke cleanly on the rest
  (e.g. `51.2147%`);
- the discount **badge percentage is independently randomised** — the same
  product rendered `8%`, `18%` and `4%` off across three consecutive scrapes
  while price and MRP barely moved.

Together the two checks fired on **9 of 12 healthy scrapes**. As a validator it
would have rejected valid prices and lost real history; as a warning it was a
cry-wolf detector.

**Fix:** deleted both heuristics. Only a genuine ordering violation
(`price > mrp`) is reported now, and structure-change detection is done properly
by watching the store's own `layout.revision`. The reasoning is preserved in the
code comments so the next person does not re-derive the same dead end.

The general lesson: a plausible-sounding invariant is a hypothesis, not a fact.
It needs measuring before it is allowed to gate a write.

### 5.3 Blaming the store for my own blocked clicks

Early runs showed attempt after attempt dying with `price_resolve_timeout` after
a full **60 seconds**, and the obvious reading was "the store is being slow, that
is the injected latency the brief mentions".

It was not. Playwright's own actionability log said so outright:

```
<div class="cookie-overlay">…</div> intercepts pointer events
```

An intermittent cookie-consent banner — `position: fixed`, `z-index: 50` — was
swallowing the Reveal click. Not present on every load, which is why it looked
like flakiness rather than a bug.

**Fix:** dismiss the banner (choosing **Decline**, the privacy-preserving
option) before arming the gate, and re-check for it inside the click loop since
it can appear at any moment.

**Result:** 8 ok / 6 failed became **12 ok / 0 failed**, and the same run went
from 298s to 112s.

I had also written a wait that could not tell "store is legitimately working"
from "the click never landed". It now distinguishes the block's `idle`,
`loading` and `retrying` phases and re-clicks (bounded at 3) only when genuinely
idle — turning a 60s dead attempt into a sub-second recovery.

### 5.4 A parser that broke on a currency format I had not seen

A batch run failed one product with:

```
validation_failed: price_missing (raw: "Rs. 12,723.00")
```

The store renders prices as `₹21,124` **most** of the time, but sometimes as
`Rs. 12,723.00`. My parser stripped everything except digits and dots — and the
full stop in `"Rs."` survived, producing `".12723.00"`, which has two decimal
points and was rejected as malformed.

I had tested the `₹` form and generalised from one sample.

**Fix:** anchor on a digit-led numeric token instead of deleting characters, so
any currency prefix or suffix is sidestepped. Malformed input like `₹1.2.3` is
still rejected rather than silently truncated to `1.2` — a partially-parsed
number is exactly the kind of wrong data that must never reach `price_history`.
Covered by a regression test using the exact failing string.

---

## 6. Trade-offs made

| Decision | Cost | Why it is right here |
|---|---|---|
| Playwright over HTTP for price | ~5–12s per product, ~300MB browser | The session token is unobtainable without a real browser. There is no cheaper correct option. |
| HTTP for the catalogue | Two code paths | The catalogue has no price and no gate. Using a browser for it would be pure waste. |
| Mirror the catalogue into Postgres | Needs a periodic sync | The store has no search endpoint and caps `pageSize` at 60; searching live would mean 17 requests per keystroke. |
| Concurrency of 2 | Slower than parallel | Each product is a browser context. More would exhaust Render's free tier. |
| Soft-delete on untrack | Rows accumulate | Hard-deleting would destroy price history — the product's most valuable asset. |
| Warn-only structure detection | Does not block bad data | Blocking on a noisy heuristic loses real history (§5.2). The decoy tripwire is the hard gate instead. |
| In-memory rate limiter | Resets when the instance sleeps | Single free-tier instance; the goal is only to stop the manual-scrape button being held down. |

---

## 7. Known limitations

- **Scrape duration scales with product count.** At ~5–12s each and concurrency
  2, roughly 20–25 products fit comfortably in a 2-hour window. Beyond that the
  run should be sharded across several cron schedules.
- **A cold Render instance adds 30–60s** to the first cron call after sleep. The
  `/health` endpoint exists so an external pinger can keep it warm.
- **If the store changes its attestation scheme**, the browser flow keeps working
  (the page does that work), but a change to the `price-block` class names or the
  `/api/layout` contract would need a code change. `layout.js` fails loudly on a
  missing class key rather than silently extracting nothing.
- **No authentication.** The app is single-tenant, as the brief describes. The
  cron endpoint is secret-protected and manual scrape is rate-limited, but the
  read endpoints are public.
- **Structure-change detection reports, it does not adapt.** A `layout.revision`
  change is logged and surfaced; reacting to it is a human decision.
