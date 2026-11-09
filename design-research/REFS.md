# Customs design references

Captured 2026-11-09 with `~/.claude/skills/ui-craft/scripts/refshot.py` at 1440x900 in the deepsurge profile. Measured values come from each `shots/*.tokens.json`. North star: Nearly (same chain, same tokens Customs inspects, same job: judge a launch at a glance). Direct competitors: Nearly, meme.cooking, fomo, dexscreener NEAR, GeckoTerminal NEAR.

## 01 Nearly board (north star, product screen)
Screenshot: shots/01-nearly-board.png. https://nearly.trade
Page background #000000 (html transparent over black), body IBM Plex Mono 14px/400, line-height 22.4px, text rgb(245,245,245). Display headline Space Grotesk 38px/700 with -1.14px tracking. Buttons are pills (radius 9999px, padding 0 14px, fill white at 3% alpha). Hero row: market cap and 24h volume on split-flap digit tiles, live trade tape SIDE / TRADER / USD / AGO in mono, King of the Hill card with the top 3 by market cap, then a 4-cell stat strip (Volume, Paid to creators, Paid to holders, Launches) and four category boards with 40px avatars and right-aligned market caps. Steal: stat strip, tape, category boards. Skip: the split-flap gimmick on every number.

## 02 Nearly token page (north star, product screen)
Screenshot: shots/02-nearly-token.png. https://nearly.trade/t/nearly-993927.nearlytrade.near
Token name Space Grotesk 28px/700 tracking -0.98px. Header strip of six metrics (Market cap, Price with a red -3.6% chip, Liquidity with a NEAR sub-line, 24h volume, Holders, ATH with -93%), labels 12px muted above 20px+ numbers. Chart panel with Mcap/Price toggle and 1m 5m 15m 1h 4h 1d chips, Thesis & calls feed in the middle, Buy/Sell panel right (inputs 0px radius inside a 12px panel, 10/50/100/500 N quick chips), Trades / Holders / Dev tokens / Top traders / Smart money tabs below with mono rows SIDE, $1+, NEARLY, MCAP, TRADER, AGO. Steal: the metric strip, the tab set with a mono trade table, the right rail. Customs replaces Buy/Sell with the Sniper report and adds a VERDICT column to Trades.

## 03 Nearly analytics (north star, product screen)
Screenshot: shots/03-nearly-analytics.png. https://nearly.trade/analytics
Headline Space Grotesk 40px/700 tracking -0.8px, body IBM Plex Mono 14px with 22.4px leading. Totals as large mono numbers over small uppercase labels, period chips, ranked tables for creators and holders paid. Proves the mono-numbers + grotesk-headings pairing holds on a data-only page. Steal: totals header and ranked list density for the "Inspected launches" view.

## 04 fomo Discover (polish bar)
Screenshot: shots/04-fomo-discover.png. https://fomo.family/discover
Background rgb(6,5,16), panels #12111A, body Aeonik 16px/500 with 24px leading, text rgb(247,247,247), muted rgb(152,153,163), up rgb(33,201,94), down rgb(255,98,46). Buttons radius 4px with padding 2px 6px on a rgba(203,208,235,0.1) fill; chips fully rounded. Token rows about 76px tall: star, 40px round avatar, NAME 16px/500 with muted full name and tiny copy/web/X icons, then right-aligned Market cap, 24h change with arrow, 24h volume, Holders with muted total. Filter chips (Trending, Crypto, Most held, Graduated, Bonding, Watchlist) above a segmented 5m/1h/4h/24h control. Steal: row anatomy and chip rows. Skip: left leaderboard rail, positions rail.

## 05 meme.cooking board (NEAR competitor)
Screenshot: shots/05-memecooking-board.png. https://meme.cooking
Background #222222, ui-sans-serif 16px body, primary button radius 9999px padding 4px fill rgb(246,239,0), inputs radius 4px. Four-column card grid: 125px square image left, status tag ("Spoiled") top, NAME + $TICKER in green, two-line description, creator handle, MC and L lines with holder and reply counts. Shows the NEAR memecoin audience expects image-first cards and a loud Create Token CTA. Steal: status tag on the card. Skip: description walls, yellow everywhere.

## 06 meme.cooking token page (NEAR competitor, counter-example)
Screenshot: shots/06-memecooking-token.png. https://meme.cooking/meme/2316
Token title ui-sans-serif 24px/500, inputs radius 8px. Header card with 64px image, Liquidity $0 and Market Cap $0, empty TradingView chart, red "didn't make it" banner, emoji-heavy About block, "No holders yet". Negative lesson: a token page full of zeros and an empty chart reads as broken. Customs must never render a zero we did not read; missing values show `--` and the verdict leads when market data is thin.

## 07 Nearly feed (north star, product screen)
Screenshot: shots/07-nearly-feed.png. https://nearly.trade/feed
Headline Space Grotesk 40px/700, mono 14px/22.4px body. Chronological activity list with account, action and age columns in mono, small avatars and muted timestamps. Steal for the seizure / challenge activity feed under the buyers table: one line per event, mono account, right-aligned age, colored verb (seized, cleared, challenged).

## 08 dexscreener NEAR (data-table bar)
Screenshot: shots/08-dexscreener-near.png. https://dexscreener.com/near
Body Poppins 14px/400 with 21px leading, links rgb(201,201,206), buttons radius 6px padding 0 8px 0 16px on rgb(40,40,45). Stat bar of three cells (24H VOLUME $8.4M, 24H TXNS 58,668, LATEST BLOCK). Table rows about 41px: rank, 24px avatar, TICKER bold then /wNEAR muted then full name, then right-aligned MCAP (accent blue), PRICE, AGE, TXNS, VOLUME, TRADERS, 5M/1H/6H/24H change in green/red, LIQUIDITY. Time chips grouped in one segmented control. Steal: 40 to 44px rows, ticker + quote pair pattern, grouped segmented time control.

## 09 GeckoTerminal NEAR pools (data-table bar)
Screenshot: shots/09-geckoterminal-near.png. https://www.geckoterminal.com/near/pools
Background #000000, body GeistSans 16px/400 with 24px leading, text rgb(229,231,235), page title 20px/600. Dense pools table with pair, price, change columns, liquidity and FDV, sortable headers, small network icons. Note: GeckoTerminal uses Geist, the face Impeccable flags as overused, which is why Customs moves off it. Steal: sortable header affordance and FDV column naming.

## 10 Nearly token page for phire (the inspected token)
Screenshot: shots/10-nearly-token-phire.png. https://nearly.trade/t/phire.nearlytrade.near
Same layout as 02 at 28px/700 title with -0.98px tracking, mono 14px body. This is the exact token the Customs inspector traces (24 opening buyers), so the Customs token page must present the same token with the same metric strip values (read from Nearly's /api/launch) and add what Nearly cannot: per-buyer funding verdicts and the seizure path.

## 11 Rhea swap (NEAR DEX, action panel)
Screenshot: shots/11-rhea-swap.png. https://app.rhea.finance
Background #000000, Jost 16px/400 with 24px leading, inputs and buttons radius 0px in a rounded card. Single swap card with pay/receive inputs, token pickers and one primary action. Steal for the Report a sniper card: one primary action, plain-language consequence line (bond 0.50 NEAR + 0.10 fee, what happens on upheld vs rejected), the exact command to copy.
