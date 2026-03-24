import { User, Pencil, Clock, Trophy, Flag, Smartphone } from "lucide-react";

export default function HelpModal({ onClose }) {
  const sections = [
    {
      icon: <User size={18} />,
      title: "Getting Started",
      steps: [
        { heading: "Create your account", body: "Sign up with Google or your email address. Your profile is created automatically." },
        { heading: "Set up your profile", body: "Tap your name in the top right → Edit Profile. Add your Display Name, Handicap Index (from GHIN or TheGrint), and your 7-8 digit GHIN number. This is required to join leagues that use handicaps." },
        { heading: "Join a league", body: "Enter the invite code given to you by your commissioner and tap Join. If the league requires approval, your request will be sent to the commissioner." },
      ]
    },
    {
      icon: <Pencil size={18} />,
      title: "Posting a Score",
      steps: [
        { heading: "Go to Post Score", body: "Tap the Post Score tab at the top of the screen." },
        { heading: "Fill in your round", body: "Select the course, enter your gross score, choose the date, and select your playing partner (attester)." },
        { heading: "Upload your scorecard", body: "Take a photo of your scorecard. The app will use AI to automatically read your gross score, course, and date — filling in the fields for you." },
        { heading: "Confirm your handicap", body: "Before submitting, a modal will show your current Handicap Index and the calculated course handicap. Update your index if it has changed recently, then hit Confirm & Submit." },
        { heading: "Attestation email", body: "Your playing partner receives an email to approve or reject your round. They can also attest from the Attest tab inside the app." },
      ]
    },
    {
      icon: <Clock size={18} />,
      title: "Attesting a Round",
      steps: [
        { heading: "Via email", body: "Click Approve or Reject directly in the attestation email. You'll see a confirmation page and the round updates instantly." },
        { heading: "Via the app", body: "Go to the Attest tab. Pending rounds waiting for your approval will appear there. Tap Approve or Reject — rejected rounds require a note." },
      ]
    },
    {
      icon: <Trophy size={18} />,
      title: "Leaderboard",
      steps: [
        { heading: "Overall standings", body: "Players are ranked by net average (stroke play) or total points (Stableford). Only approved rounds count." },
        { heading: "Score visibility", body: "If your commissioner has enabled 'Hide scores until submitted', you won't see other players' scores until you post your own round." },
        { heading: "Counting rounds", body: "Your commissioner may set a limit on how many rounds count — e.g. best 5 of 8. Your best rounds are used automatically." },
      ]
    },
    {
      icon: <Flag size={18} />,
      title: "Handicaps",
      steps: [
        { heading: "What to enter", body: "Enter your total Handicap Index from GHIN or TheGrint — not your course handicap. The app calculates course handicap automatically using the USGA formula: Handicap Index × (Slope ÷ 113) + (Course Rating − Par)." },
        { heading: "Keep it current", body: "Update your Handicap Index in your profile whenever it changes. You'll also be prompted to confirm it every time you post a score." },
        { heading: "Frozen at submission", body: "Your handicap is locked in at the time you submit. If you update it later, past rounds are not affected." },
      ]
    },
    {
      icon: <Smartphone size={18} />,
      title: "Install the App",
      steps: [
        { heading: "iPhone (Safari only)", body: "Open greeksidebunker.com in Safari. Tap the Share button (box with arrow) → Add to Home Screen → Add. The app icon will appear on your home screen." },
        { heading: "Android (Chrome)", body: "Open greeksidebunker.com in Chrome. Tap the three dots menu → Add to Home Screen, or look for the Install App prompt at the bottom of the screen." },
      ]
    },
  ];

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600, maxHeight: "85vh", overflowY: "auto", padding: 0 }} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ position: "sticky", top: 0, background: "var(--navy-card)", borderBottom: "1px solid var(--gold-border)", padding: "20px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 10 }}>
          <div>
            <div style={{ fontSize: ".62rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", marginBottom: 4 }}>How to use</div>
            <div style={{ fontSize: "1.2rem", fontFamily: "var(--font-d)", color: "var(--white)", letterSpacing: "1px" }}>GREEK SIDE BUNKER</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        {/* Sections */}
        <div style={{ padding: "20px 24px 28px" }}>
          {sections.map((section, si) => (
            <div key={si} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: "1.2rem" }}>{section.icon}</span>
                <div style={{ fontSize: ".7rem", letterSpacing: "2px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", fontWeight: 600 }}>{section.title}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {section.steps.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(212,168,67,.15)", border: "1px solid rgba(212,168,67,.3)", color: "var(--gold)", fontSize: ".7rem", fontFamily: "var(--font-d)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: ".88rem", color: "var(--white)", fontWeight: 600, marginBottom: 3 }}>{step.heading}</div>
                      <div style={{ fontSize: ".84rem", color: "var(--cream-dim)", lineHeight: 1.6 }}>{step.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              {si < sections.length - 1 && (
                <div style={{ borderBottom: "1px solid var(--navy-border)", marginTop: 20 }} />
              )}
            </div>
          ))}

          {/* Footer */}
          <div style={{ background: "rgba(212,168,67,.06)", border: "1px solid rgba(212,168,67,.2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: ".78rem", color: "var(--cream-dim)", lineHeight: 1.6 }}>
              Questions? Contact your league commissioner.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
