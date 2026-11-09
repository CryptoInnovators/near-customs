# Parity against direct competitors (Nearly, meme.cooking, fomo, dexscreener NEAR)

| Element (seen in) | Customs | Note |
|---|---|---|
| Top bar: logo, search with `/` shortcut, nav (all) | have | keep, restyle |
| Network badge (dexscreener, Nearly) | have | NEAR MAINNET pill |
| Stat strip of totals (Nearly 01, dexscreener 08) | have | Nearly analytics totals + Customs "inspected" count |
| Filter chips Trending/New/Most held (fomo 04, dexscreener 08) | have | plus Customs-only Sniper check |
| Segmented time control 5m/1h/4h/24h (fomo, dexscreener) | skip | Nearly launches API exposes 24h only; a control with one live option is decoration |
| Token row: 32-40px avatar, NAME, $TICKER, age (all) | have | one avatar, monogram only on missing icon |
| Market cap, 24h change, holders right-aligned tabular (fomo, dexscreener) | have | from Nearly /api/launches |
| 24h volume column (fomo, dexscreener) | build | `volume_24h_near` x `near_usd` from the same row |
| Status tag on a token (meme.cooking "Spoiled", pump "HOT") | have | the sniper stamp CLEAN / N FUNDED, Customs' differentiator |
| Category boards (Nearly 01) | skip | one board with chips covers it at hackathon scope |
| King of the Hill / top-3 cards (Nearly 01) | skip | competes with the verdict for attention; the board leads with verdicts |
| Token header metric strip: MC, price + change chip, liquidity, 24h vol, holders, ATH (Nearly 02/10) | build | from /api/launch/<token>; ATH optional |
| Price / mcap chart with timeframe chips (Nearly 02, meme.cooking 06) | build | from /api/candles; draw in SVG; 1h/4h/1d chips only for the tf values the API accepts |
| Trades tab with mono SIDE/AMOUNT/MCAP/TRADER/AGO rows (Nearly 02) | build | opening buys tape plus a VERDICT column, Customs' differentiator |
| Holders tab (Nearly 02) | build | /api/holders/<token> |
| Buy/Sell panel (Nearly 02, Rhea 11) | skip | Customs does not trade; the right rail is the Report a sniper card with one primary action |
| Thesis & calls, live chat (Nearly 02) | skip | social layer, not the inspector's job |
| Activity feed (Nearly 07) | build | seizures and challenges, one line per event |
| Contract trust signals: contract link, explorer, keys (web3 rules) | have | Contract checks 4/4 row, expandable |
| Mobile 390px layout (all) | build | stacked rows; tape before side cards |
