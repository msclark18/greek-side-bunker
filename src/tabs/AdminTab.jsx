import { useState } from "react";
import { supabase } from "../supabase.js";
import { DEFAULT_CONFIG, FORMAT_LABELS } from "../constants/config.js";
import { calcCourseHcp } from "../utils/golf.js";
import Toggle from "../components/Toggle.jsx";
import GhinLink from "../components/GhinLink.jsx";

export default function AdminTab({
  session, activeLeague,
  config, setConfig,
  courses, setCourses,
  members, setMembers,
  rounds, setRounds,
  payouts,
  pendingJoins, setPendingJoins,
  setViewCardModal,
}) {
  const [adminTab, setAdminTab] = useState("config");
  const [configDraft, setConfigDraft] = useState(null);
  const [addMsg, setAddMsg] = useState("");
  const [newCourse, setNewCourse] = useState({ name: "", par: "", holes: "18", slope: "", rating: "" });
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [editMemberHcp, setEditMemberHcp] = useState(null);
  const [emailDraft, setEmailDraft] = useState({ subject: "", message: "" });
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [emailSelected, setEmailSelected] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveBylaws, setConfirmRemoveBylaws] = useState(false);

  // ── Config ──
  const saveConfig = async (newCfg) => {
    const cats = newCfg.payoutCategories ?? [];
    const totalPct = cats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
    if (totalPct > 100) { setAddMsg("Payout percentages exceed 100%. Please fix before saving."); return; }
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
    setConfigDraft(null);
  };

  // ── Courses ──
  const addCourse = async () => {
    if (!newCourse.name || !newCourse.par || !newCourse.slope || !newCourse.rating) return;
    const { data } = await supabase.from("courses").insert({
      league_id: activeLeague.id, ...newCourse,
      par: Number(newCourse.par), holes: Number(newCourse.holes),
      slope: Number(newCourse.slope), rating: Number(newCourse.rating),
    }).select().single();
    if (data) {
      setCourses(p => [...p, data]);
      setNewCourse({ name: "", par: "", holes: "18", slope: "", rating: "" });
      setShowAddCourse(false);
      setAddMsg("Course added!");
      setTimeout(() => setAddMsg(""), 3000);
    }
  };

  const deleteCourse = async (id) => {
    await supabase.from("courses").delete().eq("id", id);
    setCourses(p => p.filter(c => c.id !== id));
  };

  const togglePlayoffOnly = async (id, cur) => {
    await supabase.from("courses").update({ playoff_only: !cur }).eq("id", id);
    setCourses(p => p.map(c => c.id === id ? { ...c, playoff_only: !cur } : c));
  };

  // ── Members ──
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

  const removeMember = async (uid) => {
    if (uid === session.user.id) return;
    await supabase.from("league_members").delete().eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.filter(m => m.user_id !== uid));
  };

  const toggleRole = async (uid, cur) => {
    const r = cur === "admin" ? "player" : "admin";
    await supabase.from("league_members").update({ role: r }).eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.map(m => m.user_id === uid ? { ...m, role: r } : m));
  };

  const togglePaid = async (uid, cur) => {
    const paid = !cur;
    await supabase.from("league_members").update({ paid }).eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.map(m => m.user_id === uid ? { ...m, paid } : m));
  };

  const saveMemberHcp = async () => {
    if (!editMemberHcp) return;
    await supabase.from("profiles").update({ handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin }).eq("id", editMemberHcp.uid);
    setMembers(p => p.map(m => m.user_id === editMemberHcp.uid ? { ...m, profile: { ...m.profile, handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin } } : m));
    setEditMemberHcp(null);
  };

  // ── Rounds ──
  const deleteRound = async (id) => {
    await supabase.from("rounds").delete().eq("id", id);
    setRounds(p => p.filter(r => r.id !== id));
  };

  const clearAllRounds = async () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 5000); return; }
