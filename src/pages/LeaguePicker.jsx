import { useState } from "react";
import GSBLogo from "../components/GSBLogo.jsx";
import GhinLink from "../components/GhinLink.jsx";
import { FORMAT_LABELS } from "../constants/config.js";
import { ini } from "../utils/golf.js";

export default function LeaguePicker({
  profile, leagues, myMemberships,
  selectLeague, signOut,
  saveProfile,
  createLeague, joinLeague,
  joinCode, setJoinCode, joinMsg,
}) {
  const [profileModal, setProfileModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [showCreateLeague, setShowCreateLeague] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "" });

  const handleSaveProfile = async () => {
    await saveProfile(profileDraft);
    setProfileModal(false);
  };

  const handleCreateLeague = async () => {
    await createLeague(newLeague);
    setShowCreateLeague(false);
    setNewLeague({ name: "", description: "" });
  };

  return (
    <div style={{ background: "var(--navy)", minHeight: "100vh" }}>
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
                  <input type="text" placeholder="e.g. 1234567" value={profileDraft.ghin ?? ""} onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))} />
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GSBLogo size={56} />
            <div className="auth-title" style={{ fontSize: "1.3rem" }}>GREEK SIDE BUNKER</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <div className="avatar">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : ini(profile?.name)}
            </div>
            <div>
              <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{profile?.name}</div>
              {profile?.handicap != null && (
                <div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>
                  Hcp {profile.handicap}{profile.ghin && <span> · GHIN {profile.ghin}</span>}
                </div>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin });
              setProfileModal(true);
            }}>Edit Profile</button>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign Out</button>
          </div>
        </div>

        {/* Your Leagues */}
        <div style={{ marginBottom: 22 }}>
          <div className="card-hdr" style={{ marginBottom: 12 }}>Your Leagues</div>
          {leagues.length === 0 && (
            <div className="empty">No leagues yet — create one or join with a code below.</div>
          )}
          {leagues.map(l => {
            const m = myMemberships.find(x => x.league_id === l.id);
            return (
              <div key={l.id} className="league-card" onClick={() => selectLeague(l)}>
                <div>
                  <div className="league-name">{l.name}</div>
                  {l.description && <div className="league-meta">{l.description}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="fmt-pip">{FORMAT_LABELS[l.scoring_format ?? "stroke"]}</span>
                  <span className={`lrole ${m?.role ?? "player"}`}>
                    {m?.role === "admin" ? "Commissioner" : "Player"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Create a League */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-hdr">Create a League</div>
          {!showCreateLeague ? (
            <button className="btn btn-gold" onClick={() => setShowCreateLeague(true)}>+ New League</button>
          ) : (
            <div>
              <div className="fgrid" style={{ marginBottom: 14 }}>
                <div className="fg" style={{ gridColumn: "1/-1" }}>
                  <label>League Name</label>
                  <input type="text" placeholder="The Ryder Cup Crew" value={newLeague.name} onChange={e => setNewLeague(l => ({ ...l, name: e.target.value }))} />
                </div>
                <div className="fg" style={{ gridColumn: "1/-1" }}>
                  <label>Description (optional)</label>
                  <input type="text" placeholder="Summer 2025 season" value={newLeague.description} onChange={e => setNewLeague(l => ({ ...l, description: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-gold" onClick={handleCreateLeague} disabled={!newLeague.name.trim()}>Create</button>
                <button className="btn btn-ghost" onClick={() => setShowCreateLeague(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Join with Invite Code */}
        <div className="card">
          <div className="card-hdr">Join with Invite Code</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input type="text" placeholder="8-character code" value={joinCode}
              onChange={e => setJoinCode(e.target.value)} style={{ flex: 1 }}
              onKeyDown={e => e.key === "Enter" && joinLeague()} />
            <button className="btn btn-ghost" onClick={joinLeague}>Join</button>
          </div>
          {joinMsg.text && (
            <p className="note" style={{ color: joinMsg.ok ? "var(--green)" : "#f09090", marginTop: 8 }}>
              {joinMsg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
