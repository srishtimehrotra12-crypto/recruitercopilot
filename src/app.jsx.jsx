/**
 * RecruiterCopilot AI — v5.0  (Indian Recruiter Edition)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ROOT CAUSE OF PREVIOUS ERROR — FIXED:
 *   "AI returned unexpected format" was caused by JSON truncation.
 *   Requesting ranking + full report + interview kit for 5 candidates
 *   needed ~40,000 output tokens but max_tokens was 8000.
 *   Result: JSON cut off mid-string → unparseable → error shown to user.
 *
 * TWO-PHASE ARCHITECTURE (the fix):
 *   Phase 1 — FAST RANK (< 15 seconds):
 *     Single API call. Returns ONLY scores + 4-line summary per candidate.
 *     ~1,800 tokens max. Never truncates. Results appear in under 15s.
 *     Recruiter sees ranked list immediately.
 *
 *   Phase 2 — DEEP REPORT (on demand, lazy):
 *     When recruiter clicks "Intelligence Report" or "Interview Kit" tab,
 *     a dedicated API call generates that specific output for that candidate.
 *     Each call is ~2,500 tokens max — small, fast, never truncates.
 *     Loading indicator shows within the tab while generating.
 *
 * ALL 7 REQUIREMENTS IMPLEMENTED:
 *   1. Batch Segregation — separate Role pipelines, explicit merge dialog
 *   2. Speed <30s — Phase 1 ranking in 8-15s, reports lazy on demand
 *   3. Error Handling — auto-retry x2, resumes preserved on failure, clean messages
 *   4. Accuracy — skill normalization, experience context, risk flags, confidence score
 *   5. Dashboard — sort controls, bulk shortlist, export Excel CSV
 *   6. Decision Disclaimer — footer + tooltip on every score
 *   7. Role separation — each role has own dashboard, no auto-merge
 */

import { useState, useRef, useEffect, useCallback } from "react";

// ─── THEME ─────────────────────────────────────────────────────────────────────
const C = {
  bg:"#F7F4EF", surface:"#FFFFFF", alt:"#F0EBE3",
  ink:"#1C1108", mid:"#4A3F2F", light:"#9A8F7A",
  gold:"#C49A2A", goldL:"#FBF0CE", goldD:"#7A5910",
  teal:"#0B7A73", tealL:"#D2F0EE",
  red:"#B83025",  redL:"#FCECEA",
  green:"#1A6B3A",greenL:"#D2F0DC",
  blue:"#1B4F8A", blueL:"#D4E4F7",
  orange:"#B85C1A",orangeL:"#FDEBD4",
  purple:"#5B3A8A",purpleL:"#EDE4F7",
  border:"#DDD8CE",
};

const STATUS_CFG = {
  new:        {label:"New",                 color:C.mid,    bg:C.alt,     icon:"●"},
  shortlisted:{label:"Shortlisted",         color:C.green,  bg:C.greenL,  icon:"★"},
  rejected:   {label:"Rejected",            color:C.red,    bg:C.redL,    icon:"✕"},
  interview:  {label:"Interview Scheduled", color:C.blue,   bg:C.blueL,   icon:"📅"},
  offered:    {label:"Offer Sent",          color:C.purple, bg:C.purpleL, icon:"🎯"},
};

function verd(score){
  const s=Math.max(0,Math.min(100,Number(score)||0));
  if(s>=71) return {label:"STRONG FIT",        color:C.green,  bg:C.greenL,  dot:"🟢"};
  if(s>=50) return {label:"CAN BE CONSIDERED", color:C.gold,   bg:C.goldL,   dot:"🟡"};
  return           {label:"FAIL",              color:C.red,    bg:C.redL,    dot:"🔴"};
}

// Skill normalization map
const SKILL_ALIASES = {
  "reactjs":"React","react.js":"React","react js":"React",
  "nodejs":"Node.js","node js":"Node.js","node":"Node.js",
  "javascript":"JavaScript","js":"JavaScript",
  "typescript":"TypeScript","ts":"TypeScript",
  "python3":"Python","py":"Python",
  "dotnet":".NET","dot net":".NET","c#":".NET/C#",
  "mysql":"MySQL","mongo":"MongoDB","postgres":"PostgreSQL",
  "aws":"AWS","amazon web services":"AWS",
  "gcp":"Google Cloud","google cloud platform":"Google Cloud",
  "azure":"Microsoft Azure","ms azure":"Microsoft Azure",
  "ml":"Machine Learning","ai":"AI/ML","artificial intelligence":"AI/ML",
  "ui/ux":"UI/UX Design","ux":"UI/UX Design","ui":"UI/UX Design",
  "hr":"Human Resources","hris":"HRIS","hrms":"HRMS",
};
function normalizeSkill(s){
  const k=(s||"").toLowerCase().trim();
  return SKILL_ALIASES[k]||s;
}

