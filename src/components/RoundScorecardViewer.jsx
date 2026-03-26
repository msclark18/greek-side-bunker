import React, { useState } from "react";

// ── Shared helpers (mirrors LiveScorecard) ────────────────────────────────────
function ScoreCell({ score, par, size = 22 }) {
  if (score == null) return <span style={{ color: "var(--cream-dim)", fontSize: "0.85rem" }}>—</span>;
  if (!par) return <span style={{ color: "var(--cream)", fontWeight: 700, fontSize: "0.88rem", fontFamily: "var(--font-d)" }}>{score}</span>;
  const diff = score - par;
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, fontSize: size > 26 ? "0.82rem" : "0.72rem", fontWeight: 700, fontFamily: "var(--font-d)", lineHeight: 1, flexShrink: 0 };
  if (diff <= -2) return <span style={{ ...base, borderRadius: "50%", border: "2px solid var(--gold)", color: "var(--gold)", outline: "2px solid var(--gold)", outlineOffset: 3 }}>{score}</span>;
  if (diff === -1) return <span style={{ ...base, borderRadius: "50%", border: "2px solid #3b82f6", color: "#3b82f6" }}>{score}</span>;
  if (diff === 0)  return <span style={{ ...base, color: "var(--cream)" }}>{score}</span>;
  if (diff === 1)  return <span style={{ ...base, border: "2px solid rgba(255,255,255,.4)", color: "var(--cream)" }}>{score}</span>;
  if (diff === 2)  return <span style={{ ...base, border: "2px solid #ef4444", color: "#ef4444" }}>{score}</span>;
  return <span style={{ ...base, border: "2px solid #ef4444", color: "#ef4444", background: "rgba(239,68,68,.15)" }}>{score}</span>;
}

function StrokeDots({ count }) {
  if (!count) return null;
  const giving = count < 0;
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: Math.abs(count) }).map((_, i) => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: giving ? "#ef4444" : "var(--gold)", display: "inline-block", flexShrink: 0, opacity: giving ? 0.8 : 1 }} />
      ))}
    </span>
  );
}

function getStrokesFor(si, hcp) {
  if (!si || !hcp) return 0;
  if (hcp > 0) {
    let s = 0;
    if (si <= hcp) s++;
    if (hcp > 18 && si <= hcp - 18) s++;
    return s;
  }
  return si > 18 - Math.abs(hcp) ? -1 : 0;
}

