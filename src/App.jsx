import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Bell, Building2, CalendarClock, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileDown, FileText, Globe2, KeyRound,
  Laptop, Network, Play, RefreshCw, Search, Settings2, Shield, ShieldAlert,
  ShieldCheck, Sparkles, Target, Wrench,
} from "lucide-react";
import { loadApplianceData } from "./api.js";
import { createProbeJob, loadProbeJobs } from "./probeApi.js";
import { deriveQuantumScores } from "./quantumScores.js";
import "./dashboard.css";
import "./scan-options.css";

const NAV = [
  ["Overview", BarChart3], ["Q-Day Readiness", ShieldCheck], ["Scan", Target],
  ["Exposure", ShieldAlert], ["Remediation", Wrench], ["Reports", FileText],
];

const FALLBACK_SCANS = [
  { id: "example", targetLabel: "example.com", type: "tls", status: "COMPLETED", riskScore: 79, completedAt: new Date(Date.now() - 12 * 60_000).toISOString() },
  { id: "quantumlink", targetLabel: "api.quantumlink.dev", type: "tls", status: "COMPLETED", riskScore: 61, completedAt: new Date(Date.now() - 86_400_000).toISOString() },
  { id: "local", targetLabel: "Local machine", type: "local", status: "COMPLETED", riskScore: 88, completedAt: new Date(Date.now() - 172_800_000).toISOString() },
];

const QDAY_SCENARIOS = {
  ionq: { label: "IonQ 2029", date: "2029-01-01", note: "Illustrative industry roadmap threshold" },
  conservative: { label: "Conservative 2032", date: "2032-01-01", note: "Longer-horizon planning scenario" },
  accelerated: { label: "Accelerated 2028", date: "2028-01-01", note: "Stress-test scenario for earlier capability" },
};

const EMPTY_PROFILE = { name: "", industry: "", geography: "", size: "", dataAssets: [], regimes: [] };
function savedProfile() {
  try { return JSON.parse(localStorage.getItem("quantumSentinel.organizationProfile")) || EMPTY_PROFILE; }
  catch { return EMPTY_PROFILE; }
}

function daysUntil(date) {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
}

function timeAgo(value) {
  if (!value) return "recently";
  const mins = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Shield /></span><span>Quantum<b>Sentinel</b></span></div>;
}

function Header({ active, setActive, openProfile }) {
  return <header className="app-header">
    <Brand />
    <nav aria-label="Primary navigation">
      {NAV.map(([label, Icon]) => <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon />{label}</button>)}
    </nav>
    <div className="header-tools"><span className="live"><i />System live</span><button className="icon-button" aria-label="Notifications"><Bell /></button><button className="avatar" onClick={openProfile} aria-label="Open organization profile">RG</button><ChevronDown className="chevron" /></div>
  </header>;
}

function PageTitle({ title, subtitle, children }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="title-actions">{children}</div>}</div>;
}

function ScoreRing({ score = 42, label = "Readiness" }) {
  const ringColor = score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
  return <div className="score-ring" style={{ "--score": `${score * 3.6}deg`, "--ring-color": ringColor }}><div><strong>{score}</strong><span>/ 100</span><small>{label}</small></div></div>;
}

function Metric({ icon: Icon, value, label, tone = "blue", trend }) {
  const trendClass = trend?.startsWith("+") ? "positive" : trend?.startsWith("-") ? "negative" : "neutral";
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon /></span><strong>{value}</strong><h3>{label}</h3>{trend && <p className={trendClass}>{trend}</p>}</article>;
}

const REGULATORY_REGIMES = {
  "United States": { default: ["NIST CSF 2.0", "NIST IR 8547"], Finance: ["GLBA", "NYDFS 23 NYCRR 500", "PCI DSS 4.0"], Healthcare: ["HIPAA Security Rule", "HITRUST CSF"], Energy: ["NERC CIP"], Defense: ["CMMC 2.0", "DFARS 252.204-7012"] },
  "European Union": { default: ["GDPR", "NIS2"], Finance: ["DORA"], Healthcare: ["EHDS", "MDR"], Energy: ["NIS2 Critical Entities"], Defense: ["EU classified information rules"] },
  "United Kingdom": { default: ["UK GDPR", "NIS Regulations"], Finance: ["FCA Operational Resilience"], Healthcare: ["NHS DSP Toolkit"], Energy: ["NIS Regulations"], Defense: ["Defence Cyber Protection Partnership"] },
  Canada: { default: ["PIPEDA"], Finance: ["OSFI B-13"], Healthcare: ["Provincial health privacy laws"], Energy: ["NERC CIP where applicable"], Defense: ["Controlled Goods Program"] },
};

