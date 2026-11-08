"use strict";

(() => {
  const { traceFixture, challengeVerdict } = globalThis.CustomsRule;
  const fixtures = globalThis.AttackLabFixtures;
  const cases = [
    {
      title: "Exchange-funded buyer",
      evidence: "The opening wallet receives funds from exchange.near. No receipt in this fixture connects that exchange account to the creator.",
      evaluate: () => traceFixture({ ...fixtures.exchange, wallet: fixtures.exchange.buyer, creator: fixtures.creator, buyTs: fixtures.buyTs, buyCost: fixtures.buyCost }),
    },
    {
      title: "Creator-funded opening buyers",
      evidence: "Both paths start at the creator, reach their buyer before the opening purchase, and each transfer clears half the 100-unit purchase cost.",
      evaluate: () => [fixtures.direct, fixtures.twoHop].map((fixture) => ({
        buyer: fixture.buyer,
        ...traceFixture({ ...fixture, wallet: fixture.buyer, creator: fixtures.creator, buyTs: fixtures.buyTs, buyCost: fixtures.buyCost }),
      })),
    },
    {
      title: "Transfer after vesting",
      evidence: `Transfer ${fixtures.vesting.transfer.hash} moves ${fixtures.vesting.transfer.amount} units at time ${fixtures.vesting.transfer.ts}. Vesting ended at ${fixtures.vesting.vestEndTs}, so the fixture places it outside the challenge window.`,
      evaluate: () => ({ verdict: challengeVerdict(fixtures.vesting.transfer.ts, fixtures.vesting.vestEndTs), path: [] }),
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const evaluated = scenario.evaluate();
    const results = Array.isArray(evaluated) ? evaluated : [evaluated];
    const article = document.createElement("article");
    article.className = "lab-case";
    const heading = document.createElement("h2");
    heading.textContent = `${String(index + 1).padStart(2, "0")} / ${scenario.title}`;
    const stamp = document.createElement("p");
    stamp.className = "lab-verdict";
    for (const result of results) {
      const finding = document.createElement("span");
      finding.dataset.verdict = result.verdict;
      finding.textContent = `${result.buyer || ""} ${result.verdict.replaceAll("-", " ")}`;
      stamp.append(finding);
    }
    const explanation = document.createElement("p");
    explanation.textContent = scenario.evidence;
    article.append(heading, stamp, explanation);

    for (const result of results) if (result.path.length) {
      const list = document.createElement("ol");
      list.className = "lab-path";
      list.setAttribute("aria-label", `${result.buyer} transaction path`);
      for (const edge of result.path) {
        const item = document.createElement("li");
        const route = document.createElement("span");
        route.textContent = `${edge.from} → ${edge.to} · ${edge.yocto} yocto`;
        const tx = document.createElement("code");
        tx.textContent = edge.tx;
        item.append(route, tx);
        list.append(item);
      }
      article.append(list);
    }
    document.querySelector("#scenarios").append(article);
  }
})();
