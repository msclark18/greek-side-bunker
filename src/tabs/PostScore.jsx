import { useState, useEffect } from "react";
import { supabase } from "../supabase.js";
import { calcCourseHcp, calcStableford, toPM, pmCls } from "../utils/golf.js";
import { FORMAT_LABELS } from "../constants/config.js";
import { Pencil, Camera, BarChart2, FileText, AlertTriangle, Ban, Clock, Radio, AlignJustify } from "lucide-react";

export default function PostScore({
  session, profile, setProfile, activeLeague,
  courses, members, rounds, config,
  isOpen,
  form, setForm,
  formMsg, setFormMsg,
  cardFile, setCardFile,
  cardPreview, setCardPreview,
  aiReading, setAiReading,
  aiResult, setAiResult,
  setRounds,
  setViewCardModal,
  liveRound, setLiveRound,
}) {
  const [showHcpModal, setShowHcpModal] = useState(false);
  const [hcpDraft, setHcpDraft] = useState("");
  const [scoringMode, setScoringMode] = useState(null); // null | "total" | "live"

  // When the live round clears (submitted or closed from App level), reset mode
  useEffect(() => { if (!liveRound) setScoringMode(null); }, [liveRound]);

  // Any in-progress round this player has in this league
  const inProgressRound = rounds.find(
    r => r.player_id === session?.user.id && r.round_status === "in_progress"
  ) ?? null;

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const TEAM_FORMATS = ["scramble", "texas_scramble", "best_ball"];

  // selectedTournamentRound must come before teams (teams may reference it)
  const selectedTournamentRound = config.tournamentMode
    ? (config.tournamentRounds ?? []).find(r => r.id === form.tournamentRoundId) ?? null
    : null;
  const activeFmt = selectedTournamentRound?.format ?? config.scoringFormat;
  const isActiveTeamFormat = TEAM_FORMATS.includes(activeFmt);

  const teamsFixed = config.teamsFixed ?? true;
  const teams = (config.tournamentMode && !teamsFixed && selectedTournamentRound)
    ? (selectedTournamentRound.teams ?? [])
    : (config.scrambleTeams ?? []);
  const myTeam = teams.find(t => t.players?.includes(profile?.name) || t.players?.includes(session?.user.id));

  // In tournament mode, only show the course assigned to the selected round
  const tournamentCourse = selectedTournamentRound?.courseId
    ? courses.find(c => c.id === selectedTournamentRound.courseId) ?? null
    : null;

  const myActiveOnCourse = (cid) =>
    rounds.filter(r =>
      r.player_id === session?.user.id &&
      r.course_id === cid &&
      r.attest_status !== "rejected"
    );

  const selectedCourse = config.tournamentMode ? tournamentCourse : courses.find(c => c.id === Number(form.courseId));

  const autoHcp = (() => {
    const course = selectedCourse;
    if (!course || !config.useHandicap) return 0;

    const roundHcpPct = selectedTournamentRound?.handicapPct ?? config.handicapPct ?? 100;
    const roundHcpMethod = selectedTournamentRound?.scrambleHcpMethod ?? "each";

    // Team-based handicap methods for team formats in tournament mode
    if (config.tournamentMode && isActiveTeamFormat && myTeam && roundHcpMethod !== "each") {
      const teamCourseHcps = (myTeam.players ?? []).map(pName => {
        const m = members.find(mb => mb.profile?.name === pName);
        return calcCourseHcp(m?.profile?.handicap ?? 0, course.slope, course.par, course.rating, { ...config, handicapPct: 100 });
      });
      if (teamCourseHcps.length === 0) return 0;
      let rawTeamHcp = 0;
      if (roundHcpMethod === "lowest") {
        rawTeamHcp = Math.min(...teamCourseHcps);
      } else if (roundHcpMethod === "average") {
        rawTeamHcp = teamCourseHcps.reduce((a, b) => a + b, 0) / teamCourseHcps.length;
      } else if (roundHcpMethod === "combined") {
        const sorted = [...teamCourseHcps].sort((a, b) => a - b);
        const weights = sorted.length >= 4 ? [0.20, 0.15, 0.10, 0.05] : [0.35, 0.15];
        rawTeamHcp = sorted.reduce((sum, h, i) => sum + h * (weights[i] ?? 0), 0);
      }
      return Math.round(rawTeamHcp * (roundHcpPct / 100));
    }

    // Individual / "each" method — use round's pct override if in tournament mode
    const effectiveCfg = config.tournamentMode && selectedTournamentRound
      ? { ...config, handicapPct: roundHcpPct }
      : config;
    return calcCourseHcp(profile?.handicap ?? 0, course.slope, course.par, course.rating, effectiveCfg);
  })();
  const autoNet = form.score ? Number(form.score) - autoHcp : null;
  const autoPts = (autoNet !== null && config.scoringFormat === "stableford" && selectedCourse)
    ? calcStableford(Number(form.score), autoHcp, selectedCourse.par)
    : null;

  const isValidGhin = (ghin) => /^\d{7,8}$/.test(String(ghin ?? ""));
  const missingProfile = config.useHandicap && ((!profile?.handicap && profile?.handicap !== 0) || !isValidGhin(profile?.ghin));

  const canSubmit = () => {
    if (!isOpen || !form.score) return false;
    if (config.attestRequired && !form.attesterId) return false;
    if (config.scorecardRequired && !cardFile) return false;
    if (missingProfile) return false;
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    if (form.date > localToday) return false;
    if (config.tournamentMode) {
      if (!form.tournamentRoundId) return false;
      const activeTeamId = myTeam ? String(myTeam.id) : form.teamId;
      if (isActiveTeamFormat && !activeTeamId) return false;
      if (isActiveTeamFormat && activeTeamId) {
        // Block if anyone on the team already has a score for this round
        return !rounds.some(r =>
          String(r.team_id) === activeTeamId &&
          r.tournament_round_id === form.tournamentRoundId &&
          r.attest_status !== "rejected"
        );
      }
      return !rounds.some(r =>
        r.player_id === session?.user.id &&
        r.tournament_round_id === form.tournamentRoundId &&
        r.attest_status !== "rejected"
      );
    }
    if (!form.courseId) return false;
    if (isActiveTeamFormat && teams.length > 0 && !form.teamId) return false;
    return myActiveOnCourse(Number(form.courseId)).length < config.roundsPerCourse;
  };

  const canStartLive = () => {
    if (!isOpen || missingProfile) return false;
    if (config.attestRequired && !form.attesterId) return false;
    if (!form.date) return false;
    if (config.tournamentMode) return !!form.tournamentRoundId;
    return !!form.courseId;
  };

  const startLiveRound = async () => {
    if (!canStartLive()) return;
    const course = selectedCourse;
    const hcp = autoHcp;
    const attester = config.attestRequired
      ? members.find(m => m.user_id === form.attesterId && m.profile)
      : null;
    const { data: inserted, error } = await supabase.from("rounds").insert({
      league_id: activeLeague.id,
      player_id: session.user.id,
      player_name: profile.name,
      attester_id: attester?.user_id ?? null,
      attester_name: attester?.profile?.name ?? null,
      attester_email: attester?.profile?.email ?? null,
      course_id: course.id,
      course_name: course.name,
      gross: 0,
      net: 0,
      course_handicap: hcp,
      par: course.par,
      date: form.date,
      scoring_format: activeFmt,
      attest_status: "pending",
      round_status: "in_progress",
      team_id: (isActiveTeamFormat && myTeam) ? myTeam.id : (form.teamId || null),
      tournament_round_id: form.tournamentRoundId || null,
    }).select().single();
    if (error || !inserted) {
      setFormMsg({ type: "d", text: "Error starting round." });
      return;
    }
    setRounds(p => [inserted, ...p]);
    setLiveRound(inserted);
  };

  const cancelLiveRound = async (round) => {
    await supabase.from("rounds").delete().eq("id", round.id);
    setRounds(p => p.filter(r => r.id !== round.id));
  };

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : <><Clock size={11} />Pending</>}</span>;

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
      const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
      const resp = await fetch(`${apiUrl}/api/read-scorecard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: b64, mediaType: file.type, playerName: profile?.name }),
      });
      const parsed = await resp.json();
      setAiResult(parsed);
      if (parsed.gross) {
        const updates = { score: String(parsed.gross), date: parsed.date || form.date };
        if (parsed.course) {
          const match = courses.find(c =>
            c.name.toLowerCase().includes(parsed.course.toLowerCase()) ||
            parsed.course.toLowerCase().includes(c.name.toLowerCase())
          );
          if (match) updates.courseId = String(match.id);
        }
        setForm(f => ({ ...f, ...updates }));
      }
    } catch (e) {
      console.warn("AI scorecard read failed:", e);
      setAiResult({ error: true });
    }
    setAiReading(false);
  };

  const handleCardFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) { setFormMsg({ type: "d", text: "File is too large — max 10 MB." }); return; }
    setCardFile(file);
    setCardPreview(URL.createObjectURL(file));
    readScorecardWithAI(file);
  };

  const submitRound = async () => {
    if (!canSubmit()) return;
    const course = selectedCourse;
    const hcp = autoHcp;
    const gross = Number(form.score);
    const net = gross - hcp;
    const pts = config.scoringFormat === "stableford" ? calcStableford(gross, hcp, course.par) : null;
    const attester = config.attestRequired ? members.find(m => m.user_id === form.attesterId && m.profile) : null;

    const { data: inserted, error } = await supabase.from("rounds").insert({
      league_id: activeLeague.id, player_id: session.user.id, player_name: profile.name,
      attester_id: attester?.user_id ?? null, attester_name: attester?.profile.name ?? null,
      attester_email: attester?.profile.email ?? null,
      course_id: course.id, course_name: course.name,
      gross, net, stableford_pts: pts, course_handicap: hcp, par: course.par,
      date: form.date, scoring_format: activeFmt,
      attest_status: config.attestRequired ? "pending" : "approved",
      team_id: (isActiveTeamFormat && myTeam) ? myTeam.id : (form.teamId || null),
      tournament_round_id: form.tournamentRoundId || null,
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
        const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
        const commissionerEmails = config.ccCommissioner
          ? members.filter(m => m.role === "admin" && m.profile?.email).map(m => m.profile.email)
          : [];
        await fetch(`${apiUrl}/api/send-attest-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attesterEmail: attester.profile.email,
            attesterName: attester.profile.name,
            playerName: profile.name,
            courseName: course.name,
            gross, net, par: course.par,
            date: form.date,
            leagueName: activeLeague.name,
            roundId: inserted.id,
            appUrl: import.meta.env.VITE_API_URL ?? window.location.origin,
            ccEmails: commissionerEmails,
          }),
        });
      } catch (e) { console.warn("Email non-fatal:", e); }
    }

    setRounds(p => [inserted, ...p]);
    setForm(f => ({ ...f, score: "", courseId: "", attesterId: "", teamId: "", tournamentRoundId: "" }));
    setCardFile(null); setCardPreview(null); setAiResult(null);
    setFormMsg({
      type: "s",
      text: config.attestRequired
        ? `Submitted! Attestation sent to ${attester.profile.name}.`
        : "Round submitted and approved!",
    });
    setTimeout(() => setFormMsg({ type: "", text: "" }), 5000);
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
    if (path) await supabase.storage.from("scorecards").remove([path]);
    await supabase.from("rounds").update({ scorecard_url: null }).eq("id", round.id);
    setRounds(p => p.map(r => r.id === round.id ? { ...r, scorecard_url: null } : r));
  };

  const myRounds = rounds.filter(r => r.player_id === session.user.id);

  return (
    <>
      {!isOpen && (
        <div className="alert-d" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <Ban size={14} /> Season is not currently active — score submission is closed.
        </div>
      )}

      {isOpen && missingProfile && (
        <div className="alert-w" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={14} /> This league requires a handicap index and valid GHIN number (7-8 digits) to post scores. Please update your profile before submitting a round.
        </div>
      )}



      {/* ── Resume in-progress round ── */}
      {isOpen && inProgressRound && !liveRound && (
        <div className="card" style={{ marginBottom: 12, borderColor: "rgba(76,175,125,.3)", background: "rgba(76,175,125,.04)" }}>
          <div className="card-hdr" style={{ color: "#6ee7a0" }}>
            <Radio size={14} /> Round In Progress
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, color: "var(--cream)" }}>{inProgressRound.course_name}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--cream-dim)", marginTop: 2 }}>
                Thru {(inProgressRound.hole_scores ?? []).filter(s => s != null).length} holes · {inProgressRound.date}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => cancelLiveRound(inProgressRound)}>Abandon</button>
              <button className="btn btn-gold" onClick={() => setLiveRound(inProgressRound)}>Resume Round</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scoring mode choice ── */}
      {isOpen && !inProgressRound && !scoringMode && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-hdr">How would you like to post your score?</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => setScoringMode("live")}>
              <Radio size={15} /> Live Scoring
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setScoringMode("total")}>
              <AlignJustify size={15} /> Post Total Score
            </button>
          </div>
          <p className="note" style={{ marginTop: 8, textAlign: "center" }}>
            Live scoring lets you enter your score hole by hole as you play
          </p>
        </div>
      )}

      <div className="card" style={{ opacity: isOpen ? 1 : .65, pointerEvents: isOpen ? "auto" : "none", display: isOpen && !inProgressRound && !scoringMode ? "none" : undefined }}>
        <div className="card-hdr">
          <Pencil size={15} />Post Your Round
          {activeFmt !== "stroke" && (
            <span style={{ fontSize: ".74rem", color: "var(--purple)", marginLeft: 10, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {FORMAT_LABELS[activeFmt] ?? activeFmt}
            </span>
          )}
          {config.tournamentMode && (
            <span style={{ fontSize: ".74rem", color: "var(--gold)", marginLeft: 6, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              Tournament
            </span>
          )}
        </div>

        {/* Scorecard upload */}
        <div className="fg" style={{ marginBottom: 14 }}>
          <label>
            Scorecard Photo{" "}
            {config.scorecardRequired
              ? <span style={{ color: "var(--red)" }}>*</span>
              : <span style={{ color: "var(--cream-dim)", textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-b)" }}>(optional — we'll try to read your score automatically)</span>
            }
          </label>
          {!cardPreview ? (
            <div className="upload-zone"
              onClick={() => document.getElementById("sc-upload").click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleCardFile(e.dataTransfer.files[0]); }}>
              <div style={{ marginBottom: 4, color: "var(--cream-dim)" }}><Camera size={22} /></div>
              <div style={{ fontSize: ".85rem", color: "var(--cream-dim)" }}>
                Drop scorecard photo here or <strong style={{ color: "var(--gold)" }}>browse</strong> · JPG PNG · max 10 MB
              </div>
              <input id="sc-upload" type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => handleCardFile(e.target.files[0])} />
            </div>
          ) : (
            <div>
              <div className="sc-thumb">
                <img src={cardPreview} alt="preview" />
                <button className="sc-del" onClick={() => { setCardFile(null); setCardPreview(null); setAiResult(null); }}>✕</button>
              </div>
              {aiReading && (
                <div className="ai-reading"><span className="spinner" /><span>Reading scorecard with AI…</span></div>
              )}
              {aiResult && !aiReading && (
                <div className="ai-reading" style={{
                  background: aiResult.error ? "rgba(224,92,92,.08)" : "rgba(76,175,125,.08)",
                  borderColor: aiResult.error ? "rgba(224,92,92,.2)" : "rgba(76,175,125,.2)",
                  color: aiResult.error ? "#f09090" : "#6ee7a0",
                }}>
                  {aiResult.error
                    ? <><AlertTriangle size={13} /> Couldn't read score — please enter manually.</>
                    : aiResult.gross
                      ? `✓ Detected score: ${aiResult.gross}${aiResult.date ? ` · Date: ${aiResult.date}` : ""}${aiResult.course ? ` · Course: ${aiResult.course}` : ""} — fields pre-filled!`
                      : "Score not detected — please enter manually."}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form fields */}
        <div className="fgrid">
          {/* Tournament round picker */}
          {config.tournamentMode && (config.tournamentRounds ?? []).length > 0 && (
            <div className="fg">
              <label>Tournament Round</label>
              <select value={form.tournamentRoundId} onChange={e => {
                const tr = (config.tournamentRounds ?? []).find(r => r.id === e.target.value);
                const newTeams = (!teamsFixed && tr) ? (tr.teams ?? []) : (config.scrambleTeams ?? []);
                const newMyTeam = newTeams.find(t => t.players?.includes(profile?.name) || t.players?.includes(session?.user.id));
                setForm(f => ({ ...f, tournamentRoundId: e.target.value, courseId: tr?.courseId ? String(tr.courseId) : f.courseId, ...(newMyTeam ? { teamId: String(newMyTeam.id) } : {}) }));
              }}>
                <option value="">Select round…</option>
                {(config.tournamentRounds ?? []).map(r => {
                  const isRoundTeam = TEAM_FORMATS.includes(r.format);
                  const checkTeam = isRoundTeam ? teams.find(t => t.players?.includes(profile?.name) || t.players?.includes(session?.user.id)) : null;
                  const alreadyPosted = isRoundTeam && checkTeam
                    ? rounds.some(rd => String(rd.team_id) === String(checkTeam.id) && rd.tournament_round_id === r.id && rd.attest_status !== "rejected")
                    : rounds.some(rd => rd.player_id === session?.user.id && rd.tournament_round_id === r.id && rd.attest_status !== "rejected");
                  return (
                    <option key={r.id} value={r.id} disabled={alreadyPosted}>
                      {r.label} — {FORMAT_LABELS[r.format] ?? r.format} · {r.holes}H{alreadyPosted ? " ✓" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Team picker */}
          {isActiveTeamFormat && teams.length > 0 && (
            <div className="fg">
              <label>Team</label>
              {myTeam ? (
                <input type="text" readOnly
                  value={myTeam.name}
                  style={{ opacity: .8, cursor: "default", background: "rgba(255,255,255,.04)" }} />
              ) : (
                <>
                  <select value={form.teamId} onChange={setF("teamId")}>
                    <option value="">Select your team…</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: ".72rem", color: "var(--red)", marginTop: 3 }}>You're not assigned to a team — contact your commissioner.</span>
                </>
              )}
            </div>
          )}

          {config.tournamentMode ? (
            <div className="fg">
              <label>Course</label>
              <input
                type="text"
                readOnly
                value={
                  !form.tournamentRoundId ? "Select a round first" :
                  !tournamentCourse ? "No course set for this round" :
                  `${tournamentCourse.name} · Par ${tournamentCourse.par}`
                }
                style={{ opacity: .7, cursor: "default", background: "rgba(255,255,255,.04)" }}
              />
            </div>
          ) : (
            <div className="fg">
              <label>Course</label>
              <select value={form.courseId} onChange={setF("courseId")}>
                <option value="">Select course…</option>
                {courses.filter(c => !c.playoff_only).map(c => {
                  const played = myActiveOnCourse(c.id).length;
                  const full = played >= config.roundsPerCourse;
                  return (
                    <option key={c.id} value={c.id} disabled={full}>
                      {c.name} · Par {c.par}{full ? " ✓" : played > 0 ? ` (${played}/${config.roundsPerCourse})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {config.attestRequired && (
            <div className="fg">
              <label>Attested By</label>
              <select value={form.attesterId} onChange={setF("attesterId")}>
                <option value="">Select playing partner…</option>
                {members.filter(m => m.user_id !== session.user.id && m.profile).map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.profile.name}</option>
                ))}
              </select>
            </div>
          )}

          {scoringMode !== "live" && (
            <div className="fg">
              <label>Gross Score</label>
              <input type="number" min={50} max={200} placeholder="e.g. 88" value={form.score} onChange={setF("score")} />
            </div>
          )}

          <div className="fg">
            <label>Date Played</label>
            <input type="date" value={form.date} onChange={setF("date")} max={new Date().toISOString().split("T")[0]} />
          </div>
        </div>

        {/* Auto-calculated preview */}
        {selectedCourse && form.score && (() => {
          const gross = Number(form.score);
          return (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: ".6rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)" }}>Auto-Calculated</span>
              {config.useHandicap && selectedCourse && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>
                    Course Hcp
                    {config.tournamentMode && selectedTournamentRound && (
                      <> · {selectedTournamentRound.handicapPct ?? 100}%
                        {isActiveTeamFormat && selectedTournamentRound.scrambleHcpMethod && selectedTournamentRound.scrambleHcpMethod !== "each"
                          ? ` (${selectedTournamentRound.scrambleHcpMethod})` : ""}</>
                    )}
                  </span>
                  <span className="hcp-badge" style={{ marginTop: 2 }}>{autoHcp}</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Gross</span>
                <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem", color: "var(--cream)" }}>{gross}</span>
              </div>
              {config.useHandicap && autoNet !== null && (
                <>
                  <span style={{ color: "var(--gold-border)", fontSize: "1.2rem" }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Net</span>
                    {selectedCourse
                      ? <span className={`sb ${pmCls(autoNet, selectedCourse.par)}`} style={{ fontSize: "1.2rem" }}>{autoNet} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(autoNet, selectedCourse.par)})</span></span>
                      : <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem" }}>{autoNet}</span>
                    }
                  </div>
                </>
              )}
              {autoPts !== null && (
                <>
                  <span style={{ color: "var(--gold-border)", fontSize: "1.2rem" }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Stableford</span>
                    <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem", color: "var(--purple)" }}>{autoPts} pts</span>
                  </div>
                </>
              )}
            </div>
          );
        })()}

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {scoringMode === "live" ? (
            <button className="btn btn-gold" onClick={startLiveRound} disabled={!canStartLive()}>
              <Radio size={14} /> Start Live Round
            </button>
          ) : (
            <button className="btn btn-gold" onClick={() => {
              if (!canSubmit()) return;
              setHcpDraft(String(profile?.handicap ?? ""));
              setShowHcpModal(true);
            }} disabled={!canSubmit()}>Submit Round</button>
          )}
          {scoringMode && (
            <button className="btn btn-ghost btn-sm" onClick={() => setScoringMode(null)}>Change</button>
          )}
          {formMsg.text && <div className={`alert-${formMsg.type}`}>{formMsg.text}</div>}
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          {config.attestRequired
            ? "An email will be sent to your playing partner to attest this round."
            : "Rounds are automatically approved (no attestation required)."}
        </p>
      </div>

      {/* ── Handicap Confirmation Modal ── */}
      {showHcpModal && selectedCourse && (
        <div className="modal-bg" onClick={() => setShowHcpModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Confirm Your Handicap</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 20, lineHeight: 1.7 }}>
              Please confirm your current Handicap Index before submitting. Update it if it has changed since you last played.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              {/* Handicap Index — editable */}
              <div className="fg">
                <label>Your Handicap Index</label>
                <input
                  type="number" step=".1" min={0} max={54}
                  placeholder="e.g. 8.4"
                  value={hcpDraft}
                  onChange={e => setHcpDraft(e.target.value)}
                  style={{ fontSize: "1.1rem" }}
                />
                <span style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginTop: 3 }}>
                  This is your total Handicap Index from GHIN or TheGrint
                </span>
              </div>

              {/* Course handicap — read only, recalculates as they type */}
              {hcpDraft && selectedCourse && (() => {
                const previewHcp = calcCourseHcp(Number(hcpDraft), selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config);
                return (
                  <div style={{ background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", marginBottom: 10 }}>Calculated for {selectedCourse.name}</div>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Course Handicap</span>
                        <span style={{ fontFamily: "var(--font-d)", fontSize: "1.6rem", color: "var(--white)" }}>{previewHcp}</span>
                        <span style={{ fontSize: ".68rem", color: "var(--cream-dim)", marginTop: 2 }}>read only</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 4 }}>Est. Net Score</span>
                        <span style={{ fontFamily: "var(--font-d)", fontSize: "1.6rem", color: "var(--gold-light)" }}>
                          {form.score ? Number(form.score) - previewHcp : "—"}
                        </span>
                        <span style={{ fontSize: ".68rem", color: "var(--cream-dim)", marginTop: 2 }}>gross {form.score} − {previewHcp}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-gold"
                disabled={!hcpDraft}
                onClick={async () => {
                  // Save updated handicap if it changed
                  if (String(hcpDraft) !== String(profile?.handicap)) {
                    await supabase.from("profiles").update({ handicap: Number(hcpDraft) }).eq("id", session.user.id);
                    setProfile(p => ({ ...p, handicap: Number(hcpDraft) }));
                  }
                  setShowHcpModal(false);
                  submitRound();
                }}
              >
                ✓ Confirm & Submit
              </button>
              <button className="btn btn-ghost" onClick={() => setShowHcpModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* My Stats */}
      {myRounds.length > 0 && (() => {
        const approved = myRounds.filter(r => r.attest_status !== "rejected");
        if (approved.length === 0) return null;
        const avgGross = (approved.reduce((s, r) => s + r.gross, 0) / approved.length).toFixed(1);
        const avgNet = config.useHandicap ? (approved.reduce((s, r) => s + r.net, 0) / approved.length).toFixed(1) : null;
        const bestNet = config.useHandicap ? Math.min(...approved.map(r => r.net)) : null;
        const regularCourses = courses.filter(c => !c.playoff_only);
        return (
          <div className="card">
            <div className="card-hdr"><BarChart2 size={15} />My Stats</div>
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap", background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 10, marginBottom: 18, overflow: "hidden" }}>
              <div className="bstat">
                <div className="bstat-n">{approved.length}</div>
                <div className="bstat-l">Rounds</div>
              </div>
              <div className="bstat">
                <div className="bstat-n">{avgGross}</div>
                <div className="bstat-l">Avg Gross</div>
              </div>
              {avgNet && <div className="bstat">
                <div className="bstat-n">{avgNet}</div>
                <div className="bstat-l">Avg Net</div>
              </div>}
              {bestNet !== null && <div className="bstat">
                <div className="bstat-n">{bestNet}</div>
                <div className="bstat-l">Best Net</div>
              </div>}
            </div>
            {regularCourses.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: ".66rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--cream-dim)", marginBottom: 4 }}>Per Course</div>
                {regularCourses.map(c => {
                  const cr = approved.filter(r => r.course_id === c.id);
                  if (cr.length === 0) return (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,.02)", border: "1px solid var(--navy-border)", borderRadius: 8, opacity: .5 }}>
                      <span style={{ fontSize: ".85rem", color: "var(--cream-dim)" }}>{c.name}</span>
                      <span style={{ fontSize: ".75rem", color: "#4b5563", fontStyle: "italic" }}>Not played</span>
                    </div>
                  );
                  const cAvgG = (cr.reduce((s, r) => s + r.gross, 0) / cr.length).toFixed(1);
                  const cAvgN = config.useHandicap ? (cr.reduce((s, r) => s + r.net, 0) / cr.length).toFixed(1) : null;
                  return (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8 }}>
                      <span style={{ fontSize: ".85rem", color: "var(--cream)" }}>{c.name}</span>
                      <div style={{ display: "flex", gap: 16, fontSize: ".8rem", color: "var(--cream-dim)" }}>
                        <span>Gross <strong style={{ color: "var(--cream)" }}>{cAvgG}</strong></span>
                        {cAvgN && <span>Net <strong style={{ color: "var(--gold)" }}>{cAvgN}</strong></span>}
                        <span style={{ color: "#4b5563" }}>{cr.length}/{config.roundsPerCourse}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* My Rounds */}
      {myRounds.length > 0 && (
        <div className="card">
          <div className="card-hdr">My Rounds</div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Gross</th>
                  {config.useHandicap && <th>Crs Hcp</th>}
                  {config.useHandicap && <th>Net</th>}
                  {config.scoringFormat === "stableford" && <th>Pts</th>}
                  <th>Date</th>
                  {config.attestRequired && <th>Attester</th>}
                  <th>Status</th>
                  <th>Card</th>
                </tr>
              </thead>
              <tbody>
                {myRounds.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: ".84rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                    <td>{r.gross}</td>
                    {config.useHandicap && <td><span className="hcp-badge">{r.course_handicap}</span></td>}
                    {config.useHandicap && <td>{netEl(r.net, r.par)}</td>}
                    {config.scoringFormat === "stableford" && (
                      <td><span style={{ color: "var(--purple)", fontFamily: "var(--font-d)" }}>{r.stableford_pts ?? "-"}</span></td>
                    )}
                    <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                    {config.attestRequired && <td style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{r.attester_name ?? "—"}</td>}
                    <td>
                      {attestBadge(r.attest_status)}
                      {r.attest_note && <div style={{ fontSize: ".7rem", color: "#f09090", marginTop: 2 }}>{r.attest_note}</div>}
                    </td>
                    <td>
                      {r.scorecard_url ? (
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}><FileText size={13} /></button>
                          <button className="sc-btn" style={{ borderColor: "rgba(224,92,92,.3)", background: "rgba(224,92,92,.1)", color: "#f09090" }}
                            onClick={() => deleteScorecard(r)}>✕</button>
                        </div>
                      ) : (
                        <label className="sc-btn" style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.1)", color: "var(--cream-dim)", cursor: "pointer" }}>
                          <Camera size={13} style={{ display: "inline" }} /> Add
                          <input type="file" accept="image/*" style={{ display: "none" }}
                            onChange={async e => { if (e.target.files[0]) await uploadScorecardToRound(r.id, e.target.files[0]); }} />
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
