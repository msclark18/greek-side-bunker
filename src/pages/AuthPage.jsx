import { useState } from "react";
import GSBLogo from "../components/GSBLogo.jsx";
import HelpModal from "../components/HelpModal.jsx";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function AuthPage({
  authMode, setAuthMode,
  authEmail, setAuthEmail,
  authPassword, setAuthPassword,
  authName, setAuthName,
  authError, setAuthError,
  authSuccess, setAuthSuccess,
  authLoading,
  signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset,
}) {
  const [showHelp, setShowHelp] = useState(false);

  const hk = (e) => {
    if (e.key !== "Enter") return;
    if (authMode === "signup") signUpWithEmail();
    else if (authMode === "forgot") sendPasswordReset();
    else signInWithEmail();
  };

  return (
    <>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <div className="auth-bg">
        <div className="gp" />
        <div className="auth-box au">
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <GSBLogo size={72} style={{ margin: "0 auto 12px", display: "block" }} />
            <div className="auth-title">GREEK SIDE BUNKER</div>
            <div className="auth-sub">Golf League · Season Tracker</div>
            <div className="auth-divider" />
          </div>

          {authError && <div className="auth-error">{authError}</div>}
          {authSuccess && <div className="auth-success">{authSuccess}</div>}

          {authMode !== "forgot" && (
            <button className="btn-google" onClick={signInWithGoogle}>
              <GoogleIcon /> Continue with Google
            </button>
          )}
          {authMode !== "forgot" && <div className="or-divider"><span>or</span></div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {authMode === "signup" && (
              <div className="fg">
                <label>Your Name</label>
                <input type="text" placeholder="Jane Smith" value={authName}
                  onChange={e => { setAuthName(e.target.value); setAuthError(""); }}
                  onKeyDown={hk} autoComplete="name" />
              </div>
            )}
            <div className="fg">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" value={authEmail}
                onChange={e => { setAuthEmail(e.target.value); setAuthError(""); setAuthSuccess(""); }}
                onKeyDown={hk} autoComplete="email" />
            </div>
            {authMode !== "forgot" && (
              <div className="fg">
                <label>
                  Password{authMode === "signup" && (
                    <span style={{ color: "var(--cream-dim)", fontFamily: "var(--font-b)", textTransform: "none", letterSpacing: 0 }}> (min 6 chars)</span>
                  )}
                </label>
                <input
                  type="password"
                  placeholder={authMode === "signup" ? "Create a password" : "Enter your password"}
                  value={authPassword}
                  onChange={e => { setAuthPassword(e.target.value); setAuthError(""); }}
                  onKeyDown={hk}
                  autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                />
              </div>
            )}
            {authMode === "signin" && (
              <button className="forgot-pw" onClick={() => { setAuthMode("forgot"); setAuthError(""); setAuthSuccess(""); }}>
                Forgot password?
              </button>
            )}
          </div>

          <button
            className="btn btn-gold"
            style={{ width: "100%", padding: "13px", marginTop: 18 }}
            onClick={authMode === "signup" ? signUpWithEmail : authMode === "forgot" ? sendPasswordReset : signInWithEmail}
            disabled={authLoading}
          >
            {authLoading
              ? <span className="spinner" />
              : authMode === "signup" ? "Create Account"
              : authMode === "forgot" ? "Send Reset Email"
              : "Sign In"}
          </button>

          <div className="auth-toggle">
            {authMode === "forgot" ? (
              <span>Remembered it? <button onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSuccess(""); }}>Back to sign in</button></span>
            ) : authMode === "signin" ? (
              <span>New here? <button onClick={() => { setAuthMode("signup"); setAuthError(""); setAuthSuccess(""); }}>Create an account</button></span>
            ) : (
              <span>Already have one? <button onClick={() => { setAuthMode("signin"); setAuthError(""); setAuthSuccess(""); }}>Sign in</button></span>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button
              onClick={() => setShowHelp(true)}
              style={{ background: "none", border: "none", color: "var(--cream-dim)", fontSize: ".82rem", cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
            >
              How to use Greek Side Bunker?
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
