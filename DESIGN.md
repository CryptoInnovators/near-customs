# Customs web: design contract

Binding for `web/`. The page is an inspection document, not a dashboard and not a landing page.
It answers one question first: did the creator's money pay for the opening buyers?

## Constraints from the brief

One column, max 760px. Black text on off-white. System font stack. One accent. No framework, no
build, no npm. Numbers in monospace with the block they were read at. Every account and hash links
to nearblocks.io. No em dash characters.

## Tokens

```
--paper      #f6f3ec   warm off-white ground
--paper-2    #ede8db   inset band for the verdict only
--ink        #14120e   text and rules
--ink-2      #625c50   secondary text, 5.8:1 on paper
--ink-3      #8b8475   micro-labels, 3.9:1, labels only, never body
--line       #d7d0bf   hairlines
--line-2     #b9b1a0   heavier rule
--accent     #a32a12   seal red, funded and detained only
--accent-2   #f1ddd5   accent tint behind creator tag
```

One accent, semantic only: funded paths, the creator tag, the seal. Never decoration. No green,
no yellow, no gradients, no glass, no shadows.

## Type

System stack only, as the brief requires. This is a deliberate exception to the design log's
display-font variation rule.

```
--sans  -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
--mono  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace
```

Scale: 11 / 12 / 13 / 14 / 16 / 18 / 22 / 28 / 44 / 72. Display 44px at 1.04, -0.035em. Hero
figure 72px, tabular. Micro-labels 10 to 11px uppercase, +0.09em. Facts use `--mono` with
`font-variant-numeric: tabular-nums`. Two families plus mono, nothing else.

## Space, shape, motion

4px base: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 / 96. Radius 2px on tags and inputs only. No cards.
Separation is a 1px line or one tone step. Motion is limited to 120ms colour changes; all of it is
disabled under `prefers-reduced-motion`.

## Structure

1. Masthead: wordmark CUSTOMS, network line, the question, one-paragraph standfirst, declaration form.
2. Rule line: the published rule in one sentence.
3. Verdict: one band, big share figure, one sentence, the seal, one segmented bar.
4. The opening buyers: ruled ledger rows, each stamped. Facts in a grid, evidence behind a disclosure.
5. How the check ran: definition list of measured values and what the page does not know.
6. Sources.

No hero header. No KPI tiles. No icons. No filled primary button other than the single Inspect
control, which is ink on paper.

## Components

- Declaration field: uppercase mono label, 16px mono input, 1px underline, accent on focus.
- Inspect button: ink fill, paper text, 2px radius, 44px minimum height.
- Verdict: inset paper band between a 2px ink rule and a hairline. Big figure left, seal right.
- Seal: 1.5px accent border, rotated -5deg, mono text, the count inside. The only object on the page
  that is not a line, a row, or a figure.
- Ledger row: index, account link, status tag, then Received, Still holds, Paid, Sold in 24h,
  First buy. Status tags: `creator` filled accent, `funded` accent outline, `no link` ink outline,
  `not priced` and `not checked` dashed muted.
- Path: ordered list, each hop `from > to` with amount, time, transaction link. The final line is
  the buy itself, which is not part of the path.
- Error: 1px accent left rule, exact message, what to do next. No illustration.

## States

Every read has loading, empty, partial and error copy. Loading says what is being read. Partial
says which budget was reached. Error quotes the endpoint's own text. Empty states keep the frame.

## Phone

At 375px: single column, 20px gutters, title 32px, hero figure 56px, seal below the figure, facts grid
two columns, no horizontal scroll. Rows stack; the path wraps to two lines per hop.

## Distinct from the last log entries

Macrostructure: a customs manifest with a declaration, a verdict, and stamped ledger rows, not a
ruled index, workbench, case file, or sticky ticket. Palette: warm paper and seal red, not cool
paper, charcoal, near-black, or midnight. Display font is fixed by the brief; variation is carried
by structure and colour. Log entry appended with this date.
