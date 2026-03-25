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
function StrokeDots({ count }) {
  if (!count) return null;
  return (
    <span style={{ display: "inline-flex", gap: 2, marginLeft: 3 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "var(--gold)", display: "inline-block", flexShrink: 0,
        }} />
      ))}
    </span>
  );
}

// ── Tee shot D-pad target ────────────────────────────────────────────────────
function TeeTarget({ value, onChange }) {
  const on = (k) => value === k;
  const tap = (k) => onChange(value === k ? null : k);

  const Btn = ({ k, Icon, w = 44, h = 44, br = 10 }) => {
    const active = on(k);
    return (
      <button onClick={() => tap(k)} style={{
        width: w, height: h, borderRadius: br,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: active ? "2px solid rgba(160,195,255,.8)" : "1.5px solid rgba(255,255,255,.1)",
        background: active ? "rgba(100,150,230,.22)" : "rgba(255,255,255,.06)",
        color: active ? "rgba(180,215,255,1)" : "rgba(255,255,255,.4)",
        cursor: "pointer", transition: "all .12s", flexShrink: 0,
      }}>
        <Icon size={17} strokeWidth={2.2} />
      </button>
    );
  };

  const hitActive = on("hit");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      gap: 5, userSelect: "none" }}>
      {/* Long */}
      <Btn k="long" Icon={ChevronUp} w={56} h={36} br="10px 10px 6px 6px" />
      {/* Middle row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Btn k="farleft"  Icon={ChevronsLeft}  w={44} h={56} br="10px 6px 6px 10px" />
        <Btn k="left"     Icon={ChevronLeft}   w={36} h={56} br={6} />
        {/* HIT center */}
        <button onClick={() => tap("hit")} style={{
          width: 68, height: 68, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: hitActive ? "2.5px solid #4caf7d" : "2px solid rgba(255,255,255,.15)",
          background: hitActive ? "rgba(76,175,125,.28)" : "rgba(255,255,255,.07)",
          cursor: "pointer", transition: "all .14s", flexShrink: 0,
          boxShadow: hitActive ? "0 0 16px rgba(76,175,125,.35)" : "none",
        }}>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "0.88rem",
            color: hitActive ? "#4caf7d" : "rgba(255,255,255,.55)",
            letterSpacing: "0.5px" }}>HIT</span>
        </button>
        <Btn k="right"    Icon={ChevronRight}  w={36} h={56} br={6} />
        <Btn k="farright" Icon={ChevronsRight} w={44} h={56} br="6px 10px 10px 6px" />
      </div>
      {/* Short */}
      <Btn k="short" Icon={ChevronDown} w={56} h={36} br="6px 6px 10px 10px" />
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
  const [activeHole, setActiveHole] = useState(() => {
    const existing = round.hole_scores ?? [];
    const firstEmpty = existing.findIndex(s => s == null);
    return firstEmpty === -1 ? 0 : Math.max(0, firstEmpty);
  });
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
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

  // How many strokes does this player get on a given hole?
  const getStrokes = (si) => {
    if (!si || !courseHandicap) return 0;
    let s = 0;
    if (si <= courseHandicap) s++;
    if (courseHandicap > 18 && si <= courseHandicap - 18) s++;
    return s;
  };

  // getStrokes for a specific courseHandicap (for companions)
  const getStrokesFor = (si, hcp) => {
    if (!si || !hcp) return 0;
    let s = 0;
    if (si <= hcp) s++;
    if (hcp > 18 && si <= hcp - 18) s++;
    return s;
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
  const activeScores = activePlayerId === 0 ? scores : (companionScores[activePlayerId - 1] ?? []);

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

  const clearScore = (holeIdx) => {
    if (activePlayerId === 0) {
      const next = [...scores];
      next[holeIdx] = null;
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
        next[cIdx][holeIdx] = null;
        saveCompanionScore(cIdx, next[cIdx]);
        return next;
      });
    }
  };

  const handleSubmit = async () => {
    if (submitLoading) return;
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

    const mainScores = scores;
    const firstMainEmpty = mainScores.findIndex(s => s == null);

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
                    {pStrokes > 0 && <StrokeDots count={pStrokes} />}
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
                      padding: "8px 14px", borderRadius: 8, border: "none",
                      background: "var(--gold)", color: "var(--navy)",
                      fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.78rem",
                      cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                    }}
                  >Add Score</button>
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
          {(() => {
            const firstEmpty = mainScores.findIndex(s => s == null);
            return Array.from({ length: numHoles }, (_, i) => {
              const isAccessible = mainScores[i] != null || i === firstEmpty || firstEmpty === -1;
              return (
                <button
                  key={i}
                  onClick={() => { if (isAccessible) { setActiveHole(i); setNumPadOpen(false); } }}
                  style={{
                    width: 26, height: 26, borderRadius: "50%", border: "none",
                    background: i === activeHole
                      ? "var(--gold)"
                      : mainScores[i] != null ? "rgba(76,175,125,.25)" : "rgba(255,255,255,.06)",
                    color: i === activeHole
                      ? "var(--navy)"
                      : mainScores[i] != null ? "#6ee7a0" : "var(--cream-dim)",
                    cursor: isAccessible ? "pointer" : "default",
                    opacity: isAccessible ? 1 : 0.4,
                    fontSize: "0.6rem",
                    fontFamily: "var(--font-d)", fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {mainScores[i] != null ? mainScores[i] : i + 1}
                </button>
              );
            });
          })()}
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
                    // Save stats (only for main player for now)
                    if (activePlayerId === 0) {
                      const nextStats = holeStats.map((s, i) => i === activeHole ? pendingStats : s);
                      setHoleStats(nextStats);
                      saveStats(nextStats);
                    }
                    enterScore(activeHole, pendingScore);
                    // Build updated scores for all players on this hole
                    const updatedAll = allPlayers.map((p, idx) =>
                      idx === activePlayerId ? pendingScore : p.scores[activeHole]
                    );
                    const allDone = updatedAll.every(s => s != null);
                    if (allDone) {
                      // All players scored — close sheet and advance hole
                      setNumPadOpen(false);
                      setActivePlayerId(0);
                      const mainScores = activePlayerId === 0
                        ? (() => { const n = [...scores]; n[activeHole] = pendingScore; return n; })()
                        : scores;
                      const nextEmpty = mainScores.findIndex((s, i) => i > activeHole && s == null);
                      if (nextEmpty !== -1) setActiveHole(nextEmpty);
                      else if (activeHole < numHoles - 1) setActiveHole(activeHole + 1);
                    } else {
                      // Find the first player (any index) still missing a score on this hole
                      const nextPIdx = updatedAll.findIndex(s => s == null);
                      if (nextPIdx !== -1) {
                        setActivePlayerId(nextPIdx);
                        const nextP = allPlayers[nextPIdx];
                        setPendingScore(nextP?.scores[activeHole] ?? h?.par ?? null);
                        setPendingStats({ putts: 2, fairway: null, mishit: false, penalties: [] });
                      } else {
                        setNumPadOpen(false);
                      }
                    }
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
                <div style={{ marginBottom: 20 }}>
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
      { name: profile?.name ?? "Me", scores, hcp: courseHandicap, getS: getStrokes },
      ...companions.map((c, i) => {
        const cHcp = c.round.course_handicap ?? 0;
        return { name: c.member.profile?.name ?? `P${i + 2}`, scores: companionScores[i] ?? [], hcp: cHcp, getS: (si) => getStrokesFor(si, cHcp) };
      }),
    ];

    const totalGross = runningGross;
    const totalNet = totalGross - playedStrokes;
    const diffLabel = playedPar > 0
      ? (totalGross - playedPar === 0 ? "E" : totalGross - playedPar > 0 ? `+${totalGross - playedPar}` : `${totalGross - playedPar}`)
      : null;

    // Reusable cell styles
    const th = (extra = {}) => ({
      padding: "6px 5px", textAlign: "center", fontFamily: "var(--font-d)",
      fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.5px",
      whiteSpace: "nowrap", borderRight: "1px solid rgba(255,255,255,.06)", ...extra,
    });
    const td = (extra = {}) => ({
      padding: "5px 4px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,.06)",
      borderBottom: "1px solid rgba(255,255,255,.04)", ...extra,
    });

    const HalfTable = ({ startIdx }) => {
      const holes = holeData.slice(startIdx, startIdx + 9);
      const halfPar = holes.reduce((a, h) => a + (h.par ?? 0), 0);
      const outLabel = startIdx === 0 ? "OUT" : "IN";

      return (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.7rem", tableLayout: "fixed",
            minWidth: useHcp ? 520 : 420 }}>
            {/* ── Header ── */}
            <thead>
              {/* Section label row */}
              <tr style={{ background: "rgba(212,168,67,.14)" }}>
                <th colSpan={11} style={{ padding: "6px 10px", textAlign: "left",
                  fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "0.65rem",
                  letterSpacing: "2px", color: "var(--gold)", textTransform: "uppercase",
                  position: "sticky", left: 0, background: "rgba(212,168,67,.14)" }}>
                  {startIdx === 0 ? "▸ Front 9" : "▸ Back 9"}
                </th>
              </tr>
              {/* Hole number row */}
              <tr style={{ background: "rgba(255,255,255,.03)" }}>
                <th style={{ ...th({ textAlign: "left", paddingLeft: 10, width: 52,
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
                      width: 30,
                      color: isActive ? "var(--gold)" : "var(--cream)",
                      fontWeight: isActive ? 900 : 700,
                      fontSize: "0.75rem",
                      background: isActive ? "rgba(212,168,67,.15)" : "transparent",
                    })}>
                      {holeNum}
                    </th>
                  );
                })}
                <th style={th({ width: 36, color: "var(--gold)", borderLeft: "2px solid rgba(212,168,67,.25)",
                  borderRight: "none", fontSize: "0.6rem" })}>{outLabel}</th>
              </tr>
            </thead>
            <tbody>
              {/* Par row */}
              <tr style={{ background: "rgba(255,255,255,.015)" }}>
                <td style={td({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)",
                  fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
                  position: "sticky", left: 0, background: "rgba(14,18,32,1)", zIndex: 1 })}>
                  PAR
                </td>
                {holes.map((h, idx) => (
                  <td key={idx} style={td({ color: "var(--cream-dim)", fontSize: "0.68rem" })}>
                    {h.par ?? "—"}
                  </td>
                ))}
                <td style={td({ fontWeight: 700, color: "var(--cream-dim)",
                  borderLeft: "2px solid rgba(212,168,67,.25)", borderRight: "none" })}>
                  {halfPar || "—"}
                </td>
              </tr>
              {/* Hdcp row */}
              <tr style={{ background: "rgba(255,255,255,.008)" }}>
                <td style={td({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)",
                  fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px",
                  position: "sticky", left: 0, background: "rgba(12,16,28,1)", zIndex: 1 })}>
                  HDCP
                </td>
                {holes.map((h, idx) => {
                  const s = players[0].getS(h.stroke_index);
                  return (
                    <td key={idx} style={td({ color: s > 0 ? "var(--gold)" : "var(--cream-dim)",
                      fontSize: "0.65rem" })}>
                      <div>{h.stroke_index ?? "—"}</div>
                      {s > 0 && <div style={{ display: "flex", justifyContent: "center", marginTop: 1 }}>
                        <StrokeDots count={s} />
                      </div>}
                    </td>
                  );
                })}
                <td style={td({ borderLeft: "2px solid rgba(212,168,67,.25)", borderRight: "none" })} />
              </tr>
              {/* Player rows */}
              {players.map((p, pi) => {
                const halfScores = p.scores.slice(startIdx, startIdx + 9);
                const halfGross = halfScores.reduce((a, s) => a + (s ?? 0), 0);
                const halfStrokes = holes.reduce((a, h, i) => a + (halfScores[i] != null ? p.getS(h.stroke_index) : 0), 0);
                const halfNet = halfGross - halfStrokes;
                const firstName = p.name.split(" ")[0].toUpperCase().slice(0, 7);
                const rowBg = pi % 2 === 0 ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.01)";
                const stickyBg = pi % 2 === 0 ? "rgba(18,22,40,1)" : "rgba(14,18,32,1)";
                return (
                  <React.Fragment key={pi}>
                    {/* Gross score row */}
                    <tr style={{ background: rowBg, borderTop: pi === 0 ? "1px solid rgba(212,168,67,.2)" : "none" }}>
                      <td style={td({ textAlign: "left", paddingLeft: 10, color: "var(--cream)",
                        fontFamily: "var(--font-d)", fontSize: "0.6rem", fontWeight: 700,
                        letterSpacing: "0.5px", position: "sticky", left: 0,
                        background: stickyBg, zIndex: 1 })}>
                        {firstName}
                        {p.hcp > 0 && <span style={{ color: "rgba(212,168,67,.6)", fontWeight: 400,
                          fontSize: "0.5rem", marginLeft: 3 }}>[{p.hcp}]</span>}
                      </td>
                      {halfScores.map((s, i) => (
                        <td key={i} style={td({
                          background: startIdx + i === activeHole ? "rgba(212,168,67,.06)" : "transparent",
                          cursor: "pointer",
                        })}
                          onClick={() => { setActiveHole(startIdx + i); setMode("entry"); }}>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <ScoreCell score={s} par={holes[i]?.par} size={24} />
                          </div>
                        </td>
                      ))}
                      <td style={td({ fontWeight: 700, color: "var(--cream)", fontSize: "0.8rem",
                        borderLeft: "2px solid rgba(212,168,67,.25)", borderRight: "none" })}>
                        {halfGross || "—"}
                      </td>
                    </tr>
                    {/* Net row */}
                    {useHcp && p.hcp > 0 && (
                      <tr style={{ background: "rgba(212,168,67,.025)" }}>
                        <td style={td({ textAlign: "left", paddingLeft: 10, color: "rgba(212,168,67,.6)",
                          fontFamily: "var(--font-d)", fontSize: "0.52rem", letterSpacing: "1px",
                          position: "sticky", left: 0, background: "rgba(16,20,34,1)", zIndex: 1 })}>
                          NET
                        </td>
                        {halfScores.map((s, i) => {
                          const strokes = p.getS(holes[i]?.stroke_index);
                          const net = s != null ? s - strokes : null;
                          return (
                            <td key={i} style={td({ fontSize: "0.62rem" })}>
                              {net != null ? (
                                <span style={{ fontFamily: "var(--font-d)", fontWeight: 600,
                                  color: net < (holes[i]?.par ?? 99) ? "#4caf7d"
                                    : net === (holes[i]?.par ?? 99) ? "rgba(255,255,255,.4)"
                                    : "rgba(255,255,255,.6)" }}>{net}</span>
                              ) : <span style={{ color: "rgba(255,255,255,.1)" }}>—</span>}
                            </td>
                          );
                        })}
                        <td style={td({ fontWeight: 700, color: "var(--gold)", fontSize: "0.8rem",
                          borderLeft: "2px solid rgba(212,168,67,.25)", borderRight: "none" })}>
                          {halfGross > 0 ? halfNet : "—"}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
          {diffLabel && totalGross > 0 && (
            <div style={{ fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "1.1rem",
              color: diffLabel === "E" ? "var(--cream-dim)" : diffLabel.startsWith("+") ? "#ef4444" : "#4caf7d" }}>
              {diffLabel}
            </div>
          )}
        </div>

        {/* Front 9 */}
        <div style={{ margin: "0 10px 10px", borderRadius: 12, overflow: "hidden",
          border: "1px solid var(--navy-border)", background: "var(--navy-card)" }}>
          <HalfTable startIdx={0} />
        </div>

        {/* Back 9 */}
        {numHoles > 9 && (
          <div style={{ margin: "0 10px 10px", borderRadius: 12, overflow: "hidden",
            border: "1px solid var(--navy-border)", background: "var(--navy-card)" }}>
            <HalfTable startIdx={9} />
          </div>
        )}

        {/* Total summary row */}
        {totalGross > 0 && (
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
        <button
          onClick={handleSubmit}
          disabled={!isComplete || submitLoading}
          style={{
            width: "100%", maxWidth: 420, display: "flex", margin: "0 auto",
            padding: "14px", borderRadius: 10, border: "none",
            background: isComplete ? "var(--gold)" : "rgba(255,255,255,.06)",
            color: isComplete ? "var(--navy)" : "var(--cream-dim)",
            fontWeight: 700, fontFamily: "var(--font-d)", fontSize: "0.95rem",
            cursor: isComplete ? "pointer" : "not-allowed",
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
