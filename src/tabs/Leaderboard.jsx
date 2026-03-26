import { useState } from "react";
import { supabase } from "../supabase.js";
import { calcCourseHcp, toPM, pmCls, ini } from "../utils/golf.js";
import { DEFAULT_CONFIG, FORMAT_LABELS } from "../constants/config.js";
import { resolveCatMap, resolvePayouts } from "../utils/payouts.js";
import GhinLink from "../components/GhinLink.jsx";
import { Trophy, Star, ClipboardList, FileText, BarChart2, Flag, DollarSign, MapPin, AlertTriangle, Clock, Radio } from "lucide-react";

export default function Leaderboard({
  config, courses, members, rounds, payouts,
  session, activeLeague, isAdmin,
  overallLB, grossLB, courseLB, bestNetLB, bestGrossLB,
  teamLB, tournamentRoundLB, tournamentOverallLB,
  completionData, scored, myHasSubmitted,
  selCourse, setSelCourse,
  setConfig, setViewCardModal,
}) {
  const [leaderTab, setLeaderTab] = useState(() => {
    const saved = sessionStorage.getItem("gsb_leader_tab");
    return saved ?? (config.tournamentMode ? "tournament" : "overall");
  });
  const setLeaderTabPersisted = (t) => { setLeaderTab(t); sessionStorage.setItem("gsb_leader_tab", t); };
  const [scoresFilterPlayer, setScoresFilterPlayer] = useState("all");
  const [scoresFilterCourse, setScoresFilterCourse] = useState("all");
  const [roundsModal, setRoundsModal] = useState(null);

  const rankEl = (i) => (
    <td className={`rc ${i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : ""}`}>
      {i + 1}
    </td>
  );

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const saveBracket = async (newBracket, newThirdPlace) => {
    const newCfg = {
      ...config,
      playoffBracket: newBracket,
      thirdPlaceMatch: newThirdPlace !== undefined ? newThirdPlace : (config.thirdPlaceMatch ?? null),
    };
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
  };

  const TEAM_FORMATS = ["scramble", "texas_scramble", "best_ball"];
  const hasTeams = (config.scrambleTeams ?? []).length > 0 && TEAM_FORMATS.includes(config.scoringFormat);

  // Resolve player display names — team.players may store UUIDs (from seed/API) or name strings
  const memberNameById = Object.fromEntries(members.filter(m => m.profile).map(m => [m.user_id, m.profile.name]));
  const rpn = (nameOrId) => memberNameById[nameOrId] ?? nameOrId;

  // Team-derived standings for scramble (non-tournament) leagues
  const teamGrossLB = hasTeams
    ? (config.scrambleTeams ?? []).map(team => {
        const tr = scored.filter(r => String(r.team_id) === String(team.id));
        if (!tr.length) return null;
        const avg = tr.reduce((s, r) => s + r.gross, 0) / tr.length;
        return { ...team, avg, label: avg.toFixed(1), totalRounds: tr.length, pr: tr };
      }).filter(Boolean).sort((a, b) => a.avg - b.avg)
    : [];
  const teamBestNetLB = hasTeams
    ? (config.scrambleTeams ?? []).map(team => {
        const tr = scored.filter(r => String(r.team_id) === String(team.id) && r.net != null);
        if (!tr.length) return null;
        const best = tr.reduce((m, r) => r.net < m.net ? r : m);
        return { ...team, best };
      }).filter(Boolean).sort((a, b) => a.best.net - b.best.net)
    : [];
  const teamBestGrossLB = hasTeams
    ? (config.scrambleTeams ?? []).map(team => {
        const tr = scored.filter(r => String(r.team_id) === String(team.id));
        if (!tr.length) return null;
        const best = tr.reduce((m, r) => r.gross < m.gross ? r : m);
        return { ...team, best };
      }).filter(Boolean).sort((a, b) => a.best.gross - b.best.gross)
    : [];

  const [tournamentRoundTab, setTournamentRoundTab] = useState("overall");
  const [tournamentNetGross, setTournamentNetGross] = useState("net");
  const [roundNetGross, setRoundNetGross] = useState("net");
  const [activeFlight, setActiveFlight] = useState("all");

  const flights = config.flights ?? [];
  const flightFilter = (lb) => {
    if (activeFlight === "all" || !flights.length) return lb;
    const f = flights.find(fl => fl.id === activeFlight);
    if (!f) return lb;
    const ids = new Set(f.memberIds ?? []);
    return lb.filter(e => {
      // Individual player entry
      if (e.id && ids.has(e.id)) return true;
      // Team entry — check if any member of the team is in the flight
      if (e.players) {
        return (e.players ?? []).some(p => {
          const m = members.find(mb => mb.profile?.name === p || mb.user_id === p);
          return m && ids.has(m.user_id);
        });
      }
      return false;
    });
  };

  const subTabs = [
    ...(config.tournamentMode ? [["tournament", <><Trophy size={13} />Tournament</>]] : []),
    ...(!config.tournamentMode ? [["overall", config.scoringFormat === "stableford" ? <><Star size={13} />Stableford</> : hasTeams ? <><Flag size={13} />Net Standings</> : <><Trophy size={13} />Net Standings</>]] : []),
    ...(!config.tournamentMode ? [["gross", "Gross"]] : []),
    ...(!config.tournamentMode && config.scoringFormat !== "match" && !TEAM_FORMATS.includes(config.scoringFormat) ? [["course", <><MapPin size={13} />By Course</>]] : []),
    ...(!config.tournamentMode ? [["best", <><Star size={13} />Best Rounds</>]] : []),
    ["completion", <><ClipboardList size={13} />Completion</>],
    ["scores", <><FileText size={13} />Scores</>],
    ...(config.playoffEnabled !== false && !config.tournamentMode ? [["playoffs", <><Trophy size={13} />Playoffs</>]] : []),
    ["payouts", <><DollarSign size={13} />Payouts</>],
    ...(config.bylawsUrl ? [["rules", <><FileText size={13} />Rules</>]] : []),
  ];

  const regularCourses = courses.filter(c => !c.playoff_only);

  return (
    <>
      {/* Rounds detail modal */}
      {roundsModal && (() => {
        const playerRounds = [...roundsModal.pr].sort((a, b) => new Date(b.date) - new Date(a.date));
        return (
          <div className="modal-bg" onClick={() => setRoundsModal(null)}>
            <div className="modal" style={{ maxWidth: 660 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div className="modal-title" style={{ marginBottom: 0 }}>{roundsModal.name}'s Rounds</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setRoundsModal(null)}>Close</button>
              </div>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Date</th>
                      <th>Gross</th>
                      {config.useHandicap && <th>Crs Hcp</th>}
                      {config.useHandicap && <th>Net</th>}
                      {config.scoringFormat === "stableford" && <th>Pts</th>}
                      {config.attestRequired && <th>Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {regularCourses.map(c => {
                      const courseRounds = playerRounds.filter(r => r.course_id === c.id);
                      const remaining = config.roundsPerCourse - courseRounds.length;
                      const extraCols = 2 + (config.useHandicap ? 2 : 0) + (config.scoringFormat === "stableford" ? 1 : 0) + (config.attestRequired ? 1 : 0);
                      const incompleteRow = (key) => (
                        <tr key={key} style={{ opacity: 0.45 }}>
                          <td style={{ fontSize: ".82rem", color: "var(--cream)" }}>{c.name}</td>
                          <td colSpan={extraCols} style={{ fontSize: ".78rem", color: "var(--cream-dim)", fontStyle: "italic" }}>
                            Incomplete{config.roundsPerCourse > 1 ? ` · ${courseRounds.length}/${config.roundsPerCourse} played` : ""}
                          </td>
                        </tr>
                      );
                      if (courseRounds.length === 0) return incompleteRow(`inc-${c.id}`);
                      return [
                        ...courseRounds.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontSize: ".82rem", color: "var(--cream)" }}>{r.course_name}</td>
                            <td style={{ fontSize: ".76rem", color: "var(--cream-dim)", whiteSpace: "nowrap" }}>{r.date}</td>
                            <td><span style={{ fontFamily: "var(--font-d)" }}>{r.gross}</span></td>
                            {config.useHandicap && <td><span className="hcp-badge" style={{ fontSize: ".66rem" }}>{r.course_handicap}</span></td>}
                            {config.useHandicap && <td>{netEl(r.net, r.par)}</td>}
                            {config.scoringFormat === "stableford" && <td style={{ color: "var(--purple)", fontFamily: "var(--font-d)" }}>{r.stableford_pts ?? "-"}</td>}
                            {config.attestRequired && <td><span className={`ab ${r.attest_status}`}>{r.attest_status === "approved" ? "✓" : r.attest_status === "rejected" ? "✗" : <Clock size={11} />}</span></td>}
                          </tr>
                        )),
                        ...Array.from({ length: remaining }, (_, i) => incompleteRow(`inc-${c.id}-${i}`)),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Live rounds banner ── */}
      {(() => {
        const live = rounds.filter(r => r.round_status === "in_progress");
        if (!live.length) return null;
        return (
          <div className="card" style={{ marginBottom: 12, borderColor: "rgba(76,175,125,.3)", background: "rgba(76,175,125,.04)" }}>
            <div className="card-hdr" style={{ color: "#6ee7a0" }}>
              <Radio size={14} /> Live Now
            </div>
            {live.map(r => {
              const holeScores = r.hole_scores ?? [];
              const thru = holeScores.filter(s => s != null).length;
              const gross = holeScores.reduce((a, s) => a + (s ?? 0), 0);
              const courseSc = courses.find(c => c.id === r.course_id);
              const holeData = courseSc?.scorecard?.holes ?? [];
              const playedPar = holeData.reduce((a, h, i) => a + (holeScores[i] != null ? (h.par ?? 0) : 0), 0);
              const diff = playedPar > 0 ? gross - playedPar : null;
              const diffLabel = diff === null ? null : diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`;
              const diffColor = diff === null ? "var(--cream-dim)" : diff < 0 ? "#3b82f6" : diff === 0 ? "#6ee7a0" : "var(--cream-dim)";
              // Net: deduct strokes received on holes played so far
              const cHcp = r.course_handicap ?? 0;
              const playedStrokes = holeData.reduce((a, h, i) => {
                if (holeScores[i] == null || !h.stroke_index) return a;
                let s = 0;
                if (cHcp > 0) {
                  if (h.stroke_index <= cHcp) s++;
                  if (cHcp > 18 && h.stroke_index <= cHcp - 18) s++;
                } else if (cHcp < 0) {
                  if (h.stroke_index > 18 - Math.abs(cHcp)) s--;
                }
                return a + s;
              }, 0);
              const net = config.useHandicap && gross > 0 ? gross - playedStrokes : null;
              return (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--navy-border)" }}>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--cream)", fontSize: "0.88rem" }}>{r.player_name}</span>
                    <span style={{ fontSize: "0.72rem", color: "var(--cream-dim)", marginLeft: 8 }}>{r.course_name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {diffLabel && (
                      <span style={{ fontSize: "0.88rem", fontFamily: "var(--font-d)", fontWeight: 700, color: diffColor }}>
                        {diffLabel}
                      </span>
                    )}
                    {net != null && (() => {
                      const netDiff = playedPar > 0 ? net - playedPar : null;
                      const netLabel = netDiff === null ? null : netDiff === 0 ? "E" : netDiff > 0 ? `+${netDiff}` : `${netDiff}`;
                      const netColor = netDiff === null ? "var(--cream)" : netDiff < 0 ? "#3b82f6" : netDiff === 0 ? "#6ee7a0" : "#ef4444";
                      return (
                        <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-d)", color: "var(--cream-dim)" }}>
                          Net <span style={{ color: "var(--cream)", fontWeight: 700 }}>{net}</span>
                          {netLabel && <span style={{ color: netColor, fontWeight: 700, marginLeft: 3 }}>{netLabel}</span>}
                        </span>
                      );
                    })()}
                    {gross > 0 && !diffLabel && net == null && (
                      <span style={{ fontSize: "0.8rem", color: "var(--cream)", fontFamily: "var(--font-d)" }}>
                        {gross}
                      </span>
                    )}
                    <span style={{ fontSize: "0.7rem", color: "#6ee7a0", fontFamily: "var(--font-d)", padding: "2px 9px", border: "1px solid rgba(76,175,125,.4)", borderRadius: 20, whiteSpace: "nowrap" }}>
                      Thru {thru}
                    </span>
                    {holeScores.some(s => s != null) && (
                      <button className="sc-btn" onClick={() => setViewCardModal({ round: r, course: courseSc, playerName: r.player_name, useHandicap: config.useHandicap })}>
                        <FileText size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Sub-tabs */}
      <div className="stabs-wrap">
        <div className="stabs">
          {subTabs.map(([k, l]) => (
            <button key={k} className={`stab${leaderTab === k ? " active" : ""}`} onClick={() => setLeaderTabPersisted(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── Overall / Stableford ── */}
      {leaderTab === "overall" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="card-hdr" style={{ marginBottom: 0 }}>
              {config.scoringFormat === "stableford" ? <><Star size={15} />Stableford Standings</> : <><Trophy size={15} />Net Standings</>}
              {!config.useHandicap && <span style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginLeft: 10, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(gross only)</span>}
            </div>
            {flights.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button className={`btn btn-sm ${activeFlight === "all" ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight("all")}>All</button>
                {flights.map(f => <button key={f.id} className={`btn btn-sm ${activeFlight === f.id ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight(f.id)}>{f.name}</button>)}
              </div>
            )}
          </div>
          {config.hideScores && !myHasSubmitted && <div className="alert-w" style={{ marginBottom: 14 }}>Scores are hidden until you post your own round.</div>}
          {config.scoresToCount && <div className="alert-w" style={{ marginBottom: 14 }}><BarChart2 size={14} /> Best {config.scoresToCount} of all submitted scores count toward standings.</div>}
          {hasTeams ? (
            flightFilter(teamLB).length === 0 ? <div className="empty">No {config.attestRequired ? "approved " : ""}rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Team</th><th>Players</th><th>Rounds</th><th>Avg Net</th></tr></thead>
                <tbody>{flightFilter(teamLB).map((t, i) => (
                  <tr key={t.id}>
                    {rankEl(i)}
                    <td style={{ fontWeight: 600, color: "var(--cream)" }}>{t.name}</td>
                    <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{(t.players ?? []).map(rpn).join(", ") || "—"}</td>
                    <td style={{ color: "var(--cream-dim)" }}>{t.totalRounds}</td>
                    <td><span className="sb" style={{ color: "var(--gold-light)" }}>{t.label}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          ) : (
            flightFilter(overallLB).length === 0 ? <div className="empty">No {config.attestRequired ? "approved " : ""}rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr>
                  <th>#</th><th>Player</th>
                  {config.useHandicap && <th>Hcp</th>}
                  <th>Rounds</th>
                  {config.scoresToCount && <th>Counting</th>}
                  <th>{config.scoringFormat === "stableford" ? "Total Pts" : "Avg Net"}</th>
                </tr></thead>
                <tbody>{flightFilter(overallLB).map((p, i) => (
                  <tr key={p.id}>
                    {rankEl(i)}
                    <td>
                      <span className="pname">{p.name}</span>
                      {p.ghin && <GhinLink ghin={p.ghin} style={{ marginLeft: 7, fontSize: ".62rem" }} />}
                    </td>
                    {config.useHandicap && <td style={{ color: "var(--cream-dim)" }}>{p.handicap}</td>}
                    <td><button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: ".8rem" }} onClick={() => setRoundsModal(p)}>{p.totalRounds}</button></td>
                    {config.scoresToCount && <td style={{ color: "var(--gold-light)", fontSize: ".8rem" }}>{p.countingRounds}</td>}
                    <td><span className="sb" style={{ color: "var(--gold-light)" }}>{p.label}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          )}
        </div>
      )}

      {/* ── Gross ── */}
      {leaderTab === "gross" && (
        <div className="card">
          <div className="card-hdr">Gross Standings</div>
          {hasTeams ? (
            teamGrossLB.length === 0 ? <div className="empty">No rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Team</th><th>Players</th><th>Rounds</th><th>Avg Gross</th><th>Best</th></tr></thead>
                <tbody>{teamGrossLB.map((t, i) => (
                  <tr key={t.id}>
                    {rankEl(i)}
                    <td style={{ fontWeight: 600, color: "var(--cream)" }}>{t.name}</td>
                    <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{(t.players ?? []).map(rpn).join(", ") || "—"}</td>
                    <td style={{ color: "var(--cream-dim)" }}>{t.totalRounds}</td>
                    <td><span className="sb" style={{ color: "var(--gold-light)" }}>{t.avg.toFixed(1)}</span></td>
                    <td style={{ color: "var(--cream-dim)" }}>{Math.min(...t.pr.map(r => r.gross))}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          ) : (
            grossLB.length === 0 ? <div className="empty">No rounds yet.</div> : (
              <div className="tw"><table>
                <thead><tr><th>#</th><th>Player</th><th>Rounds</th><th>Avg Gross</th><th>Best</th></tr></thead>
                <tbody>{grossLB.map((p, i) => (
                  <tr key={p.id}>
                    {rankEl(i)}
                    <td><span className="pname">{p.name}</span></td>
                    <td><button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px", fontSize: ".8rem" }} onClick={() => setRoundsModal(p)}>{p.totalRounds}</button></td>
                    <td><span className="sb" style={{ color: "var(--gold-light)" }}>{p.avg.toFixed(1)}</span></td>
                    <td style={{ color: "var(--cream-dim)" }}>{Math.min(...p.pr.map(r => r.gross))}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )
          )}
        </div>
      )}

      {/* ── By Course ── */}
      {leaderTab === "course" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ color: "var(--gold)", fontFamily: "var(--font-d)", fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase" }}>Course</span>
            <select value={selCourse || ""} onChange={e => setSelCourse(Number(e.target.value))} style={{ width: "auto", minWidth: 200 }}>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name} · Par {c.par}</option>)}
            </select>
          </div>
          <div className="card-hdr"><MapPin size={15} />{courses.find(c => c.id === selCourse)?.name}</div>
          {courseLB.length === 0 ? <div className="empty">No rounds at this course yet.</div> : (
            <div className="tw"><table>
              <thead><tr>
                <th>#</th><th>Player</th>
                {config.useHandicap && <th>Crs Hcp</th>}
                <th>Rounds</th><th>Best Net</th><th>Avg Net</th>
              </tr></thead>
              <tbody>{courseLB.map((p, i) => {
                const c = courses.find(c => c.id === selCourse);
                const ch = config.useHandicap ? calcCourseHcp(p.handicap ?? 0, c?.slope ?? 113, c?.par ?? 72, c?.rating ?? 72, config) : null;
                return (
                  <tr key={p.id}>
                    {rankEl(i)}
                    <td><span className="pname">{p.name}</span></td>
                    {config.useHandicap && <td><span className="hcp-badge">{ch}</span></td>}
                    <td>{p.cr.length >= config.roundsPerCourse ? `✓ ${config.roundsPerCourse}/${config.roundsPerCourse}` : `${p.cr.length}/${config.roundsPerCourse}`}</td>
                    <td>{netEl(p.best, p.par)}</td>
                    <td style={{ color: "var(--cream-dim)" }}>{p.avg}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>
      )}

      {/* ── Best Rounds ── */}
      {leaderTab === "best" && (
        <div className="card">
          <div className="card-hdr"><Star size={15} />Best Single Round</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Best Net</div>
              {hasTeams ? (
                teamBestNetLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Team</th><th>Course</th><th>Net</th></tr></thead>
                    <tbody>{teamBestNetLB.map((t, i) => (
                      <tr key={t.id}>{rankEl(i)}<td style={{ fontWeight: 600, color: "var(--cream)", fontSize: ".84rem" }}>{t.name}</td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{t.best.course_name}</td><td>{netEl(t.best.net, t.best.par)}</td></tr>
                    ))}</tbody>
                  </table></div>
                )
              ) : (
                bestNetLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Player</th><th>Course</th><th>Net</th></tr></thead>
                    <tbody>{bestNetLB.map((p, i) => (
                      <tr key={p.id}>{rankEl(i)}<td><span className="pname" style={{ fontSize: ".84rem" }}>{p.name}</span></td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{p.best.course_name}</td><td>{netEl(p.best.net, p.best.par)}</td></tr>
                    ))}</tbody>
                  </table></div>
                )
              )}
            </div>
            <div>
              <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--blue)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Best Gross</div>
              {hasTeams ? (
                teamBestGrossLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Team</th><th>Course</th><th>Gross</th></tr></thead>
                    <tbody>{teamBestGrossLB.map((t, i) => (
                      <tr key={t.id}>{rankEl(i)}<td style={{ fontWeight: 600, color: "var(--cream)", fontSize: ".84rem" }}>{t.name}</td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{t.best.course_name}</td><td><span className="sb" style={{ color: "var(--blue)" }}>{t.best.gross}</span></td></tr>
                    ))}</tbody>
                  </table></div>
                )
              ) : (
                bestGrossLB.length === 0 ? <div className="empty" style={{ padding: "16px 0" }}>—</div> : (
                  <div className="tw"><table>
                    <thead><tr><th>#</th><th>Player</th><th>Course</th><th>Gross</th></tr></thead>
                    <tbody>{bestGrossLB.map((p, i) => (
                      <tr key={p.id}>{rankEl(i)}<td><span className="pname" style={{ fontSize: ".84rem" }}>{p.name}</span></td><td style={{ fontSize: ".74rem", color: "var(--cream-dim)" }}>{p.best.course_name}</td><td><span className="sb" style={{ color: "var(--blue)" }}>{p.best.gross}</span></td></tr>
                    ))}</tbody>
                  </table></div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Completion ── */}
      {leaderTab === "completion" && (() => {
        if (config.tournamentMode) {
          const tRounds = config.tournamentRounds ?? [];
          const teams = config.scrambleTeams ?? [];
          const allTeamFmt = tRounds.length > 0 && tRounds.every(tr => TEAM_FORMATS.includes(tr.format));
          const isTeamTournament = allTeamFmt && teams.length > 0;

          const entries = isTeamTournament
            ? teams.map(team => {
                const cs = tRounds.map(tr => {
                  const played = scored.some(r => r.team_id === team.id && r.tournament_round_id === tr.id);
                  return { id: tr.id, name: tr.label, done: played };
                });
                const done = cs.filter(c => c.done).length;
                return { id: team.id, name: team.name, sub: (team.players ?? []).map(rpn).join(", "), cs, done, total: tRounds.length, pct: tRounds.length ? Math.round(done / tRounds.length * 100) : 0 };
              })
            : completionData.map(p => {
                const cs = tRounds.map(tr => {
                  const played = scored.some(r => r.player_id === p.id && r.tournament_round_id === tr.id);
                  return { id: tr.id, name: tr.label, done: played };
                });
                const done = cs.filter(c => c.done).length;
                return { ...p, cs, done, total: tRounds.length, pct: tRounds.length ? Math.round(done / tRounds.length * 100) : 0 };
              });

          return (
            <div className="card">
              <div className="card-hdr"><ClipboardList size={15} />Tournament Completion</div>
              <p className="note" style={{ marginBottom: 14 }}>
                {tRounds.length} tournament round{tRounds.length !== 1 ? "s" : ""} · {isTeamTournament ? "per team" : "per player"}.
              </p>
              {entries.map(e => (
                <div key={e.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!isTeamTournament && <div className="avatar">{e.avatar_url ? <img src={e.avatar_url} alt="" /> : ini(e.name)}</div>}
                      <div>
                        <span className="pname">{e.name}</span>
                        {e.sub && <div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>{e.sub}</div>}
                      </div>
                    </div>
                    <span style={{ fontSize: ".78rem", color: e.pct === 100 ? "var(--green)" : "var(--cream-dim)" }}>
                      {e.done}/{e.total}{e.pct === 100 ? " ✓" : ""}
                    </span>
                  </div>
                  <div className="pw" style={{ marginBottom: 5 }}><div className="pf" style={{ width: `${e.pct}%` }} /></div>
                  <div>
                    {e.cs.map(c => (
                      <span key={c.id} className={`dpill ${c.done ? "done" : "none"}`}>
                        {c.done ? "✓" : "—"} {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        // Season completion — team or individual
        if (hasTeams) {
          const teams = config.scrambleTeams ?? [];
          const rpc = config.roundsPerCourse ?? 1;
          const teamCompletion = teams.map(team => {
            const cs = regularCourses.map(c => {
              const tr = scored.filter(r => String(r.team_id) === String(team.id) && r.course_id === c.id);
              const played = tr.length;
              const done = played >= rpc;
              return { id: c.id, name: c.name, played, done };
            });
            const done = cs.filter(c => c.done).length;
            const total = regularCourses.length;
            const pct = total ? Math.round(done / total * 100) : 0;
            return { ...team, cs, done, total, pct };
          });
          return (
            <div className="card">
              <div className="card-hdr"><ClipboardList size={15} />Completion Tracker</div>
              <p className="note" style={{ marginBottom: 14 }}>
                {rpc} {config.attestRequired ? "approved " : ""}round{rpc > 1 ? "s" : ""} per course · {regularCourses.length * rpc} total required · per team.
              </p>
              {teamCompletion.map(t => (
                <div key={t.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div>
                      <span className="pname">{t.name}</span>
                      <div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>{(t.players ?? []).map(rpn).join(", ")}</div>
                    </div>
                    <span style={{ fontSize: ".78rem", color: t.pct === 100 ? "var(--green)" : "var(--cream-dim)" }}>
                      {t.done}/{t.total}{t.pct === 100 ? " ✓" : ""}
                    </span>
                  </div>
                  <div className="pw" style={{ marginBottom: 5 }}><div className="pf" style={{ width: `${t.pct}%` }} /></div>
                  <div>
                    {t.cs.map(c => (
                      <span key={c.id} className={`dpill ${c.done ? "done" : c.played > 0 ? "part" : "none"}`}>
                        {c.done ? "✓" : `${c.played}/${rpc}`} {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        return (
          <div className="card">
            <div className="card-hdr"><ClipboardList size={15} />Completion Tracker</div>
            <p className="note" style={{ marginBottom: 14 }}>
              {config.roundsPerCourse} {config.attestRequired ? "approved " : ""}round{config.roundsPerCourse > 1 ? "s" : ""} per course · {courses.length * config.roundsPerCourse} total required.
            </p>
            {completionData.map(p => (
              <div key={p.id} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="avatar">{p.avatar_url ? <img src={p.avatar_url} alt="" /> : ini(p.name)}</div>
                    <span className="pname">{p.name}</span>
                    {config.useHandicap && <span className="hcp-badge">Hcp {p.handicap ?? "-"}</span>}
                  </div>
                  <span style={{ fontSize: ".78rem", color: p.pct === 100 ? "var(--green)" : "var(--cream-dim)" }}>
                    {p.done}/{p.total}{p.pct === 100 ? " ✓" : ""}
                  </span>
                </div>
                <div className="pw" style={{ marginBottom: 5 }}><div className="pf" style={{ width: `${p.pct}%` }} /></div>
                <div>
                  {p.cs.map(c => (
                    <span key={c.id} className={`dpill ${c.done ? "done" : c.played > 0 ? "part" : "none"}`}>
                      {c.done ? "✓" : `${c.played}/${config.roundsPerCourse}`} {c.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Scores ── */}
      {leaderTab === "scores" && (() => {
        const allRounds = scored.filter(r => !config.hideScores || myHasSubmitted || r.player_id === session?.user.id);

        const teamLookup = Object.fromEntries((config.scrambleTeams ?? []).map(t => [String(t.id), t.name]));
        // Team mode = any team-format league or tournament with teams configured
        const isTeamMode = (config.scrambleTeams ?? []).length > 0 &&
          (TEAM_FORMATS.includes(config.scoringFormat) ||
           (config.tournamentMode && (config.tournamentRounds ?? []).some(tr => TEAM_FORMATS.includes(tr.format))));

        // Deduplicate team rounds — seed data may store one row per player on the team
        const deduped = isTeamMode
          ? Object.values(allRounds.reduce((acc, r) => {
              const key = r.team_id ? `${r.team_id}_${r.tournament_round_id ?? r.course_id}` : r.id;
              if (!acc[key] || r.created_at > acc[key].created_at) acc[key] = r;
              return acc;
            }, {}))
          : allRounds;

        const filteredRounds = deduped
          .filter(r => scoresFilterPlayer === "all" || (isTeamMode ? String(r.team_id) === scoresFilterPlayer : r.player_id === scoresFilterPlayer))
          .filter(r => scoresFilterCourse === "all" || r.course_id === Number(scoresFilterCourse))
          .sort((a, b) => new Date(b.date) - new Date(a.date));

        // For team mode: filter by team; otherwise filter by player
        const roundFilterOptions = isTeamMode
          ? [...new Map(deduped.filter(r => r.team_id).map(r => [String(r.team_id), { id: String(r.team_id), name: teamLookup[String(r.team_id)] ?? r.player_name }])).values()].sort((a, b) => a.name.localeCompare(b.name))
          : [...new Map(deduped.map(r => [r.player_id, { id: r.player_id, name: r.player_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));
        const roundCourses = [...new Map(deduped.map(r => [r.course_id, { id: r.course_id, name: r.course_name }])).values()].sort((a, b) => a.name.localeCompare(b.name));

        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}><FileText size={15} />All Scores</div>
              <div style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{filteredRounds.length} round{filteredRounds.length !== 1 ? "s" : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <div className="fg" style={{ flex: 1, minWidth: 140 }}>
                <label>{isTeamMode ? "Team" : "Player"}</label>
                <select value={scoresFilterPlayer} onChange={e => setScoresFilterPlayer(e.target.value)}>
                  <option value="all">{isTeamMode ? "All Teams" : "All Players"}</option>
                  {roundFilterOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="fg" style={{ flex: 1, minWidth: 140 }}>
                <label>Course</label>
                <select value={scoresFilterCourse} onChange={e => setScoresFilterCourse(e.target.value)}>
                  <option value="all">All Courses</option>
                  {roundCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {(scoresFilterPlayer !== "all" || scoresFilterCourse !== "all") && (
                <div className="fg" style={{ justifyContent: "flex-end" }}>
                  <label style={{ opacity: 0 }}>x</label>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setScoresFilterPlayer("all"); setScoresFilterCourse("all"); }}>Clear</button>
                </div>
              )}
            </div>
            {filteredRounds.length === 0 ? <div className="empty">No rounds match your filters.</div> : (
              <div className="tw"><table>
                <thead><tr>
                  <th>{isTeamMode ? "Team" : "Player"}</th><th>Course</th><th>Date</th><th>Gross</th>
                  {config.useHandicap && <th>Course Hcp</th>}
                  {config.useHandicap && <th>Net</th>}
                  {config.scoringFormat === "stableford" && <th>Pts</th>}
                  {config.attestRequired && <th>Attested By</th>}
                  <th>Status</th><th>Card</th>
                </tr></thead>
                <tbody>{filteredRounds.map(r => (
                  <tr key={r.id}>
                    <td>
                      {isTeamMode && teamLookup[String(r.team_id)]
                        ? <><span className="pname" style={{ fontSize: ".86rem" }}>{teamLookup[String(r.team_id)]}</span><div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>{r.player_name}</div></>
                        : <span className="pname" style={{ fontSize: ".86rem" }}>{r.player_name}</span>
                      }
                    </td>
                    <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                    <td style={{ fontSize: ".76rem", color: "var(--cream-dim)", whiteSpace: "nowrap" }}>{r.date}</td>
                    <td><span style={{ fontFamily: "var(--font-d)" }}>{r.gross}</span></td>
                    {config.useHandicap && <td><span className="hcp-badge" style={{ fontSize: ".66rem" }}>{r.course_handicap}</span></td>}
                    {config.useHandicap && <td>{netEl(r.net, r.par)}</td>}
                    {config.scoringFormat === "stableford" && <td style={{ color: "var(--purple)", fontFamily: "var(--font-d)" }}>{r.stableford_pts ?? "-"}</td>}
                    {config.attestRequired && <td style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{r.attester_name ?? "—"}</td>}
                    <td>
                      {!config.attestRequired
                        ? <span className="ab auto">Auto ✓</span>
                        : <span className={`ab ${r.attest_status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{r.attest_status === "approved" ? "✓ Approved" : r.attest_status === "rejected" ? "✗ Rejected" : <><Clock size={11} />Pending</>}</span>
                      }
                    </td>
                    <td>
                      {(() => {
                        const hasLive = r.hole_scores?.length > 0;
                        const hasPhoto = !!r.scorecard_url;
                        if (!hasLive && !hasPhoto) return <span style={{ color: "#4b5563", fontSize: ".76rem" }}>—</span>;
                        const roundCourse = courses.find(c => c.id === r.course_id);
                        const roundPlayer = members.find(m => m.user_id === r.player_id)?.profile?.name;
                        return (
                          <div style={{ display: "flex", gap: 4 }}>
                            {hasLive && (
                              <button className="sc-btn" onClick={() => setViewCardModal({ round: r, course: roundCourse, playerName: roundPlayer, useHandicap: config.useHandicap })} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <FileText size={12} />Scorecard
                              </button>
                            )}
                            {hasPhoto && (
                              <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <FileText size={12} />Photo
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        );
      })()}

      {/* ── Playoffs ── */}
      {leaderTab === "playoffs" && config.playoffEnabled !== false && (() => {
        const n = config.playoffQualifiers ?? 4;
        const seedingBy = config.playoffSeedingBy ?? "net";
        const fmt = config.playoffFormat ?? "match";
        const bracket = config.playoffBracket ?? [];

        let seedList = [];
        if (seedingBy === "gross") seedList = [...grossLB].slice(0, n).map(p => ({ ...p, seedStat: p.avg.toFixed(1), seedLabel: "avg gross" }));
        else if (seedingBy === "stableford") seedList = [...overallLB].slice(0, n).map(p => ({ ...p, seedStat: p.label, seedLabel: "pts" }));
        else seedList = [...overallLB].slice(0, n).map(p => ({ ...p, seedStat: p.label, seedLabel: "avg net" }));

        const numRounds = Math.round(Math.log2(Math.max(n, 2)));
        const roundLabels = { 1: ["Final"], 2: ["Semifinals", "Final"], 3: ["Quarterfinals", "Semifinals", "Final"], 4: ["Round of 16", "Quarterfinals", "Semifinals", "Final"] }[numRounds] ?? Array.from({ length: numRounds }, (_, i) => `Round ${i + 1}`);

        const initMatchups = () => {
          const seeds = seedList.map((p, i) => ({ name: p.name, seed: i + 1 }));
          const matches = [];
          for (let i = 0; i < seeds.length / 2; i++) {
            matches.push({ p1: seeds[i]?.name ?? null, p2: seeds[seeds.length - 1 - i]?.name ?? null, winner: null });
          }
          return [{ round: 1, label: roundLabels[0], matchups: matches }];
        };

        const buildFullBracket = () => {
          const saved = bracket.length > 0 ? bracket : (seedList.length >= 2 ? initMatchups() : []);
          if (saved.length === 0) return [];
          const full = [...saved];
          for (let r = full.length; r < numRounds; r++) {
            const prevMatchCount = full[r - 1].matchups.length;
            full.push({ round: r + 1, label: roundLabels[r], matchups: Array.from({ length: prevMatchCount / 2 }, () => ({ p1: null, p2: null, winner: null })) });
          }
          for (let r = 0; r < full.length - 1; r++) {
            const roundMatchups = full[r].matchups;
            const allDone = roundMatchups.every(m => m.winner);
            if (allDone) {
              const nextMatchups = [];
              for (let i = 0; i < roundMatchups.length; i += 2) {
                nextMatchups.push({ p1: roundMatchups[i]?.winner ?? null, p2: roundMatchups[i + 1]?.winner ?? null, winner: full[r + 1]?.matchups[i / 2]?.winner ?? null });
              }
              full[r + 1] = { ...full[r + 1], matchups: nextMatchups };
            } else {
              for (let i = 0; i < roundMatchups.length; i += 2) {
                const nextIdx = i / 2;
                const nextMatch = full[r + 1]?.matchups[nextIdx];
                if (nextMatch) {
                  full[r + 1].matchups[nextIdx] = { ...nextMatch, p1: roundMatchups[i]?.winner ?? nextMatch.p1, p2: roundMatchups[i + 1]?.winner ?? nextMatch.p2 };
                }
              }
            }
          }
          return full;
        };

        const displayBracket = buildFullBracket();

        const setWinner = (roundIdx, matchIdx, winner) => {
          const savedBracket = bracket.length > 0 ? bracket : initMatchups();
          const updated = [...savedBracket];
          while (updated.length <= roundIdx) updated.push({ round: updated.length + 1, label: roundLabels[updated.length], matchups: [] });
          if (updated[roundIdx].matchups.length === 0 && roundIdx > 0) {
            const prevMatchups = updated[roundIdx - 1].matchups;
            const populated = [];
            for (let i = 0; i < prevMatchups.length; i += 2) populated.push({ p1: prevMatchups[i]?.winner ?? null, p2: prevMatchups[i + 1]?.winner ?? null, winner: null });
            updated[roundIdx] = { ...updated[roundIdx], matchups: populated };
          }
          updated[roundIdx] = { ...updated[roundIdx], matchups: updated[roundIdx].matchups.map((m, mi) => mi !== matchIdx ? m : { ...m, winner }) };
          const roundMatchups = updated[roundIdx].matchups;
          const allDone = roundMatchups.every(m => m.winner);
          const isSemiFinal = allDone && numRounds >= 2 && roundIdx === numRounds - 2 && roundMatchups.length >= 2;
          if (isSemiFinal) {
            const loser1 = roundMatchups[0].winner === roundMatchups[0].p1 ? roundMatchups[0].p2 : roundMatchups[0].p1;
            const loser2 = roundMatchups[1].winner === roundMatchups[1].p1 ? roundMatchups[1].p2 : roundMatchups[1].p1;
            saveBracket(updated, { p1: loser1, p2: loser2, winner: null });
          } else {
            saveBracket(updated);
          }
        };

        const thirdPlaceMatch = config.thirdPlaceMatch ?? null;
        const setThirdPlaceWinner = (winner) => saveBracket(config.playoffBracket ?? [], { ...thirdPlaceMatch, winner });
        const resetBracket = () => saveBracket([], null);

        return (
          <>
            {/* Qualifiers card */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div className="card-hdr" style={{ marginBottom: 0 }}><Trophy size={15} />Playoff Qualifiers</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="fmt-pip" style={{ background: "rgba(212,168,67,.12)", borderColor: "var(--gold-border)", color: "var(--gold-light)" }}>{FORMAT_LABELS[fmt] ?? fmt}</span>
                  <span style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>Top {n} by {seedingBy === "net" ? "net avg" : seedingBy === "gross" ? "gross avg" : "stableford pts"}</span>
                </div>
              </div>
              {seedList.length === 0
                ? <div className="empty">No rounds submitted yet — standings needed to seed the bracket.</div>
                : (() => {
                  const fee = config.entryFee ?? 0;
                  const paidCount = members.filter(m => m.paid).length;
                  const fullPool = fee * members.length;
                  const collectedPool = fee * paidCount;
                  const cats = config.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
                  const positionPayout = [cats.find(c => c.id === "champion"), cats.find(c => c.id === "runnerUp"), cats.find(c => c.id === "thirdPlace"), null];
                  return seedList.map((p, i) => {
                    const memberRecord = members.find(m => m.user_id === p.id);
                    const isPaid = memberRecord?.paid ?? false;
                    const cat = positionPayout[i];
                    const fullPrize = fullPool > 0 && cat?.pct > 0 ? Math.round(fullPool * cat.pct / 100) : null;
                    const collectedPrize = collectedPool > 0 && cat?.pct > 0 ? Math.round(collectedPool * cat.pct / 100) : null;
                    const showBoth = collectedPrize !== null && collectedPrize !== fullPrize;
                    return (
                      <div key={p.id} className="qualifier-chip" style={{ borderColor: isPaid ? "rgba(76,175,125,.2)" : "rgba(224,92,92,.15)" }}>
                        <div className="qualifier-seed">#{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                            <span className="qualifier-name" style={{ flex: "unset" }}>{p.name}</span>
                            {config.entryFee > 0 && <span className={`paid-badge ${isPaid ? "paid" : "unpaid"}`}>{isPaid ? "✓ Paid" : "✗ Unpaid"}</span>}

                          </div>
                          <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginTop: 2 }}>
                            {p.seedStat} {p.seedLabel}
                            {config.useHandicap && <> · Hcp {p.handicap ?? "-"}</>}
                          </div>
                        </div>
                        {fullPrize && (
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: "var(--font-d)", fontSize: "1rem", color: "var(--gold)" }}>${fullPrize.toLocaleString()}</div>
                            {showBoth && <div style={{ fontSize: ".62rem", color: "#6ee7a0" }}>${collectedPrize.toLocaleString()} collected</div>}
                            <div style={{ fontSize: ".62rem", color: "var(--cream-dim)" }}>{cat.pct}% if winner</div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()
              }
            </div>

            {/* Bracket card */}
            {seedList.length >= 2 && (
              <div className="card" style={{ background: "linear-gradient(180deg,rgba(10,14,26,1),rgba(16,20,34,1))", border: "1px solid rgba(212,168,67,.12)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(ellipse 80% 50% at 50% 0%,rgba(212,168,67,.05),transparent)", pointerEvents: "none" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 8, position: "relative" }}>
                  <div>
                    <div className="card-hdr" style={{ marginBottom: 4 }}><Trophy size={15} />Tournament Bracket</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{FORMAT_LABELS[fmt] ?? fmt} · {n}-player single elimination</span>
                      {config.playoffCourse && (() => { const pc = courses.find(c => String(c.id) === String(config.playoffCourse)); return pc ? <span style={{ fontSize: ".78rem", color: "var(--gold-light)", display: "inline-flex", alignItems: "center", gap: 4 }}><Flag size={12} />{pc.name}</span> : null; })()}
                      {config.playoffDate && <span style={{ fontSize: ".78rem", color: "var(--gold-light)" }}>{new Date(config.playoffDate + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {isAdmin && <button className="btn btn-danger btn-sm" onClick={resetBracket}>Reset</button>}
                    {isAdmin && bracket.length === 0 && <button className="btn btn-gold btn-sm" onClick={() => saveBracket(initMatchups())}>Generate Bracket</button>}
                  </div>
                </div>

                {isAdmin && displayBracket.length > 0 && (
                  <div className="alert-w" style={{ marginBottom: 18, fontSize: ".78rem" }}>Click a player's name to advance them as the winner.</div>
                )}

                <div className="bracket-wrap" style={{ position: "relative" }}>
                  <div className="bracket">
                    {displayBracket.map((round, roundIdx) => {
                      const totalHeight = round.matchups.length * 108;
                      return (
                        <div key={roundIdx} className="bk-round-wrap" style={{ paddingLeft: roundIdx === 0 ? 0 : 32 }}>
                          <div className="bk-round-label">{round.label ?? `Round ${round.round}`}</div>
                          <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-around", height: Math.max(totalHeight, 108) }}>
                            {round.matchups.map((match, matchIdx) => {
                              const slots = [{ name: match.p1, slot: "p1" }, { name: match.p2, slot: "p2" }];
                              const isLastRound = roundIdx === displayBracket.length - 1;
                              return (
                                <div key={matchIdx} className="bk-match" style={{ position: "relative" }}>
                                  <div className={`bk-match-inner${match.winner ? " has-winner" : ""}`}>
                                    {slots.map(({ name, slot }, si) => {
                                      const isWinner = match.winner === name;
                                      const isLoser = match.winner && !isWinner;
                                      const isEmpty = !name;
                                      return (
                                        <div key={slot}>
                                          <div
                                            className={`bk-slot${isWinner ? " s-winner" : ""}${isLoser ? " s-loser" : ""}${isEmpty ? " s-empty" : ""}${isAdmin && name && !match.winner ? " clickable" : ""}`}
                                            onClick={() => isAdmin && name && !match.winner && setWinner(roundIdx, matchIdx, name)}
                                          >
                                            <span className="bk-seed">{name ? (seedList.findIndex(p => p.name === name) + 1 || "") : ""}</span>
                                            <span className="bk-name">{name ?? "TBD"}</span>
                                            {isWinner && <span className="bk-win-icon">✓</span>}
                                          </div>
                                          {si === 0 && <div className="bk-slot-divider" />}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {!isLastRound && (
                                    <svg style={{ position: "absolute", right: -32, top: "50%", transform: "translateY(-50%)", overflow: "visible", pointerEvents: "none" }} width="32" height="2">
                                      <line x1="0" y1="1" x2="32" y2="1" stroke="rgba(212,168,67,.25)" strokeWidth="1" strokeDasharray="3,3" />
                                    </svg>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Champion */}
                    {(() => {
                      const champ = displayBracket[displayBracket.length - 1]?.matchups?.[0]?.winner;
                      if (!champ) return null;
                      return (
                        <div className="bk-champion">
                          <div className="bk-champ-card">
                            <span className="bk-champ-trophy"><Trophy size={32} /></span>
                            <div className="bk-champ-label">Champion</div>
                            <div className="bk-champ-name">{champ}</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Third place */}
                {displayBracket.length > 0 && numRounds >= 2 && (() => {
                  const semis = displayBracket[numRounds - 2];
                  const semisComplete = semis?.matchups?.every(m => m.winner);
                  const tpm = config.thirdPlaceMatch;
                  const p1 = tpm?.p1 ?? (semisComplete ? (semis.matchups[0]?.winner === semis.matchups[0]?.p1 ? semis.matchups[0]?.p2 : semis.matchups[0]?.p1) : null);
                  const p2 = tpm?.p2 ?? (semisComplete ? (semis.matchups[1]?.winner === semis.matchups[1]?.p1 ? semis.matchups[1]?.p2 : semis.matchups[1]?.p1) : null);
                  const winner = tpm?.winner ?? null;
                  return (
                    <div className="bk-third">
                      <div className="bk-third-label">Third Place Match</div>
                      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <div className="bk-match" style={{ margin: 0 }}>
                          <div className={`bk-match-inner${winner ? " has-winner" : ""}`}>
                            {[{ name: p1, slot: "p1" }, { name: p2, slot: "p2" }].map(({ name, slot }, si) => {
                              const isWinner = winner === name;
                              const isLoser = winner && !isWinner;
                              return (
                                <div key={slot}>
                                  <div
                                    className={`bk-slot${isWinner ? " s-winner" : ""}${isLoser ? " s-loser" : ""}${!name ? " s-empty" : ""}${isAdmin && name && !winner ? " clickable" : ""}`}
                                    onClick={() => isAdmin && name && !winner && setThirdPlaceWinner(name)}
                                  >
                                    <span className="bk-seed">{name ? (seedList.findIndex(p => p.name === name) + 1 || "") : ""}</span>
                                    <span className="bk-name">{name ?? "TBD"}</span>
                                    {isWinner && <span className="bk-win-icon">3rd</span>}
                                  </div>
                                  {si === 0 && <div className="bk-slot-divider" />}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {winner && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, padding: "10px 16px" }}>
                            <span style={{ fontSize: ".72rem", color: "var(--cream-dim)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>3RD</span>
                            <div>
                              <div style={{ fontSize: ".58rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--cream-dim)", fontFamily: "var(--font-d)", marginBottom: 2 }}>Third Place</div>
                              <div style={{ fontFamily: "var(--font-d)", fontSize: ".95rem", color: "var(--white)" }}>{winner}</div>
                            </div>
                          </div>
                        )}
                        {!p1 && !p2 && <div style={{ fontSize: ".78rem", color: "#4b5563", fontStyle: "italic" }}>Awaiting semifinal results…</div>}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Payouts ── */}
      {leaderTab === "payouts" && (() => {
        const fee = config.entryFee ?? 0;
        const paidPlayers = members.filter(m => m.paid);
        const totalPool = fee * paidPlayers.length;
        const cats = config.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
        const finalRound = (config.playoffBracket ?? [])[(config.playoffBracket ?? []).length - 1];
        const playoffChampion = finalRound?.matchups?.[0]?.winner ?? null;
        const playoffRunnerUp = finalRound?.matchups?.[0]
          ? (finalRound.matchups[0].winner === finalRound.matchups[0].p1 ? finalRound.matchups[0].p2 : finalRound.matchups[0].p1)
          : null;

        const effectiveNetLB = config.tournamentMode ? tournamentOverallLB : (hasTeams ? teamLB : overallLB);
        const effectiveGrossLB = config.tournamentMode
          ? [...tournamentOverallLB].filter(e => e.grossTotal != null).sort((a, b) => a.grossTotal - b.grossTotal)
          : (hasTeams ? teamGrossLB : grossLB);

        // Build per-category LB overrides for tournament round-specific payouts
        const lbOverrides = {};
        if (config.tournamentMode) {
          cats.forEach(cat => {
            if (!cat.tournamentRoundId) return;
            const rd = tournamentRoundLB[cat.tournamentRoundId];
            if (!rd) return;
            lbOverrides[cat.id] = {
              netLB: rd.standings ?? [],
              grossLB: rd.grossStandings ?? rd.standings ?? [],
            };
          });
        }

        // Per-flight payout overrides: filter LBs to only players in the specified flight
        cats.forEach(cat => {
          if (!cat.flightId) return;
          const flight = (config.flights ?? []).find(f => f.id === cat.flightId);
          if (!flight) return;
          const flightNames = new Set(
            (flight.memberIds ?? []).map(uid => memberNameById[uid]).filter(Boolean)
          );
          const baseNet = lbOverrides[cat.id]?.netLB ?? effectiveNetLB;
          const baseGross = lbOverrides[cat.id]?.grossLB ?? effectiveGrossLB;
          lbOverrides[cat.id] = {
            netLB: baseNet.filter(e => flightNames.has(e.name)),
            grossLB: baseGross.filter(e => flightNames.has(e.name)),
          };
        });

        const leaderMap = resolvePayouts({
          cats,
          netLB: effectiveNetLB,
          grossLB: effectiveGrossLB,
          playoffResults: {
            champion: playoffChampion,
            runnerUp: playoffRunnerUp,
            thirdPlace: config.thirdPlaceMatch?.winner ?? null,
          },
          exclusive: config.exclusiveWinners ?? false,
          precedence: config.exclusivePrecedence ?? "gross",
          lbOverrides,
        });
        return (
          <div className="card">
            <div className="card-hdr">💰 Payouts</div>
            {fee > 0 ? (
              <div className="payout-pool" style={{ flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: 8 }}>
                  <div className="payout-pool-label" style={{ marginBottom: 0 }}>Entry Fee</div>
                  <div style={{ fontFamily: "var(--font-d)", fontSize: "1rem", color: "var(--gold-light)" }}>${fee} / player</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
                  <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: ".58rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--cream-dim)", fontFamily: "var(--font-d)", marginBottom: 4 }}>Total Pool (All {members.length} Members)</div>
                    <div style={{ fontFamily: "var(--font-d)", fontSize: "1.6rem", fontWeight: 700, color: "var(--cream-dim)" }}>${(fee * members.length).toLocaleString()}</div>
                    <div style={{ fontSize: ".7rem", color: "#4b5563", marginTop: 2 }}>{members.length} × ${fee}</div>
                  </div>
                  <div style={{ background: "rgba(76,175,125,.08)", border: "1px solid rgba(76,175,125,.25)", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: ".58rem", letterSpacing: "2px", textTransform: "uppercase", color: "#6ee7a0", fontFamily: "var(--font-d)", marginBottom: 4 }}>Collected ({paidPlayers.length} Paid)</div>
                    <div style={{ fontFamily: "var(--font-d)", fontSize: "1.6rem", fontWeight: 700, background: "linear-gradient(135deg,var(--gold),var(--gold-light))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>${totalPool.toLocaleString()}</div>
                    <div style={{ fontSize: ".7rem", color: "#4b5563", marginTop: 2 }}>{paidPlayers.length} × ${fee}{members.length - paidPlayers.length > 0 ? ` · ${members.length - paidPlayers.length} still unpaid` : " · fully collected ✓"}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="alert-w" style={{ marginBottom: 16 }}>No entry fee set — configure in Admin → Config → Payouts.</div>
            )}
            {cats.filter(c => c.pct > 0).length === 0 ? (
              <div className="empty">No payout categories configured.{isAdmin ? " Go to Admin → Config → Payouts." : ""}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cats.filter(c => c.pct > 0).map((c) => {
                  const fullAmt = fee > 0 ? Math.round(fee * members.length * c.pct / 100) : null;
                  const collectedAmt = totalPool > 0 ? Math.round(totalPool * c.pct / 100) : null;
                  const showBoth = collectedAmt !== null && collectedAmt !== fullAmt;
                  const leader = leaderMap[c.id];
                  const { mapTo } = resolveCatMap(c);
                  const isPlayoff = mapTo === "playoff";
                  return (
                    <div key={c.id} style={{ background: isPlayoff ? "rgba(212,168,67,.07)" : "rgba(255,255,255,.03)", border: `1px solid ${isPlayoff ? "var(--gold-border)" : "var(--navy-border)"}`, borderRadius: 8, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: ".78rem", color: isPlayoff ? "var(--gold-light)" : "var(--cream-dim)", marginBottom: 4 }}>{c.label}</div>
                        {leader ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "var(--white)", fontSize: ".95rem" }}>▶ {leader}</span>
                            {fullAmt != null && <span style={{ fontFamily: "var(--font-d)", fontSize: ".85rem", color: "var(--gold)", background: "rgba(212,168,67,.12)", border: "1px solid var(--gold-border)", borderRadius: 5, padding: "1px 8px" }}>${fullAmt.toLocaleString()}</span>}
                          </div>
                        ) : (
                          <div style={{ color: "#4b5563", fontSize: ".82rem", fontStyle: "italic" }}>{isPlayoff ? "Determined by playoffs" : mapTo === "none" ? "Side game — assign winner in Admin" : "No rounds yet"}</div>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontFamily: "var(--font-d)", fontSize: "1.4rem", color: leader ? "var(--gold)" : "var(--cream-dim)" }}>{fullAmt != null ? `$${fullAmt.toLocaleString()}` : "—"}</div>
                        {showBoth && <div style={{ fontSize: ".7rem", color: "#6ee7a0", marginTop: 1 }}>${collectedAmt.toLocaleString()} collected</div>}
                        <div style={{ fontSize: ".68rem", color: "var(--cream-dim)" }}>{c.pct}% of pool</div>
                      </div>
                    </div>
                  );
                })}
                {(() => {
                  const tot = cats.reduce((s, c) => s + c.pct, 0);
                  const remaining = totalPool - cats.filter(c => c.pct > 0).reduce((s, c) => s + Math.round(totalPool * c.pct / 100), 0);
                  if (tot < 100 && totalPool > 0) return <div className="alert-w" style={{ fontSize: ".8rem", display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={13} /> {100 - tot}% of the pool (${remaining.toLocaleString()}) is unallocated.</div>;
                  return null;
                })()}
              </div>
            )}
          </div>
        );
      })()}
      {/* ── Tournament tab ── */}
      {leaderTab === "tournament" && (() => {
        const tRounds = config.tournamentRounds ?? [];
        const roundTabs = [["overall", "Overall"], ...tRounds.map(r => [r.id, r.label])];
        return (
          <div>
            {/* Round sub-tabs */}
            <div className="stabs-wrap" style={{ marginBottom: 12 }}>
              <div className="stabs">
                {roundTabs.map(([id, label]) => (
                  <button key={id} className={`stab${tournamentRoundTab === id ? " active" : ""}`}
                    onClick={() => setTournamentRoundTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Overall standings */}
            {tournamentRoundTab === "overall" && (() => {
              const isGross = tournamentNetGross === "gross";
              const displayLB = flightFilter(isGross
                ? [...tournamentOverallLB].filter(e => e.grossTotal != null).sort((a, b) => a.grossTotal - b.grossTotal)
                : tournamentOverallLB);
              return (
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: flights.length > 0 ? 8 : 14, flexWrap: "wrap", gap: 8 }}>
                    <div className="card-hdr" style={{ marginBottom: 0 }}><Trophy size={15} />Overall Tournament Standings</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className={`btn btn-sm ${!isGross ? "btn-gold" : "btn-ghost"}`} onClick={() => setTournamentNetGross("net")}>Net</button>
                      <button className={`btn btn-sm ${isGross ? "btn-gold" : "btn-ghost"}`} onClick={() => setTournamentNetGross("gross")}>Gross</button>
                    </div>
                  </div>
                  {flights.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                      <button className={`btn btn-sm ${activeFlight === "all" ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight("all")}>All</button>
                      {flights.map(f => <button key={f.id} className={`btn btn-sm ${activeFlight === f.id ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight(f.id)}>{f.name}</button>)}
                    </div>
                  )}
                  {displayLB.length === 0 ? (
                    <div className="empty">No scores posted yet.</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginBottom: 10 }}>
                      {tRounds.map((r, ri) => (
                        <span key={r.id} style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>
                          <span style={{ color: "var(--gold)", fontFamily: "var(--font-d)" }}>R{ri + 1}</span> {r.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {displayLB.length === 0 ? null : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Name</th>
                            {tRounds.map((r, ri) => <th key={r.id} style={{ fontSize: ".72rem", whiteSpace: "nowrap" }}>R{ri + 1}</th>)}
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayLB.map((entry, i) => {
                            const scores = isGross ? (entry.grossRoundScores ?? []) : (entry.roundScores ?? []);
                            const total = isGross ? entry.grossTotal : entry.total;
                            return (
                              <tr key={entry.id ?? entry.name}>
                                {rankEl(i)}
                                <td style={{ fontWeight: 600, color: "var(--cream)" }}>
                                  {entry.name}
                                  {entry.players && <div style={{ fontSize: ".75rem", color: "var(--cream-dim)", fontWeight: 400 }}>{entry.players.map(rpn).join(", ")}</div>}
                                </td>
                                {scores.map((s, ri) => (
                                  <td key={ri} style={{ color: s !== null ? "var(--cream)" : "#4b5563", fontSize: ".85rem" }}>
                                    {s !== null ? s : "—"}
                                  </td>
                                ))}
                                <td><span className="sb">{total}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Per-round standings */}
            {tournamentRoundTab !== "overall" && (() => {
              const rd = tournamentRoundLB[tournamentRoundTab];
              if (!rd) return <div className="empty">No scores for this round yet.</div>;
              const isRdGross = roundNetGross === "gross";
              const displayStandings = flightFilter(isRdGross ? (rd.grossStandings ?? rd.standings) : rd.standings);
              return (
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: flights.length > 0 ? 8 : 14, flexWrap: "wrap", gap: 8 }}>
                    <div className="card-hdr" style={{ marginBottom: 0 }}><Flag size={15} />{rd.label} — {FORMAT_LABELS[rd.format] ?? rd.format} · {rd.holes}H</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className={`btn btn-sm ${!isRdGross ? "btn-gold" : "btn-ghost"}`} onClick={() => setRoundNetGross("net")}>Net</button>
                      <button className={`btn btn-sm ${isRdGross ? "btn-gold" : "btn-ghost"}`} onClick={() => setRoundNetGross("gross")}>Gross</button>
                    </div>
                  </div>
                  {flights.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                      <button className={`btn btn-sm ${activeFlight === "all" ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight("all")}>All</button>
                      {flights.map(f => <button key={f.id} className={`btn btn-sm ${activeFlight === f.id ? "btn-gold" : "btn-ghost"}`} onClick={() => setActiveFlight(f.id)}>{f.name}</button>)}
                    </div>
                  )}
                  {displayStandings.length === 0 ? (
                    <div className="empty">No scores posted yet.</div>
                  ) : rd.isTeam ? (
                    <div className="tw">
                      <table>
                        <thead><tr><th>#</th><th>Team</th><th>Players</th><th>{isRdGross ? "Gross" : "Net"}</th></tr></thead>
                        <tbody>
                          {displayStandings.map((t, i) => (
                            <tr key={t.id}>
                              {rankEl(i)}
                              <td style={{ fontWeight: 600, color: "var(--cream)" }}>{t.name}</td>
                              <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{(t.players ?? []).map(rpn).join(", ") || "—"}</td>
                              <td><span className="sb">{isRdGross ? t.grossLabel : t.label}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead><tr><th>#</th><th>Player</th><th>{isRdGross ? "Gross" : "Net"}</th></tr></thead>
                        <tbody>
                          {displayStandings.map((p, i) => (
                            <tr key={p.id}>
                              {rankEl(i)}
                              <td style={{ fontWeight: 600, color: "var(--cream)" }}>{p.name}</td>
                              <td><span className="sb">{isRdGross ? p.grossLabel : p.label}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {leaderTab === "rules" && (
        <div className="card">
          <div className="card-hdr"><FileText size={15} />League Rules & Bylaws</div>
          {config.bylawsUrl ? (
            <div>
              <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 16, lineHeight: 1.6 }}>
                The official rules and bylaws for {config.bylawsName ?? "this league"}.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href={config.bylawsUrl} target="_blank" rel="noreferrer">
                  <button className="btn btn-gold">📄 Open Bylaws PDF ↗</button>
                </a>
                <a href={config.bylawsUrl} download={config.bylawsName ?? "bylaws.pdf"}>
                  <button className="btn btn-ghost">⬇ Download</button>
                </a>
              </div>
              <div style={{ marginTop: 20, borderRadius: 8, overflow: "hidden", border: "1px solid var(--gold-border)", background: "var(--navy-card)" }}>
                <iframe
                  src={config.bylawsUrl}
                  title="League Bylaws"
                  width="100%"
                  height="600px"
                  style={{ display: "block", border: "none" }}
                />
              </div>
            </div>
          ) : (
            <div className="empty">No bylaws uploaded yet.</div>
          )}
        </div>
      )}
    </>
  );
}
