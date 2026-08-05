import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Bell, Building2, CalendarClock, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, FileDown, FileText, Globe2, KeyRound,
  Laptop, Network, Play, RefreshCw, Search, Settings2, Shield, ShieldAlert,
  ShieldCheck, Sparkles, Target, Wrench,
} from "lucide-react";
import { loadApplianceData } from "./api.js";
import { createProbeJob, loadProbeJobs } from "./probeApi.js";
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

function scoreGrade(score) {
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
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

function Header({ active, setActive }) {
  return <header className="app-header">
    <Brand />
    <nav aria-label="Primary navigation">
      {NAV.map(([label, Icon]) => <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}><Icon />{label}</button>)}
    </nav>
    <div className="header-tools"><span className="live"><i />System live</span><button className="icon-button" aria-label="Notifications"><Bell /></button><button className="avatar">RG</button><ChevronDown className="chevron" /></div>
  </header>;
}

function PageTitle({ title, subtitle, children }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="title-actions">{children}</div>}</div>;
}

function ScoreRing({ score = 42, label = "Readiness" }) {
  return <div className="score-ring" style={{ "--score": `${score * 3.6}deg` }}><div><strong>{score}</strong><span>/ 100</span><small>{label}</small></div></div>;
}

function Metric({ icon: Icon, value, label, tone = "blue", trend }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon /></span><strong>{value}</strong><h3>{label}</h3>{trend && <p className={trend.startsWith("+") ? "positive" : "negative"}>{trend} <span>vs 30 days ago</span></p>}</article>;
}

function Overview({ data, scans, setActive }) {
  const summary = data?.summary || {};
  const total = summary.totalAssets || 15;
  const critical = summary.criticalCount || 8;
  const safe = summary.safeCount || 2;
  const readiness = Math.max(0, Math.min(100, 100 - (summary.overallRisk || 58)));
  return <>
    <PageTitle title="Good morning, Rick" subtitle="Your cryptographic exposure, distilled.">
      <button className="primary" onClick={() => setActive("Scan")}><Play />Run a scan</button>
      <button className="secondary" onClick={() => setActive("Reports")}><FileText />View report</button>
    </PageTitle>
    <section className="overview-grid">
      <article className="card readiness-summary"><div className="card-heading"><span><ShieldCheck />Q-Day Readiness</span><CircleHelp /></div><div className="readiness-content"><ScoreRing score={readiness || 42} /><div><h2>High exposure</h2><p>{critical} critical systems still depend on quantum-vulnerable cryptography.</p><span className="grade">D</span> Grade</div></div><button className="text-link" onClick={() => setActive("Q-Day Readiness")}>How this score works <ChevronRight /></button></article>
      <article className="card horizon"><div className="card-heading"><span><CalendarClock />Q-Day horizon</span><Settings2 /></div><strong>879</strong><h2>days</h2><label>Scenario<select><option>IonQ 2029</option><option>Conservative 2032</option><option>Accelerated 2028</option></select></label></article>
      <Metric icon={Building2} value={total} label="assets" tone="blue" trend="+12%" />
      <Metric icon={ShieldAlert} value={critical} label="critical" tone="red" trend="-14%" />
      <Metric icon={ShieldCheck} value={safe} label="quantum-safe" tone="green" trend="+33%" />
      <article className="card trend-card"><div className="card-heading"><span><Activity />Readiness trend</span><div className="chips"><button>30D</button><button className="selected">6M</button><button>1Y</button></div></div><p>Readiness score over time</p><div className="chart" aria-label="Readiness score increased from 31 to 42"><div className="chart-grid"/><svg viewBox="0 0 620 180" role="img"><path className="area" d="M20 145 L130 138 L240 129 L350 121 L460 106 L590 91 L590 170 L20 170 Z"/><polyline points="20,145 130,138 240,129 350,121 460,106 590,91"/><g>{[[20,145,31],[130,138,33],[240,129,35],[350,121,37],[460,106,40],[590,91,42]].map(([x,y,n])=><g key={n}><circle cx={x} cy={y} r="5"/><text x={x} y={y-14}>{n}</text></g>)}</g></svg><div className="months"><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span></div></div></article>
      <article className="card priorities"><div className="card-heading"><span><Target />Top priorities</span><button className="text-link" onClick={() => setActive("Remediation")}>View all <ChevronRight /></button></div>{[
        ["api-gateway-prod-01","RSA-2048","Alex R.","May 28"], ["vpn-concentrator-01","ECDH P-256","Maya K.","May 30"], ["ca-root-internal","RSA-4096","Chris D.","Jun 2"],
      ].map((r,i)=><div className="priority-row" key={r[0]}><span className="severity">Critical</span><div><b>{r[0]}</b><small>{r[1]}</small></div><span className={`mini-avatar a${i}`}>{r[2][0]}</span><span>{r[2]}</span><span><Clock3 />{r[3]}</span><button>Open plan</button></div>)}</article>
      <button className="latest-scan" onClick={() => setActive("Exposure")}><Globe2/><span><small>Latest public website scan</small><b>{scans[0]?.targetLabel || "example.com"}</b> — <strong>{scans[0]?.riskScore || 79} / {scoreGrade(scans[0]?.riskScore || 79)}</strong> — {timeAgo(scans[0]?.completedAt)}</span><ChevronRight/></button>
    </section>
  </>;
}

