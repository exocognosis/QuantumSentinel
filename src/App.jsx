import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileDown,
  FileText,
  FolderGit2,
  Globe2,
  KeyRound,
  Laptop,
  Network,
  Moon,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Wrench,
} from "lucide-react";
import {
  createCbomSnapshot,
  deriveSummary,
  downloadCbom,
  loadApplianceData,
  loadCbom,
  loadCbomSnapshots,
} from "./api.js";
import { buildRescanRequest, createProbeJob, createRepositoryScan, loadProbeJobs } from "./probeApi.js";
import { deriveQuantumScores } from "./quantumScores.js";
import "./dashboard.css";
import "./scan-options.css";

const ROUTES = {
  overview: "overview",
  onboarding: "onboarding",
  collect: "collect",
  results: "results",
  plan: "plan",
  learn: "learn",
  settings: "settings",
  inventory: "inventory",
  findings: "findings",
  readiness: "readiness",
  exports: "exports",
};

const NAV = [
  { id: ROUTES.onboarding, label: "Onboarding", icon: Building2 },
  { id: ROUTES.overview, label: "Overview", icon: BarChart3 },
  { id: ROUTES.collect, label: "Scan", icon: Target },
  { id: ROUTES.results, label: "Results", icon: ShieldCheck },
  { id: ROUTES.plan, label: "Plan", icon: Wrench },
  { id: ROUTES.learn, label: "Learn", icon: CircleHelp },
  { id: ROUTES.settings, label: "Settings", icon: Settings2 },
];

const FALLBACK_SCANS = [];

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

function isProfileComplete(profile) {
  return Boolean(profile?.name && profile?.industry && profile?.geography);
}

function completedScanCount(scans = []) {
  return scans.filter(scan => scan.status === "COMPLETED" && scan.result).length;
}

function workflowStatus({ profile, scores, scans = [], data = {} }) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const cbom = localCbomFromAssets(assets);
  const setupDone = isProfileComplete(profile);
  const scanDone = completedScanCount(scans) > 0;
  const cbomDone = scanDone && cbom.count > 0;
  const scoreDone = Boolean(scores?.readiness?.assessed);
  const planDone = cbomDone && scoreDone;
  const steps = [
    {
      id: "setup",
      label: "Setup",
      done: setupDone,
      route: ROUTES.onboarding,
      cta: "Complete setup",
      icon: Building2,
      detail: setupDone ? profile.name : "Organization profile required",
    },
    {
      id: "scan",
      label: "Scan",
      done: scanDone,
      route: ROUTES.collect,
      cta: "Run first scan",
      icon: Target,
      detail: scanDone ? `${completedScanCount(scans)} scan${completedScanCount(scans) === 1 ? "" : "s"} saved` : "Collect first evidence",
    },
    {
      id: "cbom",
      label: "CBOM",
      done: cbomDone,
      route: ROUTES.results,
      cta: "Generate CBOM",
      icon: KeyRound,
      detail: cbomDone ? `${cbom.count} component${cbom.count === 1 ? "" : "s"}` : "Build from scan evidence",
    },
    {
      id: "score",
      label: "Score",
      done: scoreDone,
      route: ROUTES.results,
      cta: "Review score",
      icon: ShieldCheck,
      detail: scoreDone ? `${scores.readiness.score}/100` : "Needs evidence",
    },
    {
      id: "plan",
      label: "Plan",
      done: planDone,
      route: ROUTES.plan,
      cta: "Review migration plan",
      icon: Wrench,
      detail: planDone ? "Pathway ready" : "Needs CBOM and score",
    },
    {
      id: "report",
      label: "Report",
      done: false,
      route: ROUTES.plan,
      cta: "Download PQC migration plan",
      icon: FileDown,
      detail: planDone ? "Ready to export" : "Wait for plan",
    },
  ];
  const next = steps.find(step => !step.done) || steps[steps.length - 1];
  return { steps, next, cbom };
}

function readinessMeaning(score, criticalCount = 0) {
  if (!Number.isFinite(score)) return "No score exists yet. Run a scan to collect cryptographic evidence.";
  if (score < 50) return `${score} means early-stage readiness. Start with ${criticalCount} critical exposure${criticalCount === 1 ? "" : "s"}.`;
  if (score < 70) return `${score} means transition work is underway. Close owner, target state, and validation gaps next.`;
  if (score < 85) return `${score} means the program is prepared. Verify critical-system evidence and exceptions.`;
  return `${score} means quantum-ready evidence is strong. Keep rescans and CBOM updates active.`;
}

function observedPostureMeaning(score, criticalCount = 0) {
  if (!Number.isFinite(score)) return "No posture score exists yet. Run an authorized scan to collect cryptographic evidence.";
  if (criticalCount > 0) return `${score} reflects observed exposure in this scan. Start with ${criticalCount} priority finding${criticalCount === 1 ? "" : "s"}.`;
  if (score < 50) return `${score} reflects limited or incomplete scan evidence. Add deeper inventory before closing risk.`;
  if (score < 70) return `${score} reflects partial migration posture for this scan scope. Validate target state and evidence gaps next.`;
  return `${score} reflects stronger observed cryptography for this scan scope. Keep rescans and CBOM updates active.`;
}

