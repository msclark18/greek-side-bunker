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
  setCompanionRounds,
}) {
  const [showHcpModal, setShowHcpModal] = useState(false);
  const [hcpDraft, setHcpDraft] = useState("");
  const [scoringMode, setScoringMode] = useState(null); // null | "total" | "live"
  const [showAiConfirm, setShowAiConfirm] = useState(false);
  const [aiConfirmDraft, setAiConfirmDraft] = useState({ gross: "", net: "" });
  const [companionIds, setCompanionIds] = useState([]);
  const [showPlayerPicker, setShowPlayerPicker] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]); // [{ userId, gross: "", net: "" }]
  const [showGroupConfirm, setShowGroupConfirm] = useState(false);

  // When the live round clears (submitted or closed from App level), reset mode
  useEffect(() => { if (!liveRound) { setScoringMode(null); setCompanionIds([]); } }, [liveRound]);

  // In live mode, auto-set attester to first companion (they're your playing partner)
  useEffect(() => {
    if (scoringMode === "live" && config?.attestRequired && companionIds.length > 0) {
      setForm(f => ({ ...f, attesterId: companionIds[0] }));
    }
  }, [companionIds, scoringMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Any in-progress round this player has in this league (only if the course still exists)
  const inProgressRound = rounds.find(
    r => r.player_id === session?.user.id && r.round_status === "in_progress"
      && courses.some(c => c.id === r.course_id)
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

  const isValidGhin = (ghin) => /^\d{6,8}$/.test(String(ghin ?? ""));
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
    // Attestation for live rounds is handled via companions in the group modal — skip check here
    if (!form.date) return false;
    if (config.tournamentMode) return !!form.tournamentRoundId;
    if (!form.courseId) return false;
    // Live scoring requires hole-by-hole scorecard data
    return !!(selectedCourse?.scorecard?.holes?.length);
  };

  const startLiveRound = async () => {
    if (!canStartLive()) return;
    const course = selectedCourse;
    const hcp = autoHcp;
    const groupId = crypto.randomUUID();
    // For live rounds, use first companion as attester if attestation required
    const attesterUserId = form.attesterId || companionIds[0] || null;
    const attester = config.attestRequired
      ? members.find(m => m.user_id === attesterUserId && m.profile)
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
      group_id: groupId,
      team_id: (isActiveTeamFormat && myTeam) ? myTeam.id : (form.teamId || null),
      tournament_round_id: form.tournamentRoundId || null,
    }).select().single();
    if (error || !inserted) {
      setFormMsg({ type: "d", text: "Error starting round." });
      return;
    }
    setRounds(p => [inserted, ...p.filter(r => r.id !== inserted.id)]);

    const createdCompanions = [];
    for (const cId of companionIds) {
      const cm = members.find(m => m.user_id === cId);
      if (!cm?.profile) continue;
      // If companion already posted all rounds for this course, create a tracking-only round
      const cRoundsOnCourse = rounds.filter(r => r.player_id === cId && r.course_id === course.id && r.attest_status !== "rejected").length;
      const trackingOnly = cRoundsOnCourse >= config.roundsPerCourse;
      const cmHcp = calcCourseHcp(cm.profile.handicap ?? 0, course.slope, course.par, course.rating, config);
      const { data: cr } = await supabase.from("rounds").insert({
        league_id: activeLeague.id,
        player_id: cId,
        player_name: cm.profile.name,
        attester_id: null,
        attester_name: null,
        attester_email: null,
        course_id: course.id,
        course_name: course.name,
        gross: 0,
        net: 0,
        course_handicap: cmHcp,
        par: course.par,
        date: form.date,
        scoring_format: activeFmt,
        attest_status: config.attestRequired ? "pending" : "approved",
        round_status: "in_progress",
        tracking_only: trackingOnly,
        group_id: groupId,
        team_id: null,
        tournament_round_id: form.tournamentRoundId || null,
      }).select().single();
      if (cr) {
        setRounds(p => [cr, ...p.filter(r => r.id !== cr.id)]);
        createdCompanions.push({ round: cr, member: cm });
      }
    }
    setCompanionRounds(createdCompanions);

    setLiveRound(inserted);
  };

  const cancelLiveRound = async (round) => {
    if (round.group_id) {
      // Try to delete all rounds in the group at once
      const { data: groupRounds } = await supabase
        .from("rounds").select("id").eq("group_id", round.group_id);
      const idsToDelete = (groupRounds ?? []).map(r => r.id);
      if (idsToDelete.length > 0) {
        const { error } = await supabase.from("rounds").delete().in("id", idsToDelete);
        if (!error) {
          setRounds(p => p.filter(r => !idsToDelete.includes(r.id)));
          return;
        }
      }
    }
    // Fallback: delete only the user's own round
    await supabase.from("rounds").delete().eq("id", round.id);
    setRounds(p => p.filter(r => r.id !== round.id));
  };

  const resumeRound = (round) => {
    // Find companion rounds by group_id (preferred) or fall back to date/course/league match
    const groupRounds = round.group_id
      ? rounds.filter(r =>
          r.player_id !== session?.user.id &&
          r.group_id === round.group_id
        )
      : rounds.filter(r =>
          r.player_id !== session?.user.id &&
          r.round_status === "in_progress" &&
          r.date === round.date &&
          r.course_id === round.course_id &&
          r.league_id === round.league_id
        );
    const companions = groupRounds
      .map(r => {
        const member = members.find(m => m.user_id === r.player_id);
        return member ? { round: r, member } : null;
      })
      .filter(Boolean);
    setCompanionRounds(companions);
    setLiveRound(round);
  };

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : <><Clock size={11} />Pending</>}</span>;

  const applyAiResult = (parsed, grossOverride, netOverride) => {
    const gross = grossOverride ?? (parsed.gross ? String(parsed.gross) : "");
    const net = netOverride ?? (parsed.net ? String(parsed.net) : "");
    const updates = { score: gross, net, date: parsed.date || form.date };
    if (parsed.course) {
      const match = courses.find(c =>
        c.name.toLowerCase().includes(parsed.course.toLowerCase()) ||
        parsed.course.toLowerCase().includes(c.name.toLowerCase())
      );
      if (match) updates.courseId = String(match.id);
    }
    setForm(f => ({ ...f, ...updates }));
  };

  const readScorecardWithAI = async (file) => {
    if (!file) return;
    setAiReading(true); setAiResult(null); setShowAiConfirm(false);
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
      if (parsed.gross || parsed.net) {
        setAiConfirmDraft({ gross: parsed.gross ? String(parsed.gross) : "", net: parsed.net ? String(parsed.net) : "" });
        setShowAiConfirm(true);
        // Still apply date + course match immediately for convenience, but not scores
        const updates = {};
        if (parsed.date) updates.date = parsed.date;
        if (parsed.course) {
          const match = courses.find(c =>
            c.name.toLowerCase().includes(parsed.course.toLowerCase()) ||
            parsed.course.toLowerCase().includes(c.name.toLowerCase())
          );
          if (match) updates.courseId = String(match.id);
        }
        if (Object.keys(updates).length) setForm(f => ({ ...f, ...updates }));
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
    const net = form.net !== "" && !isNaN(Number(form.net)) ? Number(form.net) : gross - hcp;
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
      round_status: "completed",
      team_id: (isActiveTeamFormat && myTeam) ? myTeam.id : (form.teamId || null),
      tournament_round_id: form.tournamentRoundId || null,
    }).select().single();

    if (error || !inserted) { setFormMsg({ type: "d", text: "Error saving round." }); return; }

    if (cardFile) {
      const ext = cardFile.name.split(".").pop();
      const storagePath = `scorecards/${inserted.id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("scorecards").upload(storagePath, cardFile, { upsert: true });
      if (uploadError) {
        console.warn("Scorecard upload failed:", uploadError);
        setFormMsg({ type: "w", text: "Round saved, but scorecard photo failed to upload. You can add it from your round history." });
      } else {
        const { data: urlData } = supabase.storage.from("scorecards").getPublicUrl(storagePath);
        const { error: updateError } = await supabase.from("rounds").update({ scorecard_url: urlData.publicUrl }).eq("id", inserted.id);
        if (updateError) {
          console.warn("Scorecard URL save failed:", updateError);
        } else {
          inserted.scorecard_url = urlData.publicUrl;
        }
      }
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

    // Post scores for group members (submitting player attests automatically)
    const groupInserts = [];
    for (const gm of groupMembers) {
      if (!gm.gross) continue;
      const gmMember = members.find(m => m.user_id === gm.userId);
      if (!gmMember?.profile) continue;
      const gmGross = Number(gm.gross);
      const gmHcp = calcCourseHcp(gmMember.profile.handicap ?? 0, course.slope, course.par, course.rating, config);
      const gmNet = gm.net !== "" && !isNaN(Number(gm.net)) ? Number(gm.net) : gmGross - gmHcp;
      const gmPts = config.scoringFormat === "stableford" ? calcStableford(gmGross, gmHcp, course.par) : null;
      const { data: gmInserted } = await supabase.from("rounds").insert({
        league_id: activeLeague.id,
        player_id: gm.userId,
        player_name: gmMember.profile.name,
        attester_id: session.user.id,
        attester_name: profile.name,
        attester_email: profile.email ?? null,
        course_id: course.id, course_name: course.name,
        gross: gmGross, net: gmNet, stableford_pts: gmPts, course_handicap: gmHcp, par: course.par,
        date: form.date, scoring_format: activeFmt,
        attest_status: "approved",
        round_status: "completed",
        team_id: null,
        tournament_round_id: form.tournamentRoundId || null,
      }).select().single();
      if (gmInserted) groupInserts.push(gmInserted);
    }
    if (groupInserts.length > 0) {
      setRounds(p => [...groupInserts.filter(r => !p.find(x => x.id === r.id)), ...p]);
    }

    // Notify commissioners on score submission if enabled
    if (config.notifyCommissionerOnSubmit) {
      try {
        const notifyApiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
        const commEmails = members.filter(m => m.role === "admin" && m.profile?.email).map(m => m.profile.email);
        if (commEmails.length > 0) {
          await fetch(`${notifyApiUrl}/api/send-score-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerName: profile.name,
              courseName: course.name,
              gross, net, par: course.par,
              date: form.date,
              leagueName: activeLeague.name,
              appUrl: notifyApiUrl,
              commissionerEmails: commEmails,
              stablefordPts: pts,
            }),
          });
        }
      } catch (e) { console.warn("Commissioner notify non-fatal:", e); }
    }

    setRounds(p => [inserted, ...p.filter(r => r.id !== inserted.id)]);
    setForm(f => ({ ...f, score: "", net: "", courseId: "", attesterId: "", teamId: "", tournamentRoundId: "" }));
    setCardFile(null); setCardPreview(null); setAiResult(null); setShowAiConfirm(false);
    setGroupMembers([]);
    setFormMsg({
      type: "s",
      text: config.attestRequired
        ? `Submitted! Attestation sent to ${attester.profile.name}.`
        : groupInserts.length > 0
          ? `Round submitted and approved! Posted scores for ${groupInserts.length} playing partner${groupInserts.length > 1 ? "s" : ""}.`
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

  const myRounds = rounds.filter(r => r.player_id === session.user.id && r.round_status !== "in_progress");

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



      {/* ── Abandon confirmation modal ── */}
      {showAbandonConfirm && inProgressRound && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.72)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--card)", borderRadius: 16, padding: 28,
            maxWidth: 380, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,.5)",
          }}>
            <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--cream)", marginBottom: 10 }}>
              Abandon Round?
            </div>
            <p style={{ color: "var(--cream-dim)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: 24 }}>
              This will abandon the round for <strong style={{ color: "var(--cream)" }}>all players</strong> in your group — including any playing partners. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAbandonConfirm(false)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ flex: 1, background: "#c0392b", color: "#fff", border: "none" }}
                onClick={async () => {
                  setShowAbandonConfirm(false);
                  await cancelLiveRound(inProgressRound);
                }}
              >
                Yes, Abandon
              </button>
            </div>
          </div>
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
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAbandonConfirm(true)}>Abandon</button>
              <button className="btn btn-gold" onClick={() => resumeRound(inProgressRound)}>Resume Round</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scoring mode choice ── */}
      {!inProgressRound && !scoringMode && (
        <div className="card" style={{ marginBottom: 12, opacity: isOpen ? 1 : 0.5, pointerEvents: isOpen ? "auto" : "none" }}>
          <div className="card-hdr">How would you like to post your score?</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => setScoringMode("live")}>
              <Radio size={15} /> Live Scoring
            </button>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setScoringMode("total"); setGroupMembers([]); }}>
              <AlignJustify size={15} /> Post Total Score
            </button>
          </div>
          <p className="note" style={{ marginTop: 8, textAlign: "center" }}>
            Live scoring lets you enter your score hole by hole as you play
          </p>
        </div>
      )}

      <div className="card" style={{ opacity: 1, display: !isOpen || (isOpen && !inProgressRound && !scoringMode) ? "none" : undefined }}>
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

        {/* Scorecard upload — hidden for live scoring (scorecard is auto-generated) */}
        <div className="fg" style={{ marginBottom: 14, display: scoringMode === "live" ? "none" : undefined }}>
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
                <button className="sc-del" onClick={() => { setCardFile(null); setCardPreview(null); setAiResult(null); setShowAiConfirm(false); }}>✕</button>
              </div>
              {aiReading && (
                <div className="ai-reading"><span className="spinner" /><span>Reading scorecard with AI…</span></div>
              )}
              {aiResult && !aiReading && aiResult.error && (
                <div className="ai-reading" style={{ background: "rgba(224,92,92,.08)", borderColor: "rgba(224,92,92,.2)", color: "#f09090" }}>
                  <AlertTriangle size={13} /> Couldn't read score — please enter manually.
                </div>
              )}
              {aiResult && !aiReading && !aiResult.error && !aiResult.gross && !aiResult.net && (
                <div className="ai-reading" style={{ background: "rgba(224,92,92,.08)", borderColor: "rgba(224,92,92,.2)", color: "#f09090" }}>
                  Score not detected — please enter manually.
                </div>
              )}
              {showAiConfirm && aiResult && !aiResult.error && (
                <div style={{ marginTop: 10, padding: "14px 16px", background: "rgba(212,168,67,.06)", border: "1px solid rgba(212,168,67,.25)", borderRadius: 10 }}>
                  <div style={{ fontSize: ".65rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", marginBottom: 10 }}>AI Read — Verify Your Scores</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div className="fg" style={{ flex: 1, margin: 0 }}>
                      <label style={{ fontSize: ".72rem" }}>Gross Score</label>
                      <input
                        type="number"
                        min={50} max={200}
                        value={aiConfirmDraft.gross}
                        onChange={e => setAiConfirmDraft(d => ({ ...d, gross: e.target.value }))}
                        style={{ marginTop: 4 }}
                      />
                    </div>
                    {config.useHandicap && (
                      <div className="fg" style={{ flex: 1, margin: 0 }}>
                        <label style={{ fontSize: ".72rem" }}>Net Score</label>
                        <input
                          type="number"
                          min={0} max={200}
                          value={aiConfirmDraft.net}
                          onChange={e => setAiConfirmDraft(d => ({ ...d, net: e.target.value }))}
                          style={{ marginTop: 4 }}
                        />
                      </div>
                    )}
                  </div>
                  {config.useHandicap && autoHcp > 0 && aiConfirmDraft.gross && (
                    <div style={{ fontSize: ".75rem", color: "var(--cream-dim)", marginBottom: 10 }}>
                      App-calculated net: <strong style={{ color: "var(--cream)" }}>{Number(aiConfirmDraft.gross) - autoHcp}</strong> (Gross {aiConfirmDraft.gross} − Hcp {autoHcp})
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn btn-gold btn-sm"
                      onClick={() => {
                        applyAiResult(aiResult, aiConfirmDraft.gross, config.useHandicap ? aiConfirmDraft.net : "");
                        setShowAiConfirm(false);
                      }}
                      disabled={!aiConfirmDraft.gross}
                    >
                      Confirm Scores
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setShowAiConfirm(false); setAiResult(null); }}
                    >
                      Skip / Enter Manually
                    </button>
                  </div>
                </div>
              )}
              {!showAiConfirm && aiResult && !aiResult.error && (aiResult.gross || aiResult.net) && (
                <div className="ai-reading" style={{ background: "rgba(76,175,125,.08)", borderColor: "rgba(76,175,125,.2)", color: "#6ee7a0" }}>
                  ✓ Scores confirmed from scorecard
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
                  const noHoleData = scoringMode === "live" && !c.scorecard?.holes?.length;
                  return (
                    <option key={c.id} value={c.id} disabled={full || noHoleData}>
                      {c.name} · Par {c.par}{full ? " ✓" : played > 0 ? ` (${played}/${config.roundsPerCourse})` : ""}{noHoleData ? " — no hole data" : ""}
                    </option>
                  );
                })}
              </select>
              {scoringMode === "live" && selectedCourse && !selectedCourse.scorecard?.holes?.length && (
                <span style={{ fontSize: "0.72rem", color: "#f87171", marginTop: 4 }}>
                  This course doesn't have hole-by-hole data. Ask your admin to re-add it via course search.
                </span>
              )}
            </div>
          )}

          {/* Duplicate warning — score was already posted for this player via group posting */}
          {scoringMode !== "live" && selectedCourse && (() => {
            const groupPosted = myActiveOnCourse(selectedCourse.id).find(
              r => r.attester_id && r.attester_id !== session.user.id && r.attest_status !== "rejected"
            );
            return groupPosted ? (
              <div style={{ padding: "10px 14px", background: "rgba(212,168,67,.08)", border: "1px solid rgba(212,168,67,.3)", borderRadius: 8, fontSize: ".8rem", color: "var(--cream-dim)", lineHeight: 1.5 }}>
                ⚠️ A score was already submitted for you on <strong style={{ color: "var(--cream)" }}>{selectedCourse.name}</strong> by <strong style={{ color: "var(--cream)" }}>{groupPosted.attester_name ?? "a playing partner"}</strong>. You won't be able to post another round until the current one is rejected.
              </div>
            ) : null;
          })()}

          {config.attestRequired && scoringMode !== "live" && (
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

          {scoringMode !== "live" && config.useHandicap && (
            <div className="fg">
              <label>Net Score <span style={{ fontWeight: 400, color: "var(--cream-dim)", fontSize: ".75rem" }}>(optional — leave blank to use app calculation)</span></label>
              <input
                type="number"
                min={0}
                max={200}
                placeholder={autoNet !== null ? `App-calculated: ${autoNet}` : "e.g. 79"}
                value={form.net}
                onChange={setF("net")}
              />
            </div>
          )}

          <div className="fg">
            <label>Date Played</label>
            <input type="date" value={form.date} onChange={setF("date")} max={new Date().toISOString().split("T")[0]} />
          </div>
        </div>

        {/* ── Group posting section ── */}
        {config.allowGroupPosting && scoringMode !== "live" && (
          <div style={{ marginTop: 16, padding: "14px 16px", background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 10 }}>
            <div style={{ fontSize: ".65rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--cream-dim)", fontFamily: "var(--font-d)", marginBottom: 6 }}>
              Playing Group
              <span style={{ color: "var(--gold)", marginLeft: 8, textTransform: "none", letterSpacing: 0, fontSize: ".75rem", fontFamily: "var(--font-b)", fontWeight: 400 }}>(optional)</span>
            </div>
            <p style={{ fontSize: ".78rem", color: "var(--cream-dim)", marginBottom: 12, lineHeight: 1.5, margin: "0 0 12px" }}>
              Add playing partners to post their scores in one go — you'll attest for the group automatically.
            </p>

            {groupMembers.map((gm, idx) => {
              const gmMember = members.find(m => m.user_id === gm.userId);
              if (!gmMember) return null;
              const gmHcp = selectedCourse ? calcCourseHcp(gmMember.profile?.handicap ?? 0, selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config) : 0;
              const gmAutoNet = gm.gross !== "" && !isNaN(Number(gm.gross)) ? Number(gm.gross) - gmHcp : null;
              return (
                <div key={gm.userId} style={{ marginBottom: 10, padding: "10px 12px", background: "rgba(255,255,255,.04)", border: "1px solid var(--navy-border)", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: ".88rem", color: "var(--cream)" }}>
                      {gmMember.profile?.name}
                      {selectedCourse && <span style={{ marginLeft: 8, fontSize: ".7rem", color: "var(--cream-dim)", fontFamily: "var(--font-b)", fontWeight: 400 }}>Crs Hcp {gmHcp}</span>}
                    </div>
                    <button onClick={() => setGroupMembers(p => p.filter((_, i) => i !== idx))}
                      style={{ background: "none", border: "none", color: "var(--cream-dim)", cursor: "pointer", fontSize: "1.2rem", lineHeight: 1, padding: "0 4px" }}>×</button>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div className="fg" style={{ flex: 1, margin: 0 }}>
                      <label style={{ fontSize: ".72rem" }}>Gross Score</label>
                      <input type="number" min={50} max={200} placeholder="e.g. 90" value={gm.gross}
                        onChange={e => setGroupMembers(p => p.map((x, i) => i === idx ? { ...x, gross: e.target.value } : x))}
                        style={{ marginTop: 4 }} />
                    </div>
                    {config.useHandicap && (
                      <div className="fg" style={{ flex: 1, margin: 0 }}>
                        <label style={{ fontSize: ".72rem" }}>
                          Net Score <span style={{ color: "var(--cream-dim)", fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: ".68rem" }}>(optional)</span>
                        </label>
                        <input type="number" min={0} max={200}
                          placeholder={gmAutoNet !== null ? `App: ${gmAutoNet}` : "e.g. 79"}
                          value={gm.net}
                          onChange={e => setGroupMembers(p => p.map((x, i) => i === idx ? { ...x, net: e.target.value } : x))}
                          style={{ marginTop: 4 }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {groupMembers.length < 3 && (() => {
              const addedIds = groupMembers.map(gm => gm.userId);
              const courseId = selectedCourse ? selectedCourse.id : null;
              const available = members.filter(m => m.user_id !== session.user.id && m.profile && !addedIds.includes(m.user_id));
              if (available.length === 0) return null;
              return (
                <select value="" onChange={e => {
                  if (!e.target.value) return;
                  setGroupMembers(p => [...p, { userId: e.target.value, gross: "", net: "" }]);
                }} style={{ width: "100%", marginTop: groupMembers.length > 0 ? 6 : 0 }}>
                  <option value="">+ Add a playing partner…</option>
                  {available.map(m => {
                    const roundsFull = courseId != null && rounds.filter(r =>
                      r.player_id === m.user_id && r.course_id === courseId && r.attest_status !== "rejected"
                    ).length >= config.roundsPerCourse;
                    return (
                      <option key={m.user_id} value={m.user_id} disabled={roundsFull}>
                        {m.profile.name}{roundsFull ? " (rounds full)" : ""}
                      </option>
                    );
                  })}
                </select>
              );
            })()}
          </div>
        )}

        {/* Score preview */}
        {selectedCourse && form.score && (() => {
          const gross = Number(form.score);
          const effectiveNet = form.net !== "" && !isNaN(Number(form.net)) ? Number(form.net) : autoNet;
          const usingCustomNet = form.net !== "" && !isNaN(Number(form.net));
          return (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: ".6rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)" }}>{usingCustomNet ? "Score Preview" : "Auto-Calculated"}</span>
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
              {config.useHandicap && effectiveNet !== null && (
                <>
                  <span style={{ color: "var(--gold-border)", fontSize: "1.2rem" }}>→</span>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>
                      Net{usingCustomNet ? <span style={{ color: "var(--gold)", marginLeft: 3 }}>✎</span> : ""}
                    </span>
                    {selectedCourse
                      ? <span className={`sb ${pmCls(effectiveNet, selectedCourse.par)}`} style={{ fontSize: "1.2rem" }}>{effectiveNet} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(effectiveNet, selectedCourse.par)})</span></span>
                      : <span style={{ fontFamily: "var(--font-d)", fontSize: "1.2rem" }}>{effectiveNet}</span>
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
            <button className="btn btn-gold" onClick={() => { if (canStartLive()) { setCompanionIds([]); setShowGroupModal(true); } }} disabled={!canStartLive()}>
              <Radio size={14} /> Start Live Round
            </button>
          ) : (
            <button className="btn btn-gold" onClick={() => {
              if (!canSubmit()) return;
              if (groupMembers.some(gm => gm.gross)) {
                setShowGroupConfirm(true);
              } else {
                setHcpDraft("");
                setShowHcpModal(true);
              }
            }} disabled={!canSubmit()}>Submit Round</button>
          )}
          {scoringMode && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setScoringMode(null); setGroupMembers([]); }}>Change</button>
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
      {/* ── Group / Player Setup Screen ── */}
      {showGroupModal && selectedCourse && (() => {
        const eligibleMembers = members.filter(m => m.user_id !== session?.user.id && m.profile);
        const filteredMembers = eligibleMembers.filter(m =>
          m.profile.name?.toLowerCase().includes(playerSearch.toLowerCase())
        );
        const MemberAvatar = ({ member, size = 44 }) => {
          const initials = (member.profile.name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
          return member.profile.avatar_url
            ? <img src={member.profile.avatar_url} alt={member.profile.name}
                style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : <div style={{
                width: size, height: size, borderRadius: "50%", flexShrink: 0,
                background: "rgba(212,168,67,.18)", border: "1.5px solid rgba(212,168,67,.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-d)", fontWeight: 700,
                fontSize: size > 36 ? "0.8rem" : "0.62rem", color: "var(--gold)",
              }}>{initials}</div>;
        };
        const myHcp = autoHcp;
        const teeName = selectedCourse.scorecard?.tee_name ?? null;
        const TeeBadge = () => teeName ? (
          <div style={{
            padding: "3px 9px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)",
            fontSize: "0.7rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
            whiteSpace: "nowrap", marginRight: 10, flexShrink: 0,
          }}>{teeName}</div>
        ) : null;
        const playerSlots = [
          { id: "me", fixed: true },
          ...Array.from({ length: 3 }, (_, i) => ({ id: companionIds[i] ?? null, fixed: false, slotIdx: i })),
        ];

        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--navy)",
            display: "flex", flexDirection: "column", overflowY: "auto" }}>

            {/* Header */}
            <div style={{ padding: "16px 16px 0", flexShrink: 0 }}>
              <button onClick={() => { setShowGroupModal(false); setCompanionIds([]); setShowPlayerPicker(false); }}
                style={{ background: "none", border: "none", cursor: "pointer", display: "flex",
                  alignItems: "center", gap: 6, color: "var(--gold)", fontFamily: "var(--font-d)",
                  fontWeight: 700, fontSize: "0.75rem", letterSpacing: "1.5px", textTransform: "uppercase",
                  padding: 0, marginBottom: 16 }}>
                ‹ &nbsp;Player Setup
              </button>
              <div style={{ fontSize: "0.78rem", color: "var(--cream-dim)", marginBottom: 14,
                fontFamily: "var(--font-b)" }}>
                {selectedCourse.name}
              </div>

              {/* Column headers */}
              <div style={{ display: "flex", alignItems: "center", paddingBottom: 8,
                borderBottom: "1px solid var(--navy-border)",
                fontSize: "0.62rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                letterSpacing: "1px", textTransform: "uppercase" }}>
                <div style={{ flex: 1 }}>Player / Index</div>
                <div style={{ marginRight: 12 }}>Tee</div>
                <div>Hcp</div>
              </div>
            </div>

            {/* Player rows */}
            <div style={{ flex: 1, padding: "0 16px" }}>
              {playerSlots.map((slot, idx) => {
                if (slot.fixed) {
                  // Me
                  const myInitials = (profile?.name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <div key="me" style={{ display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 0", borderBottom: "1px solid var(--navy-border)" }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                        background: "rgba(212,168,67,.2)", border: "2px solid rgba(212,168,67,.5)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.82rem", color: "var(--gold)",
                      }}>{myInitials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.95rem",
                          color: "var(--cream)" }}>{profile?.name ?? "You"}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--cream-dim)", marginTop: 2 }}>
                          {profile?.handicap != null ? `Index ${profile.handicap}` : "Scratch"}
                        </div>
                      </div>
                      <TeeBadge />
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                        background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "1rem", color: "var(--navy)",
                      }}>{myHcp}</div>
                    </div>
                  );
                }

                const member = slot.id ? members.find(m => m.user_id === slot.id) : null;
                if (member) {
                  const mHcp = calcCourseHcp(member.profile.handicap ?? 0, selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config);
                  return (
                    <div key={slot.id} style={{ display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 0", borderBottom: "1px solid var(--navy-border)" }}>
                      <MemberAvatar member={member} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.95rem",
                          color: "var(--cream)" }}>{member.profile.name}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--cream-dim)", marginTop: 2 }}>
                          {member.profile.handicap != null ? `Index ${member.profile.handicap}` : "Scratch"}
                        </div>
                      </div>
                      <TeeBadge />
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                        background: "rgba(212,168,67,.15)", border: "1.5px solid rgba(212,168,67,.4)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "1rem", color: "var(--gold)",
                      }}>{mHcp}</div>
                      <button onClick={() => setCompanionIds(p => p.filter(x => x !== slot.id))}
                        style={{ background: "none", border: "none", color: "var(--cream-dim)",
                          cursor: "pointer", fontSize: "1.3rem", lineHeight: 1, padding: "0 4px",
                          marginLeft: 4 }}>×</button>
                    </div>
                  );
                }

                // Empty slot
                return (
                  <div key={`slot-${idx}`} style={{ display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 0", borderBottom: "1px solid var(--navy-border)" }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                      border: "1.5px dashed rgba(255,255,255,.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }} />
                    <div style={{ flex: 1, color: "var(--cream-dim)", fontSize: "0.9rem",
                      fontFamily: "var(--font-d)" }}>
                      Player {idx + 1}
                    </div>
                    <button
                      onClick={() => { setShowPlayerPicker(true); setPlayerSearch(""); }}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        color: "var(--gold)", fontFamily: "var(--font-d)", fontWeight: 700,
                        fontSize: "0.88rem", padding: "6px 10px" }}>
                      Add
                    </button>
                  </div>
                );
              })}

              {/* League members quick-add */}
              {eligibleMembers.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div style={{ fontSize: "0.65rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                    letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14 }}>
                    League Members
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {eligibleMembers.slice(0, 8).map(m => {
                      const selected = companionIds.includes(m.user_id);
                      const atLimit = companionIds.length >= 3 && !selected;
                      const roundsFull = rounds.filter(r => r.player_id === m.user_id
                        && r.course_id === selectedCourse.id && r.attest_status !== "rejected").length >= config.roundsPerCourse;
                      const disabled = atLimit || roundsFull;
                      return (
                        <button key={m.user_id} disabled={disabled}
                          onClick={() => {
                            if (disabled) return;
                            setCompanionIds(p => selected
                              ? p.filter(id => id !== m.user_id)
                              : p.length < 3 ? [...p, m.user_id] : p);
                          }}
                          style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer",
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                            opacity: disabled ? 0.35 : 1, padding: 0 }}>
                          <div style={{ position: "relative" }}>
                            <MemberAvatar member={m} size={52} />
                            {selected && (
                              <div style={{
                                position: "absolute", bottom: 0, right: 0, width: 18, height: 18,
                                borderRadius: "50%", background: "var(--gold)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: "0.6rem", fontWeight: 900, color: "var(--navy)",
                                border: "2px solid var(--navy)",
                              }}>✓</div>
                            )}
                          </div>
                          <span style={{ fontSize: "0.65rem", color: selected ? "var(--gold)" : "var(--cream-dim)",
                            fontFamily: "var(--font-d)", maxWidth: 60, textAlign: "center",
                            overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                            {m.profile.name?.split(" ")[0]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Player picker sheet */}
            {showPlayerPicker && (
              <>
                <div onClick={() => setShowPlayerPicker(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 310, background: "rgba(0,0,0,.6)" }} />
                <div style={{
                  position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 311,
                  background: "var(--navy-card)", borderRadius: "18px 18px 0 0",
                  borderTop: "1px solid var(--navy-border)",
                  maxHeight: "70vh", display: "flex", flexDirection: "column",
                }}>
                  <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--navy-border)", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <span style={{ fontFamily: "var(--font-d)", fontWeight: 700,
                        fontSize: "0.95rem", color: "var(--cream)" }}>Add Playing Partner</span>
                      <button onClick={() => setShowPlayerPicker(false)}
                        style={{ background: "none", border: "none", color: "var(--cream-dim)",
                          cursor: "pointer", fontSize: "1.4rem", lineHeight: 1 }}>×</button>
                    </div>
                    <input type="text" placeholder="Search players..." value={playerSearch}
                      onChange={e => setPlayerSearch(e.target.value)}
                      style={{
                        width: "100%", padding: "9px 12px", borderRadius: 8,
                        border: "1px solid var(--navy-border)", background: "rgba(255,255,255,.05)",
                        color: "var(--cream)", fontSize: "0.88rem", fontFamily: "var(--font-b)",
                        outline: "none", boxSizing: "border-box",
                      }} autoFocus />
                  </div>
                  <div style={{ overflowY: "auto", flex: 1, padding: "8px 0 24px" }}>
                    {filteredMembers.length === 0
                      ? <div style={{ padding: "24px 16px", textAlign: "center",
                          color: "var(--cream-dim)", fontSize: "0.82rem" }}>No players found</div>
                      : filteredMembers.map(m => {
                        const selected = companionIds.includes(m.user_id);
                        const atLimit = companionIds.length >= 3 && !selected;
                        const roundsFull = rounds.filter(r => r.player_id === m.user_id
                          && r.course_id === selectedCourse.id && r.attest_status !== "rejected").length >= config.roundsPerCourse;
                        const disabled = atLimit || roundsFull;
                        return (
                          <button key={m.user_id} disabled={disabled}
                            onClick={() => {
                              if (disabled) return;
                              setCompanionIds(p => selected ? p.filter(id => id !== m.user_id) : [...p, m.user_id]);
                              if (!selected) setShowPlayerPicker(false);
                            }}
                            style={{
                              width: "100%", display: "flex", alignItems: "center", gap: 12,
                              padding: "12px 16px", background: selected ? "rgba(212,168,67,.08)" : "transparent",
                              border: "none", borderBottom: "1px solid rgba(255,255,255,.04)",
                              cursor: disabled ? "not-allowed" : "pointer", textAlign: "left",
                              opacity: disabled ? 0.4 : 1,
                            }}>
                            <MemberAvatar member={m} size={44} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: "var(--font-d)", fontWeight: 700,
                                fontSize: "0.9rem", color: "var(--cream)" }}>{m.profile.name}</div>
                              <div style={{ fontSize: "0.7rem", color: roundsFull ? "#f87171" : "var(--cream-dim)", marginTop: 2 }}>
                                {roundsFull ? "All rounds used for this course"
                                  : m.profile.handicap != null ? `Index ${m.profile.handicap}` : "Scratch"}
                              </div>
                            </div>
                            {selected && <span style={{ color: "var(--gold)", fontSize: "1rem" }}>✓</span>}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </>
            )}

            {/* Start Round button */}
            <div style={{ padding: "16px 16px 32px", flexShrink: 0,
              borderTop: "1px solid var(--navy-border)", background: "var(--navy)" }}>
              <button className="btn btn-gold" style={{ width: "100%", justifyContent: "center",
                padding: "15px", fontSize: "1rem" }}
                onClick={() => { setShowGroupModal(false); setShowPlayerPicker(false); startLiveRound(); }}>
                <Radio size={16} /> Start Round
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Group submission confirmation modal ── */}
      {showGroupConfirm && selectedCourse && (
        <div className="modal-bg" onClick={() => setShowGroupConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-title">Review Group Submission</div>
            <p style={{ fontSize: ".85rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.6 }}>
              Please review all scores before submitting. Group members' rounds are posted as auto-approved with you as the attester.
            </p>

            {/* Own score */}
            <div style={{ marginBottom: 10, padding: "12px 14px", background: "rgba(212,168,67,.07)", border: "1px solid rgba(212,168,67,.25)", borderRadius: 8 }}>
              <div style={{ fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", marginBottom: 8 }}>Your Round</div>
              <div style={{ fontWeight: 700, color: "var(--cream)", marginBottom: 4 }}>{profile?.name}</div>
              <div style={{ fontSize: ".8rem", color: "var(--cream-dim)", marginBottom: 6 }}>{selectedCourse.name} · {form.date}</div>
              <div style={{ display: "flex", gap: 16 }}>
                <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Gross</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--cream)" }}>{form.score}</div></div>
                {config.useHandicap && <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Crs Hcp</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--cream)" }}>{autoHcp}</div></div>}
                {config.useHandicap && <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Net</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--gold)" }}>{form.net !== "" && !isNaN(Number(form.net)) ? Number(form.net) : autoNet}</div></div>}
              </div>
            </div>

            {/* Group member scores */}
            {groupMembers.filter(gm => gm.gross).map(gm => {
              const gmMember = members.find(m => m.user_id === gm.userId);
              if (!gmMember) return null;
              const gmHcp = calcCourseHcp(gmMember.profile?.handicap ?? 0, selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config);
              const gmNet = gm.net !== "" && !isNaN(Number(gm.net)) ? Number(gm.net) : Number(gm.gross) - gmHcp;
              return (
                <div key={gm.userId} style={{ marginBottom: 10, padding: "12px 14px", background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8 }}>
                  <div style={{ fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--cream-dim)", fontFamily: "var(--font-d)", marginBottom: 8 }}>Playing Partner</div>
                  <div style={{ fontWeight: 700, color: "var(--cream)", marginBottom: 4 }}>{gmMember.profile?.name}</div>
                  <div style={{ fontSize: ".8rem", color: "var(--cream-dim)", marginBottom: 6 }}>Auto-approved · attested by you</div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Gross</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--cream)" }}>{gm.gross}</div></div>
                    {config.useHandicap && <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Crs Hcp</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--cream)" }}>{gmHcp}</div></div>}
                    {config.useHandicap && <div><span style={{ fontSize: ".62rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Net</span><div style={{ fontFamily: "var(--font-d)", fontSize: "1.3rem", color: "var(--gold)" }}>{gmNet}</div></div>}
                  </div>
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                className="btn btn-gold"
                style={{ flex: 1 }}
                onClick={() => { setShowGroupConfirm(false); setHcpDraft(""); setShowHcpModal(true); }}
              >
                ✓ Looks Good, Submit
              </button>
              <button className="btn btn-ghost" onClick={() => setShowGroupConfirm(false)}>Go Back</button>
            </div>
          </div>
        </div>
      )}

      {showHcpModal && selectedCourse && (
        <div className="modal-bg" onClick={() => setShowHcpModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Enter Your Handicap</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 20, lineHeight: 1.7 }}>
              Enter your current Handicap Index. This is your true index from GHIN or TheGrint — your course handicap will be calculated automatically.
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
                  Your true index — not your course handicap
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

            {hcpDraft !== "" && (isNaN(Number(hcpDraft)) || Number(hcpDraft) < 0 || Number(hcpDraft) > 54) && (
              <p style={{ fontSize: ".78rem", color: "#ef4444", marginBottom: 10 }}>
                Enter a valid handicap index between 0 and 54.
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-gold"
                disabled={!hcpDraft || isNaN(Number(hcpDraft)) || Number(hcpDraft) < 0 || Number(hcpDraft) > 54}
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