function OrganizationProfile({ initialProfile, onSave, onClose }) {
  const [profile, setProfile] = useState(initialProfile);
  const regimes = [...(REGULATORY_REGIMES[profile.geography]?.default || []), ...(REGULATORY_REGIMES[profile.geography]?.[profile.industry] || [])];
  const assets = ["PII", "PHI", "Financial records", "Intellectual property", "Government data", "Customer data"];
  const update = (key, value) => setProfile(current => ({ ...current, [key]: value }));
  const toggleAsset = asset => update("dataAssets", profile.dataAssets.includes(asset) ? profile.dataAssets.filter(item => item !== asset) : [...profile.dataAssets, asset]);
  return <aside className="onboarding-panel" aria-labelledby="profile-title"><div className="onboarding-heading"><div><span className="eyebrow">Organization onboarding</span><h1 id="profile-title">Build your readiness baseline</h1><p>Your profile tailors regulatory context, evidence priorities, and the Quantum Readiness Score.</p></div><button className="icon-button" onClick={onClose} aria-label="Close profile">×</button></div><div className="profile-grid"><div className="profile-form"><label>Organization name<input value={profile.name} onChange={event=>update("name",event.target.value)} placeholder="Acme Corporation"/></label><div className="field-pair"><label>Industry<select value={profile.industry} onChange={event=>update("industry",event.target.value)}><option value="">Select industry</option>{["Finance","Healthcare","Energy","Defense","Technology","Government"].map(item=><option key={item}>{item}</option>)}</select></label><label>Primary geography<select value={profile.geography} onChange={event=>update("geography",event.target.value)}><option value="">Select geography</option>{Object.keys(REGULATORY_REGIMES).map(item=><option key={item}>{item}</option>)}</select></label></div><label>Organization size<select value={profile.size} onChange={event=>update("size",event.target.value)}><option value="">Select size</option><option>1–249 employees</option><option>250–999 employees</option><option>1,000–9,999 employees</option><option>10,000+ employees</option></select></label><fieldset><legend>Data and digital assets</legend><div className="profile-checks">{assets.map(asset=><label key={asset}><input type="checkbox" checked={profile.dataAssets.includes(asset)} onChange={()=>toggleAsset(asset)}/><span>{asset}</span></label>)}</div></fieldset></div><aside className="regime-card"><span className="metric-icon blue"><ShieldCheck/></span><h2>Regulatory context</h2><p>Suggested from your primary geography and industry.</p>{regimes.length?<div className="regime-list">{regimes.map(regime=><span key={regime}><Check/>{regime}</span>)}</div>:<div className="regime-empty">Select a geography and industry to see likely regimes.</div>}<small>Guidance only. Applicability depends on operations, customers, contracts, and legal interpretation.</small></aside></div><div className="onboarding-actions"><button className="secondary" onClick={onClose}>Finish later</button><button className="primary" disabled={!profile.name||!profile.industry||!profile.geography} onClick={()=>onSave({...profile,regimes})}><Check/>Save organization profile</button></div></aside>;
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
  return <article className="card trend-card readiness-drivers"><div className="card-heading"><span><Activity />What drives your {scores.readiness.score} readiness score?</span><button className="text-link" onClick={()=>setActive("Q-Day Readiness")}>View calculation <ChevronRight/></button></div><p>Every bar is an observed input to the single Quantum Readiness Score. The percentage at right is that input’s weight.</p><div className="driver-list">{drivers.map(([label,value,weight])=><div className="driver-row" key={label}><span>{label}</span><div><i style={{width:`${Math.max(2,value)}%`}}/></div><strong>{Math.round(value)}%</strong><small>{weight}% weight</small></div>)}</div></article>;
}

