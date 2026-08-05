// ── Mock data ────────────────────────────────────────────────────
export const ASSETS = [
  { id:1, hostname:"api-gateway-prod-01", ip:"10.0.1.10",  type:"Load Balancer",   algo:"RSA-2048",    proto:"TLS 1.3", cls:"SHOR-CRITICAL", hndl:91, tnfl:72, risk:94, prio:"CRITICAL", segment:"DMZ",        pfs:false, cert_exp:"2026-09-14", migration:"ML-KEM-768 + ML-DSA-65", complexity:"MEDIUM" },
  { id:2, hostname:"vpn-concentrator-01", ip:"10.0.0.1",   type:"VPN Gateway",     algo:"ECDH-P256",   proto:"IKEv2",   cls:"SHOR-CRITICAL", hndl:96, tnfl:61, risk:97, prio:"CRITICAL", segment:"Perimeter",  pfs:true,  cert_exp:"2026-12-01", migration:"ML-KEM-1024",             complexity:"HIGH" },
  { id:3, hostname:"ca-root-internal",    ip:"10.100.1.5", type:"CA Server",        algo:"RSA-4096",    proto:"PKIX",    cls:"SHOR-CRITICAL", hndl:44, tnfl:99, risk:98, prio:"CRITICAL", segment:"Internal",   pfs:false, cert_exp:"2031-06-30", migration:"ML-DSA-87",               complexity:"HIGH" },
  { id:4, hostname:"mail-gateway-01",     ip:"10.0.1.22",  type:"Mail Server",      algo:"ECDSA-P384",  proto:"SMTPS",   cls:"SHOR-CRITICAL", hndl:78, tnfl:68, risk:82, prio:"CRITICAL", segment:"DMZ",        pfs:true,  cert_exp:"2027-01-08", migration:"ML-KEM-768 + ML-DSA-65", complexity:"LOW" },
  { id:5, hostname:"db-primary-finance",  ip:"10.20.5.11", type:"Database",         algo:"RSA-2048",    proto:"TLS 1.2", cls:"SHOR-CRITICAL", hndl:88, tnfl:55, risk:90, prio:"CRITICAL", segment:"Finance",    pfs:false, cert_exp:"2026-08-20", migration:"ML-KEM-768",              complexity:"MEDIUM" },
  { id:6, hostname:"scada-hist-01",       ip:"10.50.1.3",  type:"OT Historian",     algo:"RSA-1024",    proto:"TLS 1.1", cls:"SHOR-CRITICAL", hndl:70, tnfl:85, risk:95, prio:"CRITICAL", segment:"OT",         pfs:false, cert_exp:"2028-03-01", migration:"REQUIRES HW REFRESH",     complexity:"HIGH" },
  { id:7, hostname:"code-sign-srv-01",    ip:"10.100.2.1", type:"Code Signing",     algo:"ECDSA-P256",  proto:"PKIX",    cls:"SHOR-CRITICAL", hndl:40, tnfl:97, risk:97, prio:"CRITICAL", segment:"Internal",   pfs:false, cert_exp:"2027-06-15", migration:"ML-DSA-65",               complexity:"LOW" },
  { id:8, hostname:"web-pub-shop",        ip:"10.0.1.55",  type:"Web Server",       algo:"ECDH-P384",   proto:"TLS 1.3", cls:"SHOR-CRITICAL", hndl:74, tnfl:60, risk:79, prio:"HIGH",     segment:"DMZ",        pfs:true,  cert_exp:"2027-02-28", migration:"ML-KEM-768",              complexity:"LOW" },
  { id:9, hostname:"vpn-remote-02",       ip:"10.0.0.2",   type:"VPN Gateway",      algo:"ECDH-P256",   proto:"IKEv2",   cls:"SHOR-CRITICAL", hndl:88, tnfl:55, risk:88, prio:"HIGH",     segment:"Perimeter",  pfs:true,  cert_exp:"2026-11-10", migration:"ML-KEM-768",              complexity:"MEDIUM" },
  { id:10,hostname:"k8s-api-server",      ip:"10.30.0.1",  type:"Container Orch.",  algo:"ECDSA-P256",  proto:"TLS 1.3", cls:"SHOR-CRITICAL", hndl:65, tnfl:80, risk:84, prio:"HIGH",     segment:"Cloud",      pfs:true,  cert_exp:"2027-04-01", migration:"ML-DSA-65 + ML-KEM-768", complexity:"MEDIUM" },
  { id:11,hostname:"sso-idp-prod",        ip:"10.10.1.10", type:"Identity Provider",algo:"RSA-2048",    proto:"TLS 1.3", cls:"SHOR-CRITICAL", hndl:60, tnfl:90, risk:88, prio:"HIGH",     segment:"Internal",   pfs:true,  cert_exp:"2027-09-30", migration:"ML-DSA-65 + ML-KEM-768", complexity:"MEDIUM" },
  { id:12,hostname:"ntp-server-01",       ip:"10.100.0.5", type:"NTP Server",       algo:"AES-256",     proto:"NTPsec",  cls:"QUANTUM-SAFE",  hndl:5,  tnfl:5,  risk:5,  prio:"MONITOR",  segment:"Internal",   pfs:false, cert_exp:"N/A",        migration:"None required",           complexity:"N/A" },
  { id:13,hostname:"api-gw-pqc-pilot",    ip:"10.0.1.11",  type:"Load Balancer",    algo:"X25519+ML-KEM",proto:"TLS 1.3",cls:"HYBRID",        hndl:12, tnfl:15, risk:14, prio:"MONITOR",  segment:"DMZ",        pfs:true,  cert_exp:"2027-08-01", migration:"Full PQC when ready",     complexity:"LOW" },
  { id:14,hostname:"smtp-internal",       ip:"10.10.2.5",  type:"Mail Server",      algo:"RSA-2048",    proto:"SMTPS",   cls:"SHOR-CRITICAL", hndl:55, tnfl:50, risk:60, prio:"MEDIUM",   segment:"Internal",   pfs:false, cert_exp:"2026-10-14", migration:"ML-KEM-768",              complexity:"LOW" },
  { id:15,hostname:"plc-boiler-ctrl-07",  ip:"10.50.2.7",  type:"OT PLC",           algo:"DES-56",      proto:"Modbus",  cls:"DEPRECATED",    hndl:82, tnfl:75, risk:92, prio:"CRITICAL", segment:"OT",         pfs:false, cert_exp:"N/A",        migration:"REQUIRES HW REFRESH",     complexity:"HIGH" },
];