// ── Main viewer ───────────────────────────────────────────────────────────────
export default function RoundScorecardViewer({ round, course, playerName, useHandicap }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const holeData = course?.scorecard?.holes ?? [];
  const scores   = round.hole_scores ?? [];
  const stats    = round.hole_stats  ?? [];
  const hcp      = round.course_handicap ?? 0;
  const gross    = round.gross ?? scores.reduce((a, s) => a + (s ?? 0), 0);
  const net      = round.net  ?? gross - hcp;
  const hasStats = stats.some(s => s?.putts != null || s?.fairway || s?.penalties?.length > 0);

  const th = (extra = {}) => ({
    padding: "5px 2px", textAlign: "center", fontFamily: "var(--font-d)",
    fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.5px",
    whiteSpace: "nowrap", borderRight: "1px solid rgba(255,255,255,.06)", ...extra,
  });
  const td = (extra = {}) => ({
    padding: "4px 2px", textAlign: "center", borderRight: "1px solid rgba(255,255,255,.06)",
    borderBottom: "1px solid rgba(255,255,255,.04)", ...extra,
  });

  const HalfTable = ({ startIdx, showTotals = false }) => {
    const holes      = holeData.slice(startIdx, startIdx + 9);
    const outLabel   = startIdx === 0 ? "OUT" : "IN";
    const teeName    = course?.scorecard?.tee_name ?? "Yards";
    const hdcpRowSpan = 2 + (showDetails ? 2 : 0) + (showTotals ? 1 : 0);
    const halfScores = scores.slice(startIdx, startIdx + 9);
    const halfGross  = halfScores.reduce((a, s) => a + (s ?? 0), 0);

    // Stats for this half
    const hPutts      = holes.reduce((a, _, i) => a + (stats[startIdx + i]?.putts ?? 0), 0);
    const hDriveElig  = holes.filter((h, i) => (h.par === 4 || h.par === 5) && halfScores[i] != null).length;
    const hDriveHits  = holes.reduce((a, h, i) => a + ((h.par === 4 || h.par === 5) && halfScores[i] != null && stats[startIdx + i]?.fairway === "hit" ? 1 : 0), 0);
    const hGirElig    = holes.filter((_, i) => halfScores[i] != null && stats[startIdx + i]?.putts != null).length;
    const hGirHits    = holes.reduce((a, h, i) => { const sc = halfScores[i]; const pu = stats[startIdx + i]?.putts; return a + (sc != null && pu != null && (sc - pu) <= (h.par - 2) ? 1 : 0); }, 0);
    const hPenalties  = holes.reduce((a, _, i) => a + (stats[startIdx + i]?.penalties?.length ?? 0), 0);

    // Full-round stats (only used in TOTAL column)
    const allPutts     = holeData.reduce((a, _, i) => a + (stats[i]?.putts ?? 0), 0);
    const driveElig    = holeData.filter((h, i) => (h.par === 4 || h.par === 5) && scores[i] != null).length;
    const driveHits    = holeData.reduce((a, h, i) => a + ((h.par === 4 || h.par === 5) && scores[i] != null && stats[i]?.fairway === "hit" ? 1 : 0), 0);
    const girElig      = holeData.filter((_, i) => scores[i] != null && stats[i]?.putts != null).length;
    const girHits      = holeData.reduce((a, h, i) => { const sc = scores[i]; const pu = stats[i]?.putts; return a + (sc != null && pu != null && (sc - pu) <= (h.par - 2) ? 1 : 0); }, 0);
    const totalPens    = holeData.reduce((a, _, i) => a + (stats[i]?.penalties?.length ?? 0), 0);

    const driveCell = (f, par) => {
      if (par === 3) return <span style={{ opacity: .3 }}>—</span>;
      if (!f) return <span style={{ opacity: .3 }}>—</span>;
      const map = { hit: { t: "✓", c: "#4caf7d" }, left: { t: "L", c: "#ef4444" }, right: { t: "R", c: "#ef4444" }, farleft: { t: "LL", c: "#ef4444" }, farright: { t: "RR", c: "#ef4444" }, long: { t: "LG", c: "#f59e0b" }, short: { t: "SH", c: "#f59e0b" } };
      const m = map[f];
      return m ? <span style={{ color: m.c, fontWeight: 700 }}>{m.t}</span> : <span>{f}</span>;
    };
    const girCell = (score, putts, par) => {
      if (score == null || putts == null) return <span style={{ opacity: .3 }}>—</span>;
      return (score - putts) <= (par - 2) ? <span style={{ color: "#4caf7d", fontWeight: 700 }}>✓</span> : <span style={{ color: "#ef4444" }}>✗</span>;
    };

    const statRows = [
      { label: "PUTTS",    cells: holes.map((_, i) => { const pu = stats[startIdx+i]?.putts; return pu != null ? <span>{pu}</span> : <span style={{ opacity:.3 }}>—</span>; }), half: hPutts||"—",    total: allPutts||"—" },
      { label: "DRIVING",  cells: holes.map((h, i) => driveCell(stats[startIdx+i]?.fairway, h.par)), half: hDriveElig>0?`${hDriveHits}/${hDriveElig}`:"—", total: driveElig>0?`${driveHits}/${driveElig}`:"—" },
      { label: "GIR%",     cells: holes.map((h, i) => girCell(halfScores[i], stats[startIdx+i]?.putts, h.par)), half: hGirElig>0?`${Math.round(hGirHits/hGirElig*100)}%`:"—", total: girElig>0?`${Math.round(girHits/girElig*100)}%`:"—" },
      { label: "PENALTIES",cells: holes.map((_, i) => { const c=stats[startIdx+i]?.penalties?.length??0; return c>0?<span style={{color:"#f87171",fontWeight:700}}>{c}</span>:<span style={{opacity:.3}}>—</span>; }), half: hPenalties||"—", total: totalPens||"—" },
    ];

    return (
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.7rem", minWidth: showTotals ? 580 : 420 }}>
          <thead>
            {/* Section label */}
            <tr style={{ background: "rgba(212,168,67,.14)" }}>
              <th colSpan={showTotals ? 14 : 11} style={{ padding: "6px 10px", textAlign: "left", fontFamily: "var(--font-d)", fontWeight: 900, fontSize: "0.65rem", letterSpacing: "2px", color: "var(--gold)", textTransform: "uppercase", position: "sticky", left: 0, background: "rgba(212,168,67,.14)" }}>
                {startIdx === 0 ? "▸ Front 9" : "▸ Back 9"}
              </th>
            </tr>
            {/* Hole numbers */}
            <tr style={{ background: "rgba(255,255,255,.03)" }}>
              <th style={th({ textAlign: "left", paddingLeft: 10, width: 1, position: "sticky", left: 0, background: "rgba(16,20,36,1)", zIndex: 2, color: "var(--cream-dim)", fontSize: "0.55rem", letterSpacing: "1.5px" })}>HOLE</th>
              {holes.map((h, idx) => (
                <th key={idx} style={th({ width: 26, color: "var(--cream)", fontSize: "0.75rem" })}>
                  {h.hole ?? (startIdx + idx + 1)}
                </th>
              ))}
              <th style={th({ width: 36, color: "var(--gold)", borderLeft: "2px solid rgba(212,168,67,.25)", fontSize: "0.6rem" })}>{outLabel}</th>
              {showTotals && <>
                <th style={th({ width: 40, color: "var(--gold)", fontSize: "0.6rem" })}>TOTAL</th>
                <th rowSpan={hdcpRowSpan} style={th({ width: 44, color: "rgba(212,168,67,.6)", fontSize: "0.6rem", verticalAlign: "middle" })}>HDCP</th>
                <th rowSpan={hdcpRowSpan} style={th({ width: 44, color: "rgba(212,168,67,.6)", fontSize: "0.6rem", borderRight: "none", verticalAlign: "middle" })}>NET</th>
              </>}
            </tr>
            {/* Yardage row */}
            {showDetails && (
              <tr style={{ background: "rgba(255,255,255,.008)" }}>
                <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)", fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px", fontWeight: 400, position: "sticky", left: 0, background: "rgba(12,16,28,1)", zIndex: 2 })}>{teeName}</th>
                {holes.map((h, idx) => (
                  <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.6rem", fontWeight: 400 })}>
                    {h.yardage ?? h.yards ?? h.distance ?? "—"}
                  </th>
                ))}
                <th style={th({ fontWeight: 700, color: "var(--cream-dim)", borderLeft: "2px solid rgba(212,168,67,.25)" })}>
                  {holes.reduce((a, h) => a + (h.yardage ?? h.yards ?? h.distance ?? 0), 0) || "—"}
                </th>
                {showTotals && <th style={th({ fontWeight: 700, color: "var(--cream-dim)" })}>{holeData.reduce((a, h) => a + (h.yardage ?? h.yards ?? h.distance ?? 0), 0) || "—"}</th>}
              </tr>
            )}
            {/* PAR row */}
            <tr style={{ background: "rgba(255,255,255,.015)" }}>
              <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)", fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px", fontWeight: 400, position: "sticky", left: 0, background: "rgba(14,18,32,1)", zIndex: 2 })}>PAR</th>
              {holes.map((h, idx) => (
                <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.68rem", fontWeight: 400 })}>{h.par ?? "—"}</th>
              ))}
              <th style={th({ fontWeight: 700, color: "var(--cream-dim)", borderLeft: "2px solid rgba(212,168,67,.25)" })}>{holes.reduce((a, h) => a + (h.par ?? 0), 0) || "—"}</th>
              {showTotals && <th style={th({ fontWeight: 700, color: "var(--cream-dim)" })}>{holeData.reduce((a, h) => a + (h.par ?? 0), 0) || "—"}</th>}
            </tr>
            {/* Stroke index row */}
            {showDetails && (
              <tr style={{ background: "rgba(255,255,255,.008)" }}>
                <th style={th({ textAlign: "left", paddingLeft: 10, color: "var(--cream-dim)", fontFamily: "var(--font-d)", fontSize: "0.58rem", letterSpacing: "1px", fontWeight: 400, position: "sticky", left: 0, background: "rgba(12,16,28,1)", zIndex: 2 })}>HDCP</th>
                {holes.map((h, idx) => (
                  <th key={idx} style={th({ color: "var(--cream-dim)", fontSize: "0.65rem", fontWeight: 400 })}>{h.stroke_index ?? "—"}</th>
                ))}
                <th style={th({ borderLeft: "2px solid rgba(212,168,67,.25)" })} />
                {showTotals && <th style={th({})} />}
              </tr>
            )}
          </thead>
          <tbody>
            {/* Score row */}
            <tr style={{ background: "rgba(255,255,255,.025)", borderTop: "1px solid rgba(212,168,67,.2)" }}>
              <td style={td({ textAlign: "left", paddingLeft: 8, color: "var(--cream)", fontFamily: "var(--font-d)", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.5px", position: "sticky", left: 0, background: "rgba(18,22,40,1)", zIndex: 1, whiteSpace: "nowrap", width: 1 })}>
                {(playerName ?? "Player").trim().split(/\s+/)[0].toUpperCase()}
                {useHandicap && <span style={{ color: "rgba(212,168,67,.6)", fontWeight: 400, fontSize: "0.5rem", marginLeft: 3 }}>[{hcp < 0 ? `+${Math.abs(hcp)}` : hcp}]</span>}
              </td>
              {halfScores.map((s, i) => {
                const strokes = useHandicap ? getStrokesFor(holes[i]?.stroke_index, hcp) : 0;
                return (
                  <td key={i} style={td({})}>
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
              <td style={td({ fontWeight: 700, color: "var(--cream)", fontSize: "0.8rem", borderLeft: "2px solid rgba(212,168,67,.25)" })}>{halfGross || "—"}</td>
              {showTotals && <>
                <td style={td({ fontWeight: 900, color: "var(--cream)", fontSize: "0.85rem" })}>{gross || "—"}</td>
                <td style={td({ fontWeight: 700, color: "rgba(212,168,67,.7)", fontSize: "0.75rem" })}>
                  {useHandicap ? (hcp < 0 ? `+${Math.abs(hcp)}` : hcp) : "—"}
                </td>
                <td style={td({ fontWeight: 900, color: "var(--gold)", fontSize: "0.85rem", borderRight: "none" })}>
                  {useHandicap && gross > 0 ? net : "—"}
                </td>
              </>}
            </tr>
            {/* Stats rows */}
            {showStats && hasStats && statRows.map((row, ri) => {
              const statTd = (extra = {}) => ({ padding: "3px 4px", textAlign: "center", fontSize: "0.58rem", fontFamily: "var(--font-d)", color: "var(--cream-dim)", borderBottom: "1px solid rgba(255,255,255,.04)", ...extra });
              const labelTd = { padding: "3px 8px", textAlign: "left", fontSize: "0.55rem", letterSpacing: "0.8px", fontFamily: "var(--font-d)", color: "rgba(212,168,67,.6)", fontWeight: 700, position: "sticky", left: 0, zIndex: 1, background: "rgba(18,22,40,1)", borderBottom: "1px solid rgba(255,255,255,.04)", whiteSpace: "nowrap", width: 1 };
              return (
                <tr key={ri} style={{ background: "rgba(255,255,255,.025)" }}>
                  <td style={labelTd}>{row.label}</td>
                  {row.cells.map((cell, ci) => <td key={ci} style={statTd()}>{cell}</td>)}
                  <td style={statTd({ fontWeight: 700, color: "var(--cream)", borderLeft: "2px solid rgba(212,168,67,.25)" })}>{row.half}</td>
                  {showTotals && <>
                    <td style={statTd({ fontWeight: 700, color: "var(--cream)" })}>{row.total}</td>
                    <td style={statTd({})} /><td style={statTd({ borderRight: "none" })} />
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const par = holeData.reduce((a, h) => a + (h.par ?? 0), 0);
  const diff = gross - par;
  const diffLabel = par > 0 ? (diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`) : null;

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* Header */}
      <div style={{ padding: "10px 14px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "0.85rem", color: "var(--cream)" }}>
            {playerName ?? "Player"}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--gold)", fontFamily: "var(--font-d)", marginTop: 2 }}>
            {course?.name ?? ""}
            {course?.scorecard?.tee_name ? ` · ${course.scorecard.tee_name}` : ""}
          </div>
          {round.date && (
            <div style={{ fontSize: "0.62rem", color: "var(--cream-dim)", marginTop: 2 }}>
              {new Date(round.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: "1.4rem", fontWeight: 900, color: "var(--cream)", lineHeight: 1 }}>
            {gross || "—"}
            {diffLabel && <span style={{ fontSize: "0.7rem", color: diff < 0 ? "#3b82f6" : diff === 0 ? "var(--cream-dim)" : "#ef4444", marginLeft: 6, fontWeight: 700 }}>{diffLabel}</span>}
          </div>
          {useHandicap && gross > 0 && (
            <div style={{ fontSize: "0.65rem", color: "var(--gold)", fontFamily: "var(--font-d)", marginTop: 2 }}>
              NET {net}
            </div>
          )}
        </div>
      </div>

      {/* Toggle bar */}
      <div style={{ display: "flex", gap: 8, padding: "0 14px 10px" }}>
        <button
          onClick={() => setShowDetails(v => !v)}
          style={{ background: showDetails ? "rgba(212,168,67,.15)" : "rgba(255,255,255,.05)", border: "1px solid rgba(212,168,67,.3)", borderRadius: 6, padding: "4px 10px", fontSize: "0.6rem", fontFamily: "var(--font-d)", color: "var(--gold)", cursor: "pointer", letterSpacing: "1px" }}>
          {showDetails ? "▲ LESS" : "▼ MORE"}
        </button>
        {hasStats && (
          <button
            onClick={() => setShowStats(v => !v)}
            style={{ background: showStats ? "rgba(212,168,67,.15)" : "rgba(255,255,255,.05)", border: "1px solid rgba(212,168,67,.3)", borderRadius: 6, padding: "4px 10px", fontSize: "0.6rem", fontFamily: "var(--font-d)", color: "var(--gold)", cursor: "pointer", letterSpacing: "1px" }}>
            {showStats ? "▲ STATS" : "▼ STATS"}
          </button>
        )}
      </div>

      {/* Front 9 */}
      <div style={{ margin: "0 10px 10px", borderRadius: 12, overflowX: "auto", border: "1px solid var(--navy-border)", background: "var(--navy-card)", WebkitOverflowScrolling: "touch" }}>
        <HalfTable startIdx={0} showTotals={false} />
      </div>

      {/* Back 9 */}
      {holeData.length > 9 && (
        <div style={{ margin: "0 10px 10px", borderRadius: 12, overflowX: "auto", border: "1px solid var(--navy-border)", background: "var(--navy-card)", WebkitOverflowScrolling: "touch" }}>
          <HalfTable startIdx={9} showTotals={true} />
        </div>
      )}
    </div>
  );
}
