# Where BIR advisories come from (Phase 0 discovery)

Checked 2 November 2026 from a headless Chromium, as spec §8 asks.

**Decided 2 November 2026 (Emel): option A.** The watcher reads the rendered home page with a
headless browser, as described under "How the watcher will run". The admin's manual form is
the backstop when it misses something. A request to the BIR for a proper feed may follow; if
it is granted, only the list-reading step changes.

## Short version

- **There is no list endpoint we can use.** The BIR site loads its content from a CMS API, but
  that API answers `403 forbidden` to anyone except the BIR page itself. Getting past it would
  mean copying whatever the page sends to prove it is the page, and we should not do that.
- **The advisory list is the "announcements" block on the home page** (`https://www.bir.gov.ph/home`),
  drawn in the browser by JavaScript. A plain fetch gets the page shell without it.
- **So the watcher takes the spec's fallback:** a headless browser in the GitHub Action opens the
  home page, reads the rendered block, and posts the items to `/api/advisories/sync`.
- **The PDFs themselves are easy.** `bir-cdn.bir.gov.ph` serves them to our honest bot
  user-agent with a `200`, and both PDFs tried have a real text layer.

## What was tried

| Request | Result |
|---|---|
| `GET https://www.bir.gov.ph/home` (plain fetch) | `200`, 136 KB of page shell. The advisory titles and PDF links are **not** in it. |
| `GET https://bir-cms-ws.bir.gov.ph/api/pub/templates/{1135,3405,68}/datasets?per_page=3000` | These are the calls the home page makes for its content. From our server: `403 {"error":"forbidden","message":"You don't have permission to access this resource."}`. The same URL fetched from inside the open BIR page also gets `403`, so the page's own call carries a credential. Not used. |
| `GET https://bir-cdn.bir.gov.ph/BIR/pdf/...pdf` with `User-Agent: KaTaxpayerStatusBot/1.0` | `200 application/pdf`. |
| `robots.txt` on `www.bir.gov.ph` and `bir-cdn.bir.gov.ph` | Neither publishes one (the first returns the app shell, the second `403 AccessDenied`). Nothing forbids reading the home page; we still keep it to one page view per run. |

## What the rendered list looks like

The block is `div.text-description.richtext.prose` on the home page. It is hand-typed rich text
(the markup even carries `data-olk-copy-source="MessageBody"`, i.e. pasted from Outlook), so it
has **no dates, no IDs and no structure** beyond "a sentence, then a link called *more*":

```html
<span>Advisory on Availability/Accessibility of the Electronic Filing and Payment System (eFPS).&nbsp;
  <a href="https://bir-cdn.bir.gov.ph/BIR/pdf/(0031-SA) Advisory Availability of EFPS.PDF"
     title="more" target="_blank">more</a>&nbsp;</span>
```

Sample of the rendered list on 2 Nov 2026, first nine items (the block also carries auction
notices, which the title filter drops):

```json
[
  { "title": "Advisory on Unavailability/Inaccessibility of COR QR Code Verifier.",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/0034-SU_COR%20QR%20CODE%20VERIFIER.pdf" },
  { "title": "Advisory on Availability/Accessibility of the BIR Website and Content Management Systems.",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/0033-SA_BIR%20Website%20and%20Content%20Management%20System.pdf" },
  { "title": "Advisory on Availability/Accessibility of the Electronic Filing and Payment System (eFPS).",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/(0031-SA)%20Advisory%20Availability%20of%20EFPS.PDF" },
  { "title": "Advisory on Unavailability/Inaccessibility of the eCAR and eONETT Systems.",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/0032-SU_eCAR%20and%20eONETT.pdf" },
  { "title": "Tax Advisory: The BIR invites interested entities and electronic invoicing solution providers to apply for accredition as Electronic Invoicing Service Providers (ESPs)...",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/CIR%20Tax%20Advisory.pdf" },
  { "title": "Public Advisory: Please be advised that, as of September 14, 2026, the BIR has not accredited ... any entity as an official BIR e-Invoicing Service Provider...",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/EIS%20Public%20Advisory%20Sep%202026%20-%20redacted.pdf" },
  { "title": "Public Advisory: The Registered Business Enterprises Taxpayer Service (RBETS) will be temporarily relocated...",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/Advisory%20on%20RBETS%20Relocation.pdf" },
  { "title": "Advisory on Availability/Accessibility of the Electronic Invoicing and Sales Reporting System – Taxpayer Portal, Certification Portal and API Transmission Service.",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/(0029-SA)%20Advisory%20Availability%20of%20Electronic%20Invoicing%20and%20Sales%20Report....pdf" },
  { "title": "Advisory on Availability/Accessibility of BIR Systems and BIR Network, except Accounts Receivable Management System.",
    "source_url": "https://bir-cdn.bir.gov.ph/BIR/pdf/(0028-SA)%20Advisory%20Availability%20of%20BIR%20Systems%20and%20BIR%20Network.pdf" }
]
```

