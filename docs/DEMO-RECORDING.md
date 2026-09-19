# Demo recording guide (2–4 minutes)

The assignment asks for a short screen recording of the scraper running in
**headed mode** against the mock store, **including how it handles a slow or
failing response**.

This is a suggested run order that fits comfortably in 3 minutes and covers both
halves of that requirement.

---

## Before you record

```bash
# terminal 1 — API
cd backend && npm start

# terminal 2 — UI
cd frontend && npm run dev
```

Make sure at least two products are tracked (Dashboard → Add product), and that
at least one has a successful scrape already, so the price history chart has
something in it.

Record at 1080p or higher, with the terminal font large enough to read.

---

## Part 1 — the dashboard (~25s)

Open <http://localhost:5173>.

Show:
- tracked products with current price and stock,
- the scrape log on a product detail page — point out that **failed attempts are
  listed**, not hidden,
- the price history chart and the stock timeline.

---

## Part 2 — a healthy headed scrape (~70s)

```bash
cd backend
LOG_LEVEL=debug npm run scrape:headed
```

A Chromium window opens. Narrate what is happening:

1. It navigates to the product page — **the price is hidden**, the Reveal button
   is **disabled**.
2. The cookie banner is dismissed by clicking **Decline** (it intercepts clicks
   if left alone).
3. The mouse **sweeps across the price area** — the store requires ≥8 real moves
   and 600ms of dwell before it enables the button. Watch the button enable.
4. Reveal is clicked and the spinner appears while the store runs its
   proof-of-work + WASM + attestation flow.
5. The price resolves. The terminal prints the extracted price, stock and the
   attempt count.

Worth saying out loud: the visible price is split into per-character spans with
zero-width characters between the digits, and there are three decoy prices in
the same container — including a *visible* "Deal price" one.

---

## Part 3 — a slow / failing response (~60s)

This is the part the assignment specifically asks for. Force a realistic timeout
by shrinking the price-resolve budget:

```bash
SCRAPE_RESOLVE_TIMEOUT_MS=250 LOG_LEVEL=debug npm run scrape:headed
```

The scrape now cannot finish inside its budget, so on camera you get:

- **attempt 1** fails with `price_resolve_timeout`,
- an **exponential backoff wait** before retrying (the delay is logged),
- **attempt 2** fails,
- backoff again,
- **attempt 3**, then a final `failed` outcome.

Then switch to the browser and refresh the product page. Point out:

- the **"Latest scrape failed"** banner,
- the price is **still the last known good value** — a failure never overwrites it,
- the **price history chart did not gain a point** — failures are never plotted,
- the **scrape log gained three failure rows**, each with its error code and
  duration.

That single screen is the clearest evidence of the "never store incorrect data
and record failures honestly" requirement.

---

## Part 4 — recovery (~25s)

```bash
npm run scrape:headed
```

Runs normally again, succeeds, and the chart gains a point. Shows the failure was
handled rather than fatal.

---

## Other things you can force

| Goal | Command |
|---|---|
| Fail while arming the interaction gate | `SCRAPE_GATE_TIMEOUT_MS=500 npm run scrape:headed` |
| Fail at navigation | `SCRAPE_NAVIGATION_TIMEOUT_MS=300 npm run scrape:headed` |
| Scrape one specific product | `node scripts/scrape-cli.js --headed --product=<tracked-uuid>` |
| Ignore the 2-hour schedule | add `--all` |
| Slow it down further for the camera | `--slow-mo=600` |

> These environment variables only shrink timeouts — they do not fake data or
> stub the store. Every failure shown is a genuine one produced against the live
> site, which is what makes the recording honest.

---

## Checklist

- [ ] Headed browser clearly visible
- [ ] Mouse-move gate and the Reveal button enabling are on screen
- [ ] A successful scrape with the extracted price in the terminal
- [ ] At least one **failed** attempt with a retry and backoff
- [ ] The UI showing the failure, the preserved last-good price, and the log
- [ ] 2–4 minutes total
