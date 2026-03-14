import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";

const DEFAULT_CONFIG = {
  scoringFormat: "stroke", roundsPerCourse: 2, attestRequired: true, scorecardRequired: false,
  useHandicap: true, handicapPct: 100, useSlopeRating: true, maxHandicap: null,
  joinMode: "open", maxPlayers: null, hideScores: false, seasonStart: null, seasonEnd: null,
  googleSheetUrl: null,
  scoresToCount: null, // null = all scores count; number = best N of all submitted scores count
};
const FORMAT_LABELS = { stroke: "Stroke Play", stableford: "Stableford", match: "Match Play", scramble: "Scramble" };

const calcCourseHcp = (idx, slope, par, rating, cfg) => {
  const raw = cfg.useSlopeRating ? (idx * (slope / 113)) + (rating - par) : idx;
  const capped = cfg.maxHandicap ? Math.min(raw, cfg.maxHandicap) : raw;
  return Math.round(capped * (cfg.handicapPct / 100));
};
const calcStableford = (gross, hcp, par) => Math.max(0, 2 + (par - (gross - hcp)));
const toPM = (v, p) => { const d = v - p; return d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`; };
const pmCls = (v, p) => { const d = v - p; return d < 0 ? "under" : d > 0 ? "over" : "even"; };
const ini = (n = "") => n.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const isSeasonActive = (cfg) => {
  if (!cfg.seasonStart && !cfg.seasonEnd) return true;
  const now = new Date();
  if (cfg.seasonStart && new Date(cfg.seasonStart) > now) return false;
  if (cfg.seasonEnd && new Date(cfg.seasonEnd) < now) return false;
  return true;
};
const ghinUrl = (id) => id ? `https://www.ghin.com/golfer/${id}` : null;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#0a0e1a;--navy-card:#161d2e;--navy-border:rgba(255,255,255,0.07);
  --gold:#d4a843;--gold-light:#f0c96a;--gold-dim:rgba(212,168,67,0.15);--gold-border:rgba(212,168,67,0.3);
  --cream:#f0ead8;--cream-dim:#c8bfa8;--white:#faf9f6;
  --green:#4caf7d;--blue:#5b8de8;--red:#e05c5c;--purple:#9b7fe8;
  --font-d:'Cinzel',serif;--font-b:'EB Garamond',Georgia,serif;--r:10px;
}
html,body{height:100%;background:var(--navy);color:var(--cream);font-family:var(--font-b);font-size:16px}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:rgba(212,168,67,.3);border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
@keyframes spin{to{transform:rotate(360deg)}}
.au{animation:fadeUp .4s ease}
.spinner{width:18px;height:18px;border:2px solid rgba(212,168,67,.2);border-top-color:var(--gold);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
.auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--navy);position:relative;overflow:hidden}
.auth-bg::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 50% at 20% 80%,rgba(212,168,67,.07) 0%,transparent 60%),radial-gradient(ellipse 50% 60% at 80% 20%,rgba(91,141,232,.06) 0%,transparent 55%);pointer-events:none}
.gp{position:absolute;inset:0;opacity:.04;background-image:repeating-linear-gradient(0deg,transparent,transparent 30px,rgba(212,168,67,.5) 30px,rgba(212,168,67,.5) 31px),repeating-linear-gradient(90deg,transparent,transparent 30px,rgba(212,168,67,.5) 30px,rgba(212,168,67,.5) 31px);pointer-events:none}
.auth-box{background:var(--navy-card);border:1px solid var(--gold-border);border-radius:16px;padding:48px 40px;width:100%;max-width:400px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.5)}
.auth-title{font-family:var(--font-d);font-size:1.65rem;font-weight:700;color:var(--white);letter-spacing:3px}
.auth-sub{font-size:.9rem;color:var(--cream-dim);font-style:italic;margin-top:4px}
.auth-divider{width:60px;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:16px auto}
.btn-google{width:100%;padding:13px;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1a1a1a;border:none;border-radius:8px;font-size:1rem;font-family:var(--font-b);cursor:pointer;transition:all .2s;font-weight:600}
.btn-google:hover{background:#f5f5f5;transform:translateY(-1px);box-shadow:0 4px 20px rgba(0,0,0,.3)}
.or-divider{display:flex;align-items:center;gap:12px;margin:16px 0}
.or-divider::before,.or-divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}
.or-divider span{font-size:.72rem;color:var(--cream-dim);letter-spacing:1px;text-transform:uppercase;font-family:var(--font-d)}
.auth-toggle{text-align:center;margin-top:14px;font-size:.86rem;color:var(--cream-dim)}
.auth-toggle button{background:none;border:none;color:var(--gold);cursor:pointer;font-size:.86rem;text-decoration:underline;padding:0;font-family:var(--font-b)}
.auth-error{background:rgba(224,92,92,.12);border:1px solid rgba(224,92,92,.3);color:#f09090;border-radius:8px;padding:9px 13px;font-size:.86rem;text-align:center;margin-bottom:12px}
.auth-success{background:rgba(76,175,125,.1);border:1px solid rgba(76,175,125,.25);color:#6ee7a0;border-radius:8px;padding:9px 13px;font-size:.86rem;text-align:center;margin-bottom:12px}
.forgot-pw{font-size:.76rem;color:var(--cream-dim);text-align:right;cursor:pointer;display:block;background:none;border:none;width:100%;margin-top:-4px}
.forgot-pw:hover{color:var(--gold)}
.league-picker{max-width:600px;margin:0 auto;padding:40px 16px}
.league-card{background:var(--navy-card);border:1px solid var(--navy-border);border-radius:var(--r);padding:20px 22px;margin-bottom:12px;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.league-card:hover{border-color:var(--gold-border);background:rgba(212,168,67,.04)}
.league-name{font-family:var(--font-d);font-size:1.05rem;color:var(--white);letter-spacing:1px}
.league-meta{font-size:.8rem;color:var(--cream-dim);margin-top:3px}
.lrole{font-size:.62rem;letter-spacing:1.5px;text-transform:uppercase;padding:2px 8px;border-radius:20px;font-family:var(--font-d)}
.lrole.admin{background:rgba(212,168,67,.15);border:1px solid var(--gold-border);color:var(--gold)}
.lrole.player{background:rgba(255,255,255,.05);border:1px solid var(--navy-border);color:var(--cream-dim)}
.fmt-pip{font-size:.6rem;padding:2px 8px;border-radius:20px;border:1px solid rgba(155,127,232,.3);background:rgba(155,127,232,.1);color:var(--purple);font-family:var(--font-d);letter-spacing:1px;text-transform:uppercase}
.app{max-width:1080px;margin:0 auto;padding:0 16px 60px}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 0 14px;border-bottom:1px solid var(--navy-border);margin-bottom:20px;flex-wrap:wrap;gap:10px}
.brand{display:flex;align-items:center;gap:10px;cursor:pointer}
.brand-name{font-family:var(--font-d);font-size:1.2rem;font-weight:700;letter-spacing:2px;color:var(--white)}
.brand-league{font-size:.68rem;color:var(--gold);letter-spacing:2px;text-transform:uppercase;display:block;margin-top:-2px}
.topbar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),rgba(212,168,67,.25));border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:.7rem;color:var(--gold);font-weight:700;overflow:hidden;flex-shrink:0}
.avatar img{width:100%;height:100%;object-fit:cover}
.avatar.lg{width:40px;height:40px;font-size:.85rem}
.badge-admin{background:rgba(212,168,67,.15);border:1px solid var(--gold-border);color:var(--gold);font-size:.62rem;letter-spacing:1.5px;padding:2px 8px;border-radius:20px;font-family:var(--font-d);text-transform:uppercase}
.user-chip{display:flex;align-items:center;gap:8px;background:var(--navy-card);border:1px solid var(--navy-border);border-radius:40px;padding:5px 12px 5px 5px;cursor:pointer;transition:border-color .2s}
.user-chip:hover{border-color:var(--gold-border)}
.season-bar{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:8px;margin-bottom:14px;font-size:.82rem;flex-wrap:wrap}
.season-bar.active{background:rgba(76,175,125,.08);border:1px solid rgba(76,175,125,.2);color:#6ee7a0}
.season-bar.inactive{background:rgba(224,92,92,.08);border:1px solid rgba(224,92,92,.2);color:#f09090}
.season-bar.upcoming{background:rgba(212,168,67,.08);border:1px solid var(--gold-border);color:var(--gold-light)}
.nav{display:flex;gap:4px;background:var(--navy-card);border:1px solid var(--navy-border);border-radius:50px;padding:4px;margin-bottom:26px;flex-wrap:wrap}
.nav-tab{flex:1;min-width:70px;padding:8px 10px;border:none;border-radius:40px;background:transparent;color:var(--cream-dim);font-family:var(--font-b);font-size:.9rem;cursor:pointer;transition:all .22s;text-align:center;white-space:nowrap}
.nav-tab.active{background:linear-gradient(135deg,var(--gold),var(--gold-light));color:var(--navy);font-weight:600}
.nav-tab:hover:not(.active){color:var(--white)}
.nav-tab.admin-tab:not(.active){border:1px solid var(--gold-border);color:var(--gold)}
.banner{display:flex;background:var(--navy-card);border:1px solid var(--gold-border);border-radius:var(--r);overflow:hidden;margin-bottom:22px;flex-wrap:wrap}
.bstat{flex:1;min-width:80px;padding:16px 18px;border-right:1px solid var(--navy-border);text-align:center}
.bstat:last-child{border-right:none}
.bstat-n{font-family:var(--font-d);font-size:1.8rem;font-weight:700;background:linear-gradient(135deg,var(--gold),var(--gold-light));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.bstat-l{font-size:.66rem;color:var(--cream-dim);letter-spacing:1.5px;text-transform:uppercase;margin-top:3px}
.card{background:var(--navy-card);border:1px solid var(--navy-border);border-radius:var(--r);padding:22px;margin-bottom:18px}
.card-hdr{font-family:var(--font-d);font-size:.95rem;font-weight:600;color:var(--gold);letter-spacing:1.5px;margin-bottom:16px;text-transform:uppercase}
.stabs{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}
.stab{padding:5px 14px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:transparent;color:var(--cream-dim);font-family:var(--font-b);font-size:.88rem;cursor:pointer;transition:all .2s}
.stab.active{border-color:var(--gold);color:var(--gold);background:var(--gold-dim)}
.stab:hover:not(.active){color:var(--white);border-color:rgba(255,255,255,.2)}
.tw{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th{text-align:left;padding:9px 13px;color:var(--gold);font-family:var(--font-d);font-size:.62rem;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid var(--gold-border);font-weight:400}
td{padding:12px 13px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.pname{font-weight:600;color:var(--white)}
.under{color:#6ee7a0}.over{color:#f0826a}.even{color:var(--gold-light)}
.rc{font-family:var(--font-d);width:36px}.r1{color:#ffd700}.r2{color:#c0c0c0}.r3{color:#cd7f32}
.sb{font-family:var(--font-d);font-size:1rem}
.pw{height:5px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--gold-light));transition:width .5s}
.dpill{font-size:.7rem;padding:2px 8px;border-radius:5px;display:inline-flex;align-items:center;gap:3px;margin:2px}
.dpill.done{background:rgba(76,175,125,.15);color:#6ee7a0;border:1px solid rgba(76,175,125,.25)}
.dpill.part{background:rgba(212,168,67,.12);color:var(--gold-light);border:1px solid var(--gold-border)}
.dpill.none{background:rgba(255,255,255,.04);color:#7a6e62;border:1px solid rgba(255,255,255,.08)}
.fgrid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
@media(max-width:560px){.fgrid,.bg2{grid-template-columns:1fr}.bstat{min-width:50%;border-right:none;border-bottom:1px solid var(--navy-border)}}
.fg{display:flex;flex-direction:column;gap:5px}
.fg label{font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:var(--gold);font-family:var(--font-d);font-weight:400}
input[type=text],input[type=email],input[type=number],input[type=date],input[type=url],textarea,select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;color:var(--cream);font-family:var(--font-b);font-size:.92rem;transition:border-color .2s;width:100%;-webkit-appearance:none}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--gold)}
select option{background:#161d2e;color:var(--cream)}
textarea{resize:vertical;min-height:60px}
.btn{padding:10px 22px;border:none;border-radius:8px;font-family:var(--font-d);font-size:.78rem;letter-spacing:1px;cursor:pointer;transition:all .2s}
.btn-gold{background:linear-gradient(135deg,var(--gold),var(--gold-light));color:var(--navy);font-weight:700}
.btn-gold:hover{filter:brightness(1.08);transform:translateY(-1px)}
.btn-gold:disabled{opacity:.35;cursor:not-allowed;transform:none;filter:none}
.btn-ghost{background:transparent;color:var(--gold);border:1px solid var(--gold-border)}
.btn-ghost:hover{background:var(--gold-dim)}
.btn-danger{background:rgba(224,92,92,.15);color:#f09090;border:1px solid rgba(224,92,92,.3);font-size:.75rem;padding:5px 11px}
.btn-danger:hover{background:rgba(224,92,92,.25)}
.btn-sm{padding:6px 13px;font-size:.72rem}
.ab{display:inline-flex;align-items:center;gap:3px;font-size:.7rem;padding:2px 8px;border-radius:5px;white-space:nowrap}
.ab.pending{background:rgba(212,168,67,.12);color:var(--gold-light);border:1px solid var(--gold-border)}
.ab.approved{background:rgba(76,175,125,.15);color:#6ee7a0;border:1px solid rgba(76,175,125,.25)}
.ab.rejected{background:rgba(224,92,92,.12);color:#f09090;border:1px solid rgba(224,92,92,.25)}
.ab.auto{background:rgba(255,255,255,.05);color:var(--cream-dim);border:1px solid var(--navy-border)}
.upload-zone{border:2px dashed rgba(212,168,67,.3);border-radius:10px;padding:18px;text-align:center;cursor:pointer;transition:all .2s;margin-top:6px;background:rgba(212,168,67,.03)}
.upload-zone:hover{border-color:var(--gold);background:var(--gold-dim)}
.sc-thumb{position:relative;display:inline-block;margin-top:8px}
.sc-thumb img{max-width:100%;max-height:180px;border-radius:8px;border:1px solid var(--gold-border);display:block}
.sc-del{position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;background:rgba(224,92,92,.9);color:#fff;border:none;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center}
.sc-btn{display:inline-flex;align-items:center;gap:4px;font-size:.7rem;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid rgba(76,175,125,.25);background:rgba(76,175,125,.15);color:#6ee7a0;transition:all .2s}
.sc-btn:hover{background:rgba(76,175,125,.25)}
.alert-s{background:rgba(76,175,125,.1);border:1px solid rgba(76,175,125,.25);color:#6ee7a0;border-radius:8px;padding:9px 14px;font-size:.88rem}
.alert-d{background:rgba(224,92,92,.1);border:1px solid rgba(224,92,92,.25);color:#f09090;border-radius:8px;padding:9px 14px;font-size:.88rem}
.alert-w{background:rgba(212,168,67,.1);border:1px solid var(--gold-border);color:var(--gold-light);border-radius:8px;padding:9px 14px;font-size:.88rem}
.empty{text-align:center;padding:36px 20px;color:#6b7280;font-style:italic}
.note{font-size:.76rem;color:#6b7280;font-style:italic;margin-top:6px}
.pchip{display:flex;align-items:center;gap:10px;padding:11px 13px;background:rgba(255,255,255,.03);border:1px solid var(--navy-border);border-radius:8px;margin-bottom:7px;transition:border-color .2s;flex-wrap:wrap}
.pchip:hover{border-color:rgba(212,168,67,.2)}
.pchip-info{flex:1;min-width:0}
.pchip-name{font-weight:600;color:var(--white);font-size:.92rem}
.pchip-meta{font-size:.76rem;color:var(--cream-dim);margin-top:2px}
.pchip-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:200;animation:fadeIn .2s}
.modal{background:var(--navy-card);border:1px solid var(--gold-border);border-radius:14px;padding:30px;width:100%;max-width:520px;margin:16px;box-shadow:0 24px 80px rgba(0,0,0,.5);animation:fadeUp .25s ease;max-height:90vh;overflow-y:auto}
.modal-title{font-family:var(--font-d);font-size:1rem;color:var(--gold);letter-spacing:2px;margin-bottom:18px;text-transform:uppercase}
.invite-box{background:var(--gold-dim);border:1px solid var(--gold-border);border-radius:8px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.invite-code{font-family:var(--font-d);font-size:1.3rem;letter-spacing:4px;color:var(--gold)}
.cfg-section{margin-bottom:26px}
.cfg-section-title{font-family:var(--font-d);font-size:.76rem;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid var(--navy-border)}
.cfg-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04);gap:16px}
.cfg-row:last-child{border-bottom:none}
.cfg-label{font-size:.92rem;color:var(--cream)}
.cfg-desc{font-size:.75rem;color:var(--cream-dim);margin-top:2px;font-style:italic}
.format-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.format-btn{padding:11px 14px;border:1px solid var(--navy-border);border-radius:8px;background:transparent;color:var(--cream-dim);font-family:var(--font-b);font-size:.9rem;cursor:pointer;transition:all .2s;text-align:left}
.format-btn.sel{border-color:var(--gold);background:var(--gold-dim);color:var(--white)}
.format-btn:hover:not(.sel){border-color:rgba(212,168,67,.3);color:var(--cream)}
.format-name{font-weight:600;display:block}
.format-hint{font-size:.72rem;opacity:.65;font-style:italic}
.toggle{position:relative;width:44px;height:24px;flex-shrink:0;display:inline-block}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;inset:0;background:rgba(255,255,255,.1);border-radius:24px;cursor:pointer;transition:all .25s;border:1px solid rgba(255,255,255,.12)}
.toggle-slider::before{content:'';position:absolute;width:18px;height:18px;left:2px;top:2px;background:var(--cream-dim);border-radius:50%;transition:all .25s}
.toggle input:checked+.toggle-slider{background:var(--gold);border-color:var(--gold)}
.toggle input:checked+.toggle-slider::before{transform:translateX(20px);background:var(--navy)}
.hcp-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(91,141,232,.12);border:1px solid rgba(91,141,232,.25);border-radius:6px;padding:3px 9px;font-size:.78rem;color:#9ab8f0}
.ghin-link{display:inline-flex;align-items:center;gap:4px;font-size:.72rem;color:var(--gold);text-decoration:none;border:1px solid var(--gold-border);border-radius:5px;padding:2px 8px;transition:all .2s}
.ghin-link:hover{background:var(--gold-dim)}
.ai-reading{display:flex;align-items:center;gap:8px;background:rgba(155,127,232,.08);border:1px solid rgba(155,127,232,.2);border-radius:8px;padding:10px 14px;font-size:.84rem;color:#c4b0f8;margin-top:8px}
.player-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.player-card{background:rgba(255,255,255,.03);border:1px solid var(--navy-border);border-radius:10px;padding:16px;text-align:center;transition:border-color .2s}
.player-card:hover{border-color:var(--gold-border)}
.player-card-avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dim),rgba(212,168,67,.25));border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;font-family:var(--font-d);font-size:1rem;color:var(--gold);font-weight:700;margin:0 auto 10px;overflow:hidden}
.player-card-avatar img{width:100%;height:100%;object-fit:cover}
.player-card-name{font-weight:600;color:var(--white);font-size:.92rem;margin-bottom:4px}
.player-card-meta{font-size:.76rem;color:var(--cream-dim)}
.gs-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(76,175,125,.1);border:1px solid rgba(76,175,125,.25);border-radius:6px;padding:4px 10px;font-size:.76rem;color:#6ee7a0;text-decoration:none;transition:all .2s}
.gs-badge:hover{background:rgba(76,175,125,.2)}
`;

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [myMemberships, setMyMemberships] = useState([]);
  const [activeLeague, setActiveLeague] = useState(null);
  const [activeMembership, setActiveMembership] = useState(null);
  const [courses, setCourses] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [members, setMembers] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [payouts, setPayouts] = useState({});
  const [pendingJoins, setPendingJoins] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  // ui
  const [tab, setTab] = useState("leaderboard");
  const [leaderTab, setLeaderTab] = useState("overall");
  const [adminTab, setAdminTab] = useState("config");
  const [selCourse, setSelCourse] = useState(null);
  const [form, setForm] = useState({ courseId: "", score: "", attesterId: "", date: new Date().toISOString().split("T")[0] });
  const [formMsg, setFormMsg] = useState({ type: "", text: "" });
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [aiReading, setAiReading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [viewCardModal, setViewCardModal] = useState(null);
  const [showCreateLeague, setShowCreateLeague] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "" });
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState({ text: "", ok: true });
  const [addMsg, setAddMsg] = useState("");
  const [newCourse, setNewCourse] = useState({ name: "", par: "", holes: "18", slope: "", rating: "" });
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [payoutEdit, setPayoutEdit] = useState(false);
  const [payoutDraft, setPayoutDraft] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [profileModal, setProfileModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [editMemberHcp, setEditMemberHcp] = useState(null); // { uid, name, handicap, ghin }
  const [playersModal, setPlayersModal] = useState(false);

  // auth
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;

    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setProfile(data));

    loadLeagues();
  }, [session]);

  const loadLeagues = async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from("league_members")
      .select("*, league:leagues(*)")
      .eq("user_id", session.user.id);

    if (error) {
      console.error("Supabase error loading leagues:", error);
      return;
    }

    console.log("League data:", data);

    setMyMemberships(data || []);
    setLeagues((data || []).map(m => m.league).filter(Boolean));
  };

  // ── Auth ──
  const signInWithGoogle = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });
  const signInWithEmail = async () => {
    setAuthError(""); setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) setAuthError(error.message);
  };
  const signUpWithEmail = async () => {
    if (!authName.trim()) { setAuthError("Please enter your name."); return; }
    setAuthError(""); setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: authName.trim() } } });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    if (data?.user && !data.session) setAuthSuccess("Check your email to confirm your account.");
  };
  const sendPasswordReset = async () => {
    if (!authEmail) { setAuthError("Enter your email first."); return; }
    setAuthError(""); setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: window.location.origin + "?reset=true" });
    setAuthLoading(false);
    if (error) setAuthError(error.message); else setAuthSuccess("Password reset email sent!");
  };
  const signOut = async () => { await supabase.auth.signOut(); setActiveLeague(null); setDataLoaded(false); };

  // ── Load league ──
  const loadLeagueData = useCallback(async (league) => {
    setDataLoaded(false);
    const [{ data: c }, { data: r }, { data: m }, { data: s }, { data: pj }] = await Promise.all([
      supabase.from("courses").select("*").eq("league_id", league.id).order("name"),
      supabase.from("rounds").select("*").eq("league_id", league.id).order("created_at", { ascending: false }),
      supabase.from("league_members").select("*, profile:profiles(*)").eq("league_id", league.id),
      supabase.from("league_settings").select("*").eq("league_id", league.id).single(),
      supabase.from("league_join_requests").select("*, profile:profiles(*)").eq("league_id", league.id).eq("status", "pending"),
    ]);
    setCourses(c ?? []); setRounds(r ?? []); setMembers(m ?? []);
    const cfg = { ...DEFAULT_CONFIG, ...(s?.config ?? {}) };
    setConfig(cfg); setPayouts(s?.payouts ?? {}); setPendingJoins(pj ?? []);
    setSelCourse((c ?? [])[0]?.id ?? null);
    setDataLoaded(true);
  }, []);

  const selectLeague = (league) => {
    setActiveMembership(myMemberships.find(m => m.league_id === league.id));
    setActiveLeague(league); setTab("leaderboard");
    loadLeagueData(league);
  };

  // ── League create/join ──
  const createLeague = async () => {
    if (!newLeague.name.trim()) return alert("League name required");

    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        name: newLeague.name.trim(),
        description: newLeague.description,
        owner_id: session.user.id
      })
      .select()
      .single();

    if (error) return alert(error.message);

    // add creator as league admin
    await supabase
      .from("league_members")
      .insert({
        league_id: league.id,
        user_id: session.user.id,
        role: "admin"
      });

    setShowCreate(false);
    setNewLeague({ name: "", description: "" });
    loadLeagues();
  };

  const joinLeague = async () => {
    if (!joinCode.trim()) return;
    const { data: league } = await supabase.from("leagues").select("*").eq("invite_code", joinCode.trim().toLowerCase()).single();
    if (!league) { setJoinMsg({ text: "Invalid invite code.", ok: false }); return; }
    if (myMemberships.find(m => m.league_id === league.id)) { setJoinMsg({ text: "Already in this league.", ok: false }); return; }
    const { data: s } = await supabase.from("league_settings").select("config").eq("league_id", league.id).single();
    const cfg = { ...DEFAULT_CONFIG, ...(s?.config ?? {}) };
    if (cfg.joinMode === "approval") {
      await supabase.from("league_join_requests").insert({ league_id: league.id, user_id: session.user.id });
      setJoinMsg({ text: "Request sent! Waiting for commissioner approval.", ok: true });
    } else {
      await supabase.from("league_members").insert({ league_id: league.id, user_id: session.user.id, role: "player" });
      setJoinMsg({ text: "Joined!", ok: true }); await loadLeagues();
    }
    setJoinCode(""); setTimeout(() => setJoinMsg({ text: "", ok: true }), 4000);
  };

  // ── Join requests ──
  const approveJoin = async (req) => {
    await supabase.from("league_members").insert({ league_id: req.league_id, user_id: req.user_id, role: "player" });
    await supabase.from("league_join_requests").update({ status: "approved" }).eq("id", req.id);
    setPendingJoins(p => p.filter(r => r.id !== req.id));
    setMembers(p => [...p, { user_id: req.user_id, role: "player", profile: req.profile }]);
  };
  const denyJoin = async (req) => {
    await supabase.from("league_join_requests").update({ status: "denied" }).eq("id", req.id);
    setPendingJoins(p => p.filter(r => r.id !== req.id));
  };

  // ── Config ──
  const saveConfig = async (newCfg) => {
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg); setConfigDraft(null);
  };

  // ── Rounds ──
  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const isOpen = isSeasonActive(config);
  const myApprovedOnCourse = (cid) => rounds.filter(r => r.player_id === session?.user.id && r.course_id === cid && (config.attestRequired ? r.attest_status === "approved" : true));
  const canSubmit = () => {
    if (!isOpen || !form.courseId || !form.score) return false;
    if (config.attestRequired && !form.attesterId) return false;
    if (config.scorecardRequired && !cardFile) return false;
    return myApprovedOnCourse(Number(form.courseId)).length < config.roundsPerCourse;
  };

  // Auto-calc net when course/score changes
  const selectedCourse = courses.find(c => c.id === Number(form.courseId));
  const autoHcp = selectedCourse && config.useHandicap ? calcCourseHcp(profile?.handicap ?? 0, selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config) : 0;
  const autoNet = form.score ? Number(form.score) - autoHcp : null;
  const autoPts = (autoNet !== null && config.scoringFormat === "stableford" && selectedCourse) ? calcStableford(Number(form.score), autoHcp, selectedCourse.par) : null;

  const submitRound = async () => {
    if (!canSubmit()) return;
    const course = selectedCourse;
    const hcp = autoHcp;
    const gross = Number(form.score);
    const net = gross - hcp;
    const pts = config.scoringFormat === "stableford" ? calcStableford(gross, hcp, course.par) : null;
    const attester = config.attestRequired ? members.find(m => m.user_id === form.attesterId) : null;

    const { data: inserted, error } = await supabase.from("rounds").insert({
      league_id: activeLeague.id, player_id: session.user.id, player_name: profile.name,
      attester_id: attester?.user_id ?? null, attester_name: attester?.profile.name ?? null,
      attester_email: attester?.profile.email ?? null,
      course_id: course.id, course_name: course.name,
      gross, net, stableford_pts: pts, course_handicap: hcp, par: course.par,
      date: form.date, scoring_format: config.scoringFormat,
      attest_status: config.attestRequired ? "pending" : "approved",
    }).select().single();

    if (error || !inserted) { setFormMsg({ type: "d", text: "Error saving round." }); return; }

    if (cardFile) {
      const ext = cardFile.name.split(".").pop();
      await supabase.storage.from("scorecards").upload(`scorecards/${inserted.id}.${ext}`, cardFile, { upsert: true });
      const { data: urlData } = supabase.storage.from("scorecards").getPublicUrl(`scorecards/${inserted.id}.${ext}`);
      await supabase.from("rounds").update({ scorecard_url: urlData.publicUrl }).eq("id", inserted.id);
      inserted.scorecard_url = urlData.publicUrl;
    }

    if (config.attestRequired && attester) {
      try {
        await supabase.functions.invoke("attest-score-email", { body: { attesterEmail: attester.profile.email, attesterName: attester.profile.name, playerName: profile.name, courseName: course.name, gross, net, par: course.par, date: form.date, leagueName: activeLeague.name, token: inserted.attest_token, appUrl: window.location.origin } });
      } catch (e) { console.warn("Email non-fatal:", e); }
    }

    setRounds(p => [inserted, ...p]);
    setForm(f => ({ ...f, score: "", courseId: "", attesterId: "" }));
    setCardFile(null); setCardPreview(null); setAiResult(null);
    setFormMsg({ type: "s", text: config.attestRequired ? `Submitted! Attestation sent to ${attester.profile.name}.` : "Round submitted and approved!" });
    setTimeout(() => setFormMsg({ type: "", text: "" }), 5000);
  };

  // ── Scorecard AI reading ──
  const readScorecardWithAI = async (file) => {
    if (!file) return;
    setAiReading(true); setAiResult(null);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          messages: [{
            role: "user", content: [
              { type: "image", source: { type: "base64", media_type: file.type, data: b64 } },
              { type: "text", text: 'This is a golf scorecard. Extract the total gross score and the date played. Respond ONLY with valid JSON like: {"gross": 84, "date": "2025-05-10"}. If you cannot read the score clearly, return {"gross": null, "date": null}. Do not include any other text.' }
            ]
          }]
        })
      });
      const data = await resp.json();
      const text = data.content?.find(b => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      setAiResult(parsed);
      if (parsed.gross) setForm(f => ({ ...f, score: String(parsed.gross), date: parsed.date || f.date }));
    } catch (e) {
      console.warn("AI scorecard read failed:", e);
      setAiResult({ error: true });
    }
    setAiReading(false);
  };

  // ── Admin ──
  const addCourse = async () => {
    if (!newCourse.name || !newCourse.par || !newCourse.slope || !newCourse.rating) return;
    const { data } = await supabase.from("courses").insert({ league_id: activeLeague.id, ...newCourse, par: Number(newCourse.par), holes: Number(newCourse.holes), slope: Number(newCourse.slope), rating: Number(newCourse.rating) }).select().single();
    if (data) { setCourses(p => [...p, data]); setNewCourse({ name: "", par: "", holes: "18", slope: "", rating: "" }); setShowAddCourse(false); setAddMsg("Course added!"); setTimeout(() => setAddMsg(""), 3e3); }
  };
  const deleteCourse = async (id) => { await supabase.from("courses").delete().eq("id", id); setCourses(p => p.filter(c => c.id !== id)); };
  const removeMember = async (uid) => { if (uid === session.user.id) return; await supabase.from("league_members").delete().eq("league_id", activeLeague.id).eq("user_id", uid); setMembers(p => p.filter(m => m.user_id !== uid)); };
  const toggleRole = async (uid, cur) => {
    const r = cur === "admin" ? "player" : "admin";
    await supabase.from("league_members").update({ role: r }).eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.map(m => m.user_id === uid ? { ...m, role: r } : m));
    if (uid === session.user.id) setActiveMembership(a => ({ ...a, role: r }));
  };
  const deleteRound = async (id) => { await supabase.from("rounds").delete().eq("id", id); setRounds(p => p.filter(r => r.id !== id)); };
  const clearAllRounds = async () => { if (!window.confirm("Clear ALL rounds?")) return; await supabase.from("rounds").delete().eq("league_id", activeLeague.id); setRounds([]); };
  const savePayouts = async (p) => { await supabase.from("league_settings").upsert({ league_id: activeLeague.id, payouts: p, config }, { onConflict: "league_id" }); setPayouts(p); setPayoutEdit(false); };

  // Commissioner update member handicap
  const saveMemberHcp = async () => {
    if (!editMemberHcp) return;
    await supabase.from("profiles").update({ handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin }).eq("id", editMemberHcp.uid);
    setMembers(p => p.map(m => m.user_id === editMemberHcp.uid ? { ...m, profile: { ...m.profile, handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin } } : m));
    setEditMemberHcp(null);
  };

  // ── Profile ──
  const saveProfile = async () => {
    await supabase.from("profiles").update({ name: profileDraft.name, handicap: Number(profileDraft.handicap), ghin: profileDraft.ghin }).eq("id", session.user.id);
    setProfile(p => ({ ...p, ...profileDraft, handicap: Number(profileDraft.handicap) }));
    setProfileModal(false);
  };

  // ── Scorecard ──
  const handleCardFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) { alert("Max 10 MB"); return; }
    setCardFile(file); setCardPreview(URL.createObjectURL(file));
    readScorecardWithAI(file);
  };
  const uploadScorecardToRound = async (rid, file) => {
    const ext = file.name.split(".").pop();
    await supabase.storage.from("scorecards").upload(`scorecards/${rid}.${ext}`, file, { upsert: true });
    const { data: u } = supabase.storage.from("scorecards").getPublicUrl(`scorecards/${rid}.${ext}`);
    await supabase.from("rounds").update({ scorecard_url: u.publicUrl }).eq("id", rid);
    setRounds(p => p.map(r => r.id === rid ? { ...r, scorecard_url: u.publicUrl } : r));
  };
  const deleteScorecard = async (round) => {
    const path = round.scorecard_url?.split("/scorecards/")[1];
    if (path) await supabase.storage.from("scorecards").remove([`scorecards/${path}`]);
    await supabase.from("rounds").update({ scorecard_url: null }).eq("id", round.id);
    setRounds(p => p.map(r => r.id === round.id ? { ...r, scorecard_url: null } : r));
  };

  // ── Google Sheet export ──
  const exportToGoogleSheet = () => {
    // Build CSV data
    const headers = ["Player", "Course", "Gross", "Net", "Course Handicap", "Par", "Stableford Pts", "Date", "Status"];
    const rows = rounds.map(r => [r.player_name, r.course_name, r.gross, r.net, r.course_handicap, r.par, r.stableford_pts ?? "", r.date, r.attest_status]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${activeLeague.name}-rounds.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Leaderboard ──
  const players = members.map(m => ({ ...m.profile, role: m.role }));
  const scored = rounds.filter(r =>
    !config.attestRequired || r.attest_status === "approved"
  );
  const myHasSubmitted = scored.some(r => r.player_id === session?.user.id);
  const visible = (config.hideScores && !myHasSubmitted) ? scored.filter(r => r.player_id === session?.user.id) : scored;

  // Apply scoresToCount: pick best N scores per player
  const applyBestN = (rounds, n, format) => {
    if (!n || rounds.length <= n) return rounds;
    if (format === "stableford") return [...rounds].sort((a, b) => (b.stableford_pts ?? 0) - (a.stableford_pts ?? 0)).slice(0, n);
    return [...rounds].sort((a, b) => a.net - b.net).slice(0, n);
  };

  const overallLB = useMemo(() => players.map(p => {
    const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null;
    const counting = applyBestN(pr, config.scoresToCount, config.scoringFormat);
    if (config.scoringFormat === "stableford") { const total = counting.reduce((s, r) => s + (r.stableford_pts ?? 0), 0); return { ...p, pr, counting, primary: total, label: `${total} pts`, totalRounds: pr.length, countingRounds: counting.length }; }
    const avg = counting.reduce((s, r) => s + r.net, 0) / counting.length;
    return { ...p, pr, counting, primary: avg, label: avg.toFixed(1), totalRounds: pr.length, countingRounds: counting.length };
  }).filter(Boolean).sort((a, b) => config.scoringFormat === "stableford" ? b.primary - a.primary : a.primary - b.primary),
    [players, visible, config]);

  const grossLB = useMemo(() => players.map(p => { const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null; return { ...p, pr, avg: pr.reduce((s, r) => s + r.gross, 0) / pr.length, totalRounds: pr.length }; }).filter(Boolean).sort((a, b) => a.avg - b.avg), [players, visible]);

  const courseLB = useMemo(() => {
    if (!selCourse) return [];
    const c = courses.find(c => c.id === selCourse);
    return players.map(p => { const cr = visible.filter(r => r.player_id === p.id && r.course_id === selCourse); if (!cr.length) return null; const best = Math.min(...cr.map(r => r.net)); return { ...p, cr, best, avg: (cr.reduce((s, r) => s + r.net, 0) / cr.length).toFixed(1), par: c?.par }; }).filter(Boolean).sort((a, b) => a.best - b.best);
  }, [players, visible, selCourse, courses]);

  const bestNetLB = useMemo(() => players.map(p => { const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null; return { ...p, best: pr.reduce((b, r) => r.net < b.net ? r : b) }; }).filter(Boolean).sort((a, b) => a.best.net - b.best.net), [players, visible]);
  const bestGrossLB = useMemo(() => players.map(p => { const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null; return { ...p, best: pr.reduce((b, r) => r.gross < b.gross ? r : b) }; }).filter(Boolean).sort((a, b) => a.best.gross - b.best.gross), [players, visible]);

  const completionData = useMemo(() => {
    const total = courses.length * config.roundsPerCourse;
    return players.map(p => ({ ...p, cs: courses.map(c => { const played = scored.filter(r => r.player_id === p.id && r.course_id === c.id).length; return { ...c, played, done: played >= config.roundsPerCourse }; }), done: scored.filter(r => r.player_id === p.id).length, total, pct: total ? Math.round(scored.filter(r => r.player_id === p.id).length / total * 100) : 0 }));
  }, [players, scored, courses, config]);

  const approvedCount = scored.length;
  const totalRequired = players.filter(p => p.role === "player" || true).length * courses.length * config.roundsPerCourse;
  const leaguePct = totalRequired ? Math.round(approvedCount / totalRequired * 100) : 0;
  const pendingForMe = rounds.filter(r => r.attester_id === session?.user.id && r.attest_status === "pending");
  const isAdmin = activeMembership?.role === "admin" || activeLeague?.owner_id === session?.user.id;

  // ── Small helpers ──
  const rankEl = (i) => <td className={`rc ${i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : ""}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>;
  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;
  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : "⏳ Pending"}</span>;

  const Toggle = ({ checked, onChange }) => (
    <label className="toggle"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="toggle-slider" /></label>
  );

  const SeasonBar = () => {
    if (!config.seasonStart && !config.seasonEnd) return null;
    const now = new Date(), s = config.seasonStart ? new Date(config.seasonStart) : null, e = config.seasonEnd ? new Date(config.seasonEnd) : null;
    if (s && s > now) return <div className="season-bar upcoming">⏳ Season opens {s.toLocaleDateString()}</div>;
    if (e && e < now) return <div className="season-bar inactive">🏁 Season ended {e.toLocaleDateString()} — submissions closed</div>;
    return <div className="season-bar active">🟢 Season active{e ? ` · ends ${e.toLocaleDateString()}` : ""}</div>;
  };

  const GoogleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );

  // ── Loading ──
  if (session === undefined) return (
    <><style>{CSS}</style>
      <div className="auth-bg"><div className="gp" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: 8 }}>⛳</div>
          <div style={{ color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "3px", fontSize: "1.1rem" }}>GREEK SIDE BUNKER</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
            {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", animation: `pulse 1.2s ease-in-out ${i * .2}s infinite`, opacity: .4 }} />)}
          </div>
        </div>
      </div>
    </>
  );

  // ── Sign In ──
  if (!session) {
    const hk = (e) => { if (e.key === "Enter") authMode === "signup" ? signUpWithEmail() : authMode === "forgot" ? sendPasswordReset() : signInWithEmail(); };
    return (
      <><style>{CSS}</style>
        <div className="auth-bg"><div className="gp" />
          <div className="auth-box au">
            <div style={{ textAlign: "center", marginBottom: 22 }}>
              <div style={{ fontSize: "3rem", marginBottom: 6 }}>⛳</div>
              <div className="auth-title">GREEK SIDE BUNKER</div>
              <div className="auth-sub">Golf League · Season Tracker</div>
              <div className="auth-divider" />
            </div>
            {authError && <div className="auth-error">{authError}</div>}
            {authSuccess && <div className="auth-success">{authSuccess}</div>}
            {authMode !== "forgot" && <button className="btn-google" onClick={signInWithGoogle}><GoogleIcon /> Continue with Google</button>}
            {authMode !== "forgot" && <div className="or-divider"><span>or</span></div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {authMode === "signup" && <div className="fg"><label>Your Name</label><input type="text" placeholder="Jane Smith" value={authName} onChange={e => { setAuthName(e.target.value); setAuthError(""); }} onKeyDown={hk} autoComplete="name" /></div>}
              <div className="fg"><label>Email</label><input type="email" placeholder="you@example.com" value={authEmail} onChange={e => { setAuthEmail(e.target.value); setAuthError(""); setAuthSuccess(""); }} onKeyDown={hk} autoComplete="email" /></div>
              {authMode !== "forgot" && <div className="fg"><label>Password {authMode === "signup" && <span style={{ color: "var(--cream-dim)", fontFamily: "var(--font-b)", textTransform: "none", letterSpacing: 0 }}>(min 6 chars)</span>}</label><input type="password" placeholder={authMode === "signup" ? "Create a password" : "Enter your password"} value={authPassword} onChange={e => { setAuthPassword(e.target.value); setAuthError(""); }} onKeyDown={hk} autoComplete={authMode === "signup" ? "new-password" : "current-password"} /></div>}
              {authMode === "signin" && <button className="forgot-pw" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthSuccess(""); }}>Forgot password?</button>}
            </div>
            <button className="btn btn-gold" style={{ width: "100%", padding: "13px", marginTop: 18 }} onClick={authMode === "signup" ? signUpWithEmail : authMode === "forgot" ? sendPasswordReset : signInWithEmail} disabled={authLoading}>
              {authLoading ? <span className="spinner" /> : authMode === "signup" ? "Create Account" : authMode === "forgot" ? "Send Reset Email" : "Sign In"}
            </button>
            <div className="auth-toggle">
              {authMode === "forgot" ? <span>Remembered it? <button onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSuccess(""); }}>Back to sign in</button></span>
                : authMode === "signin" ? <span>New here? <button onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthSuccess(""); }}>Create an account</button></span>
                  : <span>Already have one? <button onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSuccess(""); }}>Sign in</button></span>}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── League Picker ──
  if (!activeLeague) return (
    <><style>{CSS}</style>
      {profileModal && (
        <div className="modal-bg" onClick={() => setProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">My Profile</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fg"><label>Display Name</label><input type="text" value={profileDraft.name ?? ""} onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))} /></div>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4" value={profileDraft.handicap ?? ""} onChange={e => setProfileDraft(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN # (Handicap ID)</label><input type="text" placeholder="e.g. 1234567" value={profileDraft.ghin ?? ""} onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {profileDraft.ghin && <a href={ghinUrl(profileDraft.ghin)} target="_blank" rel="noreferrer" className="ghin-link">🔗 View GHIN Profile ↗</a>}
              <p className="note">Your handicap index is used to calculate your course handicap for each round. Your GHIN number links to your official USGA handicap record.</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveProfile}>Save</button>
              <button className="btn btn-ghost" onClick={() => setProfileModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ background: "var(--navy)", minHeight: "100vh" }}>
        <div className="league-picker au">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "2rem" }}>⛳</span>
              <div className="auth-title" style={{ fontSize: "1.3rem" }}>GREEK SIDE BUNKER</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div className="avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : ini(profile?.name)}</div>
              <div>
                <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{profile?.name}</div>
                {profile?.handicap != null && <div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>Hcp {profile.handicap}{profile.ghin && <span> · GHIN {profile.ghin}</span>}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin }); setProfileModal(true); }}>Edit Profile</button>
              <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign Out</button>
            </div>
          </div>

          <div style={{ marginBottom: 22 }}>
            <div className="card-hdr" style={{ marginBottom: 12 }}>Your Leagues</div>
            {leagues.length === 0 && <div className="empty">No leagues yet — create one or join with a code below.</div>}
            {leagues.map(l => {
              const m = myMemberships.find(x => x.league_id === l.id);
              return (
                <div key={l.id} className="league-card" onClick={() => selectLeague(l)}>
                  <div><div className="league-name">{l.name}</div>{l.description && <div className="league-meta">{l.description}</div>}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="fmt-pip">{FORMAT_LABELS[l.scoring_format ?? "stroke"]}</span>
                    <span className={`lrole ${m?.role ?? "player"}`}>{m?.role === "admin" ? "Commissioner" : "Player"}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-hdr">Create a League</div>
            {!showCreateLeague ? <button className="btn btn-gold" onClick={() => setShowCreateLeague(true)}>+ New League</button> : (
              <div>
                <div className="fgrid" style={{ marginBottom: 14 }}>
                  <div className="fg" style={{ gridColumn: "1/-1" }}><label>League Name</label><input type="text" placeholder="The Ryder Cup Crew" value={newLeague.name} onChange={e => setNewLeague(l => ({ ...l, name: e.target.value }))} /></div>
                  <div className="fg" style={{ gridColumn: "1/-1" }}><label>Description (optional)</label><input type="text" placeholder="Summer 2025 season" value={newLeague.description} onChange={e => setNewLeague(l => ({ ...l, description: e.target.value }))} /></div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-gold" onClick={createLeague} disabled={!newLeague.name.trim()}>Create</button>
                  <button className="btn btn-ghost" onClick={() => setShowCreateLeague(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-hdr">Join with Invite Code</div>
            <div style={{ display: "flex", gap: 10 }}>
              <input type="text" placeholder="8-character code" value={joinCode} onChange={e => setJoinCode(e.target.value)} style={{ flex: 1 }} onKeyDown={e => e.key === "Enter" && joinLeague()} />
              <button className="btn btn-ghost" onClick={joinLeague}>Join</button>
            </div>
            {joinMsg.text && <p className="note" style={{ color: joinMsg.ok ? "var(--green)" : "#f09090", marginTop: 8 }}>{joinMsg.text}</p>}
          </div>
        </div>
      </div>
    </>
  );

  // ── Main App ──
  return (
    <><style>{CSS}</style>

      {/* Scorecard modal */}
      {viewCardModal && (
        <div className="modal-bg" onClick={() => setViewCardModal(null)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="modal-title" style={{ marginBottom: 0 }}>📋 Scorecard</div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={viewCardModal.url} target="_blank" rel="noreferrer"><button className="btn btn-ghost btn-sm">Full Size ↗</button></a>
                <button className="btn btn-ghost btn-sm" onClick={() => setViewCardModal(null)}>Close</button>
              </div>
            </div>
            <img src={viewCardModal.url} alt="Scorecard" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--gold-border)", display: "block", margin: "0 auto" }} />
          </div>
        </div>
      )}

      {/* Profile modal */}
      {profileModal && (
        <div className="modal-bg" onClick={() => setProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">My Profile</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fg"><label>Display Name</label><input type="text" value={profileDraft.name ?? ""} onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))} /></div>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4" value={profileDraft.handicap ?? ""} onChange={e => setProfileDraft(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN # (Handicap ID)</label><input type="text" placeholder="e.g. 1234567" value={profileDraft.ghin ?? ""} onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {profileDraft.ghin && <a href={ghinUrl(profileDraft.ghin)} target="_blank" rel="noreferrer" className="ghin-link">🔗 View your GHIN Profile ↗</a>}
              <p className="note">Your GHIN number links to your official USGA handicap record at ghin.com.</p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveProfile}>Save</button>
              <button className="btn btn-ghost" onClick={() => setProfileModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit member handicap modal (commissioner) */}
      {editMemberHcp && (
        <div className="modal-bg" onClick={() => setEditMemberHcp(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Edit Handicap — {editMemberHcp.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} value={editMemberHcp.handicap ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN #</label><input type="text" value={editMemberHcp.ghin ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {courses.length > 0 && editMemberHcp.handicap && <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Course Handicaps Preview</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {courses.map(c => {
                    const ch = calcCourseHcp(Number(editMemberHcp.handicap), c.slope, c.par, c.rating, config);
                    return <span key={c.id} className="hcp-badge">{c.name}: <strong>{ch}</strong></span>;
                  })}
                </div>
              </div>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveMemberHcp}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditMemberHcp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Players modal */}
      {playersModal && (
        <div className="modal-bg" onClick={() => setPlayersModal(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">👥 League Players</div>
            <div className="player-card-grid">
              {members.map(m => {
                const courseHcps = courses.map(c => ({ ...c, ch: calcCourseHcp(m.profile.handicap ?? 0, c.slope, c.par, c.rating, config) }));
                return (
                  <div key={m.user_id} className="player-card">
                    <div className="player-card-avatar">{m.profile.avatar_url ? <img src={m.profile.avatar_url} alt="" /> : ini(m.profile.name)}</div>
                    <div className="player-card-name">{m.profile.name}</div>
                    <div className="player-card-meta" style={{ marginBottom: 6 }}>
                      <span className={`lrole ${m.role}`} style={{ fontSize: ".58rem" }}>{m.role === "admin" ? "Commissioner" : "Player"}</span>
                    </div>
                    {config.useHandicap && <div style={{ marginBottom: 6 }}>
                      <span className="hcp-badge">Hcp {m.profile.handicap ?? "-"}</span>
                    </div>}
                    {m.profile.ghin && <a href={ghinUrl(m.profile.ghin)} target="_blank" rel="noreferrer" className="ghin-link" style={{ fontSize: ".68rem", marginBottom: 6, display: "inline-flex" }}>GHIN ↗</a>}
                    {config.useHandicap && courses.length > 0 && <div style={{ marginTop: 6 }}>
                      {courseHcps.map(c => <div key={c.id} style={{ fontSize: ".68rem", color: "var(--cream-dim)", marginTop: 2 }}>{c.name}: <span style={{ color: "var(--white)" }}>{c.ch}</span></div>)}
                    </div>}
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 16, width: "100%" }} onClick={() => setPlayersModal(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="app au">
        {/* Topbar */}
        <div className="topbar">
          <div className="brand" onClick={() => { setActiveLeague(null); setDataLoaded(false); }}>
            <span style={{ fontSize: "1.7rem" }}>⛳</span>
            <div><div className="brand-name">GREEK SIDE BUNKER</div><span className="brand-league">{activeLeague.name}</span></div>
          </div>
          <div className="topbar-right">
            {isAdmin && <span className="badge-admin">Commissioner</span>}
            <span className="fmt-pip">{FORMAT_LABELS[config.scoringFormat]}</span>
            {config.attestRequired && pendingForMe.length > 0 && <button className="btn btn-ghost btn-sm" style={{ color: "var(--gold-light)" }} onClick={() => setTab("score")}>⏳ {pendingForMe.length} to attest</button>}
            {isAdmin && pendingJoins.length > 0 && <button className="btn btn-ghost btn-sm" style={{ color: "var(--purple)" }} onClick={() => { setTab("admin"); setAdminTab("members"); }}>🙋 {pendingJoins.length} join request{pendingJoins.length > 1 ? "s" : ""}</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setPlayersModal(true)}>👥 Players</button>
            <div className="user-chip" onClick={() => { setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin }); setProfileModal(true); }}>
              <div className="avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : ini(profile?.name)}</div>
              <div>
                <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{profile?.name}</div>
                {config.useHandicap && <div style={{ fontSize: ".7rem", color: "var(--cream-dim)" }}>Hcp {profile?.handicap ?? "-"}</div>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign Out</button>
          </div>
        </div>

        <SeasonBar />

        {/* Banner */}
        {dataLoaded && (
          <div className="banner">
            <div className="bstat"><div className="bstat-n">{players.length}</div><div className="bstat-l">Players</div></div>
            <div className="bstat"><div className="bstat-n">{courses.length}</div><div className="bstat-l">Courses</div></div>
            <div className="bstat"><div className="bstat-n">{approvedCount}</div><div className="bstat-l">Rounds</div></div>
            <div className="bstat" style={{ padding: "12px 16px" }}>
              <div className="bstat-n">{leaguePct}%</div><div className="bstat-l">Complete</div>
              <div className="pw" style={{ marginTop: 5 }}><div className="pf" style={{ width: `${leaguePct}%` }} /></div>
            </div>
          </div>
        )}

        {/* Nav */}
        <div className="nav">
          {[["leaderboard", "🏆 Leaderboard"], ["score", "✏️ Post Score"], ...(isAdmin ? [["admin", "⚙ Admin"]] : [])]
            .map(([k, l]) => <button key={k} className={`nav-tab${tab === k ? " active" : ""}${k === "admin" ? " admin-tab" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {!dataLoaded && <div className="empty">Loading…</div>}

        {/* ── LEADERBOARD ── */}
        {tab === "leaderboard" && dataLoaded && <>
          <div className="stabs">
            {[["overall", config.scoringFormat === "stableford" ? "⭐ Stableford" : "🏆 Net Standings"],
            ["gross", "🏌️ Gross"],
            ...(config.scoringFormat !== "match" && config.scoringFormat !== "scramble" ? [["course", "📍 By Course"]] : []),
            ["best", "⭐ Best Rounds"], ["completion", "📋 Completion"], ["payouts", "💰 Payouts"]]
              .map(([k, l]) => <button key={k} className={`stab${leaderTab === k ? " active" : ""}`} onClick={() => setLeaderTab(k)}>{l}</button>)}
          </div>

          {leaderTab === "overall" && <div className="card">
            <div className="card-hdr">{config.scoringFormat === "stableford" ? "⭐ Stableford Standings" : config.scoringFormat === "match" ? "🆚 Match Play" : "🏆 Net Standings"}{!config.useHandicap && <span style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginLeft: 10, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(gross only)</span>}</div>
            {config.hideScores && !myHasSubmitted && <div className="alert-w" style={{ marginBottom: 14 }}>📵 Scores are hidden until you post your own round.</div>}
            {config.scoresToCount && <div className="alert-w" style={{ marginBottom: 14 }}>📊 Best {config.scoresToCount} of all submitted scores count toward standings.</div>}
            {overallLB.length === 0 ? <div className="empty">No {config.attestRequired ? "approved " : ""}rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Player</th>{config.useHandicap && <th>Hcp Idx</th>}<th>Rounds</th>{config.scoresToCount && <th>Counting</th>}<th>{config.scoringFormat === "stableford" ? "Total Pts" : "Avg Net"}</th></tr></thead>
                <tbody>{overallLB.map((p, i) => <tr key={p.id}>
                  {rankEl(i)}
                  <td>
                    <span className="pname">{p.name}</span>
                    {p.ghin && <a href={ghinUrl(p.ghin)} target="_blank" rel="noreferrer" className="ghin-link" style={{ marginLeft: 7, fontSize: ".62rem" }}>GHIN</a>}
                  </td>
                  {config.useHandicap && <td style={{ color: "var(--cream-dim)" }}>{p.handicap}</td>}
                  <td>{p.totalRounds}</td>
                  {config.scoresToCount && <td style={{ color: "var(--gold-light)", fontSize: ".8rem" }}>{p.countingRounds} counting</td>}
                  <td><span className="sb" style={{ color: "var(--gold-light)" }}>{p.label}</span></td>
                </tr>)}</tbody>
              </table></div>
            )}
          </div>}

          {leaderTab === "gross" && <div className="card">
            <div className="card-hdr">🏌️ Gross Standings</div>
            {grossLB.length === 0 ? <div className="empty">No rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Player</th><th>Rounds</th><th>Avg Gross</th><th>Best</th></tr></thead>
                <tbody>{grossLB.map((p, i) => <tr key={p.id}>{rankEl(i)}<td><span className="pname">{p.name}</span></td><td>{p.totalRounds}</td><td><span className="sb" style={{ color: "var(--gold-light)" }}>{p.avg.toFixed(1)}</span></td><td style={{ color: "var(--cream-dim)" }}>{Math.min(...p.pr.map(r => r.gross))}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>}

          {leaderTab === "course" && <div className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ color: "var(--gold)", fontFamily: "var(--font-d)", fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase" }}>Course</span>
              <select value={selCourse || ""} onChange={e => setSelCourse(Number(e.target.value))} style={{ width: "auto", minWidth: 200 }}>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name} · Par {c.par}</option>)}
              </select>
            </div>
            <div className="card-hdr">📍 {courses.find(c => c.id === selCourse)?.name}</div>
            {courseLB.length === 0 ? <div className="empty">No rounds at this course yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Player</th>{config.useHandicap && <th>Course Hcp</th>}<th>Rounds</th><th>Best Net</th><th>Avg Net</th></tr></thead>
                <tbody>{courseLB.map((p, i) => {
                  const ch = config.useHandicap ? calcCourseHcp(p.handicap ?? 0, courses.find(c => c.id === selCourse)?.slope ?? 113, courses.find(c => c.id === selCourse)?.par ?? 72, courses.find(c => c.id === selCourse)?.rating ?? 72, config) : null;
                  return <tr key={p.id}>{rankEl(i)}<td><span className="pname">{p.name}</span></td>{config.useHandicap && <td><span className="hcp-badge">{ch}</span></td>}<td>{p.cr.length}/{config.roundsPerCourse}</td><td>{netEl(p.best, p.par)}</td><td style={{ color: "var(--cream-dim)" }}>{p.avg}</td></tr>;
                })}</tbody>
              </table></div>
            )}
          </div>}

          {leaderTab === "best" && <div className="card">
            <div className="card-hdr">⭐ Best Single Round</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }} className="bg2">
              <div>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Best Net</div>
                {bestNetLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Player</th><th>Course</th><th>Net</th></tr></thead>
                    <tbody>{bestNetLB.map((p, i) => <tr key={p.id}>{rankEl(i)}<td><span className="pname" style={{ fontSize: ".84rem" }}>{p.name}</span></td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{p.best.course_name}</td><td>{netEl(p.best.net, p.best.par)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              <div>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--blue)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Best Gross</div>
                {bestGrossLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Player</th><th>Course</th><th>Gross</th></tr></thead>
                    <tbody>{bestGrossLB.map((p, i) => <tr key={p.id}>{rankEl(i)}<td><span className="pname" style={{ fontSize: ".84rem" }}>{p.name}</span></td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{p.best.course_name}</td><td><span className="sb" style={{ color: "var(--blue)" }}>{p.best.gross}</span></td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
            </div>
          </div>}

          {leaderTab === "completion" && <div className="card">
            <div className="card-hdr">📋 Completion Tracker</div>
            <p className="note" style={{ marginBottom: 14 }}>{config.roundsPerCourse} {config.attestRequired ? "approved " : ""}round{config.roundsPerCourse > 1 ? "s" : ""} per course · {courses.length * config.roundsPerCourse} total required.</p>
            {completionData.map(p => (
              <div key={p.id} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="avatar">{p.avatar_url ? <img src={p.avatar_url} alt="" /> : ini(p.name)}</div>
                    <span className="pname">{p.name}</span>
                    {config.useHandicap && <span className="hcp-badge">Hcp {p.handicap ?? "-"}</span>}
                  </div>
                  <span style={{ fontSize: ".78rem", color: p.pct === 100 ? "var(--green)" : "var(--cream-dim)" }}>{p.done}/{p.total}{p.pct === 100 ? " ✓" : ""}</span>
                </div>
                <div className="pw" style={{ marginBottom: 5 }}><div className="pf" style={{ width: `${p.pct}%` }} /></div>
                <div>{p.cs.map(c => <span key={c.id} className={`dpill ${c.done ? "done" : c.played > 0 ? "part" : "none"}`}>{c.done ? "✓" : `${c.played}/${config.roundsPerCourse}`} {c.name}</span>)}</div>
              </div>
            ))}
          </div>}

          {leaderTab === "payouts" && <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}>💰 Payouts</div>
              {isAdmin && !payoutEdit && <button className="btn btn-ghost btn-sm" onClick={() => { setPayoutDraft({ ...payouts }); setPayoutEdit(true); }}>Edit</button>}
            </div>
            {payoutEdit ? (
              <div>
                <div className="fgrid" style={{ marginBottom: 14 }}>
                  {[["overallNet", "🏆 Overall Net"], ["overallGross", "🏌️ Overall Gross"], ["courseNet", "📍 Per-Course Net"], ["courseGross", "📍 Per-Course Gross"], ["bestNet", "⭐ Best Net Round"], ["bestGross", "⭐ Best Gross Round"]].map(([k, l]) => (
                    <div className="fg" key={k}><label>{l}</label><input type="text" placeholder="e.g. $50" value={payoutDraft?.[k] ?? ""} onChange={e => setPayoutDraft(d => ({ ...d, [k]: e.target.value }))} /></div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-gold" onClick={() => savePayouts(payoutDraft)}>Save</button>
                  <button className="btn btn-ghost" onClick={() => setPayoutEdit(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} className="bg2">
                {[["overallNet", "🏆 Overall Net", overallLB[0]?.name], ["overallGross", "🏌️ Overall Gross", grossLB[0]?.name], ["courseNet", "📍 Per-Course Net", null], ["courseGross", "📍 Per-Course Gross", null], ["bestNet", "⭐ Best Net", bestNetLB[0]?.name], ["bestGross", "⭐ Best Gross", bestGrossLB[0]?.name]].map(([k, l, leader]) => (
                  <div key={k} style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "11px 13px" }}>
                    <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginBottom: 3 }}>{l}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--font-d)", fontSize: "1.05rem", color: "var(--gold)" }}>{payouts?.[k] || <span style={{ color: "#4b5563", fontSize: ".8rem", fontFamily: "var(--font-b)", fontStyle: "italic" }}>Not set</span>}</span>
                      {leader && <span style={{ fontSize: ".75rem", color: "var(--green)" }}>▶ {leader}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>}
        </>}

        {/* ── POST SCORE ── */}
        {tab === "score" && dataLoaded && <>
          {config.attestRequired && pendingForMe.length > 0 && (
            <div className="card" style={{ borderColor: "var(--gold-border)" }}>
              <div className="card-hdr" style={{ color: "var(--gold-light)" }}>⏳ Rounds Awaiting Your Attestation</div>
              <div className="tw"><table>
                <thead><tr><th>Player</th><th>Course</th><th>Date</th><th>Gross</th><th>Net</th><th>Card</th><th>Action</th></tr></thead>
                <tbody>{pendingForMe.map(r => (
                  <tr key={r.id}>
                    <td><span className="pname" style={{ fontSize: ".86rem" }}>{r.player_name}</span></td>
                    <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                    <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                    <td>{r.gross}</td><td>{netEl(r.net, r.par)}</td>
                    <td>{r.scorecard_url ? <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>📋 View</button> : <span style={{ color: "#4b5563", fontSize: ".8rem" }}>None</span>}</td>
                    <td><div style={{ display: "flex", gap: 5 }}>
                      <button className="btn btn-gold btn-sm" onClick={async () => {
                        const { error } = await supabase.from("rounds").update({ attest_status: "approved", attest_at: new Date().toISOString() }).eq("id", r.id);
                        if (error) { alert("Error: " + error.message); return; }
                        setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "approved" } : x));
                      }}>✓ Approve</button>
                      <button className="btn btn-danger" onClick={async () => {
                        const note = window.prompt("Reason for rejection (optional):") || "";
                        const { error } = await supabase.from("rounds").update({ attest_status: "rejected", attest_note: note, attest_at: new Date().toISOString() }).eq("id", r.id);
                        if (error) { alert("Error: " + error.message); return; }
                        setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "rejected", attest_note: note } : x));
                      }}>✗ Reject</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}

          {!isOpen && <div className="alert-d" style={{ marginBottom: 16 }}>⛔ Season is not currently active — score submission is closed.</div>}

          <div className="card" style={{ opacity: isOpen ? 1 : .65, pointerEvents: isOpen ? "auto" : "none" }}>
            <div className="card-hdr">✏️ Post Your Round
              {config.scoringFormat !== "stroke" && <span style={{ fontSize: ".74rem", color: "var(--purple)", marginLeft: 10, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{FORMAT_LABELS[config.scoringFormat]}</span>}
            </div>

            {/* Scorecard upload FIRST so AI can pre-fill */}
            <div className="fg" style={{ marginBottom: 14 }}>
              <label>Scorecard Photo {config.scorecardRequired ? <span style={{ color: "var(--red)" }}>*</span> : <span style={{ color: "var(--cream-dim)", textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-b)" }}>(optional — we'll try to read your score automatically)</span>}</label>
              {!cardPreview ? (
                <div className="upload-zone"
                  onClick={() => document.getElementById("sc-upload").click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleCardFile(e.dataTransfer.files[0]); }}>
                  <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>📷</div>
                  <div style={{ fontSize: ".85rem", color: "var(--cream-dim)" }}>Drop scorecard photo here or <strong style={{ color: "var(--gold)" }}>browse</strong> · JPG PNG · max 10 MB</div>
                  <input id="sc-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleCardFile(e.target.files[0])} />
                </div>
              ) : (
                <div>
                  <div className="sc-thumb"><img src={cardPreview} alt="preview" /><button className="sc-del" onClick={() => { setCardFile(null); setCardPreview(null); setAiResult(null); }}>✕</button></div>
                  {aiReading && <div className="ai-reading"><span className="spinner" /><span>Reading scorecard with AI…</span></div>}
                  {aiResult && !aiReading && (
                    <div className="ai-reading" style={{ background: aiResult.error ? "rgba(224,92,92,.08)" : "rgba(76,175,125,.08)", borderColor: aiResult.error ? "rgba(224,92,92,.2)" : "rgba(76,175,125,.2)", color: aiResult.error ? "#f09090" : "#6ee7a0" }}>
                      {aiResult.error ? "⚠ Couldn't read score — please enter manually."
                        : aiResult.gross ? `✓ Detected score: ${aiResult.gross}${aiResult.date ? ` · Date: ${aiResult.date}` : ""} — fields pre-filled!`
                          : "Score not detected — please enter manually."}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="fgrid">
              <div className="fg"><label>Course</label>
                <select value={form.courseId} onChange={setF("courseId")}>
                  <option value="">Select course…</option>
                  {courses.map(c => {
                    const played = myApprovedOnCourse(c.id).length;
                    const full = played >= config.roundsPerCourse;
                    return <option key={c.id} value={c.id} disabled={full}>{c.name} · Par {c.par}{full ? " ✓" : played > 0 ? ` (${played}/${config.roundsPerCourse})` : ""}</option>;
                  })}
                </select>
              </div>
              {config.attestRequired && (
                <div className="fg"><label>Attested By</label>
                  <select value={form.attesterId} onChange={setF("attesterId")}>
                    <option value="">Select playing partner…</option>
                    {members.filter(m => m.user_id !== session.user.id).map(m => <option key={m.user_id} value={m.user_id}>{m.profile.name}</option>)}
                  </select>
                </div>
              )}
              <div className="fg">
                <label>Gross Score</label>
                <input type="number" min={50} max={200} placeholder="e.g. 88" value={form.score} onChange={setF("score")} />
              </div>
              <div className="fg"><label>Date Played</label><input type="date" value={form.date} onChange={setF("date")} /></div>
            </div>

            {/* Auto net preview */}
            {form.courseId && form.score && (() => {
              const gross = Number(form.score);
              return <div style={{ marginTop: 12, padding: "12px 16px", background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: ".6rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)" }}>Auto-Calculated</span>
                {config.useHandicap && selectedCourse && <>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Course Hcp</span>
                    <span className="hcp-badge" style={{ marginTop: 2 }}>{autoHcp}</span>
                  </div>
                </>}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Gross</span>
                  <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem", color: "var(--cream)" }}>{gross}</span>
                </div>
                {config.useHandicap && autoNet !== null && <>
                  <span style={{ color: "var(--gold-border)", fontSize: "1.2rem" }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Net</span>
                    {selectedCourse ? <span className={`sb ${pmCls(autoNet, selectedCourse.par)}`} style={{ fontSize: "1.2rem" }}>{autoNet} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(autoNet, selectedCourse.par)})</span></span> : <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem" }}>{autoNet}</span>}
                  </div>
                </>}
                {autoPts !== null && <>
                  <span style={{ color: "var(--gold-border)", fontSize: "1.2rem" }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Stableford</span>
                    <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem", color: "var(--purple)" }}>{autoPts} pts</span>
                  </div>
                </>}
                {config.useHandicap && selectedCourse && <span style={{ fontSize: ".74rem", color: "var(--cream-dim)", marginLeft: "auto" }}>Idx {profile?.handicap ?? 0} × {config.handicapPct}%{config.useSlopeRating ? ` · Slope ${selectedCourse.slope}` : ""}</span>}
              </div>;
            })()}

            <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-gold" onClick={submitRound} disabled={!canSubmit()}>Submit Round</button>
              {formMsg.text && <div className={`alert-${formMsg.type}`}>{formMsg.text}</div>}
            </div>
            <p className="note" style={{ marginTop: 8 }}>
              {config.attestRequired ? "An email will be sent to your playing partner to attest this round." : "Rounds are automatically approved (no attestation required)."}
            </p>
          </div>

          {/* My rounds */}
          {rounds.filter(r => r.player_id === session.user.id).length > 0 && (
            <div className="card">
              <div className="card-hdr">My Rounds</div>
              <div className="tw"><table>
                <thead><tr>
                  <th>Course</th><th>Gross</th>
                  {config.useHandicap && <th>Course Hcp</th>}
                  {config.useHandicap && <th>Net</th>}
                  {config.scoringFormat === "stableford" && <th>Pts</th>}
                  <th>Date</th><th>Status</th><th>Scorecard</th>
                </tr></thead>
                <tbody>{rounds.filter(r => r.player_id === session.user.id).map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: ".84rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                    <td>{r.gross}</td>
                    {config.useHandicap && <td><span className="hcp-badge">{r.course_handicap}</span></td>}
                    {config.useHandicap && <td>{netEl(r.net, r.par)}</td>}
                    {config.scoringFormat === "stableford" && <td><span style={{ color: "var(--purple)", fontFamily: "var(--font-d)" }}>{r.stableford_pts ?? "-"}</span></td>}
                    <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                    <td>{attestBadge(r.attest_status)}{r.attest_note && <div style={{ fontSize: ".7rem", color: "#f09090", marginTop: 2 }}>{r.attest_note}</div>}</td>
                    <td>{r.scorecard_url ? (
                      <div style={{ display: "flex", gap: 5 }}>
                        <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>📋</button>
                        <button className="sc-btn" style={{ borderColor: "rgba(224,92,92,.3)", background: "rgba(224,92,92,.1)", color: "#f09090" }} onClick={() => { if (window.confirm("Delete scorecard?")) deleteScorecard(r); }}>✕</button>
                      </div>
                    ) : (
                      <label className="sc-btn" style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.1)", color: "var(--cream-dim)", cursor: "pointer" }}>
                        📷 Add<input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => { if (e.target.files[0]) await uploadScorecardToRound(r.id, e.target.files[0]); }} />
                      </label>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
        </>}

        {/* ── ADMIN ── */}
        {tab === "admin" && isAdmin && dataLoaded && <>
          <div className="stabs">
            {[["config", "⚙ Config"], ["members", `Members${pendingJoins.length > 0 ? ` (${pendingJoins.length})` : ""}`], ["courses", "Courses"], ["rounds", "All Rounds"], ["export", "📊 Export"], ["league", "League Info"]]
              .map(([k, l]) => <button key={k} className={`stab${adminTab === k ? " active" : ""}`} onClick={() => setAdminTab(k)}>{l}</button>)}
          </div>
          {addMsg && <div className="alert-s" style={{ marginBottom: 12 }}>{addMsg}</div>}

          {/* CONFIG */}
          {adminTab === "config" && (() => {
            const d = configDraft ?? config;
            const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
            const dirty = configDraft !== null;
            return <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                <div className="card-hdr" style={{ marginBottom: 0 }}>⚙ League Configuration</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {dirty && <><button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save Changes</button><button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button></>}
                  {!dirty && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
                </div>
              </div>

              <div className="cfg-section">
                <div className="cfg-section-title">Scoring Format</div>
                <div className="format-grid">
                  {[["stroke", "Stroke Play", "Classic lowest-score-wins"], ["stableford", "Stableford", "Points per hole, most wins"], ["match", "Match Play", "Head-to-head holes"], ["scramble", "Scramble", "Team best-ball"]].map(([val, name, hint]) => (
                    <button key={val} className={`format-btn ${d.scoringFormat === val ? "sel" : ""}`} onClick={() => set("scoringFormat", val)}>
                      <span className="format-name">{name}</span><span className="format-hint">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="cfg-section">
                <div className="cfg-section-title">Round Rules</div>
                <div className="cfg-row"><div><div className="cfg-label">Required rounds per course</div><div className="cfg-desc">How many rounds each player must post at each course</div></div>
                  <select value={d.roundsPerCourse} onChange={e => set("roundsPerCourse", Number(e.target.value))} style={{ width: 80 }}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="cfg-row"><div><div className="cfg-label">Best N scores count</div><div className="cfg-desc">Only the best N of all submitted scores count toward standings. Leave blank to count all.</div></div>
                  <input type="number" min={1} placeholder="All" value={d.scoresToCount ?? ""} onChange={e => set("scoresToCount", e.target.value ? Number(e.target.value) : null)} style={{ width: 80 }} /></div>
                <div className="cfg-row"><div><div className="cfg-label">Require attestation</div><div className="cfg-desc">Playing partner must approve each round by email</div></div><Toggle checked={d.attestRequired} onChange={v => set("attestRequired", v)} /></div>
                <div className="cfg-row"><div><div className="cfg-label">Require scorecard photo</div><div className="cfg-desc">Players must upload a photo with every submission</div></div><Toggle checked={d.scorecardRequired} onChange={v => set("scorecardRequired", v)} /></div>
              </div>

              <div className="cfg-section">
                <div className="cfg-section-title">Handicap & Scoring</div>
                <div className="cfg-row"><div><div className="cfg-label">Use handicaps (net scoring)</div><div className="cfg-desc">Off = gross scores only</div></div><Toggle checked={d.useHandicap} onChange={v => set("useHandicap", v)} /></div>
                {d.useHandicap && <>
                  <div className="cfg-row"><div><div className="cfg-label">Handicap percentage used</div><div className="cfg-desc">e.g. 85 means players use 85% of their handicap index</div></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="number" min={50} max={100} value={d.handicapPct} onChange={e => set("handicapPct", Number(e.target.value))} style={{ width: 70 }} /><span style={{ color: "var(--cream-dim)" }}>%</span></div></div>
                  <div className="cfg-row"><div><div className="cfg-label">Use USGA slope/rating formula</div><div className="cfg-desc">Off = flat subtract (index used directly)</div></div><Toggle checked={d.useSlopeRating} onChange={v => set("useSlopeRating", v)} /></div>
                  <div className="cfg-row"><div><div className="cfg-label">Max handicap cap</div><div className="cfg-desc">Leave blank for no cap</div></div>
                    <input type="number" min={0} max={54} placeholder="None" value={d.maxHandicap ?? ""} onChange={e => set("maxHandicap", e.target.value ? Number(e.target.value) : null)} style={{ width: 80 }} /></div>
                </>}
              </div>

              <div className="cfg-section">
                <div className="cfg-section-title">Membership</div>
                <div className="cfg-row"><div><div className="cfg-label">Join mode</div><div className="cfg-desc">Open = anyone joins instantly · Approval = you review requests</div></div>
                  <select value={d.joinMode} onChange={e => set("joinMode", e.target.value)} style={{ width: 160 }}><option value="open">Open (invite code)</option><option value="approval">Approval required</option></select></div>
                <div className="cfg-row"><div><div className="cfg-label">Max players</div><div className="cfg-desc">Leave blank for unlimited</div></div>
                  <input type="number" min={2} placeholder="Unlimited" value={d.maxPlayers ?? ""} onChange={e => set("maxPlayers", e.target.value ? Number(e.target.value) : null)} style={{ width: 100 }} /></div>
                <div className="cfg-row"><div><div className="cfg-label">Hide scores until submitted</div><div className="cfg-desc">Players can't see others' scores until they post their own</div></div><Toggle checked={d.hideScores} onChange={v => set("hideScores", v)} /></div>
              </div>

              <div className="cfg-section">
                <div className="cfg-section-title">Season Window</div>
                <p className="note" style={{ marginBottom: 12 }}>Submissions accepted only within this range. Leave blank for no restriction.</p>
                <div className="fgrid">
                  <div className="fg"><label>Season Start</label><input type="date" value={d.seasonStart ?? ""} onChange={e => set("seasonStart", e.target.value || null)} /></div>
                  <div className="fg"><label>Season End</label><input type="date" value={d.seasonEnd ?? ""} onChange={e => set("seasonEnd", e.target.value || null)} /></div>
                </div>
              </div>

              {dirty && <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save Changes</button>
                <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>}
            </div>;
          })()}

          {/* MEMBERS */}
          {adminTab === "members" && <div className="card">
            <div className="card-hdr">👤 League Members</div>
            {pendingJoins.length > 0 && <>
              <div style={{ fontSize: ".7rem", color: "var(--purple)", fontFamily: "var(--font-d)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8 }}>Pending Join Requests</div>
              {pendingJoins.map(req => (
                <div key={req.id} className="pchip" style={{ borderColor: "rgba(155,127,232,.3)" }}>
                  <div className="avatar lg">{req.profile?.avatar_url ? <img src={req.profile.avatar_url} alt="" /> : ini(req.profile?.name)}</div>
                  <div className="pchip-info"><div className="pchip-name">{req.profile?.name}</div><div className="pchip-meta">{req.profile?.email}</div></div>
                  <div className="pchip-actions">
                    <button className="btn btn-gold btn-sm" onClick={() => approveJoin(req)}>Approve</button>
                    <button className="btn btn-danger" onClick={() => denyJoin(req)}>Deny</button>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--navy-border)", margin: "12px 0" }} />
            </>}
            {members.map(m => (
              <div key={m.user_id} className="pchip">
                <div className="avatar lg">{m.profile.avatar_url ? <img src={m.profile.avatar_url} alt="" /> : ini(m.profile.name)}</div>
                <div className="pchip-info">
                  <div className="pchip-name">{m.profile.name}</div>
                  <div className="pchip-meta">
                    {m.profile.email} · Hcp {m.profile.handicap ?? "-"}
                    {m.profile.ghin && <> · <a href={ghinUrl(m.profile.ghin)} target="_blank" rel="noreferrer" className="ghin-link" style={{ fontSize: ".68rem" }}>GHIN {m.profile.ghin} ↗</a></>}
                    {" · "}{rounds.filter(r => r.player_id === m.user_id).length} rounds
                  </div>
                  {/* Course handicaps row */}
                  {config.useHandicap && courses.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {courses.map(c => {
                      const ch = calcCourseHcp(m.profile.handicap ?? 0, c.slope, c.par, c.rating, config);
                      return <span key={c.id} className="hcp-badge" style={{ fontSize: ".66rem" }}>{c.name}: {ch}</span>;
                    })}
                  </div>}
                </div>
                <div className="pchip-actions">
                  <span className={`lrole ${m.role}`}>{m.role === "admin" ? "Commissioner" : "Player"}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditMemberHcp({ uid: m.user_id, name: m.profile.name, handicap: m.profile.handicap, ghin: m.profile.ghin })}>Edit Hcp</button>
                  {m.user_id !== session.user.id && <button className="btn btn-ghost btn-sm" onClick={() => toggleRole(m.user_id, m.role)}>{m.role === "admin" ? "→ Player" : "→ Commissioner"}</button>}
                  {m.user_id !== session.user.id && <button className="btn btn-danger" onClick={() => removeMember(m.user_id)}>Remove</button>}
                </div>
              </div>
            ))}
          </div>}

          {/* COURSES */}
          {adminTab === "courses" && <div className="card">
            <div className="card-hdr">⛳ Courses</div>
            {courses.map(c => (
              <div key={c.id} className="pchip">
                <div style={{ flex: 1 }}><div className="pchip-name">{c.name}</div><div className="pchip-meta">Par {c.par} · {c.holes} holes · Slope {c.slope} · Rating {c.rating}</div></div>
                <button className="btn btn-danger" onClick={() => deleteCourse(c.id)}>Remove</button>
              </div>
            ))}
            {!showAddCourse ? <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowAddCourse(true)}>+ Add Course</button> : (
              <div style={{ marginTop: 14 }}>
                <div className="fgrid" style={{ marginBottom: 12 }}>
                  <div className="fg" style={{ gridColumn: "1/-1" }}><label>Course Name</label><input type="text" value={newCourse.name} onChange={e => setNewCourse(c => ({ ...c, name: e.target.value }))} /></div>
                  <div className="fg"><label>Par</label><input type="number" placeholder="72" value={newCourse.par} onChange={e => setNewCourse(c => ({ ...c, par: e.target.value }))} /></div>
                  <div className="fg"><label>Holes</label><select value={newCourse.holes} onChange={e => setNewCourse(c => ({ ...c, holes: e.target.value }))}><option>18</option><option>9</option></select></div>
                  <div className="fg"><label>Slope</label><input type="number" placeholder="113" value={newCourse.slope} onChange={e => setNewCourse(c => ({ ...c, slope: e.target.value }))} /></div>
                  <div className="fg"><label>Rating</label><input type="number" step=".1" placeholder="72.0" value={newCourse.rating} onChange={e => setNewCourse(c => ({ ...c, rating: e.target.value }))} /></div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-gold" onClick={addCourse} disabled={!newCourse.name || !newCourse.par || !newCourse.slope || !newCourse.rating}>Add</button>
                  <button className="btn btn-ghost" onClick={() => setShowAddCourse(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>}

          {/* ALL ROUNDS */}
          {adminTab === "rounds" && <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}>📋 All Rounds</div>
              <button className="btn btn-danger" onClick={clearAllRounds}>Clear All</button>
            </div>
            {rounds.length === 0 ? <div className="empty">No rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>Player</th><th>Course</th><th>Gross</th>{config.useHandicap && <th>Crs Hcp</th>}<th>Net</th>{config.scoringFormat === "stableford" && <th>Pts</th>}<th>Status</th><th>Date</th><th>Card</th><th></th></tr></thead>
                <tbody>{rounds.map(r => (
                  <tr key={r.id}>
                    <td><span className="pname" style={{ fontSize: ".84rem" }}>{r.player_name}</span></td>
                    <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                    <td>{r.gross}</td>
                    {config.useHandicap && <td><span className="hcp-badge" style={{ fontSize: ".66rem" }}>{r.course_handicap}</span></td>}
                    <td>{netEl(r.net, r.par)}</td>
                    {config.scoringFormat === "stableford" && <td style={{ color: "var(--purple)" }}>{r.stableford_pts ?? "-"}</td>}
                    <td>{attestBadge(r.attest_status)}</td>
                    <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                    <td>{r.scorecard_url ? <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>📋</button> : <span style={{ color: "#4b5563" }}>—</span>}</td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => deleteRound(r.id)}>✕</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>}

          {/* EXPORT */}
          {adminTab === "export" && <div className="card">
            <div className="card-hdr">📊 Export Data</div>
            <div style={{ marginBottom: 20 }}>
              <div className="cfg-section-title">Google Sheet Integration</div>
              <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 14, lineHeight: 1.6 }}>
                Link your Google Sheet so players can view exported data. To export, download the CSV below and import it into your Google Sheet via <strong style={{ color: "var(--cream)" }}>File → Import</strong>.
                {" "}Alternatively, use <a href="https://zapier.com" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>Zapier</a> or <a href="https://make.com" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>Make</a> to automate syncing.
              </p>
              <div className="fg" style={{ marginBottom: 12 }}>
                <label>Google Sheet URL (shown to all members)</label>
                <input type="url" placeholder="https://docs.google.com/spreadsheets/d/..." value={configDraft?.googleSheetUrl ?? config.googleSheetUrl ?? ""} onChange={e => setConfigDraft(d => ({ ...(d ?? config), googleSheetUrl: e.target.value || null }))} />
              </div>
              {(configDraft?.googleSheetUrl || config.googleSheetUrl) && (
                <a href={configDraft?.googleSheetUrl ?? config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge" style={{ marginBottom: 12, display: "inline-flex" }}>
                  📊 Open Google Sheet ↗
                </a>
              )}
              {configDraft && <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button className="btn btn-gold btn-sm" onClick={() => saveConfig(configDraft)}>Save Sheet URL</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>}
            </div>
            <div style={{ borderTop: "1px solid var(--navy-border)", paddingTop: 16 }}>
              <div className="cfg-section-title">Download CSV</div>
              <p style={{ fontSize: ".86rem", color: "var(--cream-dim)", marginBottom: 14 }}>Download all rounds as a CSV file, then import into Google Sheets or Excel.</p>
              <button className="btn btn-gold" onClick={exportToGoogleSheet} disabled={rounds.length === 0}>
                ⬇ Download Rounds CSV ({rounds.length} rounds)
              </button>
            </div>
          </div>}

          {/* LEAGUE INFO */}
          {adminTab === "league" && <div className="card">
            <div className="card-hdr">League Info</div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: ".7rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Invite Code</div>
              <div className="invite-box">
                <div>
                  <div className="invite-code">{activeLeague.invite_code}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--cream-dim)", fontStyle: "italic", marginTop: 3 }}>Join mode: <strong>{config.joinMode === "approval" ? "Approval required" : "Open"}</strong></div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(activeLeague.invite_code)}>Copy</button>
              </div>
            </div>
            {config.googleSheetUrl && <div style={{ marginBottom: 16 }}>
              <a href={config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge">📊 View League Google Sheet ↗</a>
            </div>}
            <div style={{ fontSize: ".88rem", color: "var(--cream-dim)", lineHeight: 2 }}>
              <div>Name: <span style={{ color: "var(--white)" }}>{activeLeague.name}</span></div>
              {activeLeague.description && <div>Description: <span style={{ color: "var(--white)" }}>{activeLeague.description}</span></div>}
              <div>Scoring format: <span style={{ color: "var(--purple)" }}>{FORMAT_LABELS[config.scoringFormat]}</span></div>
              <div>Members: <span style={{ color: "var(--white)" }}>{members.length}{config.maxPlayers ? ` / ${config.maxPlayers} max` : ""}</span></div>
              <div>Handicap: <span style={{ color: "var(--white)" }}>{config.useHandicap ? `${config.handicapPct}%${config.useSlopeRating ? " (USGA slope/rating)" : " (flat)"}${config.maxHandicap ? ` · max ${config.maxHandicap}` : ""}` : "Gross only"}</span></div>
              <div>Attestation: <span style={{ color: "var(--white)" }}>{config.attestRequired ? "Required" : "Off"}</span></div>
              <div>Created: <span style={{ color: "var(--white)" }}>{new Date(activeLeague.created_at).toLocaleDateString()}</span></div>
            </div>
          </div>}
        </>}
      </div>
    </>);
}
