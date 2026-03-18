import { useState } from "react";
import { supabase } from "../supabase.js";
import { calcCourseHcp, calcStableford, toPM, pmCls } from "../utils/golf.js";
import { FORMAT_LABELS } from "../constants/config.js";

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
}) {
  const [showHcpModal, setShowHcpModal] = useState(false);
  const [hcpDraft, setHcpDraft] = useState("");

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const myApprovedOnCourse = (cid) =>
    rounds.filter(r =>
      r.player_id === session?.user.id &&
      r.course_id === cid &&
      (config.attestRequired ? r.attest_status === "approved" : true)
    );

  const selectedCourse = courses.find(c => c.id === Number(form.courseId));
  const autoHcp = selectedCourse && config.useHandicap
    ? calcCourseHcp(profile?.handicap ?? 0, selectedCourse.slope, selectedCourse.par, selectedCourse.rating, config)
    : 0;
  const autoNet = form.score ? Number(form.score) - autoHcp : null;
  const autoPts = (autoNet !== null && config.scoringFormat === "stableford" && selectedCourse)
    ? calcStableford(Number(form.score), autoHcp, selectedCourse.par)
    : null;

  const isValidGhin = (ghin) => /^\d{7,8}$/.test(String(ghin ?? ""));
  const missingProfile = config.useHandicap && (!profile?.handicap && profile?.handicap !== 0 || !isValidGhin(profile?.ghin));

  const canSubmit = () => {
    if (!isOpen || !form.courseId || !form.score) return false;
    if (config.attestRequired && !form.attesterId) return false;
    if (config.scorecardRequired && !cardFile) return false;
    if (missingProfile) return false;
    return myApprovedOnCourse(Number(form.courseId)).length < config.roundsPerCourse;
  };

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : "⏳ Pending"}</span>;

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
      if (parsed.gross) setForm(f => ({ ...f, score: String(parsed.gross), date: parsed.date || f.date }));
    } catch (e) {
      console.warn("AI scorecard read failed:", e);
      setAiResult({ error: true });
    }
    setAiReading(false);
  };

  const handleCardFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) { alert("Max 10 MB"); return; }
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
            appUrl: window.location.origin,
            ccEmails: commissionerEmails,
          }),
        });
      } catch (e) { console.warn("Email non-fatal:", e); }
    }

    setRounds(p => [inserted, ...p]);
    setForm(f => ({ ...f, score: "", courseId: "", attesterId: "" }));
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
    if (path) await supabase.storage.from("scorecards").remove([`scorecards/${path}`]);
    await supabase.from("rounds").update({ scorecard_url: null }).eq("id", round.id);
    setRounds(p => p.map(r => r.id === round.id ? { ...r, scorecard_url: null } : r));
  };

  const myRounds = rounds.filter(r => r.player_id === session.user.id);

  return (
    <>
      {!isOpen && (
        <div className="alert-d" style={{ marginBottom: 16 }}>
          ⛔ Season is not currently active — score submission is closed.
        </div>
      )}

      {isOpen && missingProfile && (
        <div className="alert-w" style={{ marginBottom: 16 }}>
          ⚠ This league requires a handicap index and valid GHIN number (7-8 digits) to post scores.
          Please update your profile before submitting a round.
        </div>
      )}



      <div className="card" style={{ opacity: isOpen ? 1 : .65, pointerEvents: isOpen ? "auto" : "none" }}>
        <div className="card-hdr">
          ✏️ Post Your Round
          {config.scoringFormat !== "stroke" && (
            <span style={{ fontSize: ".74rem", color: "var(--purple)", marginLeft: 10, fontFamily: "var(--font-b)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {FORMAT_LABELS[config.scoringFormat]}
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
              <div style={{ fontSize: "1.4rem", marginBottom: 4 }}>📷</div>
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
                    ? "⚠ Couldn't read score — please enter manually."
                    : aiResult.gross
                      ? `✓ Detected score: ${aiResult.gross}${aiResult.date ? ` · Date: ${aiResult.date}` : ""} — fields pre-filled!`
                      : "Score not detected — please enter manually."}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form fields */}
        <div className="fgrid">
          <div className="fg">
            <label>Course</label>
            <select value={form.courseId} onChange={setF("courseId")}>
              <option value="">Select course…</option>
              {courses.filter(c => !c.playoff_only).map(c => {
                const played = myApprovedOnCourse(c.id).length;
                const full = played >= config.roundsPerCourse;
                return (
                  <option key={c.id} value={c.id} disabled={full}>
                    {c.name} · Par {c.par}{full ? " ✓" : played > 0 ? ` (${played}/${config.roundsPerCourse})` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          {config.attestRequired && (
            <div className="fg">
              <label>Attested By</label>
              <select value={form.attesterId} onChange={setF("attesterId")}>
                <option value="">Select playing partner…</option>
                {members.filter(m => m.user_id !== session.user.id).map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.profile.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="fg">
            <label>Gross Score</label>
            <input type="number" min={50} max={200} placeholder="e.g. 88" value={form.score} onChange={setF("score")} />
          </div>

          <div className="fg">
            <label>Date Played</label>
            <input type="date" value={form.date} onChange={setF("date")} />
          </div>
        </div>

        {/* Auto-calculated preview */}
        {form.courseId && form.score && (() => {
          const gross = Number(form.score);
          return (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: ".6rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)" }}>Auto-Calculated</span>
              {config.useHandicap && selectedCourse && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: ".6rem", color: "var(--cream-dim)", textTransform: "uppercase", letterSpacing: "1px" }}>Course Hcp</span>
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
          <button className="btn btn-gold" onClick={() => {
            if (!canSubmit()) return;
            setHcpDraft(String(profile?.handicap ?? ""));
            setShowHcpModal(true);
          }} disabled={!canSubmit()}>Submit Round</button>
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
                          <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>📋</button>
                          <button className="sc-btn" style={{ borderColor: "rgba(224,92,92,.3)", background: "rgba(224,92,92,.1)", color: "#f09090" }}
                            onClick={() => { if (window.confirm("Delete scorecard?")) deleteScorecard(r); }}>✕</button>
                        </div>
                      ) : (
                        <label className="sc-btn" style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.1)", color: "var(--cream-dim)", cursor: "pointer" }}>
                          📷 Add
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
