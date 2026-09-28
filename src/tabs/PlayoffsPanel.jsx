import { useState } from "react";
import { Trophy, Flag } from "lucide-react";
import { FORMAT_LABELS, DEFAULT_PLAYOFF_SCHEDULE } from "../constants/config.js";
import { isAfterSeasonEnd } from "../utils/golf.js";
import { supabase } from "../supabase.js";
import {
  buildCoursePlayoff,
  pairAdjacentWinners,
  matchCourseByName,
  qualificationLabel,
} from "../utils/playoffs.js";

const fmtWindow = (start, end) => {
  if (!start && !end) return null;
  const opts = { month: "short", day: "numeric" };
  const s = start ? new Date(start + "T12:00:00").toLocaleDateString(undefined, opts) : "";
  const e = end ? new Date(end + "T12:00:00").toLocaleDateString(undefined, opts) : "";
  return s && e ? `${s} – ${e}` : (s || e);
};

const ROUND_LABELS = ["Round 1", "Quarterfinals", "Semifinals", "Championship"];

export default function PlayoffsPanel({
  config, courses, members, scored, rounds, isAdmin, activeLeague, payouts, setConfig,
}) {
  const regularCourses = courses.filter(c => !c.playoff_only);
  const schedule = (config.playoffSchedule?.length ? config.playoffSchedule : DEFAULT_PLAYOFF_SCHEDULE);
  const locked = !!config.playoffLocked;
  const seasonOver = isAfterSeasonEnd(config);
  const [confirmReset, setConfirmReset] = useState(false);

  const minCourses = config.playoffMinCourses ?? 2;
  const byePriorityCourses = config.playoffByePriorityCourses ?? 4;
  const noByeMaxCourses = config.playoffNoByeMaxCourses ?? 2;
  const cutTo = config.playoffCutTo ?? 8;
  const maxField = config.playoffMaxField ?? 16;
  const seedBestPerCourse = config.playoffSeedBestPerCourse !== false;
  const showThirdPlace = !!config.playoffThirdPlace;

  const pendingBeforeCutoff = (rounds ?? []).filter(r => {
    if (r.round_status === "in_progress") return false;
    if (r.attest_status !== "pending") return false;
    if (!config.seasonEnd || !r.date) return true;
    return r.date <= config.seasonEnd;
  });

  const roundsByPlayer = {};
  for (const r of scored) {
    if (!roundsByPlayer[r.player_id]) roundsByPlayer[r.player_id] = [];
    roundsByPlayer[r.player_id].push(r);
  }

  const players = members.filter(m => m.profile).map(m => ({
    id: m.user_id,
    name: m.profile.name,
  }));

  const field = buildCoursePlayoff({
    players,
    roundsByPlayer,
    regularCourses,
    minCourses,
    byePriorityCourses,
    noByeMaxCourses,
    cutTo,
    maxField,
    seedBestPerCourse,
  });

  const seedByName = Object.fromEntries(field.seeds.map(p => [p.name, p.seed]));
  const savedBracket = config.playoffBracket ?? [];
  const projectedRound1 = field.round1Matchups;

  const initFourRounds = (round1) => {
    const labels = schedule.map((s, i) => s.label ?? ROUND_LABELS[i] ?? `Round ${i + 1}`);
    return [
      { round: 1, label: labels[0] ?? "Round 1", matchups: round1 },
      { round: 2, label: labels[1] ?? "Quarterfinals", matchups: [] },
      { round: 3, label: labels[2] ?? "Semifinals", matchups: [] },
      { round: 4, label: labels[3] ?? "Championship", matchups: [] },
    ];
  };

  const liveBracket = locked && savedBracket.length
    ? savedBracket
    : initFourRounds(projectedRound1);

  const fillLaterRounds = (bracket) => {
    const full = [...bracket];
    while (full.length < 4) {
      full.push({ round: full.length + 1, label: ROUND_LABELS[full.length], matchups: [] });
    }
    for (let r = 0; r < 3; r++) {
      const prev = full[r]?.matchups ?? [];
      if (!prev.length) continue;
      const allDone = prev.every(m => m.winner);
      const existing = full[r + 1]?.matchups ?? [];
      if (allDone) {
        const next = pairAdjacentWinners(prev).map((m, i) => ({
          ...m,
          winner: existing[i]?.winner ?? null,
        }));
        full[r + 1] = { ...full[r + 1], matchups: next };
      } else {
        const next = existing.length ? existing : pairAdjacentWinners(prev);
        full[r + 1] = {
          ...full[r + 1],
          matchups: next.map((m, i) => ({
            ...m,
            p1: prev[i * 2]?.winner ?? m.p1,
            p2: prev[i * 2 + 1]?.winner ?? m.p2,
          })),
        };
      }
    }
    return full;
  };

  const displayBracket = fillLaterRounds(liveBracket);
  const treeHeight = Math.max(displayBracket[0]?.matchups?.length ?? 1, 1) * 136;
  const hasMatchWinner = (config.playoffBracket ?? []).some(r => (r.matchups ?? []).some(m => m.winner && !m.isBye));

  const saveBracket = async (newBracket, extra = {}) => {
    const newCfg = { ...config, playoffBracket: newBracket, ...extra };
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
  };

  const lockField = async () => {
    await saveBracket(initFourRounds(projectedRound1), { playoffLocked: true });
  };

  const resetBracket = async () => {
    await saveBracket([], { playoffLocked: false, thirdPlaceMatch: null });
    setConfirmReset(false);
  };

  const requestReset = () => {
    if (hasMatchWinner) setConfirmReset(true);
    else resetBracket();
  };

  const setWinner = (roundIdx, matchIdx, winner, forfeitOf) => {
    const base = (locked && savedBracket.length) ? savedBracket : initFourRounds(projectedRound1);
    const updated = fillLaterRounds(base).map((round, ri) => {
      if (ri !== roundIdx) return round;
      return {
        ...round,
        matchups: round.matchups.map((m, mi) => mi !== matchIdx
          ? m
          : { ...m, winner, forfeit: forfeitOf || null, isBye: m.isBye }),
      };
    });
    saveBracket(updated, locked ? { playoffLocked: true } : { playoffLocked: true });
  };

  const setThirdPlaceWinner = (winner) => {
    const semis = displayBracket[2];
    const p1 = semis?.matchups?.[0]?.winner === semis?.matchups?.[0]?.p1 ? semis?.matchups?.[0]?.p2 : semis?.matchups?.[0]?.p1;
    const p2 = semis?.matchups?.[1]?.winner === semis?.matchups?.[1]?.p1 ? semis?.matchups?.[1]?.p2 : semis?.matchups?.[1]?.p1;
    const base = (locked && savedBracket.length) ? savedBracket : initFourRounds(projectedRound1);
    saveBracket(fillLaterRounds(base), { playoffLocked: true, thirdPlaceMatch: { p1, p2, winner } });
  };

  const cutoffLabel = config.seasonEnd
    ? new Date(config.seasonEnd + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "season end";

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div className="card-hdr" style={{ marginBottom: 0 }}><Trophy size={15} />Playoff Qualifiers</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="fmt-pip" style={{ background: "rgba(212,168,67,.12)", borderColor: "var(--gold-border)", color: "var(--gold-light)" }}>{FORMAT_LABELS[config.playoffFormat] ?? "Match Play"}</span>
            <span style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>
              {locked ? "Field locked" : seasonOver ? "Awaiting lock" : "Projected"} · min {minCourses} of {regularCourses.length} courses
            </span>
          </div>
        </div>
        <p className="note" style={{ marginBottom: 12 }}>
          Qualify with {minCourses} of {regularCourses.length} courses by {cutoffLabel}. Completing all {byePriorityCourses} reserves seeds 1–{byePriorityCourses} and Round 1 bye priority. Players who miss a course are seeded no higher than {byePriorityCourses + 1} unless those top spots still need filling. Players with only {noByeMaxCourses} courses qualify but cannot receive a bye. Round 1 cuts the field to {cutTo}.
        </p>
        {pendingBeforeCutoff.length > 0 && (
          <div className="alert-w" style={{ marginBottom: 12, fontSize: ".78rem" }}>
            {pendingBeforeCutoff.length} pending round{pendingBeforeCutoff.length !== 1 ? "s" : ""} dated on or before {cutoffLabel} {locked ? "were not included in the locked field." : "could still change the projected bracket."}
          </div>
        )}
        {field.seeds.length === 0
          ? <div className="empty">No one has qualified yet — post at least {minCourses} courses.</div>
          : field.seeds.map(p => {
              const memberRecord = members.find(m => m.user_id === p.id);
              const isPaid = memberRecord?.paid ?? false;
              return (
                <div key={p.id} className="qualifier-chip" style={{ borderColor: isPaid ? "rgba(76,175,125,.2)" : "rgba(224,92,92,.15)" }}>
                  <div className="qualifier-seed">#{p.seed}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span className="qualifier-name" style={{ flex: "unset" }}>{p.name}</span>
                      {p.hasBye && <span className="paid-badge paid">Bye</span>}
                      {config.entryFee > 0 && <span className={`paid-badge ${isPaid ? "paid" : "unpaid"}`}>{isPaid ? "✓ Paid" : "✗ Unpaid"}</span>}
                    </div>
                    <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginTop: 2 }}>
                      {p.netAvg?.toFixed(1)} {seedBestPerCourse ? "best-per-course avg" : "avg net"} · {p.coursesPlayed}/{p.totalCourses} courses · {qualificationLabel(p.status)}
                    </div>
                  </div>
                </div>
              );
            })
        }
      </div>

      {field.seeds.length >= 2 && (
        <div className="card" style={{ background: "linear-gradient(180deg,rgba(10,14,26,1),rgba(16,20,34,1))", border: "1px solid rgba(212,168,67,.12)", overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(ellipse 80% 50% at 50% 0%,rgba(212,168,67,.05),transparent)", pointerEvents: "none" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 8, position: "relative" }}>
            <div>
              <div className="card-hdr" style={{ marginBottom: 4 }}><Trophy size={15} />Tournament Bracket</div>
              <div style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>
                {locked ? "Locked field" : "Projected — updates as rounds are approved"} · {field.fieldSize}-player field → {cutTo}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isAdmin && (locked || savedBracket.length > 0) && (
                <button className="btn btn-danger btn-sm" onClick={requestReset}>Reset</button>
              )}
              {isAdmin && !locked && (
                <button className="btn btn-gold btn-sm" onClick={lockField}>{seasonOver ? "Lock Bracket" : "Lock now"}</button>
              )}
            </div>
          </div>

          {isAdmin && displayBracket.length > 0 && (
            <div className="alert-w" style={{ marginBottom: 18, fontSize: ".78rem" }}>
              Click a player's name to advance them. Use Forfeit on their row if they cannot play in the window.
            </div>
          )}

          {config.playoffWeatherBuffer && (
            <p className="note" style={{ marginBottom: 16 }}>{config.playoffWeatherBuffer}</p>
          )}

          <div className="bracket-wrap">
            <div className="bracket">
              {displayBracket.map((round, roundIdx) => {
                const matchups = round.matchups ?? [];
                const sched = schedule[roundIdx];
                const course = sched ? matchCourseByName(courses, sched.courseName) : null;
                const windowLabel = sched ? fmtWindow(sched.start, sched.end) : null;
                const isLastRound = roundIdx === displayBracket.length - 1;
                return (
                  <div key={roundIdx} className={`bk-round-wrap${isLastRound ? " is-final" : ""}`}>
                    <div className="bk-round-head">
                      <div className="bk-round-label">{round.label ?? `Round ${round.round}`}</div>
                      {(course || windowLabel || sched?.courseName) && (
                        <div className="bk-round-meta">
                          {course && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Flag size={11} />{course.name}</span>}
                          {!course && sched?.courseName && <span>{sched.courseName}</span>}
                          {windowLabel && <span>{windowLabel}</span>}
                        </div>
                      )}
                    </div>
                    {matchups.length === 0 ? (
                      <div className="bk-col" style={{ minHeight: treeHeight }}>
                        <div className="bk-awaiting">
                          {roundIdx === 0 ? "Need two qualified players to build Round 1." : "Awaiting previous round…"}
                        </div>
                      </div>
                    ) : (
                      <div className="bk-col" style={{ minHeight: treeHeight }}>
                        {matchups.map((match, matchIdx) => {
                          const slots = [{ name: match.p1, slot: "p1" }, { name: match.p2, slot: "p2" }];
                          const isByeMatch = !!match.isBye;
                          return (
                            <div key={matchIdx} className={`bk-match-cell${isByeMatch ? " is-bye" : ""}`}>
                              <div className="bk-match">
                                <div className={`bk-match-inner${match.winner ? " has-winner" : ""}${isByeMatch ? " is-bye" : ""}`}>
                                  {slots.map(({ name, slot }, si) => {
                                    const isByeSlot = isByeMatch && !name;
                                    const isWinner = !isByeSlot && match.winner === name;
                                    const isLoser = match.winner && !isWinner && !!name;
                                    const isEmpty = !name && !isByeSlot;
                                    const canClick = isAdmin && name && !match.winner && !isByeMatch;
                                    const canForfeit = canClick && match.p1 && match.p2;
                                    const opponent = slot === "p1" ? match.p2 : match.p1;
                                    return (
                                      <div key={slot}>
                                        <div
                                          className={`bk-slot${isWinner ? " s-winner" : ""}${isLoser ? " s-loser" : ""}${isEmpty ? " s-empty" : ""}${isByeSlot ? " s-bye" : ""}${canClick ? " clickable" : ""}`}
                                          onClick={() => canClick && setWinner(roundIdx, matchIdx, name)}
                                        >
                                          <span className="bk-seed">{name ? (seedByName[name] || "") : ""}</span>
                                          <span className="bk-name">{isByeSlot ? "BYE" : (name ?? "TBD")}</span>
                                          {canForfeit && (
                                            <button
                                              type="button"
                                              className="bk-forfeit-btn"
                                              title={`Forfeit ${name}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setWinner(roundIdx, matchIdx, opponent, name);
                                              }}
                                            >Forfeit</button>
                                          )}
                                          {isWinner && <span className="bk-win-icon">{isByeMatch ? "BYE" : (match.forfeit && match.forfeit !== name ? "F" : "✓")}</span>}
                                        </div>
                                        {si === 0 && <div className="bk-slot-divider" />}
                                      </div>
                                    );
                                  })}
                                </div>
                                {match.forfeit && match.winner && (
                                  <div className="bk-forfeit-note">{match.forfeit} forfeited</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {(() => {
                const champ = displayBracket[displayBracket.length - 1]?.matchups?.[0]?.winner;
                if (!champ) return null;
                return (
                  <div className="bk-round-wrap bk-champion-col">
                    <div className="bk-round-head" />
                    <div className="bk-col" style={{ minHeight: treeHeight }}>
                      <div className="bk-champion">
                        <div className="bk-champ-card">
                          <span className="bk-champ-trophy"><Trophy size={32} /></span>
                          <div className="bk-champ-label">Champion</div>
                          <div className="bk-champ-name">{champ}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {showThirdPlace && (() => {
            const semis = displayBracket[2];
            const semisComplete = semis?.matchups?.every(m => m.winner) && (semis?.matchups?.length ?? 0) >= 2;
            const tpm = config.thirdPlaceMatch;
            const p1 = tpm?.p1 ?? (semisComplete ? (semis.matchups[0]?.winner === semis.matchups[0]?.p1 ? semis.matchups[0]?.p2 : semis.matchups[0]?.p1) : null);
            const p2 = tpm?.p2 ?? (semisComplete ? (semis.matchups[1]?.winner === semis.matchups[1]?.p1 ? semis.matchups[1]?.p2 : semis.matchups[1]?.p1) : null);
            const winner = tpm?.winner ?? null;
            return (
              <div className="bk-third" style={{ position: "relative", marginTop: 20 }}>
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
                              <span className="bk-seed">{name ? (seedByName[name] || "") : ""}</span>
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

      {confirmReset && (
        <div className="modal-bg" onClick={() => setConfirmReset(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Reset Bracket?</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 16, lineHeight: 1.7 }}>
              This clears all match winners and forfeits, then unlocks the field so the projected bracket can rebuild from current scores.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-danger" onClick={resetBracket}>Yes, Reset</button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
