import { useState } from "react";
import GSBLogo from "../components/GSBLogo.jsx";
import HelpModal from "../components/HelpModal.jsx";
import GhinLink from "../components/GhinLink.jsx";
import { FORMAT_LABELS } from "../constants/config.js";
import { ini } from "../utils/golf.js";

// Deterministic color palette per league — cycles by id
const LEAGUE_COLORS = [
  { color: "#d4a843", bg: "rgba(212,168,67,.13)",  border: "rgba(212,168,67,.35)"  }, // gold
  { color: "#5b8de8", bg: "rgba(91,141,232,.13)",  border: "rgba(91,141,232,.35)"  }, // blue
  { color: "#9b7fe8", bg: "rgba(155,127,232,.13)", border: "rgba(155,127,232,.35)" }, // purple
  { color: "#4caf7d", bg: "rgba(76,175,125,.13)",  border: "rgba(76,175,125,.35)"  }, // green
  { color: "#e05c5c", bg: "rgba(224,92,92,.13)",   border: "rgba(224,92,92,.35)"   }, // red
  { color: "#4cbfaf", bg: "rgba(76,191,175,.13)",  border: "rgba(76,191,175,.35)"  }, // teal
];

const leagueColor = (id) => LEAGUE_COLORS[Number(id) % LEAGUE_COLORS.length];

const leagueInitials = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

