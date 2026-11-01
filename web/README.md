# Customs demo page

A static page, no build step and no packages. It reads mainnet live from FastNEAR at page load and stores nothing.

Open it:

```
cd /Volumes/AgentData/near/web/customs
python3 -m http.server 8080 --directory web
```

then open http://localhost:8080. Add `?token=<token account>&creator=<account>` to the address to pick a token and, optionally, a creator.

Panels and the endpoint each reads:

1. Chain connection: `block` (finality final) on `https://rpc.mainnet.fastnear.com` gives the block height and time that every balance is read at.
2. Token and creator: `ft_metadata` via `query call_function` on `https://rpc.mainnet.fastnear.com`, plus `POST /v0/account` and `POST /v0/transactions` on `https://tx.main.fastnear.com` for the token's first transaction, whose signer is the creator unless you enter one.
3. Early holders: `POST /v0/transactions` on `https://tx.main.fastnear.com` for the token's first 100 transactions (NEP-141 `ft_transfer` and `ft_mint` events, first receipt per account), then `ft_balance_of` via `query call_function` on `https://rpc.mainnet.fastnear.com` at the panel 1 block.
4. Funded by the creator within 3 hops: `POST /v0/account` (with `to_tx_block_height`) and `POST /v0/transactions` on `https://tx.main.fastnear.com`, searching backward through plain NEAR transfers from each holder's first receipt.

Every account id and transaction hash links to nearblocks.io. When a call fails, the panel shows the exact error text and the next step. Limits are printed on the page: direct NEAR transfers only, accounts over 3000 transactions are not expanded, a 300000 block search window, and a request budget.
