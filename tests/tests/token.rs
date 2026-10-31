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

fn path() -> Vec<String> {
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
    w.worker.fast_forward(200).await?;
    let win: Value = w.token.view("window").await?.json()?;
    let now_s = w.worker.view_block().await?.timestamp() / 1_000_000_000;
    assert!(now_s >= win["opening_ends_s"].as_u64().unwrap(), "window closed: now {now_s} win {win}");
    w.market_pays(&w.insider, BUY / 2).await?.into_result()?;
    let bag = w.bag(&w.insider).await?;
    assert_eq!(bag["bought"], BUY.to_string(), "the late buy is not an opening buy");
    w.transfer(&w.insider, &w.outsider, BUY / 2).await?.into_result()?;
    let r = w.transfer(&w.insider, &w.outsider, 2 * UNIT).await?;
    assert!(r.is_failure(), "past the late bag the opening bag holds");
    Ok(())
}

#[tokio::test]
async fn buyer_after_the_window_is_never_held() -> anyhow::Result<()> {
    let w = World::with(Knobs { window_s: 40, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    w.worker.fast_forward(200).await?;
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
    w.worker.fast_forward(60).await?;
    let l1: u128 = w.bag(&w.insider).await?["locked"].as_str().unwrap().parse()?;
    assert!(l1 < l0, "locked amount shrinks: {l0} -> {l1}");
    // what has vested can move now, and not a token more
    let free = BUY - l1;
    assert!(free > 0);
    w.transfer(&w.insider, &w.outsider, free).await?.into_result()?;
    let r = w.transfer(&w.insider, &w.outsider, UNIT).await?;
    assert!(r.is_failure(), "only the vested part moved");
    w.worker.fast_forward(200).await?;
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
    w.script("upheld", "answer", 0).await?;
    let before = w.balance(&w.hunter).await?;
    let native_before = w.native(&w.hunter).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    r.clone().into_result()?;
    let ev = event_data(&r, "wallet_seized").expect("wallet_seized event");
    let seized: u128 = ev["seized"].as_str().unwrap().parse()?;
    let frozen: u128 = ev["frozen"].as_str().unwrap().parse()?;
    // exactly 20% of what was unvested at the verdict block, the rest frozen
    assert_eq!(seized, (seized + frozen) / 5, "seized {seized} frozen {frozen}");
    assert!(seized + frozen <= BUY && seized + frozen > BUY * 99 / 100);
    assert_eq!(w.balance(&w.hunter).await? - before, seized, "challenger received the seizure");
    assert_eq!(w.balance(&w.insider).await?, BUY - seized);
    // bond came back: only gas and the exec fee are gone
    let native_after = w.native(&w.hunter).await?;
    let spent = native_before.saturating_sub(native_after);
    let fee = w.knobs.exec_fee.as_yoctonear();
    assert!(spent >= fee && spent < fee + near(0.5).as_yoctonear(), "spent {spent}");
    // the remainder of the unvested bag stays locked for lock_s
    let bag = w.bag(&w.insider).await?;
    assert_eq!(bag["state"], "seized_frozen");
    assert_eq!(bag["locked"], frozen.to_string());
    let r = w.transfer(&w.insider, &w.outsider, 1).await?;
    assert!(r.is_failure(), "frozen remainder cannot move");
    assert_eq!(w.challenge_state(0).await?["Upheld"]["seized"], seized.to_string());
    assert!(w.token.view("open_challenge_of").args_json(json!({"wallet": w.insider.id()})).await?.json::<Value>()?.is_null());
    Ok(())
}

#[tokio::test]
async fn request_to_outlayer_names_the_module_the_wallet_and_the_receipts() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("upheld", "answer", 0).await?;
    w.challenge(&w.hunter, &w.insider, path()).await?.into_result()?;
    let last: Value = w.sim.view("last_request").await?.json()?;
    let input: Value = serde_json::from_str(last["input"].as_str().unwrap())?;
    assert_eq!(input["wallet"], w.insider.id().to_string());
    assert_eq!(input["creator"], w.creator.id().to_string());
    assert_eq!(input["token"], w.token.id().to_string());
    assert_eq!(input["path"], json!(path()));
    assert_eq!(input["max_hops"], 4);
    let source: Value = serde_json::from_str(last["source"].as_str().unwrap())?;
    assert_eq!(source["WasmUrl"]["hash"], MODULE_SHA);
    assert_eq!(last["payer"], w.hunter.id().to_string());
    assert_eq!(last["deposit"], w.knobs.exec_fee.as_yoctonear().to_string());
    Ok(())
}

#[tokio::test]
async fn rejected_challenge_forfeits_the_bond_and_moves_nothing() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("rejected", "answer", 0).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    r.clone().into_result()?;
    assert!(event_data(&r, "challenge_rejected").is_some());
    assert_eq!(w.balance(&w.hunter).await?, 0);
    assert_eq!(w.balance(&w.insider).await?, BUY);
    let forfeited: String = w.token.view("forfeited").await?.json()?;
    assert_eq!(forfeited, w.knobs.min_bond.as_yoctonear().to_string());
    assert_eq!(w.challenge_state(0).await?, "Rejected");
    // the hold is untouched and a new challenge can be filed
    assert_eq!(w.bag(&w.insider).await?["state"], "vesting");
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    assert!(r.is_success());
    Ok(())
}