export const ALERTS = [
  { id:1, ts:"14:23:07", sev:"CRITICAL", type:"HNDL",  msg:"New RSA-2048 certificate issued on db-backup-03 — regression detected", asset:"db-backup-03" },
  { id:2, ts:"13:55:41", sev:"CRITICAL", type:"TNFL",  msg:"CA certificate ca-root-internal will expire in 1,856 days — migration planning required before quantum timeline", asset:"ca-root-internal" },
  { id:3, ts:"13:30:12", sev:"HIGH",     type:"HNDL",  msg:"VPN concentrator negotiating IKEv1 with legacy client — downgrade detected", asset:"vpn-concentrator-01" },
  { id:4, ts:"12:44:01", sev:"HIGH",     type:"TNFL",  msg:"Code signing server certificate renewal due — current algorithm ECDSA-P256 is quantum-vulnerable", asset:"code-sign-srv-01" },
  { id:5, ts:"11:59:33", sev:"MEDIUM",   type:"DRIFT", msg:"TLS cipher suite on web-pub-shop changed — PFS re-enabled after 2h outage", asset:"web-pub-shop" },
  { id:6, ts:"11:14:22", sev:"INFO",     type:"PQC",   msg:"api-gw-pqc-pilot confirmed negotiating X25519+ML-KEM hybrid — pilot successful", asset:"api-gw-pqc-pilot" },
  { id:7, ts:"10:30:00", sev:"CRITICAL", type:"OT",    msg:"OT PLC plc-boiler-ctrl-07 detected with DES-56 — no PQC migration path; hardware refresh required", asset:"plc-boiler-ctrl-07" },
];

export const COMPLIANCE = [
  { name:"NSM-10 / ONCD", status:"RED",   pct:12, desc:"Federal inventory incomplete; 47 CRQC-vulnerable systems unmitigated" },
  { name:"CNSA 2.0",       status:"RED",   pct:8,  desc:"No national security systems migrated to ML-KEM-1024 / ML-DSA-87" },
  { name:"DORA Art. 9.2",  status:"AMBER", pct:55, desc:"Crypto asset register 55% complete; ICT-critical systems partially inventoried" },
  { name:"PCI DSS 12.3.3", status:"AMBER", pct:61, desc:"Cipher suite inventory active; 6 cardholder data systems using deprecated ciphers" },
  { name:"CMMC v2.0",      status:"AMBER", pct:48, desc:"Cryptographic controls partially documented; PQC roadmap required" },
  { name:"ISO 27001:2022", status:"GREEN", pct:80, desc:"Cryptographic policy updated; algorithm governance process established" },
];

export const TREND_DATA = [
  { day:"Dec",  risk:94, safe:6  },
  { day:"Jan",  risk:91, safe:9  },
  { day:"Feb",  risk:91, safe:9  },
  { day:"Mar",  risk:88, safe:12 },
  { day:"Apr",  risk:84, safe:16 },
  { day:"May",  risk:79, safe:21 },
];

export const ALGO_DIST = [
  { label:"RSA (various)", count:24, pct:38, cls:"SHOR-CRITICAL" },
  { label:"ECDH/ECDSA",    count:21, pct:33, cls:"SHOR-CRITICAL" },
  { label:"Hybrid PQC",    count:4,  pct:6,  cls:"HYBRID" },
  { label:"AES-256/SHA",   count:11, pct:17, cls:"QUANTUM-SAFE" },
  { label:"Deprecated",    count:4,  pct:6,  cls:"DEPRECATED" },
];