function Overview({ data, scores, scans, setActive, openProfile }) {
  const [scenario, setScenario] = useState("ionq");
  const summary = data?.summary || {};
  const total = summary.totalAssets || 15;
  const critical = summary.criticalCount || 8;
  const safe = summary.safeCount || 2;
  const readiness = scores.readiness;
  const horizon = QDAY_SCENARIOS[scenario];
  return <>
    <PageTitle title="Good morning, Rick" subtitle="Your cryptographic exposure, distilled.">
      <button className="secondary" onClick={openProfile}><Building2 />Organization profile</button>
      <button className="primary" onClick={() => setActive("Scan")}><Play />Run a scan</button>
      <button className="secondary" onClick={() => setActive("Reports")}><FileText />View report</button>
    </PageTitle>
    <section className="overview-grid">
      <article className="card readiness-summary"><div className="card-heading"><span><ShieldCheck />Q-Day Readiness</span><CircleHelp /></div><div className="readiness-content"><ScoreRing score={readiness.score} /><div><h2 className={readiness.score>=70?"good":readiness.score>=50?"warn":"bad"}>{readiness.classification}</h2><p>{critical} critical systems still depend on quantum-vulnerable cryptography.</p><span className="direction better">↑ {readiness.direction}</span></div></div><button className="text-link" onClick={() => setActive("Q-Day Readiness")}>How this score works <ChevronRight /></button></article>
      <article className="card horizon"><div className="card-heading"><span><CalendarClock />Q-Day horizon</span><button className="info-tip" aria-label="About the Q-Day horizon"><CircleHelp/><span className="tooltip"><b>Q-Day is a moving threshold—not a date like Y2K.</b> These scenarios are planning assumptions. Your organization should set an earlier readiness deadline based on data lifetime, migration complexity, and risk tolerance.</span></button></div><strong>{daysUntil(horizon.date)}</strong><h2>days</h2><p className="horizon-date">Scenario threshold · {new Date(`${horizon.date}T00:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</p><label>External scenario<select value={scenario} onChange={event=>setScenario(event.target.value)}><option value="ionq">IonQ 2029</option><option value="conservative">Conservative 2032</option><option value="accelerated">Accelerated 2028</option></select><small>{horizon.note}</small></label></article>
      <Metric icon={ShieldAlert} value={critical} label="critical exposures" tone="red" trend="Requires action" />
      <Metric icon={Building2} value={total} label="observed assets" tone="blue" trend="Evidence inventory" />
      <Metric icon={ShieldCheck} value={`${safe} of ${total}`} label="quantum-safe assets" tone="green" trend={`${total-safe} still need modernization`} />
      <ReadinessDrivers scores={scores} setActive={setActive}/>
      <article className="card priorities"><div className="card-heading"><span><Target />Top priorities</span><button className="text-link" onClick={() => setActive("Remediation")}>View all <ChevronRight /></button></div>{[
        ["api-gateway-prod-01","RSA-2048","Alex R.","May 28"], ["vpn-concentrator-01","ECDH P-256","Maya K.","May 30"], ["ca-root-internal","RSA-4096","Chris D.","Jun 2"],
      ].map((r,i)=><div className="priority-row" key={r[0]}><span className="severity">Critical</span><div><b>{r[0]}</b><small>{r[1]}</small></div><span className={`mini-avatar a${i}`}>{r[2][0]}</span><span>{r[2]}</span><span><Clock3 />{r[3]}</span><button>Open plan</button></div>)}</article>
      <button className="latest-scan" onClick={() => setActive("Exposure")}><Globe2/><span><small>Latest scan evidence</small><b>{scans[0]?.targetLabel || "example.com"}</b> — <strong>Evidence saved</strong> — {timeAgo(scans[0]?.completedAt)}</span><ChevronRight/></button>
    </section>
  </>;
}

function Scan({ scans, setScans }) {
  const [mode, setMode] = useState("public");
  const [target, setTarget] = useState("example.com");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resultNote, setResultNote] = useState("");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [port, setPort] = useState(443);
  const [timeoutMs, setTimeoutMs] = useState(2500);
  const [targetLimit, setTargetLimit] = useState(12);
  useEffect(() => { if (!running) return; const timer = setInterval(() => setProgress(p => Math.min(p + 7, 92)), 450); return () => clearInterval(timer); }, [running]);
  async function startScan() {
    setError(""); setResultNote(""); setCompleted(false); setFailed(false); setRunning(true); setProgress(12);
    try {
      let request;
      const boundedPort = Math.max(1, Math.min(65535, Number(port) || 443));
      const boundedTimeout = Math.max(250, Math.min(mode === "public" ? 10000 : 5000, Number(timeoutMs) || 2500));
      if (mode === "public") request = { mode: "tls", host: target.replace(/^https?:\/\//, "").split("/")[0], port: boundedPort, timeoutMs: boundedTimeout };
      else if (mode === "device") request = { mode: "discovery", hosts: ["127.0.0.1", "localhost"], port: boundedPort, timeoutMs: boundedTimeout };
      else request = { mode: "discovery", hosts: target.split(/[\s,;]+/).filter(Boolean).slice(0, Math.max(1, Math.min(16, Number(targetLimit) || 12))), port: boundedPort, timeoutMs: boundedTimeout };
      const job = await createProbeJob(request);
      if (job.status === "FAILED" || !job.result) {
        const reason = job.error || "The target did not return usable TLS evidence.";
        setError(`Scan failed — no evidence collected. ${reason}`);
        setResultNote("No evidence collected.");
        setProgress(0); setFailed(true); setRunning(false);
        return;
      }
      const noReachableService = job.type === "discovery" && job.result?.summary?.completedCount === 0;
      if (noReachableService) {
        setError(`Scan completed, but no TLS service was detected on port ${boundedPort}. No cryptographic evidence was collected.`);
        setResultNote("No cryptographic evidence collected.");
        setProgress(0); setFailed(true); setRunning(false);
        return;
      }
      const observedScore = noReachableService ? null : job.riskScore;
      setResultNote("Scan completed and evidence saved.");
      setScans(prev => [{ ...job, targetLabel: job.targetLabel || target, riskScore: observedScore, completedAt: job.completedAt || new Date().toISOString(), status: job.status === "QUEUED" ? "RUNNING" : job.status }, ...prev.filter(s => s.id !== job.id)]);
      setTimeout(() => { setProgress(100); setCompleted(true); setRunning(false); }, 650);
    } catch (e) { setError(`Scan failed — no evidence collected. ${e.message || "The scan could not start."}`); setProgress(0); setFailed(true); setRunning(false); }
  }
  const modes = [["public",Globe2,"Public website"],["device",Laptop,"This device"],["network",Network,"Authorized network"]];
  return <>
    <PageTitle title="Scan your quantum exposure" subtitle="Check a public domain, this machine, or an authorized network." />
    <section className="scan-grid">
      <article className="card scan-composer"><div className="mode-tabs">{modes.map(([id,Icon,label])=><button className={mode===id?"active":""} onClick={()=>{setMode(id);setTarget(id==="public"?"example.com":id==="device"?"Local machine":"10.0.0.1, 10.0.0.2")}} key={id}><Icon/>{label}</button>)}</div><div className="target-input"><Search/><input value={target} onChange={e=>setTarget(e.target.value)} disabled={mode==="device"} aria-label="Scan target"/></div><div className="scan-actions"><button className={`secondary ${advancedOpen?"open":""}`} aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(open=>!open)}><Settings2/>Advanced options<ChevronDown/></button><button className="primary" disabled={running || !target.trim()} onClick={startScan}><Play/>{running?"Scanning…":"Start scan"}</button></div>{advancedOpen&&<div className="advanced-panel"><label><span>Service port</span><input aria-label="Service port" type="number" min="1" max="65535" value={port} onChange={e=>setPort(e.target.value)}/><small>443 is standard HTTPS/TLS.</small></label><label><span>Connection timeout</span><select aria-label="Connection timeout" value={timeoutMs} onChange={e=>setTimeoutMs(e.target.value)}><option value="1000">1 second</option><option value="2500">2.5 seconds</option><option value="5000">5 seconds</option>{mode==="public"&&<option value="10000">10 seconds</option>}</select><small>Longer helps slow or distant targets.</small></label>{mode==="network"&&<label><span>Maximum targets</span><input aria-label="Maximum targets" type="number" min="1" max="16" value={targetLimit} onChange={e=>setTargetLimit(e.target.value)}/><small>Safety limit: 16 hosts per scan.</small></label>}<div className="advanced-note"><ShieldCheck/><span><b>Evidence is saved automatically.</b><small>Results feed Exposure, Reports, and your readiness score.</small></span></div></div>}<p className="consent"><Shield/>Only scan systems you own or are authorized to test.</p>{error&&<p className="error">{error}</p>}</article>
      <article className={`card active-scan ${failed?"scan-failed":""}`}><div className="scan-target"><span className={`metric-icon ${failed?"red":"blue"}`}>{failed?<ShieldAlert/>:<Globe2/>}</span><b>{target || "example.com"}</b><span className={`status-pill ${failed?"failed":""}`}>{running?"Active scan":failed?"Failed":completed?"Completed":"Ready"}</span></div><div className="progress-layout"><div className="progress-ring" style={{"--progress":`${progress*3.6}deg`}}><div><strong>{failed?"—":`${progress}%`}</strong><span>{failed?"Failed":running?"Complete":completed?"Complete":"Ready"}</span></div></div><div className="steps">{["TLS handshake","Certificate chain","Algorithm analysis","Report pending"].map((s,i)=><div className={failed&&i===0?"failed":(progress > (i+1)*22)?"done":progress > i*22?"current":""} key={s}><i>{progress > (i+1)*22&&!failed?<Check/>:failed&&i===0?"!":null}</i><span>{s}</span><small>{failed&&i===0?"Failed":failed?"Not run":progress > (i+1)*22?"Done":progress > i*22?"Active":"Pending"}</small></div>)}</div></div><div className="scan-footer"><span>{failed?<ShieldAlert/>:<Clock3/>}{running?"Probe in progress":failed?(resultNote||"No evidence collected"):completed?(resultNote||"Scan completed"):"Choose a target to begin"}</span>{running&&<button className="secondary" onClick={()=>setRunning(false)}>Cancel scan</button>}</div></article>
      <RecentScans scans={scans} onRescan={(scan)=>{setTarget(scan.targetLabel);setMode(scan.type==="local"?"device":"public");}} />
      <article className="card check-card"><div className="card-heading"><span><ShieldCheck/>What we check</span></div>{[[KeyRound,"Key exchange","Evaluates TLS key exchange algorithms and strength."],[FileText,"Certificates","Checks validity, trust chain and configuration."],[Sparkles,"Signatures","Assesses digital signature algorithms and key sizes."],[Clock3,"Harvest-now-decrypt-later exposure","Identifies data at risk if encrypted today."]].map(([Icon,t,d])=><div className="check-row" key={t}><span><Icon/></span><div><b>{t}</b><small>{d}</small></div></div>)}<button className="text-link">Learn about scoring <ChevronRight/></button></article>
      <article className="card monitor-card"><div className="card-heading"><span><Activity/>Scheduled monitoring</span><label className="switch"><input type="checkbox" defaultChecked/><i/></label></div><p>We continuously monitor your approved assets.</p>{["example.com","api.quantumlink.dev"].map(x=><div className="monitor-row" key={x}><Globe2/><b>{x}</b><span>Next run<br/><strong>7:55 AM</strong></span><small><i/>Active</small></div>)}<button className="secondary"><Settings2/>Manage</button></article>
      <article className="insight"><span className="metric-icon blue"><Sparkles/></span><p><b>Public-facing crypto is the front door.</b> Internal systems may carry deeper legacy exposure.</p><button className="primary" onClick={()=>setMode("network")}>Build an assessment <ChevronRight/></button></article>
    </section>
  </>;
}

function RecentScans({ scans, onRescan }) {
  const rows = scans.filter(scan => scan.status === "COMPLETED" && scan.result && !(scan.type === "discovery" && scan.result?.summary?.completedCount === 0)).filter((s,i,a)=>a.findIndex(x=>x.targetLabel===s.targetLabel)===i).slice(0,3);
  return <article className="card recent-card"><div className="card-heading"><span><Clock3/>Recent scans</span><button className="text-link">View all</button></div>{rows.length?rows.map(scan=><div className="recent-row" key={scan.id}><span className="metric-icon blue">{scan.type==="local"?<Laptop/>:<Globe2/>}</span><div><b>{scan.targetLabel}</b><small>{timeAgo(scan.completedAt)}</small></div><span className="score score-evidence"><Check/> <small>Evidence saved</small></span><button onClick={()=>onRescan(scan)} aria-label={`Rescan ${scan.targetLabel}`}><RefreshCw/><small>Rescan</small></button></div>):<p className="empty-scans">No successful evidence collections yet.</p>}</article>;
}

function Readiness({ scores }) {
  const readiness = scores.readiness;
  const components = readiness.components;
  const [organizationTarget, setOrganizationTarget] = useState("2028-06-30");
  return <><PageTitle title="Q-Day Readiness" subtitle="How prepared the organization is to identify, prioritize, and migrate quantum-vulnerable systems."/><section className="content-grid"><article className="card score-explainer"><ScoreRing score={readiness.score}/><div><span className="eyebrow">The Quantum Readiness Score · Higher is better</span><h2>{readiness.score} / 100 · {readiness.classification}</h2><p>This is QuantumSentinel’s single headline score. It evaluates modernization, inventory coverage, migration planning, governance, and compensating controls from the available evidence.</p><span className="confidence-pill">{scores.confidence.label} · {scores.confidence.coverage}% coverage</span></div></article><article className="card methodology"><h2>How readiness is calculated</h2>{[["Crypto modernization",35,"Share of assets using hybrid or quantum-safe cryptography",components.cryptoModernization],["Inventory coverage",20,"Completeness of algorithm, protocol, classification, and risk evidence",components.inventoryCoverage],["Migration planning",20,"Vulnerable assets with a documented migration path",components.migrationPlanning],["Governance maturity",15,"Policy and compliance implementation progress",components.governanceMaturity],["Compensating controls",10,"Observed protections such as perfect forward secrecy",components.compensatingControls]].map(([t,w,d,v])=><div className="weight-row" key={t}><span>{w}%</span><div><b>{t}</b><small>{d}</small></div><div className="component-value"><i style={{width:`${Math.max(2,v)}%`}}/><em>{Math.round(v)} evidence points</em></div></div>)}</article><article className="card formula"><CircleHelp/><div><h3>Readiness interpretation</h3><p><b>0–24:</b> Unprepared · <b>25–49:</b> Early-stage · <b>50–69:</b> Transitioning · <b>70–84:</b> Prepared · <b>85–100:</b> Quantum-ready</p><small>Unknown or incomplete evidence reduces confidence; it must never be treated as proof of quantum safety.</small></div></article><article className="card org-timeline"><div><span className="eyebrow">Your controllable timeline</span><h2>Organizational readiness deadline</h2><p>Set when critical systems must be inventoried, migration-tested, and protected. This deadline should precede every external Q-Day scenario.</p></div><label>Target readiness date<input type="date" value={organizationTarget} onChange={event=>setOrganizationTarget(event.target.value)}/><small>{daysUntil(organizationTarget).toLocaleString()} days remaining</small></label><div className="timeline-steps"><span className="done"><Check/>Inventory baseline</span><span><CalendarClock/>Migration pilots</span><span><ShieldCheck/>Critical systems ready</span></div></article></section></>;
}

function Exposure({ data }) {
  const assets = data?.assets || [];
  const critical = assets.filter(asset => asset.prio === "CRITICAL").length || data?.summary?.criticalCount || 8;
  return <><PageTitle title="Quantum Exposure" subtitle="Where quantum-vulnerable cryptography creates urgency across the observed environment."><button className="secondary"><FileDown/>Export snapshot</button></PageTitle><section className="content-grid"><Metric icon={ShieldAlert} value={critical} label="critical exposures" tone="red" trend="Requires action"/><Metric icon={Clock3} value={data?.summary?.shorCount||12} label="HNDL candidates" tone="red"/><Metric icon={ShieldCheck} value={data?.summary?.safeCount||2} label="protected assets" tone="green"/><article className="card asset-list"><div className="card-heading"><span><Building2/>Highest exposure</span><div className="chips"><button className="selected">All</button><button>Public</button><button>Internal</button></div></div>{(assets.length?assets.slice(0,6):[{name:"api-gateway-prod-01",algo:"RSA-2048",prio:"CRITICAL"},{name:"vpn-concentrator-01",algo:"ECDH P-256",prio:"CRITICAL"},{name:"ca-root-internal",algo:"RSA-4096",prio:"HIGH"}]).map((a,i)=><div className="asset-row" key={a.id||a.name||i}><span className="metric-icon red"><ShieldAlert/></span><div><b>{a.hostname||a.name||a.id}</b><small>{a.algo||a.algorithm||a.cls||"Legacy cryptography"}</small></div><span className="severity">{a.prio||"HIGH"}</span><span>{a.segment||"Observed asset"}</span><button>View <ChevronRight/></button></div>)}</article></section></>;
}

function Remediation() { return <><PageTitle title="Remediation" subtitle="Turn quantum risk into an owned, sequenced migration plan."><button className="primary"><Wrench/>Create plan</button></PageTitle><section className="content-grid"><Metric icon={Target} value="8" label="open actions" tone="red"/><Metric icon={Activity} value="3" label="in progress" tone="blue"/><Metric icon={Check} value="4" label="completed" tone="green"/><article className="card asset-list"><div className="card-heading"><span><Wrench/>Migration queue</span><button className="text-link">Sort by urgency <ChevronDown/></button></div>{[["Replace RSA key exchange","api-gateway-prod-01","Alex R.","May 28","In progress"],["Pilot hybrid TLS","vpn-concentrator-01","Maya K.","May 30","Planned"],["Rotate root hierarchy","ca-root-internal","Chris D.","Jun 2","Blocked"]].map((x,i)=><div className="asset-row" key={x[0]}><span className={`step-number s${i}`}>{i+1}</span><div><b>{x[0]}</b><small>{x[1]}</small></div><span>{x[2]}</span><span>{x[3]}</span><span className="status-pill">{x[4]}</span><button>Open <ChevronRight/></button></div>)}</article></section></> }

function Reports({ scores }) { const cards=[["Executive posture",`Readiness ${scores.readiness.score}/100 · ${scores.readiness.classification} · ${scores.confidence.level} confidence`],["Q-Day readiness",`${scores.readiness.classification} · methodology, evidence, and timeline`],["Exposure findings","Critical findings, HNDL candidates, and affected assets"],["Migration plan","Owners, milestones, dependencies, and expected readiness impact"]]; return <><PageTitle title="Reports" subtitle="Clear, evidence-backed outputs centered on one Quantum Readiness Score."><button className="primary"><FileDown/>Generate report</button></PageTitle><section className="report-grid">{cards.map(([t,d],i)=><article className="card report-card" key={t}><span className={`report-icon r${i}`}><FileText/></span><div><h2>{t}</h2><p>{d}</p><small>Updated today · PDF & JSON</small></div><button className="secondary">Open <ChevronRight/></button></article>)}</section></> }

export default function App() {
  const [active, setActive] = useState(() => savedProfile().name ? "Scan" : "Overview");
  const [data, setData] = useState(null);
  const [scans, setScans] = useState(FALLBACK_SCANS);
  const [profile, setProfile] = useState(savedProfile);
  const [profileOpen, setProfileOpen] = useState(() => !savedProfile().name);
  useEffect(() => { Promise.all([loadApplianceData(), loadProbeJobs()]).then(([d,j]) => { setData(d); if (j?.length) setScans(j); }); }, []);
  const scores = useMemo(() => deriveQuantumScores(data || {}), [data]);
  const page = useMemo(() => {
    if (active === "Overview") return <Overview data={data} scores={scores} scans={scans} setActive={setActive} openProfile={()=>setProfileOpen(true)}/>;
    if (active === "Q-Day Readiness") return <Readiness scores={scores}/>;
    if (active === "Scan") return <Scan scans={scans} setScans={setScans}/>;
    if (active === "Exposure") return <Exposure data={data} scores={scores}/>;
    if (active === "Remediation") return <Remediation/>;
    return <Reports scores={scores}/>;
  }, [active, data, scores, scans]);
  const saveProfile = next => { setProfile(next); localStorage.setItem("quantumSentinel.organizationProfile", JSON.stringify(next)); setProfileOpen(false); };
  return <div className={`app ${profileOpen&&active==="Overview"?"profile-open":""}`}><Header active={active} setActive={setActive} openProfile={()=>{setActive("Overview");setProfileOpen(true)}}/>{profileOpen&&active==="Overview"&&<OrganizationProfile initialProfile={profile} onSave={saveProfile} onClose={()=>setProfileOpen(false)}/>}<main>{page}</main><footer>QuantumSentinel · Evidence, not hype. <span>Only scan systems you own or are authorized to assess.</span></footer></div>;
}