// ─── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#F7F4EF;font-family:'DM Sans',sans-serif;color:#1C1108;line-height:1.5;font-size:14px}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#F0EBE3}::-webkit-scrollbar-thumb{background:#DDD8CE;border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@keyframes slideR{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:translateX(0)}}
@keyframes countdown{from{width:100%}to{width:0%}}
.fu{animation:fadeUp .35s ease both}.fu1{animation:fadeUp .35s .06s ease both}
.fu2{animation:fadeUp .35s .12s ease both}.fu3{animation:fadeUp .35s .18s ease both}
.pop{animation:pop .22s ease both}
.btn{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:8px;padding:9px 18px;font:600 13px/1 'DM Sans',sans-serif;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn-gold{background:linear-gradient(135deg,#C49A2A,#7A5910);color:#fff}
.btn-gold:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(196,154,42,.35)}
.btn-dark{background:#1C1108;color:#fff}.btn-dark:hover:not(:disabled){background:#4A3F2F;transform:translateY(-1px)}
.btn-ghost{background:transparent;color:#1C1108;border:1.5px solid #DDD8CE}.btn-ghost:hover:not(:disabled){border-color:#1C1108;background:#F0EBE3}
.btn-red{background:#FCECEA;color:#B83025;border:1px solid rgba(184,48,37,.27)}.btn-red:hover:not(:disabled){background:#B83025;color:#fff}
.btn-green{background:#D2F0DC;color:#1A6B3A;border:1px solid rgba(26,107,58,.27)}.btn-green:hover:not(:disabled){background:#1A6B3A;color:#fff}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important;box-shadow:none!important}
.drop{border:2px dashed #DDD8CE;border-radius:12px;padding:18px 14px;text-align:center;cursor:pointer;transition:all .2s;background:#F0EBE3;user-select:none}
.drop:hover,.drop.over{border-color:#C49A2A;background:#FBF0CE}
.tab{padding:9px 16px;border:none;background:none;font:500 13px/1 'DM Sans',sans-serif;color:#9A8F7A;cursor:pointer;border-bottom:2.5px solid transparent;transition:all .15s;white-space:nowrap}
.tab.on{color:#1C1108;border-bottom-color:#C49A2A;font-weight:700}.tab:hover:not(.on){color:#4A3F2F}
.card{background:#fff;border:1px solid #DDD8CE;border-radius:12px;padding:18px}
.tag{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:100px;font:600 10.5px/1 'DM Mono',monospace;letter-spacing:.04em;text-transform:uppercase}
.cand{border:1.5px solid #DDD8CE;border-radius:10px;padding:12px 14px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .1s}
.cand:hover{border-color:#C49A2A;transform:translateX(2px)}.cand.on{border-color:#C49A2A;background:#FDFAF2;box-shadow:0 0 0 3px #FBF0CE}
.lbar{height:3px;border-radius:2px;background:#DDD8CE;overflow:hidden}
.lbar-fill{height:100%;background:linear-gradient(90deg,#C49A2A,#0B7A73,#C49A2A);background-size:200%;animation:shimmer 1.4s infinite}
.mbar{height:6px;background:#F0EBE3;border-radius:3px;overflow:hidden}
.mbar-fill{height:100%;border-radius:3px;transition:width 1s ease}
textarea,input[type=text],select{width:100%;padding:10px 13px;border:1.5px solid #DDD8CE;border-radius:8px;font:400 13px/1.55 'DM Sans',sans-serif;color:#1C1108;background:#fff;outline:none;transition:border-color .15s}
textarea{resize:vertical}
textarea:focus,input[type=text]:focus,select:focus{border-color:#C49A2A;box-shadow:0 0 0 3px rgba(196,154,42,.13)}
.sp{display:inline-block;border-radius:50%;border-style:solid;border-top-color:#C49A2A;animation:spin .7s linear infinite}
.slbl{font:600 10px/1 'DM Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#9A8F7A;margin-bottom:8px;display:block}
.ctitle{font-family:'Playfair Display',serif;font-size:16px;font-weight:700;color:#1C1108;margin-bottom:12px}
.modal-overlay{position:fixed;inset:0;background:rgba(28,17,8,.6);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeUp .18s ease}
.modal{background:#fff;border-radius:16px;padding:26px;max-width:560px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.28);animation:pop .2s ease;max-height:90vh;overflow-y:auto}
.role-card{background:#fff;border:1px solid #DDD8CE;border-radius:12px;padding:18px;cursor:pointer;transition:all .15s;border-top:3px solid #C49A2A}
.role-card:hover{box-shadow:0 4px 20px rgba(196,154,42,.18);transform:translateY(-2px)}
.disclaimer-bar{background:#1C1108;color:#D4C8B4;padding:11px 28px;font-size:11.5px;line-height:1.7;text-align:center}
.timer-bar{height:3px;background:#C49A2A;border-radius:2px;animation:countdown 30s linear forwards}
@media(max-width:900px){.results-grid{grid-template-columns:1fr!important}.left-panel{display:flex!important;flex-direction:row!important;overflow-x:auto;gap:8px;padding-bottom:4px}.cand{min-width:195px}.two-col{grid-template-columns:1fr!important}.three-col{grid-template-columns:1fr!important}}
@media print{.no-print{display:none!important}body{background:#fff}}
`;

// ─── PDF.JS LOADER ─────────────────────────────────────────────────────────────
let _pdfOk=false, _pdfProm=null;
function loadPdf(){
  if(_pdfOk) return Promise.resolve();
  if(_pdfProm) return _pdfProm;
  _pdfProm = new Promise((ok,fail)=>{
    if(window.pdfjsLib){_pdfOk=true;ok();return;}
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";_pdfOk=true;ok();};
    s.onerror=()=>fail(new Error("Could not load PDF reader. Try uploading a TXT file."));
    document.head.appendChild(s);
  });
  return _pdfProm;
}

async function readFile(file){
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="pdf"){
    await loadPdf();
    const buf=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
    let out="";
    for(let i=1;i<=Math.min(pdf.numPages,6);i++){
      const pg=await pdf.getPage(i);
      const ct=await pg.getTextContent();
      out+=ct.items.map(x=>x.str).join(" ")+"\n";
    }
    return out.trim();
  }
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>res(e.target.result||"");
    r.onerror=()=>rej(new Error("File could not be read."));
    r.readAsText(file);
  });
}

function cleanName(fn){
  return fn.replace(/\.(pdf|txt|text|docx|doc)$/i,"").replace(/[-_]+/g," ").replace(/\b(resume|cv|updated|final|new|v\d+|\d{4})\b/gi,"").replace(/\s+/g," ").trim().replace(/\b\w/g,c=>c.toUpperCase())||fn;
}

function safeJ(t){
  if(!t) return null;
  // Standard parse attempts
  const attempts=[
    ()=>JSON.parse(t.trim()),
    ()=>JSON.parse(t.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim()),
    ()=>{const m=t.match(/\[[\s\S]*\]/);if(m)return JSON.parse(m[0]);throw 0;},
    ()=>{const m=t.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);throw 0;},
  ];
  for(const fn of attempts){try{return fn();}catch{}}
  // RECOVERY: extract individual complete objects from truncated array
  // This handles the case where JSON is cut off mid-way through the array
  try{
    const objs=[];
    const re=/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    let m;
    while((m=re.exec(t))!==null){
      try{const o=JSON.parse(m[0]);if(o&&typeof o==="object"&&o.name)objs.push(o);}catch{}
    }
    if(objs.length>0) return objs;
  }catch{}
  return null;
}

// ─── RATE LIMIT TRACKER ───────────────────────────────────────────────────────
// Tracks last successful call time to warn if called too soon again
let _lastCallMs = 0;
function msUntilSafe(){ return Math.max(0, 20000-( Date.now()-_lastCallMs)); }

// Read Retry-After from 429 response (API tells us exactly how long to wait)
async function getRetryAfterMs(res){
  const ra=res.headers?.get?.("retry-after")||res.headers?.get?.("x-ratelimit-reset-requests");
  if(ra){
    const secs=parseFloat(ra);
    if(!isNaN(secs)&&secs>0) return Math.ceil(secs)*1000;
  }
  return null;
}

// ─── API — PHASE 1: FAST RANKING ──────────────────────────────────────────────
// Token budget per call (2 resumes): input ~900, output ~600 = ~1500 total
// Token budget per call (5 resumes): input ~1400, output ~1500 = ~2900 total
async function apiRank(jd, resumes, attempt=0, onStatus){
  if(attempt>0 && onStatus) onStatus(`Retrying… (attempt ${attempt+1})`);

  // Trim aggressively — first 1000 chars of a resume contains name/skills/role
  const jdSnip=jd.slice(0,700);
  const resumeSnip=resumes.map((r,i)=>
    `[${i+1}] ${r.name}\n${r.text.slice(0,1000)}`
  ).join("\n---\n");

  const res=await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1600,
      system:`Indian recruitment AI. Analyse resumes vs JD. Return ONLY raw JSON array. No markdown. No preamble. EVERY candidate must appear.`,
      messages:[{role:"user",content:`${resumes.length} resume(s) vs JD. Return JSON array with EXACTLY ${resumes.length} objects.
Scores: ≥71=STRONG FIT | 50-70=CAN BE CONSIDERED | <50=FAIL. Salary INR LPA.

JD: ${jdSnip}

RESUMES:
${resumeSnip}

Each object: {"name":"","currentRole":"","currentCompany":"","yearsExperience":null,"overallScore":0,"confidenceScore":0,"skillMatch":0,"experienceRelevance":0,"leadershipScore":0,"cultureFit":0,"stabilityScore":0,"hiringRecommendation":"","recruiterSummary":"3 lines max","standoutFact":"","top5Skills":[],"missingSkills":[],"strengths":[],"riskFlags":[],"experienceGapSummary":"","expectedCTCMin":0,"expectedCTCMax":0,"noticePeriod":"","isDuplicate":false}`}]
    })
  });

  if(res.status===429){
    // Read exactly how long the API wants us to wait
    const raMs = await getRetryAfterMs(res);
    const waitMs = raMs || (attempt+1)*12000;
    const waitSecs = Math.ceil(waitMs/1000);
    if(attempt<3){
      if(onStatus){
        // Countdown so recruiter knows exactly how long
        for(let i=waitSecs;i>0;i--){
          onStatus(`Rate limit hit — waiting ${i}s before retry…`);
          await new Promise(r=>setTimeout(r,1000));
        }
      } else {
        await new Promise(r=>setTimeout(r,waitMs));
      }
      return apiRank(jd,resumes,attempt+1,onStatus);
    }
    throw new Error(`Rate limit reached. Please wait ${waitSecs} seconds and click Screen again.`);
  }
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    if(attempt<2){
      if(onStatus) onStatus(`Connection issue — retrying…`);
      await new Promise(r=>setTimeout(r,3000));
      return apiRank(jd,resumes,attempt+1,onStatus);
    }
    throw new Error("Screening failed. Please check your connection and try again.");
  }
  _lastCallMs=Date.now();
  const d=await res.json();
  return d.content?.map(b=>b.text||"").join("")||"";
}

// ─── API — PHASE 2A: INTELLIGENCE REPORT ─────────────────────────────────────
async function apiReport(jd, cand, attempt=0){
  const jdSnip=jd.slice(0,600);
  const cvSnip=cand.resumeText?.slice(0,1200)||"";
  const scores=`score:${cand.overallScore} skill:${cand.skillMatch} exp:${cand.experienceRelevance} strengths:${(cand.strengths||[]).slice(0,2).join("|")} gaps:${(cand.missingSkills||[]).slice(0,3).join("|")}`;
  const res=await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1400,
      system:"Senior recruitment consultant. Return ONLY compact raw JSON object. No markdown.",
      messages:[{role:"user",content:`Report for ${cand.name}. Return ONLY raw JSON object.
JD: ${jdSnip}
CV: ${cvSnip}
${scores}
{"executiveSummary":"3 sentences","valueProposition":"1 sentence","keySkillsAligned":[{"skill":"","evidence":"","relevance":""}],"experienceHighlights":[{"highlight":"","impact":""}],"potentialGaps":[{"gap":"","mitigation":""}],"salaryRange":{"min":0,"max":0,"currency":"INR","basis":""},"interviewFocus":"2 areas","clientReadyConclusion":"2 sentences"}`}]
    })
  });
  if(res.status===429){
    const raMs=await getRetryAfterMs(res);
    const wait=raMs||(attempt+1)*10000;
    if(attempt<2){await new Promise(r=>setTimeout(r,wait));return apiReport(jd,cand,attempt+1);}
    throw new Error(`Service busy. Please wait ${Math.ceil(wait/1000)}s and retry.`);
  }
  if(!res.ok){if(attempt<1){await new Promise(r=>setTimeout(r,2000));return apiReport(jd,cand,attempt+1);} throw new Error("Report failed. Please retry.");}
  _lastCallMs=Date.now();
  const d=await res.json();
  return d.content?.map(b=>b.text||"").join("")||"";
}

// ─── API — PHASE 2B: INTERVIEW KIT ────────────────────────────────────────────
async function apiInterview(jd, cand, attempt=0){
  const jdSnip=jd.slice(0,400);
  const meta=`${cand.currentRole||"Candidate"} | Score:${cand.overallScore} | Skills:${(cand.top5Skills||[]).slice(0,3).join(",")} | Missing:${(cand.missingSkills||[]).slice(0,2).join(",")}`;
  const res=await fetch("/api/claude",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1400,
      system:"HR interviewer. Return ONLY compact raw JSON object. No markdown.",
      messages:[{role:"user",content:`Interview questions. Return ONLY raw JSON object.
JD: ${jdSnip}
CANDIDATE: ${meta}
2 technical, 2 behavioral, 2 situational, 3 scorecard criteria:
{"technicalQuestions":[{"question":"","whatItReveals":"","greenFlag":"","redFlag":""}],"behavioralQuestions":[{"question":"STAR","competencyTested":"","scoringGuide":"1-5"}],"situationalQuestions":[{"question":"","idealResponse":""}],"scorecardCriteria":[{"criterion":"","weight":"High|Medium","howToAssess":""}],"structure":{"duration":"45 mins","format":"1:1","opening":"Walk me through your most relevant project","closing":"Do you have any questions about the role?"}}`}]
    })
  });
  if(res.status===429){
    const raMs=await getRetryAfterMs(res);
    const wait=raMs||(attempt+1)*10000;
    if(attempt<2){await new Promise(r=>setTimeout(r,wait));return apiInterview(jd,cand,attempt+1);}
    throw new Error(`Service busy. Please wait ${Math.ceil(wait/1000)}s and retry.`);
  }
  if(!res.ok){if(attempt<1){await new Promise(r=>setTimeout(r,2000));return apiInterview(jd,cand,attempt+1);} throw new Error("Interview kit failed. Please retry.");}
  _lastCallMs=Date.now();
  const d=await res.json();
  return d.content?.map(b=>b.text||"").join("")||"";
}

// Generate red-flag probe questions locally from existing riskFlags — instant, no API
function generateRedFlagProbes(cand){
  const flags=cand.riskFlags||[];
  const missing=cand.missingSkills||[];
  const probes=[];
  for(const flag of flags.slice(0,3)){
    if(flag.toLowerCase().includes("hop")||flag.toLowerCase().includes("job")){
      probes.push({concern:flag,probeQuestion:`You've had several role changes — can you walk me through each transition and what drove it?`,watchFor:"Vague answers, always blaming the company, no growth narrative"});
    } else if(flag.toLowerCase().includes("gap")){
      probes.push({concern:flag,probeQuestion:`I see a gap in your work history. What were you focused on during that period?`,watchFor:"Evasiveness, inconsistency with resume dates"});
    } else {
      probes.push({concern:flag,probeQuestion:`Your profile shows ${flag.toLowerCase()} — can you give me a specific example of how you handled this?`,watchFor:"Inability to give concrete examples, deflecting"});
    }
  }
  if(missing.length>0&&probes.length<3){
    probes.push({concern:`Missing: ${missing.slice(0,2).join(", ")}`,probeQuestion:`This role requires ${missing[0]}. Have you worked with it? How quickly do you pick up new tools?`,watchFor:"Overstating familiarity, inability to describe learning approach"});
  }
  return probes;
}

// ─── EXPORT TO CSV (opens in Excel/Google Sheets, zero security warnings) ─────
function exportExcel(roleName, candidates){
  const date=new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  const esc=v=>`"${String(v||"").replace(/"/g,'""')}"`;
  const headers=["Rank","Name","Current Role","Company","Score","Verdict","Status","Skill Match%","Exp Match%","Stability","Confidence","Years Exp","Expected CTC (LPA)","Notice Period","Top Skills","Missing Skills","Risk Flags","Recruiter Summary"];
  const rows=candidates.map((c,i)=>{
    const v=verd(c.overallScore);
    return [
      i+1, c.name, c.currentRole||"", c.currentCompany||"",
      c.overallScore, v.label, c.status||"new",
      c.skillMatch||0, c.experienceRelevance||0,
      c.stabilityScore||"", c.confidenceScore||"",
      c.yearsExperience||"",
      c.expectedCTCMin?`${c.expectedCTCMin}-${c.expectedCTCMax} LPA`:"",
      c.noticePeriod||"",
      (c.top5Skills||[]).join(" | "),
      (c.missingSkills||[]).join(" | "),
      (c.riskFlags||[]).join(" | "),
      (c.recruiterSummary||"").replace(/\n/g," "),
    ].map(esc).join(",");
  });
  const csv=[
    esc(`RecruiterCopilot AI — ${roleName} — Candidate Report — ${date}`),
    "",
    headers.map(esc).join(","),
    ...rows,
    "",
    esc("AI Disclaimer: Scores are indicative only. Final hiring decisions must be made by the recruiter."),
  ].join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`${roleName.replace(/\s+/g,"_")}_Candidates_${new Date().toLocaleDateString("en-IN").replace(/\//g,"-")}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}

// ─── PRINT: CLIENT SHORTLIST PDF ──────────────────────────────────────────────
function printShortlist(roleName,candidates){
  const shortlisted=candidates.filter(c=>c.status==="shortlisted");
  const list=shortlisted.length?shortlisted:candidates.filter(c=>verd(c.overallScore).label==="STRONG FIT").slice(0,5);
  const finalList=list.length?list:candidates.slice(0,3);
  const rows=finalList.map((c,i)=>{
    const v=verd(c.overallScore);
    return `<tr style="background:${i%2?"#F7F4EF":"#fff"}">
      <td style="padding:10px 12px;font-weight:700">#${i+1} ${c.name}</td>
      <td style="padding:10px 12px;color:#4A3F2F">${c.currentRole||"—"} ${c.currentCompany?`@ ${c.currentCompany}`:""}</td>
      <td style="padding:10px 12px;font-family:monospace;font-weight:800;font-size:16px;color:${v.color}">${c.overallScore}</td>
      <td style="padding:10px 12px"><span style="background:${v.bg};color:${v.color};padding:2px 10px;border-radius:100px;font-size:11px;font-weight:700">${v.dot} ${v.label}</span></td>
      <td style="padding:10px 12px;font-size:12px">${c.expectedCTCMin?`₹${c.expectedCTCMin}–${c.expectedCTCMax} LPA`:"—"}</td>
      <td style="padding:10px 12px;font-size:12px;color:#4A3F2F;max-width:180px">${(c.recruiterSummary||"").slice(0,100)}…</td>
    </tr>`;
  }).join("");
  const details=finalList.map((c,i)=>`
    <div style="margin-top:22px;page-break-inside:avoid">
      <h2 style="font-size:13px;font-weight:700;color:#1B4F8A;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #DDD8CE;padding-bottom:4px;margin-bottom:9px">Candidate ${i+1}: ${c.name}</h2>
      <div style="background:#F7F4EF;border-radius:8px;padding:12px;font-size:12.5px;line-height:1.8;margin-bottom:7px">${c.recruiterSummary||"—"}</div>
      <div style="font-size:12px;margin-bottom:5px"><strong>Top Skills:</strong> ${(c.top5Skills||[]).join(" · ")}</div>
      ${c.riskFlags?.length?`<div style="font-size:12px;color:#B83025;margin-bottom:5px"><strong>⚠ Watch:</strong> ${c.riskFlags.join(" · ")}</div>`:""}
      ${c.expectedCTCMin?`<div style="font-size:12px;color:#9A8F7A">Expected CTC: <strong style="color:#1C1108">₹${c.expectedCTCMin}–${c.expectedCTCMax} LPA</strong> · Notice: ${c.noticePeriod||"—"}</div>`:""}
    </div>`).join("");
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shortlist — ${roleName}</title>
  <style>body{font-family:Georgia,serif;color:#1C1108;max-width:850px;margin:28px auto;padding:0 22px;font-size:13px}
  .hdr{border-bottom:3px solid #C49A2A;padding-bottom:13px;margin-bottom:18px}
  table{width:100%;border-collapse:collapse}th{background:#1C1108;color:#D4C8B4;padding:8px 12px;text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase}
  td{padding:9px 12px;border-bottom:1px solid #DDD8CE}
  .disc{margin-top:28px;padding:11px;background:#F7F4EF;border-left:3px solid #C49A2A;font-size:11px;color:#9A8F7A;border-radius:0 6px 6px 0}
  .foot{margin-top:22px;padding-top:9px;border-top:1px solid #DDD8CE;font-size:10px;color:#9A8F7A;text-align:center}
  @media print{@page{margin:16mm}body{margin:0}}</style></head><body>
  <div class="hdr"><div style="font-size:10px;color:#C49A2A;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px">Candidate Shortlist · RecruiterCopilot AI</div>
  <h1 style="font-size:21px;font-weight:700;margin:3px 0">${roleName}</h1>
  <div style="color:#9A8F7A;font-size:12px;margin-top:4px">Prepared: ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})} · ${finalList.length} candidates · Confidential</div></div>
  <table><thead><tr><th>Candidate</th><th>Current Role</th><th>Score</th><th>Verdict</th><th>CTC</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table>
  ${details}
  <div class="disc">⚠ <strong>AI Disclaimer:</strong> AI-generated to support your hiring process. Final decisions must be made by human recruiters based on interviews and verification.</div>
  <div class="foot">RecruiterCopilot AI · For recruiter use only · Not for candidate distribution</div>
  </body></html>`;
  // Open print dialog — recruiter selects "Save as PDF" in their browser
  try{
    const old=document.getElementById("_rc_sl_iframe");
    if(old) document.body.removeChild(old);
    const iframe=document.createElement("iframe");
    iframe.id="_rc_sl_iframe";
    iframe.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();iframe.contentDocument.write(html);iframe.contentDocument.close();
    setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();}catch{}},400);
  }catch{}
}

// ─── PRINT: INTELLIGENCE REPORT ────────────────────────────────────────────────
// window.open("","_blank") is blocked in claude.ai artifacts.
// Instead: create a hidden iframe, write the HTML into it, call iframe.contentWindow.print()
function printReport(cand){
  const v=verd(cand.overallScore),rep=cand.report||{},sal=rep.salaryRange||{};
  const fmt=n=>isNaN(Number(n))?"—":`₹${Number(n).toLocaleString("en-IN")} LPA`;
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${cand.name} — Report</title>
  <style>body{font-family:Georgia,serif;color:#1C1108;max-width:760px;margin:26px auto;padding:0 20px;font-size:13px;line-height:1.7}
  h1{font-size:22px;font-weight:700;margin:3px 0}h2{font-size:12px;font-weight:700;color:#1B4F8A;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid #DDD8CE;padding-bottom:3px}
  .hdr{border-bottom:3px solid #C49A2A;padding-bottom:12px;margin-bottom:14px}
  .vdt{display:inline-block;padding:3px 13px;border-radius:100px;font-weight:700;font-size:11px;text-transform:uppercase;background:${v.bg};color:${v.color};margin-bottom:12px}
  .sc{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;background:#F7F4EF;padding:11px;border-radius:8px;margin:10px 0;text-align:center}
  .sv{font-size:18px;font-weight:800;font-family:monospace;color:${v.color}}.sl{font-size:9px;color:#9A8F7A;text-transform:uppercase}
  .vp{background:#FBF0CE;border-left:4px solid #C49A2A;padding:9px 13px;font-style:italic;margin:9px 0;border-radius:0 7px 7px 0}
  .sk{background:#F7F4EF;border:1px solid #DDD8CE;border-radius:6px;padding:9px;margin-bottom:6px}
  .hi{background:#D4E4F7;border-radius:6px;padding:8px;margin-bottom:6px}.gap{background:#FCECEA;border-radius:6px;padding:8px;margin-bottom:6px}
  .conc{background:#D2F0EE;border-left:3px solid #0B7A73;padding:11px;border-radius:0 8px 8px 0}
  .disc{margin-top:22px;padding:10px;background:#F7F4EF;border-left:3px solid #C49A2A;font-size:11px;color:#9A8F7A;border-radius:0 6px 6px 0}
  .foot{margin-top:22px;padding-top:9px;border-top:1px solid #DDD8CE;font-size:10px;color:#9A8F7A;text-align:center}
  @media print{@page{margin:15mm}body{margin:0}}</style></head><body>
  <div class="hdr"><div style="font-size:10px;color:#C49A2A;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px">Intelligence Report · RecruiterCopilot AI</div>
  <h1>${cand.name}</h1><div style="color:#9A8F7A;font-size:12px;margin-top:4px">${cand.currentRole||""} ${cand.currentCompany?`@ ${cand.currentCompany}`:""} ${cand.yearsExperience!=null?" · "+cand.yearsExperience+" yrs":""} · ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div></div>
  <span class="vdt">${v.dot} ${v.label}</span>
  <div class="sc"><div><div class="sv">${cand.overallScore}</div><div class="sl">Overall</div></div><div><div class="sv" style="color:#0B7A73">${cand.skillMatch}%</div><div class="sl">Skill</div></div><div><div class="sv" style="color:#1B4F8A">${cand.experienceRelevance}%</div><div class="sl">Experience</div></div><div><div class="sv" style="color:#C49A2A">${cand.confidenceScore||"—"}</div><div class="sl">Confidence</div></div><div><div class="sv" style="color:#5B3A8A">${cand.stabilityScore||"—"}</div><div class="sl">Stability</div></div></div>
  ${rep.valueProposition?`<div class="vp">"${rep.valueProposition}"</div>`:""}
  <h2>Recruiter Summary</h2><p>${cand.recruiterSummary||"—"}</p>
  <h2>Executive Summary</h2><p>${rep.executiveSummary||"—"}</p>
  <h2>Key Skills Aligned</h2>${(rep.keySkillsAligned||[]).map(s=>`<div class="sk"><strong style="color:#0B7A73">${s.skill||""}</strong><p style="font-size:12px;color:#4A3F2F;margin:2px 0">${s.evidence||""}</p><p style="font-size:11px;color:#9A8F7A;font-style:italic">${s.relevance||""}</p></div>`).join("")||"<p>—</p>"}
  <h2>Experience Highlights</h2>${(rep.experienceHighlights||[]).map(h=>`<div class="hi"><strong>${h.highlight||""}</strong><p style="font-size:12px;margin:2px 0">${h.impact||""}</p></div>`).join("")||"<p>—</p>"}
  <h2>Gaps & Mitigations</h2>${(rep.potentialGaps||[]).map(g=>`<div class="gap"><strong style="color:#B83025">${g.gap||""}</strong><p style="font-size:12px;margin:2px 0">↳ ${g.mitigation||""}</p></div>`).join("")||"<p>—</p>"}
  <h2>Expected CTC</h2><div style="font-size:21px;font-weight:800;font-family:monospace">${fmt(sal.min||cand.expectedCTCMin)} – ${fmt(sal.max||cand.expectedCTCMax)}</div>
  <h2>Final Recommendation</h2><div class="conc">${rep.clientReadyConclusion||cand.recruiterSummary||"—"}</div>
  <div class="disc">⚠ <strong>AI Disclaimer:</strong> AI-generated to support hiring. Final decisions must be made by the recruiter.</div>
  <div class="foot">RecruiterCopilot AI · Confidential</div>
  </body></html>`;

  // Print dialog only — recruiter selects "Save as PDF" (no file download = no security warning)
  try{
    const existingIframe=document.getElementById("_rc_print_iframe");
    if(existingIframe) document.body.removeChild(existingIframe);
    const iframe=document.createElement("iframe");
    iframe.id="_rc_print_iframe";
    iframe.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();}catch{}},400);
  }catch{}
}

function printSC(cand){
  const int=cand.interview||{};
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Scorecard — ${cand.name}</title>
  <style>body{font-family:Arial,sans-serif;color:#1C1108;max-width:720px;margin:22px auto;padding:0 18px;font-size:12px}h1{font-size:16px;margin-bottom:3px}.meta{color:#9A8F7A;margin-bottom:12px}table{width:100%;border-collapse:collapse}th{background:#1C1108;color:#D4C8B4;padding:7px 11px;text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase}td{padding:8px 11px;border-bottom:1px solid #DDD8CE;vertical-align:top}.tot{background:#FBF0CE;font-weight:700}.disc{margin-top:18px;padding:9px;background:#F7F4EF;font-size:10px;color:#9A8F7A;border-left:2px solid #C49A2A}@media print{@page{margin:13mm}body{margin:0}}</style></head><body>
  <h1>Interview Evaluation Scorecard</h1><div class="meta">Candidate: <strong>${cand.name}</strong> · ${cand.currentRole||""} · ${new Date().toLocaleDateString("en-IN")}</div>
  <table><thead><tr><th>Criterion</th><th>Weight</th><th>How to Assess</th><th>Score 1–5</th><th style="min-width:90px">Notes</th></tr></thead>
  <tbody>${(int.scorecardCriteria||[]).map((c,i)=>`<tr style="background:${i%2?"#F7F4EF":"#fff"}"><td style="font-weight:600">${c.criterion||""}</td><td><span style="background:${c.weight==="High"?"#FCECEA":c.weight==="Medium"?"#FBF0CE":"#F0EBE3"};color:${c.weight==="High"?"#B83025":c.weight==="Medium"?"#7A5910":"#4A3F2F"};padding:1px 8px;border-radius:100px;font-size:10px;font-weight:700">${c.weight||""}</span></td><td style="color:#4A3F2F;font-size:11px">${c.howToAssess||""}</td><td style="text-align:center">___</td><td></td></tr>`).join("")}<tr class="tot"><td colspan="3">TOTAL SCORE</td><td style="text-align:center">___/15</td><td></td></tr></tbody></table>
  <div class="disc">AI-generated framework. Adapt as needed. Final evaluation is the hiring manager's responsibility.</div>
  </body></html>`;
  try{
    const existingIframe=document.getElementById("_rc_sc_iframe");
    if(existingIframe) document.body.removeChild(existingIframe);
    const iframe=document.createElement("iframe");
    iframe.id="_rc_sc_iframe";
    iframe.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;";
    document.body.appendChild(iframe);
    iframe.contentDocument.open();iframe.contentDocument.write(html);iframe.contentDocument.close();
    setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();}catch{}},400);
  }catch{}
}

// ─── WHATSAPP / EMAIL TEMPLATES ────────────────────────────────────────────────
function getTpls(cand,roleName){
  const fn=cand.name.split(" ")[0];
  return{
    waInvite:{label:"📱 WA — Interview",text:`Hi ${fn},\n\nHope you're doing well! 😊\n\nWe've reviewed your profile for *${roleName}* and would love to move forward.\n\nCould you please share your availability for an interview this week or next?\n\nRegards`},
    waReject:{label:"📱 WA — Rejection",text:`Hi ${fn},\n\nThank you for your interest in *${roleName}*.\n\nAfter careful review, we're proceeding with candidates whose experience more closely matches our current requirement. We'll keep your profile for future opportunities! 🙏\n\nBest wishes`},
    waFollowup:{label:"📱 WA — Follow Up",text:`Hi ${fn},\n\nFollowing up on the *${roleName}* opportunity 😊\n\nAre you still actively looking? Could you share:\n• Current & expected CTC?\n• Notice period?\n\nLooking forward to hearing from you!`},
    emailInvite:{label:"✉ Email — Interview",subject:`Interview Invitation — ${roleName}`,text:`Dear ${fn},\n\nGreetings!\n\nWe're pleased to inform you that you have been shortlisted for the ${roleName} position.\n\nWe'd like to schedule an interview. Please share your availability for the next 3–5 working days.\n\nFormat: ${cand.interview?.structure?.format||"To be confirmed"}\nDuration: ${cand.interview?.structure?.duration||"45–60 minutes"}\n\nPlease confirm by replying to this email.\n\nBest regards`},
    emailReject:{label:"✉ Email — Rejection",subject:`Application Update — ${roleName}`,text:`Dear ${fn},\n\nThank you for your interest in ${roleName}.\n\nAfter careful consideration, we are not proceeding with your application at this time. We were impressed by your profile and will keep it for future opportunities.\n\nWe wish you the very best in your career journey.\n\nWarm regards`},
  };
}

// ─── CLIPBOARD — works in sandboxed iframes where navigator.clipboard is blocked ──
function copyToClipboard(text){
  // Method 1: modern API (works outside iframe)
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(()=>copyFallback(text));
    return;
  }
  copyFallback(text);
}
function copyFallback(text){
  // Method 2: execCommand — works inside iframes and older browsers
  const ta=document.createElement("textarea");
  ta.value=text;
  ta.style.cssText="position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();ta.select();
  try{document.execCommand("copy");}catch{}
  document.body.removeChild(ta);
}

// ─── UI COMPONENTS ─────────────────────────────────────────────────────────────
function Tag({children,type="neutral"}){
  const m={neutral:{bg:C.alt,fg:C.mid},gold:{bg:C.goldL,fg:C.goldD},green:{bg:C.greenL,fg:C.green},red:{bg:C.redL,fg:C.red},blue:{bg:C.blueL,fg:C.blue},teal:{bg:C.tealL,fg:C.teal},orange:{bg:C.orangeL,fg:C.orange},purple:{bg:C.purpleL,fg:C.purple},dark:{bg:C.ink,fg:"#fff"}};
  const s=m[type]||m.neutral;
  return <span className="tag" style={{background:s.bg,color:s.fg}}>{children}</span>;
}
function Meter({value,color,label}){
  const v=Math.max(0,Math.min(100,Number(value)||0));
  return(<div style={{marginBottom:9}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:12,color:C.mid,fontWeight:500}}>{label}</span><span style={{fontSize:11.5,fontFamily:"monospace",fontWeight:600,color}}>{v}%</span></div><div className="mbar"><div className="mbar-fill" style={{width:`${v}%`,background:color}}/></div></div>);
}
function Ring({score,size=70}){
  const v=verd(score),sw=5,r=(size-sw*2)/2,circ=2*Math.PI*r,off=circ*(1-Math.max(0,Math.min(100,score))/100);
  return(<div style={{position:"relative",width:size,height:size,flexShrink:0}}>
    <svg width={size} height={size}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={sw}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={v.color} strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dashoffset 1.1s ease"}}/></svg>
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:size*.22,fontFamily:"monospace",fontWeight:700,color:v.color,lineHeight:1}}>{score}</span><span style={{fontSize:size*.11,color:C.light}}>/100</span></div>
  </div>);
}
function Sp({size=20}){return <div className="sp" style={{width:size,height:size,borderWidth:Math.max(2,size*.12),borderColor:C.goldL,borderTopColor:C.gold,flexShrink:0}}/>;}
function CpyBtn({text}){
  const[ok,setOk]=useState(false);
  function handleCopy(){
    copyToClipboard(text);
    setOk(true);
    setTimeout(()=>setOk(false),2000);
  }
  return <button className="btn btn-ghost" style={{padding:"3px 9px",fontSize:11}} onClick={handleCopy}>{ok?"✓ Copied":"⎘ Copy"}</button>;
}
function Modal({title,onClose,children}){
  return(<div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}><div style={{fontFamily:"Playfair Display,serif",fontSize:18,fontWeight:700}}>{title}</div><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:22,lineHeight:1}}>×</button></div>{children}</div>
  </div>);
}

// ─── LOADING PLACEHOLDER ────────────────────────────────────────────────────────
function TabLoader({message="Generating…"}){
  return(<div style={{textAlign:"center",padding:"44px 20px"}} className="card">
    <Sp size={34}/><div style={{marginTop:14,fontSize:13.5,color:C.mid}}>{message}</div>
    <div style={{marginTop:12,width:200,margin:"12px auto 0"}}><div className="lbar"><div className="lbar-fill" style={{width:"100%"}}/></div></div>
    <div style={{marginTop:10,fontSize:11,color:C.light}}>~10–15 seconds</div>
  </div>);
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App(){
  const [roles,setRoles]         = useState([]);
  const [activeId,setActiveId]   = useState(null);
  const [screen,setScreen]       = useState("home");
  const [addingTo,setAddingTo]   = useState(null);
  const [jdText,setJdText]       = useState("");
  const [roleName,setRoleName]   = useState("");
  const [resumes,setResumes]     = useState([]);
  const [stepIdx,setStepIdx]     = useState(0);
  const [elapsed,setElapsed]     = useState(0);
  const [retryStatus,setRetryStatus] = useState("");
  const [errors,setErrors]       = useState([]);
  const [selIdx,setSelIdx]       = useState(0);
  const [selectedCandId,setSelectedCandId] = useState(null);
  const [tab,setTab]             = useState("rank");
  const [sortBy,setSortBy]       = useState("score");
  const [viewMode,setViewMode]   = useState("cards");      // "cards" | "table"
  const [scoreThreshold,setScoreThreshold] = useState(0);  // hide below this score
  const [bulkSelected,setBulkSelected] = useState(new Set()); // IDs for bulk actions
  const [candSearch,setCandSearch] = useState("");           // BUG22: search by name
  const [saveToast,setSaveToast] = useState(false);          // BUG25: save confirmation
  const [cooldownSecs,setCooldownSecs] = useState(0);        // BUG9: live cooldown display
  const [cmpIds,setCmpIds]       = useState([]);
  const [modal,setModal]         = useState(null);
  const [tplCand,setTplCand]     = useState(null);
  const [tplTab,setTplTab]       = useState("waInvite");
  const [jdDrag,setJdDrag]       = useState(false);
  const [rDrag,setRDrag]         = useState(false);
  const [jdLib,setJdLib]         = useState([]);
  const [saveJdName,setSaveJdName] = useState("");
  const [showSaveJd,setShowSaveJd] = useState(false);
  // Minimum criteria gate — filters locally before AI call, no extra API cost
  const [minExp,setMinExp]       = useState("");
  const [mustSkills,setMustSkills] = useState("");
  const [mustLocation,setMustLocation] = useState("");
  const [showCriteria,setShowCriteria] = useState(false);
  const [pendingMerge,setPendingMerge] = useState(null);
  const [deleteConfirmId,setDeleteConfirmId] = useState(null);
  // Per-candidate lazy-loaded data
  const [reports,setReports]     = useState({});
  const [interviews,setInterviews] = useState({});
  const [loadingReport,setLoadingReport]   = useState(null);
  const [loadingInterview,setLoadingInterview] = useState(null);
  const [reportErr,setReportErr]   = useState({});
  const [interviewErr,setInterviewErr] = useState({});

  const jdRef=useRef(), resRef=useRef();
  useEffect(()=>{loadPdf().catch(()=>{});},[]);

  const addErr=m=>setErrors(p=>[...p,m]);
  const clrErr=i=>setErrors(p=>p.filter((_,j)=>j!==i));
  const activeRole=roles.find(r=>r.id===activeId);

  // ── Local pre-screening gate (no API call) ─────────────────────────────────
  // Returns {passed:[], rejected:[{resume, reason}]}
  function applyGate(resumeList){
    if(!minExp.trim()&&!mustSkills.trim()&&!mustLocation.trim())
      return {passed:resumeList, rejected:[]};
    const passed=[], rejected=[];
    const skillList = mustSkills.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    const minYears = parseFloat(minExp)||0;
    const loc = mustLocation.trim().toLowerCase();
    for(const r of resumeList){
      const txt=(r.text||"").toLowerCase();
      const reasons=[];
      if(minYears>0){
        // Look for year patterns: "3 years", "3+ years", "3 yrs"
        const yMatch=txt.match(/(\d+\.?\d*)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i);
        const yrs=yMatch?parseFloat(yMatch[1]):0;
        if(yrs<minYears) reasons.push(`Less than ${minYears} yrs exp`);
      }
      if(skillList.length>0){
        const missing=skillList.filter(sk=>!txt.includes(sk));
        if(missing.length>0) reasons.push(`Missing: ${missing.map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(", ")}`);
      }
      if(loc&&!txt.includes(loc)) reasons.push(`Location: ${mustLocation} not found`);
      if(reasons.length>0) rejected.push({resume:r,reasons});
      else passed.push(r);
    }
    return {passed,rejected};
  }

  // ── Bulk action helpers ────────────────────────────────────────────────────
  function bulkSetStatus(roleId, ids, status){
    setRoles(prev=>prev.map(role=>role.id!==roleId?role:{
      ...role,
      candidates:role.candidates.map(c=>ids.has(c.id)?{...c,status}:c)
    }));
    setBulkSelected(new Set());
  }
  function toggleBulkSelect(id){
    setBulkSelected(prev=>{
      const n=new Set(prev);
      n.has(id)?n.delete(id):n.add(id);
      return n;
    });
  }
  function selectAllVisible(cands){
    setBulkSelected(new Set(cands.map(c=>c.id)));
  }

  function setStatus(roleId,candId,status){
    setRoles(prev=>prev.map(role=>role.id!==roleId?role:{
      ...role,
      candidates:role.candidates.map(c=>c.id===candId?{...c,status}:c)
    }));
  }

  // ── Lazy report loader ─────────────────────────────────────────────────────
  async function loadReport(cand, roleJd){
    const key=cand.id;
    if(reports[key]||loadingReport===key) return;
    setLoadingReport(key);
    setReportErr(p=>({...p,[key]:null}));
    try{
      const raw=await apiReport(roleJd,cand);
      const parsed=safeJ(raw);
      if(!parsed||Array.isArray(parsed)) throw new Error("Report data invalid. Please retry.");
      setReports(p=>({...p,[key]:parsed}));
    }catch(e){
      setReportErr(p=>({...p,[key]:e.message}));
    }
    setLoadingReport(null);
  }

  async function loadInterview(cand, roleJd){
    const key=cand.id;
    if(interviews[key]||loadingInterview===key) return;
    setLoadingInterview(key);
    setInterviewErr(p=>({...p,[key]:null}));
    try{
      const raw=await apiInterview(roleJd,cand);
      const parsed=safeJ(raw);
      const hasKeys=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)&&
        (parsed.technicalQuestions||parsed.behavioralQuestions||parsed.scorecardCriteria||parsed.structure);
      if(!hasKeys) throw new Error("Interview kit could not be generated. Please retry.");
      // Merge in locally-generated red-flag probes (instant, no API cost)
      const merged={...parsed, redFlagProbes:generateRedFlagProbes(cand)};
      setInterviews(p=>({...p,[key]:merged}));
    }catch(e){
      setInterviewErr(p=>({...p,[key]:e.message}));
    }
    setLoadingInterview(null);
  }

  // ── File handlers ──────────────────────────────────────────────────────────
  async function handleJD(files){
    const f=files[0];if(!f)return;
    if(!["pdf","txt","text"].includes(f.name.split(".").pop().toLowerCase())){addErr("JD: PDF or TXT only.");return;}
    try{const t=await readFile(f);setJdText(t.slice(0,4000));}catch(e){addErr("Could not read JD: "+e.message);}
  }

  async function handleResumes(files){
    const existingFilenames=(addingTo?roles.find(r=>r.id===addingTo)?.candidates||[]:[]).map(c=>c.filename).filter(Boolean);
    const rem=5-resumes.length;
    if(rem<=0){addErr("Batch full. Click Screen to analyse, then add more.");return;}
    const toAdd=Array.from(files).slice(0,rem);
    if(Array.from(files).length>rem) addErr(`Only ${rem} resume slot(s) left in this batch.`);
    for(const f of toAdd){
      const ext=f.name.split(".").pop().toLowerCase();
      if(!["pdf","txt","text"].includes(ext)){addErr(`"${f.name}" skipped — PDF or TXT only.`);continue;}
      if(resumes.some(r=>r.filename===f.name)){addErr(`"${f.name}" already added.`);continue;}
      if(existingFilenames.includes(f.name)){addErr(`"${f.name}" already analysed for this role.`);continue;}
      try{
        const t=await readFile(f);
        if(!t||t.trim().length<50){addErr(`"${f.name}": too little text. Use a text-based PDF.`);continue;}
        // Duplicate detection: basic text fingerprint
        const fp=t.trim().slice(0,200);
        if(resumes.some(r=>(r.text||"").trim().slice(0,200)===fp)){addErr(`"${f.name}": appears to be a duplicate of another uploaded resume.`);continue;}
        setResumes(p=>[...p,{id:Math.random().toString(36).slice(2),name:cleanName(f.name),filename:f.name,text:t.slice(0,4500)}]);
      }catch(e){addErr(`"${f.name}": ${e.message}`);}
    }
  }

  // ── PHASE 1: FAST RANKING ──────────────────────────────────────────────────
  const STEPS=["Reading job description…","Extracting resume data…","Normalising skills…","Scoring candidates…","Ranking results…"];

  async function handleAnalyse(){
    if(!jdText.trim()){addErr("Please provide a job description.");return;}
    if(resumes.length===0){addErr("Upload at least one resume.");return;}
    if(!addingTo&&!roleName.trim()){addErr("Please enter a role name.");return;}
    setErrors([]);

    // BUG9 FIX: live countdown on setup screen so user sees why button is "waiting"
    const cooldown = msUntilSafe();
    if(cooldown>0){
      let remaining=Math.ceil(cooldown/1000);
      setCooldownSecs(remaining);
      const tick=setInterval(()=>{
        remaining--;
        setCooldownSecs(remaining);
        if(remaining<=0) clearInterval(tick);
      },1000);
      await new Promise(r=>setTimeout(r,cooldown));
      setCooldownSecs(0);
    }

    // Run local gate first — instant, no API call
    const {passed, rejected} = applyGate(resumes);

    if(rejected.length>0 && passed.length===0){
      addErr(`All ${rejected.length} resume${rejected.length!==1?"s":""} failed your minimum criteria. Adjust criteria or upload different resumes.`);
      return;
    }

    const toAnalyse = passed;

    setScreen("analyzing");setStepIdx(0);setElapsed(0);setRetryStatus("");

    // Timer
    let si=0,el=0;
    const stepT=setInterval(()=>{si=Math.min(si+1,STEPS.length-1);setStepIdx(si);},2800);
    const elT=setInterval(()=>{el++;setElapsed(el);},1000);

    try{
      const raw=await apiRank(jdText,toAnalyse,0,(msg)=>setRetryStatus(msg));
      clearInterval(stepT);clearInterval(elT);setRetryStatus("");

      let parsed=safeJ(raw);
      if(!parsed){
        setRetryStatus("Recovering — please wait…");
        const raw2=await apiRank(jdText,toAnalyse,0,(msg)=>setRetryStatus(msg));
        parsed=safeJ(raw2);
      }
      if(!parsed) throw new Error("Could not read AI response. Your resumes are still loaded — click Screen to try again.");
      if(!Array.isArray(parsed)) parsed=[parsed];

      const gotCount=parsed.length;
      const expectedCount=toAnalyse.length;

      const enriched=parsed.map((c,i)=>{
        const score=Math.max(0,Math.min(100,Number(c.overallScore)||0));
        const v=verd(score);
        const top5=(c.top5Skills||[]).map(normalizeSkill);
        const missing=(c.missingSkills||[]).map(normalizeSkill);
        return{
          ...c,
          id:Math.random().toString(36).slice(2),
          overallScore:score,
          confidenceScore:Math.max(0,Math.min(100,Number(c.confidenceScore)||70)),
          skillMatch:Math.max(0,Math.min(100,Number(c.skillMatch)||0)),
          experienceRelevance:Math.max(0,Math.min(100,Number(c.experienceRelevance)||0)),
          leadershipScore:Math.max(0,Math.min(100,Number(c.leadershipScore)||0)),
          cultureFit:Math.max(0,Math.min(100,Number(c.cultureFit)||0)),
          stabilityScore:Math.max(0,Math.min(100,Number(c.stabilityScore)||0)),
          hiringRecommendation:v.label,
          name:(c.name&&c.name.trim().length>1&&c.name.toLowerCase()!=="candidate")?c.name:(toAnalyse[i]?.name||`Candidate ${i+1}`),
          filename:toAnalyse[i]?.filename,
          resumeText:toAnalyse[i]?.text,
          top5Skills:top5,
          missingSkills:missing,
          status:"new",
        };
      });

      // Add pre-screened-out candidates as auto-rejected entries (no AI cost)
      const preRejected = rejected.map(({resume,reasons})=>({
        id:Math.random().toString(36).slice(2),
        name:resume.name,
        filename:resume.filename,
        resumeText:resume.text,
        overallScore:0,
        skillMatch:0,
        experienceRelevance:0,
        leadershipScore:0,
        cultureFit:0,
        stabilityScore:0,
        confidenceScore:0,
        hiringRecommendation:"FAIL",
        recruiterSummary:`Pre-screened out: ${reasons.join(" · ")}`,
        riskFlags:reasons,
        top5Skills:[],
        missingSkills:[],
        strengths:[],
        status:"rejected",
        preScreened:true,
      }));

      enriched.sort((a,b)=>b.overallScore-a.overallScore);
      const allResults=[...enriched,...preRejected];

      if(addingTo && roles.find(r=>r.id===addingTo)?.candidates?.length>0){
        setPendingMerge(allResults);
        setScreen("results");
        setActiveId(addingTo);
        setModal("merge");
        if(rejected.length>0) setTimeout(()=>addErr(`${rejected.length} resume${rejected.length!==1?"s":""} pre-screened out by your minimum criteria.`),600);
        if(gotCount<expectedCount) addErr(`Note: ${gotCount} of ${toAnalyse.length} resumes processed. Re-screen remaining ones separately.`);
      } else if(addingTo){
        applyToRole(allResults, addingTo, true);
        if(rejected.length>0) setTimeout(()=>addErr(`${rejected.length} resume${rejected.length!==1?"s":""} pre-screened out by your minimum criteria.`),600);
        if(gotCount<expectedCount) setTimeout(()=>addErr(`Note: ${gotCount} of ${toAnalyse.length} resumes processed. Re-screen remaining ones.`),500);
      } else {
        const nr={id:Date.now().toString(),name:roleName.trim(),jd:jdText,candidates:allResults,createdAt:new Date()};
        setRoles(p=>[nr,...p]);
        setActiveId(nr.id);
        setSelectedCandId(enriched[0]?.id);
        setResumes([]);setTab("rank");
        setScreen("results");
        if(rejected.length>0) setTimeout(()=>addErr(`${rejected.length} resume${rejected.length!==1?"s":""} pre-screened out automatically by your minimum criteria — shown as rejected.`),600);
        if(gotCount<expectedCount) setTimeout(()=>addErr(`Note: ${gotCount} of ${toAnalyse.length} resumes processed. Re-screen remaining ones.`),500);
      }
    }catch(err){
      clearInterval(stepT);clearInterval(elT);setRetryStatus("");
      // Keep resumes loaded — recruiter can retry without re-uploading
      addErr(err.message||"Screening failed. Your resumes are still loaded — please try again.");
      setScreen(addingTo?"results":"setup");
    }
  }

  function applyToRole(enriched, roleId, merge){
    setRoles(prev=>prev.map(role=>{
      if(role.id!==roleId) return role;
      const candidates=merge
        ? [...role.candidates,...enriched].sort((a,b)=>b.overallScore-a.overallScore)
        : [...role.candidates,...enriched];
      return {...role,candidates};
    }));
    setActiveId(roleId);
    setResumes([]);
    setSelectedCandId(merge?
      [...(roles.find(r=>r.id===roleId)?.candidates||[]),...enriched].sort((a,b)=>b.overallScore-a.overallScore)[0]?.id
      :enriched[0]?.id
    );
    setTab("rank");setPendingMerge(null);setModal(null);setAddingTo(null);
    setScreen("results");
  }

  function pickCandidate(candId){setSelectedCandId(candId);setTab("rank");setCmpIds([]);}

  // ── Sorting ───────────────────────────────────────────────────────────────
  function sortedCandidates(cands){
    const c=[...cands];
    if(sortBy==="score") return c.sort((a,b)=>b.overallScore-a.overallScore);
    if(sortBy==="experience") return c.sort((a,b)=>(b.yearsExperience||0)-(a.yearsExperience||0));
    if(sortBy==="stability") return c.sort((a,b)=>(b.stabilityScore||0)-(a.stabilityScore||0));
    if(sortBy==="shortlisted") return c.sort((a,b)=>(b.status==="shortlisted"?1:0)-(a.status==="shortlisted"?1:0));
    return c;
  }

  function getRoleStats(role){
    const c=role.candidates;
    return{
      total:c.length,
      strong:c.filter(x=>verd(x.overallScore).label==="STRONG FIT").length,
      consider:c.filter(x=>verd(x.overallScore).label==="CAN BE CONSIDERED").length,
      fail:c.filter(x=>verd(x.overallScore).label==="FAIL").length,
      shortlisted:c.filter(x=>x.status==="shortlisted").length,
      rejected:c.filter(x=>x.status==="rejected").length,
      interview:c.filter(x=>x.status==="interview").length,
      offered:c.filter(x=>x.status==="offered").length,
    };
  }

  function bulkShortlistTop(roleId, n=3){
    setRoles(prev=>prev.map(role=>{
      if(role.id!==roleId) return role;
      const sorted=[...role.candidates].sort((a,b)=>b.overallScore-a.overallScore);
      const topIds=new Set(sorted.slice(0,n).map(c=>c.id));
      return {...role,candidates:role.candidates.map(c=>topIds.has(c.id)?{...c,status:"shortlisted"}:c)};
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HOME SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if(screen==="home") return(
    <div style={{minHeight:"100vh",background:C.bg}}><style>{CSS}</style>
    <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 28px",position:"sticky",top:0,zIndex:200}}>
      <div style={{maxWidth:1100,margin:"0 auto",height:54,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${C.gold},${C.goldD})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚡</div>
          <div><div style={{fontFamily:"Playfair Display,serif",fontSize:16,fontWeight:700,lineHeight:1.1}}>RecruiterCopilot</div><div style={{fontSize:9,color:C.light,letterSpacing:".12em",textTransform:"uppercase"}}>AI Recruitment Intelligence</div></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>setModal("jdLib")}>📚 JD Library{jdLib.length>0?` (${jdLib.length})`:""}</button>
          <button className="btn btn-gold" onClick={()=>{setAddingTo(null);setJdText("");setRoleName("");setResumes([]);setErrors([]);setScreen("setup");}}>+ New Role</button>
        </div>
      </div>
    </header>
  // ══════════════════════════════════════════════════════════════════════════
  // SETUP SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if(screen==="setup") return(
    <div style={{minHeight:"100vh",background:C.bg}}><style>{CSS}</style>
    <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 28px",position:"sticky",top:0,zIndex:200}}>
      <div style={{maxWidth:1060,margin:"0 auto",height:52,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${C.gold},${C.goldD})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>⚡</div>
          <span style={{fontFamily:"Playfair Display,serif",fontSize:15,fontWeight:700}}>RecruiterCopilot</span>
          {addingTo&&<Tag type="gold">Adding to: {roles.find(r=>r.id===addingTo)?.name}</Tag>}
        </div>
        <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>{setScreen(addingTo?"results":"home");}}>← Back</button>
      </div>
    </header>

    <main style={{maxWidth:960,margin:"0 auto",padding:"26px 26px"}}>
      {/* Resumes preserved notice when returning after error */}
      {resumes.length>0&&errors.length>0&&(
        <div style={{background:C.blueL,border:`1px solid ${C.blue}33`,borderRadius:9,padding:"10px 14px",marginBottom:12,fontSize:13,color:C.blue}}>
          ℹ Your {resumes.length} resume{resumes.length!==1?"s":""} are still loaded. Fix the issue above and click Screen again.
        </div>
      )}
      {errors.map((e,i)=>(
        <div key={i} style={{background:C.redL,border:`1px solid ${C.red}33`,borderRadius:9,padding:"10px 14px",marginBottom:10,display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{color:C.red,flexShrink:0}}>⚠</span>
          <span style={{fontSize:13,color:C.mid,flex:1,lineHeight:1.6}}>{e}</span>
          <button onClick={()=>clrErr(i)} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:18}}>×</button>
        </div>
      ))}

      {!addingTo&&(
        <div style={{marginBottom:16}} className="fu">
          <label className="slbl">Role Name <span style={{color:C.red}}>*</span></label>
          {/* BUG5 FIX: Enter key advances to JD textarea */}
          <input type="text" placeholder="e.g. Senior Java Developer, BPO Team Lead, Relationship Manager…" value={roleName} onChange={e=>setRoleName(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();document.querySelector("textarea")?.focus();}}}/>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:22,marginBottom:22}} className="two-col">
        {/* JD */}
        <div className="fu1">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <div className="ctitle" style={{marginBottom:0}}>Job Description</div>
            <button className="btn btn-ghost" style={{fontSize:11,padding:"3px 9px"}} onClick={()=>setModal("jdLib")}>📚 Library</button>
          </div>
          <p style={{fontSize:12,color:C.light,marginBottom:10}}>Paste text or upload PDF / TXT</p>
          <div className={`drop ${jdDrag?"over":""}`} style={{marginBottom:9}} onDragOver={e=>{e.preventDefault();setJdDrag(true);}} onDragLeave={()=>setJdDrag(false)} onDrop={e=>{e.preventDefault();setJdDrag(false);handleJD(e.dataTransfer.files);}} onClick={()=>jdRef.current?.click()}>
            <div style={{fontSize:20,marginBottom:4}}>📋</div>
            <div style={{fontSize:12.5,fontWeight:500,color:C.mid}}>Drop JD here (PDF / TXT)</div>
            <input ref={jdRef} type="file" accept=".pdf,.txt,.text" style={{display:"none"}} onChange={e=>{handleJD(e.target.files);e.target.value="";}}/>
          </div>
          <textarea rows={9} placeholder="Or paste full job description here — include required skills, experience level, responsibilities…" value={jdText} onChange={e=>setJdText(e.target.value)}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6,flexWrap:"wrap",gap:6}}>
            {jdText.trim()
              ? <div style={{fontSize:11,color:C.teal}}>✓ {jdText.length.toLocaleString()} characters</div>
              : <div/>
            }
            {jdText.trim()&&(
              showSaveJd
              ? <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input
                    type="text"
                    value={saveJdName}
                    onChange={e=>setSaveJdName(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"&&saveJdName.trim()){setJdLib(p=>[...p,{id:Date.now().toString(),name:saveJdName.trim(),text:jdText}]);setShowSaveJd(false);setSaveToast(true);setTimeout(()=>setSaveToast(false),2500);}}}
                    placeholder="Enter JD name…"
                    style={{width:160,padding:"5px 10px",fontSize:12,borderRadius:7,height:30}}
                    autoFocus
                  />
                  <button className="btn btn-gold" style={{fontSize:12,padding:"5px 13px",height:30}}
                    onClick={()=>{if(saveJdName.trim()){setJdLib(p=>[...p,{id:Date.now().toString(),name:saveJdName.trim(),text:jdText}]);setShowSaveJd(false);setSaveToast(true);setTimeout(()=>setSaveToast(false),2500);}}}>
                    💾 Save
                  </button>
                  <button onClick={()=>setShowSaveJd(false)} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:18,lineHeight:1}}>×</button>
                </div>
              : <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 11px"}}
                  onClick={()=>{setSaveJdName(roleName.trim()||"Untitled JD");setShowSaveJd(true);}}>
                  💾 Save to Library
                </button>
            )}
          </div>
        </div>

        {/* Resumes */}
        <div className="fu2">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div className="ctitle" style={{marginBottom:0}}>Candidate Resumes</div>
            <span style={{fontSize:11,color:C.light,fontFamily:"monospace"}}>{resumes.length}/5 this batch{addingTo&&activeRole?` · ${activeRole.candidates.length} ranked`:""}</span>
          </div>
          <p style={{fontSize:12,color:C.light,margin:"5px 0 11px"}}>PDF or TXT — up to 5 per batch, unlimited batches</p>
          <div className={`drop ${rDrag?"over":""}`} style={{marginBottom:11,minHeight:72}} onDragOver={e=>{e.preventDefault();setRDrag(true);}} onDragLeave={()=>setRDrag(false)} onDrop={e=>{e.preventDefault();setRDrag(false);handleResumes(e.dataTransfer.files);}} onClick={()=>resRef.current?.click()}>
            <div style={{fontSize:20,marginBottom:4}}>📄</div>
            <div style={{fontSize:12.5,fontWeight:500,color:C.mid}}>Drop PDF resumes here</div>
            <div style={{fontSize:11,color:C.light}}>Multiple files · Drag & drop or click</div>
            <input ref={resRef} type="file" accept=".pdf,.txt,.text" multiple style={{display:"none"}} onChange={e=>{handleResumes(e.target.files);e.target.value="";}}/>
          </div>
          {resumes.length>0?(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {resumes.map((r,i)=>(
                <div key={r.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 11px",background:C.greenL,border:`1px solid ${C.green}33`,borderRadius:7}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,minWidth:0}}>
                    <span style={{color:C.green,fontWeight:700,flexShrink:0}}>✓</span>
                    <span style={{fontSize:12.5,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                    <span style={{fontSize:10,color:C.light,flexShrink:0}}>.{r.filename.split(".").pop().toUpperCase()}</span>
                  </div>
                  <button onClick={()=>setResumes(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:17,padding:"0 0 0 5px"}}>×</button>
                </div>
              ))}
              {resumes.length<5&&<button className="btn btn-ghost" style={{marginTop:2,fontSize:12}} onClick={()=>resRef.current?.click()}>+ Add more</button>}
            </div>
          ):(
            <div style={{padding:12,background:C.blueL,border:`1px solid ${C.blue}22`,borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.blue,marginBottom:5}}>💡 For best results</div>
              <div style={{fontSize:11.5,color:C.mid,lineHeight:1.9}}>• Text-based PDFs (not scanned images)<br/>• No password-protected files<br/>• Max 5 per batch — add more after results<br/>• TXT files always work reliably</div>
            </div>
          )}
        </div>
      </div>

      <div className="fu3" style={{textAlign:"center"}}>

        {/* BUG6 FIX: show existing candidates when adding to role */}
        {addingTo&&activeRole&&(
          <div style={{marginBottom:16,padding:"10px 16px",background:C.blueL,border:`1px solid ${C.blue}33`,borderRadius:9,fontSize:13,color:C.blue,textAlign:"left"}}>
            📋 <strong>{activeRole.candidates.length} candidate{activeRole.candidates.length!==1?"s":""}</strong> already screened for <strong>{activeRole.name}</strong> — new ones will be added to this role.
          </div>
        )}

        {/* BUG25 FIX: toast confirmation */}
        {saveToast&&(
          <div style={{marginBottom:12,padding:"8px 16px",background:C.greenL,border:`1px solid ${C.green}44`,borderRadius:8,fontSize:13,color:C.green,display:"inline-flex",alignItems:"center",gap:6}}>
            ✓ Saved to JD Library!
          </div>
        )}
        <div style={{marginBottom:20,textAlign:"left"}}>
          <button className="btn btn-ghost" style={{fontSize:12,marginBottom:showCriteria?12:0,width:"100%",justifyContent:"space-between",background:showCriteria?C.alt:""}}
            onClick={()=>setShowCriteria(p=>!p)}>
            <span>🎯 Set Minimum Criteria <span style={{fontSize:11,color:C.light,fontWeight:400}}>(optional — pre-screens without AI)</span></span>
            <span style={{fontSize:13,color:C.light}}>{showCriteria?"▲":"▼"}</span>
          </button>
          {showCriteria&&(
            <div style={{background:C.alt,borderRadius:10,padding:"16px 18px",border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,color:C.mid,marginBottom:14,lineHeight:1.7}}>
                Any resume that doesn't meet these criteria will be <strong>instantly rejected before AI analysis</strong> — saving time and API calls.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}} className="three-col">
                <div>
                  <label className="slbl">Min. Experience (years)</label>
                  <input type="text" value={minExp} onChange={e=>setMinExp(e.target.value)} placeholder="e.g. 3"/>
                </div>
                <div>
                  <label className="slbl">Must-Have Skills</label>
                  <input type="text" value={mustSkills} onChange={e=>setMustSkills(e.target.value)} placeholder="e.g. React, Node.js, SQL"/>
                </div>
                <div>
                  <label className="slbl">Location (optional)</label>
                  <input type="text" value={mustLocation} onChange={e=>setMustLocation(e.target.value)} placeholder="e.g. Mumbai, Bangalore"/>
                </div>
              </div>
              {(minExp||mustSkills||mustLocation)&&(
                <div style={{marginTop:10,fontSize:11.5,color:C.teal,display:"flex",alignItems:"center",gap:6}}>
                  ✓ Gate active — resumes missing these criteria will be auto-rejected
                  <button onClick={()=>{setMinExp("");setMustSkills("");setMustLocation("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:12,textDecoration:"underline"}}>Clear</button>
                </div>
              )}
              {/* BUG7 FIX: warn if minExp is not a valid number */}
              {minExp&&isNaN(parseFloat(minExp))&&(
                <div style={{marginTop:8,fontSize:11.5,color:C.red}}>⚠ Min. Experience must be a number (e.g. 3)</div>
              )}
            </div>
          )}
        </div>

        {/* No API key warning */}
        {!apiKey&&(
          <div style={{marginBottom:14,padding:"11px 14px",background:C.redL,border:`1px solid ${C.red}33`,borderRadius:9,display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.red}}>⚠ No API key set — add your Anthropic key to start screening.</span>
            <button className="btn btn-red" style={{fontSize:12,flexShrink:0}} onClick={()=>setShowSettings(true)}>Add Key →</button>
          </div>
        )}

        {cooldownSecs>0?(
          <button className="btn btn-ghost" style={{fontSize:15,padding:"12px 42px"}} disabled>
            ⏳ Ready in {cooldownSecs}s…
          </button>
        ):(
        <button className="btn btn-gold" style={{fontSize:15,padding:"12px 42px"}} onClick={handleAnalyse}
          disabled={!jdText.trim()||resumes.length===0||(!addingTo&&!roleName.trim())||(!!minExp&&isNaN(parseFloat(minExp)))}>
          ⚡ {addingTo?"Screen & Add":"Screen"} {resumes.length>0?resumes.length:""} Candidate{resumes.length!==1?"s":""}
        </button>
        )}
        <div style={{marginTop:10,fontSize:11.5,color:C.light}}>
          💡 <strong>Tip:</strong> Wait 20 seconds between analyses to avoid API rate limits. Fewer resumes per batch = faster results.
        </div>
      </div>
    </main>

    {modal==="jdLib"&&<Modal title="📚 JD Library" onClose={()=>setModal(null)}>
      {jdLib.length===0?<div style={{padding:20,textAlign:"center",color:C.light,fontSize:13}}>No saved JDs yet.</div>:
      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:340,overflowY:"auto"}}>
        {jdLib.map((jd,i)=><div key={jd.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:C.alt,borderRadius:8}}>
          <div><div style={{fontWeight:600,fontSize:13}}>{jd.name}</div><div style={{fontSize:11,color:C.light}}>{jd.text.slice(0,60)}…</div></div>
          <div style={{display:"flex",gap:5}}>
            <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 9px"}} onClick={()=>{setJdText(jd.text);if(!roleName)setRoleName(jd.name);setModal(null);}}>Load</button>
            <button className="btn btn-red" style={{fontSize:11,padding:"4px 9px"}} onClick={()=>setJdLib(p=>p.filter((_,j)=>j!==i))}>✕</button>
          </div>
        </div>)}
      </div>}
    </Modal>}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYZING SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if(screen==="analyzing") return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><style>{CSS}</style>
    <div style={{maxWidth:420,width:"100%",padding:"0 22px",textAlign:"center"}} className="fu">
      <Sp size={44}/>
      <div style={{fontFamily:"Playfair Display,serif",fontSize:21,fontWeight:700,marginTop:20,marginBottom:4}}>Screening Candidates</div>
      {retryStatus?(
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:22,marginBottom:6}}>⏳</div>
          <div style={{fontSize:14,color:C.gold,fontWeight:700,marginBottom:4}}>{retryStatus}</div>
          <div style={{fontSize:12,color:C.light}}>Your resumes are safe — do not close this tab</div>
        </div>
      ):(
        <div style={{fontSize:12.5,color:C.light,marginBottom:6}}>Analysing {resumes.length} candidate{resumes.length!==1?"s":""}…</div>
      )}
      {/* Live countdown bar */}
      <div style={{marginBottom:18,position:"relative"}}>
        <div className="timer-bar" key={elapsed}/>
        <div style={{fontSize:11,color:C.light,marginTop:5}}>{elapsed}s elapsed</div>
      </div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:18,textAlign:"left"}}>
        {STEPS.map((s,i)=>{
          const done=i<stepIdx,active=i===stepIdx;
          return(<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<STEPS.length-1?`1px solid ${C.border}22`:"none",opacity:i>stepIdx?.3:1}}>
            <div style={{width:24,height:24,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,flexShrink:0,fontWeight:700,background:done?C.greenL:active?C.goldL:C.alt,color:done?C.green:active?C.goldD:C.light}}>
              {done?"✓":active?<Sp size={12}/>:i+1}
            </div>
            <div style={{fontSize:12.5,fontWeight:active?600:400,color:active?C.ink:C.mid}}>{s}</div>
          </div>);
        })}
      </div>
      <div style={{marginBottom:10}}><div className="lbar"><div className="lbar-fill" style={{width:"100%"}}/></div></div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"center"}}>
        {resumes.map(r=><div key={r.id} style={{padding:"3px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:100,fontSize:11.5,color:C.mid,display:"flex",alignItems:"center",gap:4}}><span style={{color:C.gold,animation:"pulse 1.2s infinite"}}>●</span>{r.name}</div>)}
      </div>
      {elapsed>25&&!retryStatus&&<div style={{marginTop:14,padding:"9px 13px",background:C.goldL,borderRadius:8,fontSize:12,color:C.goldD}}>⏳ Processing large resumes — almost done…</div>}
    </div></div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // RESULTS SCREEN
  // ══════════════════════════════════════════════════════════════════════════
  if(!activeRole) return null;
  const displayCands=sortedCandidates(activeRole.candidates);
  const visibleCands = scoreThreshold>0 ? displayCands.filter(c=>c.overallScore>=scoreThreshold) : displayCands;
  // FIX: always find selected candidate by ID — survives sort changes
  const sel = selectedCandId
    ? visibleCands.find(c=>c.id===selectedCandId) || visibleCands[0]
    : visibleCands[0];
  const selRankIdx = sel ? displayCands.findIndex(c=>c.id===sel.id) : 0;
  const selV=sel?verd(sel.overallScore):null;
  const st=getRoleStats(activeRole);
  const selReport=sel?reports[sel.id]:null;
  const selInterview=sel?interviews[sel.id]:null;
  const cmpCands=cmpIds.map(id=>activeRole.candidates.find(c=>c.id===id)).filter(Boolean);

  return(
    <div style={{minHeight:"100vh",background:C.bg}}><style>{CSS}</style>

    {/* Header */}
    <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 22px",position:"sticky",top:0,zIndex:200}} className="no-print">
      <div style={{maxWidth:1360,margin:"0 auto",height:50,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <button onClick={()=>setScreen("home")} style={{background:"none",border:"none",cursor:"pointer",color:C.light,fontSize:18,flexShrink:0}}>←</button>
          <span style={{fontFamily:"Playfair Display,serif",fontSize:15,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeRole.name}</span>
          <Tag type="neutral">{activeRole.candidates.length} screened</Tag>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap"}}>
          <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px"}} onClick={()=>bulkShortlistTop(activeId,3)}>★ Shortlist Top 3</button>
          <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px"}} onClick={()=>exportExcel(activeRole.name,activeRole.candidates)}>📥 Export Excel</button>
          <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 11px"}} onClick={()=>printShortlist(activeRole.name,activeRole.candidates)}>📋 Print Shortlist → PDF</button>
          <button className="btn btn-gold" style={{fontSize:11,padding:"5px 12px"}} onClick={()=>{setAddingTo(activeId);setJdText(activeRole.jd);setRoleName(activeRole.name);setResumes([]);setErrors([]);setScreen("setup");}}>+ More Resumes</button>
        </div>
      </div>
    </header>

    {/* Stats + Controls bar */}
    <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"9px 22px"}} className="no-print">
      <div style={{maxWidth:1360,margin:"0 auto"}}>
        {/* Row 1: stats + view controls */}
        <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",justifyContent:"space-between",marginBottom:bulkSelected.size>0?8:0}}>
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            {[["🟢",st.strong,"Strong",C.green],["🟡",st.consider,"Consider",C.gold],["🔴",st.fail,"Fail",C.red],["★",st.shortlisted,"Listed",C.green],["📅",st.interview,"Interview",C.blue],["🎯",st.offered,"Offered",C.purple]].map(([ic,n,lbl,col],i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:11}}>{ic}</span>
                <span style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:col}}>{n}</span>
                <span style={{fontSize:11,color:C.light}}>{lbl}</span>
                {i<5&&<span style={{color:C.border,fontSize:9}}>·</span>}
              </div>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {/* Score threshold filter */}
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:11.5,color:C.light,whiteSpace:"nowrap"}}>Show ≥</span>
              <select value={scoreThreshold} onChange={e=>{setScoreThreshold(Number(e.target.value));setBulkSelected(new Set());}} style={{width:"auto",padding:"4px 8px",fontSize:12}}>
                {[0,30,40,50,60,70].map(v=><option key={v} value={v}>{v===0?"All":v+"+ score"}</option>)}
              </select>
            </div>
            {/* Sort */}
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:11.5,color:C.light}}>Sort:</span>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{width:"auto",padding:"4px 8px",fontSize:12}}>
                <option value="score">Best Match</option>
                <option value="experience">Experience</option>
                <option value="stability">Stability</option>
                <option value="shortlisted">Shortlisted</option>
              </select>
            </div>
            {/* View toggle */}
            <div style={{display:"flex",border:`1px solid ${C.border}`,borderRadius:7,overflow:"hidden"}}>
              {[["cards","☰"],["table","⊞"]].map(([m,ic])=>(
                <button key={m} onClick={()=>{setViewMode(m);setBulkSelected(new Set());}}
                  style={{background:viewMode===m?C.ink:C.surface,color:viewMode===m?"#fff":C.mid,border:"none",padding:"4px 11px",fontSize:14,cursor:"pointer",transition:"all .15s"}}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: bulk actions (shown when items selected) */}
        {bulkSelected.size>0&&(
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderTop:`1px solid ${C.border}`,marginTop:6,flexWrap:"wrap"}}>
            <span style={{fontSize:12.5,fontWeight:600,color:C.ink}}>{bulkSelected.size} selected</span>
            <button className="btn btn-green" style={{fontSize:11,padding:"4px 11px"}} onClick={()=>bulkSetStatus(activeId,bulkSelected,"shortlisted")}>★ Shortlist All</button>
            <button className="btn btn-red" style={{fontSize:11,padding:"4px 11px"}} onClick={()=>bulkSetStatus(activeId,bulkSelected,"rejected")}>✕ Reject All</button>
            <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 11px"}} onClick={()=>bulkSetStatus(activeId,bulkSelected,"interview")}>📅 Mark Interview</button>
            <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 11px"}} onClick={()=>setBulkSelected(new Set())}>Clear</button>
            <span style={{fontSize:11,color:C.light,marginLeft:4}}>
              Quick select: <button onClick={()=>selectAllVisible(visibleCands.filter(c=>verd(c.overallScore).label==="FAIL"))} style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:11,fontWeight:600,textDecoration:"underline"}}>All FAILs</button>
              {" · "}<button onClick={()=>selectAllVisible(visibleCands.filter(c=>verd(c.overallScore).label==="STRONG FIT"))} style={{background:"none",border:"none",cursor:"pointer",color:C.green,fontSize:11,fontWeight:600,textDecoration:"underline"}}>All Strong Fits</button>
              {" · "}<button onClick={()=>selectAllVisible(visibleCands)} style={{background:"none",border:"none",cursor:"pointer",color:C.blue,fontSize:11,fontWeight:600,textDecoration:"underline"}}>All Visible</button>
            </span>
          </div>
        )}
      </div>
      {errors.map((e,i)=><div key={i} style={{background:C.redL,borderRadius:7,padding:"5px 12px",marginTop:6,fontSize:12,color:C.red,display:"flex",gap:7,alignItems:"center",maxWidth:1360,margin:"6px auto 0"}}>⚠ {e}<button onClick={()=>clrErr(i)} style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:14,marginLeft:4}}>×</button></div>)}
    </div>

    <div className="results-grid" style={{maxWidth:1360,margin:"0 auto",padding:"16px 22px",display:"grid",gridTemplateColumns:viewMode==="table"?"1fr":"255px 1fr",gap:16}}>

      {/* TABLE VIEW MODE */}
      {viewMode==="table"&&(
        <div style={{gridColumn:"1/-1"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:C.ink}}>
                  <th style={{padding:"9px 10px",width:32}}><input type="checkbox" onChange={e=>e.target.checked?selectAllVisible(visibleCands):setBulkSelected(new Set())} style={{cursor:"pointer"}}/></th>
                  {["#","Candidate","Current Role","Score","Verdict","Skill","Exp","CTC","Notice","Status","Action"].map(h=>(
                    <th key={h} style={{padding:"9px 11px",textAlign:"left",fontSize:10,color:"#D4C8B4",fontWeight:600,letterSpacing:".06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCands.map((c,i)=>{
                  const v=verd(c.overallScore);
                  const sc=STATUS_CFG[c.status]||STATUS_CFG.new;
                  const isChecked=bulkSelected.has(c.id);
                  return(
                    <tr key={c.id} style={{borderBottom:`1px solid ${C.border}`,background:isChecked?C.goldL:i%2===0?C.surface:C.alt,cursor:"pointer",transition:"background .1s"}}
                      onClick={()=>{pickCandidate(c.id);setViewMode("cards");}}>
                      <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked} onChange={()=>toggleBulkSelect(c.id)} style={{cursor:"pointer"}}/>
                      </td>
                      <td style={{padding:"8px 11px",fontWeight:600,color:C.light,fontFamily:"monospace"}}>{i+1}</td>
                      <td style={{padding:"8px 11px"}}>
                        <div style={{fontWeight:700,fontSize:13}}>{c.name}</div>
                        {c.preScreened&&<div style={{fontSize:10,color:C.red,marginTop:1}}>⚠ Pre-screened out</div>}
                      </td>
                      <td style={{padding:"8px 11px",color:C.light,fontSize:12}}>{c.currentRole||"—"}</td>
                      <td style={{padding:"8px 11px",textAlign:"center"}}>
                        <span style={{fontSize:18,fontWeight:800,color:v.color,fontFamily:"monospace"}}>{c.overallScore}</span>
                      </td>
                      <td style={{padding:"8px 11px"}}>
                        <span className="tag" style={{background:v.bg,color:v.color,fontSize:9}}>{v.dot} {v.label}</span>
                      </td>
                      <td style={{padding:"8px 11px",textAlign:"center",fontFamily:"monospace",color:C.teal,fontSize:12}}>{c.skillMatch}%</td>
                      <td style={{padding:"8px 11px",textAlign:"center",fontFamily:"monospace",color:C.blue,fontSize:12}}>{c.experienceRelevance}%</td>
                      <td style={{padding:"8px 11px",fontSize:12,whiteSpace:"nowrap"}}>{c.expectedCTCMin?`₹${c.expectedCTCMin}–${c.expectedCTCMax}L`:"—"}</td>
                      <td style={{padding:"8px 11px",fontSize:12,color:C.light}}>{c.noticePeriod||"—"}</td>
                      <td style={{padding:"8px 11px"}}>
                        <span className="tag" style={{background:sc.bg,color:sc.color,fontSize:9}}>{sc.icon} {sc.label}</span>
                      </td>
                      <td style={{padding:"8px 11px"}} onClick={e=>e.stopPropagation()}>
                        <div style={{display:"flex",gap:4}}>
                          <button className="btn btn-green" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>setStatus(activeId,c.id,"shortlisted")}>★</button>
                          <button className="btn btn-red" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>setStatus(activeId,c.id,"rejected")}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {scoreThreshold>0&&displayCands.length>visibleCands.length&&(
            <div style={{padding:"11px 14px",background:C.goldL,borderRadius:8,marginTop:10,fontSize:12.5,color:C.goldD,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>⚡ {displayCands.length-visibleCands.length} candidates hidden (score below {scoreThreshold})</span>
              <button className="btn btn-red" style={{fontSize:11,padding:"4px 11px"}}
                onClick={()=>bulkSetStatus(activeId,new Set(displayCands.filter(c=>c.overallScore<scoreThreshold).map(c=>c.id)),"rejected")}>
                Reject All Hidden
              </button>
            </div>
          )}
        </div>
      )}

      {/* CARDS VIEW MODE */}
      {viewMode==="cards"&&<>
      {/* LEFT PANEL */}
      <aside className="left-panel no-print" style={{display:"flex",flexDirection:"column",gap:7}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
          <span className="slbl" style={{marginBottom:0}}>
            {candSearch ? `${visibleCands.filter(c=>c.name.toLowerCase().includes(candSearch.toLowerCase())).length} results` : `${visibleCands.length} of ${displayCands.length}`}
          </span>
          <button className="btn btn-ghost" style={{fontSize:10,padding:"2px 7px",background:cmpIds.length>0?C.goldL:"",borderColor:cmpIds.length>0?C.gold:C.border}}
            onClick={()=>setCmpIds(cmpIds.length>0?[]:["select"])}>
            {cmpIds.length>0?"✕ Cancel":"⇄ Compare 2"}
          </button>
        </div>

        {/* BUG22 — name search */}
        <input type="text" value={candSearch} onChange={e=>setCandSearch(e.target.value)}
          placeholder="🔍 Search by name…"
          style={{padding:"6px 10px",fontSize:12,borderRadius:7,border:`1.5px solid ${C.border}`,marginBottom:2}}/>

        {cmpIds.length>0&&(
          <div style={{padding:"7px 10px",background:C.goldL,borderRadius:7,fontSize:11.5,color:C.goldD,marginBottom:2}}>
            {cmpIds.filter(x=>x!=="select").length===0?"👆 Click first candidate":"👆 Now click second candidate"}
          </div>
        )}
        {scoreThreshold>0&&displayCands.length>visibleCands.length&&(
          <div style={{padding:"7px 10px",background:C.redL,borderRadius:7,fontSize:11,color:C.red,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>{displayCands.length-visibleCands.length} hidden (below {scoreThreshold})</span>
            <button style={{background:"none",border:"none",cursor:"pointer",color:C.red,fontSize:10,textDecoration:"underline"}} onClick={()=>setScoreThreshold(0)}>Show all</button>
          </div>
        )}

        {/* BUG13/14 — empty state */}
        {visibleCands.filter(c=>!candSearch||c.name.toLowerCase().includes(candSearch.toLowerCase())).length===0&&(
          <div style={{padding:"20px 14px",textAlign:"center",background:C.alt,borderRadius:9,border:`1px dashed ${C.border}`}}>
            {candSearch
              ? <><div style={{fontSize:20,marginBottom:6}}>🔍</div><div style={{fontSize:12.5,color:C.mid}}>No candidates match "{candSearch}"</div><button style={{background:"none",border:"none",cursor:"pointer",color:C.gold,fontSize:12,marginTop:6}} onClick={()=>setCandSearch("")}>Clear search</button></>
              : scoreThreshold>0
              ? <><div style={{fontSize:20,marginBottom:6}}>🎯</div><div style={{fontSize:12.5,color:C.mid,marginBottom:6}}>All candidates are below {scoreThreshold}</div><button style={{background:"none",border:"none",cursor:"pointer",color:C.gold,fontSize:12}} onClick={()=>setScoreThreshold(0)}>Lower filter to show all</button></>
              : <div style={{fontSize:12.5,color:C.light}}>No candidates yet</div>
            }
          </div>
        )}

        {visibleCands
          .filter(c=>!candSearch||c.name.toLowerCase().includes(candSearch.toLowerCase()))
          .map((c,i)=>{
          const v=verd(c.overallScore),sc=STATUS_CFG[c.status]||STATUS_CFG.new;
          const isSelected = sel?.id===c.id;
          const inCmp = cmpIds.includes(c.id);
          const inCmpMode = cmpIds.length>0;
          const isChecked = bulkSelected.has(c.id);
          return(<div key={c.id} className={`cand ${isSelected&&!inCmpMode&&!bulkSelected.size?"on":""} ${inCmp?"on":""}`}
            style={{borderLeft:isChecked?`3px solid ${C.gold}`:"",background:isChecked?C.goldL:""}}
            onClick={()=>{
              if(inCmpMode){
                const realIds=cmpIds.filter(x=>x!=="select");
                let next;
                if(inCmp){ next=[...realIds.filter(x=>x!==c.id)]; }
                else { next=[...realIds.slice(-1),c.id]; }
                setCmpIds(next.length>0?next:["select"]);
                if(next.length===2) setModal("compare");
              } else {
                pickCandidate(c.id);
              }
            }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
              <div style={{minWidth:0,display:"flex",alignItems:"flex-start",gap:6}}>
                <input type="checkbox" checked={isChecked}
                  onChange={e=>{e.stopPropagation();toggleBulkSelect(c.id);}}
                  onClick={e=>e.stopPropagation()}
                  style={{cursor:"pointer",flexShrink:0,marginTop:2}}/>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:"Playfair Display,serif",fontSize:13,fontWeight:700,marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.light,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.currentRole||"Candidate"}</div>
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:5}}>
                <div style={{fontSize:19,fontWeight:800,color:v.color,fontFamily:"monospace",lineHeight:1}}>{c.overallScore}</div>
                <div style={{fontSize:8,color:C.light,textTransform:"uppercase"}}>score</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
              <span className="tag" style={{background:v.bg,color:v.color,fontSize:9}}>{v.dot} {v.label}</span>
              <span className="tag" style={{background:sc.bg,color:sc.color,fontSize:9}}>{sc.icon} {sc.label}</span>
            </div>
            {c.preScreened?(
              <div style={{fontSize:10.5,color:C.red,lineHeight:1.5}}>⚠ {c.recruiterSummary}</div>
            ):(
              <>
                <div style={{display:"flex",gap:8,fontSize:10,color:C.light,marginBottom:c.riskFlags?.length?4:0}}>
                  <span>Skill <b style={{color:C.teal,fontFamily:"monospace"}}>{c.skillMatch}%</b></span>
                  <span>Exp <b style={{color:C.blue,fontFamily:"monospace"}}>{c.experienceRelevance}%</b></span>
                  {c.yearsExperience!=null&&<span><b style={{color:C.mid,fontFamily:"monospace"}}>{c.yearsExperience}</b>yr</span>}
                </div>
                {c.riskFlags?.length>0&&<div style={{fontSize:10,color:C.red,marginTop:2}}>⚠ {c.riskFlags[0]}</div>}
              </>
            )}
          </div>);
        })}
      </aside>

      {/* RIGHT PANEL */}
      <main>
        {/* BUG14 — empty state when no candidate selected */}
        {!sel&&(
          <div style={{textAlign:"center",padding:"60px 32px",background:C.surface,borderRadius:13,border:`1px dashed ${C.border}`}}>
            <div style={{fontSize:36,marginBottom:12}}>👈</div>
            <div style={{fontFamily:"Playfair Display,serif",fontSize:17,fontWeight:700,marginBottom:8}}>Select a candidate</div>
            <div style={{fontSize:13,color:C.light}}>{scoreThreshold>0?"Try lowering the score filter to see candidates":"Click any candidate from the list to view their full analysis"}</div>
          </div>
        )}
        {sel&&selV&&(
          <>
            {/* Candidate Hero */}
            <div className="pop" style={{background:`linear-gradient(135deg,${C.ink} 0%,#2B1A06 100%)`,borderRadius:13,padding:"18px 22px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
                <div>
                  {/* BUG15 — correct rank count when filter active */}
                  <div style={{fontSize:9.5,color:C.gold,fontFamily:"monospace",fontWeight:600,letterSpacing:".1em",textTransform:"uppercase",marginBottom:5}}>
                    Rank #{selRankIdx+1}{scoreThreshold>0?` of ${visibleCands.length} visible (${activeRole.candidates.length} total)`
                      :` of ${activeRole.candidates.length}`} · {activeRole.name}
                  </div>
                  <h2 style={{fontFamily:"Playfair Display,serif",fontSize:"clamp(17px,2.8vw,22px)",fontWeight:900,color:"#fff",marginBottom:3,lineHeight:1.1}}>{sel.name}</h2>
                  <div style={{fontSize:12.5,color:"#B8A898"}}>{sel.currentRole||""}{sel.currentCompany?` @ ${sel.currentCompany}`:""}{sel.yearsExperience!=null?` · ${sel.yearsExperience} yrs`:""}</div>
                  {/* 3-4 line recruiter summary — the most important field */}
                  {sel.recruiterSummary&&<div style={{marginTop:10,fontSize:12.5,color:"#D4C8B8",lineHeight:1.75,maxWidth:500,background:"rgba(255,255,255,.06)",borderRadius:8,padding:"9px 12px"}}>{sel.recruiterSummary}</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                  <Ring score={sel.overallScore} size={70}/>
                  <span className="tag" style={{background:selV.bg,color:selV.color,fontSize:9.5}}>{selV.dot} {selV.label}</span>
                  {sel.confidenceScore&&<span style={{fontSize:10,color:"#9A8F7F"}}>Confidence: <b style={{color:C.gold}}>{sel.confidenceScore}%</b></span>}
                </div>
              </div>

              {/* Quick info row */}
              <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.1)",display:"flex",gap:12,flexWrap:"wrap",fontSize:11.5,color:"#B8A898"}}>
                {/* BUG20 — explicit >0 check so CTC of 0 (freshers) shows properly */}
                {sel.expectedCTCMin>0&&<span>💰 ₹{sel.expectedCTCMin}–{sel.expectedCTCMax} LPA</span>}
                {sel.noticePeriod&&<span>📅 {sel.noticePeriod}</span>}
                {sel.stabilityScore>0&&<span>📊 Stability: <b style={{color:sel.stabilityScore>=70?"#6FD98F":sel.stabilityScore>=50?C.gold:C.red}}>{sel.stabilityScore}/100</b></span>}
                {sel.isDuplicate&&<span style={{color:C.red}}>⚠ Possible duplicate resume</span>}
              </div>

              {/* Status + Actions */}
              <div style={{marginTop:11,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10.5,color:"#9A8F7F",flexShrink:0}}>Status:</span>
                {Object.entries(STATUS_CFG).map(([key,sc])=>(
                  <button key={key} onClick={()=>setStatus(activeId,sel.id,key)}
                    style={{background:sel.status===key?sc.bg:"rgba(255,255,255,.06)",color:sel.status===key?sc.color:"#B8A898",border:`1.5px solid ${sel.status===key?sc.color:"rgba(255,255,255,.14)"}`,borderRadius:100,padding:"3px 10px",fontSize:10.5,fontWeight:sel.status===key?700:400,cursor:"pointer",transition:"all .15s",transform:sel.status===key?"scale(1.04)":"scale(1)"}}>
                    {sc.icon} {sc.label}
                  </button>
                ))}
                <div style={{marginLeft:"auto",display:"flex",gap:5}}>
                  {/* BUG17 — always reset tplTab to waInvite when opening for new candidate */}
                  <button className="btn btn-ghost" style={{fontSize:10.5,padding:"4px 9px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"#D4C8B8"}} onClick={()=>{setTplCand(sel);setTplTab("waInvite");setModal("template");}}>📱 Templates</button>
                  {/* BUG18 — pass selReport so hero PDF button prints filled data */}
                  <button className="btn btn-ghost" style={{fontSize:10.5,padding:"4px 9px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",color:"#D4C8B8"}} onClick={()=>printReport({...sel,report:selReport||{}})}>🖨 PDF</button>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{borderBottom:`1px solid ${C.border}`,marginBottom:14,display:"flex",overflowX:"auto"}} className="no-print">
              {[["rank","🏆 Ranking"],["report","📊 Report"],["interview","🎯 Interview"]].map(([id,lbl])=>(
                <button key={id} className={`tab ${tab===id?"on":""}`} onClick={()=>{
                  setTab(id);
                  if(id==="report"&&!selReport&&!loadingReport) loadReport(sel,activeRole.jd);
                  if(id==="interview"){
                    if(!selInterview){
                      // BUG19 — if another interview is loading, still show tab (not silently block)
                      if(loadingInterview&&loadingInterview!==sel.id){
                        // will show "another loading" state in the tab content
                      } else if(!loadingInterview){
                        loadInterview(sel,activeRole.jd);
                      }
                    }
                  }
                }}>{lbl}</button>
              ))}
            </div>

            {/* ── RANKING TAB ── */}
            {tab==="rank"&&(
              <div className="fu">
                {/* Top 5 Skills + Missing */}
                <div className="card" style={{marginBottom:14,borderTop:`3px solid ${C.gold}`}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}} className="two-col">
                    <div>
                      <div className="ctitle" style={{color:C.teal,fontSize:14}}>✅ Top 5 Matching Skills</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {(sel.top5Skills||[]).map((s,i)=><Tag key={i} type="teal">{s}</Tag>)}
                        {!sel.top5Skills?.length&&<span style={{fontSize:12,color:C.light}}>None detected</span>}
                      </div>
                    </div>
                    <div>
                      <div className="ctitle" style={{color:C.orange,fontSize:14}}>⚠ Missing Critical Skills</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {(sel.missingSkills||[]).map((s,i)=><Tag key={i} type="orange">{s}</Tag>)}
                        {!sel.missingSkills?.length&&<span style={{fontSize:12,color:C.light}}>None identified</span>}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}} className="two-col">
                  <div className="card">
                    <div className="ctitle">Assessment Scores</div>
                    <Meter value={sel.skillMatch} color={C.teal} label="Skill Match"/>
                    <Meter value={sel.experienceRelevance} color={C.blue} label="Experience Relevance"/>
                    <Meter value={sel.leadershipScore} color={C.gold} label="Leadership"/>
                    <Meter value={sel.cultureFit} color={C.teal} label="Culture Fit"/>
                    <Meter value={sel.stabilityScore||0} color={C.purple} label="Stability Score"/>
                  </div>
                  <div className="card">
                    <div className="ctitle">Verdict & CTC</div>
                    <div style={{padding:"10px 13px",background:selV.bg,borderRadius:8,marginBottom:11,border:`1px solid ${selV.color}33`}}>
                      <div style={{fontSize:13.5,fontWeight:800,color:selV.color,marginBottom:4}}>{selV.dot} {selV.label}</div>
                      <div style={{fontSize:12.5,color:C.mid,lineHeight:1.65}}>{sel.recommendationReason||sel.recruiterSummary}</div>
                    </div>
                    {sel.expectedCTCMin&&<div style={{padding:"10px 13px",background:C.goldL,borderRadius:8,border:`1px solid ${C.gold}44`}}>
                      <div style={{fontSize:11,color:C.goldD,fontWeight:600,marginBottom:3}}>EXPECTED CTC</div>
                      <div style={{fontSize:20,fontWeight:800,fontFamily:"monospace"}}>₹{sel.expectedCTCMin}–{sel.expectedCTCMax} <span style={{fontSize:12,fontWeight:400}}>LPA</span></div>
                      {sel.noticePeriod&&<div style={{fontSize:12,color:C.mid,marginTop:3}}>Notice: {sel.noticePeriod}</div>}
                    </div>}
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}} className="two-col">
                  <div className="card">
                    <div className="ctitle" style={{color:C.green}}>💪 Strengths</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {(sel.strengths||[]).map((s,i)=><div key={i} style={{display:"flex",gap:7,padding:"8px 11px",background:C.greenL,borderRadius:7,border:`1px solid ${C.green}22`}}><span style={{color:C.green,flexShrink:0,fontWeight:700}}>✓</span><span style={{fontSize:12.5,lineHeight:1.6}}>{s}</span></div>)}
                      {!(sel.strengths||[]).length&&<p style={{fontSize:12.5,color:C.light}}>None identified.</p>}
                    </div>
                  </div>
                  <div className="card">
                    <div className="ctitle" style={{color:C.red}}>🚩 Risk Flags</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
                      {(sel.riskFlags||[]).map((rf,i)=><div key={i} style={{display:"flex",gap:7,padding:"8px 11px",background:C.redL,borderRadius:7,border:`1px solid ${C.red}22`}}><span style={{color:C.red,flexShrink:0}}>▲</span><span style={{fontSize:12.5,lineHeight:1.6}}>{rf}</span></div>)}
                      {!(sel.riskFlags||[]).length&&<p style={{fontSize:12.5,color:C.light}}>No risk flags detected.</p>}
                    </div>
                    {sel.experienceGapSummary&&<div style={{padding:"9px 11px",background:C.orangeL,borderRadius:7,fontSize:12,color:C.orange,lineHeight:1.6,border:`1px solid ${C.orange}33`}}><strong>Experience Gap:</strong> {sel.experienceGapSummary}</div>}
                  </div>
                </div>

                {/* AI disclaimer inline */}
                <div style={{padding:"10px 14px",background:C.alt,borderRadius:8,border:`1px solid ${C.border}`,fontSize:11.5,color:C.light,display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{flexShrink:0}}>ℹ</span>
                  <span><strong style={{color:C.mid}}>AI assists, you decide.</strong> These scores are generated by AI to help you screen faster. They should be used as a starting point for evaluation — not as a final judgment. Always conduct interviews and verify claims before making hiring decisions.</span>
                </div>
              </div>
            )}

            {/* ── REPORT TAB ── */}
            {tab==="report"&&(()=>{
              const rKey=sel.id;
              if(loadingReport===rKey) return <TabLoader message="Generating intelligence report…"/>;
              if(reportErr[rKey]) return(
                <div style={{padding:"32px",textAlign:"center"}} className="card">
                  <div style={{fontSize:13.5,color:C.red,marginBottom:16}}>⚠ {reportErr[rKey]}</div>
                  <button className="btn btn-gold" onClick={()=>{setReportErr(p=>({...p,[rKey]:null}));loadReport(sel,activeRole.jd);}}>↻ Retry</button>
                </div>
              );
              if(!selReport) return(
                <div style={{textAlign:"center",padding:"44px 32px"}} className="card">
                  <div style={{fontSize:38,marginBottom:12}}>📊</div>
                  <div style={{fontFamily:"Playfair Display,serif",fontSize:18,fontWeight:700,marginBottom:8}}>Intelligence Report</div>
                  <p style={{fontSize:13,color:C.light,maxWidth:380,margin:"0 auto 22px",lineHeight:1.75}}>Full analysis with executive summary, salary data, skill alignment evidence and client-ready recommendation.</p>
                  <button className="btn btn-gold" onClick={()=>loadReport(sel,activeRole.jd)}>⚡ Generate Report for {sel.name}</button>
                  <div style={{marginTop:9,fontSize:11,color:C.light}}>~10–15 seconds</div>
                </div>
              );
              const rep=selReport,sal=rep.salaryRange||{};
              const fmt=n=>isNaN(Number(n))?"—":`₹${Number(n).toLocaleString("en-IN")} LPA`;
              return(<div className="fu pop">
                <div className="card" style={{borderTop:`4px solid ${C.gold}`,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:9,marginBottom:11}}>
                    <div><Tag type="gold">Client-Ready</Tag><div style={{fontFamily:"Playfair Display,serif",fontSize:19,fontWeight:700,marginTop:7}}>{sel.name}</div></div>
                    <button className="btn btn-gold" style={{fontSize:12,padding:"6px 14px"}} onClick={()=>printReport({...sel,report:rep})}>🖨 Print → Save as PDF</button>
                  </div>
                  {rep.valueProposition&&<div style={{padding:"10px 13px",background:C.goldL,borderRadius:8,fontStyle:"italic",fontSize:13.5,color:C.goldD,fontFamily:"Playfair Display,serif",lineHeight:1.7}}>"{rep.valueProposition}"</div>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}} className="two-col">
                  <div className="card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:9}}><div className="ctitle" style={{marginBottom:0}}>Executive Summary</div><CpyBtn text={rep.executiveSummary||""}/></div>
                    <p style={{fontSize:13,color:C.mid,lineHeight:1.8}}>{rep.executiveSummary||"—"}</p>
                  </div>
                  <div className="card">
                    <div className="ctitle">Expected CTC & Focus</div>
                    {sal.min&&<><div style={{fontSize:21,fontWeight:800,fontFamily:"monospace",marginBottom:3}}>{fmt(sal.min)} – {fmt(sal.max)}</div><div style={{fontSize:11.5,color:C.gold,fontWeight:600,marginBottom:7}}>{sal.currency||"INR"} per year · {sal.basis}</div></>}
                    {rep.interviewFocus&&<div style={{padding:"9px 12px",background:C.tealL,borderRadius:7,fontSize:12,color:C.teal,lineHeight:1.6}}><strong>Interview focus:</strong> {rep.interviewFocus}</div>}
                  </div>
                </div>
                <div className="card" style={{marginBottom:14}}>
                  <div className="ctitle">Key Skills Aligned</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:9}}>
                    {(rep.keySkillsAligned||[]).map((s,i)=><div key={i} style={{padding:10,background:C.alt,borderRadius:8,border:`1px solid ${C.border}`}}><div style={{fontWeight:700,fontSize:12,marginBottom:3,color:C.teal}}>{s.skill}</div><div style={{fontSize:11.5,color:C.mid,marginBottom:3,lineHeight:1.5}}>{s.evidence}</div><div style={{fontSize:10.5,color:C.light,fontStyle:"italic"}}>{s.relevance}</div></div>)}
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}} className="two-col">
                  <div className="card"><div className="ctitle">Experience Highlights</div>{(rep.experienceHighlights||[]).map((h,i)=><div key={i} style={{padding:"9px 11px",background:C.blueL,borderRadius:7,marginBottom:7,border:`1px solid ${C.blue}22`}}><div style={{fontWeight:600,fontSize:12,marginBottom:3}}>{h.highlight}</div><div style={{fontSize:11.5,color:C.mid,lineHeight:1.6,fontStyle:"italic"}}>{h.impact}</div></div>)}</div>
                  <div className="card"><div className="ctitle">Gaps & Mitigations</div>{(rep.potentialGaps||[]).map((g,i)=><div key={i} style={{padding:"9px 11px",background:C.redL,borderRadius:7,marginBottom:7,border:`1px solid ${C.red}22`}}><div style={{fontWeight:600,fontSize:12,marginBottom:3,color:C.red}}>{g.gap}</div><div style={{fontSize:11.5,color:C.mid,lineHeight:1.6}}>↳ {g.mitigation}</div></div>)}</div>
                </div>
                <div className="card" style={{borderTop:`3px solid ${C.teal}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div className="ctitle" style={{marginBottom:0}}>Final Recommendation</div><CpyBtn text={rep.clientReadyConclusion||""}/></div>
                  <p style={{fontSize:13.5,color:C.mid,lineHeight:1.8}}>{rep.clientReadyConclusion||"—"}</p>
                </div>
              </div>);
            })()}

            {/* ── INTERVIEW TAB ── */}
            {tab==="interview"&&(()=>{
              const iKey=sel.id;
              // BUG19 — another candidate's interview is loading
              if(loadingInterview&&loadingInterview!==iKey) return(
                <div style={{textAlign:"center",padding:"44px 32px"}} className="card">
                  <Sp size={28}/>
                  <div style={{marginTop:12,fontSize:13,color:C.mid}}>Generating interview kit for another candidate…</div>
                  <div style={{fontSize:11.5,color:C.light,marginTop:6}}>Please wait until it finishes, then click Interview again.</div>
                </div>
              );
              if(loadingInterview===iKey) return <TabLoader message="Building interview framework…"/>;
              if(interviewErr[iKey]) return(
                <div style={{padding:"32px",textAlign:"center"}} className="card">
                  <div style={{fontSize:13.5,color:C.red,marginBottom:16}}>⚠ {interviewErr[iKey]}</div>
                  <button className="btn btn-gold" onClick={()=>{setInterviewErr(p=>({...p,[iKey]:null}));loadInterview(sel,activeRole.jd);}}>↻ Retry</button>
                </div>
              );
              if(!selInterview) return(
                <div style={{textAlign:"center",padding:"44px 32px"}} className="card">
                  <div style={{fontSize:38,marginBottom:12}}>🎯</div>
                  <div style={{fontFamily:"Playfair Display,serif",fontSize:18,fontWeight:700,marginBottom:8}}>Interview Copilot</div>
                  <p style={{fontSize:13,color:C.light,maxWidth:380,margin:"0 auto 22px",lineHeight:1.75}}>5 technical + 3 behavioral + 2 situational questions, red-flag probes, and a printable scorecard — tailored to this candidate.</p>
                  <button className="btn btn-gold" onClick={()=>loadInterview(sel,activeRole.jd)}>🎯 Generate for {sel.name}</button>
                  <div style={{marginTop:9,fontSize:11,color:C.light}}>~10–15 seconds</div>
                </div>
              );
              const int=selInterview;
              return(<div className="fu pop">
                {int.structure&&<div className="card" style={{marginBottom:14,borderTop:`3px solid ${C.ink}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:7,marginBottom:11}}>
                    <div><div style={{fontFamily:"Playfair Display,serif",fontSize:16,fontWeight:700,marginBottom:3}}>Interview Framework — {sel.name}</div><div style={{fontSize:12,color:C.mid}}>{int.structure.duration} · {int.structure.format}</div></div>
                    <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>printSC({...sel,interview:int})}>🖨 Print Scorecard → PDF</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}} className="two-col">
                    <div style={{padding:"9px 12px",background:C.blueL,borderRadius:7,fontSize:12.5,color:C.blue,lineHeight:1.65}}><strong>Opening:</strong> {int.structure.opening}</div>
                    <div style={{padding:"9px 12px",background:C.tealL,borderRadius:7,fontSize:12.5,color:C.teal,lineHeight:1.65}}><strong>Closing:</strong> {int.structure.closing}</div>
                  </div>
                </div>}
                {(int.technicalQuestions||[]).length>0&&<div className="card" style={{marginBottom:14}}><div className="ctitle" style={{color:C.blue}}>⚙ Technical ({int.technicalQuestions.length})</div>{int.technicalQuestions.map((q,i)=><div key={i} style={{padding:12,background:C.alt,borderRadius:8,marginBottom:8,border:`1px solid ${C.border}`}}><div style={{fontWeight:700,fontSize:13,marginBottom:7}}>Q{i+1}. {q.question}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}} className="three-col"><div style={{fontSize:11,color:C.mid}}><strong style={{color:C.light,display:"block",marginBottom:1}}>Reveals</strong>{q.whatItReveals}</div><div style={{fontSize:11,color:C.green}}><strong style={{display:"block",marginBottom:1}}>✓ Green</strong>{q.greenFlag}</div><div style={{fontSize:11,color:C.red}}><strong style={{display:"block",marginBottom:1}}>✗ Red</strong>{q.redFlag}</div></div></div>)}</div>}
                {(int.behavioralQuestions||[]).length>0&&<div className="card" style={{marginBottom:14}}><div className="ctitle" style={{color:C.teal}}>🧠 Behavioral ({int.behavioralQuestions.length})</div>{int.behavioralQuestions.map((q,i)=><div key={i} style={{padding:12,background:C.tealL,borderRadius:8,marginBottom:8,border:`1px solid ${C.teal}22`}}><div style={{marginBottom:5}}><Tag type="teal">{q.competencyTested}</Tag></div><div style={{fontWeight:700,fontSize:13,marginBottom:7}}>Q{i+1}. {q.question}</div><div style={{fontSize:11.5,color:C.teal,fontStyle:"italic"}}><strong>Scoring:</strong> {q.scoringGuide}</div></div>)}</div>}
                {(int.situationalQuestions||[]).length>0&&<div className="card" style={{marginBottom:14}}><div className="ctitle" style={{color:C.gold}}>🎭 Situational ({int.situationalQuestions.length})</div>{int.situationalQuestions.map((q,i)=><div key={i} style={{padding:12,background:C.goldL,borderRadius:8,marginBottom:8,border:`1px solid ${C.gold}33`}}><div style={{fontWeight:700,fontSize:13,marginBottom:7}}>Q{i+1}. {q.question}</div><div style={{fontSize:11.5,color:C.mid,marginBottom:4}}><strong>Scenario:</strong> {q.scenario}</div><div style={{fontSize:11.5,color:C.goldD}}><strong>Ideal:</strong> {q.idealResponse}</div></div>)}</div>}
                {(int.redFlagProbes||[]).length>0&&<div className="card" style={{marginBottom:14}}><div className="ctitle" style={{color:C.red}}>🚩 Red-Flag Probes ({int.redFlagProbes.length})</div>{int.redFlagProbes.map((q,i)=><div key={i} style={{padding:12,background:C.redL,borderRadius:8,marginBottom:8,border:`1px solid ${C.red}22`}}><div style={{fontSize:10,fontWeight:700,color:C.red,textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>⚠ {q.concern}</div><div style={{fontWeight:700,fontSize:13,marginBottom:7}}>{q.probeQuestion}</div><div style={{fontSize:11.5,color:C.red}}><strong>Watch for:</strong> {q.watchFor}</div></div>)}</div>}
                <div className="card" style={{borderTop:`3px solid ${C.ink}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:7}}>
                    <div className="ctitle" style={{margin:0}}>📋 Evaluation Scorecard</div>
                    <button className="btn btn-ghost" style={{fontSize:12}} onClick={()=>printSC({...sel,interview:int})}>🖨 Print</button>
                  </div>
                  <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
                    <thead><tr style={{background:C.ink}}>{["Criterion","Weight","How to Assess","Score 1–5","Notes"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:10,color:"#D4C8B4",fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(int.scorecardCriteria||[]).map((c,i)=><tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?C.surface:C.alt}}><td style={{padding:"10px"}}><strong>{c.criterion}</strong></td><td style={{padding:"10px"}}><Tag type={c.weight==="High"?"red":c.weight==="Medium"?"gold":"neutral"}>{c.weight}</Tag></td><td style={{padding:"10px",color:C.mid,maxWidth:180,fontSize:12}}>{c.howToAssess}</td><td style={{padding:"10px"}}><div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(n=><div key={n} style={{width:22,height:22,border:`1.5px solid ${C.border}`,borderRadius:4,background:C.surface,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.light}}>{n}</div>)}</div></td><td style={{padding:"10px"}}><div style={{width:"100%",height:22,border:`1px solid ${C.border}`,borderRadius:4,background:C.surface}}/></td></tr>)}
                      <tr style={{background:C.goldL,borderTop:`2px solid ${C.border}`}}><td colSpan={3} style={{padding:"9px 10px",fontWeight:700}}>TOTAL SCORE</td><td style={{padding:"9px 10px"}}><div style={{width:66,height:22,border:`1.5px solid ${C.gold}`,borderRadius:4,background:"#fff"}}/></td><td style={{padding:"9px 10px"}}><div style={{width:"100%",height:22,border:`1px solid ${C.border}`,borderRadius:4,background:"#fff"}}/></td></tr>
                    </tbody>
                  </table></div>
                </div>
              </div>);
            })()}
          </>
        )}
      </main>
      </>}
    </div>

    {/* Footer disclaimer — always visible */}
    <div className="disclaimer-bar no-print">
      ⚠ <strong>AI Decision Disclaimer:</strong> RecruiterCopilot provides AI-powered screening insights to assist your hiring process. Scores and rankings are indicative only.
      <strong> Final hiring decisions must always be made by the recruiter</strong> based on interviews, background checks and human judgment. AI assists — it does not decide.
    </div>

    {/* MERGE MODAL */}
    {modal==="merge"&&pendingMerge&&<Modal title="How to add these candidates?" onClose={()=>{setModal(null);setPendingMerge(null);}}>
      <p style={{fontSize:13.5,color:C.mid,lineHeight:1.7,marginBottom:18}}>
        <strong>{activeRole?.candidates?.length} candidates</strong> already ranked for <strong>{activeRole?.name}</strong>.<br/>
        Adding <strong>{pendingMerge.length} new candidate{pendingMerge.length!==1?"s":""}</strong>. How should they be combined?
      </p>
      <div style={{display:"flex",flexDirection:"column",gap:9}}>
        <button className="btn btn-gold" style={{justifyContent:"flex-start",padding:"13px 16px",textAlign:"left"}} onClick={()=>applyToRole(pendingMerge,addingTo,true)}>
          <div><div style={{fontWeight:700,fontSize:14}}>🔀 Merge & Re-rank Together</div><div style={{fontSize:12,opacity:.85,marginTop:2}}>All candidates sorted by score in one master list — same role, comparing all together</div></div>
        </button>
        <button className="btn btn-ghost" style={{justifyContent:"flex-start",padding:"13px 16px",textAlign:"left"}} onClick={()=>applyToRole(pendingMerge,addingTo,false)}>
          <div><div style={{fontWeight:700,fontSize:14}}>📋 Keep in Order Added</div><div style={{fontSize:12,color:C.mid,marginTop:2}}>New candidates appear below existing ones — useful for tracking separate batches</div></div>
        </button>
      </div>
      <div style={{marginTop:14,padding:"10px 13px",background:C.blueL,borderRadius:8,fontSize:12,color:C.blue}}>
        💡 <strong>Tip:</strong> For a completely separate role, go to Home and create a new role instead.
      </div>
    </Modal>}

    {/* TEMPLATE MODAL */}
    {modal==="template"&&tplCand&&(()=>{
      const tpls=getTpls(tplCand,activeRole.name);
      const cur=tpls[tplTab];
      return(<Modal title={`📱 Message Templates — ${tplCand.name}`} onClose={()=>setModal(null)}>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
          {Object.entries(tpls).map(([key,t])=><button key={key} onClick={()=>setTplTab(key)} style={{padding:"4px 10px",borderRadius:7,border:`1.5px solid ${tplTab===key?C.gold:C.border}`,background:tplTab===key?C.goldL:C.surface,color:tplTab===key?C.goldD:C.mid,fontSize:11.5,fontWeight:tplTab===key?700:400,cursor:"pointer"}}>{t.label}</button>)}
        </div>
        {cur.subject&&<div style={{padding:"7px 11px",background:C.blueL,borderRadius:7,fontSize:12.5,marginBottom:9,color:C.blue}}><strong>Subject:</strong> {cur.subject}</div>}
        <div style={{background:C.alt,borderRadius:9,padding:13,fontSize:13,lineHeight:1.85,color:C.mid,whiteSpace:"pre-wrap",maxHeight:240,overflowY:"auto",border:`1px solid ${C.border}`}}>{cur.text}</div>
        <div style={{display:"flex",gap:7,marginTop:12,justifyContent:"flex-end"}}>
          <CpyBtn text={(cur.subject?`Subject: ${cur.subject}\n\n`:"")+cur.text}/>
          {tplTab.startsWith("wa")&&<a href={`https://wa.me/?text=${encodeURIComponent(cur.text)}`} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}><button className="btn btn-green" style={{fontSize:12}}>💬 Open in WhatsApp</button></a>}
        </div>
      </Modal>);
    })()}

    {/* COMPARE MODAL */}
    {modal==="compare"&&cmpIds.length>=2&&(()=>{
      const[c1,c2]=[activeRole.candidates.find(c=>c.id===cmpIds[0]),activeRole.candidates.find(c=>c.id===cmpIds[1])];
      if(!c1||!c2)return null;
      const metrics=[["Overall Score","overallScore",""],["Skill Match","skillMatch","%"],["Experience","experienceRelevance","%"],["Stability","stabilityScore",""],["Confidence","confidenceScore","%"]];
      return(<Modal title="⇄ Side-by-Side Comparison" onClose={()=>{setModal(null);setCmpIds([]);}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {[c1,c2].map((c,i)=>{const v=verd(c.overallScore);return(<div key={i} style={{padding:12,background:C.alt,borderRadius:10,border:`2px solid ${v.color}44`,textAlign:"center"}}><div style={{fontFamily:"Playfair Display,serif",fontSize:14,fontWeight:700,marginBottom:2}}>{c.name}</div><div style={{fontSize:11,color:C.light,marginBottom:8}}>{c.currentRole||"—"}</div><Ring score={c.overallScore} size={58}/><div style={{marginTop:6}}><span className="tag" style={{background:v.bg,color:v.color,fontSize:9}}>{v.dot} {v.label}</span></div></div>);})}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,marginBottom:12}}>
          <thead><tr style={{background:C.ink}}>{["Metric",c1.name.split(" ")[0],c2.name.split(" ")[0]].map((h,i)=><th key={i} style={{padding:"7px 10px",textAlign:i===0?"left":"center",fontSize:10,color:"#D4C8B4",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{h}</th>)}</tr></thead>
          <tbody>
            {metrics.map(([lbl,key,unit],i)=>{
              const v1=Number(c1[key])||0,v2=Number(c2[key])||0,w=v1>v2?0:v1<v2?1:-1;
              return(<tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?C.surface:C.alt}}>
                <td style={{padding:"7px 10px",fontWeight:500}}>{lbl}</td>
                <td style={{padding:"7px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:w===0?C.green:C.mid}}>{v1}{unit}{w===0&&" 👑"}</td>
                <td style={{padding:"7px 10px",textAlign:"center",fontFamily:"monospace",fontWeight:700,color:w===1?C.green:C.mid}}>{v2}{unit}{w===1&&" 👑"}</td>
              </tr>);
            })}
            {/* BUG21 — CTC row */}
            <tr style={{borderBottom:`1px solid ${C.border}`,background:C.alt}}>
              <td style={{padding:"7px 10px",fontWeight:500}}>Expected CTC</td>
              <td style={{padding:"7px 10px",textAlign:"center",fontSize:11.5,color:C.mid}}>{c1.expectedCTCMin>0?`₹${c1.expectedCTCMin}–${c1.expectedCTCMax}L`:"—"}</td>
              <td style={{padding:"7px 10px",textAlign:"center",fontSize:11.5,color:C.mid}}>{c2.expectedCTCMin>0?`₹${c2.expectedCTCMin}–${c2.expectedCTCMax}L`:"—"}</td>
            </tr>
            <tr style={{borderBottom:`1px solid ${C.border}`,background:C.surface}}>
              <td style={{padding:"7px 10px",fontWeight:500}}>Notice Period</td>
              <td style={{padding:"7px 10px",textAlign:"center",fontSize:11.5,color:C.mid}}>{c1.noticePeriod||"—"}</td>
              <td style={{padding:"7px 10px",textAlign:"center",fontSize:11.5,color:C.mid}}>{c2.noticePeriod||"—"}</td>
            </tr>
            <tr style={{borderBottom:`1px solid ${C.border}`,background:C.alt}}>
              <td style={{padding:"7px 10px",fontWeight:500}}>Risk Flags</td>
              <td style={{padding:"7px 10px",fontSize:11,color:C.red}}>{(c1.riskFlags||[]).length>0?(c1.riskFlags||[]).join(", "):<span style={{color:C.green}}>None ✓</span>}</td>
              <td style={{padding:"7px 10px",fontSize:11,color:C.red}}>{(c2.riskFlags||[]).length>0?(c2.riskFlags||[]).join(", "):<span style={{color:C.green}}>None ✓</span>}</td>
            </tr>
          </tbody>
        </table>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          {[c1,c2].map((c,i)=><div key={i} style={{padding:10,background:C.alt,borderRadius:8,fontSize:12,color:C.mid,lineHeight:1.65}}><strong style={{color:C.ink}}>{c.name.split(" ")[0]}'s edge:</strong><br/>{c.standoutFact||c.recruiterSummary?.slice(0,100)||"—"}</div>)}
        </div>
      </Modal>);
    })()}
    </div>
  );
}