function Scan({ scans, setScans }) {
  const [mode, setMode] = useState("public");
  const [target, setTarget] = useState("example.com");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [resultNote, setResultNote] = useState("");
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [port, setPort] = useState(443);
  const [timeoutMs, setTimeoutMs] = useState(2500);
  const [targetLimit, setTargetLimit] = useState(12);
  useEffect(() => { if (!running) return; const timer = setInterval(() => setProgress(p => Math.min(p + 7, 92)), 450); return () => clearInterval(timer); }, [running]);
  async function startScan() {
    setError(""); setResultNote(""); setCompleted(false); setRunning(true); setProgress(12);
    try {
      let request;
      const boundedPort = Math.max(1, Math.min(65535, Number(port) || 443));
      const boundedTimeout = Math.max(250, Math.min(mode === "public" ? 10000 : 5000, Number(timeoutMs) || 2500));
      if (mode === "public") request = { mode: "tls", host: target.replace(/^https?:\/\//, "").split("/")[0], port: boundedPort, timeoutMs: boundedTimeout };
      else if (mode === "device") request = { mode: "discovery", hosts: ["127.0.0.1", "localhost"], port: boundedPort, timeoutMs: boundedTimeout };
      else request = { mode: "discovery", hosts: target.split(/[\s,;]+/).filter(Boolean).slice(0, Math.max(1, Math.min(16, Number(targetLimit) || 12))), port: boundedPort, timeoutMs: boundedTimeout };
      const job = await createProbeJob(request);
      const noReachableService = job.type === "discovery" && job.result?.summary?.completedCount === 0;
      const observedScore = noReachableService ? null : job.riskScore;
      setResultNote(noReachableService ? `No TLS service detected on port ${boundedPort}.` : "Scan completed and evidence saved.");
      setScans(prev => [{ ...job, targetLabel: job.targetLabel || target, riskScore: observedScore, completedAt: job.completedAt || new Date().toISOString(), status: job.status === "QUEUED" ? "RUNNING" : job.status }, ...prev.filter(s => s.id !== job.id)]);
      setTimeout(() => { setProgress(100); setCompleted(true); setRunning(false); }, 650);
    } catch (e) { setError(e.message || "Scan could not start"); setRunning(false); }
  }
  const modes = [["public",Globe2,"Public website"],["device",Laptop,"This device"],["network",Network,"Authorized network"]];
  return <>
    <PageTitle title="Scan your quantum exposure" subtitle="Check a public domain, this machine, or an authorized network." />
    <section className="scan-grid">
      <article className="card scan-composer"><div className="mode-tabs">{modes.map(([id,Icon,label])=><button className={mode===id?"active":""} onClick={()=>{setMode(id);setTarget(id==="public"?"example.com":id==="device"?"Local machine":"10.0.0.1, 10.0.0.2")}} key={id}><Icon/>{label}</button>)}</div><div className="target-input"><Search/><input value={target} onChange={e=>setTarget(e.target.value)} disabled={mode==="device"} aria-label="Scan target"/></div><div className="scan-actions"><button className={`secondary ${advancedOpen?"open":""}`} aria-expanded={advancedOpen} onClick={()=>setAdvancedOpen(open=>!open)}><Settings2/>Advanced options<ChevronDown/></button><button className="primary" disabled={running || !target.trim()} onClick={startScan}><Play/>{running?"Scanning…":"Start scan"}</button></div>{advancedOpen&&<div className="advanced-panel"><label><span>Service port</span><input aria-label="Service port" type="number" min="1" max="65535" value={port} onChange={e=>setPort(e.target.value)}/><small>443 is standard HTTPS/TLS.</small></label><label><span>Connection timeout</span><select aria-label="Connection timeout" value={timeoutMs} onChange={e=>setTimeoutMs(e.target.value)}><option value="1000">1 second</option><option value="2500">2.5 seconds</option><option value="5000">5 seconds</option>{mode==="public"&&<option value="10000">10 seconds</option>}</select><small>Longer helps slow or distant targets.</small></label>{mode==="network"&&<label><span>Maximum targets</span><input aria-label="Maximum targets" type="number" min="1" max="16" value={targetLimit} onChange={e=>setTargetLimit(e.target.value)}/><small>Safety limit: 16 hosts per scan.</small></label>}<div className="advanced-note"><ShieldCheck/><span><b>Evidence is saved automatically.</b><small>Results feed Exposure, Reports, and your readiness score.</small></span></div></div>}<p className="consent"><Shield/>Only scan systems you own or are authorized to test.</p>{error&&<p className="error">{error}</p>}</article>
      <article className="card active-scan"><div className="scan-target"><span className="metric-icon blue"><Globe2/></span><b>{target || "example.com"}</b><span className="status-pill">{running?"Active scan":completed?"Completed":"Ready"}</span></div><div className="progress-layout"><div className="progress-ring" style={{"--progress":`${progress*3.6}deg`}}><div><strong>{progress}%</strong><span>{running?"Complete":completed?"Complete":"Ready"}</span></div></div><div className="steps">{["TLS handshake","Certificate chain","Algorithm analysis","Report pending"].map((s,i)=><div className={(progress > (i+1)*22)?"done":progress > i*22?"current":""} key={s}><i>{progress > (i+1)*22?<Check/>:null}</i><span>{s}</span><small>{progress > (i+1)*22?"Done":progress > i*22?"Active":"Pending"}</small></div>)}</div></div><div className="scan-footer"><span><Clock3/>{running?"About 24 seconds left":completed?(resultNote||"Scan completed"):"Choose a target to begin"}</span>{running&&<button className="secondary" onClick={()=>setRunning(false)}>Cancel scan</button>}</div></article>
      <RecentScans scans={scans} onRescan={(scan)=>{setTarget(scan.targetLabel);setMode(scan.type==="local"?"device":"public");}} />
      <article className="card check-card"><div className="card-heading"><span><ShieldCheck/>What we check</span></div>{[[KeyRound,"Key exchange","Evaluates TLS key exchange algorithms and strength."],[FileText,"Certificates","Checks validity, trust chain and configuration."],[Sparkles,"Signatures","Assesses digital signature algorithms and key sizes."],[Clock3,"Harvest-now-decrypt-later exposure","Identifies data at risk if encrypted today."]].map(([Icon,t,d])=><div className="check-row" key={t}><span><Icon/></span><div><b>{t}</b><small>{d}</small></div></div>)}<button className="text-link">Learn about scoring <ChevronRight/></button></article>
      <article className="card monitor-card"><div className="card-heading"><span><Activity/>Scheduled monitoring</span><label className="switch"><input type="checkbox" defaultChecked/><i/></label></div><p>We continuously monitor your approved assets.</p>{["example.com","api.quantumlink.dev"].map(x=><div className="monitor-row" key={x}><Globe2/><b>{x}</b><span>Next run<br/><strong>7:55 AM</strong></span><small><i/>Active</small></div>)}<button className="secondary"><Settings2/>Manage</button></article>
      <article className="insight"><span className="metric-icon blue"><Sparkles/></span><p><b>Public-facing crypto is the front door.</b> Internal systems may carry deeper legacy exposure.</p><button className="primary" onClick={()=>setMode("network")}>Build an assessment <ChevronRight/></button></article>
    </section>
  </>;
}

function RecentScans({ scans, onRescan }) {
  const rows = [...scans, ...FALLBACK_SCANS].filter((s,i,a)=>a.findIndex(x=>x.targetLabel===s.targetLabel)===i).slice(0,3);
  return <article className="card recent-card"><div className="card-heading"><span><Clock3/>Recent scans</span><button className="text-link">View all</button></div>{rows.map(scan=>{const hasScore=Number.isFinite(scan.riskScore)&&scan.riskScore>0;return <div className="recent-row" key={scan.id}><span className="metric-icon blue">{scan.type==="local"?<Laptop/>:<Globe2/>}</span><div><b>{scan.targetLabel}</b><small>{timeAgo(scan.completedAt)}</small></div><span className={`score ${hasScore?`score-${scoreGrade(scan.riskScore).toLowerCase()}`:"score-none"}`}>{hasScore?scan.riskScore:"—"} <small>{hasScore?scoreGrade(scan.riskScore):"No score"}</small></span><button onClick={()=>onRescan(scan)} aria-label={`Rescan ${scan.targetLabel}`}><RefreshCw/><small>Rescan</small></button></div>})}</article>;
}

function Readiness() {
  return <><PageTitle title="Q-Day Readiness" subtitle="A transparent score for how prepared your cryptography is for a post-quantum future."/><section className="content-grid"><article className="card score-explainer"><ScoreRing score={42}/><div><span className="eyebrow">Current score</span><h2>42 / 100 · High exposure</h2><p>The score combines cryptographic inventory, exposure, data lifetime, business criticality, and migration progress. It is a prioritization signal—not a prediction of when a cryptographically relevant quantum computer will arrive.</p></div></article><article className="card methodology"><h2>How your score is calculated</h2>{[["Cryptographic exposure",30,"Algorithms and key sizes visible across assets"],["Harvest-now-decrypt-later risk",25,"How long protected data must remain confidential"],["Business criticality",20,"Operational and financial impact of each asset"],["Migration readiness",15,"Inventory coverage, owners and tested plans"],["Compensating controls",10,"Segmentation, rotation and hybrid protections"]].map(([t,w,d])=><div className="weight-row" key={t}><span>{w}%</span><div><b>{t}</b><small>{d}</small></div><div><i style={{width:`${w*3}%`}}/></div></div>)}</article><article className="card formula"><CircleHelp/><div><h3>Score interpretation</h3><p><b>0–49:</b> High exposure · <b>50–74:</b> Transitioning · <b>75–100:</b> Ready</p><small>Scores reflect observed evidence and declared inventory. Unknown assets reduce confidence.</small></div></article></section></>;
}

function Exposure({ data }) {
  const assets = data?.assets || [];
  return <><PageTitle title="Exposure" subtitle="See where quantum-vulnerable cryptography creates the most business risk."><button className="secondary"><FileDown/>Export snapshot</button></PageTitle><section className="content-grid"><Metric icon={ShieldAlert} value={data?.summary?.criticalCount||8} label="critical exposures" tone="red"/><Metric icon={Clock3} value={data?.summary?.shorCount||12} label="HNDL candidates" tone="red"/><Metric icon={ShieldCheck} value={data?.summary?.safeCount||2} label="protected assets" tone="green"/><article className="card asset-list"><div className="card-heading"><span><Building2/>Highest exposure</span><div className="chips"><button className="selected">All</button><button>Public</button><button>Internal</button></div></div>{(assets.length?assets.slice(0,6):[{name:"api-gateway-prod-01",algo:"RSA-2048",risk:91},{name:"vpn-concentrator-01",algo:"ECDH P-256",risk:88},{name:"ca-root-internal",algo:"RSA-4096",risk:84}]).map((a,i)=><div className="asset-row" key={a.id||a.name||i}><span className="metric-icon red"><ShieldAlert/></span><div><b>{a.name||a.id}</b><small>{a.algo||a.algorithm||a.cls||"Legacy cryptography"}</small></div><span className="risk-bar"><i style={{width:`${a.risk||80}%`}}/></span><strong>{a.risk||80}</strong><button>View <ChevronRight/></button></div>)}</article></section></>;
}

function Remediation() { return <><PageTitle title="Remediation" subtitle="Turn quantum risk into an owned, sequenced migration plan."><button className="primary"><Wrench/>Create plan</button></PageTitle><section className="content-grid"><Metric icon={Target} value="8" label="open actions" tone="red"/><Metric icon={Activity} value="3" label="in progress" tone="blue"/><Metric icon={Check} value="4" label="completed" tone="green"/><article className="card asset-list"><div className="card-heading"><span><Wrench/>Migration queue</span><button className="text-link">Sort by urgency <ChevronDown/></button></div>{[["Replace RSA key exchange","api-gateway-prod-01","Alex R.","May 28","In progress"],["Pilot hybrid TLS","vpn-concentrator-01","Maya K.","May 30","Planned"],["Rotate root hierarchy","ca-root-internal","Chris D.","Jun 2","Blocked"]].map((x,i)=><div className="asset-row" key={x[0]}><span className={`step-number s${i}`}>{i+1}</span><div><b>{x[0]}</b><small>{x[1]}</small></div><span>{x[2]}</span><span>{x[3]}</span><span className="status-pill">{x[4]}</span><button>Open <ChevronRight/></button></div>)}</article></section></> }

function Reports() { const cards=[["Executive summary","Board-ready posture and top priorities"],["Q-Day readiness","Score, methodology and evidence confidence"],["Exposure inventory","Observed algorithms, assets and findings"],["Migration plan","Owners, milestones and dependencies"]]; return <><PageTitle title="Reports" subtitle="Clear, evidence-backed outputs for leaders, auditors, and engineering teams."><button className="primary"><FileDown/>Generate report</button></PageTitle><section className="report-grid">{cards.map(([t,d],i)=><article className="card report-card" key={t}><span className={`report-icon r${i}`}><FileText/></span><div><h2>{t}</h2><p>{d}</p><small>Updated today · PDF & JSON</small></div><button className="secondary">Open <ChevronRight/></button></article>)}</section></> }

export default function App() {
  const [active, setActive] = useState("Scan");
  const [data, setData] = useState(null);
  const [scans, setScans] = useState(FALLBACK_SCANS);
  useEffect(() => { Promise.all([loadApplianceData(), loadProbeJobs()]).then(([d,j]) => { setData(d); if (j?.length) setScans(j); }); }, []);
  const page = useMemo(() => {
    if (active === "Overview") return <Overview data={data} scans={scans} setActive={setActive}/>;
    if (active === "Q-Day Readiness") return <Readiness/>;
    if (active === "Scan") return <Scan scans={scans} setScans={setScans}/>;
    if (active === "Exposure") return <Exposure data={data}/>;
    if (active === "Remediation") return <Remediation/>;
    return <Reports/>;
  }, [active, data, scans]);
  return <div className="app"><Header active={active} setActive={setActive}/><main>{page}</main><footer>QuantumSentinel · Evidence, not hype. <span>Only scan systems you own or are authorized to assess.</span></footer></div>;
}
