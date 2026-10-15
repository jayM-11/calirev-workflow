# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

CaliRev Workflow is a static, single-file HTML prototype of a California auto-shop work-order flow. It walks a job through Quote → CARB Review → Approval → Install Record → Owner's Doc. There is no build step, linter or git repo. The one test is a Playwright end-to-end script, `tests/e2e.mjs`. All CSS and JS are inline in each HTML file, and nothing is loaded from outside.

- `dist/index.html`: the main app
- `dist/shop.html`: currently a byte-for-byte copy of `index.html`, used as an alternate entry page. An edit to one needs the same edit in the other. Run `cmp dist/index.html dist/shop.html` afterward to confirm they still match.
- `backups/index.before-redesign.html`: the original `index.html` from before the card redesign, kept for reference. It isn't served.
- `hosted/calirev-workflow.html`: the copy published as a claude.ai Artifact (https://claude.ai/artifact/QTfpNNsQQeUoEhqoFZLXq3). It is generated from `dist/index.html`: page content only, title "CaliRev Workflow", and `window.CALIREV_HOSTED=true` first. In that mode (`HOSTED`), Print and Download are hidden, and Send/Email copy the text instead of opening `mailto:`/`sms:`, because the artifact sandbox blocks print, downloads, mail links and `confirm()`. Regenerate it after changing `dist/index.html` (the Python snippet in the session strips `<head>`/`<body>`), run `APP=../hosted/calirev-workflow.html node e2e.mjs` from `tests/`, then republish to the same URL.
- `dist/theme-lab.html`: a standalone gallery of 11 visual themes applied to a mock of the app. It shares no code with the main app.

To preview, open `dist/index.html` in a browser (`open dist/index.html`).

To test: `cd tests && npm install playwright && node e2e.mjs`. It drives your installed Chrome (`channel: 'chrome'`). It types a manual job and then clicks through every demo step, saves screenshots to `tests/shots/`, and prints PASS/FAIL. Run it after any change. When a check fails, it has usually found a real bug.

## Main app architecture (`dist/index.html`)

**State and persistence.** One global `state` object holds a single job. With `PERSIST=false` (the current setting), every page load starts blank and nothing is written to the browser, and any old stored job is cleared on load. Set `PERSIST=true` to save to `localStorage` under the key `build-record-blank-v3` (`KEY`). `load()` migrates older saved shapes: it defaults `kind` to `'part'`, fills in missing `approval`/`install` objects, and replaces a `'DRAFT'` job number. If you change the stored data shape, update `load()` or bump `KEY`. `blankJob()` defines the canonical shape.

**Render loop.** Every input handler changes `state` and then calls `persist()`. `persist()` saves to storage and calls `render()`, which rebuilds every screen's derived UI from `state` (`renderRows`, `renderReview`, `renderPacket`, plus the gate and badge text). Rows are rebuilt as HTML strings and their listeners are re-attached on each render. Wrap any user value you put into HTML in `esc()`, and pass URLs through `safeUrl()`.

**Screens.** The five screens are `<section class="screen" id=...>` elements with ids `job`, `review`, `approval`, `install` and `packet`. `showScreen(id)` switches between them. Nav buttons use `data-screen`, and in-page links use `data-open`.

**Gating logic.** This is the core domain rule set:
- A line item is either a `part` or `labor`. CARB status is **not reviewed by hand**. A catalog part's status is read live from `CATALOG` through `partTag()`/`partEo()`, so a database update changes every quote. A custom part (no `catalogId`) has an advisor-entered `p.tag`, which starts as `''` ("Not checked") until an automated check exists.
- `partIssue(p)` returns why a part blocks approval: it doesn't fit the vehicle, it's not checked, it's `offroad`, or it's `pending`. `isClear(p)` is `!partIssue(p)`. Tags `eo`/`exempt` are clear.
- `ready()` requires `intakeReady()`, no blockers, at least one line, and a positive price and qty on every line (`quoteMissing`). Sending and approval need `ready()`. Install closeout (`installProblem()`) needs approval, the advance paid, a technician and a completion date. Each approved part is ticked off in `state.install.done` (keyed by part id), and any part not installed must be explained in the deviation notes. `installText()` builds the parts summary for the Owner's Doc. The Owner's Doc (`renderPacket()`) is the build record and bill. It's a draft until the closeout is saved. After that, approved parts that weren't installed are left off the bill, and the advance is subtracted to give the balance due (or a credit). "Email to customer" uses a `mailto:` link with the doc's text. Tax isn't modeled.
- `changeQuote()` handles versioning. Editing a quote-relevant field after approval, or after the quote was sent (`state.send.sentAt`), clears approval/sent status and increments `quoteVersion`. Any new edit path that changes the quote should call it.
- Part lines flagged `advance` must be paid before install: `advanceDue()` / `advancePaid()` gate `saveInstall`, and approval requires `state.approval.advanceAck` when an advance is due.

**Quote intake (page 1).** Page 1 holds only customer, vehicle (structured `year`/`make`/`model`; `state.vehicle` is derived by `composeVehicle()`) and the request. It has no line items or pricing. **Save quote** validates `REQUIRED`, then stores `state.intake = {savedAt, key, dirty}`, where `key = vehicleKey()` (year/make/model/engine/use). `intakeReady()` gates the Parts page, sending and approval. Editing the vehicle or use after saving (`vehicleChanged()`) locks those steps until the quote is saved again. After a re-save, catalog parts that no longer fit show up as blockers. Other edits only set `dirty`.

**Labor** lines are edited on the Parts page (`renderLabor()`, `data-labor` inputs via a delegated `change` listener). Pricing and totals appear only on the Approval estimate.

**Parts catalog.** `CATALOG` is a hardcoded sample parts DB (placeholder brands, part numbers and EO numbers) standing in for a future maintained database. `fits()` matches entries against the structured `make`/`model`/`year` (`make:'*'` = universal). Adding a catalog part creates a quote line with a `catalogId`. Its CARB status is not copied, so it always reflects the catalog. The filter state lives in `ui` and is not persisted.

**Approval / send.** The Approval tab is an estimate sheet with a side rail: 1) Send for approval (`mailto:`/`sms:` link or clipboard, recorded in `state.send`), 2) customer approval, 3) advance payment (`state.payment`). "Print estimate" sets `body[data-print=estimate]` so the print CSS shows the estimate instead of the Owner's Doc.

