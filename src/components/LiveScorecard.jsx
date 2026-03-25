import { useState, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { calcStableford, toPM, pmCls } from "../utils/golf.js";
import { X, Edit2, LayoutGrid, ChevronDown, CheckCircle, Eraser } from "lucide-react";

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

// ── Main component ───────────────────────────────────────────────────────────
export default function LiveScorecard({
  round, course, courseHandicap, config, profile,
  members, activeLeague, setRounds, onComplete, onClose,
}) {
  const numHoles = course?.holes ?? 18;

  const holeData = course?.scorecard?.holes?.length
    ? course.scorecard.holes
    : Array.from({ length: numHoles }, (_, i) => ({ hole: i + 1, par: null, stroke_index: null }));

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
  const [numPadOpen, setNumPadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const saveTimeout = useRef(null);

  // How many strokes does this player get on a given hole?
  const getStrokes = (si) => {
    if (!si || !courseHandicap) return 0;
    let s = 0;
    if (si <= courseHandicap) s++;
    if (courseHandicap > 18 && si <= courseHandicap - 18) s++;
    return s;
  };

  const thru = scores.filter(s => s != null).length;
  const runningGross = scores.filter(s => s != null).reduce((a, b) => a + b, 0);
  const playedPar = holeData.slice(0, thru).reduce((a, h) => a + (h.par ?? 0), 0);
  const isComplete = thru === numHoles;

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

  const enterScore = (holeIdx, score) => {
    const next = [...scores];
    next[holeIdx] = score;
    setScores(next);
    setNumPadOpen(false);
    // Auto-advance to next unfilled hole
    const nextEmpty = next.findIndex((s, i) => i > holeIdx && s == null);
    if (nextEmpty !== -1) setActiveHole(nextEmpty);
    saveScores(next);
  };

  const clearScore = (holeIdx) => {
    const next = [...scores];
    next[holeIdx] = null;
    setScores(next);
    saveScores(next);
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
    setSubmitLoading(false);
    onComplete(updated);
  };

  // ── Entry mode ─────────────────────────────────────────────────────────────
  const renderEntryMode = () => (
    <div style={{ paddingBottom: numPadOpen ? 248 : 96 }}>
      {/* Column headers */}
      <div style={{
        display: "flex", alignItems: "center", padding: "6px 16px",
        borderBottom: "1px solid var(--navy-border)",
        fontSize: "0.6rem", letterSpacing: "1.5px", textTransform: "uppercase",
        color: "var(--cream-dim)", fontFamily: "var(--font-d)",
      }}>
        <div style={{ width: 28 }}>#</div>
        <div style={{ width: 36 }}>Par</div>
        <div style={{ width: 44 }}>Yds</div>
        <div style={{ flex: 1 }}>SI</div>
        <div style={{ width: 44, textAlign: "right" }}>Score</div>
      </div>

      {holeData.map((h, i) => {
        const strokes = getStrokes(h.stroke_index);
        const score = scores[i];
        const isActive = i === activeHole;
        return (
          <div
            key={h.hole}
            onClick={() => { setActiveHole(i); setNumPadOpen(true); }}
            style={{
              display: "flex", alignItems: "center", padding: "11px 16px",
              background: isActive
                ? "rgba(212,168,67,.07)"
                : i % 2 === 0 ? "rgba(255,255,255,.015)" : "transparent",
              borderLeft: isActive ? "3px solid var(--gold)" : "3px solid transparent",
              cursor: "pointer",
              // Divider between front/back 9
              borderTop: i === 9 ? "1px solid var(--navy-border)" : "none",
            }}
          >
            <div style={{
              width: 28, fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.82rem",
              color: isActive ? "var(--gold)" : "var(--cream-dim)",
            }}>
              {h.hole}
            </div>
            <div style={{ width: 36, fontSize: "0.8rem", color: "var(--cream-dim)" }}>
              {h.par ?? "—"}
            </div>
            <div style={{ width: 44, fontSize: "0.75rem", color: "var(--cream-dim)" }}>
              {h.yards ?? "—"}
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", fontSize: "0.75rem", color: "var(--cream-dim)" }}>
              {h.stroke_index ?? "—"}
              <StrokeDots count={strokes} />
            </div>
            <div style={{ width: 44, display: "flex", justifyContent: "flex-end" }}>
              <ScoreCell score={score} par={h.par} />
            </div>
          </div>
        );
      })}

      {/* Totals row */}
      <div style={{ borderTop: "1px solid var(--navy-border)", margin: "8px 16px 0" }} />
      <div style={{
        display: "flex", justifyContent: "space-between", padding: "10px 16px",
        fontSize: "0.8rem", color: "var(--cream-dim)",
      }}>
        <span>Total Par: {holeData.reduce((a, h) => a + (h.par ?? 0), 0) || "—"}</span>
        <span style={{ color: "var(--cream)", fontWeight: 700 }}>
          Gross: {runningGross || "—"}
        </span>
      </div>
    </div>
  );

  // ── Scorecard view mode (traditional layout) ───────────────────────────────
  const renderScorecardMode = () => {
    const front = holeData.slice(0, 9);
    const back = holeData.slice(9, 18);
    const frontScores = scores.slice(0, 9);
    const backScores = scores.slice(9, 18);
    const frontPar = front.reduce((a, h) => a + (h.par ?? 0), 0);
    const backPar = back.reduce((a, h) => a + (h.par ?? 0), 0);
    const frontGross = frontScores.reduce((a, s) => a + (s ?? 0), 0);
    const backGross = backScores.reduce((a, s) => a + (s ?? 0), 0);
    const firstName = profile?.name?.split(" ")[0]?.toUpperCase() ?? "ME";

    const Half = ({ label, holes, holeScores, totalPar, totalGross }) => (
      <div style={{
        margin: "0 12px 16px", borderRadius: 10, overflow: "hidden",
        border: "1px solid var(--navy-border)", background: "rgba(255,255,255,.02)",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem", minWidth: 360 }}>
            <thead>
              <tr style={{ background: "rgba(212,168,67,.07)" }}>
                <th style={{ padding: "7px 8px", textAlign: "left", color: "var(--gold)",
                  fontFamily: "var(--font-d)", letterSpacing: "1.5px", fontSize: "0.6rem",
                  whiteSpace: "nowrap" }}>{label}</th>
                {holes.map(h => (
                  <th key={h.hole} style={{ padding: "7px 4px", textAlign: "center",
                    color: "var(--cream-dim)", fontFamily: "var(--font-d)", width: 30,
                    minWidth: 28 }}>{h.hole}</th>
                ))}
                <th style={{ padding: "7px 8px", textAlign: "center", color: "var(--gold)",
                  fontFamily: "var(--font-d)", whiteSpace: "nowrap" }}>TOT</th>
              </tr>
            </thead>
            <tbody>
              {/* Par row */}
              <tr style={{ borderBottom: "1px solid var(--navy-border)" }}>
                <td style={{ padding: "6px 8px", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                  fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase" }}>Par</td>
                {holes.map(h => (
                  <td key={h.hole} style={{ padding: "6px 4px", textAlign: "center",
                    color: "var(--cream-dim)" }}>{h.par ?? "—"}</td>
                ))}
                <td style={{ padding: "6px 8px", textAlign: "center",
                  color: "var(--cream-dim)", fontWeight: 700 }}>{totalPar || "—"}</td>
              </tr>
              {/* Stroke index row */}
              <tr style={{ borderBottom: "1px solid var(--navy-border)" }}>
                <td style={{ padding: "6px 8px", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                  fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase" }}>SI</td>
                {holes.map(h => (
                  <td key={h.hole} style={{ padding: "6px 4px", textAlign: "center",
                    color: "var(--cream-dim)" }}>
                    <div>{h.stroke_index ?? "—"}</div>
                    {getStrokes(h.stroke_index) > 0 && (
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <StrokeDots count={getStrokes(h.stroke_index)} />
                      </div>
                    )}
                  </td>
                ))}
                <td />
              </tr>
              {/* Player score row */}
              <tr>
                <td style={{ padding: "8px 8px", color: "var(--cream)", fontFamily: "var(--font-d)",
                  fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase",
                  whiteSpace: "nowrap" }}>{firstName}</td>
                {holeScores.map((s, i) => (
                  <td key={i} style={{ padding: "5px 4px", textAlign: "center" }}>
                    <ScoreCell score={s} par={holes[i]?.par} size={24} />
                  </td>
                ))}
                <td style={{ padding: "8px 8px", textAlign: "center" }}>
                  {totalGross > 0
                    ? <span style={{ color: "var(--cream)", fontWeight: 700,
                        fontFamily: "var(--font-d)" }}>{totalGross}</span>
                    : <span style={{ color: "var(--cream-dim)" }}>—</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );

    return (
      <div style={{ paddingBottom: 96 }}>
        <Half label="FRONT" holes={front} holeScores={frontScores} totalPar={frontPar} totalGross={frontGross} />
        {numHoles > 9 && (
          <Half label="BACK" holes={back} holeScores={backScores} totalPar={backPar} totalGross={backGross} />
        )}
        {/* Total summary */}
        <div style={{
          margin: "0 12px", padding: "12px 16px", borderRadius: 10,
          border: "1px solid var(--navy-border)", background: "rgba(255,255,255,.02)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: 12,
        }}>
          <span style={{ color: "var(--cream-dim)", fontFamily: "var(--font-d)",
            fontSize: "0.65rem", letterSpacing: "1.5px", textTransform: "uppercase" }}>TOTAL</span>
          <div style={{ display: "flex", gap: 24 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.58rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                letterSpacing: "1px", textTransform: "uppercase" }}>Par</div>
              <div style={{ color: "var(--cream)", fontWeight: 700 }}>{frontPar + backPar || "—"}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.58rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                letterSpacing: "1px", textTransform: "uppercase" }}>Gross</div>
              <div style={{ color: "var(--cream)", fontWeight: 700, fontSize: "1.15rem",
                fontFamily: "var(--font-d)" }}>{runningGross || "—"}</div>
            </div>
            {config.useHandicap && runningGross > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.58rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)",
                  letterSpacing: "1px", textTransform: "uppercase" }}>Net</div>
                <div style={{ color: "var(--cream)", fontWeight: 700, fontSize: "1.15rem",
                  fontFamily: "var(--font-d)" }}>{runningGross - courseHandicap}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Number pad (bottom sheet, entry mode only) ─────────────────────────────
  const renderNumPad = () => {
    if (!numPadOpen || mode !== "entry") return null;
    const h = holeData[activeHole];
    return (
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 400,
        background: "var(--navy-card)", borderTop: "1px solid var(--navy-border)",
        padding: "12px 16px 28px",
      }}>
        <div style={{ maxWidth: 380, margin: "0 auto" }}>
          {/* Hole info + dismiss */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-d)", fontWeight: 700, color: "var(--cream)", fontSize: "0.9rem" }}>
                Hole {activeHole + 1}
              </span>
              {h?.par && (
                <span style={{ fontSize: "0.75rem", color: "var(--cream-dim)" }}>
                  Par {h.par}{h.stroke_index ? ` · SI ${h.stroke_index}` : ""}
                </span>
              )}
              {getStrokes(h?.stroke_index) > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", color: "var(--gold)" }}>
                  <StrokeDots count={getStrokes(h?.stroke_index)} />
                  {getStrokes(h?.stroke_index) === 1 ? "1 stroke" : "2 strokes"}
                </span>
              )}
            </div>
            <button
              onClick={() => setNumPadOpen(false)}
              style={{ background: "none", border: "none", color: "var(--cream-dim)", cursor: "pointer", padding: 4 }}
            >
              <ChevronDown size={20} />
            </button>
          </div>
          {/* Number grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
              <button
                key={n}
                onClick={() => enterScore(activeHole, n)}
                style={{
                  padding: "15px 0", borderRadius: 8, cursor: "pointer",
                  background: scores[activeHole] === n ? "var(--gold)" : "rgba(255,255,255,.06)",
                  border: scores[activeHole] === n ? "none" : "1px solid var(--navy-border)",
                  color: scores[activeHole] === n ? "var(--navy)" : "var(--cream)",
                  fontSize: "1.05rem", fontFamily: "var(--font-d)", fontWeight: 700,
                }}
              >{n}</button>
            ))}
            <button
              onClick={() => clearScore(activeHole)}
              style={{
                padding: "15px 0", borderRadius: 8, gridColumn: "span 2",
                background: "rgba(255,255,255,.04)", border: "1px solid var(--navy-border)",
                color: "var(--cream-dim)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                fontSize: "0.85rem",
              }}
            >
              <Eraser size={14} /> Clear
            </button>
            <button
              onClick={() => setNumPadOpen(false)}
              style={{
                padding: "15px 0", borderRadius: 8, gridColumn: "span 2",
                background: "var(--gold)", border: "none",
                color: "var(--navy)", fontWeight: 700, fontFamily: "var(--font-d)",
                cursor: "pointer", fontSize: "0.95rem",
              }}
            >Done</button>
          </div>
        </div>
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
              ? [{ label: "Net", value: runningGross - courseHandicap }]
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
      {!numPadOpen && (
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
      )}

      {/* Number pad */}
      {renderNumPad()}
    </div>
  );
}
