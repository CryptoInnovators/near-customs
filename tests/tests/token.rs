//! Sandbox tests for the Customs token. Each guard has a test that goes red when the guard is removed;
//! scripts/mutate.sh breaks each guard in turn and records the red and green runs in docs/TESTS.md.
use customs_tests::*;
use near_workspaces::types::NearToken;
use serde_json::{json, Value};

const BUY: u128 = 1_000_000 * UNIT;

async fn opened() -> anyhow::Result<World> {
    let w = World::new().await?;
    // the insider buys in the opening window; this also starts the window
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    Ok(w)
}

fn junk_path() -> Vec<String> {
    vec![fake_tx(1), fake_tx(2), fake_tx(3)]
}

#[tokio::test]
async fn opening_buy_is_recorded_as_a_bag() -> anyhow::Result<()> {
    let w = opened().await?;
    let bag = w.bag(&w.insider).await?;
    assert_eq!(bag["bought"], BUY.to_string());
    assert_eq!(bag["state"], "vesting");
    let locked: u128 = bag["locked"].as_str().unwrap().parse()?;
    assert!(locked > BUY * 99 / 100 && locked <= BUY, "just bought, almost everything locked: {locked}");
    let win: Value = w.token.view("window").await?.json()?;
    assert!(win["start_s"].is_u64() && win["vest_ends_s"].as_u64() > win["opening_ends_s"].as_u64());
    Ok(())
}

