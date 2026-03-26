import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("GSB Error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { onReset } = this.props;

    return (
      <div style={{
        background: "var(--navy, #0a0e1a)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "Georgia, serif",
      }}>
        <div style={{
          background: "#161d2e",
          border: "1px solid rgba(212,168,67,.3)",
          borderRadius: 14,
          padding: "36px 32px",
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}>
          <div style={{ marginBottom: 16, color: "#d4a843" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div style={{ fontSize: "1rem", letterSpacing: "3px", color: "#faf9f6", fontWeight: 700, marginBottom: 8 }}>
            GREEK SIDE BUNKER
          </div>
          <div style={{ fontSize: ".75rem", letterSpacing: "2px", textTransform: "uppercase", color: "#d4a843", marginBottom: 24 }}>
            Something went wrong
          </div>
          <p style={{ fontSize: ".9rem", color: "#c8bfa8", lineHeight: 1.7, marginBottom: 28 }}>
            The app ran into an unexpected error. This is usually caused by a connection issue or a temporary outage. Please try refreshing the page.
          </p>
          {this.state.error && (
            <pre style={{ fontSize: ".72rem", color: "#ef4444", marginBottom: 20, textAlign: "left",
              background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)",
              borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error.toString()}
            </pre>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "11px 24px",
                background: "linear-gradient(135deg, #d4a843, #f0c96a)",
                color: "#0a0e1a", border: "none", borderRadius: 8,
                fontFamily: "Georgia, serif", fontSize: ".85rem",
                fontWeight: 700, cursor: "pointer", letterSpacing: "1px",
              }}
            >
              Refresh Page
            </button>
            {onReset && (
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); onReset(); }}
                style={{
                  padding: "11px 24px", background: "rgba(255,255,255,.06)", color: "#f0ead8",
                  border: "1px solid rgba(255,255,255,.15)", borderRadius: 8,
                  fontFamily: "Georgia, serif", fontSize: ".85rem", cursor: "pointer",
                }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