#[tokio::test]
async fn verdict_signed_by_another_key_changes_nothing() -> anyhow::Result<()> {
    let w = opened().await?;
    w.sim.call("set_seed").args_json(json!({"seed_hex": hex(&OTHER_SEED)})).transact().await?.into_result()?;
    w.script("upheld", "answer", 0).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    assert!(failure_text(&r).contains("does not verify against the pinned key"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0);
    assert_eq!(w.balance(&w.insider).await?, BUY);
    assert_eq!(w.challenge_state(0).await?, "Pending");
    Ok(())
}

#[tokio::test]
async fn stale_verdict_is_refused() -> anyhow::Result<()> {
    // the callback lands a block or two after the enclave answered; a one block validity cannot hold that
    let w = World::with(Knobs { max_age_blocks: 1, ..Knobs::default() }).await?;
    w.market_pays(&w.insider, BUY).await?.into_result()?;
    w.script("upheld", "answer", 0).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    assert!(failure_text(&r).contains("stale"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0, "nothing paid on a stale verdict");
    Ok(())
}

#[tokio::test]
async fn verdict_older_than_the_challenge_is_refused() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("upheld", "answer", -1_000).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    assert!(failure_text(&r).contains("predates"), "{}", failure_text(&r));
    assert_eq!(w.balance(&w.hunter).await?, 0);
    Ok(())
}

#[tokio::test]
async fn verdict_for_other_facts_is_refused() -> anyhow::Result<()> {
    for behaviour in ["wrong_hash", "wrong_wallet", "wrong_token"] {
        let w = opened().await?;
        w.script("upheld", behaviour, 0).await?;
        let r = w.challenge(&w.hunter, &w.insider, path()).await?;
        let t = failure_text(&r);
        assert!(t.contains("verdict names another") || t.contains("different receipts"), "{behaviour}: {t}");
        assert_eq!(w.balance(&w.hunter).await?, 0);
        assert_eq!(w.balance(&w.insider).await?, BUY);
    }
    Ok(())
}

#[tokio::test]
async fn silent_enclave_leaves_the_vest_and_the_bond_reclaimable_after_the_wait() -> anyhow::Result<()> {
    for behaviour in ["silent", "fail"] {
        let w = opened().await?;
        w.script("upheld", behaviour, 0).await?;
        let r = w.challenge(&w.hunter, &w.insider, path()).await?;
        assert!(r.is_success(), "challenge itself is accepted: {}", failure_text(&r));
        assert_eq!(w.challenge_state(0).await?, "Pending");
        assert_eq!(w.balance(&w.hunter).await?, 0);
        assert_eq!(w.bag(&w.insider).await?["state"], "vesting");
        // too early
        let early = w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
        assert!(early.is_failure() && failure_text(&early).contains("may still answer"), "{}", failure_text(&early));
        // a stranger cannot reclaim
        w.worker.fast_forward(230).await?;
        let thief = w.outsider.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
        assert!(thief.is_failure() && failure_text(&thief).contains("only the challenger"));
        let before = w.native(&w.hunter).await?;
        w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?.into_result()?;
        let after = w.native(&w.hunter).await?;
        assert!(after + near(0.05).as_yoctonear() > before + w.knobs.min_bond.as_yoctonear(), "bond returned");
        assert_eq!(w.challenge_state(0).await?, "Reclaimed");
        let twice = w.hunter.call(w.token.id(), "reclaim_bond").args_json(json!({"challenge_id": 0})).transact().await?;
        assert!(twice.is_failure(), "no second reclaim");
        // and the wallet can be challenged again
        w.script("upheld", "answer", 0).await?;
        let again = w.challenge(&w.hunter, &w.insider, path()).await?;
        assert!(again.is_success());
        assert_eq!(w.challenge_state(1).await?["Upheld"]["seized"].is_string(), true);
    }
    Ok(())
}

#[tokio::test]
async fn on_verdict_is_private() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("upheld", "silent", 0).await?;
    w.challenge(&w.hunter, &w.insider, path()).await?.into_result()?;
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
    w.script("upheld", "silent", 0).await?;
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
        ("below min_bond", call(&ins, path(), bond - 1, bond - 1 + fee, &w.hunter).await?),
        ("attach exactly", call(&ins, path(), bond, bond, &w.hunter).await?),
        ("cannot challenge itself", call(&ins, path(), bond, bond + fee, &w.insider).await?),
        ("must be registered", {
            let stranger = w.root.create_subaccount("stranger").initial_balance(near(5.0)).transact().await?.into_result()?;
            call(&ins, path(), bond, bond + fee, &stranger).await?
        }),
        ("longer than max_hops", call(&ins, (0..5).map(fake_tx).collect(), bond, bond + fee, &w.hunter).await?),
        ("base58 transaction hash", call(&ins, vec!["not-a-hash".into()], bond, bond + fee, &w.hunter).await?),
        ("no opening bag", call(w.outsider.id().as_str(), path(), bond, bond + fee, &w.hunter).await?),
    ];
    for (needle, r) in cases {
        assert!(r.is_failure() && failure_text(&r).contains(needle), "{needle}: {}", failure_text(&r));
    }
    // one open challenge per wallet
    call(&ins, path(), bond, bond + fee, &w.hunter).await?.into_result()?;
    let r = call(&ins, path(), bond, bond + fee, &w.hunter).await?;
    assert!(r.is_failure() && failure_text(&r).contains("already open"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn a_wallet_is_seized_once() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("upheld", "answer", 0).await?;
    w.challenge(&w.hunter, &w.insider, path()).await?.into_result()?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    assert!(r.is_failure() && failure_text(&r).contains("already seized"), "{}", failure_text(&r));
    Ok(())
}

#[tokio::test]
async fn challenge_gas_fits_one_transaction() -> anyhow::Result<()> {
    let w = opened().await?;
    w.script("upheld", "answer", 0).await?;
    let r = w.challenge(&w.hunter, &w.insider, path()).await?;
    r.clone().into_result()?;
    let burnt: u64 = r.total_gas_burnt.as_gas();
    println!("challenge total gas burnt: {} TGas", burnt / 1_000_000_000_000);
    assert!(burnt < 150_000_000_000_000, "challenge burns {burnt}");
    Ok(())
}