#[tokio::test]
async fn opening_buyer_cannot_sell_or_move_unvested() -> anyhow::Result<()> {
    let w = opened().await?;
    // to the market (a sale), to a fresh wallet, and one token over nothing: all refused
    let r = w.transfer(&w.insider, &w.market, BUY).await?;
    assert!(r.is_failure() && failure_text(&r).contains("locked until"), "{}", failure_text(&r));
    let r = w.transfer(&w.insider, &w.outsider, BUY / 2).await?;
    assert!(r.is_failure() && failure_text(&r).contains("locked until"), "{}", failure_text(&r));
    let r = w
        .insider
        .call(w.token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.market.id(), "amount": (BUY / 10).to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(r.is_failure() && failure_text(&r).contains("locked until"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.insider).await?, BUY, "nothing moved");
    Ok(())
}

#[tokio::test]
async fn hold_is_balance_level_so_later_buys_stay_free() -> anyhow::Result<()> {
    let w = World::with(Knobs { window_s: 40, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    // after the window the same wallet buys more; only the opening bag is held
    w.advance_s(60).await?;
    let win: Value = w.token.view("window").await?.json()?;
    let now_s = w.worker.view_block().await?.timestamp() / 1_000_000_000;
    assert!(now_s >= win["opening_ends_s"].as_u64().unwrap(), "window closed: now {now_s} win {win}");
    w.market_pays(&w.insider, BUY / 2).await?.into_result()?;
    let bag = w.bag(&w.insider).await?;
    assert_eq!(bag["bought"], BUY.to_string(), "the late buy is not an opening buy");
    // the late half is free the moment it lands: the hold is on the balance, not on each token
    w.transfer(&w.insider, &w.outsider, BUY / 2).await?.into_result()?;
    let locked: u128 = w.bag(&w.insider).await?["locked"].as_str().unwrap().parse()?;
    let free = w.balance(&w.insider).await? - locked;
    assert!(free > 0 && free < BUY / 100, "only the vested sliver is free: {free}");
    let r = w.transfer(&w.insider, &w.outsider, free + 2 * UNIT).await?;
    assert!(r.is_failure(), "one token past the free part is refused");
    Ok(())
}

#[tokio::test]
async fn buyer_after_the_window_is_never_held() -> anyhow::Result<()> {
    let w = World::with(Knobs { window_s: 40, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    w.advance_s(60).await?;
    w.market_pays(&w.outsider, BUY).await?.into_result()?;
    assert!(w.bag(&w.outsider).await?.is_null(), "no bag for a buyer after the window");
    w.transfer(&w.outsider, &w.market, BUY).await?.into_result()?;
    assert_eq!(w.balance(&w.outsider).await?, 0);
    Ok(())
}

#[tokio::test]
async fn bag_vests_linearly_and_is_free_at_the_end() -> anyhow::Result<()> {
    let w = World::with(Knobs { window_s: 20, vest_s: 120, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    let l0: u128 = w.bag(&w.insider).await?["locked"].as_str().unwrap().parse()?;
    w.advance_s(60).await?;
    let l1: u128 = w.bag(&w.insider).await?["locked"].as_str().unwrap().parse()?;
    assert!(l1 < l0, "locked amount shrinks: {l0} -> {l1}");
    // what has vested can move now, and not a token more
    let free = BUY - l1;
    assert!(free > 0);
    w.transfer(&w.insider, &w.outsider, free).await?.into_result()?;
    // a tenth of the bag is ten times more than the seconds that passed since `l1` can have vested
    let r = w.transfer(&w.insider, &w.outsider, BUY / 10).await?;
    assert!(r.is_failure(), "only the vested part moved");
    w.advance_s(130).await?;
    assert_eq!(w.bag(&w.insider).await?["state"], "vested");
    let rest = w.balance(&w.insider).await?;
    w.transfer(&w.insider, &w.market, rest).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn market_cannot_pay_opening_buyers_through_a_call() -> anyhow::Result<()> {
    let w = World::new().await?;
    let r = w
        .market
        .call(w.token.id(), "ft_transfer_call")
        .args_json(json!({"receiver_id": w.insider.id(), "amount": BUY.to_string(), "msg": ""}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(r.is_failure() && failure_text(&r).contains("ft_transfer"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn upheld_challenge_pays_exactly_twenty_percent_of_the_unvested_bag() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    let before = w.balance(&w.hunter).await?;
    let native_before = w.native(&w.hunter).await?;
    let r = w.challenge(&w.hunter, &w.insider, path).await?;
    r.clone().into_result()?;
    let ev = event_data(&r, "wallet_seized").expect("wallet_seized event");
    let seized: u128 = ev["seized"].as_str().unwrap().parse()?;
    let frozen: u128 = ev["frozen"].as_str().unwrap().parse()?;
    // exactly 20% of what was unvested at the verdict block, the rest frozen
    assert_eq!(seized, (seized + frozen) / 5, "seized {seized} frozen {frozen}");
    assert!(seized + frozen <= BUY && seized + frozen > BUY * 99 / 100);
    assert_eq!(w.balance(&w.hunter).await? - before, seized, "challenger received the seizure");
    assert_eq!(w.balance(&w.insider).await?, BUY - seized);
    // bond came back: only gas and what OutLayer charged for the run are gone
    let native_after = w.native(&w.hunter).await?;
    let spent = native_before.saturating_sub(native_after);
    let fee = w.knobs.exec_fee.as_yoctonear();
    assert!(spent < fee + near(0.5).as_yoctonear(), "spent {spent}");
    assert!(spent < w.knobs.min_bond.as_yoctonear(), "the bond came back: spent {spent}");
    // the remainder of the unvested bag stays locked for lock_s
    let bag = w.bag(&w.insider).await?;
    assert_eq!(bag["state"], "seized_frozen");
    assert_eq!(bag["locked"], frozen.to_string());
    let all = w.balance(&w.insider).await?;
    let r = w.transfer(&w.insider, &w.outsider, all).await?;
    assert!(r.is_failure(), "frozen remainder cannot move");
    w.transfer(&w.insider, &w.outsider, all - frozen).await?.into_result()?;
    assert_eq!(w.challenge_state(0).await?["Upheld"]["seized"], seized.to_string());
    assert!(w.token.view("open_challenge_of").args_json(json!({"wallet": w.insider.id()})).await?.json::<Value>()?.is_null());
    Ok(())
}

#[tokio::test]
async fn request_to_outlayer_names_the_module_the_wallet_and_the_receipts() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    let tx = w.challenge_held(&w.hunter, &w.insider, path.clone()).await?;
    let req = w.held_request().await?;
    // what OutLayer's own contract stored from the call: the worker is handed exactly this
    assert_eq!(req["sender_id"], w.token.id().to_string(), "OutLayer sees the token as the caller");
    assert_eq!(req["payer_account_id"], w.hunter.id().to_string());
    assert_eq!(req["resolved_source"]["WasmUrl"]["hash"], w.checker_sha);
    assert_eq!(req["resolved_source"]["WasmUrl"]["build_target"], "wasm32-wasip2");
    assert_eq!(req["response_format"], "Json");
    let paid = req["payment"].as_f64().unwrap();
    let fee = w.knobs.exec_fee.as_yoctonear() as f64;
    assert!((paid - fee).abs() / fee < 1e-9, "exactly exec_fee is forwarded: {paid} vs {fee}");
    let input: Value = serde_json::from_str(req["input_data"].as_str().unwrap())?;
    assert_eq!(input["op"], "verify_funding_path");
    assert_eq!(input["wallet"], w.insider.id().to_string());
    assert_eq!(input["creator"], w.creator.id().to_string());
    assert_eq!(input["market"], w.market.id().to_string());
    assert_eq!(input["token"], w.token.id().to_string());
    assert_eq!(input["path"], json!(path));
    assert_eq!(input["max_hops"], 4);
    let win: Value = w.token.view("window").await?.json()?;
    assert_eq!(input["window_end_ns"].as_u64().unwrap(), win["opening_ends_s"].as_u64().unwrap() * 1_000_000_000);
    w.answer_held(tx, &Mode::Honest).await?.into_result()?;
    Ok(())
}

#[tokio::test]
async fn rejected_challenge_forfeits_the_bond_and_moves_nothing() -> anyhow::Result<()> {
    let w = opened().await?;
    // the creator sent the wallet 1 NEAR, a tenth of a 10 NEAR buy: dust, not funding
    let dust = w.plant_path(&w.insider, &[], NEAR_Y, true, 1).await?;
    let r = w.challenge(&w.hunter, &w.insider, dust).await?;
    r.clone().into_result()?;
    assert!(event_data(&r, "challenge_rejected").is_some(), "{:?}", r.logs());
    assert_eq!(w.balance(&w.hunter).await?, 0);
    assert_eq!(w.balance(&w.insider).await?, BUY);
    let forfeited: String = w.token.view("forfeited").await?.json()?;
    assert_eq!(forfeited, w.knobs.min_bond.as_yoctonear().to_string());
    assert_eq!(w.challenge_state(0).await?, "Rejected");
    // the hold is untouched and a new challenge with real funding can be filed and upheld
    assert_eq!(w.bag(&w.insider).await?["state"], "vesting");
    let good = w.plant_path(&w.insider, &[], 10 * NEAR_Y, true, 40).await?;
    let r = w.challenge(&w.hunter, &w.insider, good).await?;
    assert!(event_data(&r, "wallet_seized").is_some(), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn funding_planted_after_the_buy_is_rejected() -> anyhow::Result<()> {
    let w = opened().await?;
    let late = w.plant_path(&w.insider, &[], 10 * NEAR_Y, false, 1).await?;
    let r = w.challenge(&w.hunter, &w.insider, late).await?;
    assert!(event_data(&r, "challenge_rejected").is_some(), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0);
    assert_eq!(w.balance(&w.insider).await?, BUY);
    Ok(())
}

#[tokio::test]
async fn a_two_hop_creator_path_through_a_relay_is_upheld() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.plant_path(&w.insider, &[&w.outsider], 10 * NEAR_Y, true, 1).await?;
    assert_eq!(path.len(), 3);
    let r = w.challenge(&w.hunter, &w.insider, path).await?;
    assert!(event_data(&r, "wallet_seized").is_some(), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn verdict_signed_by_another_key_changes_nothing() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    let r = w.challenge_with(&w.hunter, &w.insider, path, &Mode::OtherKey).await?;
    assert!(failure_text(&r).contains("does not verify against the pinned key"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0);
    assert_eq!(w.balance(&w.insider).await?, BUY);
    assert_eq!(w.challenge_state(0).await?, "Pending");
    Ok(())
}

#[tokio::test]
async fn stale_verdict_is_refused() -> anyhow::Result<()> {
    // the callback lands a few blocks after the request; a one block validity cannot hold that
    let w = World::with(Knobs { max_age_blocks: 1, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    let path = w.honest_path(&w.insider).await?;
    let r = w.challenge(&w.hunter, &w.insider, path).await?;
    assert!(failure_text(&r).contains("stale"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0, "nothing paid on a stale verdict");
    Ok(())
}

#[tokio::test]
async fn verdict_for_another_block_is_refused() -> anyhow::Result<()> {
    for delta in [-1_000, -1, 1] {
        let w = opened().await?;
        let path = w.honest_path(&w.insider).await?;
        let r = w.challenge_with(&w.hunter, &w.insider, path, &Mode::BlockDelta(delta)).await?;
        assert!(failure_text(&r).contains("another block"), "{delta}: {}", failure_text(&r));
        assert_eq!(w.balance(&w.hunter).await?, 0);
        assert_eq!(w.challenge_state(0).await?, "Pending");
    }
    Ok(())
}

#[tokio::test]
async fn verdict_for_other_facts_is_refused() -> anyhow::Result<()> {
    for which in ["path", "wallet", "token"] {
        let w = opened().await?;
        let path = w.honest_path(&w.insider).await?;
        let r = w.challenge_with(&w.hunter, &w.insider, path, &Mode::OtherFacts(which)).await?;
        let t = failure_text(&r);
        assert!(t.contains("verdict names another") || t.contains("different receipts"), "{which}: {t}");
        assert_eq!(w.balance(&w.hunter).await?, 0);
        assert_eq!(w.balance(&w.insider).await?, BUY);
    }
    Ok(())
}

#[tokio::test]
async fn an_unknown_verdict_value_is_refused() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    let r = w.challenge_with(&w.hunter, &w.insider, path, &Mode::Force("maybe")).await?;
    assert!(failure_text(&r).contains("unknown verdict value"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.insider).await?, BUY);
    Ok(())
}

#[tokio::test]
async fn silent_enclave_leaves_the_vest_and_the_bond_reclaimable_after_the_wait() -> anyhow::Result<()> {
    for mode in [Mode::Silent, Mode::Fail] {
        let w = opened().await?;
        let path = w.honest_path(&w.insider).await?;
        let r = w.challenge_with(&w.hunter, &w.insider, path.clone(), &mode).await?;
        assert!(r.is_success(), "challenge itself is accepted: {}", failure_text(&r));
        assert_eq!(w.challenge_state(0).await?, "Pending");
        assert_eq!(w.balance(&w.hunter).await?, 0);
        assert_eq!(w.bag(&w.insider).await?["state"], "vesting");
        // a stranger cannot reclaim
        let thief = w.outsider.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
        assert!(thief.is_failure() && failure_text(&thief).contains("only the challenger"), "{}", failure_text(&thief));
        // Silent already waited out the yield (215 blocks); Fail answered at once, so too early for it
        if matches!(mode, Mode::Fail) {
            let early = w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
            assert!(early.is_failure() && failure_text(&early).contains("may still answer"), "{}", failure_text(&early));
            w.worker.fast_forward(230).await?;
        } else {
            w.worker.fast_forward(10).await?;
        }
        let before = w.native(&w.hunter).await?;
        w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?.into_result()?;
        let after = w.native(&w.hunter).await?;
        assert!(after + near(0.05).as_yoctonear() > before + w.knobs.min_bond.as_yoctonear(), "bond returned");
        assert_eq!(w.challenge_state(0).await?, "Reclaimed");
        let twice = w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
        assert!(twice.is_failure(), "no second reclaim");
        // and the wallet can be challenged again
        let again = w.challenge(&w.hunter, &w.insider, path).await?;
        assert!(again.is_success(), "{}", failure_text(&again));
        assert!(w.challenge_state(1).await?["Upheld"]["seized"].is_string());
    }
    Ok(())
}

#[tokio::test]
async fn an_outlayer_that_refuses_the_run_leaves_the_vest_and_the_bond_alone() -> anyhow::Result<()> {
    // OutLayer's own contract decides whether it takes a run; paused, request_execution panics
    let w = opened().await?;
    w.owner.call(w.outlayer.id(), "set_paused").args_json(json!({"paused": true})).transact().await?.into_result()?;
    let path = w.honest_path(&w.insider).await?;
    let r = w.challenge_held(&w.hunter, &w.insider, path).await?.await?;
    assert!(r.is_success(), "the challenge is filed even though the run was refused: {}", failure_text(&r));
    assert_eq!(w.challenge_state(0).await?, "Pending");
    assert_eq!(w.bag(&w.insider).await?["state"], "vesting");
    assert_eq!(w.balance(&w.hunter).await?, 0);
    let ids: Vec<u64> = w.outlayer.view("get_pending_request_ids").args_json(json!({"from_index": null, "limit": null})).await?.json()?;
    assert!(ids.is_empty(), "OutLayer holds nothing: {ids:?}");
    w.worker.fast_forward(230).await?;
    let before = w.native(&w.hunter).await?;
    w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?.into_result()?;
    assert!(w.native(&w.hunter).await? + near(0.05).as_yoctonear() > before + w.knobs.min_bond.as_yoctonear(), "bond returned");
    Ok(())
}

#[tokio::test]
async fn on_verdict_is_private() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    w.challenge_with(&w.hunter, &w.insider, path, &Mode::Silent).await?.into_result()?;
    let r = w
        .outsider
        .call(w.token.id(), "on_verdict")
        .args_json(json!({"challenge_id": 0}))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(r.is_failure() && failure_text(&r).contains("Method on_verdict is private"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn challenge_guards() -> anyhow::Result<()> {
    let w = opened().await?;
    let bond = w.knobs.min_bond.as_yoctonear();
    let fee = w.knobs.exec_fee.as_yoctonear();
    let call = |wallet: &str, p: Vec<String>, bond: u128, dep: u128, by: &near_workspaces::Account| {
        by.call(w.token.id(), "challenge")
            .args_json(json!({"wallet": wallet, "path": p, "bond": bond.to_string()}))
            .deposit(NearToken::from_yoctonear(dep))
            .gas(near_workspaces::types::Gas::from_tgas(300))
            .transact()
    };
    let ins = w.insider.id().to_string();
    let cases: Vec<(&str, _)> = vec![
        ("below min_bond", call(&ins, junk_path(), bond - 1, bond - 1 + fee, &w.hunter).await?),
        ("attach exactly", call(&ins, junk_path(), bond, bond, &w.hunter).await?),
        ("cannot challenge itself", call(&ins, junk_path(), bond, bond + fee, &w.insider).await?),
        ("must be registered", {
            let stranger = w.root.create_subaccount("stranger").initial_balance(near(5.0)).transact().await?.into_result()?;
            call(&ins, junk_path(), bond, bond + fee, &stranger).await?
        }),
        ("followed by the opening buy", call(&ins, vec![fake_tx(1)], bond, bond + fee, &w.hunter).await?),
        ("followed by the opening buy", call(&ins, (0..6).map(fake_tx).collect(), bond, bond + fee, &w.hunter).await?),
        ("base58 transaction hash", call(&ins, vec!["not-a-hash".into(), fake_tx(1)], bond, bond + fee, &w.hunter).await?),
        ("no opening bag", call(w.outsider.id().as_str(), junk_path(), bond, bond + fee, &w.hunter).await?),
    ];
    for (needle, r) in cases {
        assert!(r.is_failure() && failure_text(&r).contains(needle), "{needle}: {}", failure_text(&r));
    }
    // one open challenge per wallet
    let path = w.honest_path(&w.insider).await?;
    let tx = w.challenge_held(&w.hunter, &w.insider, path.clone()).await?;
    w.held_request().await?;
    let r = call(&ins, path, bond, bond + fee, &w.hunter).await?;
    assert!(r.is_failure() && failure_text(&r).contains("already open"), "{}", failure_text(&r));
    w.answer_held(tx, &Mode::Silent).await?;
    Ok(())
}

#[tokio::test]
async fn a_wallet_is_seized_once() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    w.challenge(&w.hunter, &w.insider, path).await?.into_result()?;
    // the second challenge never reaches OutLayer: the token refuses it at the door
    let bond = w.knobs.min_bond.as_yoctonear();
    let r = w
        .hunter
        .call(w.token.id(), "challenge")
        .args_json(json!({"wallet": w.insider.id(), "path": junk_path(), "bond": bond.to_string()}))
        .deposit(NearToken::from_yoctonear(bond + w.knobs.exec_fee.as_yoctonear()))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?;
    assert!(r.is_failure() && failure_text(&r).contains("already seized"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn challenge_gas_fits_one_transaction() -> anyhow::Result<()> {
    let w = opened().await?;
    let path = w.honest_path(&w.insider).await?;
    let r = w.challenge(&w.hunter, &w.insider, path).await?;
    r.clone().into_result()?;
    let burnt: u64 = r.total_gas_burnt.as_gas();
    println!("challenge total gas burnt: {} TGas", burnt / 1_000_000_000_000);
    assert!(burnt < 250_000_000_000_000, "challenge burns {burnt}");
    Ok(())
}

#[tokio::test]
async fn pin_flow_pins_the_key_the_module_proved() -> anyhow::Result<()> {
    let w = World::unpinned(Knobs::default()).await?;
    assert!(w.pinned_key().await?.is_null(), "nothing pinned before the flow");
    let r = w.pin(&Mode::Honest).await?;
    r.clone().into_result()?;
    assert_eq!(w.pinned_key().await?, json!(w.enclave.key()));
    assert!(event_data(&r, "verdict_key_pinned").is_some());
    Ok(())
}

#[tokio::test]
async fn the_key_is_pinned_once() -> anyhow::Result<()> {
    let w = World::new().await?;
    let again = w.hunter.call(w.token.id(), "pin_verdict_key").deposit(w.knobs.exec_fee).gas(near_workspaces::types::Gas::from_tgas(300)).transact().await?;
    assert!(again.is_failure() && failure_text(&again).contains("already pinned"), "{}", failure_text(&again));
    assert_eq!(w.pinned_key().await?, json!(w.enclave.key()));
    Ok(())
}

#[tokio::test]
async fn a_key_the_module_did_not_prove_is_not_pinned() -> anyhow::Result<()> {
    let w = World::unpinned(Knobs::default()).await?;
    let r = w.pin(&Mode::OtherKey).await?;
    assert!(failure_text(&r).contains("not signed by the key it reports"), "{}", failure_text(&r));
    assert!(w.pinned_key().await?.is_null());
    // a silent or failed run pins nothing either, and the pin can be retried
    w.pin(&Mode::Fail).await?.into_result()?;
    assert!(w.pinned_key().await?.is_null());
    w.pin(&Mode::Honest).await?.into_result()?;
    assert_eq!(w.pinned_key().await?, json!(w.enclave.key()));
    Ok(())
}

#[tokio::test]
async fn nothing_can_be_challenged_before_the_key_is_pinned() -> anyhow::Result<()> {
    let w = World::unpinned(Knobs::default()).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    let bond = w.knobs.min_bond.as_yoctonear();
    let r = w
        .hunter
        .call(w.token.id(), "challenge")
        .args_json(json!({"wallet": w.insider.id(), "path": junk_path(), "bond": bond.to_string()}))
        .deposit(NearToken::from_yoctonear(bond + w.knobs.exec_fee.as_yoctonear()))
        .gas(near_workspaces::types::Gas::from_tgas(300))
        .transact()
        .await?;
    assert!(r.is_failure() && failure_text(&r).contains("not pinned yet"), "{}", failure_text(&r));
    Ok(())
}
