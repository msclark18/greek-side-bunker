import { useState } from "react";
import { supabase } from "../supabase.js";
import { toPM, pmCls } from "../utils/golf.js";

export default function AttestTab({ pendingForMe, config, setRounds, setViewCardModal }) {
  const [attestMsg, setAttestMsg] = useState({ id: null, text: "", ok: true });
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectNote, setRejectNote] = useState("");

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const approveRound = async (r) => {
    const { error } = await supabase.from("rounds")
      .update({ attest_status: "approved", attest_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { setAttestMsg({ id: r.id, text: "Error approving round. Please try again.", ok: false }); return; }
    setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "approved" } : x));
  };

  const rejectRound = async () => {
    if (!rejectModal) return;
    const { error } = await supabase.from("rounds")
      .update({ attest_status: "rejected", attest_note: rejectNote, attest_at: new Date().toISOString() })
      .eq("id", rejectModal.id);
    if (error) { setAttestMsg({ id: rejectModal.id, text: "Error rejecting round. Please try again.", ok: false }); return; }
    setRounds(p => p.map(x => x.id === rejectModal.id ? { ...x, attest_status: "rejected", attest_note: rejectNote } : x));
    setRejectModal(null);
    setRejectNote("");
  };

  return (
    <>
      <div className="card-hdr" style={{ marginBottom: 16 }}>⏳ Rounds Awaiting Your Attestation</div>

      {pendingForMe.length === 0 ? (
        <div className="card"><div className="empty">No rounds waiting for your attestation. 🎉</div></div>
      ) : (
        pendingForMe.map(r => (
          <div key={r.id} className="attest-card">
            <div className="attest-card-top">
              <div>
                <div className="attest-player">{r.player_name}</div>
                <div className="attest-meta">{r.course_name} · {r.date}</div>
              </div>
              {r.scorecard_url && (
                <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}>
                  📋 View Scorecard
                </button>
              )}
            </div>

            <div className="attest-scores">
              <div className="attest-score-block">
                <div className="attest-score-label">Gross</div>
                <div className="attest-score-val">{r.gross}</div>
              </div>
              {config.useHandicap && (
                <div className="attest-score-block">
                  <div className="attest-score-label">Course Hcp</div>
                  <div className="attest-score-val" style={{ fontSize: "1.1rem", color: "#9ab8f0" }}>{r.course_handicap}</div>
                </div>
              )}
              <div className="attest-score-block">
                <div className="attest-score-label">Net</div>
                <div className="attest-score-val">{netEl(r.net, r.par)}</div>
              </div>
              <div className="attest-score-block">
                <div className="attest-score-label">Par</div>
                <div className="attest-score-val" style={{ color: "var(--cream-dim)", fontSize: "1.1rem" }}>{r.par}</div>
              </div>
              {config.scoringFormat === "stableford" && r.stableford_pts != null && (
                <div className="attest-score-block">
                  <div className="attest-score-label">Pts</div>
                  <div className="attest-score-val" style={{ color: "var(--purple)" }}>{r.stableford_pts}</div>
                </div>
              )}
            </div>

            <div className="attest-actions">
              <button className="btn btn-gold btn-sm" onClick={() => approveRound(r)}>✓ Approve Round</button>
              <button className="btn btn-danger" onClick={() => { setRejectModal(r); setRejectNote(""); }}>✗ Reject</button>
            </div>
          </div>
        ))
      )}
      {/* Reject modal */}
      {rejectModal && (
        <div className="modal-bg" onClick={() => setRejectModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Reject Round</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 16, lineHeight: 1.6 }}>
              Rejecting <strong style={{ color: "var(--cream)" }}>{rejectModal.player_name}</strong>'s round at {rejectModal.course_name}. Add a note to let them know why (optional).
            </p>
            <div className="fg" style={{ marginBottom: 16 }}>
              <label>Reason (optional)</label>
              <input type="text" placeholder="e.g. Score doesn't match what I recorded"
                value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                onKeyDown={e => e.key === "Enter" && rejectRound()} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-danger" onClick={rejectRound}>Confirm Rejection</button>
              <button className="btn btn-ghost" onClick={() => setRejectModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