export default function LeaguePicker({
  profile, leagues, myMemberships,
  selectLeague, signOut,
  saveProfile,
  createLeague, joinLeague,
  joinCode, setJoinCode, joinMsg,
}) {
  const [profileModal, setProfileModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "" });

  const handleSaveProfile = async () => {
    await saveProfile(profileDraft);
    setProfileModal(false);
  };

  const handleCreateLeague = async () => {
    if (creating) return;
    setCreating(true);
    await createLeague(newLeague);
    setShowCreate(false);
    setNewLeague({ name: "", description: "" });
    setCreating(false);
  };

  return (
    <div style={{ background: "var(--navy)", minHeight: "100vh" }}>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* Profile modal */}
      {profileModal && (
        <div className="modal-bg" onClick={() => setProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">My Profile</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fg">
                <label>Display Name</label>
                <input type="text" value={profileDraft.name ?? ""} onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="fgrid">
                <div className="fg">
                  <label>Handicap Index</label>
                  <input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4" value={profileDraft.handicap ?? ""} onChange={e => setProfileDraft(d => ({ ...d, handicap: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>GHIN #</label>
                  <input type="text" placeholder="e.g. 1234567" value={profileDraft.ghin ?? ""}
                    onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))}
                    style={{ borderColor: profileDraft.ghin && !/^\d{7,8}$/.test(String(profileDraft.ghin)) ? "var(--red)" : undefined }} />
                  {profileDraft.ghin && !/^\d{7,8}$/.test(String(profileDraft.ghin)) && (
                    <span style={{ fontSize: ".72rem", color: "var(--red)", marginTop: 2 }}>Must be 7–8 digits</span>
                  )}
                  {profileDraft.ghin && /^\d{7,8}$/.test(String(profileDraft.ghin)) && (
                    <span style={{ fontSize: ".72rem", color: "var(--green)", marginTop: 2 }}>✓ Valid format</span>
                  )}
                </div>
              </div>
              {profileDraft.ghin && <GhinLink ghin={profileDraft.ghin} />}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={handleSaveProfile}>Save</button>
              <button className="btn btn-ghost" onClick={() => setProfileModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="league-picker au">
        {/* Header */}
        <div className="lp-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GSBLogo size={48} />
            <div className="auth-title" style={{ fontSize: "1.15rem" }}>GREEK SIDE BUNKER</div>
          </div>
          <div className="lp-profile">
            <div className="avatar">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : ini(profile?.name)}
            </div>
            <div className="lp-profile-info">
              <div style={{ fontSize: ".88rem", color: "var(--cream)", lineHeight: 1.2 }}>{profile?.name}</div>
              {profile?.handicap != null && (
                <div style={{ fontSize: ".7rem", color: "var(--cream-dim)" }}>
                  Hcp {profile.handicap}{profile.ghin && <> · GHIN {profile.ghin}</>}
                </div>
              )}
            </div>
            <div className="lp-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => {
                setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin });
                setProfileModal(true);
              }}>Edit Profile</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(true)}>Guide</button>
              <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign Out</button>
            </div>
          </div>
        </div>

        {/* League grid */}
        <div className="lp-section-hdr">
          <div className="lp-section-title">
            Your Leagues{leagues.length > 0 && <span style={{ marginLeft: 8, opacity: .6 }}>({leagues.length})</span>}
          </div>
        </div>

        {leagues.length === 0 ? (
          <div className="empty" style={{ marginBottom: 24 }}>No leagues yet — create one or join with a code below.</div>
        ) : (
          <div className="league-grid">
            {leagues.map(l => {
              const m = myMemberships.find(x => x.league_id === l.id);
              const isAdmin = m?.role === "admin";
              const clr = leagueColor(l.id);
              const isTournament = !!l.tournamentMode;
              return (
                <div
                  key={l.id}
                  className="league-tile"
                  style={{ "--lt-color": clr.color, "--lt-bg": clr.bg, "--lt-border": clr.border }}
                  onClick={() => selectLeague(l)}
                >
                  <div className="lg-badge">{leagueInitials(l.name)}</div>
                  <div className="lg-info">
                    <div className="league-name">{l.name}</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: l.description ? 5 : 0 }}>
                      <span className="fmt-pip">{isTournament ? "Tournament" : FORMAT_LABELS[l.scoring_format ?? "stroke"]}</span>
                      <span className={`lrole ${isAdmin ? "admin" : "player"}`}>
                        {isAdmin ? "Commissioner" : "Player"}
                      </span>
                    </div>
                    {l.description && <div className="league-meta">{l.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create + Join */}
        <div className="lp-bottom">
          {/* Create */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-hdr" style={{ marginBottom: showCreate ? 14 : 0 }}>Create a League</div>
            {!showCreate ? (
              <button className="btn btn-gold btn-sm" onClick={() => setShowCreate(true)}>+ New League</button>
            ) : (
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                  <div className="fg">
                    <label>League Name</label>
                    <input type="text" placeholder="The Ryder Cup Crew" value={newLeague.name} onChange={e => setNewLeague(l => ({ ...l, name: e.target.value }))} />
                  </div>
                  <div className="fg">
                    <label>Description (optional)</label>
                    <input type="text" placeholder="Summer 2025 season" value={newLeague.description} onChange={e => setNewLeague(l => ({ ...l, description: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-gold btn-sm" onClick={handleCreateLeague} disabled={!newLeague.name.trim() || creating}>{creating ? "Creating..." : "Create"}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Join */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-hdr" style={{ marginBottom: showJoin ? 14 : 0 }}>Join with Invite Code</div>
            {!showJoin ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowJoin(true)}>Enter Code</button>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: joinMsg.text ? 8 : 0 }}>
                  <input type="text" placeholder="8-character code" value={joinCode}
                    onChange={e => setJoinCode(e.target.value)} style={{ flex: 1 }}
                    onKeyDown={e => e.key === "Enter" && joinLeague()} />
                  <button className="btn btn-ghost btn-sm" onClick={joinLeague}>Join</button>
                </div>
                {joinMsg.text && (
                  <div>
                    <p className="note" style={{ color: joinMsg.ok ? "var(--green)" : "#f09090", fontSize: ".8rem" }}>
                      {joinMsg.text}
                    </p>
                    {joinMsg.needsProfile && (
                      <button className="btn btn-gold btn-sm" style={{ marginTop: 8 }} onClick={() => {
                        setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin });
                        setProfileModal(true);
                      }}>Update Profile</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
