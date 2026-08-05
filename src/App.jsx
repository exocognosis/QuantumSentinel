import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileDown,
  FileText,
  Globe2,
  KeyRound,
  Laptop,
  Network,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from "lucide-react";
import { loadApplianceData } from "./api.js";
import { createProbeJob, loadProbeJobs } from "./probeApi.js";
import { deriveQuantumScores } from "./quantumScores.js";
import "./dashboard.css";
import "./scan-options.css";

const NAV = [
  ["Overview", BarChart3],
  ["Quantum Context", CircleHelp],
  ["Q-Day Readiness", ShieldCheck],
  ["Scan", Target],
  ["Exposure", ShieldAlert],
  ["Remediation", Wrench],
  ["Reports", FileText],
];

const FALLBACK_SCANS = [
  {
    id: "example",
    targetLabel: "example.com",
    type: "tls",
    status: "COMPLETED",
    riskScore: 79,
    completedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
  {
    id: "quantumlink",
    targetLabel: "api.quantumlink.dev",
    type: "tls",
    status: "COMPLETED",
    riskScore: 61,
    completedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "local",
    targetLabel: "Local machine",
    type: "local",
    status: "COMPLETED",
    riskScore: 88,
    completedAt: new Date(Date.now() - 172_800_000).toISOString(),
  },
];

const QDAY_SCENARIOS = {
  ionq: {
    label: "IonQ 2029",
    date: "2029-01-01",
    note: "Illustrative industry roadmap threshold",
  },
  conservative: {
    label: "Conservative 2032",
    date: "2032-01-01",
    note: "Longer-horizon planning scenario",
  },
  accelerated: {
    label: "Accelerated 2028",
    date: "2028-01-01",
    note: "Stress-test scenario for earlier capability",
  },
};

const EMPTY_PROFILE = {
  name: "",
  industry: "",
  geography: "",
  size: "",
  dataAssets: [],
  regimes: [],
};
function savedProfile() {
  try {
    return (
      JSON.parse(localStorage.getItem("quantumSentinel.organizationProfile")) ||
      EMPTY_PROFILE
    );
  } catch {
    return EMPTY_PROFILE;
  }
}

function daysUntil(date) {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(
    0,
    Math.ceil((target.getTime() - today.getTime()) / 86_400_000),
  );
}

function formatHorizon(days) {
  if (days < 365) return { primary: days.toLocaleString(), secondary: days === 1 ? "day" : "days" };
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  return {
    primary: `${years} ${years === 1 ? "year" : "years"}`,
    secondary: `${remainingDays.toLocaleString()} ${remainingDays === 1 ? "day" : "days"}`,
  };
}

function timeAgo(value) {
  if (!value) return "recently";
  const mins = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Shield />
      </span>
      <span>
        Quantum<b>Sentinel</b>
      </span>
    </div>
  );
}