**Click handling.** Card, filter and pill buttons use one delegated `document` click listener keyed on `data-pick`, `data-add`, `data-add-custom`, `data-cat`, `data-source`, `data-method`, `data-send-method` and `data-pay-method`. Quote-table rows still bind `data-edit`/`data-remove` on each render. `setVal()` skips the focused input so re-rendering doesn't fight typing. Labor rows are updated in place by `renderLabor()` and only rebuilt when lines are added or removed. Rebuilding them on every change used to destroy the field the user had just tabbed into.

**Compliance wording.** The UI deliberately frames everything as a shop-created record, never as a CARB/BAR certification or a compliance decision. Examples are the alert text, the approval gate copy, and the `LIMITS` text added to the downloaded Owner's Doc. Keep that framing when you change copy.

**Styling.** The `<style>` block contains several `:root` token blocks one after another. Later blocks override earlier ones. The "Shop floor readability refresh" section and the final Carbon Signal Light palette are the ones that take effect. Responsive breakpoints are at 900px and 580px, and an `@media print` block styles the printed Owner's Doc.

**Legality checks and demo.** `checkReport(p)` builds the per-part check (vehicle, fitment, CARB record, use, result). It is shown in the Parts drawer (`#rvCheck`), the `#legalStrip` summary and the estimate's `#estLegal` line, all through `renderLegal()` (wrapped around `renderReview`). For custom parts, `runLegalityCheck()` simulates an agent: it returns `SAMPLE_AGENT` data (only `CC-300` is known) after a delay and stores `p.check`. The "▶ Run demo" button runs `DEMO`, a 10-step guided walkthrough. Each step has a `screen`, a `dock` side for the panel, an optional `delay`, and a `run()` that uses `focusEl()` to scroll to and highlight what it changed. The current job is held in memory (`demo.backup`) and restored on exit. The tax line on the Owner's Doc uses `TAX_RATE` (San Diego 7.75%, a sample rate), applied to parts only. Part ids come from `uid()`. Never use `confirm()`, `alert()` or `prompt()`; the hosted sandbox auto-cancels them. Don't go back to `Date.now()` ids, because several parts added in the same millisecond would collide.
