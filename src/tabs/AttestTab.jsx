import { supabase } from "../supabase.js";
import { toPM, pmCls } from "../utils/golf.js";

export default function AttestTab({ pendingForMe, config, setRounds, setViewCardModal }) {
  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb ${pmCls(net, par)}`}>{net} <span style={{ fontSize: ".72rem", opacity: .7 }}>({toPM(net, par)})</span></span>
    : <span className="sb">{net}</span>;

  const approveRound = async (r) => {
    const { error } = await supabase.from("rounds")
      .update({ attest_status: "approved", attest_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { alert("Error: " + error.message); return; }
    setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "approved" } : x));
  };

  const rejectRound = async (r) => {
    const note = window.prompt("Reason for rejection (optional):") || "";
    const { error } = await supabase.from("rounds")
      .update({ attest_status: "rejected", attest_note: note, attest_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { alert("Error: " + error.message); return; }
    setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "rejected", attest_note: note } : x));
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
              <button className="btn btn-danger" onClick={() => rejectRound(r)}>✗ Reject</button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
