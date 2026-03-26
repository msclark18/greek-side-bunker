import React, { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "../supabase.js";
import { calcStableford, toPM, pmCls } from "../utils/golf.js";
import { X, Edit2, LayoutGrid, CheckCircle, ChevronLeft, ChevronRight,
  ChevronUp, ChevronDown, ChevronsLeft, ChevronsRight,
  Waves, AlertTriangle, Mountain, ArrowDownToLine, Flag } from "lucide-react";

function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Score cell with traditional golf circle / square notation ────────────────
function ScoreCell({ score, par, size = 28 }) {
  if (score == null) {
    return <span style={{ color: "var(--cream-dim)", fontSize: "0.85rem" }}>—</span>;
  }
  if (!par) {
    return (
      <span style={{ color: "var(--cream)", fontWeight: 700, fontSize: "0.88rem",
        fontFamily: "var(--font-d)" }}>{score}</span>
    );
  }
  const diff = score - par;
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, fontSize: size > 26 ? "0.82rem" : "0.72rem",
    fontWeight: 700, fontFamily: "var(--font-d)", lineHeight: 1, flexShrink: 0,
  };
  // Eagle or better — double circle, gold
  if (diff <= -2) return (
    <span style={{ ...base, borderRadius: "50%", border: "2px solid var(--gold)",
      color: "var(--gold)", outline: "2px solid var(--gold)", outlineOffset: 3 }}>
      {score}
    </span>
  );
  // Birdie — single circle, blue
  if (diff === -1) return (
    <span style={{ ...base, borderRadius: "50%", border: "2px solid #3b82f6", color: "#3b82f6" }}>
      {score}
    </span>
  );
  // Par — plain
  if (diff === 0) return (
    <span style={{ ...base, color: "var(--cream)" }}>{score}</span>
  );
  // Bogey — single square
  if (diff === 1) return (
    <span style={{ ...base, border: "2px solid rgba(255,255,255,.4)", color: "var(--cream)" }}>
      {score}
    </span>
  );
  // Double bogey or worse — double square, red
  return (
    <span style={{ ...base, border: "2px solid #ef4444", color: "#ef4444",
      outline: "2px solid #ef4444", outlineOffset: 3 }}>
      {score}
    </span>
  );
}

// ── Stroke allocation dots ───────────────────────────────────────────────────
function StrokeDots({ count, dotColor }) {
  if (!count) return null;
  const giving = count < 0;
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: Math.abs(count) }).map((_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: dotColor ?? (giving ? "#ef4444" : "var(--gold)"),
          display: "inline-block", flexShrink: 0,
          opacity: giving ? 0.8 : 1,
        }} />
      ))}
    </span>
  );
}

// ── Tee shot D-pad target ────────────────────────────────────────────────────
function teeBtn(active, onClick, Icon, w, h, br) {
  return (
    <button onClick={onClick} style={{
      width: w, height: h, borderRadius: br, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      border: active ? "2px solid rgba(160,195,255,.85)" : "1.5px solid rgba(255,255,255,.13)",
      background: active ? "rgba(100,150,230,.24)" : "rgba(255,255,255,.08)",
      color: active ? "rgba(180,215,255,1)" : "rgba(255,255,255,.45)",
      cursor: "pointer", transition: "all .12s",
      boxShadow: active ? "0 0 12px rgba(100,150,230,.35)" : "none",
    }}>
      <Icon size={15} strokeWidth={2.5} />
    </button>
  );
}

