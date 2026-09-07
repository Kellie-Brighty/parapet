# Parapet

A non-custodial lending market for tokenized stocks, built on Robinhood Chain. Post
tokenized stocks (AAPL, NVDA, TSLA, etc.) as collateral, borrow USDG against them, and
track your health factor in real time.

This is a front-end prototype: all market data, wallet balances, and transactions are
simulated in-memory. No wallet connection or on-chain calls are actually made.

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
├── package.json
└── vite.config.js
```

Everything lives in `src/App.jsx` for now — it's organized into clearly separated
components (Nav, TickerTape, Hero, Overview sections, Markets, Dashboard, ActionModal)
that would be natural to split into their own files as the project grows.

## What's real vs. simulated

- **Real:** the lending math — max LTV, liquidation thresholds, health factor,
  borrow-power caps — all recompute live off whatever you supply/borrow in the demo.
- **Simulated:** wallet connection, asset prices, and all transactions. No blockchain
  calls are made.

## Next steps if you want to take this further

- Wire up an actual wallet connector (wagmi / viem) against Robinhood Chain (chain ID 4663)
- Replace the mock `ASSETS` array with live prices from a Chainlink or Pyth feed
- Build the actual lending smart contracts (a Morpho or Aave V3 fork is the fastest path)
- Split `App.jsx` into per-component files once the UI stabilizes

## Disclosure

Parapet is an independent, fictional project built for demonstration purposes. It is not
affiliated with or endorsed by Robinhood Markets, Inc.