function Header({ active, setActive, openProfile }) {
  return (
    <header className="app-header">
      <Brand />
      <nav aria-label="Primary navigation">
        {NAV.map(([label, Icon]) => (
          <button
            key={label}
            className={active === label ? "active" : ""}
            onClick={() => setActive(label)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      <div className="header-tools">
        <span className="live">
          <i />
          System live
        </span>
        <button className="icon-button" aria-label="Notifications">
          <Bell />
        </button>
        <button
          className="avatar"
          onClick={openProfile}
          aria-label="Open organization profile"
        >
          RG
        </button>
        <ChevronDown className="chevron" />
      </div>
    </header>
  );
}

function PageTitle({ title, subtitle, children }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children && <div className="title-actions">{children}</div>}
    </div>
  );
}

function ScoreRing({ score = 42, label = "Readiness" }) {
  const ringColor =
    score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div
      className="score-ring"
      style={{ "--score": `${score * 3.6}deg`, "--ring-color": ringColor }}
    >
      <div>
        <strong>{score}</strong>
        <span>/ 100</span>
        <small>{label}</small>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, value, label, tone = "blue", trend }) {
  const trendClass = trend?.startsWith("+")
    ? "positive"
    : trend?.startsWith("-")
      ? "negative"
      : "neutral";
  return (
    <article className="metric-card">
      <span className={`metric-icon ${tone}`}>
        <Icon />
      </span>
      <strong>{value}</strong>
      <h3>{label}</h3>
      {trend && <p className={trendClass}>{trend}</p>}
    </article>
  );
}

const REGULATORY_REGIMES = {
  "United States": {
    default: ["NIST CSF 2.0", "NIST IR 8547"],
    Finance: ["GLBA", "NYDFS 23 NYCRR 500", "PCI DSS 4.0"],
    Healthcare: ["HIPAA Security Rule", "HITRUST CSF"],
    Energy: ["NERC CIP"],
    Defense: ["CMMC 2.0", "DFARS 252.204-7012"],
  },
  "European Union": {
    default: ["GDPR", "NIS2"],
    Finance: ["DORA"],
    Healthcare: ["EHDS", "MDR"],
    Energy: ["NIS2 Critical Entities"],
    Defense: ["EU classified information rules"],
  },
  "United Kingdom": {
    default: ["UK GDPR", "NIS Regulations"],
    Finance: ["FCA Operational Resilience"],
    Healthcare: ["NHS DSP Toolkit"],
    Energy: ["NIS Regulations"],
    Defense: ["Defence Cyber Protection Partnership"],
  },
  Canada: {
    default: ["PIPEDA"],
    Finance: ["OSFI B-13"],
    Healthcare: ["Provincial health privacy laws"],
    Energy: ["NERC CIP where applicable"],
    Defense: ["Controlled Goods Program"],
  },
};

function OrganizationProfile({ initialProfile, onSave, onClose }) {
  const [profile, setProfile] = useState(initialProfile);
  const regimes = [
    ...(REGULATORY_REGIMES[profile.geography]?.default || []),
    ...(REGULATORY_REGIMES[profile.geography]?.[profile.industry] || []),
  ];
  const assets = [
    "PII",
    "PHI",
    "Financial records",
    "Intellectual property",
    "Government data",
    "Customer data",
  ];
  const update = (key, value) =>
    setProfile((current) => ({ ...current, [key]: value }));
  const toggleAsset = (asset) =>
    update(
      "dataAssets",
      profile.dataAssets.includes(asset)
        ? profile.dataAssets.filter((item) => item !== asset)
        : [...profile.dataAssets, asset],
    );
  return (
    <aside className="onboarding-panel" aria-labelledby="profile-title">
      <div className="onboarding-heading">
        <div>
          <span className="eyebrow">Organization onboarding</span>
          <h1 id="profile-title">Build your readiness baseline</h1>
          <p>
            Your profile tailors regulatory context, evidence priorities, and
            the Quantum Readiness Score.
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close profile"
        >
          ×
        </button>
      </div>
      <div className="profile-grid">
        <div className="profile-form">
          <label>
            Organization name
            <input
              value={profile.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Acme Corporation"
            />
          </label>
          <div className="field-pair">
            <label>
              Industry
              <select
                value={profile.industry}
                onChange={(event) => update("industry", event.target.value)}
              >
                <option value="">Select industry</option>
                {[
                  "Finance",
                  "Healthcare",
                  "Energy",
                  "Defense",
                  "Technology",
                  "Government",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Primary geography
              <select
                value={profile.geography}
                onChange={(event) => update("geography", event.target.value)}
              >
                <option value="">Select geography</option>
                {Object.keys(REGULATORY_REGIMES).map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Organization size
            <select
              value={profile.size}
              onChange={(event) => update("size", event.target.value)}
            >
              <option value="">Select size</option>
              <option>1–249 employees</option>
              <option>250–999 employees</option>
              <option>1,000–9,999 employees</option>
              <option>10,000+ employees</option>
            </select>
          </label>
          <fieldset>
            <legend>Data and digital assets</legend>
            <div className="profile-checks">
              {assets.map((asset) => (
                <label key={asset}>
                  <input
                    type="checkbox"
                    checked={profile.dataAssets.includes(asset)}
                    onChange={() => toggleAsset(asset)}
                  />
                  <span>{asset}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <aside className="regime-card">
          <span className="metric-icon blue">
            <ShieldCheck />
          </span>
          <h2>Regulatory context</h2>
          <p>Suggested from your primary geography and industry.</p>
          {regimes.length ? (
            <div className="regime-list">
              {regimes.map((regime) => (
                <span key={regime}>
                  <Check />
                  {regime}
                </span>
              ))}
            </div>
          ) : (
            <div className="regime-empty">
              Select a geography and industry to see likely regimes.
            </div>
          )}
          <small>
            Guidance only. Applicability depends on operations, customers,
            contracts, and legal interpretation.
          </small>
        </aside>
      </div>
      <div className="onboarding-actions">
        <button className="secondary" onClick={onClose}>
          Finish later
        </button>
        <button
          className="primary"
          disabled={!profile.name || !profile.industry || !profile.geography}
          onClick={() => onSave({ ...profile, regimes })}
        >
          <Check />
          Save organization profile
        </button>
      </div>
    </aside>
  );
}

function ReadinessDrivers({ scores, setActive }) {
  const components = scores.readiness.components;
  const drivers = [
    ["Crypto modernization", components.cryptoModernization, 35],
    ["Inventory coverage", components.inventoryCoverage, 20],
    ["Migration planning", components.migrationPlanning, 20],
    ["Governance maturity", components.governanceMaturity, 15],
    ["Compensating controls", components.compensatingControls, 10],
  ];
  return (
    <article className="card trend-card readiness-drivers">
      <div className="card-heading">
        <span>
          <Activity />
          What drives your {scores.readiness.score} readiness score?
        </span>
        <button
          className="text-link"
          onClick={() => setActive("Q-Day Readiness")}
        >
          View calculation <ChevronRight />
        </button>
      </div>
      <p>
        Every bar is an observed input to the single Quantum Readiness Score.
        The percentage at right is that input’s weight.
      </p>
      <div className="driver-list">
        {drivers.map(([label, value, weight]) => (
          <div className="driver-row" key={label}>
            <span>{label}</span>
            <div>
              <i style={{ width: `${Math.max(2, value)}%` }} />
            </div>
            <strong>{Math.round(value)}%</strong>
            <small>{weight}% weight</small>
          </div>
        ))}
      </div>
    </article>
  );
}

const QUANTUM_CONTEXT = [
  {
    term: "Q-Day",
    icon: CalendarClock,
    summary: "The capability threshold at which a quantum computer could break widely used public-key cryptography.",
    detail: "It is not a scheduled date like Y2K. Forecasts move as hardware, error correction, algorithms, and resources change. Use scenarios for awareness, but set an earlier organizational readiness deadline you control.",
  },
  {
    term: "CRQC",
    icon: Sparkles,
    summary: "A cryptographically relevant quantum computer capable of attacking deployed cryptographic systems.",
    detail: "A CRQC would need enough reliable, error-corrected quantum capability to run attacks such as Shor’s algorithm at a useful scale. Today's quantum computers do not meet that threshold.",
  },
  {
    term: "Quantum exposure",
    icon: ShieldAlert,
    summary: "Reliance on cryptography that may become vulnerable to a sufficiently capable quantum computer.",
    detail: "Exposure is not the same as a confirmed breach. It describes where vulnerable algorithms, long-lived data, critical systems, incomplete inventory, or weak migration planning create future risk.",
  },
  {
    term: "HNDL",
    icon: Clock3,
    summary: "Harvest now, decrypt later: stealing encrypted data today in hopes of decrypting it in the future.",
    detail: "HNDL matters now when sensitive information must remain confidential for years. Migration after Q-Day cannot protect ciphertext that an adversary has already collected.",
  },
  {
    term: "PQC",
    icon: ShieldCheck,
    summary: "Post-quantum cryptography designed to resist attacks by classical and quantum computers.",
    detail: "PQC migration means more than swapping one algorithm. Organizations must inventory cryptography, test interoperability and performance, update trust chains, deploy safely, and retain evidence.",
  },
  {
    term: "Crypto-agility",
    icon: RefreshCw,
    summary: "The ability to discover, replace, and govern cryptography without disruptive system redesign.",
    detail: "A crypto-agile organization knows where cryptography is used, who owns it, which dependencies constrain it, and how to migrate or roll back algorithms as standards and threats evolve.",
  },
  {
    term: "Shor’s algorithm",
    icon: KeyRound,
    summary: "A quantum algorithm that threatens RSA, Diffie–Hellman, and elliptic-curve cryptography.",
    detail: "At sufficient scale, Shor’s algorithm could solve the mathematical problems protecting common public-key encryption, key agreement, and digital signatures. This is the primary driver for migration to standardized PQC.",
  },
  {
    term: "Grover’s algorithm",
    icon: Search,
    summary: "A quantum search algorithm that reduces the effective security margin of symmetric cryptography and hashes.",
    detail: "Grover’s algorithm does not break symmetric cryptography in the same way Shor’s attacks public-key systems. Larger symmetric keys and appropriate hash sizes can preserve an adequate security margin.",
  },
  {
    term: "TNFL",
    icon: FileText,
    summary: "Trust now, forge later: retaining signed artifacts to exploit after signature protections weaken.",
    detail: "TNFL concerns long-lived trust in software, certificates, records, identities, and other signed artifacts. QuantumSentinel prioritizes signature and trust exposure from observed asset role, protocol, algorithm, certificate, and migration evidence; missing signing evidence remains an assessment gap.",
  },
];

function QuantumContext() {
  const [openTerm, setOpenTerm] = useState("Q-Day");
  return <><PageTitle title="Quantum introduction & context" subtitle="The concepts behind Q-Day readiness, explained without the hype."/><section className="content-grid"><article className="card quantum-context"><div className="context-intro"><span className="metric-icon blue"><Sparkles /></span><div><span className="eyebrow">Quantum fundamentals</span><h2>What QuantumSentinel is measuring</h2><p>QuantumSentinel measures evidence of organizational readiness and cryptographic exposure. It does not predict an exact Q-Day or claim that an observed endpoint represents an entire organization.</p></div></div><div className="context-terms">{QUANTUM_CONTEXT.map(item => { const ContextIcon=item.icon; return <div className={`context-term ${openTerm===item.term?"open":""}`} key={item.term}><button onClick={() => setOpenTerm(current => current===item.term?"":item.term)} aria-expanded={openTerm===item.term}><span className="context-term-copy"><i><ContextIcon /></i><span><b>{item.term}</b><small>{item.summary}</small></span></span><ChevronDown /></button>{openTerm===item.term&&<p>{item.detail}</p>}</div>; })}</div><div className="context-boundary"><ShieldCheck /><p><b>The practical goal:</b> establish what must remain protected, locate the cryptography supporting it, prioritize migration, and produce evidence that the transition is complete.</p></div></article></section></>;
}

function Overview({ data, scores, scans, setActive, openProfile }) {
  const [scenario, setScenario] = useState("ionq");
  const summary = data?.summary || {};
  const total = summary.totalAssets || 15;
  const critical = summary.criticalCount || 8;
  const safe = summary.safeCount || 2;
  const readiness = scores.readiness;
  const horizon = QDAY_SCENARIOS[scenario];
  const horizonDisplay = formatHorizon(daysUntil(horizon.date));
  return (
    <>
      <PageTitle
        title="Good morning, Rick"
        subtitle="Your cryptographic exposure, distilled."
      >
        <button className="secondary" onClick={openProfile}>
          <Building2 />
          Organization profile
        </button>
        <button className="primary" onClick={() => setActive("Scan")}>
          <Play />
          Run a scan
        </button>
        <button className="secondary" onClick={() => setActive("Reports")}>
          <FileText />
          View report
        </button>
      </PageTitle>
      <section className="overview-grid">
        <article className="card readiness-summary">
          <div className="card-heading">
            <span>
              <ShieldCheck />
              Q-Day Readiness
            </span>
            <CircleHelp />
          </div>
          <div className="readiness-content">
            <ScoreRing score={readiness.score} />
            <div>
              <h2
                className={
                  readiness.score >= 70
                    ? "good"
                    : readiness.score >= 50
                      ? "warn"
                      : "bad"
                }
              >
                {readiness.classification}
              </h2>
              <p>
                {critical} critical systems still depend on quantum-vulnerable
                cryptography.
              </p>
              <span className="direction better">↑ {readiness.direction}</span>
            </div>
          </div>
          <button
            className="text-link"
            onClick={() => setActive("Q-Day Readiness")}
          >
            How this score works <ChevronRight />
          </button>
        </article>
        <article className="card horizon">
          <div className="card-heading">
            <span>
              <CalendarClock />
              Q-Day horizon
            </span>
            <button className="info-tip" aria-label="About the Q-Day horizon">
              <CircleHelp />
              <span className="tooltip">
                <b>Q-Day is a moving threshold—not a date like Y2K.</b> These
                scenarios are planning assumptions. Your organization should set
                an earlier readiness deadline based on data lifetime, migration
                complexity, and risk tolerance.
              </span>
            </button>
          </div>
          <strong className={daysUntil(horizon.date) >= 365 ? "long-horizon" : ""}>{horizonDisplay.primary}</strong>
          <h2>{horizonDisplay.secondary}</h2>
          <p className="horizon-date">
            Scenario threshold ·{" "}
            {new Date(`${horizon.date}T00:00:00`).toLocaleDateString(
              undefined,
              { month: "short", day: "numeric", year: "numeric" },
            )}
          </p>
          <label>
            External scenario
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              <option value="ionq">IonQ 2029</option>
              <option value="conservative">Conservative 2032</option>
              <option value="accelerated">Accelerated 2028</option>
            </select>
            <small>{horizon.note}</small>
          </label>
        </article>
        <Metric
          icon={ShieldAlert}
          value={critical}
          label="critical exposures"
          tone="red"
          trend="Requires action"
        />
        <Metric
          icon={Building2}
          value={total}
          label="observed assets"
          tone="blue"
          trend="Evidence inventory"
        />
        <Metric
          icon={ShieldCheck}
          value={`${safe} of ${total}`}
          label="quantum-safe assets"
          tone="green"
          trend={`${total - safe} still need modernization`}
        />
        <ReadinessDrivers scores={scores} setActive={setActive} />
        <article className="card priorities">
          <div className="card-heading">
            <span>
              <Target />
              Top priorities
            </span>
            <button
              className="text-link"
              onClick={() => setActive("Remediation")}
            >
              View all <ChevronRight />
            </button>
          </div>
          {[
            ["api-gateway-prod-01", "RSA-2048", "Alex R.", "May 28"],
            ["vpn-concentrator-01", "ECDH P-256", "Maya K.", "May 30"],
            ["ca-root-internal", "RSA-4096", "Chris D.", "Jun 2"],
          ].map((r, i) => (
            <div className="priority-row" key={r[0]}>
              <span className="severity">Critical</span>
              <div>
                <b>{r[0]}</b>
                <small>{r[1]}</small>
              </div>
              <span className={`mini-avatar a${i}`}>{r[2][0]}</span>
              <span>{r[2]}</span>
              <span>
                <Clock3 />
                {r[3]}
              </span>
              <button>Open plan</button>
            </div>
          ))}
        </article>
        <button className="latest-scan" onClick={() => setActive("Exposure")}>
          <Globe2 />
          <span>
            <small>Latest scan evidence</small>
            <b>{scans[0]?.targetLabel || "example.com"}</b> —{" "}
            <strong>Evidence saved</strong> — {timeAgo(scans[0]?.completedAt)}
          </span>
          <ChevronRight />
        </button>
      </section>
    </>
  );
}

function Scan({ scans, setScans, setActive }) {
  const [mode, setMode] = useState("public");
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [resultNote, setResultNote] = useState("");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [port, setPort] = useState(443);
  const [timeoutMs, setTimeoutMs] = useState(2500);
  const [targetLimit, setTargetLimit] = useState(12);
  const [deviceScope, setDeviceScope] = useState("both");
  const [devicePorts, setDevicePorts] = useState("443, 8443, 3000");
  const [networkPorts, setNetworkPorts] = useState("443, 8443");
  const [concurrency, setConcurrency] = useState(4);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setProgress((p) => Math.min(p + 7, 92)),
      450,
    );
    return () => clearInterval(timer);
  }, [running]);
  async function startScan() {
    setError("");
    setResultNote("");
    setCompleted(false);
    setFailed(false);
    setLastResult(null);
    setRunning(true);
    setProgress(12);
    try {
      let request;
      const boundedPort = Math.max(1, Math.min(65535, Number(port) || 443));
      const boundedTimeout = Math.max(
        250,
        Math.min(mode === "public" ? 10000 : 5000, Number(timeoutMs) || 2500),
      );
      if (mode === "public")
        request = {
          mode: "tls",
          host: target.replace(/^https?:\/\//, "").split("/")[0],
          port: boundedPort,
          timeoutMs: boundedTimeout,
        };
      else if (mode === "device")
        request = {
          mode: "device",
          scope: deviceScope,
          ports: devicePorts
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map(Number)
            .slice(0, 8),
          timeoutMs: boundedTimeout,
        };
      else
        request = {
          mode: "discovery",
          hosts: target
            .split(/[\s,;]+/)
            .filter(Boolean)
            .slice(0, Math.max(1, Math.min(16, Number(targetLimit) || 12))),
          ports: networkPorts
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map(Number)
            .slice(0, 8),
          concurrency: Math.max(1, Math.min(8, Number(concurrency) || 4)),
          timeoutMs: boundedTimeout,
        };
      const job = await createProbeJob(request);
      if (job.status === "FAILED" || !job.result) {
        const reason =
          job.error || "The target did not return usable TLS evidence.";
        setError(`Scan failed — no evidence collected. ${reason}`);
        setResultNote("No evidence collected.");
        setProgress(0);
        setFailed(true);
        setRunning(false);
        return;
      }
      const noReachableService =
        ["discovery", "device"].includes(job.type) &&
        job.result?.summary?.completedCount === 0;
      if (noReachableService) {
        setError(
          `Scan completed, but no TLS service was detected on port ${boundedPort}. No cryptographic evidence was collected.`,
        );
        setResultNote("No cryptographic evidence collected.");
        setProgress(0);
        setFailed(true);
        setRunning(false);
        return;
      }
      const observedScore =
        noReachableService || !Number.isFinite(job.riskScore) || job.riskScore <= 0
          ? null
          : job.riskScore;
      setResultNote("Scan completed and evidence saved.");
      setLastResult({
        ...job.result,
        _riskScore: observedScore,
        _targetLabel: job.targetLabel || target,
      });
      setScans((prev) => [
        {
          ...job,
          targetLabel: job.targetLabel || target,
          riskScore: observedScore,
          completedAt: job.completedAt || new Date().toISOString(),
          status: job.status === "QUEUED" ? "RUNNING" : job.status,
        },
        ...prev.filter((s) => s.id !== job.id),
      ]);
      setTimeout(() => {
        setProgress(100);
        setCompleted(true);
        setRunning(false);
      }, 650);
    } catch (e) {
      setError(
        `Scan failed — no evidence collected. ${e.message || "The scan could not start."}`,
      );
      setProgress(0);
      setFailed(true);
      setRunning(false);
    }
  }
  const modes = [
    ["public", Globe2, "Public website"],
    ["device", Laptop, "This device"],
    ["network", Network, "Authorized network"],
  ];
  const modeConfig = {
    public: {
      title: "Public TLS posture scan",
      subtitle:
        "Observe the cryptography presented by one public TLS endpoint.",
      steps: [
        "Connect to TLS endpoint",
        "Inspect presented certificate",
        "Classify observed cryptography",
        "Record evidence & limitations",
      ],
      scope:
        "The TLS version, cipher, forward-secrecy signal, and leaf certificate presented by one public endpoint. It does not inspect internal systems or determine organization-wide readiness.",
      observations: [
        [
          KeyRound,
          "TLS negotiation",
          "Negotiated TLS version, cipher, and forward-secrecy signal.",
        ],
        [
          FileText,
          "Presented certificate",
          "Leaf certificate issuer, algorithm, key size, expiry, and fingerprint.",
        ],
        [
          Sparkles,
          "Cryptographic posture",
          "Observed RSA, ECC, hybrid, or post-quantum evidence.",
        ],
        [
          Clock3,
          "Exposure signal",
          "Public-key evidence relevant to harvest-now-decrypt-later exposure.",
        ],
      ],
    },
    device: {
      title: "Local TLS service check",
      subtitle:
        "Test the selected service port on this machine’s loopback addresses.",
      steps: [
        "Probe local loopback addresses",
        "Test selected TCP port",
        "Attempt TLS where reachable",
        "Record local service evidence",
      ],
      scope:
        "Whether localhost and 127.0.0.1 accept TCP or TLS on the selected port, plus TLS evidence when available. It does not inspect files, installed software, keys, packages, or operating-system cryptography.",
      observations: [
        [Laptop, "Loopback targets", "Tests localhost and 127.0.0.1 only."],
        [
          Network,
          "Port reachability",
          "Records whether the selected TCP port accepts a connection.",
        ],
        [
          KeyRound,
          "Local TLS service",
          "Attempts TLS and reads presented cryptography when available.",
        ],
        [
          CircleHelp,
          "Bounded evidence",
          "Does not inventory device files, applications, keys, or every port.",
        ],
      ],
    },
    network: {
      title: "Authorized network TLS discovery",
      subtitle:
        "Test an explicit list of authorized hosts on one selected service port.",
      steps: [
        "Validate authorized target list",
        "Test TCP reachability",
        "Attempt TLS on reachable hosts",
        "Summarize per-host evidence",
      ],
      scope:
        "TCP reachability and available TLS evidence for the listed hosts on one selected port, up to 16 targets. It does not discover unknown devices, sweep port ranges, or inspect services beyond that scope.",
      observations: [
        [
          Network,
          "Authorized hosts",
          "Tests only the hostnames or IP addresses explicitly entered.",
        ],
        [
          Activity,
          "TCP reachability",
          "Records reachable and unreachable targets on the selected port.",
        ],
        [
          KeyRound,
          "TLS availability",
          "Attempts TLS and captures endpoint cryptography where supported.",
        ],
        [
          FileText,
          "Per-host summary",
          "Separates TLS evidence, TCP-only observations, and failures.",
        ],
      ],
    },
  };
  const currentMode = modeConfig[mode];
  const scanSteps = currentMode.steps;
  const observedProtocol = lastResult?.protocol?.name;
  const observedAlgorithm = lastResult?.certificate?.algorithm;
  const observedPfs = lastResult?.protocol?.perfectForwardSecrecy;
  const ModeIcon =
    mode === "public" ? Globe2 : mode === "device" ? Laptop : Network;
  const discoverySummary = lastResult?.summary;
  const resultClassification = lastResult?.classification;
  const resultFindings = lastResult?.findings || [];
  const completedSummary =
    mode === "public"
      ? [
          observedProtocol,
          observedAlgorithm,
          observedPfs === true
            ? "forward secrecy observed"
            : observedPfs === false
              ? "forward secrecy not observed"
              : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : discoverySummary
        ? `${discoverySummary.completedCount} of ${discoverySummary.targetsScanned} targets returned service evidence · ${discoverySummary.failedCount} unreachable`
        : "Bounded service evidence recorded";
  const idleMeaning =
    mode === "public"
      ? [
          "This is the outside-in starting point",
          "A public TLS scan shows what one internet-facing endpoint presents. It cannot see internal PKI, VPNs, databases, code signing, stored data, or migration governance.",
        ]
      : mode === "device"
        ? [
            "This is a bounded loopback service check",
            "It tests two local names on one port. It does not inventory applications, cryptographic libraries, stored keys, files, or other device ports.",
          ]
        : [
            "This is a bounded host-and-port discovery",
            "It tests only the entered hosts on one port. It does not discover unknown devices, sweep networks, or inspect every service.",
          ];
  const selectMode = (id) => {
    setMode(id);
    setTarget(
      id === "public"
        ? ""
        : id === "device"
          ? "Local machine"
          : "10.0.0.1, 10.0.0.2",
    );
    setRunning(false);
    setCompleted(false);
    setFailed(false);
    setLastResult(null);
    setProgress(0);
    setError("");
    setResultNote("");
  };
  return (
    <>
      <PageTitle title={currentMode.title} subtitle={currentMode.subtitle} />
      <section className="scan-grid">
        <article className="card scan-composer">
          <div className="mode-tabs">
            {modes.map(([id, Icon, label]) => (
              <button
                className={mode === id ? "active" : ""}
                onClick={() => selectMode(id)}
                key={id}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <div className="target-input">
            <Search />
            <input
              value={target}
              placeholder={
                mode === "public" ? "For example www.google.com" : ""
              }
              onChange={(e) => setTarget(e.target.value)}
              disabled={mode === "device"}
              aria-label="Scan target"
            />
          </div>
          <div className="scan-actions">
            <button
              className={`secondary ${advancedOpen ? "open" : ""}`}
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <Settings2 />
              Advanced options
              <ChevronDown />
            </button>
            <button
              className="primary"
              disabled={running || !target.trim()}
              onClick={startScan}
            >
              <Play />
              {running ? "Scanning…" : "Start scan"}
            </button>
          </div>
          {advancedOpen && (
            <div className="advanced-panel mode-advanced">
              {mode === "public" ? (
                <>
                  <label>
                    <span>TLS service port</span>
                    <input
                      aria-label="TLS service port"
                      type="number"
                      min="1"
                      max="65535"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                    <small>443 is standard HTTPS.</small>
                  </label>
                  <label>
                    <span>External connection timeout</span>
                    <select
                      aria-label="External connection timeout"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(e.target.value)}
                    >
                      <option value="1000">1 second</option>
                      <option value="2500">2.5 seconds</option>
                      <option value="5000">5 seconds</option>
                      <option value="10000">10 seconds</option>
                    </select>
                    <small>Allows for internet latency.</small>
                  </label>
                </>
              ) : mode === "device" ? (
                <>
                  <label>
                    <span>Loopback scope</span>
                    <select
                      aria-label="Loopback scope"
                      value={deviceScope}
                      onChange={(e) => setDeviceScope(e.target.value)}
                    >
                      <option value="both">localhost + 127.0.0.1</option>
                      <option value="localhost">localhost only</option>
                      <option value="ipv4">127.0.0.1 only</option>
                    </select>
                    <small>Never leaves this machine.</small>
                  </label>
                  <label>
                    <span>Local service ports</span>
                    <input
                      aria-label="Local service ports"
                      value={devicePorts}
                      onChange={(e) => setDevicePorts(e.target.value)}
                    />
                    <small>Comma-separated; maximum 8 ports.</small>
                  </label>
                  <label>
                    <span>Local connection timeout</span>
                    <select
                      aria-label="Local connection timeout"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(e.target.value)}
                    >
                      <option value="250">0.25 seconds</option>
                      <option value="1000">1 second</option>
                      <option value="2500">2.5 seconds</option>
                    </select>
                    <small>Local services should respond quickly.</small>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>Authorized service ports</span>
                    <input
                      aria-label="Authorized service ports"
                      value={networkPorts}
                      onChange={(e) => setNetworkPorts(e.target.value)}
                    />
                    <small>Comma-separated; maximum 8 ports.</small>
                  </label>
                  <label>
                    <span>Per-host timeout</span>
                    <select
                      aria-label="Per-host timeout"
                      value={timeoutMs}
                      onChange={(e) => setTimeoutMs(e.target.value)}
                    >
                      <option value="1000">1 second</option>
                      <option value="2500">2.5 seconds</option>
                      <option value="5000">5 seconds</option>
                    </select>
                    <small>Applied to each host and port pair.</small>
                  </label>
                  <label>
                    <span>Maximum targets</span>
                    <input
                      aria-label="Maximum targets"
                      type="number"
                      min="1"
                      max="16"
                      value={targetLimit}
                      onChange={(e) => setTargetLimit(e.target.value)}
                    />
                    <small>Safety limit: 16 hosts.</small>
                  </label>
                  <label>
                    <span>Concurrent probes</span>
                    <select
                      aria-label="Concurrent probes"
                      value={concurrency}
                      onChange={(e) => setConcurrency(e.target.value)}
                    >
                      <option value="1">1 — slowest</option>
                      <option value="2">2</option>
                      <option value="4">4 — recommended</option>
                      <option value="8">8 — fastest</option>
                    </select>
                    <small>Bounds network load; maximum 8.</small>
                  </label>
                </>
              )}
              <div className="advanced-note">
                <ShieldCheck />
                <span>
                  <b>
                    {mode === "public"
                      ? "External endpoint evidence"
                      : mode === "device"
                        ? "Local runtime and loopback evidence"
                        : "Bounded authorized network evidence"}{" "}
                    is saved automatically.
                  </b>
                  <small>
                    Only successful cryptographic observations contribute to
                    readiness evidence.
                  </small>
                </span>
              </div>
            </div>
          )}
          <p className="consent">
            <Shield />
            Only scan systems you own or are authorized to test.
          </p>
          {error && <p className="error">{error}</p>}
        </article>
        <article className={`card active-scan ${failed ? "scan-failed" : ""}`}>
          <div className="scan-target">
            <span className={`metric-icon ${failed ? "red" : "blue"}`}>
              {failed ? <ShieldAlert /> : <ModeIcon />}
            </span>
            <b>{target || "No target selected"}</b>
            <span className={`status-pill ${failed ? "failed" : ""}`}>
              {running
                ? "Active scan"
                : failed
                  ? "Failed"
                  : completed
                    ? "Completed"
                    : "Ready"}
            </span>
          </div>
          <div className="progress-layout">
            <div
              className="progress-ring"
              style={{ "--progress": `${progress * 3.6}deg` }}
            >
              <div>
                <strong>{failed ? "—" : `${progress}%`}</strong>
                <span>
                  {failed
                    ? "Failed"
                    : running
                      ? "Complete"
                      : completed
                        ? "Complete"
                        : "Ready"}
                </span>
              </div>
            </div>
            <div className="steps">
              {scanSteps.map((s, i) => (
                <div
                  className={
                    failed && i === 0
                      ? "failed"
                      : progress > (i + 1) * 22
                        ? "done"
                        : progress > i * 22
                          ? "current"
                          : ""
                  }
                  key={s}
                >
                  <i>
                    {progress > (i + 1) * 22 && !failed ? (
                      <Check />
                    ) : failed && i === 0 ? (
                      "!"
                    ) : null}
                  </i>
                  <span>{s}</span>
                  <small>
                    {failed && i === 0
                      ? "Failed"
                      : failed
                        ? "Not run"
                        : progress > (i + 1) * 22
                          ? "Done"
                          : progress > i * 22
                            ? "Active"
                            : "Pending"}
                  </small>
                </div>
              ))}
            </div>
          </div>
          <p className="scan-scope">
            <CircleHelp />
            <span>
              <b>What this proves:</b> {currentMode.scope}
            </span>
          </p>
          <div className="scan-footer">
            <span>
              {failed ? <ShieldAlert /> : <Clock3 />}
              {running
                ? "Probe in progress"
                : failed
                  ? resultNote || "No evidence collected"
                  : completed
                    ? resultNote || "Scan completed"
                    : "Choose a target to begin"}
            </span>
            {running && (
              <button className="secondary" onClick={() => setRunning(false)}>
                Cancel scan
              </button>
            )}
            {completed && lastResult && (
              <button
                className="primary"
                onClick={() =>
                  document
                    .getElementById("scan-analysis")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                View scan analysis <ChevronRight />
              </button>
            )}
          </div>
        </article>
        {completed && lastResult && (
          <article className="card scan-analysis" id="scan-analysis">
            <div className="scan-analysis-heading">
              <span className="metric-icon blue"><ShieldCheck /></span>
              <div>
                <span className="eyebrow">Collected evidence analysis</span>
                <h2>{lastResult._targetLabel || target}</h2>
                <p>This analysis describes only the target and services observed in this scan.</p>
              </div>
              <span className={`analysis-classification ${resultClassification?.priority === "CRITICAL" ? "critical" : ""}`}>
                {resultClassification?.label || "OBSERVED"}
              </span>
            </div>
            {mode === "public" ? (
              <>
                <div className="analysis-evidence-grid">
                  <div><small>TLS protocol</small><strong>{observedProtocol || "Not reported"}</strong></div>
                  <div><small>Certificate key</small><strong>{observedAlgorithm || "Not reported"}</strong></div>
                  <div><small>Negotiated cipher</small><strong>{lastResult.protocol?.cipher || "Not reported"}</strong></div>
                  <div><small>Forward secrecy</small><strong>{observedPfs === true ? "Observed" : observedPfs === false ? "Not observed" : "Unknown"}</strong></div>
                  <div><small>Priority</small><strong>{resultClassification?.priority || "Review"}</strong></div>
                  <div><small>Endpoint risk</small><strong>{lastResult._riskScore == null ? "Not scored" : `${lastResult._riskScore}/100`}</strong></div>
                </div>
                <div className="analysis-certificate">
                  <h3>Presented certificate</h3>
                  <dl>
                    <div><dt>Subject</dt><dd>{lastResult.certificate?.subject || "Not reported"}</dd></div>
                    <div><dt>Issuer</dt><dd>{lastResult.certificate?.issuer || "Not reported"}</dd></div>
                    <div><dt>Expires</dt><dd>{lastResult.certificate?.expiresAt || "Not reported"}</dd></div>
                  </dl>
                </div>
              </>
            ) : (
              <div className="analysis-evidence-grid">
                <div><small>Targets tested</small><strong>{discoverySummary?.targetsScanned ?? "Recorded"}</strong></div>
                <div><small>Services observed</small><strong>{discoverySummary?.completedCount ?? "Recorded"}</strong></div>
                <div><small>Unreachable</small><strong>{discoverySummary?.failedCount ?? "Recorded"}</strong></div>
              </div>
            )}
            <div className="analysis-findings">
              <h3>What the evidence means</h3>
              {resultFindings.length ? (
                <ul>{resultFindings.map(finding => <li key={finding}>{finding}</li>)}</ul>
              ) : (
                <p>No additional cryptographic findings were returned.</p>
              )}
              <div className="analysis-actions">
                <button className="secondary" onClick={() => setActive("Exposure")}>Open Quantum Exposure <ChevronRight /></button>
                <button className="secondary" onClick={() => setActive("Reports")}>Create evidence report <ChevronRight /></button>
              </div>
            </div>
            <p className="analysis-boundary"><CircleHelp /><span><b>Interpretation boundary:</b> Endpoint evidence can identify exposed cryptography, but it cannot establish organization-wide Quantum Readiness without internal inventory, governance, and migration evidence.</span></p>
          </article>
        )}
        <RecentScans
          scans={scans}
          onRescan={(scan) => {
            setTarget(scan.targetLabel);
            setMode(scan.type === "local" ? "device" : "public");
          }}
        />
        <article className="card check-card">
          <div className="card-heading">
            <span>
              <ShieldCheck />
              What we observe
            </span>
          </div>
          {currentMode.observations.map(([Icon, t, d]) => (
            <div className="check-row" key={t}>
              <span>
                <Icon />
              </span>
              <div>
                <b>{t}</b>
                <small>{d}</small>
              </div>
            </div>
          ))}
          <button
            className="text-link"
            onClick={() => setActive("Q-Day Readiness")}
          >
            Learn about scoring <ChevronRight />
          </button>
        </article>
        <article className="card monitor-card">
          <div className="card-heading">
            <span>
              <Activity />
              Scheduled monitoring
            </span>
            <label className="switch">
              <input type="checkbox" defaultChecked />
              <i />
            </label>
          </div>
          <p>We continuously monitor your approved assets.</p>
          {["example.com", "api.quantumlink.dev"].map((x) => (
            <div className="monitor-row" key={x}>
              <Globe2 />
              <b>{x}</b>
              <span>
                Next run
                <br />
                <strong>7:55 AM</strong>
              </span>
              <small>
                <i />
                Active
              </small>
            </div>
          ))}
          <button className="secondary">
            <Settings2 />
            Manage
          </button>
        </article>
        <article className="insight scan-meaning">
          <span
            className={`metric-icon ${failed ? "red" : completed ? "green" : "blue"}`}
          >
            {failed ? (
              <ShieldAlert />
            ) : completed ? (
              <ShieldCheck />
            ) : (
              <ModeIcon />
            )}
          </span>
          <div>
            <span className="eyebrow">
              What this {completed ? "result" : "scan"} means
            </span>
            <h3>
              {failed
                ? "No cryptographic conclusion can be drawn"
                : completed
                  ? mode === "public"
                    ? "One public endpoint observed—not the organization"
                    : mode === "device"
                      ? "Local service evidence collected—not a device inventory"
                      : "Authorized host evidence collected—not a network inventory"
                  : idleMeaning[0]}
            </h3>
            {completed ? (
              <p>
                <b>{completedSummary}</b>
                <br />
                {mode === "public"
                  ? "This describes only the endpoint scanned. Add authorized internal observations and your organization profile before treating it as a readiness signal."
                  : mode === "device"
                    ? "This describes only loopback services on the selected port. A device cryptographic inventory requires separate filesystem, package, key, and application collectors."
                    : "This describes only the entered hosts and selected port. Broader readiness requires approved asset inventory, additional services, and governance evidence."}
              </p>
            ) : failed ? (
              <p>
                The target returned no usable evidence within this scan’s stated
                bounds. Correct the target, port, or connection issue before
                using it in an assessment.
              </p>
            ) : (
              <p>{idleMeaning[1]}</p>
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function RecentScans({ scans, onRescan }) {
  const rows = scans
    .filter(
      (scan) =>
        scan.status === "COMPLETED" &&
        scan.result &&
        !(
          ["discovery", "device"].includes(scan.type) &&
          scan.result?.summary?.completedCount === 0
        ),
    )
    .filter(
      (s, i, a) => a.findIndex((x) => x.targetLabel === s.targetLabel) === i,
    )
    .slice(0, 3);
  return (
    <article className="card recent-card">
      <div className="card-heading">
        <span>
          <Clock3 />
          Recent scans
        </span>
        <button className="text-link">View all</button>
      </div>
      {rows.length ? (
        rows.map((scan) => (
          <div className="recent-row" key={scan.id}>
            <span className="metric-icon blue">
              {scan.type === "local" ? <Laptop /> : <Globe2 />}
            </span>
            <div>
              <b>{scan.targetLabel}</b>
              <small>{timeAgo(scan.completedAt)}</small>
            </div>
            <span className="score score-evidence">
              <Check /> <small>Evidence saved</small>
            </span>
            <button
              onClick={() => onRescan(scan)}
              aria-label={`Rescan ${scan.targetLabel}`}
            >
              <RefreshCw />
              <small>Rescan</small>
            </button>
          </div>
        ))
      ) : (
        <p className="empty-scans">No successful evidence collections yet.</p>
      )}
    </article>
  );
}

function Readiness({ scores }) {
  const readiness = scores.readiness;
  const components = readiness.components;
  const [organizationTarget, setOrganizationTarget] = useState("2028-06-30");
  return (
    <>
      <PageTitle
        title="Q-Day Readiness"
        subtitle="How prepared the organization is to identify, prioritize, and migrate quantum-vulnerable systems."
      />
      <section className="content-grid">
        <article className="card score-explainer">
          <ScoreRing score={readiness.score} />
          <div>
            <span className="eyebrow">
              The Quantum Readiness Score · Higher is better
            </span>
            <h2>
              {readiness.score} / 100 · {readiness.classification}
            </h2>
            <p>
              This is QuantumSentinel’s single headline score. It evaluates
              modernization, inventory coverage, migration planning, governance,
              and compensating controls from the available evidence.
            </p>
            <span className="confidence-pill">
              {scores.confidence.label} · {scores.confidence.coverage}% coverage
            </span>
          </div>
        </article>
        <article className="card methodology">
          <h2>How readiness is calculated</h2>
          {[
            [
              "Crypto modernization",
              35,
              "Share of assets using hybrid or quantum-safe cryptography",
              components.cryptoModernization,
            ],
            [
              "Inventory coverage",
              20,
              "Completeness of algorithm, protocol, classification, and risk evidence",
              components.inventoryCoverage,
            ],
            [
              "Migration planning",
              20,
              "Vulnerable assets with a documented migration path",
              components.migrationPlanning,
            ],
            [
              "Governance maturity",
              15,
              "Policy and compliance implementation progress",
              components.governanceMaturity,
            ],
            [
              "Compensating controls",
              10,
              "Observed protections such as perfect forward secrecy",
              components.compensatingControls,
            ],
          ].map(([t, w, d, v]) => (
            <div className="weight-row" key={t}>
              <span>{w}%</span>
              <div>
                <b>{t}</b>
                <small>{d}</small>
              </div>
              <div className="component-value">
                <i style={{ width: `${Math.max(2, v)}%` }} />
                <em>{Math.round(v)} evidence points</em>
              </div>
            </div>
          ))}
        </article>
        <article className="card formula">
          <CircleHelp />
          <div>
            <h3>Readiness interpretation</h3>
            <p>
              <b>0–24:</b> Unprepared · <b>25–49:</b> Early-stage ·{" "}
              <b>50–69:</b> Transitioning · <b>70–84:</b> Prepared ·{" "}
              <b>85–100:</b> Quantum-ready
            </p>
            <small>
              Unknown or incomplete evidence reduces confidence; it must never
              be treated as proof of quantum safety.
            </small>
          </div>
        </article>
        <article className="card org-timeline">
          <div>
            <span className="eyebrow">Your controllable timeline</span>
            <h2>Organizational readiness deadline</h2>
            <p>
              Set when critical systems must be inventoried, migration-tested,
              and protected. This deadline should precede every external Q-Day
              scenario.
            </p>
          </div>
          <label>
            Target readiness date
            <input
              type="date"
              value={organizationTarget}
              onChange={(event) => setOrganizationTarget(event.target.value)}
            />
            <small>
              {daysUntil(organizationTarget).toLocaleString()} days remaining
            </small>
          </label>
          <div className="timeline-steps">
            <span className="done">
              <Check />
              Inventory baseline
            </span>
            <span>
              <CalendarClock />
              Migration pilots
            </span>
            <span>
              <ShieldCheck />
              Critical systems ready
            </span>
          </div>
        </article>
      </section>
    </>
  );
}

function Exposure({ data }) {
  const assets = data?.assets || [];
  const [assetFilter, setAssetFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const critical =
    assets.filter((asset) => asset.prio === "CRITICAL").length ||
    data?.summary?.criticalCount ||
    8;
  const sourceAssets = assets.length
    ? assets
    : [
        {
          name: "api-gateway-prod-01",
          algo: "RSA-2048",
          prio: "CRITICAL",
          segment: "PERIMETER",
          type: "Load Balancer",
          proto: "TLS 1.3",
          tnfl: 72,
        },
        {
          name: "vpn-concentrator-01",
          algo: "ECDH P-256",
          prio: "CRITICAL",
          segment: "DMZ",
          type: "VPN Gateway",
          proto: "IKEv2",
          tnfl: 61,
        },
        {
          name: "ca-root-internal",
          algo: "RSA-4096",
          prio: "HIGH",
          segment: "INTERNAL",
          type: "CA Server",
          proto: "PKIX",
          tnfl: 99,
        },
      ];
  const isPublic = (asset) =>
    ["PERIMETER", "DMZ", "CLOUD", "PUBLIC", "INTERNET"].includes(
      String(asset.segment || "").toUpperCase(),
    );
  const visibleAssets = sourceAssets
    .filter(
      (asset) =>
        assetFilter === "all" ||
        (assetFilter === "public" ? isPublic(asset) : !isPublic(asset)),
    )
    .slice(0, 6);
  const tnflReason = asset => {
    const evidence = `${asset.type || ""} ${asset.proto || asset.protocol || ""} ${asset.hostname || asset.name || ""}`.toLowerCase();
    if (/code.?sign|signing/.test(evidence)) return "Code-signing or artifact-signing dependency";
    if (/ca server|certificate authority|root|pki/.test(evidence)) return "Long-lived certificate authority or trust anchor";
    if (/identity|sso|idp/.test(evidence)) return "Identity and authentication trust dependency";
    if (/pkix|x\.509/.test(evidence)) return "Certificate signature and trust-chain evidence";
    if (/tls|https|smtps|ike|ipsec/.test(evidence)) return "Certificate-bearing service identity";
    return "Quantum-vulnerable signature or trust evidence";
  };
  const tnflAssets = sourceAssets.filter(asset => Number.isFinite(Number(asset.tnfl)) && Number(asset.tnfl) >= 70).sort((a, b) => Number(b.tnfl) - Number(a.tnfl));
  const exportSnapshot = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      scope: "quantum-exposure",
      summary: data?.summary || {},
      assets: sourceAssets,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `quantumsentinel-exposure-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <PageTitle
        title="Quantum Exposure"
        subtitle="Where quantum-vulnerable cryptography creates urgency across the observed environment."
      >
        <button className="secondary" onClick={exportSnapshot}>
          <FileDown />
          Export snapshot
        </button>
      </PageTitle>
      <section className="content-grid">
        <Metric
          icon={ShieldAlert}
          value={critical}
          label="critical exposures"
          tone="red"
          trend="Requires action"
        />
        <Metric
          icon={Clock3}
          value={data?.summary?.shorCount || 12}
          label="HNDL candidates"
          tone="red"
        />
        <Metric icon={FileText} value={tnflAssets.length} label="TNFL candidates" tone="red" trend="Signature and trust exposure" />
        <article className="card tnfl-card"><div className="card-heading"><span><FileText />Signature & trust exposure (TNFL)</span><small>Derived from observed asset role, protocol, algorithm, trust relevance, and existing TNFL risk evidence.</small></div><p>Trust-now-forge-later analysis identifies systems whose signatures or trust assertions may need to remain valid after classical public-key cryptography becomes vulnerable.</p><div className="tnfl-list">{tnflAssets.slice(0, 5).map(asset => <button key={asset.id || asset.hostname || asset.name} onClick={() => setSelectedAsset(asset)}><span className="tnfl-score">{Math.round(Number(asset.tnfl))}</span><span><b>{asset.hostname || asset.name || asset.id}</b><small>{tnflReason(asset)}</small></span><span>{asset.migration || "Define signature migration target"}</span><ChevronRight /></button>)}</div><div className="tnfl-note"><CircleHelp /><span><b>What this function measures:</b> a prioritized signature/trust exposure signal from collected evidence. It is not proof that an artifact can be forged, and missing signing evidence remains an assessment gap.</span></div></article>
        <article className="card asset-list">
          <div className="card-heading">
            <span>
              <Building2 />
              Highest exposure
            </span>
            <div className="chips">
              {[
                ["all", "All"],
                ["public", "Public"],
                ["internal", "Internal"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={assetFilter === id ? "selected" : ""}
                  onClick={() => setAssetFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {visibleAssets.length ? (
            visibleAssets.map((a, i) => (
              <div className="asset-row" key={a.id || a.name || i}>
                <span className="metric-icon red">
                  <ShieldAlert />
                </span>
                <div>
                  <b>{a.hostname || a.name || a.id}</b>
                  <small>
                    {a.algo || a.algorithm || a.cls || "Legacy cryptography"}
                  </small>
                </div>
                <span className="severity">{a.prio || "HIGH"}</span>
                <span>{a.segment || "Observed asset"}</span>
                <button onClick={() => setSelectedAsset(a)}>
                  View <ChevronRight />
                </button>
              </div>
            ))
          ) : (
            <p className="empty-scans">No assets match this exposure filter.</p>
          )}
        </article>
      </section>
      {selectedAsset && (
        <aside
          className="asset-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Asset exposure details"
        >
          <div className="asset-drawer-heading">
            <span className="metric-icon red">
              <ShieldAlert />
            </span>
            <div>
              <span className="eyebrow">Exposure evidence</span>
              <h2>
                {selectedAsset.hostname ||
                  selectedAsset.name ||
                  selectedAsset.id}
              </h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setSelectedAsset(null)}
              aria-label="Close asset details"
            >
              ×
            </button>
          </div>
          <dl>
            <div>
              <dt>Priority</dt>
              <dd>{selectedAsset.prio || "Unknown"}</dd>
            </div>
            <div>
              <dt>Segment</dt>
              <dd>{selectedAsset.segment || "Unknown"}</dd>
            </div>
            <div>
              <dt>Algorithm</dt>
              <dd>
                {selectedAsset.algo || selectedAsset.algorithm || "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Classification</dt>
              <dd>{selectedAsset.cls || "Not classified"}</dd>
            </div>
            <div>
              <dt>Protocol</dt>
              <dd>{selectedAsset.proto || "Not observed"}</dd>
            </div>
            <div>
              <dt>HNDL evidence</dt>
              <dd>{selectedAsset.hndl ?? "Not assessed"}</dd>
            </div>
            <div>
              <dt>TNFL signature exposure</dt>
              <dd>{selectedAsset.tnfl ?? "Not assessed"}</dd>
            </div>
            <div>
              <dt>TNFL evidence driver</dt>
              <dd>{selectedAsset.tnfl == null ? "Signing evidence required" : tnflReason(selectedAsset)}</dd>
            </div>
            <div>
              <dt>Forward secrecy</dt>
              <dd>
                {selectedAsset.pfs === true
                  ? "Observed"
                  : selectedAsset.pfs === false
                    ? "Not observed"
                    : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Migration path</dt>
              <dd>{selectedAsset.migration || "Not documented"}</dd>
            </div>
          </dl>
          <p>
            <b>Evidence boundary:</b> These values reflect collected inventory
            and probe evidence. Unknown fields are not proof of safety.
          </p>
        </aside>
      )}
    </>
  );
}

const MIGRATION_PHASES = [
  ["Establish scope and cryptographic inventory", "Confirm in-scope systems, data flows, certificates, keys, libraries, protocols, vendors, and owners.", "Approved scope, accountable owners, and a current cryptographic inventory."],
  ["Prioritize exposure and data lifetime", "Classify business criticality, confidentiality lifetime, HNDL relevance, signature-lifetime requirements, algorithm exposure, and external dependencies.", "Risk-ranked migration backlog with documented rationale and deadlines."],
  ["Define the target cryptographic architecture", "Select approved post-quantum or hybrid profiles, trust-chain changes, key-management requirements, rollback paths, and interoperability constraints.", "Architecture decision record and system-specific target state."],
  ["Pilot and validate", "Test performance, compatibility, certificate and key lifecycles, failure behavior, monitoring, recovery, and vendor integration in a controlled environment.", "Pilot evidence showing acceptance criteria, defects, and remediation decisions."],
  ["Roll out and cut over", "Sequence production deployment by urgency, coordinate owners and change windows, retire vulnerable configurations, and track exceptions.", "Completed production changes with approved exceptions and rollback evidence."],
  ["Prove readiness and operate", "Rescan the environment, verify crypto posture, preserve CBOM and change evidence, monitor for regression, and schedule periodic reassessment.", "Evidence package supporting closure and continuous crypto-agility."],
];

async function downloadMigrationPlan(action) {
  const { jsPDF } = await import("jspdf");
  const clean = value => String(value || "").replace(/[–—‑]/g, "-");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  let y = 56;
  const ensureSpace = height => { if (y + height <= pageHeight - 58) return; pdf.addPage(); y = 56; };
  const writeWrapped = (text, size = 10, color = [54, 72, 103], indent = 0, gap = 5) => {
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(clean(text), usableWidth - indent);
    pdf.text(lines, margin + indent, y);
    y += lines.length * (size + 3) + gap;
  };
  pdf.setFillColor(7, 94, 232);
  pdf.rect(0, 0, pageWidth, 12, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(7, 94, 232);
  pdf.text("QUANTUM SENTINEL", margin, y);
  y += 27;
  pdf.setFont("helvetica", "bold");
  writeWrapped(`${action.title} - Quantum Migration Plan`, 24, [14, 35, 70], 0, 12);
  pdf.setFont("helvetica", "normal");
  writeWrapped("A generalized, evidence-oriented plan for moving priority cryptography toward a post-quantum-ready target state.", 11, [90, 109, 143], 0, 18);
  pdf.setDrawColor(218, 226, 238);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 22;
  [["Scope", action.asset], ["Owner", action.owner], ["Status", action.status], ["Target date", new Date(`${action.due}T00:00:00`).toLocaleDateString()], ["Urgency", `${action.urgency}/100`], ["Target state", action.target]].forEach(([label, value]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(90, 109, 143);
    pdf.text(label.toUpperCase(), margin, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(14, 35, 70);
    const lines = pdf.splitTextToSize(clean(value), usableWidth - 120);
    pdf.text(lines, margin + 120, y);
    y += Math.max(20, lines.length * 12);
  });
  y += 10;
  pdf.setFont("helvetica", "bold");
  writeWrapped("Implementation roadmap", 16, [14, 35, 70], 0, 12);
  MIGRATION_PHASES.forEach(([title, work, evidence], index) => {
    ensureSpace(112);
    pdf.setFillColor(237, 244, 255);
    pdf.roundedRect(margin, y - 14, 30, 30, 6, 6, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(7, 94, 232);
    pdf.text(String(index + 1), margin + 11, y + 6);
    pdf.setTextColor(14, 35, 70);
    pdf.text(clean(title), margin + 44, y + 3);
    y += 25;
    pdf.setFont("helvetica", "normal");
    writeWrapped(work, 10, [54, 72, 103], 44, 4);
    pdf.setFont("helvetica", "bold");
    writeWrapped(`Evidence required: ${evidence}`, 9, [26, 139, 103], 44, 15);
  });
  ensureSpace(145);
  pdf.setFont("helvetica", "bold");
  writeWrapped("Governance and completion criteria", 16, [14, 35, 70], 0, 10);
  pdf.setFont("helvetica", "normal");
  ["Every action has an accountable owner, deadline, dependency record, and rollback path.", "Exceptions are time-bounded, approved, and linked to compensating controls.", "Completion requires implementation evidence, validation results, an updated inventory, and a rescan.", "Unknown or unobserved cryptography is tracked as an evidence gap, not treated as safe."].forEach((item, index) => writeWrapped(`${index + 1}. ${item}`, 10, [54, 72, 103], 0, 5));
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(125, 140, 163);
    pdf.text(`Generated ${new Date().toLocaleString()} | Generalized planning guidance - validate against organizational requirements`, margin, pageHeight - 28);
    pdf.text(`${page} / ${pages}`, pageWidth - margin, pageHeight - 28, { align: "right" });
  }
  const filename = clean(action.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  pdf.save(`quantumsentinel-${filename}-plan.pdf`);
}

function Remediation() {
  const seedActions = [
    { id: "rsa-gateway", title: "Replace RSA key exchange", asset: "api-gateway-prod-01", owner: "Alex R.", due: "2026-08-12", status: "In progress", urgency: 100, target: "Hybrid TLS with ML-KEM" },
    { id: "hybrid-vpn", title: "Pilot hybrid TLS", asset: "vpn-concentrator-01", owner: "Maya K.", due: "2026-08-18", status: "Planned", urgency: 82, target: "ML-KEM hybrid key exchange" },
    { id: "root-hierarchy", title: "Rotate root hierarchy", asset: "ca-root-internal", owner: "Chris D.", due: "2026-08-09", status: "Blocked", urgency: 94, target: "PQC-ready certificate hierarchy" },
  ];
  const [actions, setActions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("quantumsentinel-remediation-actions") || "null");
      return Array.isArray(stored) && stored.length ? stored : seedActions;
    } catch {
      return seedActions;
    }
  });
  const [sortBy, setSortBy] = useState("urgency");
  const [planOpen, setPlanOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [planName, setPlanName] = useState("Critical systems migration");
  const [planOwner, setPlanOwner] = useState("");
  const [planDeadline, setPlanDeadline] = useState("2026-12-31");
  useEffect(() => {
    localStorage.setItem("quantumsentinel-remediation-actions", JSON.stringify(actions));
  }, [actions]);
  const statusOrder = { Blocked: 0, "In progress": 1, Planned: 2, Completed: 3 };
  const sortedActions = [...actions].sort((a, b) => {
    if (sortBy === "due") return a.due.localeCompare(b.due);
    if (sortBy === "status") return statusOrder[a.status] - statusOrder[b.status];
    if (sortBy === "owner") return a.owner.localeCompare(b.owner);
    return b.urgency - a.urgency;
  });
  const createPlan = (event) => {
    event.preventDefault();
    const newAction = {
      id: `plan-${Date.now()}`,
      title: planName.trim(),
      asset: "Organization-wide",
      owner: planOwner.trim() || "Unassigned",
      due: planDeadline,
      status: "Planned",
      urgency: 75,
      target: "Inventory, pilot, and migrate priority cryptography",
    };
    setActions(current => [newAction, ...current]);
    setPlanOpen(false);
    setSelectedAction(newAction);
    downloadMigrationPlan(newAction);
  };
  const openCount = actions.filter(action => action.status !== "Completed").length;
  const progressCount = actions.filter(action => action.status === "In progress").length;
  const completedCount = actions.filter(action => action.status === "Completed").length;
  return (
    <>
      <PageTitle
        title="Remediation"
        subtitle="Turn quantum risk into an owned, sequenced migration plan."
      >
        <button className="primary" onClick={() => setPlanOpen(true)}>
          <Wrench />
          Create plan
        </button>
      </PageTitle>
      <section className="content-grid">
        <Metric icon={Target} value={openCount} label="open actions" tone="red" />
        <Metric icon={Activity} value={progressCount} label="in progress" tone="blue" />
        <Metric icon={Check} value={completedCount} label="completed" tone="green" />
        <article className="card asset-list">
          <div className="card-heading">
            <span>
              <Wrench />
              Migration queue
            </span>
            <label className="queue-sort">Sort by
              <select value={sortBy} onChange={event => setSortBy(event.target.value)} aria-label="Sort migration queue">
                <option value="urgency">Urgency</option>
                <option value="due">Due date</option>
                <option value="status">Status</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          </div>
          {sortedActions.map((action, i) => (
            <div className="asset-row" key={action.id}>
              <span className={`step-number s${i}`}>{i + 1}</span>
              <div>
                <b>{action.title}</b>
                <small>{action.asset}</small>
              </div>
              <span>{action.owner}</span>
              <span>{new Date(`${action.due}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span className={`status-pill ${action.status.toLowerCase().replace(" ", "-")}`}>{action.status}</span>
              <button onClick={() => setSelectedAction(action)}>
                Open <ChevronRight />
              </button>
            </div>
          ))}
        </article>
      </section>
      {planOpen && <div className="plan-backdrop" role="presentation"><form className="card plan-dialog" role="dialog" aria-modal="true" aria-label="Create migration plan" onSubmit={createPlan}><div className="plan-dialog-heading"><div><span className="eyebrow">New remediation plan</span><h2>Create an owned migration action</h2><p>Start with a named outcome, accountable owner, and readiness deadline.</p></div><button type="button" className="icon-button" onClick={() => setPlanOpen(false)} aria-label="Close plan builder">×</button></div><label>Plan name<input required value={planName} onChange={event => setPlanName(event.target.value)} /></label><label>Owner<input value={planOwner} onChange={event => setPlanOwner(event.target.value)} placeholder="Name or team" /></label><label>Target completion date<input required type="date" value={planDeadline} onChange={event => setPlanDeadline(event.target.value)} /></label><div className="plan-actions"><button type="button" className="secondary" onClick={() => setPlanOpen(false)}>Cancel</button><button type="submit" className="primary"><Check />Add to migration queue</button></div></form></div>}
      {selectedAction && <aside className="asset-drawer remediation-drawer" role="dialog" aria-modal="true" aria-label="Remediation action details"><div className="asset-drawer-heading"><span className="metric-icon blue"><Wrench /></span><div><span className="eyebrow">Migration action</span><h2>{selectedAction.title}</h2></div><button className="icon-button" onClick={() => setSelectedAction(null)} aria-label="Close remediation details">×</button></div><div className="drawer-actions"><button className="primary" onClick={() => downloadMigrationPlan(selectedAction)}><FileDown />Download migration plan PDF</button></div><dl><div><dt>Asset or scope</dt><dd>{selectedAction.asset}</dd></div><div><dt>Owner</dt><dd>{selectedAction.owner}</dd></div><div><dt>Status</dt><dd>{selectedAction.status}</dd></div><div><dt>Urgency</dt><dd>{selectedAction.urgency}/100</dd></div><div><dt>Due date</dt><dd>{new Date(`${selectedAction.due}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Target state</dt><dd>{selectedAction.target}</dd></div></dl><p><b>Planning boundary:</b> This is an accountable migration action. Completion should only be recorded when supporting implementation and validation evidence exists.</p></aside>}
    </>
  );
}

const REPORT_TYPES = [
  { id: "executive", title: "Executive posture", description: "Headline readiness, confidence, critical exposure, and priority decisions.", sections: ["Readiness summary", "Material exposure", "Leadership decisions", "Evidence limitations"] },
  { id: "readiness", title: "Q-Day readiness", description: "Score methodology, evidence coverage, readiness drivers, and organizational timeline.", sections: ["Quantum Readiness Score", "Weighted score components", "Evidence confidence", "Readiness timeline"] },
  { id: "exposure", title: "Exposure findings", description: "Critical findings, HNDL and TNFL candidates, affected assets, and observed cryptography.", sections: ["Exposure summary", "Critical assets", "HNDL and TNFL signals", "Observed evidence boundary"] },
  { id: "migration", title: "Migration plan", description: "Owners, milestones, dependencies, target states, and validation requirements.", sections: ["Prioritized backlog", "Migration phases", "Ownership and deadlines", "Completion evidence"] },
];

function buildReportRecord(type, scores, data) {
  const summary = data?.summary || {};
  const metrics = {
    readinessScore: scores.readiness.score,
    readinessClassification: scores.readiness.classification,
    evidenceConfidence: scores.confidence.level,
    evidenceCoveragePct: scores.confidence.coverage,
    observedAssets: summary.totalAssets || data?.assets?.length || 0,
    criticalExposures: summary.criticalCount || 0,
    hndlCandidates: summary.shorCount || 0,
    tnflCandidates: (data?.assets || []).filter(asset => Number(asset.tnfl) >= 70).length,
    quantumSafeAssets: summary.safeCount || 0,
  };
  const criticalNames = (data?.assets || []).filter(asset => asset.prio === "CRITICAL").slice(0, 4).map(asset => asset.hostname || asset.name || asset.id).filter(Boolean);
  const executiveSections = [
    { title: "Readiness summary", body: `The organization is ${metrics.readinessClassification.toLowerCase()} at ${metrics.readinessScore}/100 readiness. This indicates that material migration work remains before critical systems can be treated as prepared for a post-quantum transition. Evidence confidence is ${String(metrics.evidenceConfidence).toLowerCase()} with ${metrics.evidenceCoveragePct}% measured field coverage.`, bullets: [`${metrics.quantumSafeAssets} of ${metrics.observedAssets} observed assets currently show hybrid or quantum-safe evidence.`, "The readiness score is a prioritization signal, not a prediction of when a CRQC will arrive.", "Unknown evidence must reduce confidence and must not be interpreted as proof of safety."] },
    { title: "Material exposure", body: `${metrics.criticalExposures} critical exposures, ${metrics.hndlCandidates} HNDL candidates, and ${metrics.tnflCandidates} TNFL signature/trust candidates require executive attention. Public-facing observations show only the external cryptographic posture; internal PKI, stored data, code signing, VPNs, and vendor dependencies may carry additional exposure.`, bullets: criticalNames.length ? criticalNames.map(name => `${name} is currently classified as a critical observed asset.`) : ["No named critical assets were available in the current evidence snapshot.", "Complete internal discovery before treating the exposure count as comprehensive."] },
    { title: "Leadership decisions", body: "Leadership should convert the technical findings into a funded, owned migration program with deadlines that precede every external Q-Day scenario.", bullets: ["Name an accountable executive sponsor and cryptographic migration owner.", "Approve the scope and deadline for a complete cryptographic inventory and CBOM baseline.", "Fund pilots for hybrid or standardized PQC on the highest-value systems and data flows.", "Require vendors to disclose cryptographic dependencies, migration roadmaps, and validation evidence.", "Track exceptions, compensating controls, rollback plans, and readiness impact at each governance review."] },
    { title: "Evidence limitations", body: "This posture is bounded by the evidence QuantumSentinel can currently observe. A TLS endpoint, device collector, or authorized network scan cannot by itself establish organization-wide quantum readiness.", bullets: ["Public scans observe negotiated TLS and presented certificate evidence, not internal systems.", "Device and network collection is limited to approved scope, reachable services, and available metadata.", "A completed migration requires implementation, validation, inventory, and rescan evidence.", "Scores and counts should be refreshed whenever systems, algorithms, policies, or data-lifetime assumptions change."] },
  ];
  const readinessSections = [
    { title: "Quantum Readiness Score", body: `The current score is ${metrics.readinessScore}/100 (${metrics.readinessClassification}). Higher is better. The score combines modernization, inventory coverage, migration planning, governance, and compensating controls; it does not forecast a CRQC date.`, bullets: ["0-24: unprepared; 25-49: early-stage; 50-69: transitioning.", "70-84: prepared; 85-100: quantum-ready.", `${metrics.evidenceConfidence} evidence confidence means the score should be interpreted with the documented collection boundary.`] },
    { title: "Weighted score components", body: "Each component contributes a defined share of the single readiness score. Improving a weak component raises readiness only when supporting evidence is collected.", bullets: Object.entries(scores.components || {}).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${Math.round(value)} evidence points.`) },
    { title: "Evidence confidence", body: `${metrics.evidenceCoveragePct}% field coverage describes completeness of the fields currently measured, not completeness of the entire environment. Confidence must also reflect source quality, scan scope, and the age of evidence.`, bullets: ["Public TLS evidence covers one presented endpoint.", "Device and network evidence covers only authorized and reachable scope.", "Governance and migration assertions require documentary and implementation evidence."] },
    { title: "Readiness timeline", body: "The organization should establish a controllable deadline for inventory, pilots, critical-system migration, and validation that precedes every external Q-Day scenario.", bullets: ["Set a complete inventory baseline first.", "Pilot priority protocols and trust chains next.", "Finish critical-system cutover, rescan, and evidence review before declaring readiness."] },
  ];
  const exposureSections = [
    { title: "Exposure summary", body: `${metrics.criticalExposures} critical exposures were identified across ${metrics.observedAssets} observed assets. ${metrics.quantumSafeAssets} assets currently show hybrid or quantum-safe evidence.`, bullets: ["Exposure indicates reliance on potentially vulnerable cryptography; it is not proof of compromise.", "Counts reflect observed evidence and can rise as inventory coverage expands.", "Priority should combine cryptographic posture, data lifetime, business criticality, and migration complexity."] },
    { title: "Critical assets", body: criticalNames.length ? `The current critical set includes ${criticalNames.join(", ")}.` : "The current snapshot does not provide named critical assets.", bullets: criticalNames.length ? criticalNames.map(name => `${name}: confirm owner, data lifetime, dependencies, and target migration state.`) : ["Run authorized internal discovery and reconcile the results with the asset inventory."] },
    { title: "HNDL and TNFL signals", body: `${metrics.hndlCandidates} assets show evidence relevant to harvest-now-decrypt-later analysis and ${metrics.tnflCandidates} assets meet the current TNFL signature/trust threshold. TNFL prioritization is derived from observed role, protocol, algorithm, certificate, trust relevance, and migration evidence.`, bullets: ["Prioritize confidential data whose required lifetime extends beyond plausible migration timelines.", "Prioritize certificate authorities, code signing, identity systems, and other long-lived trust anchors by TNFL score.", "Collect missing signing and trust-chain evidence; absence of evidence must not lower exposure.", "Forward secrecy can reduce some session exposure but does not make vulnerable public-key infrastructure quantum-safe."] },
    { title: "Observed evidence boundary", body: "Observed public, device, and network cryptography provides a starting point, not an organization-wide attestation.", bullets: ["Public endpoints do not expose internal PKI, databases, stored ciphertext, or governance.", "Unreachable services and opaque vendor components remain evidence gaps.", "Unknown fields must be investigated and never counted as safe."] },
  ];
  const migrationSections = [
    { title: "Prioritized backlog", body: `${metrics.criticalExposures} critical exposures and ${metrics.hndlCandidates} HNDL candidates form the initial migration backlog. Sequence work by business impact, data lifetime, dependency depth, and feasibility.`, bullets: criticalNames.length ? criticalNames.map(name => `${name}: assign an owner, target state, deadline, dependencies, and rollback path.`) : ["Complete discovery before finalizing the backlog."] },
    { title: "Migration phases", body: "Use an evidence-gated sequence rather than a single algorithm replacement event.", bullets: MIGRATION_PHASES.map(([title, work]) => `${title}: ${work}`) },
    { title: "Ownership and deadlines", body: "Every action requires one accountable owner, a funded delivery team, a target date, and explicit dependency and exception management.", bullets: ["Executive sponsor: resolves funding, risk acceptance, and cross-business conflicts.", "System owner: validates availability, interoperability, and rollback requirements.", "Security and architecture: approve target profiles and validation evidence.", "Procurement and legal: enforce vendor disclosure and migration commitments."] },
    { title: "Completion evidence", body: "A migration item is complete only when implementation and validation evidence demonstrates the target state in production.", bullets: ["Approved architecture and change record.", "Test and pilot results, including failure and rollback behavior.", "Updated cryptographic inventory or CBOM.", "Post-change scan confirming expected cryptography and no regression.", "Documented, time-bounded exceptions with compensating controls."] },
  ];
  const sectionsByType = { executive: executiveSections, readiness: readinessSections, exposure: exposureSections, migration: migrationSections };
  return {
    reportId: `${type.id}-${Date.now()}`,
    type: type.id,
    title: type.title,
    generatedAt: new Date().toISOString(),
    description: type.description,
    sections: sectionsByType[type.id],
    metrics,
    evidenceBoundary: "This report reflects available inventory, probe, governance, and migration evidence. Unknown or unobserved fields are not proof of safety.",
  };
}

function downloadReportJson(report) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `quantumsentinel-${report.type}-report.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadReportPdf(report) {
  const { jsPDF } = await import("jspdf");
  const clean = value => String(value || "").replace(/[–—‑]/g, "-");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const usable = width - margin * 2;
  let y = 58;
  const addPage = () => { pdf.addPage(); pdf.setFillColor(7, 94, 232); pdf.rect(0, 0, width, 12, "F"); y = 52; };
  const ensure = needed => { if (y + needed > height - 54) addPage(); };
  const write = (text, size = 10, color = [54, 72, 103], gap = 7, indent = 0) => { pdf.setFontSize(size); pdf.setTextColor(...color); const lines = pdf.splitTextToSize(clean(text), usable - indent); pdf.text(lines, margin + indent, y); y += lines.length * (size + 3) + gap; };
  pdf.setFillColor(7, 94, 232); pdf.rect(0, 0, width, 12, "F");
  pdf.setFont("helvetica", "bold"); write("QUANTUM SENTINEL", 11, [7, 94, 232], 18); write(report.title, 26, [14, 35, 70], 10);
  pdf.setFont("helvetica", "normal"); write(report.description, 11, [90, 109, 143], 20);
  pdf.setDrawColor(218, 226, 238); pdf.line(margin, y, width - margin, y); y += 24;
  pdf.setFont("helvetica", "bold"); write("Current evidence snapshot", 16, [14, 35, 70], 12);
  Object.entries(report.metrics).forEach(([key, value]) => { const label = key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase()); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(90, 109, 143); pdf.text(clean(label).toUpperCase(), margin, y); pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(14, 35, 70); pdf.text(clean(value), margin + 190, y); y += 23; });
  y += 10;
  report.sections.forEach((section, index) => {
    ensure(155);
    pdf.setFillColor(237, 244, 255); pdf.roundedRect(margin, y - 13, 28, 28, 6, 6, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(7, 94, 232); pdf.text(String(index + 1), margin + 10, y + 5);
    pdf.setFont("helvetica", "bold"); write(section.title, 16, [14, 35, 70], 8, 42);
    pdf.setFont("helvetica", "normal"); write(section.body, 10, [54, 72, 103], 8, 42);
    section.bullets.forEach(item => { ensure(34); pdf.setFillColor(7, 94, 232); pdf.circle(margin + 48, y - 3, 2, "F"); write(item, 9, [54, 72, 103], 5, 58); });
    y += 12;
  });
  ensure(90); pdf.setFont("helvetica", "bold"); write("Evidence boundary", 16, [14, 35, 70], 8); pdf.setFont("helvetica", "normal"); write(report.evidenceBoundary, 10, [54, 72, 103], 8);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) { pdf.setPage(page); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(125, 140, 163); pdf.text(`Generated ${new Date(report.generatedAt).toLocaleString()} | Evidence-backed planning output`, margin, height - 28); pdf.text(`${page} / ${pages}`, width - margin, height - 28, { align: "right" }); }
  pdf.save(`quantumsentinel-${report.type}-report.pdf`);
}

function Reports({ scores, data }) {
  const [selectedReport, setSelectedReport] = useState(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorType, setGeneratorType] = useState("executive");
  const openReport = type => setSelectedReport(buildReportRecord(type, scores, data));
  const generatedReport = () => buildReportRecord(REPORT_TYPES.find(type => type.id === generatorType), scores, data);
  return <><PageTitle title="Reports" subtitle="Clear, evidence-backed outputs centered on one Quantum Readiness Score."><button className="primary" onClick={() => setGeneratorOpen(true)}><FileDown />Generate report</button></PageTitle><section className="report-grid">{REPORT_TYPES.map((type, index) => <article className="card report-card" key={type.id}><span className={`report-icon r${index}`}><FileText /></span><div><h2>{type.title}</h2><p>{type.id === "executive" ? `Readiness ${scores.readiness.score}/100 · ${scores.readiness.classification} · ${scores.confidence.level} confidence` : type.description}</p><small>Live evidence · PDF & JSON</small></div><button className="secondary" onClick={() => openReport(type)}>Open <ChevronRight /></button></article>)}</section>{generatorOpen && <div className="plan-backdrop"><div className="card plan-dialog" role="dialog" aria-modal="true" aria-label="Generate evidence report"><div className="plan-dialog-heading"><div><span className="eyebrow">Report generator</span><h2>Choose an evidence package</h2><p>Exports use the current readiness and inventory snapshot.</p></div><button className="icon-button" onClick={() => setGeneratorOpen(false)} aria-label="Close report generator">×</button></div><label>Report type<select value={generatorType} onChange={event => setGeneratorType(event.target.value)}>{REPORT_TYPES.map(type => <option value={type.id} key={type.id}>{type.title}</option>)}</select></label><div className="plan-actions"><button className="secondary" onClick={() => downloadReportJson(generatedReport())}>Download JSON</button><button className="primary" onClick={() => downloadReportPdf(generatedReport())}><FileDown />Generate PDF</button></div></div></div>}{selectedReport && <aside className="asset-drawer report-drawer" role="dialog" aria-modal="true" aria-label="Report details"><div className="asset-drawer-heading"><span className="report-icon"><FileText /></span><div><span className="eyebrow">Evidence report</span><h2>{selectedReport.title}</h2></div><button className="icon-button" onClick={() => setSelectedReport(null)} aria-label="Close report details">×</button></div><p className="report-description">{selectedReport.description}</p><div className="drawer-actions"><button className="primary" onClick={() => downloadReportPdf(selectedReport)}><FileDown />Download PDF</button><button className="secondary" onClick={() => downloadReportJson(selectedReport)}>Download JSON</button></div><dl>{Object.entries(selectedReport.metrics).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase())}</dt><dd>{value}</dd></div>)}</dl><h3>Report sections</h3><div className="report-sections">{selectedReport.sections.map(section => <section key={section.title}><h4>{section.title}</h4><p>{section.body}</p><ul>{section.bullets.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div><p><b>Evidence boundary:</b> {selectedReport.evidenceBoundary}</p></aside>}</>;
}

export default function App() {
  const [active, setActive] = useState(() =>
    savedProfile().name ? "Scan" : "Overview",
  );
  const [data, setData] = useState(null);
  const [scans, setScans] = useState(FALLBACK_SCANS);
  const [profile, setProfile] = useState(savedProfile);
  const [profileOpen, setProfileOpen] = useState(() => !savedProfile().name);
  useEffect(() => {
    Promise.all([loadApplianceData(), loadProbeJobs()]).then(([d, j]) => {
      setData(d);
      if (j?.length) setScans(j);
    });
  }, []);
  const scores = useMemo(() => deriveQuantumScores(data || {}), [data]);
  const page = useMemo(() => {
    if (active === "Overview")
      return (
        <Overview
          data={data}
          scores={scores}
          scans={scans}
          setActive={setActive}
          openProfile={() => setProfileOpen(true)}
        />
      );
    if (active === "Quantum Context") return <QuantumContext />;
    if (active === "Q-Day Readiness") return <Readiness scores={scores} />;
    if (active === "Scan")
      return <Scan scans={scans} setScans={setScans} setActive={setActive} />;
    if (active === "Exposure") return <Exposure data={data} scores={scores} />;
    if (active === "Remediation") return <Remediation />;
    return <Reports scores={scores} data={data} />;
  }, [active, data, scores, scans]);
  const saveProfile = (next) => {
    setProfile(next);
    localStorage.setItem(
      "quantumSentinel.organizationProfile",
      JSON.stringify(next),
    );
    setProfileOpen(false);
  };
  return (
    <div
      className={`app ${profileOpen && active === "Overview" ? "profile-open" : ""}`}
    >
      <Header
        active={active}
        setActive={setActive}
        openProfile={() => {
          setActive("Overview");
          setProfileOpen(true);
        }}
      />
      {profileOpen && active === "Overview" && (
        <OrganizationProfile
          initialProfile={profile}
          onSave={saveProfile}
          onClose={() => setProfileOpen(false)}
        />
      )}
      <main>{page}</main>
      <footer>
        QuantumSentinel · Evidence, not hype.{" "}
        <span>Only scan systems you own or are authorized to assess.</span>
      </footer>
    </div>
  );
}