function TeeTarget({ value, onChange }) {
  const on  = (k) => value === k;
  const tap = (k) => () => onChange(value === k ? null : k);
  const hitActive = on("hit");
  return (
    <div style={{
      width: 220, height: 220, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(255,255,255,.04)", border: "1.5px solid rgba(255,255,255,.09)",
      boxShadow: "0 0 0 6px rgba(255,255,255,.025)",
      userSelect: "none",
    }}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      {/* Long — petal rounded on top, flat on bottom */}
      {teeBtn(on("long"),     tap("long"),     ChevronUp,    54, 24, "40px 40px 10px 10px")}
      {/* Middle row */}
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        {/* Far Left — petal rounded on left, flat on right */}
        {teeBtn(on("farleft"),  tap("farleft"),  ChevronsLeft,  24, 44, "40px 10px 10px 40px")}
        {/* Left — petal rounded on left, flat on right */}
        {teeBtn(on("left"),     tap("left"),     ChevronLeft,   30, 56, "40px 10px 10px 40px")}
        {/* HIT */}
        <button onClick={tap("hit")} style={{
          width: 68, height: 68, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: hitActive ? "2.5px solid #4caf7d" : "2px solid rgba(255,255,255,.15)",
          background: hitActive ? "rgba(76,175,125,.28)" : "rgba(255,255,255,.08)",
          cursor: "pointer", transition: "all .14s",
          boxShadow: hitActive ? "0 0 20px rgba(76,175,125,.45)" : "none",
        }}>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "0.88rem",
            color: hitActive ? "#4caf7d" : "rgba(255,255,255,.55)", letterSpacing: "0.5px" }}>HIT</span>
        </button>
        {/* Right — petal rounded on right, flat on left */}
        {teeBtn(on("right"),    tap("right"),    ChevronRight,  30, 56, "10px 40px 40px 10px")}
        {/* Far Right — petal rounded on right, flat on left */}
        {teeBtn(on("farright"), tap("farright"), ChevronsRight, 24, 44, "10px 40px 40px 10px")}
      </div>
      {/* Short — petal rounded on bottom, flat on top */}
      {teeBtn(on("short"),    tap("short"),    ChevronDown,  54, 24, "10px 10px 40px 40px")}
    </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function LiveScorecard({
  round, course, courseHandicap, config, profile,
  members, activeLeague, setRounds, onComplete, onClose,
  companions = [],
  setCompanionRounds,
}) {
  const numHoles = course?.holes ?? 18;
  // Per-hole par fallback when course has no hole-by-hole scorecard data
  const fallbackHolePar = course?.par ? Math.round(course.par / numHoles) : null;

  const holeData = course?.scorecard?.holes?.length
    ? course.scorecard.holes
    : Array.from({ length: numHoles }, (_, i) => ({ hole: i + 1, par: fallbackHolePar, stroke_index: null }));

  const [scores, setScores] = useState(() => {
    const existing = round.hole_scores ?? [];
    return Array.from({ length: numHoles }, (_, i) => existing[i] ?? null);
  });
  const [mode, setMode] = useState("entry"); // "entry" | "card"
  const [showDetails, setShowDetails] = useState(false); // scorecard expand (yardage + HDCP rows)
  const [expandedPlayers, setExpandedPlayers] = useState(new Set());
  const [activeHole, setActiveHole] = useState(() => {
    const existing = round.hole_scores ?? [];
    const firstEmpty = existing.findIndex(s => s == null);
    return firstEmpty === -1 ? 0 : Math.max(0, firstEmpty);
  });
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [missingAlert, setMissingAlert] = useState(null); // array of hole numbers (1-based)
  const saveTimeout = useRef(null);
  const [companionScores, setCompanionScores] = useState(() =>
    companions.map(c => Array.from({ length: numHoles }, (_, i) => c.round.hole_scores?.[i] ?? null))
  );
  // companions arrive async (after the round is created), so sync companionScores when they appear
  useEffect(() => {
    setCompanionScores(
      companions.map(c => Array.from({ length: numHoles }, (_, i) => c.round.hole_scores?.[i] ?? null))
    );
  }, [companions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activePlayerId, setActivePlayerId] = useState(0); // 0=main, 1..n=companion idx+1
  const companionSaveTimeouts = useRef([]);
  const [numPadOpen, setNumPadOpen] = useState(false); // bottom-sheet numpad
  const [pendingScore, setPendingScore] = useState(null); // pre-filled to par when sheet opens
  const [holeStats, setHoleStats] = useState(() =>
    Array.from({ length: numHoles }, (_, i) => ({
      putts: round.hole_stats?.[i]?.putts ?? 2,
      fairway: round.hole_stats?.[i]?.fairway ?? null,   // "hit" | "left" | "right"
      penalties: round.hole_stats?.[i]?.penalties ?? [], // ["water","ob","bunker",...]
    }))
  );
  const [pendingStats, setPendingStats] = useState({ putts: 2, fairway: null, mishit: false, penalties: [] });
  const statsTimeout = useRef(null);

  // How many strokes does this player get (positive) or give (negative) on a hole?
  const getStrokes = (si) => {
    if (!si || !courseHandicap) return 0;
    if (courseHandicap > 0) {
      let s = 0;
      if (si <= courseHandicap) s++;
      if (courseHandicap > 18 && si <= courseHandicap - 18) s++;
      return s;
    }
    // Plus handicap: gives a stroke on the |hcp| easiest holes (highest SI)
    return si > 18 - Math.abs(courseHandicap) ? -1 : 0;
  };

  // getStrokes for a specific courseHandicap (for companions)
  const getStrokesFor = (si, hcp) => {
    if (!si || !hcp) return 0;
    if (hcp > 0) {
      let s = 0;
      if (si <= hcp) s++;
      if (hcp > 18 && si <= hcp - 18) s++;
      return s;
    }
    return si > 18 - Math.abs(hcp) ? -1 : 0;
  };

  const thru = scores.filter(s => s != null).length;
  const runningGross = scores.reduce((a, s) => a + (s ?? 0), 0);
  const playedPar = holeData.reduce((a, h, i) => a + (scores[i] != null ? (h.par ?? 0) : 0), 0);
  // Only deduct strokes for holes actually played
  const playedStrokes = holeData.reduce((a, h, i) => a + (scores[i] != null ? getStrokes(h.stroke_index) : 0), 0);
  const isComplete = thru === numHoles;

  const allPlayers = [
    { name: profile?.name, scores, courseHandicap, trackingOnly: false },
    ...companions.map((c, i) => ({
      name: c.member.profile?.name ?? "Player",
      scores: companionScores[i] ?? [],
      courseHandicap: c.round.course_handicap ?? 0,
      trackingOnly: c.round.tracking_only ?? false,
    })),
  ];

  // Debounced save — fires 800ms after last hole entry
  const saveScores = useCallback((newScores) => {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      const gross = newScores.filter(s => s != null).reduce((a, b) => a + b, 0);
      await supabase.from("rounds").update({ hole_scores: newScores, gross }).eq("id", round.id);
      setRounds(p => p.map(r => r.id === round.id ? { ...r, hole_scores: newScores, gross } : r));
      setSaving(false);
    }, 800);
  }, [round.id, setRounds]);

  const saveCompanionScore = useCallback((idx, newScores) => {
    if (!companionSaveTimeouts.current) companionSaveTimeouts.current = [];
    clearTimeout(companionSaveTimeouts.current[idx]);
    companionSaveTimeouts.current[idx] = setTimeout(async () => {
      const cr = companions[idx]?.round;
      if (!cr) return;
      const gross = newScores.filter(s => s != null).reduce((a, b) => a + b, 0);
      await supabase.from("rounds").update({ hole_scores: newScores, gross }).eq("id", cr.id);
      setRounds(p => p.map(r => r.id === cr.id ? { ...r, hole_scores: newScores, gross } : r));
    }, 800);
  }, [companions, setRounds]);

  const saveStats = useCallback((newStats) => {
    clearTimeout(statsTimeout.current);
    statsTimeout.current = setTimeout(async () => {
      await supabase.from("rounds").update({ hole_stats: newStats }).eq("id", round.id);
    }, 800);
  }, [round.id]);

  const enterScore = (holeIdx, score) => {
    if (activePlayerId === 0) {
      const next = [...scores];
      next[holeIdx] = score;
      setScores(next);
      saveScores(next);
    } else {
      const cIdx = activePlayerId - 1;
      setCompanionScores(prev => {
        const base = prev.length > cIdx ? prev : [
          ...prev,
          ...Array.from({ length: cIdx + 1 - prev.length }, () =>
            Array.from({ length: numHoles }, () => null)
          ),
        ];
        const next = base.map((cs, i) => i === cIdx ? [...cs] : cs);
        next[cIdx][holeIdx] = score;
        saveCompanionScore(cIdx, next[cIdx]);
        return next;
      });
    }
  };


  const handleSubmit = async () => {
    if (submitLoading) return;
    const missing = scores.map((s, i) => s == null ? i + 1 : null).filter(Boolean);
    if (missing.length > 0) {
      setMissingAlert(missing);
      setMode("entry");
      setActiveHole(missing[0] - 1);
      return;
    }
    setMissingAlert(null);
    setSubmitLoading(true);
    const gross = scores.filter(s => s != null).reduce((a, b) => a + b, 0);
    const net = gross - courseHandicap;
    const pts = config.scoringFormat === "stableford" && course
      ? calcStableford(gross, courseHandicap, course.par)
      : null;

    const { data: updated, error } = await supabase.from("rounds").update({
      hole_scores: scores,
      gross,
      net,
      stableford_pts: pts,
      round_status: "completed",
    }).eq("id", round.id).select().single();

    if (error) { setSubmitLoading(false); return; }

    // Send attestation email if required
    if (config.attestRequired && round.attester_id) {
      try {
        const attester = members.find(m => m.user_id === round.attester_id && m.profile);
        if (attester) {
          const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
          const ccEmails = config.ccCommissioner
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
              date: round.date,
              leagueName: activeLeague.name,
              roundId: round.id,
              appUrl: apiUrl,
              ccEmails,
            }),
          });
        }
      } catch (e) { console.warn("Attest email non-fatal:", e); }
    }

    setRounds(p => p.map(r => r.id === round.id ? { ...r, ...updated } : r));

    // Submit companion rounds
    for (let i = 0; i < companions.length; i++) {
      const cRound = companions[i].round;
      const cScores = companionScores[i] ?? [];
      const cGross = cScores.filter(s => s != null).reduce((a, b) => a + b, 0);
      const cHcp = cRound.course_handicap ?? 0;
      const cNet = cGross - cHcp;
      await supabase.from("rounds").update({
        hole_scores: cScores,
        gross: cGross,
        net: cNet,
        round_status: "completed",
      }).eq("id", cRound.id);
      setRounds(p => p.map(r => r.id === cRound.id ? { ...r, hole_scores: cScores, gross: cGross, net: cNet, round_status: "completed" } : r));
    }
    if (setCompanionRounds) setCompanionRounds([]);

    setSubmitLoading(false);
    onComplete(updated);
  };

  // ── Entry mode — The Grint style ───────────────────────────────────────────
  const renderEntryMode = () => {
    const h = holeData[activeHole];

    // Per-player score-to-par label for all holes played so far
    const playerScoreToPar = (playerScores) => {
      const gross = playerScores.reduce((a, s) => a + (s ?? 0), 0);
      const par = holeData.reduce((a, hd, i) => a + (playerScores[i] != null ? (hd.par ?? 0) : 0), 0);
      if (par === 0) return null;
      const diff = gross - par;
      return diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`;
    };


    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

        {/* Hole navigation header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 8px 10px",
        }}>
          <button
            onClick={() => { setActiveHole(i => Math.max(0, i - 1)); setNumPadOpen(false); }}
            disabled={activeHole === 0}
            style={{ background: "none", border: "none", padding: "8px 12px",
              cursor: activeHole === 0 ? "default" : "pointer",
              color: activeHole === 0 ? "rgba(255,255,255,.15)" : "var(--cream)" }}
          >
            <ChevronLeft size={22} />
          </button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "2rem",
              color: "var(--cream)", lineHeight: 1, letterSpacing: "-1px" }}>
              {ordinalSuffix(activeHole + 1).toUpperCase()}
            </div>
          </div>
          <button
            onClick={() => { setActiveHole(i => Math.min(numHoles - 1, i + 1)); setNumPadOpen(false); }}
            disabled={activeHole === numHoles - 1}
            style={{ background: "none", border: "none", padding: "8px 12px",
              cursor: activeHole === numHoles - 1 ? "default" : "pointer",
              color: activeHole === numHoles - 1 ? "rgba(255,255,255,.15)" : "var(--cream)" }}
          >
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Course info bar: Par X | Yds | • SI */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 0,
          padding: "0 16px 14px",
        }}>
          {[
            h?.par != null && `Par ${h.par}`,
            h?.yards && `${h.yards} yds`,
            h?.stroke_index != null && `Hdcp ${h.stroke_index}`,
          ].filter(Boolean).map((item, i, arr) => (
            <span key={i} style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--cream-dim)",
                fontFamily: "var(--font-d)", fontWeight: 600 }}>{item}</span>
              {i < arr.length - 1 && (
                <span style={{ margin: "0 8px", color: "rgba(255,255,255,.2)", fontSize: "0.9rem" }}>|</span>
              )}
            </span>
          ))}
        </div>

        {/* Player rows */}
        <div style={{ flex: 1, padding: "0 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {allPlayers.map((player, pIdx) => {
            const pScores = pIdx === 0 ? scores : (companionScores[pIdx - 1] ?? []);
            const holeScore = pScores[activeHole];
            const stp = playerScoreToPar(pScores);
            const initials = (player.name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
            const pStrokes = getStrokesFor(h?.stroke_index, player.courseHandicap);

            return (
              <div key={pIdx} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 14px", borderRadius: 12,
                background: "rgba(255,255,255,.04)",
                border: "1px solid var(--navy-border)",
              }}>
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(212,168,67,.18)", border: "1.5px solid rgba(212,168,67,.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.78rem",
                  color: "var(--gold)",
                }}>{initials}</div>

                {/* Name + handicap */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-d)", fontWeight: 700,
                      fontSize: "0.9rem", color: "var(--cream)",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {player.name}
                    </span>
                    {player.courseHandicap > 0 && (
                      <span style={{ fontSize: "0.75rem", color: "var(--cream-dim)",
                        fontFamily: "var(--font-d)" }}>
                        [{player.courseHandicap}]
                      </span>
                    )}
                    {player.trackingOnly && (
                      <span style={{ fontSize: "0.6rem", color: "#94a3b8", fontFamily: "var(--font-d)",
                        background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.25)",
                        borderRadius: 4, padding: "1px 5px", letterSpacing: "0.5px" }}>
                        TRACKING
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    {stp !== null && (
                      <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-d)", fontWeight: 700,
                        color: stp === "E" ? "var(--cream-dim)" : stp.startsWith("+") ? "#ef4444" : "#4caf7d" }}>
                        {stp}
                      </span>
                    )}
                  </div>
                </div>

                {/* Score or Add Score button */}
                {holeScore != null ? (
                  <button
                    onClick={() => {
                      setActivePlayerId(pIdx);
                      setPendingScore(holeScore);
                      setPendingStats(holeStats[activeHole] ?? { putts: null, fairway: null, penalties: [] });
                      setNumPadOpen(true);
                    }}
                    style={{ background: "none", border: "none", padding: 4, cursor: "pointer",
                      flexShrink: 0 }}
                  >
                    <ScoreCell score={holeScore} par={h?.par} size={38} />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setActivePlayerId(pIdx);
                      setPendingScore(h?.par ?? null);
                      setPendingStats(holeStats[activeHole] ?? { putts: null, fairway: null, penalties: [] });
                      setNumPadOpen(true);
                    }}
                    style={{
                      width: 72, height: 72, borderRadius: 10, border: "none",
                      background: "var(--gold)", color: "var(--navy)",
                      fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.7rem",
                      cursor: "pointer", flexShrink: 0,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", textAlign: "center", lineHeight: 1.3,
                      gap: 2,
                    }}
                  >
                    {pStrokes !== 0 && <StrokeDots count={pStrokes} dotColor={pStrokes > 0 ? "var(--navy)" : undefined} />}
                    <span>Enter</span><span>Score</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Hole progress dots */}
        <div style={{
          display: "flex", gap: 5, padding: "16px 14px 10px", flexWrap: "wrap",
          justifyContent: "center",
        }}>
          {Array.from({ length: numHoles }, (_, i) => (
            <button
              key={i}
              onClick={() => { setActiveHole(i); setNumPadOpen(false); }}
              style={{
                width: 26, height: 26, borderRadius: "50%", border: "none",
                background: i === activeHole
                  ? "var(--gold)"
                  : scores[i] != null ? "rgba(76,175,125,.25)" : "rgba(255,255,255,.06)",
                color: i === activeHole
                  ? "var(--navy)"
                  : scores[i] != null ? "#6ee7a0" : "var(--cream-dim)",
                cursor: "pointer",
                fontSize: "0.6rem",
                fontFamily: "var(--font-d)", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {scores[i] != null ? scores[i] : i + 1}
            </button>
          ))}
        </div>

        {/* Bottom-sheet numpad */}
        {numPadOpen && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setNumPadOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 50,
                background: "rgba(0,0,0,.45)" }}
            />
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 51,
              background: "var(--navy-card)", borderTop: "1px solid var(--navy-border)",
              borderRadius: "18px 18px 0 0",
              maxHeight: "85vh", overflowY: "auto",
              padding: "16px 16px 36px",
            }}>
              {/* Sheet header: name + score-to-par + Enter button */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                {/* Avatar */}
                <div style={{
                  width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(212,168,67,.18)", border: "1.5px solid rgba(212,168,67,.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.75rem",
                  color: "var(--gold)",
                }}>
                  {(allPlayers[activePlayerId]?.name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontFamily: "var(--font-d)", fontWeight: 700,
                      fontSize: "0.9rem", color: "var(--cream)" }}>
                      {allPlayers[activePlayerId]?.name}
                    </span>
                    {allPlayers[activePlayerId]?.courseHandicap > 0 && (
                      <span style={{ fontSize: "0.75rem", color: "var(--cream-dim)",
                        fontFamily: "var(--font-d)" }}>
                        [{allPlayers[activePlayerId].courseHandicap}]
                      </span>
                    )}
                  </div>
                  {/* Score-to-par preview with pending score */}
                  {(() => {
                    const pScores = activePlayerId === 0 ? scores : (companionScores[activePlayerId - 1] ?? []);
                    const withPending = pScores.map((s, i) => i === activeHole ? pendingScore : s);
                    const gross = withPending.reduce((a, s) => a + (s ?? 0), 0);
                    const par = holeData.reduce((a, hd, i) => a + (withPending[i] != null ? (hd.par ?? 0) : 0), 0);
                    if (par === 0) return null;
                    const diff = gross - par;
                    const label = diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`;
                    return (
                      <div style={{ fontSize: "0.82rem", fontFamily: "var(--font-d)", fontWeight: 700,
                        color: diff === 0 ? "var(--cream-dim)" : diff > 0 ? "#ef4444" : "#4caf7d",
                        marginTop: 1 }}>
                        {label} ({gross})
                      </div>
                    );
                  })()}
                </div>
                {/* Enter button */}
                <button
                  onClick={() => {
                    if (pendingScore == null) return;
                    if (activePlayerId === 0) {
                      const nextStats = holeStats.map((s, i) => i === activeHole ? pendingStats : s);
                      setHoleStats(nextStats);
                      saveStats(nextStats);
                    }
                    enterScore(activeHole, pendingScore);
                    setMissingAlert(prev => {
                      if (!prev) return null;
                      const updated = prev.filter(h => h !== activeHole + 1);
                      return updated.length > 0 ? updated : null;
                    });
                    setNumPadOpen(false);
                    setActivePlayerId(0);
                  }}
                  disabled={pendingScore == null}
                  style={{
                    padding: "10px 18px", borderRadius: 8, border: "none",
                    background: pendingScore != null ? "#3b6de8" : "rgba(255,255,255,.06)",
                    color: pendingScore != null ? "#fff" : "var(--cream-dim)",
                    fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.88rem",
                    cursor: pendingScore != null ? "pointer" : "not-allowed",
                    flexShrink: 0,
                  }}
                >Enter</button>
              </div>

              {/* Spinners row: Score | Putts */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {[
                  {
                    label: "Score",
                    numDisplay: pendingScore,
                    scoreColor: (() => {
                      if (pendingScore == null || !h?.par) return "var(--cream)";
                      const d = pendingScore - h.par;
                      if (d <= -2) return "#f0c040";
                      if (d === -1) return "#60a5fa";
                      if (d === 0) return "var(--cream)";
                      if (d === 1) return "rgba(255,255,255,.65)";
                      return "#f87171";
                    })(),
                    onDec: () => setPendingScore(s => s != null && s > 1 ? s - 1 : s),
                    onInc: () => setPendingScore(s => s != null ? s + 1 : (h?.par ?? 1)),
                    decDisabled: pendingScore == null || pendingScore <= 1,
                  },
                  {
                    label: "Putts",
                    numDisplay: pendingStats.putts,
                    scoreColor: "var(--cream)",
                    onDec: () => setPendingStats(s => ({ ...s, putts: s.putts != null && s.putts > 0 ? s.putts - 1 : s.putts })),
                    onInc: () => setPendingStats(s => ({ ...s, putts: s.putts != null ? s.putts + 1 : 0 })),
                    decDisabled: pendingStats.putts == null || pendingStats.putts <= 0,
                  },
                ].map(({ label, numDisplay, scoreColor, onDec, onInc, decDisabled }) => (
                  <div key={label} style={{
                    flex: 1, background: "rgba(255,255,255,.04)",
                    border: "1px solid var(--navy-border)", borderRadius: 14,
                    padding: "16px 10px 12px", display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 0,
                  }}>
                    <div style={{ fontSize: "0.58rem", color: "var(--cream-dim)",
                      fontFamily: "var(--font-d)", letterSpacing: "2px",
                      textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
                    <button onClick={onInc} style={{
                      background: "none", border: "none", color: "rgba(255,255,255,.6)",
                      fontSize: "1.8rem", lineHeight: 1, cursor: "pointer",
                      padding: "0 20px 6px", fontWeight: 300,
                    }}>+</button>
                    <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {numDisplay != null
                        ? <span style={{ fontFamily: "var(--font-d)", fontWeight: 700,
                            fontSize: "2.6rem", color: scoreColor, lineHeight: 1 }}>{numDisplay}</span>
                        : <span style={{ color: "rgba(255,255,255,.12)", fontSize: "2.6rem",
                            fontFamily: "var(--font-d)" }}>—</span>}
                    </div>
                    <button onClick={onDec} disabled={decDisabled} style={{
                      background: "none", border: "none",
                      color: decDisabled ? "rgba(255,255,255,.15)" : "rgba(255,255,255,.6)",
                      fontSize: "1.8rem", lineHeight: 1, fontWeight: 300,
                      cursor: decDisabled ? "default" : "pointer", padding: "6px 20px 0",
                    }}>−</button>
                  </div>
                ))}
              </div>

              {/* Tee shot target — par 4/5 only */}
              {(h?.par === 4 || h?.par === 5) && (
                <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontSize: "0.62rem", color: "var(--cream-dim)",
                    fontFamily: "var(--font-d)", letterSpacing: "1.5px",
                    textTransform: "uppercase", marginBottom: 10, textAlign: "center" }}>Tee Shot</div>
                  <TeeTarget
                    value={pendingStats.fairway}
                    onChange={(val) => setPendingStats(s => ({ ...s, fairway: val }))}
                  />
                  {/* Mis-Hit toggle */}
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                    <button
                      onClick={() => setPendingStats(s => ({ ...s, mishit: !s.mishit }))}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 16px", borderRadius: 20,
                        border: pendingStats.mishit ? "1.5px solid rgba(239,68,68,.5)" : "1px solid rgba(255,255,255,.12)",
                        background: pendingStats.mishit ? "rgba(239,68,68,.15)" : "rgba(255,255,255,.04)",
                        color: pendingStats.mishit ? "#f87171" : "var(--cream-dim)",
                        cursor: "pointer", fontSize: "0.75rem",
                        fontFamily: "var(--font-d)", fontWeight: pendingStats.mishit ? 700 : 400,
                      }}
                    >
                      <X size={12} /> Mis-Hit
                    </button>
                  </div>
                </div>
              )}

              {/* Penalties */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: "0.62rem", color: "var(--cream-dim)",
                  fontFamily: "var(--font-d)", letterSpacing: "1.5px",
                  textTransform: "uppercase", marginBottom: 10 }}>Penalties</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {[
                    { key: "water",  label: "Water",  Icon: Waves },
                    { key: "ob",     label: "O.B.",   Icon: Flag },
                    { key: "bunker", label: "Bunker", Icon: Mountain },
                    { key: "drop",   label: "Drop",   Icon: ArrowDownToLine },
                    { key: "penalty",label: "Penalty",Icon: AlertTriangle },
                  ].map(({ key, label, Icon }) => {
                    const active = pendingStats.penalties.includes(key);
                    return (
                      <button
                        key={key}
                        onClick={() => setPendingStats(s => ({
                          ...s,
                          penalties: active
                            ? s.penalties.filter(p => p !== key)
                            : [...s.penalties, key],
                        }))}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "8px 14px", borderRadius: 20,
                          border: active ? "1px solid rgba(239,68,68,.4)" : "1px solid var(--navy-border)",
                          cursor: "pointer", fontSize: "0.78rem",
                          fontFamily: "var(--font-d)", fontWeight: active ? 700 : 400,
                          background: active ? "rgba(239,68,68,.15)" : "rgba(255,255,255,.04)",
                          color: active ? "#f87171" : "var(--cream-dim)",
                        }}
                      >
                        <Icon size={13} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cancel link */}
              <div style={{ textAlign: "center" }}>
                <button
                  onClick={() => setNumPadOpen(false)}
                  style={{ background: "none", border: "none", color: "var(--cream-dim)",
                    fontSize: "0.8rem", cursor: "pointer", padding: "4px 12px" }}
                >Cancel</button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Scorecard view mode — horizontal cart-style ───────────────────────────
  const renderScorecardMode = () => {
    const useHcp = config.useHandicap;

    const players = [
      { name: profile?.name ?? "Me", scores, hcp: courseHandicap, getS: getStrokes, stats: holeStats },
      ...companions.map((c, i) => {
        const cHcp = c.round.course_handicap ?? 0;
        const cStats = Array.from({ length: numHoles }, (_, j) => ({
          putts: c.round.hole_stats?.[j]?.putts ?? null,
          fairway: c.round.hole_stats?.[j]?.fairway ?? null,
          penalties: c.round.hole_stats?.[j]?.penalties ?? [],
        }));
        return { name: c.member.profile?.name ?? `P${i + 2}`, scores: companionScores[i] ?? [], hcp: cHcp, getS: (si) => getStrokesFor(si, cHcp), stats: cStats };
      }),
    ];

    const totalGross = runningGross;
    const totalNet = totalGross - playedStrokes;
    const diffLabel = playedPar > 0
      ? (totalGross - playedPar === 0 ? "E" : totalGross - playedPar > 0 ? `+${totalGross - playedPar}` : `${totalGross - playedPar}`)
      : null;

    // Reusable cell styles
    const th = (extra = {}) => ({
      padding: "5px 2px", textAlign: "center", fontFamily: "var(--font-d)",
      fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.5px",
      whiteSpace: "nowrap", borderRight: "1px solid rgba(255,255,255,.06)", ...extra,
    });
    const td = (extra = {}) => ({
      padding: "4px 2px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,.06)",
      borderBottom: "1px solid rgba(255,255,255,.04)", ...extra,
    });

    const HalfTable = ({ startIdx, showTotals = false, showDetails = false }) => {
      const holes = holeData.slice(startIdx, startIdx + 9);
      const outLabel = startIdx === 0 ? "OUT" : "IN";
      const extraCols = showTotals ? 3 : 0; // TOTAL + HDCP + NET
      const teeName = course?.scorecard?.tee_name ?? "Yards";
      // rowSpan for HDCP/NET: holes row + PAR row + (yardage row if expanded) + (SI row if showTotals)
      const hdcpNetRowSpan = 2 + (showDetails ? 1 : 0) + (showTotals ? 1 : 0);

      return (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.7rem",
            minWidth: useHcp ? (showTotals ? 640 : 520) : (showTotals ? 540 : 420) }}>
            {/* ── Header ── */}
            <thead>
              {/* Section label row */}
              <tr style={{ background: "rgba(212,168,67,.14)" }}>
                <th colSpan={11 + extraCols} style={{ padding: "6px 10px", textAlign: "left",
                  fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "0.65rem",
                  letterSpacing: "2px", color: "var(--gold)", textTransform: "uppercase",
                  position: "sticky", left: 0, background: "rgba(212,168,67,.14)" }}>
                  {startIdx === 0 ? "▸ Front 9" : "▸ Back 9"}
                </th>
              </tr>
              {/* Hole number row */}
              <tr style={{ background: "rgba(255,255,255,.03)" }}>
                <th style={{ ...th({ textAlign: "left", paddingLeft: 10, width: 1,
                  position: "sticky", left: 0, background: "rgba(16,20,36,1)", zIndex: 2,
                  color: "var(--cream-dim)", fontSize: "0.55rem", letterSpacing: "1.5px" })
                }}>
                  HOLE
                </th>
                {holes.map((h, idx) => {
                  const holeNum = h.hole ?? (startIdx + idx + 1);
                  const isActive = startIdx + idx === activeHole;
                  return (
                    <th key={idx} style={th({
                      width: 26,
                      color: isActive ? "var(--gold)" : "var(--cream)",
                      fontWeight: isActive ? 900 : 700,
                      fontSize: "0.75rem",
                      background: isActive ? "rgba(212,168,67,.15)" : "transparent",
                    })}>
                      {holeNum}
                    </th>
                  );
                })}
                <th style={th({ width: 36, color: "var(--gold)",
                  borderLeft: "2px solid rgba(212,168,67,.25)", fontSize: "0.6rem" })}>{outLabel}</th>
                {showTotals && <>
                  <th style={th({ width: 40, color: "var(--gold)", fontSize: "0.6rem" })}>TOTAL</th>
                  <th rowSpan={hdcpNetRowSpan} style={th({ width: 44, color: "rgba(212,168,67,.6)", fontSize: "0.6rem",
                    verticalAlign: "middle" })}>HDCP</th>
                  <th rowSpan={hdcpNetRowSpan} style={th({ width: 44, color: "rgba(212,168,67,.6)", fontSize: "0.6rem",
                    borderRight: "none", verticalAlign: "middle" })}>NET</th>
                </>}
              </tr>
              {/* Yardage row — only when expanded */}
              {showDetails && (
                <tr style={{ background: "rgba(255,255,255,.008)" }}>
                  <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)",
                    fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
                    fontWeight: 400, position: "sticky", left: 0, background: "rgba(12,16,28,1)", zIndex: 2 })}>
                    {teeName}
                  </th>
                  {holes.map((h, idx) => (
                    <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.6rem", fontWeight: 400 })}>
                      {h.yardage ?? h.yards ?? h.distance ?? "—"}
                    </th>
                  ))}
                  <th style={th({ fontWeight: 700, color: "var(--cream-dim)",
                    borderLeft: "2px solid rgba(212,168,67,.25)" })}>
                    {holes.reduce((a, h) => a + (h.yardage ?? h.yards ?? h.distance ?? 0), 0) || "—"}
                  </th>
                  {showTotals && (
                    <th style={th({ fontWeight: 700, color: "var(--cream-dim)" })}>
                      {holeData.reduce((a, h) => a + (h.yardage ?? h.yards ?? h.distance ?? 0), 0) || "—"}
                    </th>
                  )}
                  {/* HDCP and NET covered by rowSpan */}
                </tr>
              )}
              {/* PAR row */}
              <tr style={{ background: "rgba(255,255,255,.015)" }}>
                <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)",
                  fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
                  fontWeight: 400, position: "sticky", left: 0, background: "rgba(14,18,32,1)", zIndex: 2 })}>
                  PAR
                </th>
                {holes.map((h, idx) => (
                  <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.68rem", fontWeight: 400 })}>
                    {h.par ?? "—"}
                  </th>
                ))}
                <th style={th({ fontWeight: 700, color: "var(--cream-dim)",
                  borderLeft: "2px solid rgba(212,168,67,.25)" })}>
                  {holes.reduce((a, h) => a + (h.par ?? 0), 0) || "—"}
                </th>
                {showTotals && (
                  <th style={th({ fontWeight: 700, color: "var(--cream-dim)" })}>
                    {holeData.reduce((a, h) => a + (h.par ?? 0), 0) || "—"}
                  </th>
                )}
                {/* HDCP and NET covered by rowSpan */}
              </tr>
              {/* HDCP row — only when expanded */}
              {showDetails && (
                <tr style={{ background: "rgba(255,255,255,.008)" }}>
                  <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)",
                    fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
                    fontWeight: 400, position: "sticky", left: 0, background: "rgba(12,16,28,1)", zIndex: 2 })}>
                    HDCP
                  </th>
                  {holes.map((h, idx) => (
                    <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.65rem", fontWeight: 400 })}>
                      {h.stroke_index ?? "—"}
                    </th>
                  ))}
                  <th style={th({ borderLeft: "2px solid rgba(212,168,67,.25)" })} />
                  {showTotals && <th style={th({})} />}
                  {/* HDCP col and NET col covered by rowSpan */}
                </tr>
              )}
            </thead>
            <tbody>
              {/* Compute unique display names across all players */}
              {(() => {
                const displayNames = players.map((p, i) => {
                  const parts = p.name.trim().split(/\s+/);
                  const first = parts[0].toUpperCase();
                  const last = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
                  const sameFirst = players.filter((q, j) => j !== i &&
                    q.name.trim().split(/\s+/)[0].toUpperCase() === first);
                  if (!sameFirst.length) return first;
                  // try adding last initial
                  if (last) {
                    const sameInit = sameFirst.filter(q => {
                      const qp = q.name.trim().split(/\s+/);
                      return qp.length > 1 && qp[qp.length - 1][0].toUpperCase() === last[0];
                    });
                    if (!sameInit.length) return `${first} ${last[0]}`;
                    // try two letters of last name
                    return `${first} ${last.slice(0, 2)}`;
                  }
                  return first;
                });
                return players.map((p, pi) => {
              const halfScores = p.scores.slice(startIdx, startIdx + 9);
                const halfGross = halfScores.reduce((a, s) => a + (s ?? 0), 0);
                const fullGross = p.scores.reduce((a, s) => a + (s ?? 0), 0);
                const fullStrokes = holeData.reduce((a, h, i) => a + (p.scores[i] != null ? p.getS(h.stroke_index) : 0), 0);
                const fullNet = fullGross - fullStrokes;
                const firstName = displayNames[pi];
                const rowBg = pi % 2 === 0 ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.01)";
                const stickyBg = pi % 2 === 0 ? "rgba(18,22,40,1)" : "rgba(14,18,32,1)";
                const isExpanded = expandedPlayers.has(pi);
                const toggleExpanded = () => setExpandedPlayers(prev => {
                  const next = new Set(prev);
                  next.has(pi) ? next.delete(pi) : next.add(pi);
                  return next;
                });

                // Full-round stat totals
                const allPutts = holeData.reduce((a, _, i) => a + (p.stats[i]?.putts ?? 0), 0);
                const drivingElig = holeData.filter((h, i) => (h.par === 4 || h.par === 5) && p.scores[i] != null).length;
                const drivingHits = holeData.reduce((a, h, i) =>
                  a + ((h.par === 4 || h.par === 5) && p.scores[i] != null && p.stats[i]?.fairway === "hit" ? 1 : 0), 0);
                const girElig = holeData.filter((_, i) => p.scores[i] != null && p.stats[i]?.putts != null).length;
                const girHits = holeData.reduce((a, h, i) => {
                  const sc = p.scores[i]; const pu = p.stats[i]?.putts;
                  return a + (sc != null && pu != null && (sc - pu) <= (h.par - 2) ? 1 : 0);
                }, 0);
                const totalPenalties = holeData.reduce((a, _, i) => a + (p.stats[i]?.penalties?.length ?? 0), 0);

                // Half-table stat totals (for OUT/IN column)
                const hPutts = holes.reduce((a, _, i) => a + (p.stats[startIdx + i]?.putts ?? 0), 0);
                const hDriveElig = holes.filter((h, i) => (h.par === 4 || h.par === 5) && halfScores[i] != null).length;
                const hDriveHits = holes.reduce((a, h, i) =>
                  a + ((h.par === 4 || h.par === 5) && halfScores[i] != null && p.stats[startIdx + i]?.fairway === "hit" ? 1 : 0), 0);
                const hGirElig = holes.filter((_, i) => halfScores[i] != null && p.stats[startIdx + i]?.putts != null).length;
                const hGirHits = holes.reduce((a, h, i) => {
                  const sc = halfScores[i]; const pu = p.stats[startIdx + i]?.putts;
                  return a + (sc != null && pu != null && (sc - pu) <= (h.par - 2) ? 1 : 0);
                }, 0);
                const hPenalties = holes.reduce((a, _, i) => a + (p.stats[startIdx + i]?.penalties?.length ?? 0), 0);

                return (
                  <React.Fragment key={pi}>
                    {/* Gross score row */}
                    <tr style={{ background: rowBg, borderTop: pi === 0 ? "1px solid rgba(212,168,67,.2)" : "none" }}>
                      <td onClick={toggleExpanded} style={td({ textAlign: "left", paddingLeft: 8, color: "var(--cream)",
                        fontFamily: "var(--font-d)", fontSize: "0.6rem", fontWeight: 700,
                        letterSpacing: "0.5px", position: "sticky", left: 0, cursor: "pointer",
                        background: stickyBg, zIndex: 1, whiteSpace: "nowrap", width: 1 })}>
                        <span style={{ marginRight: 3, fontSize: "0.45rem", opacity: 0.5 }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                        {firstName}
                        {useHcp && <span style={{ color: "rgba(212,168,67,.6)", fontWeight: 400,
                          fontSize: "0.5rem", marginLeft: 3 }}>[{p.hcp < 0 ? `+${Math.abs(p.hcp)}` : (p.hcp ?? 0)}]</span>}
                      </td>
                      {halfScores.map((s, i) => {
                        const strokes = useHcp ? p.getS(holes[i]?.stroke_index) : 0;
                        return (
                          <td key={i} style={td({
                            background: startIdx + i === activeHole ? "rgba(212,168,67,.06)" : "transparent",
                            cursor: "pointer",
                          })}
                            onClick={() => { setActiveHole(startIdx + i); setMode("entry"); }}>
                            {strokes !== 0 && (
                              <div style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>
                                <StrokeDots count={strokes} />
                              </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <ScoreCell score={s} par={holes[i]?.par} size={22} />
                            </div>
                          </td>
                        );
                      })}
                      <td style={td({ fontWeight: 700, color: "var(--cream)", fontSize: "0.8rem",
                        borderLeft: "2px solid rgba(212,168,67,.25)" })}>
                        {halfGross || "—"}
                      </td>
                      {showTotals && <>
                        <td style={td({ fontWeight: 900, color: "var(--cream)", fontSize: "0.85rem" })}>
                          {fullGross || "—"}
                        </td>
                        <td style={td({ fontWeight: 700, color: "rgba(212,168,67,.7)", fontSize: "0.75rem" })}>
                          {useHcp ? (p.hcp < 0 ? `+${Math.abs(p.hcp)}` : (p.hcp ?? 0)) : "—"}
                        </td>
                        <td style={td({ fontWeight: 900, color: "var(--gold)", fontSize: "0.85rem", borderRight: "none" })}>
                          {useHcp && fullGross > 0 ? fullNet : "—"}
                        </td>
                      </>}
                    </tr>
                    {/* Expanded stats rows — aligned with hole columns */}
                    {isExpanded && (() => {
                      const statTd = (extra = {}) => ({
                        padding: "3px 4px", textAlign: "center", fontSize: "0.58rem",
                        fontFamily: "var(--font-d)", color: "var(--cream-dim)",
                        borderBottom: "1px solid rgba(255,255,255,.04)", ...extra,
                      });
                      const labelTd = {
                        padding: "3px 8px", textAlign: "left", fontSize: "0.55rem",
                        letterSpacing: "0.8px", fontFamily: "var(--font-d)", color: "rgba(212,168,67,.6)",
                        fontWeight: 700, position: "sticky", left: 0, zIndex: 1,
                        background: stickyBg, borderBottom: "1px solid rgba(255,255,255,.04)",
                        whiteSpace: "nowrap", width: 1,
                      };
                      const driveCell = (f, par) => {
                        if (par === 3) return <span style={{ opacity: .3 }}>—</span>;
                        if (!f) return <span style={{ opacity: .3 }}>—</span>;
                        const map = { hit: { t: "✓", c: "#4caf7d" }, left: { t: "L", c: "#ef4444" },
                          right: { t: "R", c: "#ef4444" }, farleft: { t: "LL", c: "#ef4444" },
                          farright: { t: "RR", c: "#ef4444" }, long: { t: "LG", c: "#f59e0b" },
                          short: { t: "SH", c: "#f59e0b" } };
                        const m = map[f];
                        return m ? <span style={{ color: m.c, fontWeight: 700 }}>{m.t}</span> : <span>{f}</span>;
                      };
                      const girCell = (score, putts, par) => {
                        if (score == null || putts == null) return <span style={{ opacity: .3 }}>—</span>;
                        return (score - putts) <= (par - 2)
                          ? <span style={{ color: "#4caf7d", fontWeight: 700 }}>✓</span>
                          : <span style={{ color: "#ef4444" }}>✗</span>;
                      };
                      const statRows = [
                        {
                          label: "PUTTS",
                          cells: holes.map((_, i) => {
                            const pu = p.stats[startIdx + i]?.putts;
                            return pu != null ? <span>{pu}</span> : <span style={{ opacity: .3 }}>—</span>;
                          }),
                          half: hPutts || "—",
                          total: allPutts || "—",
                        },
                        {
                          label: "DRIVING",
                          cells: holes.map((h, i) => driveCell(p.stats[startIdx + i]?.fairway, h.par)),
                          half: hDriveElig > 0 ? `${hDriveHits}/${hDriveElig}` : "—",
                          total: drivingElig > 0 ? `${drivingHits}/${drivingElig}` : "—",
                        },
                        {
                          label: "GIR%",
                          cells: holes.map((h, i) => girCell(halfScores[i], p.stats[startIdx + i]?.putts, h.par)),
                          half: hGirElig > 0 ? `${Math.round(hGirHits / hGirElig * 100)}%` : "—",
                          total: girElig > 0 ? `${Math.round(girHits / girElig * 100)}%` : "—",
                        },
                        {
                          label: "PENALTIES",
                          cells: holes.map((_, i) => {
                            const count = p.stats[startIdx + i]?.penalties?.length ?? 0;
                            return count > 0
                              ? <span style={{ color: "#f87171", fontWeight: 700 }}>{count}</span>
                              : <span style={{ opacity: .3 }}>—</span>;
                          }),
                          half: hPenalties || "—",
                          total: totalPenalties || "—",
                        },
                      ];
                      return statRows.map((row, ri) => (
                        <tr key={ri} style={{ background: rowBg }}>
                          <td style={labelTd}>{row.label}</td>
                          {row.cells.map((cell, ci) => (
                            <td key={ci} style={statTd({
                              background: startIdx + ci === activeHole ? "rgba(212,168,67,.04)" : "transparent",
                            })}>
                              {cell}
                            </td>
                          ))}
                          <td style={statTd({ fontWeight: 700, color: "var(--cream)", borderLeft: "2px solid rgba(212,168,67,.25)" })}>
                            {row.half}
                          </td>
                          {showTotals && <>
                            <td style={statTd({ fontWeight: 700, color: "var(--cream)" })}>{row.total}</td>
                            <td style={statTd({})} />
                            <td style={statTd({ borderRight: "none" })} />
                          </>}
                        </tr>
                      ));
                    })()}
                  </React.Fragment>
                );
              });
              })()}
            </tbody>
          </table>
        </div>
      );
    };

    return (
      <div style={{ paddingBottom: 24 }}>
        {/* Course / tee header */}
        <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center",
          justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.8rem",
              color: "var(--cream)" }}>{course?.name ?? "Scorecard"}</div>
            {course?.scorecard?.tee_name && (
              <div style={{ fontSize: "0.62rem", color: "var(--gold)", fontFamily: "var(--font-d)",
                marginTop: 1 }}>{course.scorecard.tee_name} tees</div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {diffLabel && totalGross > 0 && (
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "1.1rem",
                color: diffLabel === "E" ? "var(--cream-dim)" : diffLabel.startsWith("+") ? "#ef4444" : "#4caf7d" }}>
                {diffLabel}
              </div>
            )}
            <button onClick={() => setShowDetails(d => !d)} style={{
              background: showDetails ? "rgba(212,168,67,.15)" : "rgba(255,255,255,.06)",
              border: showDetails ? "1px solid rgba(212,168,67,.4)" : "1px solid rgba(255,255,255,.12)",
              borderRadius: 6, padding: "4px 10px", cursor: "pointer",
              fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
              color: showDetails ? "var(--gold)" : "var(--cream-dim)",
            }}>
              {showDetails ? "▲ LESS" : "▼ MORE"}
            </button>
          </div>
        </div>

        {/* Front 9 */}
        <div style={{ margin: "0 10px 10px", borderRadius: 12, overflowX: "auto",
          border: "1px solid var(--navy-border)", background: "var(--navy-card)",
          WebkitOverflowScrolling: "touch" }}>
          <HalfTable startIdx={0} showDetails={showDetails} />
        </div>

        {/* Back 9 */}
        {numHoles > 9 && (
          <div style={{ margin: "0 10px 10px", borderRadius: 12, overflowX: "auto",
            border: "1px solid var(--navy-border)", background: "var(--navy-card)",
            WebkitOverflowScrolling: "touch" }}>
            <HalfTable startIdx={9} showTotals={true} showDetails={showDetails} />
          </div>
        )}

        {/* Total summary row — only for 9-hole courses (18-hole courses show totals inline in back 9 table) */}
        {totalGross > 0 && numHoles <= 9 && (
          <div style={{ margin: "0 10px", borderRadius: 12, overflow: "hidden",
            border: "1px solid rgba(212,168,67,.25)", background: "rgba(212,168,67,.06)" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.7rem" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "10px 10px", fontFamily: "var(--font-d)", fontWeight: 900,
                    fontSize: "0.6rem", letterSpacing: "2px", color: "var(--gold)",
                    textTransform: "uppercase", width: 52 }}>TOTAL</td>
                  <td style={{ padding: "10px 10px" }}>
                    <div style={{ display: "flex", gap: 24, justifyContent: "flex-end",
                      alignItems: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "0.5rem", color: "var(--cream-dim)",
                          fontFamily: "var(--font-d)", letterSpacing: "1.5px",
                          textTransform: "uppercase", marginBottom: 2 }}>GROSS</div>
                        <div style={{ fontFamily: "var(--font-d)", fontWeight: 900,
                          fontSize: "1.5rem", color: "var(--cream)", lineHeight: 1 }}>{totalGross}</div>
                      </div>
                      {useHcp && (
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "0.5rem", color: "rgba(212,168,67,.7)",
                            fontFamily: "var(--font-d)", letterSpacing: "1.5px",
                            textTransform: "uppercase", marginBottom: 2 }}>NET</div>
                          <div style={{ fontFamily: "var(--font-d)", fontWeight: 900,
                            fontSize: "1.5rem", color: "var(--gold)", lineHeight: 1 }}>{totalNet}</div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // Guard: if the course was deleted, show an error screen instead of crashing
  if (!course) {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        width: "100vw", height: "100vh", zIndex: 999999,
        background: "var(--navy, #0a0e1a)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16, padding: 24,
      }}>
        <div style={{ fontSize: "0.95rem", color: "var(--cream)", textAlign: "center", fontFamily: "var(--font-d)", fontWeight: 700 }}>
          Course not found
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--cream-dim)", textAlign: "center" }}>
          The course for this round may have been removed. You can abandon the round from the Post Score tab.
        </div>
        <button onClick={onClose} style={{
          padding: "10px 24px", borderRadius: 8, border: "none",
          background: "var(--gold)", color: "var(--navy)",
          fontFamily: "var(--font-d)", fontWeight: 700, cursor: "pointer",
        }}>Close</button>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      width: "100vw", height: "100vh", zIndex: 999999,
      background: "var(--navy, #0a0e1a)", display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--navy-card)", borderBottom: "1px solid var(--navy-border)",
        padding: "12px 16px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--cream-dim)",
              cursor: "pointer", padding: 4, flexShrink: 0 }}
          >
            <X size={20} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 700, color: "var(--cream)", fontFamily: "var(--font-d)",
              fontSize: "0.88rem", letterSpacing: "0.5px",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {course?.name ?? "Live Scoring"}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--cream-dim)" }}>
              {profile?.name}
              {courseHandicap ? ` · Hdcp ${courseHandicap}` : ""}
            </div>
          </div>
          {/* Mode toggle */}
          <div style={{ display: "flex", background: "rgba(255,255,255,.06)",
            borderRadius: 8, padding: 3, gap: 3, flexShrink: 0 }}>
            <button
              onClick={() => setMode("entry")}
              style={{
                padding: "5px 11px", borderRadius: 6,
                background: mode === "entry" ? "var(--gold)" : "transparent",
                border: "none",
                color: mode === "entry" ? "var(--navy)" : "var(--cream-dim)",
                cursor: "pointer", display: "flex", alignItems: "center",
                gap: 5, fontSize: "0.75rem", fontWeight: 600,
              }}
            >
              <Edit2 size={12} /> Entry
            </button>
            <button
              onClick={() => setMode("card")}
              style={{
                padding: "5px 11px", borderRadius: 6,
                background: mode === "card" ? "var(--gold)" : "transparent",
                border: "none",
                color: mode === "card" ? "var(--navy)" : "var(--cream-dim)",
                cursor: "pointer", display: "flex", alignItems: "center",
                gap: 5, fontSize: "0.75rem", fontWeight: 600,
              }}
            >
              <LayoutGrid size={12} /> Card
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          display: "flex", gap: 20, marginTop: 10, paddingTop: 10,
          borderTop: "1px solid var(--navy-border)", flexWrap: "wrap",
        }}>
          {[
            { label: "Thru", value: thru || "—" },
            { label: "Gross", value: runningGross || "—" },
            ...(config.useHandicap && runningGross > 0
              ? [{ label: "Net", value: runningGross - playedStrokes }]
              : []),
            ...(playedPar > 0 && runningGross > 0
              ? [{ label: "+/−", value: toPM(runningGross, playedPar), cls: pmCls(runningGross, playedPar) }]
              : []),
          ].map(({ label, value, cls }) => (
            <div key={label}>
              <div style={{ fontSize: "0.55rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                letterSpacing: "1.5px", textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-d)" }}
                className={cls ?? ""}>{value}</div>
            </div>
          ))}
          {saving && (
            <div style={{ marginLeft: "auto", fontSize: "0.62rem", color: "var(--cream-dim)",
              alignSelf: "flex-end", paddingBottom: 2 }}>Saving...</div>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {mode === "entry" ? renderEntryMode() : renderScorecardMode()}
      </div>

      {/* Submit footer */}
      <div style={{
        padding: "14px 16px 28px", background: "var(--navy-card)",
        borderTop: "1px solid var(--navy-border)", flexShrink: 0,
      }}>
        {missingAlert && (
          <div style={{
            marginBottom: 10, padding: "10px 14px", borderRadius: 8,
            background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)",
            maxWidth: 420, margin: "0 auto 10px",
          }}>
            <div style={{ fontSize: "0.72rem", color: "#f87171", fontFamily: "var(--font-d)",
              fontWeight: 700, marginBottom: 4 }}>
              Missing scores — tap a hole to enter:
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {missingAlert.map(hNum => (
                <button key={hNum} onClick={() => { setActiveHole(hNum - 1); setMode("entry"); }}
                  style={{
                    padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,.4)",
                    background: activeHole === hNum - 1 ? "rgba(239,68,68,.3)" : "rgba(239,68,68,.12)",
                    color: "#f87171", fontFamily: "var(--font-d)", fontWeight: 700,
                    fontSize: "0.72rem", cursor: "pointer",
                  }}>
                  {hNum}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitLoading}
          style={{
            width: "100%", maxWidth: 420, display: "flex", margin: "0 auto",
            padding: "14px", borderRadius: 10, border: "none",
            background: isComplete ? "var(--gold)" : "rgba(255,255,255,.06)",
            color: isComplete ? "var(--navy)" : "var(--cream-dim)",
            fontWeight: 700, fontFamily: "var(--font-d)", fontSize: "0.95rem",
            cursor: submitLoading ? "not-allowed" : "pointer",
            alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <CheckCircle size={17} />
          {submitLoading
            ? "Submitting..."
            : isComplete
              ? "Submit Round"
              : `${numHoles - thru} hole${numHoles - thru !== 1 ? "s" : ""} remaining`}
        </button>
      </div>
    </div>
  );
}
