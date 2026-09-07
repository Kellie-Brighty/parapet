# Parapet — project instructions

Non-custodial lending market for tokenized stocks on Robinhood Chain (concept/demo).
Front-end prototype only — no real wallet or chain calls, all data simulated.

## Stack
- Vite + React 18, plain JS (no TypeScript)
- Inline styles only — no Tailwind, no CSS files, no styled-components
- Icons: lucide-react. Charts: recharts (installed, not yet used)
- Everything currently lives in `src/App.jsx` — split into components as it grows

## Commands
- `npm install`
- `npm run dev` — dev server, port 5173
- `npm run build` — production build

## Conventions
- Color tokens live in the `C` object at the top of App.jsx — reuse these, don't
  hardcode hex values elsewhere
- Brand green is `C.brand` (#00C805, Robinhood's actual brand color) — keep the
  "not affiliated with Robinhood" disclaimer visible anywhere this shows prominently
- Fonts: Fraunces (serif, class `.serif`) for headings/display, Inter for body/UI
- Numeric values use class `num` for tabular-nums alignment

## Do not
- Do not rename the project to "Cairn," "Strata," "Ledge," or "Pledge" — all
  rejected (Cairn/Strata copy an existing product's name, Ledge/Pledge collide with
  real crypto products). "Parapet" is final.
- Do not remove the Robinhood affiliation disclaimer if Robinhood-green branding stays

## Core logic to preserve
`computePosition(supplies, borrows)` in App.jsx is the real math: collateral value,
borrow limit (value × maxLTV), liquidation value (value × liqThreshold), health factor
(liqValue / borrowedValue), net APY. Any lending-related feature should extend this
function rather than duplicating its logic elsewhere. The same math is now mirrored
on-chain — see `contracts/`.

## Contracts
A local, test-only Aave V3-based lending market lives in `contracts/` (Foundry).
It lists reserves matching the `ASSETS` table in App.jsx exactly — USDG is the only
borrowable asset, every stock/ETF is collateral-only. Not deployed anywhere live yet;
see `contracts/script/ConfigureReserves.s.sol` for local/anvil deployment and
`contracts/test/CrossCollateralHealthFactor.t.sol` for the parity tests against
computePosition(). Run `forge test` from `contracts/` to verify.

## Known next steps
- Wire a real wallet connector (wagmi/viem) for Robinhood Chain (chain ID 4663)
- Replace hardcoded `ASSETS` array with a live price feed
- Split App.jsx into per-component files
- Get the contracts in `contracts/` reviewed/audited before any live deployment