setConfirmClear(false);
    await supabase.from("rounds").delete().eq("league_id", activeLeague.id);
    setRounds([]);
  };

  // ── Export ──
  const exportCSV = () => {
    const headers = ["Player", "Course", "Gross", "Net", "Course Handicap", "Par", "Stableford Pts", "Date", "Status"];
    const rows = rounds.map(r => [r.player_name, r.course_name, r.gross, r.net, r.course_handicap, r.par, r.stableford_pts ?? "", r.date, r.attest_status]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${activeLeague.name}-rounds.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const sendLeagueEmail = async () => {
    if (!emailDraft.subject.trim() || !emailDraft.message.trim()) return;
    const selected = emailSelected ?? members.map(m => m.user_id);
    const recipients = members
      .filter(m => selected.includes(m.user_id) && m.profile?.email)
      .map(m => m.profile?.email);
    if (recipients.length === 0) { setEmailMsg("✗ No recipients selected."); return; }
    setEmailSending(true);
    setEmailMsg("");
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
      const res = await fetch(`${apiUrl}/api/send-league-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: activeLeague.id,
          leagueName: activeLeague.name,
          subject: emailDraft.subject,
          message: emailDraft.message,
          senderName: session?.user?.email,
          recipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setEmailMsg(`✓ Email sent to ${data.sent} member${data.sent !== 1 ? "s" : ""}!`);
      setEmailDraft({ subject: "", message: "" });
      setEmailSelected(null);
    } catch (e) {
      setEmailMsg("✗ Failed to send: " + e.message);
    }
    setEmailSending(false);
    setTimeout(() => setEmailMsg(""), 5000);
  };

  const uploadBylaws = async (file) => {
    if (!file || file.type !== "application/pdf") { setAddMsg("Please upload a PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setAddMsg("File is too large — max 10 MB."); return; }
    setAddMsg("Uploading...");
    const path = `bylaws/${activeLeague.id}.pdf`;
    const { error } = await supabase.storage.from("bylaws").upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) { setAddMsg("Upload failed: " + error.message); return; }
    const { data: urlData } = supabase.storage.from("bylaws").getPublicUrl(path);
    const newCfg = { ...config, bylawsUrl: urlData.publicUrl, bylawsName: file.name };
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
    setAddMsg("✓ Bylaws uploaded!");
    setTimeout(() => setAddMsg(""), 3000);
  };

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb`}>{net}</span>
    : <span className="sb">{net}</span>;

  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : "⏳ Pending"}</span>;

  return (
    <>
      {/* Edit Hcp Modal */}
      {editMemberHcp && (
        <div className="modal-bg" onClick={() => setEditMemberHcp(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Edit Handicap — {editMemberHcp.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} value={editMemberHcp.handicap ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN #</label><input type="text" value={editMemberHcp.ghin ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {courses.length > 0 && editMemberHcp.handicap && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Course Handicaps Preview</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {courses.map(c => {
                      const ch = calcCourseHcp(Number(editMemberHcp.handicap), c.slope, c.par, c.rating, config);
                      return <span key={c.id} className="hcp-badge">{c.name}: <strong>{ch}</strong></span>;
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveMemberHcp}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditMemberHcp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="stabs-wrap">
        <div className="stabs">
          {[
            ["config", "⚙ Config"],
            ["members", `Members${pendingJoins.length > 0 ? ` (${pendingJoins.length})` : ""}`],
            ["courses", "Courses"],
            ["rounds", "All Rounds"],
            ["export", "📊 Export"],
            ["bylaws", "📋 Bylaws"],
            ["email", "📧 Email Members"],
            ["league", "League Info"],
          ].map(([k, l]) => (
            <button key={k} className={`stab${adminTab === k ? " active" : ""}`} onClick={() => setAdminTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {addMsg && <div className="alert-s" style={{ marginBottom: 12 }}>{addMsg}</div>}

      {/* ── CONFIG ── */}
      {adminTab === "config" && (() => {
        const d = configDraft ?? config;
        const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
        const dirty = configDraft !== null;
        const payoutCats = d.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
        const totalPayoutPct = payoutCats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
        const payoutOverLimit = totalPayoutPct > 100;
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}>⚙ League Configuration</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {dirty && <>
                  <button className="btn btn-gold" onClick={() => saveConfig(configDraft)} disabled={payoutOverLimit}>Save Changes</button>
                  <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                </>}
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
              <div className="cfg-row">
                <div><div className="cfg-label">Required rounds per course</div><div className="cfg-desc">How many rounds each player must post at each course</div></div>
                <select value={d.roundsPerCourse} onChange={e => set("roundsPerCourse", Number(e.target.value))} style={{ width: 80 }}>
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Best N scores count</div><div className="cfg-desc">Only the best N of all submitted scores count. Leave blank to count all.</div></div>
                <input type="number" min={1} placeholder="All" value={d.scoresToCount ?? ""} onChange={e => set("scoresToCount", e.target.value ? Number(e.target.value) : null)} style={{ width: 80 }} />
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Require attestation</div><div className="cfg-desc">Playing partner must approve each round by email</div></div>
                <Toggle checked={d.attestRequired} onChange={v => set("attestRequired", v)} />
              </div>
              {d.attestRequired && (
                <div className="cfg-row">
                  <div><div className="cfg-label">CC commissioner on attestations</div><div className="cfg-desc">Commissioner receives a copy of every attestation email</div></div>
                  <Toggle checked={d.ccCommissioner ?? false} onChange={v => set("ccCommissioner", v)} />
                </div>
              )}
              <div className="cfg-row">
                <div><div className="cfg-label">Require scorecard photo</div><div className="cfg-desc">Players must upload a photo with every submission</div></div>
                <Toggle checked={d.scorecardRequired} onChange={v => set("scorecardRequired", v)} />
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Handicap & Scoring</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Use handicaps (net scoring)</div><div className="cfg-desc">Off = gross scores only</div></div>
                <Toggle checked={d.useHandicap} onChange={v => set("useHandicap", v)} />
              </div>
              {d.useHandicap && <>
                <div className="cfg-row">
                  <div><div className="cfg-label">Handicap percentage used</div><div className="cfg-desc">e.g. 85 means players use 85% of their handicap index</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min={50} max={100} value={d.handicapPct} onChange={e => set("handicapPct", Number(e.target.value))} style={{ width: 70 }} />
                    <span style={{ color: "var(--cream-dim)" }}>%</span>
                  </div>
                </div>
                <div className="cfg-row">
                  <div><div className="cfg-label">Use USGA slope/rating formula</div><div className="cfg-desc">Off = flat subtract (index used directly)</div></div>
                  <Toggle checked={d.useSlopeRating} onChange={v => set("useSlopeRating", v)} />
                </div>
                <div className="cfg-row">
                  <div><div className="cfg-label">Max handicap cap</div><div className="cfg-desc">Leave blank for no cap</div></div>
                  <input type="number" min={0} max={54} placeholder="None" value={d.maxHandicap ?? ""} onChange={e => set("maxHandicap", e.target.value ? Number(e.target.value) : null)} style={{ width: 80 }} />
                </div>
              </>}
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Membership</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Join mode</div><div className="cfg-desc">Open = anyone joins instantly · Approval = you review requests</div></div>
                <select value={d.joinMode} onChange={e => set("joinMode", e.target.value)} style={{ width: 160 }}>
                  <option value="open">Open (invite code)</option>
                  <option value="approval">Approval required</option>
                </select>
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Max players</div><div className="cfg-desc">Leave blank for unlimited</div></div>
                <input type="number" min={2} placeholder="Unlimited" value={d.maxPlayers ?? ""} onChange={e => set("maxPlayers", e.target.value ? Number(e.target.value) : null)} style={{ width: 100 }} />
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Hide scores until submitted</div><div className="cfg-desc">Players can't see others' scores until they post their own</div></div>
                <Toggle checked={d.hideScores} onChange={v => set("hideScores", v)} />
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">💰 Payouts & Entry Fee</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Entry fee per player</div><div className="cfg-desc">Used to calculate the total prize pool</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--cream-dim)" }}>$</span>
                  <input type="number" min={0} placeholder="0" value={d.entryFee ?? ""} onChange={e => set("entryFee", e.target.value ? Number(e.target.value) : null)} style={{ width: 90 }} />
                </div>
              </div>
              {d.entryFee > 0 && members.length > 0 && (() => {
                const paidCnt = members.filter(m => m.paid).length;
                return <div style={{ padding: "10px 0 4px", fontSize: ".82rem", color: "var(--cream-dim)" }}><span style={{ color: "var(--gold-light)", fontFamily: "var(--font-d)" }}>${(d.entryFee * paidCnt).toLocaleString()}</span> collected so far ({paidCnt} of {members.length} players paid)</div>;
              })()}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)" }}>Payout Categories</div>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: ".65rem" }} onClick={() => {
                    const cats = d.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
                    set("payoutCategories", [...cats, { id: `custom_${Date.now()}`, label: "Custom Category", pct: 0 }]);
                  }}>+ Add Category</button>
                </div>
                <p className="note" style={{ marginBottom: 12 }}>Set the % of the prize pool for each category. Total must not exceed 100%.</p>
                {(() => {
                  const cats = d.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
                  const totalPct = cats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
                  const pool = (d.entryFee ?? 0) * members.filter(m => m.paid).length;
                  const overLimit = totalPct > 100;
                  const remaining = 100 - totalPct;
                  return <>
                    {cats.map((cat, idx) => {
                      const amt = pool > 0 ? Math.round(pool * cat.pct / 100) : null;
                      const isCustom = cat.id.startsWith("custom_");
                      return (
                        <div key={cat.id} className="payout-cat-row">
                          {isCustom
                            ? <input type="text" value={cat.label} placeholder="Category name" style={{ flex: 1, minWidth: 120 }} onChange={e => { const updated = cats.map((c, i) => i === idx ? { ...c, label: e.target.value } : c); set("payoutCategories", updated); }} />
                            : <div className="payout-cat-label">{cat.label}</div>
                          }
                          <div className="payout-pct-input">
                            <input type="number" min={0} max={100} step={1} value={cat.pct || ""} placeholder="0"
                              style={{ borderColor: overLimit && cat.pct > 0 ? "rgba(224,92,92,.5)" : undefined }}
                              onChange={e => { const val = Math.max(0, Math.min(100, Number(e.target.value) || 0)); const updated = cats.map((c, i) => i === idx ? { ...c, pct: val } : c); set("payoutCategories", updated); }} />
                            <span style={{ color: "var(--cream-dim)" }}>%</span>
                          </div>
                          <div className="payout-amount">{amt != null && cat.pct > 0 ? `$${amt.toLocaleString()}` : <span style={{ color: "#4b5563" }}>—</span>}</div>
                          {isCustom && <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: ".7rem" }} onClick={() => set("payoutCategories", cats.filter((_, i) => i !== idx))}>✕</button>}
                        </div>
                      );
                    })}
                    <div className="pct-bar-wrap"><div className="pct-bar" style={{ width: `${Math.min(totalPct, 100)}%`, background: overLimit ? "var(--red)" : totalPct === 100 ? "var(--green)" : "linear-gradient(90deg,var(--gold),var(--gold-light))" }} /></div>
                    <div className="pct-total-row">
                      <span style={{ color: "var(--cream-dim)" }}>Total allocated</span>
                      <span className={overLimit ? "pct-total-over" : totalPct === 100 ? "pct-total-ok" : "pct-total-under"}>
                        {overLimit ? `⚠ ${totalPct}% — exceeds 100%` : totalPct === 100 ? `✓ ${totalPct}% — fully allocated` : `${totalPct}% (${remaining}% remaining)`}
                      </span>
                    </div>
                    {overLimit && <div className="alert-d" style={{ marginTop: 10, fontSize: ".8rem" }}>Total exceeds 100%. Please reduce before saving.</div>}
                  </>;
                })()}
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">🏆 Playoffs</div>
              <div className="cfg-row"><div><div className="cfg-label">Enable playoffs</div><div className="cfg-desc">Adds a Playoffs tab to the leaderboard</div></div><Toggle checked={d.playoffEnabled ?? true} onChange={v => set("playoffEnabled", v)} /></div>
              {(d.playoffEnabled ?? true) && <>
                <div className="cfg-row"><div><div className="cfg-label">Number of qualifiers</div><div className="cfg-desc">Top N players by regular season standings</div></div><select value={d.playoffQualifiers ?? 4} onChange={e => set("playoffQualifiers", Number(e.target.value))} style={{ width: 80 }}>{[2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="cfg-row"><div><div className="cfg-label">Seeding based on</div><div className="cfg-desc">How players are ranked to determine bracket seeding</div></div><select value={d.playoffSeedingBy ?? "net"} onChange={e => set("playoffSeedingBy", e.target.value)} style={{ width: 130 }}><option value="net">Regular Season Net</option><option value="gross">Regular Season Gross</option><option value="stableford">Stableford Pts</option></select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff format</div><div className="cfg-desc">How playoff matches are decided</div></div><select value={d.playoffFormat ?? "match"} onChange={e => set("playoffFormat", e.target.value)} style={{ width: 130 }}><option value="match">Match Play</option><option value="stroke">Stroke Play</option><option value="stableford">Stableford</option></select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff course</div><div className="cfg-desc">Course where playoff matches will be played</div></div><select value={d.playoffCourse ?? ""} onChange={e => set("playoffCourse", e.target.value || null)} style={{ width: 160 }}><option value="">Not set</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff date</div><div className="cfg-desc">Scheduled date for playoff matches</div></div><input type="date" value={d.playoffDate ?? ""} onChange={e => set("playoffDate", e.target.value || null)} style={{ width: 160 }} /></div>
              </>}
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Season Window</div>
              <p className="note" style={{ marginBottom: 12 }}>Submissions accepted only within this range. Leave blank for no restriction.</p>
              <div className="fgrid">
                <div className="fg"><label>Season Start</label><input type="date" value={d.seasonStart ?? ""} onChange={e => set("seasonStart", e.target.value || null)} /></div>
                <div className="fg"><label>Season End</label><input type="date" value={d.seasonEnd ?? ""} onChange={e => set("seasonEnd", e.target.value || null)} /></div>
              </div>
            </div>

            {dirty && (
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-gold" onClick={() => saveConfig(configDraft)} disabled={payoutOverLimit}>Save Changes</button>
                <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── MEMBERS ── */}
      {adminTab === "members" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="card-hdr" style={{ marginBottom: 0 }}>👤 League Members</div>
            {config.entryFee > 0 && (() => {
              const paidCount = members.filter(m => m.paid).length;
              const unpaidCount = members.length - paidCount;
              return (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: ".76rem", color: "#6ee7a0" }}>✓ {paidCount} paid</span>
                  {unpaidCount > 0 && <span style={{ fontSize: ".76rem", color: "#f09090" }}>⚠ {unpaidCount} unpaid</span>}
                  <span style={{ fontSize: ".76rem", color: "var(--gold-light)", fontFamily: "var(--font-d)" }}>${(paidCount * config.entryFee).toLocaleString()} / ${(members.length * config.entryFee).toLocaleString()} collected</span>
                </div>
              );
            })()}
          </div>

          {pendingJoins.length > 0 && <>
            <div style={{ fontSize: ".7rem", color: "var(--purple)", fontFamily: "var(--font-d)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8 }}>Pending Join Requests</div>
            {pendingJoins.map(req => (
              <div key={req.id} className="pchip" style={{ borderColor: "rgba(155,127,232,.3)" }}>
                <div className="avatar lg">{req.profile?.avatar_url ? <img src={req.profile.avatar_url} alt="" /> : req.profile?.name?.[0]?.toUpperCase()}</div>
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
            <div key={m.user_id} className="pchip" style={{ borderColor: config.entryFee > 0 ? (m.paid ? "rgba(76,175,125,.2)" : "rgba(224,92,92,.15)") : undefined }}>
              <div className="avatar lg">{m.profile?.avatar_url ? <img src={m.profile.avatar_url} alt="" /> : m.profile?.name?.[0]?.toUpperCase()}</div>
              <div className="pchip-info">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="pchip-name">{m.profile?.name ?? "Unknown"}</div>
                  {config.entryFee > 0 && <span className={`paid-badge ${m.paid ? "paid" : "unpaid"}`}>{m.paid ? "✓ Paid" : "✗ Unpaid"}</span>}
                  {config.useHandicap && ((!m.profile.handicap && m.profile.handicap !== 0) || !/^\d{7,8}$/.test(String(m.profile.ghin ?? ""))) && (
                    <span style={{ fontSize: ".6rem", padding: "2px 7px", borderRadius: 20, background: "rgba(224,92,92,.12)", border: "1px solid rgba(224,92,92,.3)", color: "#f09090", fontFamily: "var(--font-d)", letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                      ⚠ Profile Incomplete
                    </span>
                  )}
                </div>
                <div className="pchip-meta">
                  {m.profile?.email ?? "-"} · Hcp {m.profile?.handicap ?? "-"}
                  {m.profile.ghin && <> · <GhinLink ghin={m.profile.ghin} style={{ fontSize: ".68rem" }} /></>}
                  {" · "}{rounds.filter(r => r.player_id === m.user_id).length} rounds
                </div>
                {config.useHandicap && courses.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {courses.map(c => {
                      const ch = calcCourseHcp(m.profile.handicap ?? 0, c.slope, c.par, c.rating, config);
                      return <span key={c.id} className="hcp-badge" style={{ fontSize: ".66rem" }}>{c.name}: {ch}</span>;
                    })}
                  </div>
                )}
              </div>
              <div className="pchip-actions">
                <span className={`lrole ${m.role}`}>{m.role === "admin" ? "Commissioner" : "Player"}</span>
                {config.entryFee > 0 && <button className={`btn btn-sm ${m.paid ? "btn-danger" : "btn-gold"}`} onClick={() => togglePaid(m.user_id, m.paid)}>{m.paid ? "Mark Unpaid" : "✓ Mark Paid"}</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setEditMemberHcp({ uid: m.user_id, name: m.profile?.name, handicap: m.profile?.handicap, ghin: m.profile?.ghin })}>Edit Hcp</button>
                {m.user_id !== session.user.id && <button className="btn btn-ghost btn-sm" onClick={() => toggleRole(m.user_id, m.role)}>{m.role === "admin" ? "→ Player" : "→ Commissioner"}</button>}
                {m.user_id !== session.user.id && <button className="btn btn-danger" onClick={() => removeMember(m.user_id)}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── COURSES ── */}
      {adminTab === "courses" && (
        <div className="card">
          <div className="card-hdr">⛳ Courses</div>
          {courses.map(c => (
            <div key={c.id} className="pchip" style={{ borderColor: c.playoff_only ? "rgba(212,168,67,.25)" : undefined }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="pchip-name">{c.name}</div>
                  {c.playoff_only && <span style={{ fontSize: ".6rem", padding: "1px 7px", borderRadius: 20, background: "rgba(212,168,67,.15)", border: "1px solid var(--gold-border)", color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "1px", textTransform: "uppercase" }}>Playoff Only</span>}
                </div>
                <div className="pchip-meta">Par {c.par} · {c.holes} holes · Slope {c.slope} · Rating {c.rating}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: ".58rem", color: "var(--cream-dim)", letterSpacing: "1px", textTransform: "uppercase", fontFamily: "var(--font-d)" }}>Playoff Only</span>
                  <Toggle checked={!!c.playoff_only} onChange={() => togglePlayoffOnly(c.id, c.playoff_only)} />
                </div>
                <button className="btn btn-danger" onClick={() => deleteCourse(c.id)}>Remove</button>
              </div>
            </div>
          ))}
          {!showAddCourse ? (
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowAddCourse(true)}>+ Add Course</button>
          ) : (
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
        </div>
      )}

      {/* ── ALL ROUNDS ── */}
      {adminTab === "rounds" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="card-hdr" style={{ marginBottom: 0 }}>📋 All Rounds</div>
            <button className="btn btn-danger" onClick={clearAllRounds}>Clear All</button>
          </div>
          {rounds.length === 0 ? <div className="empty">No rounds yet.</div> : (
            <div className="tw"><table>
              <thead><tr>
                <th>Player</th><th>Course</th><th>Gross</th>
                {config.useHandicap && <th>Crs Hcp</th>}
                <th>Net</th>
                {config.scoringFormat === "stableford" && <th>Pts</th>}
                {config.attestRequired && <th>Attester</th>}
                <th>Status</th><th>Date</th><th>Card</th><th></th>
              </tr></thead>
              <tbody>{rounds.map(r => (
                <tr key={r.id}>
                  <td><span className="pname" style={{ fontSize: ".84rem" }}>{r.player_name}</span></td>
                  <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                  <td>{r.gross}</td>
                  {config.useHandicap && <td><span className="hcp-badge" style={{ fontSize: ".66rem" }}>{r.course_handicap}</span></td>}
                  <td>{netEl(r.net, r.par)}</td>
                  {config.scoringFormat === "stableford" && <td style={{ color: "var(--purple)" }}>{r.stableford_pts ?? "-"}</td>}
                  {config.attestRequired && <td style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{r.attester_name ?? "—"}</td>}
                  <td>{attestBadge(r.attest_status)}</td>
                  <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                  <td>{r.scorecard_url ? <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>📋</button> : <span style={{ color: "#4b5563" }}>—</span>}</td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => deleteRound(r.id)}>✕</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── EXPORT ── */}
      {adminTab === "export" && (
        <div className="card">
          <div className="card-hdr">📊 Export Data</div>
          <div style={{ marginBottom: 20 }}>
            <div className="cfg-section-title">Google Sheet Integration</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 14, lineHeight: 1.6 }}>
              Link your Google Sheet so players can view exported data. Download the CSV below and import via <strong style={{ color: "var(--cream)" }}>File → Import</strong>.
            </p>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label>Google Sheet URL (shown to all members)</label>
              <input type="url" placeholder="https://docs.google.com/spreadsheets/d/..."
                value={configDraft?.googleSheetUrl ?? config.googleSheetUrl ?? ""}
                onChange={e => setConfigDraft(d => ({ ...(d ?? config), googleSheetUrl: e.target.value || null }))} />
            </div>
            {(configDraft?.googleSheetUrl || config.googleSheetUrl) && (
              <a href={configDraft?.googleSheetUrl ?? config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge" style={{ marginBottom: 12, display: "inline-flex" }}>📊 Open Google Sheet ↗</a>
            )}
            {configDraft && (
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button className="btn btn-gold btn-sm" onClick={() => saveConfig(configDraft)}>Save Sheet URL</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--navy-border)", paddingTop: 16 }}>
            <div className="cfg-section-title">Download CSV</div>
            <p style={{ fontSize: ".86rem", color: "var(--cream-dim)", marginBottom: 14 }}>Download all rounds as a CSV file.</p>
            <button className="btn btn-gold" onClick={exportCSV} disabled={rounds.length === 0}>
              ⬇ Download Rounds CSV ({rounds.length} rounds)
            </button>
          </div>
        </div>
      )}

      {/* ── EMAIL MEMBERS ── */}
      {adminTab === "email" && (
        <div className="card">
          <div className="card-hdr">📧 Email Members</div>
          <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.6 }}>
            Send a message to all {members.length} members in this league. Emails are sent from <strong style={{ color: "var(--cream)" }}>noreply@greeksidebunker.com</strong>.
          </p>
          {(() => {
            const selected = emailSelected ?? members.map(m => m.user_id);
            const allSelected = selected.length === members.length;
            const toggle = (uid) => {
              if (selected.includes(uid)) setEmailSelected(selected.filter(id => id !== uid));
              else setEmailSelected([...selected, uid]);
            };
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="fg">
                  <label>Subject</label>
                  <input
                    type="text"
                    placeholder="e.g. Season starts this Saturday!"
                    value={emailDraft.subject}
                    onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  />
                </div>
                <div className="fg">
                  <label>Message</label>
                  <textarea
                    rows={6}
                    placeholder="Type your message here..."
                    value={emailDraft.message}
                    onChange={e => setEmailDraft(d => ({ ...d, message: e.target.value }))}
                    style={{ resize: "vertical", fontFamily: "inherit", fontSize: ".9rem" }}
                  />
                </div>
                <div className="fg">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <label style={{ marginBottom: 0 }}>Recipients ({selected.length} of {members.length})</label>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEmailSelected(allSelected ? [] : members.map(m => m.user_id))}>
                      {allSelected ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", padding: "4px 0" }}>
                    {members.map(m => (
                      <label key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 10px", borderRadius: 6, background: selected.includes(m.user_id) ? "rgba(212,168,67,.08)" : "transparent", border: "1px solid", borderColor: selected.includes(m.user_id) ? "rgba(212,168,67,.25)" : "transparent", transition: "all .15s" }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(m.user_id)}
                          onChange={() => toggle(m.user_id)}
                          style={{ accentColor: "var(--gold)", width: 15, height: 15, flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{m.profile?.name}</div>
                          <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.profile?.email}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-gold"
                    disabled={emailSending || !emailDraft.subject.trim() || !emailDraft.message.trim() || selected.length === 0}
                    onClick={sendLeagueEmail}
                  >
                    {emailSending ? "Sending..." : `📧 Send to ${selected.length} Member${selected.length !== 1 ? "s" : ""}`}
                  </button>
                  {emailMsg && (
                    <span style={{ fontSize: ".85rem", color: emailMsg.startsWith("✓") ? "var(--green)" : "#f09090" }}>
                      {emailMsg}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── BYLAWS ── */}
      {adminTab === "bylaws" && (
        <div className="card">
          <div className="card-hdr">📋 League Bylaws</div>
          <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.6 }}>
            Upload a PDF of your league bylaws or rules. It will be visible to all members under the <strong style={{ color: "var(--cream)" }}>Rules</strong> tab.
          </p>
          {config.bylawsUrl && (
            <div style={{ background: "rgba(76,175,125,.08)", border: "1px solid rgba(76,175,125,.25)", borderRadius: 8, padding: "14px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "#6ee7a0", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 4 }}>Current Bylaws</div>
                <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{config.bylawsName ?? "bylaws.pdf"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={config.bylawsUrl} target="_blank" rel="noreferrer">
                  <button className="btn btn-ghost btn-sm">View ↗</button>
                </a>
                <button className="btn btn-danger" onClick={async () => {
                  if (!confirmRemoveBylaws) { setConfirmRemoveBylaws(true); setTimeout(() => setConfirmRemoveBylaws(false), 5000); return; }
setConfirmRemoveBylaws(false);
                  const newCfg = { ...config, bylawsUrl: null, bylawsName: null };
                  await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
                  setConfig(newCfg);
                }}>Remove</button>
              </div>
            </div>
          )}
          <div className="fg">
            <label>{config.bylawsUrl ? "Replace Bylaws PDF" : "Upload Bylaws PDF"}</label>
            <div className="upload-zone"
              onClick={() => document.getElementById("bylaws-upload").click()}
              onDragOver={e => e.preventDefault()}
              onDrop={async e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) await uploadBylaws(file); }}>
              <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>📄</div>
              <div style={{ fontSize: ".85rem", color: "var(--cream-dim)" }}>
                Drop PDF here or <strong style={{ color: "var(--gold)" }}>browse</strong> · PDF only · max 10 MB
              </div>
              <input id="bylaws-upload" type="file" accept="application/pdf" style={{ display: "none" }}
                onChange={async e => { if (e.target.files[0]) await uploadBylaws(e.target.files[0]); }} />
            </div>
          </div>
          {addMsg && <div className="alert-s" style={{ marginTop: 12 }}>{addMsg}</div>}
        </div>
      )}

      {/* ── LEAGUE INFO ── */}
      {adminTab === "league" && (
        <div className="card">
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
          {config.googleSheetUrl && (
            <div style={{ marginBottom: 16 }}>
              <a href={config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge">📊 View League Google Sheet ↗</a>
            </div>
          )}
          <div style={{ fontSize: ".88rem", color: "var(--cream-dim)", lineHeight: 2 }}>
            <div>Name: <span style={{ color: "var(--white)" }}>{activeLeague.name}</span></div>
            {activeLeague.description && <div>Description: <span style={{ color: "var(--white)" }}>{activeLeague.description}</span></div>}
            <div>Scoring format: <span style={{ color: "var(--purple)" }}>{FORMAT_LABELS[config.scoringFormat]}</span></div>
            <div>Members: <span style={{ color: "var(--white)" }}>{members.length}{config.maxPlayers ? ` / ${config.maxPlayers} max` : ""}</span></div>
            <div>Handicap: <span style={{ color: "var(--white)" }}>{config.useHandicap ? `${config.handicapPct}%${config.useSlopeRating ? " (USGA slope/rating)" : " (flat)"}${config.maxHandicap ? ` · max ${config.maxHandicap}` : ""}` : "Gross only"}</span></div>
            <div>Attestation: <span style={{ color: "var(--white)" }}>{config.attestRequired ? "Required" : "Off"}</span></div>
            <div>Created: <span style={{ color: "var(--white)" }}>{new Date(activeLeague.created_at).toLocaleDateString()}</span></div>
          </div>
        </div>
      )}
    </>
  );
}
