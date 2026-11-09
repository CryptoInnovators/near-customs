# Customs web design contract

The board and inspection routes share a dense, dark token-market interface. The board puts live launch rows first; the inspection view puts market context, opening-buyer tape, and the launch timeline in view together. At narrow widths the board rows stack and the inspection tape moves above side information.

`web/tokens.css` owns the sole UI token block. Colors, fonts, radii, and numeric figures use those CSS custom properties. Surfaces stay flat with fine borders, compact labels, and one teal action color. Only verdict stamps rotate.

The live source for launch data is Nearly's public API. Funding verdicts come from `web/app.js` and FastNEAR. A missing API value displays `--`; offline fixture examples remain labeled as fixtures.