## What two real PDFs say

Saved as text in `tests/fixtures/`.

**202610-0034-SU (an outage, with start and end):**

```
REFERENCE NO: 202610-0034-SU
DATE                 October 29, 2026
TO                   All Internal and External users
SYSTEM/S AFFECTED    COR QR Code Verifier
REASON               The above system will be unavailable/inaccessible due to a scheduled system maintenance activity.
PERIOD COVERED
Start Date / Time    October 29, 2026 (Thursday) 5:00 pm
End Date / Time      November 2, 2026 (Monday) 5:00 pm
```

**202610-0031-SA (a restoration, citing the outage it closes):**

```
REFERENCE NO: 202610-0031-SA
DATE                 October 28, 2026
TO                   All Users
SYSTEM/S AFFECTED    Electronic Filing and Payment System (eFPS)
REASON               eFPS is now available and accessible following the intermittent connectivity issues relative to Advisory No. 202610-0031-SU.
DATE APPLICATION SYSTEMS ARE UP / AVAILABLE    October 27, 2026 (Tuesday) 10:00 PM
```

## Things the parser has to handle (and two decisions for Emel)

1. **The PDFs are a form with labelled fields**, so the parser should read `SYSTEM/S AFFECTED`,
   `TO`, `Start Date / Time`, `End Date / Time` and `DATE APPLICATION SYSTEMS ARE UP / AVAILABLE`
   by label rather than search the whole text. The spec's phrase rules stay as the fallback.
2. **A restoration cites the outage by the same number with a different suffix**: `0031-SA`
   closes `0031-SU`. Linking by the cited reference number works as the spec says.
3. **The list only holds the latest nine or so system advisories.** The `0031-SU` outage that
   `0031-SA` closes had already dropped off by 2 November. A watcher running every 30 minutes will
   normally catch an outage while it is listed, but when it does not, a restoration will arrive
   citing an outage we never stored. Proposal: store the restoration anyway, mark it low
   confidence, and let the admin add the missing outage by hand from the cited number.
4. **Decision: "All Users".** Spec §8 says only "External users" counts as external, so the
   eFPS restoration above, addressed to "All Users", would be `unknown` and could never close an
   outage. Proposal: "All Users" and "All Internal and External users" both mean external.
5. **Decision: date format.** Times come as `October 29, 2026 (Thursday) 5:00 pm`, in both
   `pm` and `PM`. Read as Asia/Manila and stored as UTC, as the spec says. No issue, just noting.

## How the watcher will run

`.github/workflows/advisory-watch.yml`, every 30 minutes:

1. Install Playwright's Chromium (cached between runs).
2. Open `https://www.bir.gov.ph/home` once, with `BIR_USER_AGENT`, wait for the block, and read
   each "sentence + PDF link" pair.
3. `POST` the pairs to `https://status.kataxpayer.com/api/advisories/sync` with the
   `CRON_SECRET` bearer token.
4. The route filters, skips URLs already stored, downloads new PDFs from `bir-cdn` itself, parses
   them and saves them as `pending` (spec §8, steps 2 to 6).

The route also accepts a call with no list, for a hand-triggered run of the parse step only. If
the BIR ever opens the CMS API or publishes an RSS feed, only step 2 changes.

**Fragility, said plainly:** the list is hand-typed rich text. If the BIR redesigns the home page
or moves the block, the watcher finds nothing. Every run will report how many items it saw, and
a run that sees zero will fail the GitHub Action, so a silent break shows up as a red run rather
than an empty board.
