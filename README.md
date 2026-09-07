# Parapet

A non-custodial lending market for tokenized stocks, built on Robinhood Chain. Post
tokenized stocks (AAPL, NVDA, TSLA, etc.) as collateral, borrow USDG against them, and
track your health factor in real time.

This is a front-end prototype: all market data, wallet balances, and transactions are
simulated in-memory. No wallet connection or on-chain calls are actually made from the
UI. A separate, local-only contracts foundation exists in `contracts/` (see below).

## Getting started

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

## Project structure

```
parapet-app/
├── index.html          entry HTML, loads src/main.jsx
├── src/
│   ├── main.jsx         React root
│   └── App.jsx           the entire app: nav, ticker tape, landing page,
│                          markets table, dashboard, borrow/supply modal
├── contracts/           local Aave V3-based lending market (Foundry) — see below
├── package.json
└── vite.config.js
```

Everything lives in `src/App.jsx` for now — it's organized into clearly separated
components (Nav, TickerTape, Hero, Overview sections, Markets, Dashboard, ActionModal)
that would be natural to split into their own files as the project grows.

## What's real vs. simulated

- **Real:** the lending math — max LTV, liquidation thresholds, health factor,
  borrow-power caps — all recompute live off whatever you supply/borrow in the demo.
  The same numbers are now also mirrored on-chain in `contracts/` and verified by tests.
- **Simulated:** wallet connection and asset prices in the UI, and all UI transactions.
  The UI itself makes no blockchain calls yet.

## Contracts

`contracts/` is a Foundry project that deploys a real (locally-run, test-only) Aave V3
instance configured to match `ASSETS` in App.jsx exactly: USDG is the only borrowable
asset, every tokenized stock/ETF is collateral-only. This is what gives the front end's
single cross-asset health factor real on-chain meaning — Aave aggregates a user's
collateral and debt across every reserve natively.

```bash
cd contracts
forge test                            # run the parity/liquidation test suite
anvil                                 # in a separate terminal, for a local chain
forge script script/ConfigureReserves.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow
```

Not deployed anywhere live, not audited, no real funds — see `CLAUDE.md` for details.

## Next steps if you want to take this further

- Wire up an actual wallet connector (wagmi / viem) against Robinhood Chain (chain ID 4663)
- Replace the mock `ASSETS` array with live prices from a Chainlink or Pyth feed
- Split `App.jsx` into per-component files once the UI stabilizes
- Get the contracts in `contracts/` reviewed/audited before any live deployment

## Disclosure

Parapet is an independent, fictional project built for demonstration purposes. It is not
affiliated with or endorsed by Robinhood Markets, Inc.