function evidenceNeededForAction(action) {
  const target = action?.target || "Target migration state";
  return `Owner approval, implementation record, updated CBOM, and rescan evidence for ${target}.`;
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

function Header({ active, setActive, theme, toggleTheme, profileComplete, onboardingVisible, apiLive, openOnboarding }) {
  const visibleNav = NAV.filter((item) => item.id !== ROUTES.onboarding || !profileComplete || onboardingVisible || active === ROUTES.onboarding);
  return (
    <header className="app-header">
      <Brand />
      <nav aria-label="Primary navigation">
        {visibleNav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={active === id ? "active" : ""}
            onClick={() => id === ROUTES.onboarding ? openOnboarding() : setActive(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      <div className="header-tools">
        <span className={`live ${apiLive ? "" : "unavailable"}`}>
          <i />
          {apiLive ? "System live" : "API unavailable"}
        </span>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          aria-pressed={theme === "dark"}
        >
          {theme === "light" ? <Moon /> : <Sun />}
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}

function PageTitle({ title, subtitle, children, className = "" }) {
  return (
    <div className={`page-title ${className}`.trim()}>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children && <div className="title-actions">{children}</div>}
    </div>
  );
}

function ScopePicker({ label, value, options, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.id === value) || options[0];
  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return (
    <div className={`scope-picker ${className}`.trim()}>
      <span>{label}</span>
      <button
        type="button"
        className="scope-picker-button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <b>{selected?.label || "Overall organization"}</b>
        <ChevronDown />
      </button>
      {open && (
        <div className="scope-picker-menu" role="menu">
          {options.map(option => (
            <button
              type="button"
              className={option.id === value ? "selected" : ""}
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score = null, label = "Readiness" }) {
  const assessed = Number.isFinite(score);
  const displayedScore = assessed ? score : 0;
  const ringColor =
    assessed ? (score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)") : "#9aa6ba";
  return (
    <div
      className="score-ring"
      style={{ "--score": `${displayedScore * 3.6}deg`, "--ring-color": ringColor }}
    >
      <div>
        <strong>{assessed ? score : "—"}</strong>
        <span>{assessed ? "/ 100" : "Unscored"}</span>
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

function OrganizationProfile({ initialProfile, onSave, onClose, variant = "panel" }) {
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
    <aside className={`onboarding-panel ${variant}`} aria-labelledby="profile-title">
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
          <div className="profile-use-panel">
            <div>
              <b>How this changes the assessment</b>
              <span>Industry and geography set the likely regulatory frame. Size helps interpret migration complexity. Data assets help prioritize HNDL and TNFL review.</span>
            </div>
          </div>
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

function Onboarding({ profile, onSave, setActive, qdayScenario, scans }) {
  const profileReady = isProfileComplete(profile);
  const firstScanReady = completedScanCount(scans) > 0;
  const horizon = QDAY_SCENARIOS[qdayScenario] || QDAY_SCENARIOS.ionq;
  return (
    <>
      <PageTitle
        title="Onboarding"
        subtitle="Complete setup in order: organization profile, Q-Day horizon, then scan selection. After setup is complete, this tab hides. Select Onboarding on Overview or Settings to show it again."
      >
        <button className="primary" onClick={() => setActive(ROUTES.collect)} disabled={!profileReady}>
          <Target />
          Continue to scan
        </button>
        <button className="secondary" onClick={() => setActive(ROUTES.overview)}>
          <ChevronRight />
          Return to overview
        </button>
      </PageTitle>
      <section className="setup-checklist card" aria-label="Setup checklist">
        {[
          ["Organization profile", profileReady ? profile.name : "Name, industry, and geography are required.", profileReady],
          ["Q-Day horizon", horizon.label, Boolean(qdayScenario)],
          ["Completed scans", firstScanReady ? `${completedScanCount(scans)} completed scan${completedScanCount(scans) === 1 ? "" : "s"}` : "Run one scan after setup.", firstScanReady],
        ].map(([label, detail, done]) => (
          <div className={done ? "done" : ""} key={label}>
            <span>{done ? <Check /> : <Clock3 />}</span>
            <b>{label}</b>
            <small>{detail}</small>
          </div>
        ))}
      </section>
      <OrganizationProfile
        initialProfile={profile}
        onSave={(next) => {
          onSave(next);
          setActive(ROUTES.collect);
        }}
        onClose={() => setActive(ROUTES.overview)}
        variant="page"
      />
    </>
  );
}

function ReadinessDrivers({ scores, setActive, scanScope = false }) {
  const components = scores.readiness.components;
  const drivers = scanScope ? [
    ["Algorithm posture", components.cryptoModernization, 45],
    ["Evidence completeness", components.inventoryCoverage, 20],
    ["Protocol posture", components.migrationPlanning, 15],
    ["Certificate posture", components.governanceMaturity, 10],
    ["Forward secrecy", components.compensatingControls, 10],
  ] : [
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
          {scores.readiness.assessed ? `What drives this ${scores.readiness.score} ${scanScope ? "posture" : "readiness"} score?` : `What will drive the ${scanScope ? "posture" : "readiness"} score?`}
        </span>
        <button
          className="text-link"
          onClick={() => setActive(ROUTES.results)}
        >
          View calculation <ChevronRight />
        </button>
      </div>
      <p>
        {scores.readiness.assessed
          ? scanScope
            ? "This target score uses only cryptographic evidence observed during the selected scan. It is not an organization-wide readiness assessment."
            : "Every bar is an observed input to the single Quantum Readiness Score. The percentage at right is that input’s weight."
          : "No evidence has been collected yet. These are the five inputs QuantumSentinel will measure after onboarding and authorized collection."}
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

function deriveObservedCryptoPosture(assets = []) {
  const averageValue = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const algorithmValue = asset => ["QUANTUM-SAFE"].includes(asset.cls) ? 100 : asset.cls === "HYBRID" ? 80 : asset.cls === "UNKNOWN" ? 20 : 10;
  const completenessValue = asset => ["algo", "proto", "cls", "prio", "risk"].filter(field => asset[field] != null && asset[field] !== "" && asset[field] !== "Unknown").length * 20;
  const protocolValue = asset => /1\.3/.test(asset.proto) ? 100 : /1\.2/.test(asset.proto) ? 70 : asset.proto && asset.proto !== "Unknown" ? 35 : 0;
  const certificateValue = asset => asset.algo && asset.algo !== "Unknown" ? 100 : 0;
  const components = {
    cryptoModernization: averageValue(assets.map(algorithmValue)),
    inventoryCoverage: averageValue(assets.map(completenessValue)),
    migrationPlanning: averageValue(assets.map(protocolValue)),
    governanceMaturity: averageValue(assets.map(certificateValue)),
    compensatingControls: averageValue(assets.map(asset => asset.pfs ? 100 : 0)),
  };
  const score = Math.round(
    components.cryptoModernization * .45 +
    components.inventoryCoverage * .20 +
    components.migrationPlanning * .15 +
    components.governanceMaturity * .10 +
    components.compensatingControls * .10
  );
  const classification = score >= 85 ? "Strong observed posture" : score >= 70 ? "Moderate observed posture" : score >= 50 ? "Transitional posture" : score >= 25 ? "Elevated exposure" : "High exposure";
  const coverage = Math.round(components.inventoryCoverage);
  const confidence = !assets.length || assets.length < 10 || coverage < 90 ? "Low" : "Medium";
  return {
    readiness: { assessed: assets.length > 0, score, classification, direction: "Higher is better", components },
    confidence: { level: confidence, coverage, label: `${confidence} evidence confidence` },
  };
}

function scanTypeLabel(scan = {}) {
  if (scan.type === "tls") return "Website";
  if (scan.type === "device") return "This device";
  if (scan.type === "discovery") return "Authorized network";
  if (scan.type === "repository") return "Repository";
  return "Imported evidence";
}

function completedScanScopes(scans = []) {
  const completed = scans.filter(scan => scan.status === "COMPLETED" && scan.result);
  const baseLabels = completed.map(scan => `${scanTypeLabel(scan)} · ${scan.targetLabel || scan.target?.host || scan.id}`);
  const counts = baseLabels.reduce((acc, label) => {
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  return completed.map((scan, index) => {
    const label = baseLabels[index];
    const completedAt = scan.completedAt || scan.updatedAt || scan.createdAt;
    return {
      id: scan.id,
      label: counts[label] > 1 ? `${label} · ${timeAgo(completedAt)}` : label,
    };
  });
}

function scanHostValues(scan = {}) {
  const result = scan.result || {};
  const request = scan.request || {};
  const target = scan.target || {};
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const values = [
    scan.targetLabel,
    request.host,
    request.hostname,
    target.host,
    target.hostname,
    ...(Array.isArray(request.hosts) ? request.hosts : []),
    ...(Array.isArray(target.hosts) ? target.hosts : []),
    ...observations.flatMap(observation => [
      observation.host,
      observation.hostname,
      observation.ip,
      observation.certificate?.subject,
    ]),
  ];
  return new Set(values
    .filter(Boolean)
    .flatMap(value => String(value).split(","))
    .map(value => value.trim().replace(/:\d+$/, ""))
    .filter(Boolean));
}

function repositoryScanLabel(scan = {}) {
  return scan.target?.repository || scan.request?.repository || scan.targetLabel || scan.scan?.targetName || "";
}

function assetBelongsToRepositoryScan(asset = {}, scan = {}) {
  if (scan.type !== "repository") return false;
  const repository = repositoryScanLabel(scan);
  if (!repository) return false;
  return asset.segment === `repository:${repository}` || String(asset.hostname || asset.name || "").startsWith(`${repository}:`);
}

function scanContainsAsset(scan = {}, asset = {}) {
  const assetName = asset.hostname || asset.name || String(asset.id || "");
  if (scan.type === "repository") return assetBelongsToRepositoryScan(asset, scan);
  const directHost = scan.target?.host ?? scan.request?.host;
  const observations = scan.result?.observations || [];
  return directHost === assetName || observations.some((observation) => observation.host === assetName);
}

function classifyObservationAsset(observation = {}) {
  const classification = observation.classification || {};
  const protocol = observation.protocol || {};
  const certificate = observation.certificate || {};
  const label = classification.label || classification.classification || "UNKNOWN";
  const risk = label === "DEPRECATED" ? 92 : label === "SHOR-CRITICAL" ? 78 : label === "HYBRID" ? 20 : label === "QUANTUM-SAFE" ? 5 : 50;
  return {
    algo: certificate.algorithm || observation.algorithm || "Unknown",
    proto: protocol.name || observation.protocolName || observation.protocol || "Unknown",
    cls: label,
    prio: classification.priority || (risk >= 90 ? "CRITICAL" : risk >= 70 ? "HIGH" : "MONITOR"),
    pfs: Boolean(protocol.perfectForwardSecrecy),
    cert_exp: certificate.expiresAt || "N/A",
    hndl: classification.quantumVulnerable ? 70 : 5,
    tnfl: classification.quantumVulnerable ? 60 : 5,
    risk,
    migration: ["HYBRID", "QUANTUM-SAFE"].includes(label) ? "Monitor and preserve evidence" : "Define a hybrid or PQC target state",
  };
}

function observationAssetsForScan(scan = {}, existingAssets = []) {
  const result = scan.result || {};
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const existingHosts = new Set(existingAssets.map(asset => asset.hostname || asset.name).filter(Boolean));
  return observations
    .map((observation, index) => {
      const host = observation.host || observation.hostname || scan.target?.host || scan.request?.host || scan.targetLabel || `scan-target-${index + 1}`;
      const hostname = String(host).replace(/:\d+$/, "");
      if (existingHosts.has(hostname)) return null;
      return {
        id: `scan-${scan.id}-${index + 1}`,
        hostname,
        ip: observation.ip || "",
        type: scanTypeLabel(scan),
        segment: scan.type === "device" ? "Local device" : scan.type === "discovery" ? "Authorized network" : "Public edge",
        complexity: "UNKNOWN",
        ...classifyObservationAsset(observation),
      };
    })
    .filter(Boolean);
}

function scopedPlanContext(data = {}, scans = [], scores, selectedScope = "organization") {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const findings = Array.isArray(data?.findings) ? data.findings : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const compliance = Array.isArray(data?.compliance) ? data.compliance : [];
  const selectedScan = scans.find(scan => scan.id === selectedScope) || null;
  const selectedScopeLabel = completedScanScopes(scans).find(scope => scope.id === selectedScope)?.label;
  if (!selectedScan) {
    return {
      scopeLabel: "Overall organization",
      selectedScan: null,
      data,
      scores,
      scans,
    };
  }
  const hosts = scanHostValues(selectedScan);
  const matchedAssets = selectedScan.type === "repository"
    ? assets.filter(asset => assetBelongsToRepositoryScan(asset, selectedScan))
    : assets.filter(asset => hosts.has(asset.hostname) || hosts.has(asset.name) || hosts.has(String(asset.ip || "")));
  const scopedAssets = [...matchedAssets, ...observationAssetsForScan(selectedScan, matchedAssets)];
  const scopedIds = new Set(scopedAssets.map(asset => String(asset.id)));
  const scopedHosts = new Set(scopedAssets.map(asset => asset.hostname || asset.name).filter(Boolean));
  const scopedFindings = findings.filter(finding =>
    scopedIds.has(String(finding.assetId)) ||
    scopedHosts.has(finding.assetName) ||
    scopedHosts.has(finding.hostname) ||
    scopedHosts.has(finding.host) ||
    (selectedScan.type === "repository" && finding.evidence?.repository === repositoryScanLabel(selectedScan)));
  const scopedAlerts = alerts.filter(alert => scopedIds.has(String(alert.assetId)) || scopedHosts.has(alert.assetName) || scopedHosts.has(alert.hostname) || scopedHosts.has(alert.host));
  const scopedScores = deriveObservedCryptoPosture(scopedAssets);
  const scopedData = {
    ...data,
    assets: scopedAssets,
    findings: scopedFindings,
    alerts: scopedAlerts,
    compliance,
    summary: deriveSummary(scopedAssets, scopedAlerts, compliance),
  };
  return {
    scopeLabel: selectedScopeLabel || `${scanTypeLabel(selectedScan)} · ${selectedScan.targetLabel || selectedScan.target?.host || selectedScan.id}`,
    selectedScan,
    data: scopedData,
    scores: scopedScores,
    scans: [selectedScan],
  };
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

function localCbomFromAssets(assets = []) {
  const data = assets.map((asset) => ({
    componentId: `asset-${asset.id}`,
    assetId: asset.id,
    hostname: asset.hostname || asset.name || String(asset.id),
    assetType: asset.type || "Observed Endpoint",
    networkSegment: asset.segment || "Unknown",
    cryptography: {
      algorithm: asset.algo || asset.algorithm || "Unknown",
      protocol: asset.proto || asset.protocol || "Unknown",
      classification: asset.cls || "Unknown",
      perfectForwardSecrecy: Boolean(asset.pfs),
      certificateExpiration: asset.cert_exp || asset.certificateExpiration || "N/A",
    },
    risk: {
      hndl: asset.hndl,
      tnfl: asset.tnfl,
      score: asset.risk,
      priority: asset.prio || "MONITOR",
    },
    migration: {
      target: asset.migration || "Assess migration path",
      complexity: asset.complexity || "UNKNOWN",
      hardwareRefreshRequired: asset.migration === "REQUIRES HW REFRESH",
    },
  }));
  const vulnerable = data.filter((item) => !["HYBRID", "QUANTUM-SAFE", "QUANTUM-RESISTANT", "PQC"].includes(item.cryptography.classification)).length;
  return {
    data,
    count: data.length,
    summary: {
      totalComponents: data.length,
      vulnerableComponents: vulnerable,
      pfsEnabled: data.filter((item) => item.cryptography.perfectForwardSecrecy).length,
      requiresHardwareRefresh: data.filter((item) => item.migration.hardwareRefreshRequired).length,
      migrationTargets: data.reduce((acc, item) => {
        acc[item.migration.target] = (acc[item.migration.target] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

function CryptoInventory({ data, setActive, embedded = false }) {
  const [cbom, setCbom] = useState(() => localCbomFromAssets(data?.assets || []));
  const [snapshots, setSnapshots] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ongoing, setOngoing] = useState(() => localStorage.getItem("quantumSentinel.cbom.ongoing") === "true");
  const [cadence, setCadence] = useState(() => localStorage.getItem("quantumSentinel.cbom.cadence") || "daily");
  const cadenceSeconds = cadence === "hourly" ? 3600 : cadence === "weekly" ? 604800 : 86400;
  const components = cbom?.data || [];
  const summary = cbom?.summary || {};
  const latestSnapshot = snapshots[0];

  const refreshInventory = useCallback(async () => {
    const [nextCbom, nextSnapshots] = await Promise.all([loadCbom(), loadCbomSnapshots()]);
    setCbom(nextCbom?.data?.length ? nextCbom : localCbomFromAssets(data?.assets || []));
    setSnapshots(nextSnapshots);
  }, [data]);

  const createSnapshot = useCallback(async (source = "manual", returnToOverview = false) => {
    setBusy(true);
    setStatus("");
    try {
      const snapshot = await createCbomSnapshot({
        name: `${source}-cbom-${new Date().toISOString().slice(0, 10)}`,
        createdBy: "QuantumSentinel UI",
        metadata: {
          source,
          cadence: source === "scheduled" ? cadence : "one-time",
        },
      });
      await refreshInventory();
      setStatus(`CBOM snapshot ${snapshot?.id || "created"} saved.`);
      if (returnToOverview) setActive?.(ROUTES.overview);
    } catch (error) {
      setStatus(`CBOM snapshot failed: ${error.message || "snapshot endpoint unavailable"}.`);
    } finally {
      setBusy(false);
    }
  }, [cadence, refreshInventory, setActive]);

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  useEffect(() => {
    localStorage.setItem("quantumSentinel.cbom.ongoing", String(ongoing));
    localStorage.setItem("quantumSentinel.cbom.cadence", cadence);
    if (!ongoing) return undefined;
    const timer = window.setInterval(() => {
      createSnapshot("scheduled");
    }, cadenceSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [cadence, cadenceSeconds, createSnapshot, ongoing]);

  const exportCurrent = () => {
    downloadCbom(`quantumsentinel-cbom-${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <>
      {!embedded && (
        <PageTitle
          title="Crypto Inventory"
          subtitle="Generate and preserve the cryptographic bill of materials for observed assets."
        >
          <button className="secondary" onClick={exportCurrent}>
            <FileDown />
            Download CBOM JSON
          </button>
          <button className="primary" onClick={() => createSnapshot("manual")} disabled={busy}>
            <KeyRound />
            {busy ? "Creating..." : "Generate CBOM from evidence"}
          </button>
        </PageTitle>
      )}
      <section className="content-grid cbom-grid">
        <Metric icon={KeyRound} value={summary.totalComponents ?? components.length} label="CBOM components" tone="blue" />
        <Metric icon={ShieldAlert} value={summary.vulnerableComponents ?? 0} label="vulnerable components" tone="red" />
        <Metric icon={ShieldCheck} value={summary.pfsEnabled ?? 0} label="forward secrecy observed" tone="green" />
        <article className="card cbom-control">
          <div className="card-heading">
            <span>
              <RefreshCw />
              Ongoing CBOM
            </span>
            <label className="switch" aria-label="Enable ongoing CBOM snapshots">
              <input type="checkbox" checked={ongoing} onChange={(event) => setOngoing(event.target.checked)} />
              <i />
            </label>
          </div>
          <p>
            Use the current scan evidence to create a CBOM. After the snapshot is saved, return to Overview to review the score and next action.
          </p>
          <button className="primary" onClick={() => createSnapshot("manual", true)} disabled={busy}>
            <KeyRound />
            {busy ? "Creating..." : "Generate CBOM and return to Overview"}
          </button>
          <p>
            Ongoing CBOM keeps a recurring evidence checkpoint while this app session is open.
            Use scheduled scans to refresh evidence before each snapshot.
          </p>
          <label>
            Snapshot cadence
            <select value={cadence} onChange={(event) => setCadence(event.target.value)}>
              <option value="daily">Daily</option>
              <option value="hourly">Hourly</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <button className="secondary" onClick={() => createSnapshot("scheduled")} disabled={busy}>
            <Clock3 />
            Create scheduled snapshot now
          </button>
          {status && <p className={status.includes("failed") ? "cbom-status error" : "cbom-status"}>{status}</p>}
        </article>
        <article className="card asset-list cbom-components">
          <div className="card-heading">
            <span>
              <KeyRound />
              Current CBOM components
            </span>
            <small>{latestSnapshot ? `Latest snapshot: ${latestSnapshot.id}` : "No saved snapshot yet"}</small>
          </div>
          {components.length ? components.slice(0, 8).map((item) => (
            <div className="cbom-row" key={item.componentId}>
              <span className="metric-icon blue">
                <KeyRound />
              </span>
              <div>
                <b>{item.hostname}</b>
                <small>{item.componentId} · {item.assetType}</small>
              </div>
              <span>{item.cryptography.algorithm}</span>
              <span>{item.cryptography.protocol}</span>
              <span className={["HYBRID", "QUANTUM-SAFE", "PQC"].includes(item.cryptography.classification) ? "status-pill completed" : "status-pill failed"}>
                {item.cryptography.classification}
              </span>
            </div>
          )) : (
            <p className="empty-scans">No CBOM components yet. Run an authorized scan to collect cryptographic evidence.</p>
          )}
        </article>
        <article className="card cbom-history">
          <div className="card-heading">
            <span>
              <CalendarClock />
              CBOM snapshot history
            </span>
            <small>{snapshots.length} saved</small>
          </div>
          {snapshots.length ? snapshots.slice(0, 5).map((snapshot) => (
            <div className="snapshot-row" key={snapshot.id}>
              <div>
                <b>{snapshot.name || snapshot.id}</b>
                <small>{snapshot.id} · {new Date(snapshot.createdAt).toLocaleString()}</small>
              </div>
              <strong>{snapshot.count ?? snapshot.cbom?.count ?? 0}</strong>
            </div>
          )) : (
            <p className="empty-scans">Create a one-time CBOM to preserve the first inventory baseline.</p>
          )}
        </article>
        <article className="card cbom-boundary">
          <CircleHelp />
          <p>
            <b>Evidence boundary:</b> The CBOM includes cryptography QuantumSentinel can observe from scans, probes, and persisted asset evidence.
            Internal PKI, key stores, databases, stored ciphertext, code signing, and vendor systems still need authorized evidence collection.
          </p>
        </article>
      </section>
    </>
  );
}

function Overview({ data, scores, scans, setActive, profile, qdayScenario, setQdayScenario, openResultsForScope, openPlanForScope, openOnboarding }) {
  const [scoreScope, setScoreScope] = useState("organization");
  const assets = data?.assets || [];
  const completedScans = scans.filter(scan => scan.status === "COMPLETED" && scan.result);
  const profileComplete = isProfileComplete(profile);
  const workflow = workflowStatus({ profile, scores, scans, data });
  const NextIcon = workflow.next.icon;
  const runWorkflowNext = () => {
    const scope = scans[0]?.id || "organization";
    if (workflow.next.route === ROUTES.results) openResultsForScope(scope);
    else if (workflow.next.route === ROUTES.plan) openPlanForScope(scope);
    else setActive(workflow.next.route);
  };
  const selectedScan = completedScans.find(scan => scan.id === scoreScope) || null;
  const scopedHosts = new Set(selectedScan ? [
    selectedScan.target?.host,
    ...(selectedScan.target?.hosts || []),
    ...(selectedScan.result?.observations || []).map(observation => observation.host),
  ].filter(Boolean) : []);
  const scopedAssets = selectedScan
    ? assets.filter(asset => scopedHosts.has(asset.hostname))
    : assets;
  const displayScores = selectedScan
    ? deriveObservedCryptoPosture(scopedAssets)
    : scores;
  const total = scopedAssets.length;
  const critical = scopedAssets.filter(asset => ["CRITICAL", "HIGH"].includes(String(asset.prio).toUpperCase())).length;
  const safe = scopedAssets.filter(asset => ["HYBRID", "QUANTUM-SAFE"].includes(asset.cls)).length;
  const readiness = displayScores.readiness;
  const assessed = readiness.assessed;
  const horizon = QDAY_SCENARIOS[qdayScenario];
  const horizonDisplay = formatHorizon(daysUntil(horizon.date));
  const overviewSubtitle = profileComplete
    ? `${profile.name} readiness posture and next action.`
    : assets.length
      ? "Evidence exists. Complete organization setup to add business context before relying on the score."
      : "Complete organization setup, then collect the first evidence baseline.";
  return (
    <>
      <PageTitle
        title="Overview"
        subtitle={overviewSubtitle}
      >
        <button className="secondary" onClick={openOnboarding}>
          <Building2 />
          Onboarding
        </button>
        <button className="primary" onClick={runWorkflowNext}>
          <NextIcon />
          {workflow.next.cta}
        </button>
        <button className="secondary" onClick={() => openPlanForScope(scoreScope)}>
          <FileText />
          View plan
        </button>
      </PageTitle>
      {!profileComplete && (
        <article className="card setup-warning">
          <Building2 />
          <div>
            <b>Organization setup is not complete.</b>
            <p>
              Current scores use technical scan evidence only. Add organization name,
              industry, geography, and data context before using the score as a
              planning baseline.
            </p>
          </div>
          <button className="primary" onClick={openOnboarding}>
            Complete setup
          </button>
        </article>
      )}
      <section className="overview-grid">
        <article className="card readiness-summary">
          <div className="card-heading">
            <span>
              <ShieldCheck />
              {selectedScan ? "Observed crypto posture" : "Readiness"}
            </span>
            <CircleHelp />
          </div>
          <label className="score-scope">
            Score scope
            <select value={scoreScope} onChange={event => setScoreScope(event.target.value)}>
              <option value="organization">Overall organization</option>
              {completedScans.map(scan => (
                <option value={scan.id} key={scan.id}>
                  {scanTypeLabel(scan)} · {scan.targetLabel}
                </option>
              ))}
            </select>
          </label>
          <div className="readiness-content">
            <ScoreRing score={assessed ? readiness.score : null} label={selectedScan ? "Posture" : "Readiness"} />
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
                {assessed
                  ? selectedScan
                    ? `${total} observed asset${total === 1 ? "" : "s"} in this scan · ${critical} high-priority exposure${critical === 1 ? "" : "s"}.`
                    : `${critical} critical systems still depend on quantum-vulnerable cryptography.`
                  : "Complete onboarding and collect evidence to establish your first readiness baseline."}
              </p>
              <p className="score-meaning">
                {selectedScan
                  ? observedPostureMeaning(assessed ? readiness.score : null, critical)
                  : readinessMeaning(assessed ? readiness.score : null, critical)}
              </p>
              {assessed && <span className="direction better">↑ {readiness.direction}</span>}
            </div>
          </div>
          <button
            className="text-link"
            onClick={() => openResultsForScope(scoreScope)}
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
              value={qdayScenario}
              onChange={(event) => setQdayScenario(event.target.value)}
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
        <ReadinessDrivers scores={displayScores} setActive={setActive} scanScope={Boolean(selectedScan)} />
        <article className="card priorities">
          <div className="card-heading">
            <span>
              <Target />
              Top priorities
            </span>
            <button
              className="text-link"
              onClick={() => openPlanForScope(scoreScope)}
            >
              View all <ChevronRight />
            </button>
          </div>
          {assessed && scopedAssets.length ? [...scopedAssets].sort((a, b) => Number(b.risk || 0) - Number(a.risk || 0)).slice(0, 3).map((asset, i) => (
            <div className="priority-row" key={asset.id}>
              <span className="severity">{asset.prio || "Review"}</span>
              <div>
                <b>{asset.hostname}</b>
                <small>{asset.algo || "Unknown cryptography"}</small>
              </div>
              <span className={`mini-avatar a${i}`}>—</span>
              <span>Unassigned</span>
              <span>
                <Clock3 />
                Review
              </span>
              <button onClick={() => openPlanForScope(scoreScope)}>Open plan</button>
            </div>
          )) : <p className="empty-scans">No priorities in this scope. Run an authorized scan to collect evidence.</p>}
        </article>
        {scans.length > 0 && <button className="latest-scan" onClick={() => openResultsForScope(scans[0]?.id || "organization")}>
          <Globe2 />
          <span>
            <small>Latest scan evidence</small>
            <b>{scans[0]?.targetLabel}</b> —{" "}
            <strong>Evidence saved</strong> — {timeAgo(scans[0]?.completedAt)}
          </span>
          <ChevronRight />
        </button>}
      </section>
    </>
  );
}

function Scan({ scans, setScans, setActive, onEvidenceSaved, openResultsForScope, initialMode = "device" }) {
  const [mode, setMode] = useState(initialMode);
  const [target, setTarget] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [lastScanId, setLastScanId] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [port, setPort] = useState(443);
  const [timeoutMs, setTimeoutMs] = useState(2500);
  const [targetLimit, setTargetLimit] = useState(12);
  const [deviceScope, setDeviceScope] = useState("both");
  const [devicePorts, setDevicePorts] = useState("443, 8443, 3000");
  const [discoverActivePorts, setDiscoverActivePorts] = useState(true);
  const [networkPorts, setNetworkPorts] = useState("443, 8443");
  const [concurrency, setConcurrency] = useState(4);
  const [repositoryMaxFiles, setRepositoryMaxFiles] = useState(25000);
  const [repositoryMaxFileMb, setRepositoryMaxFileMb] = useState(2);
  useEffect(() => {
    if (!["public", "device", "network", "repository"].includes(initialMode)) return;
    setMode(initialMode);
    setTarget(
      initialMode === "public"
        ? ""
        : initialMode === "device"
          ? "Local machine"
          : initialMode === "repository"
            ? ""
            : "10.0.0.1, 10.0.0.2",
    );
    setRunning(false);
    setCompleted(false);
    setFailed(false);
    setLastResult(null);
    setLastScanId("");
    setProgress(0);
    setError("");
    setResultNote("");
  }, [initialMode]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setProgress((p) => Math.min(p + 7, 92)),
      450,
    );
    return () => clearInterval(timer);
  }, [running]);
  async function startScan(requestOverride = null) {
    const scanMode = requestOverride?.mode === "device"
      ? "device"
      : requestOverride?.mode === "discovery"
        ? "network"
        : requestOverride?.mode === "repository"
          ? "repository"
          : mode;
    const scanTarget = requestOverride?.host
      ?? requestOverride?.hosts?.join(", ")
      ?? requestOverride?.path
      ?? requestOverride?.target
      ?? target;
    if (requestOverride) {
      setMode(scanMode);
      setTarget(scanMode === "device" ? "Local machine" : scanTarget);
    }
    setError("");
    setResultNote("");
    setCompleted(false);
    setFailed(false);
    setLastResult(null);
    setLastScanId("");
    setRunning(true);
    setProgress(12);
    try {
      let request;
      const boundedPort = Math.max(1, Math.min(65535, Number(port) || 443));
      const boundedTimeout = Math.max(
        250,
        Math.min(scanMode === "public" ? 10000 : 5000, Number(timeoutMs) || 2500),
      );
      if (requestOverride) request = { ...requestOverride };
      else if (scanMode === "public")
        request = {
          mode: "tls",
          host: target.replace(/^https?:\/\//, "").split("/")[0],
          port: boundedPort,
          timeoutMs: boundedTimeout,
        };
      else if (scanMode === "device")
        request = {
          mode: "device",
          scope: deviceScope,
          ports: devicePorts
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map(Number)
            .slice(0, 8),
          discoverActivePorts,
          timeoutMs: boundedTimeout,
        };
      else if (scanMode === "network")
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
      else
        request = {
          path: target.trim(),
          maxFiles: Math.max(100, Math.min(100000, Number(repositoryMaxFiles) || 25000)),
          maxFileBytes: Math.max(100000, Math.min(10 * 1024 * 1024, Number(repositoryMaxFileMb) * 1024 * 1024 || 2 * 1024 * 1024)),
          actor: "QuantumSentinel UI",
        };
      const job = scanMode === "repository" ? await createRepositoryScan(request) : await createProbeJob(request);
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
          scanMode === "device"
            ? "Scan completed, but no active TCP or TLS services were detected on the selected or discovered loopback ports. No cryptographic evidence was collected."
            : "Scan completed, but no service evidence was detected on the authorized targets and ports.",
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
      setLastScanId(job.id);
      setLastResult({
        ...job.result,
        _riskScore: observedScore,
        _targetLabel: job.targetLabel || scanTarget,
      });
      setScans((prev) => [
        {
          ...job,
          targetLabel: job.targetLabel || scanTarget,
          riskScore: observedScore,
          completedAt: job.completedAt || new Date().toISOString(),
          status: job.status === "QUEUED" ? "RUNNING" : job.status,
        },
        ...prev.filter((s) => s.id !== job.id),
      ]);
      await onEvidenceSaved?.();
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
    ["public", Globe2, "Public website", "Start with one internet-facing TLS endpoint."],
    ["device", Laptop, "This device", "Check loopback TLS services on this machine."],
    ["network", Network, "Authorized network", "Test only approved hosts and ports."],
    ["repository", FolderGit2, "Repository", "Scan a local path or GitHub repository."],
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
    repository: {
      title: "Repository crypto scan",
      subtitle:
        "Scan source files in a local repository or GitHub repository.",
      steps: [
        "Resolve repository source",
        "Scan source files",
        "Classify cryptographic references",
        "Save CBOM and findings",
      ],
      scope:
        "Static source-code evidence from text files in the selected local repository or GitHub repository. It does not prove that a reference is reachable, deployed, configured, or used at runtime.",
      observations: [
        [
          FolderGit2,
          "Repository source",
          "Reads a local repository path or clones a GitHub repository for a bounded local scan.",
        ],
        [
          Search,
          "Text source files",
          "Scans recognized source, config, dependency, and documentation files.",
        ],
        [
          KeyRound,
          "Cryptographic references",
          "Detects RSA, ECC, deprecated primitives, PQC names, and symmetric or hash primitives.",
        ],
        [
          FileText,
          "CBOM evidence",
          "Creates repository components, findings, and a CBOM snapshot from observed source evidence.",
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
    mode === "public" ? Globe2 : mode === "device" ? Laptop : mode === "repository" ? FolderGit2 : Network;
  const discoverySummary = mode === "repository" ? null : lastResult?.summary;
  const resultClassification = lastResult?.classification;
  const resultFindings = lastResult?.findings || [];
  const resultFindingSummaries = summarizeFindings(resultFindings);
  const scanFindingOverview = discoverySummary
    ? `${discoverySummary.completedCount ?? 0} services produced evidence and ${discoverySummary.failedCount ?? 0} targets were unreachable or did not return usable TLS evidence.`
    : mode === "repository" && lastResult?.summary
      ? `${lastResult.summary.filesScanned ?? 0} files were scanned and ${lastResult.summary.actionableFindings ?? 0} actionable cryptographic finding${lastResult.summary.actionableFindings === 1 ? "" : "s"} were saved.`
      : resultClassification
      ? `${resultClassification.label || "Observed"} cryptography was recorded for this endpoint.`
      : "Evidence was recorded within this scan boundary.";
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
        : mode === "repository" && lastResult?.summary
          ? `${lastResult.summary.filesScanned ?? 0} files scanned · ${lastResult.summary.actionableFindings ?? 0} actionable findings · ${lastResult.score?.readinessScore ?? "not scored"}/100 readiness`
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
        : mode === "repository"
          ? [
              "This is a static source-code evidence scan",
              "It scans files in a selected repository. It does not prove that a cryptographic reference is built, configured, reachable, or deployed.",
            ]
        : [
            "This is a bounded host-and-port discovery",
            "It tests only the entered hosts on one port. It does not discover unknown devices, sweep networks, or inspect every service.",
          ];
  const evidenceCoverage = {
    public: {
      label: "Public endpoint",
      observed:
        "TLS version, negotiated cipher, certificate key algorithm, issuer, expiry, and forward-secrecy signal for one endpoint.",
      outside:
        "Internal PKI, stored data, VPNs, databases, code signing, vendor dependencies, and governance.",
      contribution:
        "Adds external endpoint evidence. It cannot independently establish organization-wide readiness.",
    },
    device: {
      label: "Local service",
      observed:
        "Reachability and available TLS evidence for the selected loopback service port on this machine.",
      outside:
        "Application and package inventory, filesystem cryptography, stored keys and data, and non-loopback services.",
      contribution:
        "Adds bounded local-service evidence. Full device readiness still requires dedicated inventory collectors.",
    },
    network: {
      label: "Authorized targets",
      observed:
        "TCP reachability and available TLS evidence for the explicitly authorized hosts on the selected port.",
      outside:
        "Unknown devices, unlisted ports, opaque appliances, stored data, application cryptography, and governance.",
      contribution:
        "Broadens environment evidence within the approved target list; it is not a network-wide attestation.",
    },
    repository: {
      label: "Repository",
      observed:
        "Source, config, dependency, and documentation references to cryptographic algorithms in the selected repository.",
      outside:
        "Runtime negotiation, deployed configuration, binary artifacts, private dependency behavior, production keys, and external services.",
      contribution:
        "Adds source-code evidence to the CBOM and migration plan. Confirm usage before closing a finding.",
    },
  }[mode];
  const selectMode = (id) => {
    setMode(id);
    setTarget(
      id === "public"
        ? ""
        : id === "device"
          ? "Local machine"
          : id === "repository"
            ? ""
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
          <div className="scan-choice-cards" aria-label="Choose scan type">
            {modes.map(([id, Icon, label, description]) => (
              <button
                className={mode === id ? "active" : ""}
                onClick={() => selectMode(id)}
                key={id}
              >
                <Icon />
                <span>
                  <b>{label}</b>
                  <small>{description}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="target-input">
            <Search />
            <input
              value={target}
              placeholder={
                mode === "public"
                  ? "For example www.google.com"
                  : mode === "repository"
                    ? "Local path or GitHub URL, for example /Users/me/app or https://github.com/org/repo"
                    : ""
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
              onClick={() => startScan()}
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
                  <label className="option-check">
                    <input
                      type="checkbox"
                      checked={discoverActivePorts}
                      onChange={(e) => setDiscoverActivePorts(e.target.checked)}
                    />
                    <span>
                      Discover active local ports
                      <small>Finds up to 32 listening TCP services and tests them only through loopback.</small>
                    </span>
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
              ) : mode === "network" ? (
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
              ) : (
                <>
                  <label>
                    <span>Maximum files</span>
                    <input
                      aria-label="Maximum repository files"
                      type="number"
                      min="100"
                      max="100000"
                      value={repositoryMaxFiles}
                      onChange={(e) => setRepositoryMaxFiles(e.target.value)}
                    />
                    <small>Bounds the static scan.</small>
                  </label>
                  <label>
                    <span>Maximum file size</span>
                    <select
                      aria-label="Maximum repository file size"
                      value={repositoryMaxFileMb}
                      onChange={(e) => setRepositoryMaxFileMb(e.target.value)}
                    >
                      <option value="1">1 MB</option>
                      <option value="2">2 MB</option>
                      <option value="5">5 MB</option>
                      <option value="10">10 MB</option>
                    </select>
                    <small>Oversized files are skipped.</small>
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
                        : mode === "repository"
                          ? "Repository source evidence"
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
                ? "Scan in progress"
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
                onClick={() => openResultsForScope(lastScanId || "organization")}
              >
                Review results <ChevronRight />
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
            ) : mode === "repository" ? (
              <div className="analysis-evidence-grid">
                <div><small>Files scanned</small><strong>{lastResult.summary?.filesScanned ?? "Recorded"}</strong></div>
                <div><small>Total findings</small><strong>{lastResult.summary?.totalFindings ?? "Recorded"}</strong></div>
                <div><small>Actionable findings</small><strong>{lastResult.summary?.actionableFindings ?? "Recorded"}</strong></div>
                <div><small>Readiness</small><strong>{lastResult.score?.readinessScore ?? "Not scored"}/100</strong></div>
              </div>
            ) : (
              <div className="analysis-evidence-grid">
                <div><small>Targets tested</small><strong>{discoverySummary?.targetsScanned ?? "Recorded"}</strong></div>
                <div><small>Services observed</small><strong>{discoverySummary?.completedCount ?? "Recorded"}</strong></div>
                <div><small>Unreachable</small><strong>{discoverySummary?.failedCount ?? "Recorded"}</strong></div>
              </div>
            )}
            <div className="analysis-findings">
              <h3>What the evidence means</h3>
              <p>{scanFindingOverview}</p>
              {resultFindingSummaries.length ? (
                <ul>{resultFindingSummaries.map(({ message, count }) => <li key={message}>{count > 1 ? `${message} (${count} times)` : message}</li>)}</ul>
              ) : (
                <p>No additional cryptographic findings were returned.</p>
              )}
              <div className="analysis-actions">
                <button className="primary" onClick={() => openResultsForScope(lastScanId || "organization")}>Review results <ChevronRight /></button>
                <button
                  className="secondary"
                  onClick={() => {
                    openResultsForScope(lastScanId || "organization");
                  }}
                >
                  Open scoped CBOM <ChevronRight />
                </button>
              </div>
            </div>
            <p className="analysis-boundary"><CircleHelp /><span><b>Interpretation boundary:</b> Endpoint evidence can identify exposed cryptography, but it cannot establish organization-wide Quantum Readiness without internal inventory, governance, and migration evidence.</span></p>
          </article>
        )}
        <RecentScans
          scans={scans}
          onRescan={(scan) => {
            const request = buildRescanRequest(scan);
            if (request) startScan(request);
            else {
              setError("This legacy scan does not contain enough target information to run again. Start a new scan instead.");
              setFailed(true);
            }
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
            onClick={() => setActive(ROUTES.results)}
          >
            Learn about scoring <ChevronRight />
          </button>
        </article>
        <article className="card evidence-coverage-card">
          <div className="card-heading">
            <span>
              <CircleHelp />
              Evidence coverage
            </span>
            <small>{evidenceCoverage.label}</small>
          </div>
          <p>Use this boundary when interpreting the result and any generated report.</p>
          <div className="coverage-row observed">
            <span><Check /></span>
            <div>
              <b>Observed by this scan</b>
              <small>{evidenceCoverage.observed}</small>
            </div>
          </div>
          <div className="coverage-row">
            <span><ShieldAlert /></span>
            <div>
              <b>Still outside scope</b>
              <small>{evidenceCoverage.outside}</small>
            </div>
          </div>
          <div className="coverage-row">
            <span><Target /></span>
            <div>
              <b>Readiness contribution</b>
              <small>{evidenceCoverage.contribution}</small>
            </div>
          </div>
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
                      : mode === "repository"
                        ? "Repository evidence collected—not runtime proof"
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
                    : mode === "repository"
                      ? "This describes only static repository evidence. Confirm runtime use, deployment state, and owner context before closing migration risk."
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
              {scan.type === "device" ? <Laptop /> : scan.type === "repository" ? <FolderGit2 /> : scan.type === "discovery" ? <Network /> : <Globe2 />}
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

function Readiness({ scores, data, embedded = false }) {
  const readiness = scores.readiness;
  const components = readiness.components;
  const criticalCount = data?.summary?.criticalCount ?? (data?.assets || []).filter(asset => ["CRITICAL", "HIGH"].includes(String(asset.prio).toUpperCase())).length;
  const [organizationTarget, setOrganizationTarget] = useState("2028-06-30");
  return (
    <>
      {!embedded && (
        <PageTitle
          title="Readiness"
          subtitle="How prepared the organization is to identify, prioritize, and migrate quantum-vulnerable systems."
        />
      )}
      <section className="content-grid">
        <article className="card score-explainer">
          <ScoreRing score={readiness.assessed ? readiness.score : null} />
          <div>
            <span className="eyebrow">
              The Quantum Readiness Score · Higher is better
            </span>
            <h2>
              {readiness.assessed
                ? `${readiness.score} / 100 · ${readiness.classification}`
                : "Not yet assessed"}
            </h2>
            <p>
              {readiness.assessed
                ? "This is QuantumSentinel’s single headline score. It evaluates modernization, inventory coverage, migration planning, governance, and compensating controls from the available evidence."
                : "QuantumSentinel will calculate a score after real cryptographic evidence has been collected. Zero is not displayed because no evidence is not the same as zero readiness."}
            </p>
            <p className="score-meaning">
              {readinessMeaning(readiness.assessed ? readiness.score : null, criticalCount)}
            </p>
            {readiness.assessed && <span className="confidence-pill">
              {scores.confidence.label} · {scores.confidence.coverage}% coverage
            </span>}
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

function Exposure({ data, embedded = false }) {
  const assets = data?.assets || [];
  const [assetFilter, setAssetFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState(null);
  const critical = assets.filter((asset) => asset.prio === "CRITICAL").length;
  const sourceAssets = assets;
  const hndlCandidates = assets.filter(
    (asset) => asset.cls === "SHOR-CRITICAL" || Number(asset.hndl) >= 70,
  ).length;
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
      {!embedded && (
        <PageTitle
          title="Risk Findings"
          subtitle="Where quantum-vulnerable cryptography creates urgency across the observed environment."
        >
          <button className="secondary" onClick={exportSnapshot}>
            <FileDown />
            Export snapshot
          </button>
        </PageTitle>
      )}
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
          value={hndlCandidates}
          label="HNDL candidates"
          tone="red"
        />
        <Metric icon={FileText} value={tnflAssets.length} label="TNFL candidates" tone="red" trend="Signature and trust exposure" />
        <article className="card tnfl-card"><div className="card-heading"><span><FileText />Signature & trust exposure (TNFL)</span><small>Derived from observed asset role, protocol, algorithm, trust relevance, and existing TNFL risk evidence.</small></div><p>Trust-now-forge-later analysis identifies systems whose signatures or trust assertions may need to remain valid after classical public-key cryptography becomes vulnerable.</p><div className="tnfl-list">{tnflAssets.length ? tnflAssets.slice(0, 5).map(asset => <button key={asset.id || asset.hostname || asset.name} onClick={() => setSelectedAsset(asset)}><span className="tnfl-score">{Math.round(Number(asset.tnfl))}</span><span><b>{asset.hostname || asset.name || asset.id}</b><small>{tnflReason(asset)}</small></span><span>{asset.migration || "Define signature migration target"}</span><ChevronRight /></button>) : <p className="empty-scans">No signature or trust exposure evidence yet. Run an authorized scan to establish a baseline.</p>}</div><div className="tnfl-note"><CircleHelp /><span><b>What this function measures:</b> a prioritized signature/trust exposure signal from collected evidence. It is not proof that an artifact can be forged, and missing signing evidence remains an assessment gap.</span></div></article>
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
            <p className="empty-scans">
              {sourceAssets.length
                ? "No assets match this exposure filter."
                : "No exposure evidence yet. Run an authorized scan to collect evidence."}
            </p>
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

function Remediation({ data, scans = [], scores, profile, qdayScenario }) {
  const legacySeedIds = new Set(["rsa-gateway", "hybrid-vpn", "root-hierarchy"]);
  const [actions, setActions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("quantumsentinel-remediation-actions") || "null");
      return Array.isArray(stored) ? stored.filter((action) => !legacySeedIds.has(action.id)) : [];
    } catch {
      return [];
    }
  });
  const evidenceActions = useMemo(() => (data?.assets || [])
    .filter((asset) => !["HYBRID", "QUANTUM-SAFE"].includes(asset.cls))
    .map((asset) => {
      const assetName = asset.hostname || asset.name || String(asset.id);
      const sourceScan = scans.find((scan) => {
        const directHost = scan.target?.host ?? scan.request?.host;
        const observations = scan.result?.observations || [];
        return directHost === assetName || observations.some((observation) => observation.host === assetName);
      });
      const scanType = sourceScan?.type === "device"
        ? "This device"
        : sourceScan?.type === "discovery"
          ? "Authorized network"
          : sourceScan?.type === "tls"
            ? "Website"
            : "Imported evidence";
      return {
        id: `evidence-${asset.id}`,
        title: `Modernize ${assetName}`,
        asset: assetName,
        scanType,
        owner: "Unassigned",
        due: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
        status: "Planned",
        sourceKind: "Generated recommendation",
        urgency: Number(asset.risk) || 50,
        target: asset.migration || "Define a hybrid or post-quantum target state",
        evidenceNeeded: "Owner approval, implementation record, updated CBOM, and post-change scan evidence.",
      };
    }), [data, scans]);
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
  const allActions = [...actions, ...evidenceActions.filter((item) => !actions.some((action) => action.asset === item.asset))];
  const sortedActions = [...allActions].sort((a, b) => {
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
      scanType: "Manual plan",
      urgency: 75,
      target: "Inventory, pilot, and migrate priority cryptography",
      evidenceNeeded: "Approved scope, pilot result, updated CBOM, and validation scan.",
    };
    setActions(current => [newAction, ...current]);
    setPlanOpen(false);
    setSelectedAction(newAction);
    downloadMigrationPlan(newAction);
  };
  const openCount = allActions.filter(action => action.status !== "Completed").length;
  const progressCount = allActions.filter(action => action.status === "In progress").length;
  const completedCount = allActions.filter(action => action.status === "Completed").length;
  const brief = deriveMigrationBrief(scores, data, profile, qdayScenario, scans);
  const migrationReport = () => buildReportRecord(REPORT_TYPES[3], scores, data, profile, qdayScenario, scans);
  return (
    <>
      <PageTitle
        title="Migration Plan"
        subtitle="Turn quantum risk into an owned, sequenced migration plan."
      >
        <button className="primary" onClick={() => setPlanOpen(true)}>
          <Wrench />
          Create plan
        </button>
        <button className="secondary" onClick={() => downloadReportPdf(migrationReport())}>
          <FileDown />
          Download migration report
        </button>
      </PageTitle>
      <section className="content-grid">
        <Metric icon={Target} value={openCount} label="open actions" tone="red" />
        <Metric icon={Activity} value={progressCount} label="in progress" tone="blue" />
        <Metric icon={Check} value={completedCount} label="completed" tone="green" />
        <article className="card migration-pathway">
          <div>
            <span className="eyebrow">Path forward</span>
            <h2>{brief.organizationName} migration pathway</h2>
            <p>
              The selected {brief.qdayHorizon.label} horizon leaves {brief.qdayHorizon.display}.
              Set the internal readiness checkpoint by {brief.qdayHorizon.readinessDeadline}.
            </p>
          </div>
          <div className="pathway-grid">
            <span><b>{brief.readinessScore}</b><small>Q-Day score</small></span>
            <span><b>{brief.cbom.count}</b><small>CBOM components</small></span>
            <span><b>{brief.criticalCount}</b><small>priority assets</small></span>
            <span><b>{brief.hndlCount + brief.tnflCount}</b><small>HNDL/TNFL signals</small></span>
          </div>
          <div className="pathway-timeline">
            {MIGRATION_PHASES.slice(0, 4).map(([title, work], index) => (
              <div key={title}>
                <span className="step-number">{index + 1}</span>
                <b>{title}</b>
                <small>{work}</small>
              </div>
            ))}
          </div>
        </article>
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
          {sortedActions.length ? sortedActions.map((action, i) => (
            <div className="asset-row" key={action.id}>
              <span className={`step-number s${i}`}>{i + 1}</span>
              <div>
                <b>{action.title}</b>
                <small>{action.asset}</small>
                <small>Target: {action.target}</small>
                <small>Evidence: {action.evidenceNeeded || evidenceNeededForAction(action)}</small>
              </div>
              <span className="scan-type-pill">{action.scanType || "Manual plan"}</span>
              <span>{action.owner}</span>
              <span>{new Date(`${action.due}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span className={`status-pill ${action.status.toLowerCase().replace(" ", "-")}`}>{action.status}</span>
              <button onClick={() => setSelectedAction(action)}>
                Open <ChevronRight />
              </button>
            </div>
          )) : <p className="empty-scans">No remediation actions yet. Findings from completed scans will appear here.</p>}
        </article>
      </section>
      {planOpen && <div className="plan-backdrop" role="presentation"><form className="card plan-dialog" role="dialog" aria-modal="true" aria-label="Create migration plan" onSubmit={createPlan}><div className="plan-dialog-heading"><div><span className="eyebrow">New remediation plan</span><h2>Create an owned migration action</h2><p>Start with a named outcome, accountable owner, and readiness deadline.</p></div><button type="button" className="icon-button" onClick={() => setPlanOpen(false)} aria-label="Close plan builder">×</button></div><label>Plan name<input required value={planName} onChange={event => setPlanName(event.target.value)} /></label><label>Owner<input value={planOwner} onChange={event => setPlanOwner(event.target.value)} placeholder="Name or team" /></label><label>Target completion date<input required type="date" value={planDeadline} onChange={event => setPlanDeadline(event.target.value)} /></label><div className="plan-actions"><button type="button" className="secondary" onClick={() => setPlanOpen(false)}>Cancel</button><button type="submit" className="primary"><Check />Add to migration queue</button></div></form></div>}
      {selectedAction && <aside className="asset-drawer remediation-drawer" role="dialog" aria-modal="true" aria-label="Migration action details"><div className="asset-drawer-heading"><span className="metric-icon blue"><Wrench /></span><div><span className="eyebrow">Migration action</span><h2>{selectedAction.title}</h2></div><button className="icon-button" onClick={() => setSelectedAction(null)} aria-label="Close migration action details">×</button></div><div className="drawer-actions"><button className="primary" onClick={() => downloadMigrationPlan(selectedAction)}><FileDown />Download migration plan PDF</button></div><dl><div><dt>Asset or scope</dt><dd>{selectedAction.asset}</dd></div><div><dt>Owner</dt><dd>{selectedAction.owner}</dd></div><div><dt>Status</dt><dd>{selectedAction.status}</dd></div><div><dt>Urgency</dt><dd>{selectedAction.urgency}/100</dd></div><div><dt>Due date</dt><dd>{new Date(`${selectedAction.due}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Target state</dt><dd>{selectedAction.target}</dd></div><div><dt>Evidence needed</dt><dd>{selectedAction.evidenceNeeded || evidenceNeededForAction(selectedAction)}</dd></div></dl><p><b>Planning boundary:</b> This is an accountable migration action. Completion should only be recorded when supporting implementation and validation evidence exists.</p></aside>}
    </>
  );
}

const REPORT_TYPES = [
  { id: "executive", title: "Executive posture", description: "Headline readiness, confidence, critical exposure, and priority decisions.", sections: ["Readiness summary", "Material exposure", "Leadership decisions", "Evidence limitations"] },
  { id: "readiness", title: "Q-Day readiness", description: "Score methodology, evidence coverage, readiness drivers, and organizational timeline.", sections: ["Quantum Readiness Score", "Weighted score components", "Evidence confidence", "Readiness timeline"] },
  { id: "exposure", title: "Exposure findings", description: "Critical findings, HNDL and TNFL candidates, affected assets, and observed cryptography.", sections: ["Exposure summary", "Critical assets", "HNDL and TNFL signals", "Observed evidence boundary"] },
  { id: "migration", title: "Migration plan", description: "Owners, milestones, dependencies, target states, and validation requirements.", sections: ["Prioritized backlog", "Migration phases", "Ownership and deadlines", "Completion evidence"] },
];

function assetName(asset) {
  return asset?.hostname || asset?.name || String(asset?.id ?? "Unknown asset");
}

function targetState(asset) {
  return asset?.migration && !/^N\/A$/i.test(String(asset.migration))
    ? asset.migration
    : "Define a hybrid or PQC target state";
}

function assetExposureReason(asset) {
  const reasons = [];
  if (asset?.cls === "SHOR-CRITICAL") reasons.push("uses quantum-vulnerable public-key cryptography");
  if (asset?.cls === "DEPRECATED") reasons.push("uses deprecated cryptography");
  if (asset?.pfs === false) reasons.push("does not show forward secrecy");
  if (Number(asset?.hndl) >= 70) reasons.push("has HNDL relevance");
  if (Number(asset?.tnfl) >= 70) reasons.push("has TNFL relevance");
  if (asset?.prio === "CRITICAL") reasons.push("supports a critical system");
  return reasons.length ? reasons.join("; ") : "requires cryptographic review";
}

function dueDate(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function horizonContext(qdayScenario) {
  const scenario = QDAY_SCENARIOS[qdayScenario] || QDAY_SCENARIOS.ionq;
  const days = daysUntil(scenario.date);
  const display = formatHorizon(days);
  return {
    ...scenario,
    days,
    label: scenario.label,
    display: `${display.primary} ${display.secondary}`,
    readinessDeadline: dueDate(Math.max(30, Math.min(365, Math.floor(days * 0.55)))),
  };
}

function scanEvidenceSummary(scans = []) {
  const completed = scans.filter(scan => scan.status === "COMPLETED");
  if (!completed.length) return "No completed scans are saved.";
  return completed.slice(0, 4).map(scan => {
    const type = scanTypeLabel(scan);
    return `${type}: ${scan.targetLabel || scan.target?.host || scan.id}`;
  }).join("; ");
}

function summarizeFindings(messages = []) {
  return Object.entries(messages.reduce((acc, message) => {
    const normalized = typeof message === "string"
      ? message.trim()
      : String(message?.title || message?.rationale || message?.recommendation || message?.algorithm || "").trim();
    if (!normalized) return acc;
    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {})).map(([message, count]) => ({ message, count }));
}

function resultInterpretation(readiness, criticalCount, confidenceLabel, scoped = false) {
  if (!readiness?.assessed) {
    return {
      title: "No decision should be made yet",
      body: "Run an authorized scan before using the Results page for readiness or migration planning.",
      next: "Start with one public endpoint or this device.",
    };
  }
  if (criticalCount > 0) {
    return {
      title: scoped ? "This scan needs migration review" : "Priority migration work exists",
      body: `${criticalCount} priority finding${criticalCount === 1 ? "" : "s"} require owner assignment, target-state review, and validation evidence.`,
      next: "Open the Plan page and assign owners to the priority queue.",
    };
  }
  if (/low/i.test(confidenceLabel || "")) {
    return {
      title: "The blocker is evidence confidence",
      body: "Current evidence does not show priority exposure, but the collection boundary is still narrow.",
      next: "Add internal inventory, device, network, or repository evidence before closing risk.",
    };
  }
  return {
    title: "Preserve validation evidence",
    body: "Observed cryptography has no current priority finding in this scope.",
    next: "Keep the CBOM current and rescan after changes.",
  };
}

function deriveMigrationBrief(scores, data, profile = {}, qdayScenario = "ionq", scans = []) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const findings = Array.isArray(data?.findings) ? data.findings : [];
  const cbom = localCbomFromAssets(assets);
  const horizon = horizonContext(qdayScenario);
  const observedAssets = assets.length;
  const safeAssets = assets.filter(asset => ["HYBRID", "QUANTUM-SAFE"].includes(asset.cls)).length;
  const plannedAssets = assets.filter(asset => asset.migration && !/^N\/A$/i.test(String(asset.migration))).length;
  const criticalAssets = assets
    .filter(asset => asset.prio === "CRITICAL" || Number(asset.risk) >= 75)
    .toSorted((left, right) => Number(right.risk || 0) - Number(left.risk || 0));
  const hndlCandidates = assets.filter(asset => asset.cls === "SHOR-CRITICAL" || Number(asset.hndl) >= 70);
  const tnflCandidates = assets.filter(asset => Number(asset.tnfl) >= 70);
  const openFindings = findings.filter(finding => !["closed", "remediated"].includes(String(finding.status || "").toLowerCase()));
  const evidenceCoverage = scores.confidence.coverage;
  const migrationCoverage = observedAssets ? Math.round((plannedAssets / observedAssets) * 100) : 0;
  const safeCoverage = observedAssets ? Math.round((safeAssets / observedAssets) * 100) : 0;
  const readinessScore = scores.readiness.assessed ? scores.readiness.score : null;

  const backlog = criticalAssets.slice(0, 6).map((asset, index) => ({
    rank: index + 1,
    asset: assetName(asset),
    urgency: Number(asset.risk) || Number(asset.hndl) || 50,
    reason: assetExposureReason(asset),
    owner: "Assign system owner",
    deadline: dueDate(index < 2 ? 45 : 90),
    target: targetState(asset),
    validation: "Rescan after change and attach implementation evidence.",
  }));

  const decisionRequired = [
    {
      title: "Set migration authority",
      owner: "CTO or security executive",
      decision: "Name the executive sponsor and migration owner.",
      due: dueDate(14),
    },
    {
      title: "Approve scope",
      owner: "Security architecture",
      decision: "Approve the systems, data flows, vendors, and trust anchors in scope.",
      due: dueDate(30),
    },
    {
      title: "Fund priority pilots",
      owner: "Platform and application leads",
      decision: "Select the first hybrid or PQC pilots for the highest-risk systems.",
      due: dueDate(45),
    },
  ];

  const blockers = [];
  if (evidenceCoverage < 80) blockers.push("Evidence coverage is below 80%. Complete inventory before final risk acceptance.");
  if (migrationCoverage < 60) blockers.push("Most observed assets do not have a target migration state.");
  if (criticalAssets.length) blockers.push(`${criticalAssets.length} critical assets need owner, deadline, and validation evidence.`);
  if (!hndlCandidates.length && observedAssets) blockers.push("No HNDL candidates are tagged. Confirm data lifetime assumptions.");
  if (!tnflCandidates.length && observedAssets) blockers.push("No TNFL candidates are tagged. Confirm signing and trust-chain evidence.");
  if (!observedAssets) blockers.push("No assets are observed. Run a scan before using the report for decisions.");

  const evidenceGaps = [
    "Internal PKI, code signing, databases, key stores, and vendor dependencies are not proven by a public TLS scan.",
    "Unknown cryptography must remain an evidence gap until a collector or owner confirms it.",
    "Completion requires implementation evidence, validation evidence, an updated inventory, and a rescan.",
  ];

  const nextAction = !observedAssets
    ? "Run an authorized scan and create the first evidence baseline."
    : criticalAssets.length
      ? `Assign owners and deadlines for ${Math.min(criticalAssets.length, 6)} priority assets.`
      : migrationCoverage < 80
        ? "Document the target migration state for each observed asset."
        : "Validate implemented controls and preserve closure evidence.";

  const briefStatus = readinessScore == null
    ? "Evidence baseline required"
    : readinessScore < 50
      ? "Migration program required"
      : readinessScore < 70
        ? "Migration execution required"
        : "Validation and operation required";

  return {
    briefStatus,
    nextAction,
    readinessScore: readinessScore ?? "Not assessed",
    readinessClass: scores.readiness.classification,
    confidence: scores.confidence.level,
    evidenceCoverage,
    migrationCoverage,
    safeCoverage,
    observedAssets,
    criticalCount: criticalAssets.length,
    hndlCount: hndlCandidates.length,
    tnflCount: tnflCandidates.length,
    openFindingCount: openFindings.length,
    backlog,
    decisionRequired,
    blockers,
    evidenceGaps,
    organizationName: profile?.name || "The organization",
    industry: profile?.industry || "Unspecified industry",
    geography: profile?.geography || "Unspecified geography",
    cbom,
    scanSummary: scanEvidenceSummary(scans),
    qdayHorizon: horizon,
  };
}

function buildReportRecord(type, scores, data, profile = {}, qdayScenario = "ionq", scans = []) {
  const brief = deriveMigrationBrief(scores, data, profile, qdayScenario, scans);
  const summary = data?.summary || {};
  const metrics = {
    organization: brief.organizationName,
    readinessScore: scores.readiness.assessed ? scores.readiness.score : "Not assessed",
    readinessClassification: scores.readiness.classification,
    qdayScenario: brief.qdayHorizon.label,
    qdayHorizon: brief.qdayHorizon.display,
    readinessDeadline: brief.qdayHorizon.readinessDeadline,
    evidenceConfidence: scores.confidence.level,
    evidenceCoveragePct: scores.confidence.coverage,
    observedAssets: summary.totalAssets || data?.assets?.length || 0,
    completedScans: scans.filter(scan => scan.status === "COMPLETED").length,
    cbomComponents: brief.cbom.count,
    criticalExposures: summary.criticalCount || 0,
    hndlCandidates: summary.shorCount || 0,
    tnflCandidates: (data?.assets || []).filter(asset => Number(asset.tnfl) >= 70).length,
    quantumSafeAssets: summary.safeCount || 0,
  };
  const criticalNames = (data?.assets || []).filter(asset => asset.prio === "CRITICAL").slice(0, 4).map(asset => asset.hostname || asset.name || asset.id).filter(Boolean);
  const executiveSections = [
    { title: "Readiness summary", body: `${brief.organizationName} is ${metrics.readinessClassification.toLowerCase()} at ${metrics.readinessScore}/100 readiness against the ${brief.qdayHorizon.label} planning scenario. Evidence confidence is ${String(metrics.evidenceConfidence).toLowerCase()} with ${metrics.evidenceCoveragePct}% measured field coverage.`, bullets: [`${metrics.quantumSafeAssets} of ${metrics.observedAssets} observed assets currently show hybrid or quantum-safe evidence.`, `${metrics.cbomComponents} CBOM components are included in this evidence snapshot.`, `Target readiness checkpoint: ${brief.qdayHorizon.readinessDeadline}.`] },
    { title: "Material exposure", body: `${metrics.criticalExposures} critical exposures, ${metrics.hndlCandidates} HNDL candidates, and ${metrics.tnflCandidates} TNFL signature/trust candidates require executive attention. Public-facing observations show only the external cryptographic posture; internal PKI, stored data, code signing, VPNs, and vendor dependencies may carry additional exposure.`, bullets: criticalNames.length ? criticalNames.map(name => `${name} is currently classified as a critical observed asset.`) : ["No named critical assets were available in the current evidence snapshot.", "Complete internal discovery before treating the exposure count as comprehensive."] },
    { title: "Leadership decisions", body: `Current decision state: ${brief.briefStatus}. Next action: ${brief.nextAction}`, bullets: brief.decisionRequired.map(item => `${item.owner}: ${item.decision} Due ${item.due}.`) },
    { title: "Evidence limitations", body: "This posture is bounded by the evidence QuantumSentinel can currently observe. A TLS endpoint, device collector, or authorized network scan cannot by itself establish organization-wide quantum readiness.", bullets: ["Public scans observe negotiated TLS and presented certificate evidence, not internal systems.", "Device and network collection is limited to approved scope, reachable services, and available metadata.", "A completed migration requires implementation, validation, inventory, and rescan evidence.", "Scores and counts should be refreshed whenever systems, algorithms, policies, or data-lifetime assumptions change."] },
  ];
  const readinessSections = [
    { title: "Quantum Readiness Score", body: `The current score for ${brief.organizationName} is ${metrics.readinessScore}/100 (${metrics.readinessClassification}). The score is interpreted against the selected ${brief.qdayHorizon.label} scenario, which has ${brief.qdayHorizon.display} remaining.`, bullets: ["0-24: unprepared; 25-49: early-stage; 50-69: transitioning.", "70-84: prepared; 85-100: quantum-ready.", `${metrics.evidenceConfidence} evidence confidence means the score should be interpreted with the documented collection boundary.`] },
    { title: "Weighted score components", body: "Each component contributes a defined share of the single readiness score. Improving a weak component raises readiness only when supporting evidence is collected.", bullets: Object.entries(scores.readiness?.components || {}).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${Math.round(value)} evidence points.`) },
    { title: "Evidence confidence", body: `${metrics.evidenceCoveragePct}% field coverage describes completeness of the fields currently measured, not completeness of the entire environment. Confidence must also reflect source quality, scan scope, and the age of evidence.`, bullets: ["Public TLS evidence covers one presented endpoint.", "Device and network evidence covers only authorized and reachable scope.", "Governance and migration assertions require documentary and implementation evidence."] },
    { title: "Readiness timeline", body: `${brief.organizationName} should set an internal readiness checkpoint by ${brief.qdayHorizon.readinessDeadline}. This date precedes the selected ${brief.qdayHorizon.label} horizon and creates time for validation, exceptions, and rescan evidence.`, bullets: ["Set a complete inventory baseline first.", "Pilot priority protocols and trust chains next.", "Finish critical-system cutover, rescan, and evidence review before declaring readiness."] },
  ];
  const exposureSections = [
    { title: "Exposure summary", body: `${metrics.criticalExposures} critical exposures were identified across ${metrics.observedAssets} observed assets. ${metrics.quantumSafeAssets} assets currently show hybrid or quantum-safe evidence.`, bullets: ["Exposure indicates reliance on potentially vulnerable cryptography; it is not proof of compromise.", "Counts reflect observed evidence and can rise as inventory coverage expands.", "Priority should combine cryptographic posture, data lifetime, business criticality, and migration complexity."] },
    { title: "Critical assets", body: criticalNames.length ? `The current critical set includes ${criticalNames.join(", ")}.` : "The current snapshot does not provide named critical assets.", bullets: criticalNames.length ? criticalNames.map(name => `${name}: confirm owner, data lifetime, dependencies, and target migration state.`) : ["Run authorized internal discovery and reconcile the results with the asset inventory."] },
    { title: "HNDL and TNFL signals", body: `${metrics.hndlCandidates} assets show evidence relevant to harvest-now-decrypt-later analysis and ${metrics.tnflCandidates} assets meet the current TNFL signature/trust threshold. TNFL prioritization is derived from observed role, protocol, algorithm, certificate, trust relevance, and migration evidence.`, bullets: ["Prioritize confidential data whose required lifetime extends beyond plausible migration timelines.", "Prioritize certificate authorities, code signing, identity systems, and other long-lived trust anchors by TNFL score.", "Collect missing signing and trust-chain evidence; absence of evidence must not lower exposure.", "Forward secrecy can reduce some session exposure but does not make vulnerable public-key infrastructure quantum-safe."] },
    { title: "Observed evidence boundary", body: "Observed public, device, and network cryptography provides a starting point, not an organization-wide attestation.", bullets: ["Public endpoints do not expose internal PKI, databases, stored ciphertext, or governance.", "Unreachable services and opaque vendor components remain evidence gaps.", "Unknown fields must be investigated and never counted as safe."] },
  ];
  const migrationSections = [
    { title: "Program context", body: `${brief.organizationName} operates in ${brief.industry} with primary geography ${brief.geography}. Current scan evidence: ${brief.scanSummary}. The CBOM contains ${brief.cbom.count} cryptographic components.`, bullets: [`Selected Q-Day planning scenario: ${brief.qdayHorizon.label}.`, `Time remaining in scenario: ${brief.qdayHorizon.display}.`, `Internal readiness checkpoint: ${brief.qdayHorizon.readinessDeadline}.`] },
    { title: "Prioritized backlog", body: `${brief.criticalCount} critical assets, ${brief.hndlCount} HNDL candidates, and ${brief.tnflCount} TNFL candidates form the current migration backlog. Sequence work by business impact, data lifetime, dependency depth, and feasibility.`, bullets: brief.backlog.length ? brief.backlog.map(item => `${item.asset}: ${item.reason}. Target: ${item.target}. Due ${item.deadline}.`) : ["Complete discovery before finalizing the backlog."] },
    { title: "Generalized migration timeline", body: `Use an evidence-gated sequence that reaches validation before ${brief.qdayHorizon.readinessDeadline}. The timeline must compress if scan coverage expands or the Q-Day horizon moves earlier.`, bullets: MIGRATION_PHASES.map(([title, work]) => `${title}: ${work}`) },
    { title: "Ownership and deadlines", body: "Every action requires one accountable owner, a funded delivery team, a target date, and explicit dependency and exception management.", bullets: ["Executive sponsor: resolves funding, risk acceptance, and cross-business conflicts.", "System owner: validates availability, interoperability, and rollback requirements.", "Security and architecture: approve target profiles and validation evidence.", "Procurement and legal: enforce vendor disclosure and migration commitments."] },
    { title: "Completion evidence", body: "A migration item is complete only when implementation and validation evidence demonstrates the target state in production.", bullets: ["Approved architecture and change record.", "Test and pilot results, including failure and rollback behavior.", "Updated cryptographic inventory or CBOM.", "Post-change scan confirming expected cryptography and no regression.", "Documented, time-bounded exceptions with compensating controls."] },
  ];
  const sectionsByType = { executive: executiveSections, readiness: readinessSections, exposure: exposureSections, migration: migrationSections };
  return {
    reportId: `${type.id}-${Date.now()}`,
    type: type.id,
    title: type.id === "migration" ? `${brief.organizationName} PQC Migration Plan` : type.title,
    generatedAt: new Date().toISOString(),
    description: type.description,
    sections: sectionsByType[type.id],
    metrics,
    brief,
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

function downloadJsonPayload(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
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
  if (report.brief) {
    pdf.setFont("helvetica", "bold"); write("Migration decision state", 16, [14, 35, 70], 8);
    pdf.setFont("helvetica", "normal"); write(`${report.brief.briefStatus}. ${report.brief.nextAction}`, 10, [54, 72, 103], 10);
    report.brief.decisionRequired.forEach(item => {
      ensure(34);
      write(`${item.owner}: ${item.decision} Due ${item.due}.`, 9, [54, 72, 103], 4, 14);
    });
    y += 8;
  }
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

function Reports({ scores, data, profile, qdayScenario, scans, embedded = false }) {
  const [selectedReport, setSelectedReport] = useState(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generatorType, setGeneratorType] = useState("migration");
  const brief = deriveMigrationBrief(scores, data, profile, qdayScenario, scans);
  const openReport = type => setSelectedReport(buildReportRecord(type, scores, data, profile, qdayScenario, scans));
  const generatedReport = () => buildReportRecord(REPORT_TYPES.find(type => type.id === generatorType), scores, data, profile, qdayScenario, scans);
  const posture = scores.readiness.assessed
    ? `Readiness ${scores.readiness.score}/100 · ${scores.readiness.classification} · ${scores.confidence.level} confidence`
    : "Not yet assessed · collect evidence before generating a posture score";
  const primaryReport = buildReportRecord(REPORT_TYPES[3], scores, data, profile, qdayScenario, scans);
  return (
    <>
      {!embedded && (
        <PageTitle
          title="PQC Migration Plan"
          subtitle={`${brief.organizationName}: scan evidence, CBOM, Q-Day score, and migration path.`}
        >
          <button className="primary" onClick={() => downloadReportPdf(primaryReport)}>
            <FileDown />
            Download PQC migration plan
          </button>
          <button className="secondary" onClick={() => setGeneratorOpen(true)}>
            <FileText />
            Other exports
          </button>
        </PageTitle>
      )}
      <section className="brief-grid">
        <article className="card brief-hero">
          <div>
            <span className="eyebrow">Decision state</span>
            <h2>{brief.briefStatus}</h2>
            <p>{brief.nextAction}</p>
          </div>
          <ScoreRing score={Number.isFinite(brief.readinessScore) ? brief.readinessScore : null} label="Readiness" />
          <div className="brief-actions">
            <button className="primary" onClick={() => downloadReportPdf(primaryReport)}>
              <FileDown />
              Download PDF
            </button>
            <button className="secondary" onClick={() => openReport(REPORT_TYPES[3])}>
              Open plan <ChevronRight />
            </button>
          </div>
        </article>
        <article className="card brief-metrics">
          <div><small>Evidence confidence</small><strong>{brief.confidence}</strong><span>{brief.evidenceCoverage}% coverage</span></div>
          <div><small>Observed assets</small><strong>{brief.observedAssets}</strong><span>{brief.safeCoverage}% hybrid or safe</span></div>
          <div><small>Critical assets</small><strong>{brief.criticalCount}</strong><span>{brief.openFindingCount} open findings</span></div>
          <div><small>HNDL / TNFL</small><strong>{brief.hndlCount} / {brief.tnflCount}</strong><span>priority candidates</span></div>
        </article>
        <article className="card brief-section">
          <div className="card-heading">
            <span><Target />Priority migration backlog</span>
            <small>{brief.migrationCoverage}% with target state</small>
          </div>
          <div className="brief-backlog">
            {brief.backlog.length ? brief.backlog.map(item => (
              <div className="brief-backlog-row" key={`${item.rank}-${item.asset}`}>
                <span className="step-number">{item.rank}</span>
                <div>
                  <b>{item.asset}</b>
                  <small>{item.reason}</small>
                </div>
                <span>{item.target}</span>
                <span>{item.owner}</span>
                <strong>{item.deadline}</strong>
              </div>
            )) : <p className="empty-scans">No priority backlog exists yet. Run a scan or complete the asset inventory.</p>}
          </div>
        </article>
        <article className="card brief-section">
          <div className="card-heading">
            <span><ShieldAlert />Blockers and evidence gaps</span>
          </div>
          <div className="brief-list">
            {brief.blockers.map(item => <p key={item}><ShieldAlert />{item}</p>)}
            {brief.evidenceGaps.map(item => <p key={item}><CircleHelp />{item}</p>)}
          </div>
        </article>
        <article className="card brief-section">
          <div className="card-heading">
            <span><Building2 />Decisions required</span>
          </div>
          <div className="decision-list">
            {brief.decisionRequired.map(item => (
              <div key={item.title}>
                <b>{item.title}</b>
                <span>{item.owner}</span>
                <p>{item.decision}</p>
                <small>Due {item.due}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="card brief-section">
          <div className="card-heading">
            <span><FileText />Secondary export packages</span>
            <small>{posture}</small>
          </div>
          <div className="report-grid brief-report-grid">
            {REPORT_TYPES.map((type, index) => (
              <article className="report-card" key={type.id}>
                <span className={`report-icon r${index}`}><FileText /></span>
                <div>
                  <h2>{type.title}</h2>
                  <p>{type.description}</p>
                  <small>Includes migration brief context.</small>
                </div>
                <button className="secondary" onClick={() => openReport(type)}>
                  Open <ChevronRight />
                </button>
              </article>
            ))}
          </div>
        </article>
      </section>
      {generatorOpen && (
        <div className="plan-backdrop">
          <div className="card plan-dialog" role="dialog" aria-modal="true" aria-label="Generate migration brief">
            <div className="plan-dialog-heading">
              <div>
                <span className="eyebrow">Secondary exports</span>
                <h2>Choose another output package</h2>
                <p>The default export is the PQC migration plan PDF.</p>
              </div>
              <button className="icon-button" onClick={() => setGeneratorOpen(false)} aria-label="Close report generator">×</button>
            </div>
            <label>
              Output type
              <select value={generatorType} onChange={event => setGeneratorType(event.target.value)}>
                {REPORT_TYPES.map(type => <option value={type.id} key={type.id}>{type.title}</option>)}
              </select>
            </label>
            <div className="plan-actions">
              <button className="secondary" onClick={() => downloadReportJson(generatedReport())}>Download JSON</button>
              <button className="primary" onClick={() => downloadReportPdf(generatedReport())}><FileDown />Generate PDF</button>
            </div>
          </div>
        </div>
      )}
      {selectedReport && (
        <aside className="asset-drawer report-drawer" role="dialog" aria-modal="true" aria-label="Report details">
          <div className="asset-drawer-heading">
            <span className="report-icon"><FileText /></span>
            <div>
              <span className="eyebrow">Migration plan output</span>
              <h2>{selectedReport.title}</h2>
            </div>
            <button className="icon-button" onClick={() => setSelectedReport(null)} aria-label="Close report details">×</button>
          </div>
          <p className="report-description">{selectedReport.description}</p>
          <div className="drawer-actions">
            <button className="primary" onClick={() => downloadReportPdf(selectedReport)}><FileDown />Download PDF</button>
            <button className="secondary" onClick={() => downloadReportJson(selectedReport)}>Download JSON</button>
          </div>
          <h3>Decision state</h3>
          <div className="drawer-brief">
            <b>{selectedReport.brief.briefStatus}</b>
            <p>{selectedReport.brief.nextAction}</p>
          </div>
          <dl>{Object.entries(selectedReport.metrics).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase())}</dt><dd>{value}</dd></div>)}</dl>
          <h3>Report sections</h3>
          <div className="report-sections">{selectedReport.sections.map(section => <section key={section.title}><h4>{section.title}</h4><p>{section.body}</p><ul>{section.bullets.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div>
          <p><b>Evidence boundary:</b> {selectedReport.evidenceBoundary}</p>
        </aside>
      )}
    </>
  );
}

function ResultsWorkspace({ data, scores, scans = [], setActive, selectedScope = "organization", setSelectedScope, openPlanForScope }) {
  const [resultsScope, setResultsScope] = useState(selectedScope || "organization");
  const scopeOptions = useMemo(() => completedScanScopes(scans), [scans]);
  const resultScopeOptions = useMemo(() => [
    { id: "organization", label: "Overall organization" },
    ...scopeOptions,
  ], [scopeOptions]);
  useEffect(() => {
    setResultsScope(selectedScope || "organization");
  }, [selectedScope]);
  const changeResultsScope = useCallback((scope) => {
    setResultsScope(scope);
    setSelectedScope?.(scope);
  }, [setSelectedScope]);
  const openScopedPlan = useCallback((scope) => {
    if (openPlanForScope) openPlanForScope(scope);
    else setActive(ROUTES.plan);
  }, [openPlanForScope, setActive]);
  const resultsContext = useMemo(
    () => scopedPlanContext(data, scans, scores, resultsScope),
    [data, resultsScope, scans, scores],
  );
  const scopedData = resultsContext.data || data;
  const assets = useMemo(() => (Array.isArray(scopedData?.assets) ? scopedData.assets : []), [scopedData]);
  const [cbom, setCbom] = useState(() => localCbomFromAssets(data?.assets || []));
  const [snapshots, setSnapshots] = useState([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const scopedCbom = useMemo(() => localCbomFromAssets(assets), [assets]);
  const displayCbom = resultsContext.selectedScan ? scopedCbom : (cbom?.data?.length ? cbom : scopedCbom);
  const summary = displayCbom?.summary || {};
  const components = displayCbom?.data || [];
  const latestSnapshot = resultsContext.selectedScan ? null : snapshots[0];
  const readiness = resultsContext.scores.readiness;
  const criticalAssets = assets
    .filter(asset => ["CRITICAL", "HIGH"].includes(String(asset.prio).toUpperCase()) || Number(asset.risk) >= 70)
    .toSorted((left, right) => Number(right.risk || 0) - Number(left.risk || 0));
  const hndlCount = assets.filter(asset => asset.cls === "SHOR-CRITICAL" || Number(asset.hndl) >= 70).length;
  const tnflCount = assets.filter(asset => Number(asset.tnfl) >= 70).length;
  const safeCount = assets.filter(asset => ["HYBRID", "QUANTUM-SAFE", "PQC"].includes(asset.cls)).length;
  const drivers = [
    ["Crypto modernization", readiness.components.cryptoModernization, 35],
    ["Inventory coverage", readiness.components.inventoryCoverage, 20],
    ["Migration planning", readiness.components.migrationPlanning, 20],
    ["Governance maturity", readiness.components.governanceMaturity, 15],
    ["Compensating controls", readiness.components.compensatingControls, 10],
  ];
  const interpretation = resultInterpretation(
    readiness,
    criticalAssets.length,
    resultsContext.scores.confidence.label,
    Boolean(resultsContext.selectedScan),
  );

  const refreshInventory = useCallback(async () => {
    const [nextCbom, nextSnapshots] = await Promise.all([loadCbom(), loadCbomSnapshots()]);
    setCbom(nextCbom?.data?.length ? nextCbom : localCbomFromAssets(data?.assets || []));
    setSnapshots(nextSnapshots);
  }, [data]);

  const createSnapshot = useCallback(async () => {
    if (resultsContext.selectedScan) {
      setStatus(`Scoped CBOM generated for ${resultsContext.scopeLabel}. Use Download JSON to export it.`);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const snapshot = await createCbomSnapshot({
        name: `results-cbom-${new Date().toISOString().slice(0, 10)}`,
        createdBy: "QuantumSentinel UI",
        metadata: { source: "results" },
      });
      await refreshInventory();
      setStatus(`CBOM snapshot ${snapshot?.id || "created"} saved.`);
    } catch (error) {
      setStatus(`CBOM snapshot failed: ${error.message || "snapshot endpoint unavailable"}.`);
    } finally {
      setBusy(false);
    }
  }, [refreshInventory, resultsContext.scopeLabel, resultsContext.selectedScan]);

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  const exportCurrent = () => {
    const date = new Date().toISOString().slice(0, 10);
    if (resultsContext.selectedScan) {
      const slug = resultsContext.scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      downloadJsonPayload(displayCbom, `quantumsentinel-${slug}-cbom-${date}.json`);
      return;
    }
    downloadCbom(`quantumsentinel-cbom-${date}.json`);
  };

  return (
    <>
      <PageTitle
        title="Results"
        subtitle={`${resultsContext.scopeLabel}: CBOM, findings, and readiness in one evidence view.`}
        className="results-page-title"
      >
        <ScopePicker
          label="Results for"
          value={resultsScope}
          options={resultScopeOptions}
          onChange={changeResultsScope}
          className="results-scope-picker"
        />
        <button className="secondary" onClick={() => setActive(ROUTES.collect)}>
          <Target />
          Run another scan
        </button>
        <button className="primary" onClick={() => openScopedPlan(resultsScope)}>
          <Wrench />
          Open plan
        </button>
      </PageTitle>
      <section className="results-layout">
        <article className="card results-score">
          <div>
            <span className="eyebrow">{resultsContext.selectedScan ? "Observed crypto posture" : "Readiness result"}</span>
            <h2>{readiness.assessed ? `${readiness.score}/100 · ${readiness.classification}` : "Not yet assessed"}</h2>
            <p>
              {resultsContext.selectedScan
                ? observedPostureMeaning(readiness.assessed ? readiness.score : null, criticalAssets.length)
                : readinessMeaning(readiness.assessed ? readiness.score : null, criticalAssets.length)}
            </p>
          </div>
          <ScoreRing score={readiness.assessed ? readiness.score : null} label={resultsContext.selectedScan ? "Posture" : "Readiness"} />
          <div className="results-stat-grid">
            <span><b>{assets.length}</b><small>observed assets</small></span>
            <span><b>{components.length}</b><small>CBOM components</small></span>
            <span><b>{criticalAssets.length}</b><small>priority findings</small></span>
            <span><b>{safeCount}</b><small>hybrid or safe</small></span>
          </div>
        </article>

        <article className="card results-decision">
          <div>
            <span className="eyebrow">What did we find?</span>
            <h3>{criticalAssets.length ? `${criticalAssets.length} priority finding${criticalAssets.length === 1 ? "" : "s"}` : "No priority finding in scope"}</h3>
            <p>{assets.length} observed asset{assets.length === 1 ? "" : "s"} and {components.length} CBOM component{components.length === 1 ? "" : "s"} are in this view.</p>
          </div>
          <div>
            <span className="eyebrow">What does it mean?</span>
            <h3>{interpretation.title}</h3>
            <p>{interpretation.body}</p>
          </div>
          <div>
            <span className="eyebrow">What should we do next?</span>
            <h3>{criticalAssets.length ? "Assign migration owners" : "Improve evidence confidence"}</h3>
            <p>{interpretation.next}</p>
            <div className="results-decision-actions">
              <button className="primary" onClick={() => openScopedPlan(resultsScope)}>
                <Wrench />
                Open plan
              </button>
              <button className="secondary" onClick={() => setActive(ROUTES.learn)}>
                <CircleHelp />
                Learn terms
              </button>
            </div>
          </div>
        </article>

        <article className="card results-cbom">
          <div className="card-heading">
            <span><KeyRound />CBOM</span>
            <small>{resultsContext.selectedScan ? "Scoped view" : latestSnapshot ? `Latest: ${latestSnapshot.id}` : "No snapshot saved"}</small>
          </div>
          <p>{resultsContext.selectedScan ? "View the cryptographic bill of materials for this selected scan." : "Generate the cryptographic bill of materials from current scan evidence."}</p>
          <div className="results-actions">
            <button className="primary" onClick={createSnapshot} disabled={busy}>
              <KeyRound />
              {busy ? "Generating..." : resultsContext.selectedScan ? "Generate scoped CBOM" : "Generate CBOM"}
            </button>
            <button className="secondary" onClick={exportCurrent}>
              <FileDown />
              Download JSON
            </button>
          </div>
          {status && <p className={status.includes("failed") ? "cbom-status error" : "cbom-status"}>{status}</p>}
          <div className="compact-list">
            {components.slice(0, 5).map(item => (
              <div key={item.componentId}>
                <b>{item.hostname}</b>
                <span>{item.cryptography.algorithm}</span>
                <small>{item.cryptography.classification}</small>
              </div>
            ))}
            {!components.length && <p className="empty-scans">No CBOM components yet. Run a scan first.</p>}
          </div>
        </article>

        <article className="card results-findings">
          <div className="card-heading">
            <span><ShieldAlert />Priority findings</span>
            <small>{hndlCount} HNDL · {tnflCount} TNFL</small>
          </div>
          <div className="compact-list finding-list">
            {criticalAssets.slice(0, 6).map(asset => (
              <div key={asset.id || asset.hostname || asset.name}>
                <b>{asset.hostname || asset.name || asset.id}</b>
                <span>{assetExposureReason(asset)}</span>
                <small>{targetState(asset)}</small>
                <button className="text-link" onClick={() => openScopedPlan(resultsScope)}>
                  Plan finding <ChevronRight />
                </button>
              </div>
            ))}
            {!criticalAssets.length && <p className="empty-scans">No priority findings yet. Run an authorized scan to collect evidence.</p>}
          </div>
          <button className="secondary" onClick={() => openScopedPlan(resultsScope)}>
            Open migration queue <ChevronRight />
          </button>
        </article>

        <article className="card results-drivers">
          <div className="card-heading">
            <span><ShieldCheck />Score drivers</span>
            <small>{resultsContext.scores.confidence.label}</small>
          </div>
          {drivers.map(([label, value, weight]) => (
            <div className="compact-driver" key={label}>
              <span>{label}</span>
              <div><i style={{ width: `${Math.max(2, value)}%` }} /></div>
              <b>{Math.round(value)}%</b>
              <small>{weight}% weight</small>
            </div>
          ))}
        </article>

        <article className="card results-boundary">
          <CircleHelp />
          <p>
            <b>Evidence boundary:</b> Results reflect observed scan, inventory, and saved evidence.
            Unknown internal PKI, code signing, databases, key stores, and vendor systems remain evidence gaps until collected.
          </p>
        </article>
      </section>
    </>
  );
}

function PlanWorkspace({ data, scans, scores, profile, qdayScenario, selectedScope = "organization", setSelectedScope }) {
  const legacySeedIds = new Set(["rsa-gateway", "hybrid-vpn", "root-hierarchy"]);
  const [actions, setActions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("quantumsentinel-remediation-actions") || "null");
      return Array.isArray(stored) ? stored.filter((action) => !legacySeedIds.has(action.id)) : [];
    } catch {
      return [];
    }
  });
  const [planScope, setPlanScope] = useState(selectedScope || "organization");
  const scopeOptions = useMemo(() => completedScanScopes(scans), [scans]);
  const planScopeOptions = useMemo(() => [
    { id: "organization", label: "Overall organization" },
    ...scopeOptions,
  ], [scopeOptions]);
  useEffect(() => {
    setPlanScope(selectedScope || "organization");
  }, [selectedScope]);
  const changePlanScope = useCallback((scope) => {
    setPlanScope(scope);
    setSelectedScope?.(scope);
  }, [setSelectedScope]);
  const planContext = useMemo(
    () => scopedPlanContext(data, scans, scores, planScope),
    [data, planScope, scans, scores],
  );
  const scopedAssetNames = useMemo(() => new Set((planContext.data?.assets || [])
    .map(asset => asset.hostname || asset.name || String(asset.id))
    .filter(Boolean)), [planContext.data]);
  const evidenceActions = useMemo(() => (planContext.data?.assets || [])
    .filter((asset) => !["HYBRID", "QUANTUM-SAFE"].includes(asset.cls))
    .map((asset) => {
      const assetName = asset.hostname || asset.name || String(asset.id);
      const sourceScan = planContext.scans.find((scan) => scanContainsAsset(scan, asset));
      const scanType = sourceScan ? scanTypeLabel(sourceScan) : "Imported evidence";
      return {
        id: `evidence-${asset.id}`,
        title: `Modernize ${assetName}`,
        asset: assetName,
        scopeId: planScope,
        scanType,
        owner: "Unassigned",
        due: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
        status: "Planned",
        urgency: Number(asset.risk) || 50,
        target: asset.migration || "Define a hybrid or post-quantum target state",
        evidenceNeeded: "Owner approval, implementation record, updated CBOM, and post-change scan evidence.",
      };
    }), [planContext.data, planContext.scans, planScope]);
  const [sortBy, setSortBy] = useState("urgency");
  const [planOpen, setPlanOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [planName, setPlanName] = useState("Critical systems migration");
  const [planOwner, setPlanOwner] = useState("");
  const [planDeadline, setPlanDeadline] = useState("2026-12-31");
  const [planTargetState, setPlanTargetState] = useState("Inventory, pilot, and migrate priority cryptography");
  const [planEvidenceRequired, setPlanEvidenceRequired] = useState("Approved scope, pilot result, updated CBOM, and validation scan.");
  const [planStatus, setPlanStatus] = useState("Planned");
  const [planOwnerError, setPlanOwnerError] = useState("");
  const statusOrder = { Blocked: 0, "In progress": 1, Planned: 2, Completed: 3 };
  const persistedActions = actions.filter((action) => {
    if (planScope === "organization") return !action.scopeId || action.scopeId === "organization";
    return action.scopeId === planScope || scopedAssetNames.has(action.asset);
  });
  const allActions = [...persistedActions, ...evidenceActions.filter((item) => !persistedActions.some((action) => action.asset === item.asset))];
  const sortedActions = [...allActions].sort((a, b) => {
    if (sortBy === "due") return a.due.localeCompare(b.due);
    if (sortBy === "status") return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    if (sortBy === "owner") return a.owner.localeCompare(b.owner);
    return b.urgency - a.urgency;
  });
  const openCount = allActions.filter(action => action.status !== "Completed").length;
  const progressCount = allActions.filter(action => action.status === "In progress").length;
  const completedCount = allActions.filter(action => action.status === "Completed").length;
  const ownedActionCount = persistedActions.length;
  const generatedActionCount = allActions.filter(action => action.sourceKind === "Generated recommendation").length;
  const brief = deriveMigrationBrief(planContext.scores, planContext.data, profile, qdayScenario, planContext.scans);
  const primaryReport = buildReportRecord(REPORT_TYPES[3], planContext.scores, planContext.data, profile, qdayScenario, planContext.scans);
  const openReport = type => setSelectedReport(buildReportRecord(type, planContext.scores, planContext.data, profile, qdayScenario, planContext.scans));
  const planSeed = useMemo(() => evidenceActions[0] || {
    title: `${planContext.scopeLabel} migration action`,
    owner: "Unassigned",
    due: dueDate(90),
    status: "Planned",
    urgency: 75,
    target: "Inventory, pilot, and migrate priority cryptography",
    evidenceNeeded: "Approved scope, pilot result, updated CBOM, and validation scan.",
  }, [evidenceActions, planContext.scopeLabel]);

  useEffect(() => {
    localStorage.setItem("quantumsentinel-remediation-actions", JSON.stringify(actions));
  }, [actions]);

  useEffect(() => {
    if (!planOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPlanOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [planOpen]);

  const closePlanBuilder = () => {
    setPlanOpen(false);
    setPlanOwnerError("");
  };

  const openPlanBuilder = () => {
    setPlanName(planSeed.title || `${planContext.scopeLabel} migration action`);
    setPlanOwner(planSeed.owner && planSeed.owner !== "Unassigned" ? planSeed.owner : "");
    setPlanDeadline(planSeed.due || dueDate(90));
    setPlanTargetState(planSeed.target || "Inventory, pilot, and migrate priority cryptography");
    setPlanEvidenceRequired(planSeed.evidenceNeeded || evidenceNeededForAction(planSeed));
    setPlanStatus(planSeed.status || "Planned");
    setPlanOwnerError("");
    setPlanOpen(true);
  };

  const createPlan = (event) => {
    event.preventDefault();
    const owner = planOwner.trim();
    if (!owner) {
      setPlanOwnerError("Owner is required.");
      return;
    }
    const newAction = {
      id: `plan-${Date.now()}`,
      title: planName.trim(),
      asset: planContext.scopeLabel,
      scopeId: planScope,
      owner,
      due: planDeadline,
      status: planStatus,
      sourceKind: "Owned action",
      scanType: planContext.selectedScan ? scanTypeLabel(planContext.selectedScan) : "Manual plan",
      urgency: planSeed.urgency || 75,
      target: planTargetState.trim(),
      evidenceNeeded: planEvidenceRequired.trim(),
    };
    setActions(current => [newAction, ...current]);
    closePlanBuilder();
    setSelectedAction(newAction);
  };

  return (
    <>
      <PageTitle
        title="Plan"
        subtitle={`${planContext.scopeLabel}: prioritized migration path, owner queue, and export-ready plan.`}
        className="plan-page-title"
      >
        <ScopePicker
          label="Plan for"
          value={planScope}
          options={planScopeOptions}
          onChange={changePlanScope}
          className="plan-scope-picker"
        />
        <button className="primary" onClick={openPlanBuilder}>
          <Wrench />
          Create action
        </button>
        <button className="secondary plan-download-button" onClick={() => downloadReportPdf(primaryReport)} aria-label="Download PQC migration plan">
          <FileDown />
          Download plan
        </button>
      </PageTitle>
      <section className="plan-layout">
        <article className="card plan-program">
          <div className="plan-program-copy">
            <span className="eyebrow">Decision state</span>
            <h2>{brief.briefStatus}</h2>
            <p>{brief.nextAction}</p>
          </div>
          <ScoreRing score={Number.isFinite(brief.readinessScore) ? brief.readinessScore : null} label="Readiness" />
          <div className="plan-program-metrics">
            <span><b>{openCount}</b><small>open actions</small></span>
            <span><b>{progressCount}</b><small>in progress</small></span>
            <span><b>{completedCount}</b><small>completed</small></span>
            <span><b>{brief.qdayHorizon.readinessDeadline}</b><small>readiness checkpoint</small></span>
          </div>
        </article>

        <article className="card plan-pathway">
          <div className="card-heading">
            <span><CalendarClock />Path forward</span>
            <small>{brief.qdayHorizon.label} · {brief.qdayHorizon.display}</small>
          </div>
          <div className="pathway-grid compact">
            <span><b>{brief.cbom.count}</b><small>CBOM components</small></span>
            <span><b>{brief.criticalCount}</b><small>priority assets</small></span>
            <span><b>{brief.hndlCount + brief.tnflCount}</b><small>HNDL/TNFL signals</small></span>
          </div>
          <div className="plan-timeline">
            {MIGRATION_PHASES.slice(0, 4).map(([title, work], index) => (
              <div key={title}>
                <span className="step-number">{index + 1}</span>
                <b>{title}</b>
                <small>{work}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="card plan-briefs">
          <div className="card-heading">
            <span><FileText />Briefs and decisions</span>
            <small>{planContext.scores.confidence.label}</small>
          </div>
          <div className="decision-list compact">
            {brief.decisionRequired.map(item => (
              <div key={item.title}>
                <b>{item.title}</b>
                <span>{item.owner}</span>
                <p>{item.decision}</p>
                <small>Due {item.due}</small>
              </div>
            ))}
          </div>
          <div className="report-context-note">
            <b>Report package</b>
            <span>Exports include organization context, selected scope, scan evidence, CBOM components, readiness score, priority findings, and the migration path.</span>
          </div>
          <div className="plan-export-list">
            {REPORT_TYPES.map(type => (
              <button className="secondary" key={type.id} onClick={() => openReport(type)}>
                <FileText />
                {type.title}
              </button>
            ))}
          </div>
        </article>

        <article className="card plan-queue">
          <div className="card-heading">
            <span><Wrench />Migration queue <small>{generatedActionCount} generated · {ownedActionCount} owned</small></span>
            <label className="queue-sort">Sort by
              <select value={sortBy} onChange={event => setSortBy(event.target.value)} aria-label="Sort migration queue">
                <option value="urgency">Urgency</option>
                <option value="due">Due date</option>
                <option value="status">Status</option>
                <option value="owner">Owner</option>
              </select>
            </label>
          </div>
          <div className="plan-action-list">
            {sortedActions.length ? sortedActions.slice(0, 8).map((action, index) => (
              <button key={action.id} onClick={() => setSelectedAction(action)}>
                <span className="step-number">{index + 1}</span>
                <span>
                  <b>{action.title}</b>
                  <small>{action.asset} · {action.sourceKind || "Owned action"} · {action.scanType || "Manual plan"} · {action.target}</small>
                </span>
                <span>{action.owner}</span>
                <span>{new Date(`${action.due}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <i className={`status-pill ${action.status.toLowerCase().replace(" ", "-")}`}>{action.status}</i>
              </button>
            )) : <p className="empty-scans">No migration actions yet. Findings from completed scans will appear here.</p>}
          </div>
        </article>
      </section>
      {planOpen && <div className="plan-backdrop" role="presentation"><form className="card plan-dialog" role="dialog" aria-modal="true" aria-label="Create migration plan" onSubmit={createPlan}><div className="plan-dialog-heading"><div><span className="eyebrow">New action</span><h2>Create an owned migration action</h2><p>Start with a named outcome, accountable owner, target state, and evidence requirement.</p></div><button type="button" className="icon-button" onClick={closePlanBuilder} aria-label="Close plan builder">×</button></div><label>Plan name<input required value={planName} onChange={event => setPlanName(event.target.value)} /></label><label>Owner<input required value={planOwner} onChange={event => { setPlanOwner(event.target.value); if (planOwnerError) setPlanOwnerError(""); }} placeholder="Name or team" aria-invalid={planOwnerError ? "true" : "false"} />{planOwnerError && <small className="field-error">{planOwnerError}</small>}</label><label>Target completion date<input required type="date" value={planDeadline} onChange={event => setPlanDeadline(event.target.value)} /></label><label>Status<select value={planStatus} onChange={event => setPlanStatus(event.target.value)}><option value="Planned">Planned</option><option value="In progress">In progress</option><option value="Blocked">Blocked</option><option value="Completed">Completed</option></select></label><label>Target state<textarea required rows="3" value={planTargetState} onChange={event => setPlanTargetState(event.target.value)} /></label><label>Evidence required<textarea required rows="3" value={planEvidenceRequired} onChange={event => setPlanEvidenceRequired(event.target.value)} /></label><div className="plan-actions"><button type="button" className="secondary" onClick={closePlanBuilder}>Cancel</button><button type="submit" className="primary" disabled={!planName.trim() || !planOwner.trim() || !planDeadline || !planTargetState.trim() || !planEvidenceRequired.trim()}><Check />Add to queue</button></div></form></div>}
      {selectedAction && <aside className="asset-drawer remediation-drawer" role="dialog" aria-modal="true" aria-label="Migration action details"><div className="asset-drawer-heading"><span className="metric-icon blue"><Wrench /></span><div><span className="eyebrow">Migration action</span><h2>{selectedAction.title}</h2></div><button className="icon-button" onClick={() => setSelectedAction(null)} aria-label="Close migration action details">×</button></div><div className="drawer-actions"><button className="primary" onClick={() => downloadMigrationPlan(selectedAction)}><FileDown />Download action PDF</button></div><dl><div><dt>Asset or scope</dt><dd>{selectedAction.asset}</dd></div><div><dt>Action source</dt><dd>{selectedAction.sourceKind || "Owned action"}</dd></div><div><dt>Owner</dt><dd>{selectedAction.owner}</dd></div><div><dt>Status</dt><dd>{selectedAction.status}</dd></div><div><dt>Urgency</dt><dd>{selectedAction.urgency}/100</dd></div><div><dt>Due date</dt><dd>{new Date(`${selectedAction.due}T00:00:00`).toLocaleDateString()}</dd></div><div><dt>Target state</dt><dd>{selectedAction.target}</dd></div><div><dt>Evidence needed</dt><dd>{selectedAction.evidenceNeeded || evidenceNeededForAction(selectedAction)}</dd></div></dl><p><b>Planning boundary:</b> Completion requires implementation evidence, validation evidence, updated CBOM evidence, and a rescan.</p></aside>}
      {selectedReport && <aside className="asset-drawer report-drawer" role="dialog" aria-modal="true" aria-label="Report details"><div className="asset-drawer-heading"><span className="report-icon"><FileText /></span><div><span className="eyebrow">Export package</span><h2>{selectedReport.title}</h2></div><button className="icon-button" onClick={() => setSelectedReport(null)} aria-label="Close report details">×</button></div><p className="report-description">{selectedReport.description}</p><div className="report-context-note drawer-note"><b>This export includes</b><span>Organization profile, selected scope, scan evidence, CBOM, readiness score, priority findings, migration path, timeline, owners, decisions, and evidence boundary.</span></div><div className="drawer-actions"><button className="primary" onClick={() => downloadReportPdf(selectedReport)}><FileDown />Download PDF</button><button className="secondary" onClick={() => downloadReportJson(selectedReport)}>Download JSON</button></div><h3>Decision state</h3><div className="drawer-brief"><b>{selectedReport.brief.briefStatus}</b><p>{selectedReport.brief.nextAction}</p></div><h3>Report sections</h3><div className="report-sections">{selectedReport.sections.map(section => <section key={section.title}><h4>{section.title}</h4><p>{section.body}</p><ul>{section.bullets.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div><p><b>Evidence boundary:</b> {selectedReport.evidenceBoundary}</p></aside>}
    </>
  );
}

function Settings({ profile, qdayScenario, setQdayScenario, theme, toggleTheme, openOnboarding, onboardingVisible, setOnboardingVisible }) {
  const horizon = QDAY_SCENARIOS[qdayScenario] || QDAY_SCENARIOS.ionq;
  const horizonDisplay = formatHorizon(daysUntil(horizon.date));
  return (
    <>
      <PageTitle
        title="Settings"
        subtitle="Application preferences and setup controls."
      />
      <section className="settings-layout">
        <article className="card settings-card">
          <div className="card-heading">
            <span><Building2 />Organization setup</span>
          </div>
          <p>{isProfileComplete(profile) ? `${profile.name} · ${profile.industry} · ${profile.geography}` : "Organization setup is incomplete."}</p>
          <label className="settings-switch">
            <span>
              Show Onboarding tab
              <small>Hide it after setup, or reveal it when setup needs review.</small>
            </span>
            <input
              type="checkbox"
              checked={!isProfileComplete(profile) || onboardingVisible}
              disabled={!isProfileComplete(profile)}
              onChange={(event) => setOnboardingVisible(event.target.checked)}
            />
          </label>
          <button className="secondary" onClick={openOnboarding}>
            <Building2 />
            Open onboarding
          </button>
        </article>
        <article className="card settings-card">
          <div className="card-heading">
            <span><CalendarClock />Q-Day horizon</span>
          </div>
          <p>{horizon.label}: {horizonDisplay.primary} {horizonDisplay.secondary} remaining.</p>
          <label>
            Planning scenario
            <select value={qdayScenario} onChange={(event) => setQdayScenario(event.target.value)}>
              <option value="ionq">IonQ 2029</option>
              <option value="conservative">Conservative 2032</option>
              <option value="accelerated">Accelerated 2028</option>
            </select>
          </label>
        </article>
        <article className="card settings-card">
          <div className="card-heading">
            <span><Settings2 />Display</span>
          </div>
          <p>Current theme: {theme}.</p>
          <button className="secondary" onClick={toggleTheme}>
            {theme === "light" ? <Moon /> : <Sun />}
            Switch to {theme === "light" ? "dark" : "light"}
          </button>
        </article>
      </section>
    </>
  );
}

export default function App() {
  const [active, setActive] = useState(() =>
    isProfileComplete(savedProfile()) ? ROUTES.overview : ROUTES.onboarding,
  );
  const [data, setData] = useState(null);
  const [scans, setScans] = useState(FALLBACK_SCANS);
  const [profile, setProfile] = useState(savedProfile);
  const [qdayScenario, setQdayScenario] = useState(() => localStorage.getItem("quantumSentinel.qdayScenario") || "ionq");
  const [onboardingVisible, setOnboardingVisible] = useState(() => localStorage.getItem("quantumSentinel.onboardingVisible") === "true");
  const [selectedScope, setSelectedScope] = useState("organization");
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("quantumSentinel.theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("quantumSentinel.theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("quantumSentinel.qdayScenario", qdayScenario);
  }, [qdayScenario]);
  useEffect(() => {
    localStorage.setItem("quantumSentinel.onboardingVisible", String(onboardingVisible));
  }, [onboardingVisible]);
  useEffect(() => {
    const legacyRoutes = {
      Overview: ROUTES.overview,
      Scan: ROUTES.collect,
      Exposure: ROUTES.results,
      Remediation: ROUTES.plan,
      Reports: ROUTES.plan,
      "Q-Day Readiness": ROUTES.results,
      "Crypto Inventory": ROUTES.results,
      "Risk Findings": ROUTES.results,
      "Briefs & Exports": ROUTES.plan,
      "Quantum Context": ROUTES.learn,
      Settings: ROUTES.settings,
    };
    if (legacyRoutes[active]) setActive(legacyRoutes[active]);
  }, [active]);
  const refreshEvidence = useCallback(async () => {
    const [d, j] = await Promise.all([loadApplianceData(), loadProbeJobs()]);
      setData(d);
      setScans(j || []);
  }, []);
  useEffect(() => {
    refreshEvidence();
  }, [refreshEvidence]);
  const scores = useMemo(() => deriveQuantumScores(data || {}), [data]);
  const openOnboarding = useCallback(() => {
    setOnboardingVisible(true);
    setActive(ROUTES.onboarding);
  }, []);
  const saveProfile = useCallback((next) => {
    setProfile(next);
    localStorage.setItem(
      "quantumSentinel.organizationProfile",
      JSON.stringify(next),
    );
    if (isProfileComplete(next)) setOnboardingVisible(false);
  }, []);
  const openResultsForScope = useCallback((scope = "organization") => {
    setSelectedScope(scope || "organization");
    setActive(ROUTES.results);
  }, []);
  const openPlanForScope = useCallback((scope = "organization") => {
    setSelectedScope(scope || "organization");
    setActive(ROUTES.plan);
  }, []);
  const page = useMemo(() => {
    if (active === ROUTES.onboarding)
      return <Onboarding profile={profile} onSave={saveProfile} setActive={setActive} qdayScenario={qdayScenario} scans={scans} />;
    if (active === ROUTES.overview)
      return (
        <Overview
          data={data}
          scores={scores}
          scans={scans}
          setActive={setActive}
          profile={profile}
          qdayScenario={qdayScenario}
          setQdayScenario={setQdayScenario}
          openResultsForScope={openResultsForScope}
          openPlanForScope={openPlanForScope}
          openOnboarding={openOnboarding}
        />
      );
    if (active === ROUTES.learn) return <QuantumContext />;
    if (active === ROUTES.settings)
      return (
        <Settings
          profile={profile}
          qdayScenario={qdayScenario}
          setQdayScenario={setQdayScenario}
          theme={theme}
          toggleTheme={() => setTheme(current => current === "light" ? "dark" : "light")}
          openOnboarding={openOnboarding}
          onboardingVisible={onboardingVisible}
          setOnboardingVisible={setOnboardingVisible}
        />
      );
    if (active === ROUTES.collect)
      return <Scan scans={scans} setScans={setScans} setActive={setActive} onEvidenceSaved={refreshEvidence} openResultsForScope={openResultsForScope} />;
    if (active === ROUTES.results) return <ResultsWorkspace data={data} scores={scores} scans={scans} setActive={setActive} selectedScope={selectedScope} setSelectedScope={setSelectedScope} openPlanForScope={openPlanForScope} />;
    if (active === ROUTES.inventory || active === ROUTES.findings || active === ROUTES.readiness)
      return <ResultsWorkspace data={data} scores={scores} scans={scans} setActive={setActive} selectedScope={selectedScope} setSelectedScope={setSelectedScope} openPlanForScope={openPlanForScope} />;
    if (active === ROUTES.plan || active === ROUTES.exports)
      return <PlanWorkspace data={data} scans={scans} scores={scores} profile={profile} qdayScenario={qdayScenario} selectedScope={selectedScope} setSelectedScope={setSelectedScope} />;
    return <PlanWorkspace data={data} scans={scans} scores={scores} profile={profile} qdayScenario={qdayScenario} selectedScope={selectedScope} setSelectedScope={setSelectedScope} />;
  }, [active, data, profile, qdayScenario, saveProfile, scores, scans, refreshEvidence, theme, onboardingVisible, selectedScope, openResultsForScope, openPlanForScope, openOnboarding]);
  return (
    <div className="app">
      <Header
        active={active}
        setActive={setActive}
        theme={theme}
        profileComplete={isProfileComplete(profile)}
        onboardingVisible={onboardingVisible}
        apiLive={data?.source === "api"}
        openOnboarding={openOnboarding}
        toggleTheme={() => setTheme(current => current === "light" ? "dark" : "light")}
      />
      <main>{page}</main>
      <footer>
        QuantumSentinel · Evidence, not hype.{" "}
        <span>Only scan systems you own or are authorized to assess.</span>
      </footer>
    </div>
  );
}
