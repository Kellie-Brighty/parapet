import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ArrowRight, Wallet, Check, ShieldCheck, TrendingUp, TrendingDown, AlertTriangle, X,
  ChevronRight, Lock, Eye, Zap, Layers, Plus, Minus,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const C = {
  ink: "#000000",
  panel: "#0D0F0D",
  panelRaised: "#171917",
  panelHi: "#1D201C",
  line: "#242724",
  line2: "#33362F",
  chalk: "#F3F4F0",
  fog: "#8D948C",
  fogDim: "#565A54",
  brand: "#00C805",
  brandDim: "#00930A",
  amber: "#E8A93B",
  red: "#FF5C5C",
};

function riskColor(hf: number): string {
  if (hf === Infinity) return C.brand;
  if (hf >= 1.5) return C.brand;
  if (hf >= 1.1) return C.amber;
  return C.red;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------
interface Asset {
  id: string;
  ticker: string;
  name: string;
  price: number;
  isStable?: boolean;
  supplyAPY: number;
  borrowAPY: number;
  maxLTV: number;
  liqThreshold: number;
  totalSupplied: number;
  totalBorrowed: number;
  accent: string;
  chg: number;
}

const ASSETS: Asset[] = [
  { id: "usdg", ticker: "USDG", name: "Global Dollar", price: 1.0, isStable: true, supplyAPY: 0.042, borrowAPY: 0.068, maxLTV: 0, liqThreshold: 0, totalSupplied: 18_400_000, totalBorrowed: 9_700_000, accent: "#8D948C", chg: 0.0 },
  { id: "spy", ticker: "SPY", name: "S&P 500 ETF", price: 659.4, supplyAPY: 0.002, borrowAPY: 0.036, maxLTV: 0.78, liqThreshold: 0.84, totalSupplied: 3_100_000, totalBorrowed: 640_000, accent: "#7FA1C2", chg: 0.42 },
  { id: "aapl", ticker: "AAPL", name: "Apple", price: 231.5, supplyAPY: 0.003, borrowAPY: 0.046, maxLTV: 0.68, liqThreshold: 0.75, totalSupplied: 2_640_000, totalBorrowed: 710_000, accent: "#C9CBC7", chg: -0.18 },
  { id: "msft", ticker: "MSFT", name: "Microsoft", price: 478.6, supplyAPY: 0.003, borrowAPY: 0.043, maxLTV: 0.7, liqThreshold: 0.77, totalSupplied: 2_980_000, totalBorrowed: 590_000, accent: "#7FC2A8", chg: 0.65 },
  { id: "nvda", ticker: "NVDA", name: "NVIDIA", price: 184.2, supplyAPY: 0.004, borrowAPY: 0.051, maxLTV: 0.6, liqThreshold: 0.68, totalSupplied: 4_150_000, totalBorrowed: 1_380_000, accent: "#4FA8E0", chg: 1.24 },
  { id: "googl", ticker: "GOOGL", name: "Alphabet", price: 206.4, supplyAPY: 0.003, borrowAPY: 0.045, maxLTV: 0.68, liqThreshold: 0.75, totalSupplied: 1_920_000, totalBorrowed: 410_000, accent: "#E8A93B", chg: -0.31 },
  { id: "amzn", ticker: "AMZN", name: "Amazon", price: 224.1, supplyAPY: 0.0035, borrowAPY: 0.048, maxLTV: 0.65, liqThreshold: 0.72, totalSupplied: 1_760_000, totalBorrowed: 380_000, accent: "#E8935B", chg: 0.09 },
  { id: "tsla", ticker: "TSLA", name: "Tesla", price: 341.2, supplyAPY: 0.006, borrowAPY: 0.062, maxLTV: 0.55, liqThreshold: 0.63, totalSupplied: 2_210_000, totalBorrowed: 890_000, accent: "#8B7FD6", chg: -1.02 },
  { id: "jnj", ticker: "JNJ", name: "Johnson & Johnson", price: 164.9, supplyAPY: 0.0025, borrowAPY: 0.039, maxLTV: 0.74, liqThreshold: 0.8, totalSupplied: 980_000, totalBorrowed: 160_000, accent: "#6BB08A", chg: 0.14 },
];

const byId: Record<string, Asset> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

function fmtUSD(n: number, d = 0): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number, d = 1): string {
  return `${(n * 100).toFixed(d)}%`;
}
function shortHash(seed: number): string {
  const chars = "0123456789abcdef";
  let out = "0x";
  let s = seed >>> 0 || 1;
  for (let i = 0; i < 8; i++) {
    s = (s * 16807 + i * 7919) % 2147483647;
    out += chars[s % 16];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Portfolio math
// ---------------------------------------------------------------------------
type Balances = Record<string, number>;

interface Position {
  collateralValue: number;
  borrowLimit: number;
  liqValue: number;
  suppliedValue: number;
  borrowedValue: number;
  healthFactor: number;
  borrowPowerUsed: number;
  netWorth: number;
  netAPY: number;
}

function computePosition(supplies: Balances, borrows: Balances): Position {
  let collateralValue = 0, borrowLimit = 0, liqValue = 0, suppliedValue = 0, supplyYield = 0;

  Object.entries(supplies).forEach(([id, amt]) => {
    if (!amt) return;
    const a = byId[id];
    const v = amt * a.price;
    suppliedValue += v;
    supplyYield += v * a.supplyAPY;
    if (a.maxLTV > 0) {
      collateralValue += v;
      borrowLimit += v * a.maxLTV;
      liqValue += v * a.liqThreshold;
    }
  });

  let borrowedValue = 0, borrowCost = 0;
  Object.entries(borrows).forEach(([id, amt]) => {
    if (!amt) return;
    const a = byId[id];
    const v = amt * a.price;
    borrowedValue += v;
    borrowCost += v * a.borrowAPY;
  });

  const healthFactor = borrowedValue > 0 ? liqValue / borrowedValue : Infinity;
  const borrowPowerUsed = borrowLimit > 0 ? borrowedValue / borrowLimit : 0;
  const netWorth = suppliedValue - borrowedValue;
  const netAPY = netWorth !== 0 ? (supplyYield - borrowCost) / Math.abs(suppliedValue || 1) : 0;

  return { collateralValue, borrowLimit, liqValue, suppliedValue, borrowedValue, healthFactor, borrowPowerUsed, netWorth, netAPY };
}

// ---------------------------------------------------------------------------
// Logo mark — a crenellated wall (a literal parapet), reads clean at any size
// ---------------------------------------------------------------------------
function Mark({ size = 22, color = C.brand }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="11" width="18" height="9" rx="1" fill={color} />
      <rect x="3" y="5.5" width="4.2" height="6" fill={color} />
      <rect x="9.9" y="5.5" width="4.2" height="6" fill={color} />
      <rect x="16.8" y="5.5" width="4.2" height="6" fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Animated count-up number
// ---------------------------------------------------------------------------
function useCountUp(target: number, duration = 900, decimals = 0): string {
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = performance.now();
    const from = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (target - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
type TabId = "overview" | "markets" | "dashboard";
type ActionMode = "supply" | "borrow";

interface ModalState {
  mode: ActionMode;
  assetId: string;
}

interface ActivityEntry {
  id: number;
  mode: ActionMode;
  ticker: string;
  amount: number;
  valueUSD: number;
  hash: string;
  time: string;
}

export default function Parapet() {
  const [tab, setTab] = useState<TabId>("overview");
  const [connected, setConnected] = useState(false);
  const [supplies, setSupplies] = useState<Balances>({});
  const [borrows, setBorrows] = useState<Balances>({});
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);

  const position = useMemo(() => computePosition(supplies, borrows), [supplies, borrows]);

  function openApp() {
    setConnected(true);
    setTab("dashboard");
  }

  function confirmAction(assetId: string, mode: ActionMode, amount: number) {
    const a = byId[assetId];
    if (mode === "supply") {
      setSupplies((s) => ({ ...s, [assetId]: (s[assetId] || 0) + amount }));
    } else {
      setBorrows((b) => ({ ...b, [assetId]: (b[assetId] || 0) + amount }));
    }
    setActivity((log) => [
      { id: log.length, mode, ticker: a.ticker, amount, valueUSD: amount * a.price, hash: shortHash((log.length + 1) * 7919 + assetId.length * 104729), time: "just now" },
      ...log,
    ]);
    setModal(null);
  }

  return (
    <div style={{ background: C.ink, minHeight: "100%", color: C.chalk, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400;500;600;700;800&display=swap');
        .num { font-variant-numeric: tabular-nums; }
        .serif { font-family: 'Fraunces', serif; }
        .serif-i { font-family: 'Fraunces', serif; font-style: italic; }
        button { font-family: inherit; }
        input { font-family: inherit; }
        ::selection { background: rgba(0,200,5,0.25); }
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes floatCard { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
        @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>

      <Nav tab={tab} setTab={setTab} connected={connected} onConnect={() => setConnected(true)} />
      <TickerTape />

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px 0" }}>
        {tab === "overview" && <Overview onLaunch={openApp} onViewMarkets={() => setTab("markets")} />}
        {tab === "markets" && <Markets onOpenModal={setModal} connected={connected} onConnect={() => setConnected(true)} />}
        {tab === "dashboard" && (
          <Dashboard
            supplies={supplies} borrows={borrows} position={position} activity={activity}
            connected={connected} onConnect={() => setConnected(true)} onOpenModal={setModal}
          />
        )}
      </div>

      <Footer setTab={setTab} />

      {modal && (
        <ActionModal
          asset={byId[modal.assetId]} mode={modal.mode} position={position} supplies={supplies} borrows={borrows}
          onClose={() => setModal(null)} onConfirm={(amount) => confirmAction(modal.assetId, modal.mode, amount)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Nav({ tab, setTab, connected, onConnect }: { tab: TabId; setTab: (tab: TabId) => void; connected: boolean; onConnect: () => void }) {
  const items: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "markets", label: "Markets" },
    { id: "dashboard", label: "Dashboard" },
  ];
  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)", zIndex: 30 }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={() => setTab("overview")}>
            <Mark size={22} />
            <span className="serif" style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.2 }}>Parapet</span>
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => setTab(it.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "4px 0",
                  fontSize: 13.5, color: tab === it.id ? C.chalk : C.fog,
                  borderBottom: tab === it.id ? `2px solid ${C.brand}` : "2px solid transparent",
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.fog, border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 10px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.brand, display: "inline-block", animation: "pulseDot 2s ease-in-out infinite" }} />
            Robinhood Chain
          </div>
          <button
            onClick={onConnect}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: connected ? "transparent" : C.brand,
              color: connected ? C.chalk : "#000",
              border: `1px solid ${connected ? C.line : C.brand}`,
              borderRadius: 8, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
            }}
          >
            {connected ? <Check size={14} /> : <Wallet size={14} />}
            {connected ? "0x4f...9a2c" : "Connect wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TickerTape() {
  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, background: C.panel, overflow: "hidden", whiteSpace: "nowrap" }}>
      <div style={{ display: "inline-flex", animation: "marquee 34s linear infinite" }}>
        {[0, 1].map((rep) => (
          <div key={rep} style={{ display: "inline-flex" }}>
            {ASSETS.map((a) => (
              <div key={a.id + rep} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 20px", fontSize: 12 }}>
                <span className="num" style={{ fontWeight: 600, color: C.fog }}>{a.ticker}</span>
                <span className="num" style={{ color: C.chalk }}>{fmtPrice(a.price)}</span>
                <span className="num" style={{ color: a.chg >= 0 ? C.brand : C.red, display: "flex", alignItems: "center", gap: 2 }}>
                  {a.chg >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {a.chg >= 0 ? "+" : ""}{a.chg.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Overview({ onLaunch, onViewMarkets }: { onLaunch: () => void; onViewMarkets: () => void }) {
  const tvl = ASSETS.reduce((s, a) => s + a.totalSupplied, 0);
  const totalBorrowed = ASSETS.reduce((s, a) => s + a.totalBorrowed, 0);
  const tvlDisplay = useCountUp(tvl / 1_000_000, 1100, 2);
  const borrowedDisplay = useCountUp(totalBorrowed / 1_000_000, 1100, 2);

  return (
    <div>
      <Hero onLaunch={onLaunch} onViewMarkets={onViewMarkets} tvlDisplay={tvlDisplay} borrowedDisplay={borrowedDisplay} />

      <Section label="Why Parapet">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <FeatureCard icon={<Lock size={17} />} title="Fully non-custodial" body="Your stock tokens never leave your control until a smart contract, not a company, moves them — and only under rules you agreed to upfront." />
          <FeatureCard icon={<Eye size={17} />} title="Transparent liquidations" body="Loan-to-value, liquidation thresholds and every liquidation event are readable on-chain. No back-room margin calls." />
          <FeatureCard icon={<Zap size={17} />} title="Instant, no credit check" body="Your collateral is the underwriting. Borrow the moment you supply — no application, no waiting period." />
          <FeatureCard icon={<Layers size={17} />} title="Composable collateral" body="Positions are standard ERC-20s and vault shares, so they plug into the rest of the Robinhood Chain ecosystem." />
        </div>
      </Section>

      <Section label="How it works">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, position: "relative" }}>
          <div style={{ position: "absolute", top: 15, left: "16.5%", right: "16.5%", height: 1, background: C.line }} />
          <Step n="1" title="Supply collateral" body="Deposit tokenized stocks like NVDA or AAPL from your wallet. They keep earning any protocol yield while posted." />
          <Step n="2" title="Borrow USDG" body="Draw a loan against your collateral, up to that asset's max loan-to-value. Funds settle straight to your wallet." />
          <Step n="3" title="Manage your position" body="Track your liquidation buffer in real time. Repay or add collateral any time to stay clear of it." />
        </div>
      </Section>

      <Section label="Top markets" action={{ label: "All markets", onClick: onViewMarkets }}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          {ASSETS.slice(1, 6).map((a, i) => (
            <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "13px 18px", fontSize: 13, borderTop: i > 0 ? `1px solid ${C.line}` : "none", background: C.panel }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.accent }} />
                <span className="num" style={{ fontWeight: 600 }}>{a.ticker}</span>
                <span style={{ color: C.fogDim, fontSize: 12 }}>{a.name}</span>
              </div>
              <div className="num" style={{ color: C.fog }}>{fmtPrice(a.price)}</div>
              <div className="num" style={{ color: C.brand }}>{pct(a.supplyAPY, 2)} supply</div>
              <div className="num" style={{ color: C.fog }}>{pct(a.borrowAPY, 2)} borrow</div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Understanding risk">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "start" }}>
          <div>
            <p style={{ fontSize: 14, color: C.fog, lineHeight: 1.7, margin: "0 0 16px" }}>
              Every collateral asset has two numbers that matter: a <b style={{ color: C.chalk }}>max LTV</b>, the most
              you can borrow against it, and a <b style={{ color: C.chalk }}>liquidation threshold</b>, the point past
              which the protocol can sell collateral to repay your loan. The gap between them is your buffer.
            </p>
            <p style={{ fontSize: 14, color: C.fog, lineHeight: 1.7, margin: 0 }}>
              Your <b style={{ color: C.chalk }}>health factor</b> summarizes that buffer across your whole position.
              Above 1.5 is comfortable. Below 1.1, price moves can liquidate part of your collateral — so the
              dashboard surfaces it before you ever confirm a borrow.
            </p>
          </div>
          <RiskDiagram />
        </div>
      </Section>

      <Section label="Frequently asked">
        <FAQ />
      </Section>

      <div style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "56px 0", margin: "8px 0 48px", textAlign: "center" }}>
        <h2 className="serif" style={{ fontSize: 30, fontWeight: 500, margin: "0 0 10px" }}>Your portfolio, put to work.</h2>
        <p style={{ fontSize: 14.5, color: C.fog, margin: "0 0 22px" }}>Connect a wallet and supply your first collateral in under a minute.</p>
        <button
          onClick={onLaunch}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.brand, color: "#000", border: "none", borderRadius: 8, padding: "12px 22px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
        >
          Launch app <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Hero({ onLaunch, onViewMarkets, tvlDisplay, borrowedDisplay }: { onLaunch: () => void; onViewMarkets: () => void; tvlDisplay: string; borrowedDisplay: string }) {
  return (
    <div style={{ position: "relative", padding: "72px 0 56px", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: -120, right: -140, width: 480, height: 480, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,200,5,0.16) 0%, rgba(0,200,5,0) 70%)", pointerEvents: "none",
      }} />

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 40, alignItems: "center", position: "relative" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: C.fog, border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 12px", marginBottom: 22 }}>
            <ShieldCheck size={12} color={C.brand} /> Non-custodial · built on Robinhood Chain
          </div>
          <h1 className="serif" style={{ fontSize: 52, lineHeight: 1.04, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>
            Borrow against the stocks<br />you <span className="serif-i" style={{ fontWeight: 500 }}>already hold.</span>
          </h1>
          <p style={{ fontSize: 16, color: C.fog, marginTop: 20, lineHeight: 1.65, maxWidth: 460 }}>
            Post tokenized stocks as collateral and borrow USDG directly to your wallet — no selling,
            no brokerage, no waiting for settlement. Every position is liquidated only by transparent,
            on-chain rules.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 30 }}>
            <button
              onClick={onLaunch}
              style={{ display: "flex", alignItems: "center", gap: 8, background: C.brand, color: "#000", border: "none", borderRadius: 8, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
            >
              Launch app <ArrowRight size={15} />
            </button>
            <button
              onClick={onViewMarkets}
              style={{ background: "transparent", color: C.chalk, border: `1px solid ${C.line}`, borderRadius: 8, padding: "12px 20px", fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}
            >
              View markets
            </button>
          </div>

          <div style={{ display: "flex", gap: 28, marginTop: 40 }}>
            <div>
              <div className="num serif" style={{ fontSize: 24, fontWeight: 600 }}>${tvlDisplay}M</div>
              <div style={{ fontSize: 11.5, color: C.fogDim, marginTop: 3 }}>Total supplied</div>
            </div>
            <div>
              <div className="num serif" style={{ fontSize: 24, fontWeight: 600 }}>${borrowedDisplay}M</div>
              <div style={{ fontSize: 11.5, color: C.fogDim, marginTop: 3 }}>Total borrowed</div>
            </div>
            <div>
              <div className="num serif" style={{ fontSize: 24, fontWeight: 600 }}>{ASSETS.length}</div>
              <div style={{ fontSize: 11.5, color: C.fogDim, marginTop: 3 }}>Markets live</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <HeroCard />
        </div>
      </div>
    </div>
  );
}

function HeroCard() {
  const hf = 1.84;
  return (
    <div style={{ animation: "floatCard 5s ease-in-out infinite", width: 320 }}>
      <div style={{ background: C.panelRaised, border: `1px solid ${C.line2}`, borderRadius: 16, padding: 22, boxShadow: "0 30px 60px -20px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 12, color: C.fogDim }}>Your position</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.brand }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.brand }} /> Healthy
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {[{ t: "NVDA", v: "12.4", u: "$2,285", c: "#4FA8E0" }, { t: "AAPL", v: "8.0", u: "$1,852", c: "#C9CBC7" }].map((r) => (
            <div key={r.t} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.c }} />
                <span className="num" style={{ fontWeight: 600 }}>{r.t}</span>
                <span className="num" style={{ color: C.fogDim, fontSize: 12 }}>{r.v}</span>
              </div>
              <span className="num" style={{ color: C.fog }}>{r.u}</span>
            </div>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: C.fogDim }}>Health factor</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: riskColor(hf) }}>{hf.toFixed(2)}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: C.line, overflow: "hidden" }}>
            <div style={{ width: `${(hf / 3) * 100}%`, height: "100%", background: riskColor(hf), borderRadius: 3 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12 }}>
            <span style={{ color: C.fogDim }}>Borrowed</span>
            <span className="num" style={{ color: C.fog }}>1,840 USDG</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Section({ label, action, children }: { label: string; action?: { label: string; onClick: () => void }; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 56 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: C.fogDim }}>{label}</div>
        {action && (
          <button onClick={action.onClick} style={{ background: "none", border: "none", color: C.fog, fontSize: 12.5, display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
            {action.label} <ChevronRight size={13} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(0,200,5,0.12)", color: C.brand, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.fog, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div style={{ position: "relative", paddingTop: 0, paddingRight: 20 }}>
      <div className="num" style={{
        width: 30, height: 30, borderRadius: "50%", background: C.panel, border: `1px solid ${C.line2}`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: C.brand,
        marginBottom: 14, position: "relative", zIndex: 1,
      }}>{n}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.fog, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function RiskDiagram() {
  const marker = 61.5; // example LTV %
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 12, color: C.fogDim, marginBottom: 14 }}>Example: NVDA collateral</div>
      <div style={{ position: "relative", height: 34, marginBottom: 10 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 14, height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
          <div style={{ width: "60%", background: C.brand, opacity: 0.55 }} />
          <div style={{ width: "8%", background: C.amber, opacity: 0.6 }} />
          <div style={{ width: "32%", background: C.red, opacity: 0.5 }} />
        </div>
        <div style={{ position: "absolute", left: `${marker}%`, top: 0, width: 2, height: 34, background: C.chalk }} />
        <div style={{ position: "absolute", left: `${marker}%`, top: -16, transform: "translateX(-50%)", fontSize: 10.5, color: C.chalk, whiteSpace: "nowrap" }} className="num">You: 61.5%</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.fogDim, marginBottom: 18 }}>
        <span>0%</span>
        <span className="num">Max LTV 60%</span>
        <span className="num">Liquidation 68%</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="Collateral value" value="$3,684.00" />
        <Row label="Borrowed" value="$1,840.00" />
        <Row label="Liquidation buffer" value="6.5 pts" color={C.amber} />
      </div>
    </div>
  );
}

function FAQ() {
  const items = [
    { q: "Is my collateral held by Parapet?", a: "No. Collateral sits in an audited smart contract on Robinhood Chain. Parapet never takes custody, and you can withdraw anything above your borrow limit at any time." },
    { q: "What happens if my health factor drops below 1?", a: "Once health factor crosses 1.0, part of your collateral becomes eligible for liquidation to repay the outstanding loan, plus a liquidation penalty. You'll see warnings well before that point." },
    { q: "Which assets can I use as collateral?", a: "Any tokenized stock or ETF listed in Markets — currently including AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA, SPY and JNJ. Each has its own max LTV based on historical volatility." },
    { q: "What chain does this run on, and why?", a: "Robinhood Chain, an Arbitrum-based Layer 2 purpose-built for tokenized real-world assets. It's where the underlying Stock Tokens are issued, so collateral and settlement happen on the same chain with no bridging." },
  ];
  const [open, setOpen] = useState(0);
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
      {items.map((it, i) => (
        <div key={i} style={{ borderTop: i > 0 ? `1px solid ${C.line}` : "none", background: C.panel }}>
          <button
            onClick={() => setOpen(open === i ? -1 : i)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", padding: "16px 18px", cursor: "pointer", color: C.chalk, textAlign: "left" }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>{it.q}</span>
            {open === i ? <Minus size={15} color={C.fog} /> : <Plus size={15} color={C.fog} />}
          </button>
          {open === i && <div style={{ padding: "0 18px 18px", fontSize: 13.5, color: C.fog, lineHeight: 1.6 }}>{it.a}</div>}
        </div>
      ))}
    </div>
  );
}

function Footer({ setTab }: { setTab: (tab: TabId) => void }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 24, marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Mark size={18} />
              <span className="serif" style={{ fontSize: 15, fontWeight: 600 }}>Parapet</span>
            </div>
            <p style={{ fontSize: 12.5, color: C.fogDim, lineHeight: 1.6, maxWidth: 260 }}>
              A non-custodial lending market for tokenized stocks, built on Robinhood Chain.
            </p>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: C.fogDim, marginBottom: 10 }}>Product</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FooterLink onClick={() => setTab("markets")}>Markets</FooterLink>
              <FooterLink onClick={() => setTab("dashboard")}>Dashboard</FooterLink>
              <FooterLink onClick={() => setTab("overview")}>Overview</FooterLink>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: C.fogDim, marginBottom: 10 }}>Network</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: C.fog }}>
              <span>Robinhood Chain</span>
              <span>Chain ID 4663</span>
              <span>Arbitrum Orbit L2</span>
            </div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 18, fontSize: 11, color: C.fogDim, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>Parapet is an independent app built on Robinhood Chain. Not affiliated with or endorsed by Robinhood Markets, Inc.</span>
          <span>Simulated preview — no funds move</span>
        </div>
      </div>
    </div>
  );
}

function FooterLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: C.fog, fontSize: 13, textAlign: "left", cursor: "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
function Markets({ onOpenModal, connected, onConnect }: { onOpenModal: (modal: ModalState) => void; connected: boolean; onConnect: () => void }) {
  return (
    <div style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 className="serif" style={{ fontSize: 28, fontWeight: 600, margin: "0 0 6px" }}>Markets</h1>
      <p style={{ fontSize: 14, color: C.fog, margin: "0 0 28px" }}>Supply to earn yield, or post as collateral to borrow USDG.</p>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 1fr 1fr 0.9fr 0.9fr 1fr", padding: "10px 18px", fontSize: 11.5, color: C.fogDim, borderBottom: `1px solid ${C.line}` }}>
          <div>Asset</div>
          <div>Price</div>
          <div>Supply APY</div>
          <div>Borrow APY</div>
          <div>Max LTV</div>
          <div>Total supplied</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>
        {ASSETS.map((a, i) => (
          <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 1fr 1fr 0.9fr 0.9fr 1fr", alignItems: "center", padding: "14px 18px", fontSize: 13, borderTop: i > 0 ? `1px solid ${C.line}` : "none", background: C.panel }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.accent }} />
              <span className="num" style={{ fontWeight: 600 }}>{a.ticker}</span>
              <span style={{ color: C.fogDim, fontSize: 12 }}>{a.name}</span>
            </div>
            <div className="num" style={{ color: C.fog }}>{fmtPrice(a.price)}</div>
            <div className="num" style={{ color: C.brand }}>{pct(a.supplyAPY, 2)}</div>
            <div className="num" style={{ color: C.fog }}>{pct(a.borrowAPY, 2)}</div>
            <div className="num" style={{ color: C.fog }}>{a.maxLTV > 0 ? pct(a.maxLTV, 0) : "—"}</div>
            <div className="num" style={{ color: C.fog }}>{fmtUSD(a.totalSupplied)}</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button onClick={() => (connected ? onOpenModal({ mode: "supply", assetId: a.id }) : onConnect())} style={{ fontSize: 12, padding: "6px 11px", borderRadius: 6, border: `1px solid ${C.line2}`, background: "transparent", color: C.chalk, cursor: "pointer" }}>Supply</button>
              {a.isStable && (
                <button onClick={() => (connected ? onOpenModal({ mode: "borrow", assetId: a.id }) : onConnect())} style={{ fontSize: 12, padding: "6px 11px", borderRadius: 6, border: `1px solid ${C.line2}`, background: "transparent", color: C.chalk, cursor: "pointer" }}>Borrow</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Dashboard({ supplies, borrows, position, activity, connected, onConnect, onOpenModal }: { supplies: Balances; borrows: Balances; position: Position; activity: ActivityEntry[]; connected: boolean; onConnect: () => void; onOpenModal: (modal: ModalState) => void }) {
  if (!connected) {
    return (
      <div style={{ paddingTop: 80, paddingBottom: 80, textAlign: "center" }}>
        <p style={{ color: C.fog, fontSize: 14, marginBottom: 16 }}>Connect a wallet to view your positions.</p>
        <button onClick={onConnect} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.brand, color: "#000", border: "none", borderRadius: 8, padding: "11px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
          <Wallet size={14} /> Connect wallet
        </button>
      </div>
    );
  }

  const hf = position.healthFactor;
  const hfColor = riskColor(hf);
  const suppliedList = Object.entries(supplies).filter(([, v]) => v > 0);
  const borrowedList = Object.entries(borrows).filter(([, v]) => v > 0);
  const empty = suppliedList.length === 0 && borrowedList.length === 0;

  return (
    <div style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 className="serif" style={{ fontSize: 28, fontWeight: 600, margin: "0 0 24px" }}>Your dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Stat label="Net worth" value={fmtUSD(position.netWorth, 2)} />
          <Stat label="Net APY" value={`${position.netAPY >= 0 ? "+" : ""}${pct(position.netAPY, 2)}`} color={position.netAPY >= 0 ? C.brand : C.red} />
          <Stat label="Total supplied" value={fmtUSD(position.suppliedValue, 2)} />
          <Stat label="Total borrowed" value={fmtUSD(position.borrowedValue, 2)} />
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: C.fogDim }}>Health factor</span>
            {hf < 1.3 && hf !== Infinity && <AlertTriangle size={13} color={hfColor} />}
          </div>
          <div className="num serif" style={{ fontSize: 30, fontWeight: 600, color: hfColor, marginBottom: 10 }}>
            {hf === Infinity ? "—" : hf.toFixed(2)}
          </div>
          <HealthBar hf={hf} />
          <div style={{ fontSize: 11, color: C.fogDim, marginTop: 10, lineHeight: 1.5 }}>
            {hf === Infinity ? "No active borrows. Health factor applies once you borrow against collateral." : hf < 1.1 ? "Below 1.0 triggers liquidation. Repay or add collateral now." : "Liquidation risk rises as this approaches 1.0."}
          </div>
        </div>
      </div>

      {empty ? (
        <div style={{ border: `1px dashed ${C.line2}`, borderRadius: 12, padding: "36px 20px", textAlign: "center", color: C.fog, fontSize: 13.5, marginBottom: 32 }}>
          No positions yet. Head to Markets to supply collateral or borrow USDG.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 32 }}>
          <PositionPanel title="Your supplies" items={suppliedList} mode="supply" onOpenModal={onOpenModal} />
          <PositionPanel title="Your borrows" items={borrowedList} mode="borrow" onOpenModal={onOpenModal} />
        </div>
      )}

      {activity.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: C.fogDim, marginBottom: 10 }}>Activity</div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
            {activity.map((e, i) => (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr 1.2fr", alignItems: "center", padding: "11px 18px", fontSize: 12.5, borderTop: i > 0 ? `1px solid ${C.line}` : "none", background: C.panel }}>
                <div style={{ color: e.mode === "supply" ? C.brand : C.amber, textTransform: "capitalize" }}>{e.mode}</div>
                <div className="num">{e.amount.toFixed(4)} {e.ticker}</div>
                <div className="num" style={{ color: C.fog }}>{fmtUSD(e.valueUSD, 2)}</div>
                <div className="num" style={{ color: C.fogDim, textAlign: "right" }}>{e.hash}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionPanel({ title, items, mode, onOpenModal }: { title: string; items: [string, number][]; mode: ActionMode; onOpenModal: (modal: ModalState) => void }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.fogDim, marginBottom: 10 }}>{title}</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {items.length === 0 ? (
          <div style={{ padding: "16px 18px", fontSize: 12.5, color: C.fogDim, background: C.panel }}>None yet</div>
        ) : (
          items.map(([id, amt], i) => {
            const a = byId[id];
            return (
              <div key={id} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 0.8fr", alignItems: "center", padding: "12px 16px", fontSize: 13, borderTop: i > 0 ? `1px solid ${C.line}` : "none", background: C.panel }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.accent }} />
                  <span className="num" style={{ fontWeight: 600 }}>{a.ticker}</span>
                </div>
                <div className="num" style={{ color: C.fog }}>{amt.toFixed(4)}</div>
                <button onClick={() => onOpenModal({ mode, assetId: id })} style={{ fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: `1px solid ${C.line2}`, background: "transparent", color: C.chalk, cursor: "pointer", justifySelf: "end" }}>Add</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function HealthBar({ hf }: { hf: number }) {
  const clamped = hf === Infinity ? 3 : Math.min(hf, 3);
  const widthPct = (clamped / 3) * 100;
  return (
    <div style={{ height: 6, borderRadius: 3, background: C.line, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: `${(1 / 3) * 100}%`, top: 0, bottom: 0, width: 1, background: C.line2 }} />
      <div style={{ width: `${widthPct}%`, height: "100%", background: riskColor(hf), borderRadius: 3 }} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: C.fogDim, marginBottom: 6 }}>{label}</div>
      <div className="num serif" style={{ fontSize: 19, fontWeight: 600, color: color || C.chalk }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ActionModal({ asset, mode, position, supplies, borrows, onClose, onConfirm }: { asset: Asset; mode: ActionMode; position: Position; supplies: Balances; borrows: Balances; onClose: () => void; onConfirm: (amount: number) => void }) {
  const [amount, setAmount] = useState("");
  const numAmount = Number(amount) || 0;
  const valueUSD = numAmount * asset.price;

  const walletBalance = useMemo(() => 5 + (asset.id.charCodeAt(0) % 20), [asset.id]);
  const availableToBorrow = position.borrowLimit > 0 ? Math.max(0, position.borrowLimit - position.borrowedValue) : 0;

  let previewSupplies = supplies;
  let previewBorrows = borrows;
  if (mode === "supply") {
    previewSupplies = { ...supplies, [asset.id]: (supplies[asset.id] || 0) + numAmount };
  } else {
    previewBorrows = { ...borrows, [asset.id]: (borrows[asset.id] || 0) + numAmount };
  }
  const preview = useMemo(() => computePosition(previewSupplies, previewBorrows), [previewSupplies, previewBorrows]);

  const overBalance = mode === "supply" && numAmount > walletBalance;
  const overBorrow = mode === "borrow" && valueUSD > availableToBorrow;
  const unsafe = mode === "borrow" && preview.healthFactor !== Infinity && preview.healthFactor < 1.05;
  const disabled = numAmount <= 0 || overBalance || overBorrow || unsafe;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }} onClick={onClose}>
      <div style={{ background: C.panelRaised, border: `1px solid ${C.line2}`, borderRadius: 14, width: 380, maxWidth: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: asset.accent }} />
            <span className="serif" style={{ fontSize: 17, fontWeight: 600, textTransform: "capitalize" }}>{mode} {asset.ticker}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.fog, cursor: "pointer", padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ display: "flex", alignItems: "center", background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
          <input type="number" min={0} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" style={{ background: "none", border: "none", outline: "none", color: C.chalk, fontSize: 17, width: "100%" }} />
          <span className="num" style={{ color: C.fogDim, fontSize: 13 }}>{asset.ticker}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.fogDim, marginBottom: 18 }}>
          <span className="num">{fmtUSD(valueUSD, 2)}</span>
          <span>
            {mode === "supply" ? (<>Wallet: <span className="num">{walletBalance.toFixed(4)}</span></>) : (<>Available: <span className="num">{fmtUSD(availableToBorrow, 2)}</span></>)}
          </span>
        </div>

        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          <Row label={mode === "supply" ? "Supply APY" : "Borrow APY"} value={pct(mode === "supply" ? asset.supplyAPY : asset.borrowAPY, 2)} />
          <Row label="Health factor" value={preview.healthFactor === Infinity ? "—" : preview.healthFactor.toFixed(2)} color={riskColor(preview.healthFactor)} />
        </div>

        {(overBalance || overBorrow || unsafe) && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "rgba(255,92,92,0.1)", border: `1px solid rgba(255,92,92,0.3)`, borderRadius: 8, padding: "9px 11px", marginBottom: 14, fontSize: 12, color: C.red }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {overBalance && "Amount exceeds your wallet balance."}
              {overBorrow && "Amount exceeds what your collateral can borrow."}
              {unsafe && !overBorrow && "This would push your health factor too close to liquidation."}
            </span>
          </div>
        )}

        <button onClick={() => onConfirm(numAmount)} disabled={disabled} style={{ width: "100%", background: disabled ? C.line2 : C.brand, color: disabled ? C.fogDim : "#000", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", textTransform: "capitalize" }}>
          {mode === "supply" ? "Supply" : "Borrow"} {asset.ticker}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
      <span style={{ color: C.fog }}>{label}</span>
      <span className="num" style={{ color: color || C.chalk, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
