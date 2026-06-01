import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Trophy, Pencil, Clock, Settings, FileText, AlertTriangle } from "lucide-react";
import { supabase } from "./supabase.js";
import { DEFAULT_CONFIG, FORMAT_LABELS } from "./constants/config.js";
import { calcCourseHcp, isSeasonActive, ini } from "./utils/golf.js";
import GSBLogo from "./components/GSBLogo.jsx";
import GhinLink from "./components/GhinLink.jsx";
import SeasonBar from "./components/SeasonBar.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import LeaguePicker from "./pages/LeaguePicker.jsx";
import Leaderboard from "./tabs/Leaderboard.jsx";
import PostScore from "./tabs/PostScore.jsx";
import AttestTab from "./tabs/AttestTab.jsx";
import AdminTab from "./tabs/AdminTab.jsx";
import HelpModal from "./components/HelpModal.jsx";
import LiveScorecard from "./components/LiveScorecard.jsx";
import RoundScorecardViewer from "./components/RoundScorecardViewer.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles/app.css";

export default function App() {
  // ── Auth state ──
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── League state ──
  const [leagues, setLeagues] = useState([]);
  const [myMemberships, setMyMemberships] = useState([]);
  const [activeLeague, setActiveLeague] = useState(null);
  const [activeMembership, setActiveMembership] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState({ text: "", ok: true });

  // ── League data ──
  const [courses, setCourses] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [members, setMembers] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [payouts, setPayouts] = useState({});
  const [pendingJoins, setPendingJoins] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  // ── UI state ──
  const [tab, setTab] = useState(() => sessionStorage.getItem("gsb_tab") || "leaderboard");
  const [selCourse, setSelCourse] = useState(null);
  const [viewCardModal, setViewCardModal] = useState(null);
  const [profileModal, setProfileModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [playersModal, setPlayersModal] = useState(false);
  const [showProfileGate, setShowProfileGate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [dbError, setDbError] = useState(null);
  const creatingLeague = useRef(false);
  const activeLeagueRef = useRef(null);
  useEffect(() => { activeLeagueRef.current = activeLeague; }, [activeLeague]);
  useEffect(() => { sessionStorage.setItem("gsb_tab", tab); }, [tab]);
  // True while we're waiting to restore a saved league — prevents picker flash
  const [restoringLeague, setRestoringLeague] = useState(() => !!sessionStorage.getItem("gsb_league_id"));

  // ── Post score state ──
  const [liveRound, setLiveRound] = useState(null);
  const [companionRounds, setCompanionRounds] = useState([]);
  useEffect(() => { if (!liveRound) setCompanionRounds([]); }, [liveRound]);
  const [form, setForm] = useState({ courseId: "", score: "", net: "", attesterId: "", date: new Date().toISOString().split("T")[0], teamId: "", tournamentRoundId: "" });
  const [formMsg, setFormMsg] = useState({ type: "", text: "" });
  const [cardFile, setCardFile] = useState(null);
  const [cardPreview, setCardPreview] = useState(null);
  const [aiReading, setAiReading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // ── Auth init ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // ── Trap back button so it navigates within the app instead of closing it ──
  // On Android WebAPK the OS closes the app when the history entry is at start_url ("/").
  // We replace the initial entry with "/#app" (a hash, same page, no reload) so our
  // synthetic entries are never at the bare start_url, preventing the close.
  useEffect(() => {
    const appHref = location.origin + location.pathname + '#app';
    // Don't touch the hash if Supabase put OAuth tokens in it
    const isOAuthCallback = location.hash.includes('access_token') || location.hash.includes('refresh_token') || location.hash.includes('error_description');
    if (!isOAuthCallback) {
      history.replaceState(null, '', appHref);
      history.pushState(null, '', appHref);
    }
    const onPop = () => {
      if (activeLeagueRef.current) {
        setActiveLeague(null);
        setDataLoaded(false);
        sessionStorage.removeItem("gsb_league_id");
      }
      history.pushState(null, '', appHref);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data, error }) => { if (!error && data) setProfile(data); });
    consumePendingInvites();
    loadLeagues();
  }, [session]);

  const consumePendingInvites = async () => {
    const email = session?.user?.email;
    if (!email) return;
    const { data: invites } = await supabase
      .from("league_invites")
      .select("*")
      .eq("email", email.toLowerCase());
    if (!invites?.length) return;
    for (const inv of invites) {
      // Add to league (ignore duplicate error if already a member)
      await supabase.from("league_members").insert({ league_id: inv.league_id, user_id: session.user.id, role: "player" });
      // Apply profile overrides the commissioner set
      const updates = {};
      if (inv.name) updates.name = inv.name;
      if (inv.handicap != null) updates.handicap = Number(inv.handicap);
      if (inv.ghin) updates.ghin = inv.ghin;
      if (Object.keys(updates).length > 0) {
        await supabase.from("profiles").update(updates).eq("id", session.user.id);
      }
      await supabase.from("league_invites").delete().eq("id", inv.id);
    }
    loadLeagues();
  };

  const loadLeagues = async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase.from("league_members").select("*, league:leagues(*)").eq("user_id", session.user.id);
    if (error) { console.error("Supabase error loading leagues:", error); return; }
    const rawLeagues = (data || []).map(m => m.league).filter(Boolean);
    // Fetch tournament mode flags for all leagues in one query
    const leagueIds = rawLeagues.map(l => l.id);
    const { data: settings } = leagueIds.length
      ? await supabase.from("league_settings").select("league_id, config").in("league_id", leagueIds)
      : { data: [] };
    const tournamentByLeague = Object.fromEntries((settings || []).map(s => [s.league_id, !!(s.config?.tournamentMode)]));
    setMyMemberships(data || []);
    const mappedLeagues = rawLeagues.map(l => ({ ...l, tournamentMode: tournamentByLeague[l.id] ?? false }));
    setLeagues(mappedLeagues);

    // Restore league from previous session (survives refresh)
    const savedId = sessionStorage.getItem("gsb_league_id");
    if (savedId && !activeLeagueRef.current) {
      const saved = mappedLeagues.find(l => String(l.id) === savedId);
      if (saved) {
        setActiveMembership((data || []).find(m => String(m.league_id) === savedId));
        setActiveLeague(saved);
        loadLeagueData(saved);
        setShowProfileGate(true);
        // Don't pushState here — the mount effect already seeded the history buffer,
        // and an async push after a refresh can confuse iOS WebKit's native nav stack.
      } else {
        sessionStorage.removeItem("gsb_league_id");
      }
    }
    setRestoringLeague(false);
  };

  // ── Auth actions ──
  const signInWithGoogle = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + "/" } });

  const signInWithEmail = async () => {
    setAuthError(""); setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) setAuthError(error.message);
  };

  const signUpWithEmail = async () => {
    if (!authName.trim()) { setAuthError("Please enter your name."); return; }
    setAuthError(""); setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: authName.trim() } } });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    if (data?.user && !data.session) setAuthSuccess("Check your email to confirm your account.");
  };

  const sendPasswordReset = async () => {
    if (!authEmail) { setAuthError("Enter your email first."); return; }
    setAuthError(""); setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: window.location.origin + "?reset=true" });
    setAuthLoading(false);
    if (error) setAuthError(error.message); else setAuthSuccess("Password reset email sent!");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setActiveLeague(null);
    setDataLoaded(false);
    sessionStorage.removeItem("gsb_league_id");
  };

  // ── League actions ──
  const loadLeagueData = useCallback(async (league) => {
    setDataLoaded(false);
    setDbError(null);
    try {
      const [{ data: c, error: ce }, { data: r, error: re }, { data: m, error: me }, { data: s }, { data: pj }] = await Promise.all([
        supabase.from("courses").select("*").eq("league_id", league.id).order("name"),
        supabase.from("rounds").select("id,league_id,player_id,player_name,attester_id,attester_name,attester_email,course_id,course_name,gross,net,stableford_pts,course_handicap,par,date,scoring_format,attest_status,attest_token,attest_at,attest_note,scorecard_url,hole_scores,round_status,tracking_only,group_id,team_id,tournament_round_id,created_at").eq("league_id", league.id).order("created_at", { ascending: false }),
        supabase.from("league_members").select("*, profile:profiles(*)").eq("league_id", league.id),
        supabase.from("league_settings").select("*").eq("league_id", league.id).single(),
        supabase.from("league_join_requests").select("*, profile:profiles(*)").eq("league_id", league.id).eq("status", "pending"),
      ]);
      if (ce || re || me) {
        setDbError("Unable to load league data. Please refresh.");
        setDataLoaded(true);
        return;
      }
      setCourses(c ?? []); setRounds(r ?? []); setMembers(m ?? []);
      const cfg = { ...DEFAULT_CONFIG, ...(s?.config ?? {}) };
      setConfig(cfg); setPayouts(s?.payouts ?? {}); setPendingJoins(pj ?? []);
      setSelCourse((c ?? [])[0]?.id ?? null);
    } catch (e) {
      console.error("loadLeagueData error:", e);
      setDbError("Connection error. Please check your internet and refresh.");
    }
    setDataLoaded(true);
  }, []);

  // ── Visibility-based refresh ─────────────────────────────────────────────────
  // Reloads league data when the user returns to the tab after being away.
  // This replaces the postgres_changes realtime subscription, which continuously
  // tails the WAL and consumes Disk IO even when nothing is happening.
  // To fully stop WAL tailing, also disable rounds replication in:
  // Supabase Dashboard → Database → Replication → toggle off "rounds"
  useEffect(() => {
    if (!activeLeague?.id) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadLeagueData(activeLeague);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeLeague?.id, activeLeague, loadLeagueData]);

  const selectLeague = (league) => {
    setActiveMembership(myMemberships.find(m => m.league_id === league.id));
    setActiveLeague(league);
    setTab("leaderboard");
    loadLeagueData(league);
    setShowProfileGate(true);
    sessionStorage.setItem("gsb_league_id", String(league.id));
    history.pushState(null, '', location.origin + location.pathname + '#app');
  };

  const createLeague = async (newLeague) => {
    if (creatingLeague.current) return;
    if (!newLeague.name.trim()) { setJoinMsg({ text: "League name is required.", ok: false }); return; }
    creatingLeague.current = true;
    try {
      const { data: league, error } = await supabase.from("leagues").insert({ name: newLeague.name.trim(), description: newLeague.description, owner_id: session.user.id }).select().single();
      if (error) { setJoinMsg({ text: error.message, ok: false }); return; }
      const { error: memberError } = await supabase.from("league_members").insert({ league_id: league.id, user_id: session.user.id, role: "admin" });
      if (memberError && memberError.code !== "23505") {
        setJoinMsg({ text: memberError.message, ok: false }); return;
      }
      loadLeagues();
    } finally {
      creatingLeague.current = false;
    }
  };

  const isValidGhin = (ghin) => /^\d{6,8}$/.test(String(ghin ?? ""));

  const joinLeague = async () => {
    if (!joinCode.trim()) return;
    const { data: league } = await supabase.from("leagues").select("*").eq("invite_code", joinCode.trim().toLowerCase()).single();
    if (!league) { setJoinMsg({ text: "Invalid invite code.", ok: false }); return; }
    if (myMemberships.find(m => m.league_id === league.id)) { setJoinMsg({ text: "Already in this league.", ok: false }); return; }
    const { data: s } = await supabase.from("league_settings").select("config").eq("league_id", league.id).single();
    const cfg = { ...DEFAULT_CONFIG, ...(s?.config ?? {}) };

    // ── GHIN gate ──
    if (cfg.useHandicap) {
      const missingHcp = !profile?.handicap && profile?.handicap !== 0;
      const missingGhin = !isValidGhin(profile?.ghin);
      if (missingHcp || missingGhin) {
        setJoinMsg({
          text: `This league requires a handicap index${missingGhin ? " and a valid GHIN number (7-8 digits)" : ""}. Please update your profile before joining.`,
          ok: false,
          needsProfile: true,
        });
        return;
      }
    }

    if (cfg.joinMode === "approval") {
      await supabase.from("league_join_requests").insert({ league_id: league.id, user_id: session.user.id });
      setJoinMsg({ text: "Request sent! Waiting for commissioner approval.", ok: true });
    } else {
      await supabase.from("league_members").insert({ league_id: league.id, user_id: session.user.id, role: "player" });
      setJoinMsg({ text: "Joined!", ok: true });
      await loadLeagues();
      selectLeague(league);
    }
    setJoinCode("");
    setTimeout(() => setJoinMsg({ text: "", ok: true }), 4000);
  };

  // ── Profile ──
  const saveProfile = async (draft) => {
    await supabase.from("profiles").update({ name: draft.name, handicap: Number(draft.handicap), ghin: draft.ghin }).eq("id", session.user.id);
    setProfile(p => ({ ...p, ...draft, handicap: Number(draft.handicap) }));
    setProfileModal(false);
  };

  // ── Leaderboard computations ──
  const players = members.filter(m => m.profile).map(m => ({ ...m.profile, role: m.role }));
  const scored = rounds.filter(r => r.round_status === "completed" && (!config.attestRequired || r.attest_status === "approved"));
  const myHasSubmitted = scored.some(r => r.player_id === session?.user.id);
  const visible = (config.hideScores && !myHasSubmitted) ? scored.filter(r => r.player_id === session?.user.id) : scored;

  const applyBestN = (rounds, n, format) => {
    if (!n || rounds.length <= n) return rounds;
    if (format === "stableford") return [...rounds].sort((a, b) => (b.stableford_pts ?? 0) - (a.stableford_pts ?? 0)).slice(0, n);
    return [...rounds].sort((a, b) => a.net - b.net).slice(0, n);
  };

  const overallLB = useMemo(() => players.map(p => {
    const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null;
    const counting = applyBestN(pr, config.scoresToCount, config.scoringFormat);
    if (config.scoringFormat === "stableford") { const total = counting.reduce((s, r) => s + (r.stableford_pts ?? 0), 0); return { ...p, pr, counting, primary: total, label: `${total} pts`, totalRounds: pr.length, countingRounds: counting.length }; }
    const avg = counting.reduce((s, r) => s + (r.net ?? 0), 0) / counting.length;
    return { ...p, pr, counting, primary: avg, label: avg.toFixed(1), totalRounds: pr.length, countingRounds: counting.length };
  }).filter(Boolean).sort((a, b) => config.scoringFormat === "stableford" ? b.primary - a.primary : a.primary - b.primary), [players, visible, config]);

  const grossLB = useMemo(() => players.map(p => {
    const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null;
    return { ...p, pr, avg: pr.reduce((s, r) => s + (r.gross ?? 0), 0) / pr.length, totalRounds: pr.length };
  }).filter(Boolean).sort((a, b) => a.avg - b.avg), [players, visible]);

  const courseLB = useMemo(() => {
    if (!selCourse) return [];
    const c = courses.find(c => c.id === selCourse);
    return players.map(p => {
      const cr = visible.filter(r => r.player_id === p.id && r.course_id === selCourse); if (!cr.length) return null;
      const best = Math.min(...cr.map(r => r.net));
      return { ...p, cr, best, avg: (cr.reduce((s, r) => s + r.net, 0) / cr.length).toFixed(1), par: c?.par };
    }).filter(Boolean).sort((a, b) => a.best - b.best);
  }, [players, visible, selCourse, courses]);

  const bestNetLB = useMemo(() => players.map(p => {
    const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null;
    return { ...p, best: pr.reduce((b, r) => (r.net ?? 999) < (b.net ?? 999) ? r : b) };
  }).filter(Boolean).sort((a, b) => a.best.net - b.best.net), [players, visible]);

  const bestGrossLB = useMemo(() => players.map(p => {
    const pr = visible.filter(r => r.player_id === p.id); if (!pr.length) return null;
    return { ...p, best: pr.reduce((b, r) => r.gross < b.gross ? r : b) };
  }).filter(Boolean).sort((a, b) => a.best.gross - b.best.gross), [players, visible]);

  // ── Team leaderboard (scramble season) ──
  const teamLB = useMemo(() => {
    const teams = config.scrambleTeams ?? [];
    if (!teams.length) return [];
    return teams.map(team => {
      const teamRounds = visible.filter(r => r.team_id === team.id);
      if (!teamRounds.length) return null;
      const avg = teamRounds.reduce((s, r) => s + (r.net ?? 0), 0) / teamRounds.length;
      return { ...team, rounds: teamRounds, primary: avg, label: avg.toFixed(1), totalRounds: teamRounds.length };
    }).filter(Boolean).sort((a, b) => a.primary - b.primary);
  }, [config.scrambleTeams, visible]);

  // ── Tournament leaderboard ──
  const TEAM_FORMATS = ["scramble", "texas_scramble", "best_ball"];
  const tournamentRoundLB = useMemo(() => {
    if (!config.tournamentMode || !config.tournamentRounds?.length) return {};
    const teams = config.scrambleTeams ?? [];
    return Object.fromEntries(config.tournamentRounds.map(tr => {
      const trRounds = visible.filter(r => r.tournament_round_id === tr.id);
      const roundTeams = (config.teamsFixed ?? true) ? teams : (tr.teams ?? []);
      const isTeam = TEAM_FORMATS.includes(tr.format) && roundTeams.length > 0;
      if (isTeam) {
        const standings = roundTeams.map(team => {
          const tr_rounds = trRounds.filter(r => r.team_id === team.id);
          if (!tr_rounds.length) return null;
          const avg = tr_rounds.reduce((s, r) => s + (r.net ?? 0), 0) / tr_rounds.length;
          const grossAvg = tr_rounds.reduce((s, r) => s + r.gross, 0) / tr_rounds.length;
          return { ...team, rounds: tr_rounds, primary: avg, label: avg.toFixed(1), grossPrimary: grossAvg, grossLabel: grossAvg.toFixed(1) };
        }).filter(Boolean).sort((a, b) => a.primary - b.primary);
        const grossStandings = [...standings].sort((a, b) => a.grossPrimary - b.grossPrimary);
        return [tr.id, { ...tr, standings, grossStandings, isTeam: true }];
      }
      const standings = players.map(p => {
        const pr = trRounds.filter(r => r.player_id === p.id);
        if (!pr.length) return null;
        const avg = pr.reduce((s, r) => s + (r.net ?? 0), 0) / pr.length;
        const grossAvg = pr.reduce((s, r) => s + r.gross, 0) / pr.length;
        return { ...p, pr, primary: avg, label: avg.toFixed(1), grossPrimary: grossAvg, grossLabel: grossAvg.toFixed(1) };
      }).filter(Boolean).sort((a, b) => a.primary - b.primary);
      const grossStandings = [...standings].sort((a, b) => a.grossPrimary - b.grossPrimary);
      return [tr.id, { ...tr, standings, grossStandings, isTeam: false }];
    }));
  }, [config.tournamentMode, config.tournamentRounds, config.scrambleTeams, visible, players]);

  const tournamentOverallLB = useMemo(() => {
    if (!config.tournamentMode || !config.tournamentRounds?.length) return [];
    const teams = config.scrambleTeams ?? [];
    const allTeamFormat = config.tournamentRounds.every(tr => TEAM_FORMATS.includes(tr.format));
    if (allTeamFormat && teams.length > 0) {
      // Team overall: sum of team net scores across all tournament rounds
      return teams.map(team => {
        const roundScores = config.tournamentRounds.map(tr => {
          const r = visible.find(r => r.team_id === team.id && r.tournament_round_id === tr.id);
          return r ? r.net : null;
        });
        const grossRoundScores = config.tournamentRounds.map(tr => {
          const r = visible.find(r => r.team_id === team.id && r.tournament_round_id === tr.id);
          return r ? r.gross : null;
        });
        const scored = roundScores.filter(s => s !== null);
        if (!scored.length) return null;
        const total = scored.reduce((s, n) => s + n, 0);
        const grossScored = grossRoundScores.filter(s => s !== null);
        const grossTotal = grossScored.length ? grossScored.reduce((s, n) => s + n, 0) : null;
        return { ...team, roundScores, total, label: String(total), roundsPlayed: scored.length, grossRoundScores, grossTotal };
      }).filter(Boolean).sort((a, b) => a.total - b.total);
    }
    // Individual overall: sum of net scores across all tournament rounds
    return players.map(p => {
      const roundScores = config.tournamentRounds.map(tr => {
        // For team rounds, find team's score and attribute to this player
        if (TEAM_FORMATS.includes(tr.format) && teams.length > 0) {
          const myTeam = teams.find(t => t.players?.includes(p.name) || t.players?.includes(p.id));
          if (!myTeam) return null;
          const r = visible.find(r => r.team_id === myTeam.id && r.tournament_round_id === tr.id);
          return r ? r.net : null;
        }
        const r = visible.find(r => r.player_id === p.id && r.tournament_round_id === tr.id);
        return r ? r.net : null;
      });
      const grossRoundScores = config.tournamentRounds.map(tr => {
        if (TEAM_FORMATS.includes(tr.format) && teams.length > 0) {
          const myTeam = teams.find(t => t.players?.includes(p.name) || t.players?.includes(p.id));
          if (!myTeam) return null;
          const r = visible.find(r => r.team_id === myTeam.id && r.tournament_round_id === tr.id);
          return r ? r.gross : null;
        }
        const r = visible.find(r => r.player_id === p.id && r.tournament_round_id === tr.id);
        return r ? r.gross : null;
      });
      const scored = roundScores.filter(s => s !== null);
      if (!scored.length) return null;
      const total = scored.reduce((s, n) => s + n, 0);
      const grossScored = grossRoundScores.filter(s => s !== null);
      const grossTotal = grossScored.length ? grossScored.reduce((s, n) => s + n, 0) : null;
      return { ...p, roundScores, total, label: String(total), roundsPlayed: scored.length, grossRoundScores, grossTotal };
    }).filter(Boolean).sort((a, b) => a.total - b.total);
  }, [config.tournamentMode, config.tournamentRounds, config.scrambleTeams, visible, players]);

  const regularCourses = courses.filter(c => !c.playoff_only);

  const completionData = useMemo(() => {
    const total = regularCourses.length * config.roundsPerCourse;
    return players.map(p => ({
      ...p,
      cs: regularCourses.map(c => { const played = scored.filter(r => r.player_id === p.id && r.course_id === c.id).length; return { ...c, played, done: played >= config.roundsPerCourse }; }),
      done: Math.min(scored.filter(r => r.player_id === p.id && regularCourses.some(c => c.id === r.course_id)).length, total),
      total,
      pct: total ? Math.min(100, Math.round(scored.filter(r => r.player_id === p.id && regularCourses.some(c => c.id === r.course_id)).length / total * 100)) : 0,
    }));
  }, [players, scored, regularCourses, config]);

  const TEAM_FORMATS_APP = ["scramble", "texas_scramble", "best_ball"];
  const hasTeamsApp = (config.scrambleTeams ?? []).length > 0 && TEAM_FORMATS_APP.includes(config.scoringFormat);
  // For team leagues: sum up rounds per team+course capped at roundsPerCourse; for individual count rounds
  const approvedCount = hasTeamsApp
    ? (() => {
        const m = {};
        scored.filter(r => r.team_id).forEach(r => {
          const k = `${r.team_id}_${r.course_id}`;
          m[k] = (m[k] ?? 0) + 1;
        });
        return Object.values(m).reduce((s, n) => s + Math.min(n, config.roundsPerCourse), 0);
      })()
    : scored.length;
  // For tournament leagues the target is 1 round per participant per tournament round
  const tRoundsCount = config.tournamentMode ? (config.tournamentRounds?.length ?? 0) : 0;
  const tTeams = config.scrambleTeams ?? [];
  const tAllTeam = config.tournamentMode && config.tournamentRounds?.length > 0 &&
    config.tournamentRounds.every(tr => TEAM_FORMATS_APP.includes(tr.format)) && tTeams.length > 0;
  const totalRequired = config.tournamentMode
    ? (tAllTeam ? tTeams.length : players.length) * tRoundsCount
    : (hasTeamsApp
        ? (config.scrambleTeams ?? []).length * regularCourses.length * config.roundsPerCourse
        : players.length * regularCourses.length * config.roundsPerCourse);
  const leaguePct = totalRequired ? Math.min(100, Math.round(approvedCount / totalRequired * 100)) : 0;

  const isProfileIncomplete = config.useHandicap && (
    (!profile?.handicap && profile?.handicap !== 0) ||
    !/^\d{6,8}$/.test(String(profile?.ghin ?? ""))
  );

  // Show gate once per league entry if profile is incomplete
  const pendingForMe = rounds.filter(r => r.attester_id === session?.user.id && r.attest_status === "pending");
  const isAdmin = activeMembership?.role === "admin" || activeLeague?.owner_id === session?.user.id;
  const isOpen = isSeasonActive(config);

  // ── Loading screen ──
  if (session === undefined) return (
    <div className="auth-bg">
      <div className="gp" />
      <div style={{ textAlign: "center" }}>
        <GSBLogo size={80} style={{ margin: "0 auto 12px", display: "block" }} />
        <div style={{ color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "3px", fontSize: "1.1rem" }}>GREEK SIDE BUNKER</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", animation: `pulse 1.2s ease-in-out ${i * .2}s infinite`, opacity: .4 }} />)}
        </div>
      </div>
    </div>
  );

  // ── Sign In ──
  if (!session) return (
    <AuthPage
      authMode={authMode} setAuthMode={setAuthMode}
      authEmail={authEmail} setAuthEmail={setAuthEmail}
      authPassword={authPassword} setAuthPassword={setAuthPassword}
      authName={authName} setAuthName={setAuthName}
      authError={authError} setAuthError={setAuthError}
      authSuccess={authSuccess} setAuthSuccess={setAuthSuccess}
      authLoading={authLoading}
      signInWithGoogle={signInWithGoogle}
      signInWithEmail={signInWithEmail}
      signUpWithEmail={signUpWithEmail}
      sendPasswordReset={sendPasswordReset}
    />
  );

  // ── League Picker ──
  if (!activeLeague && restoringLeague) return (
    <div className="auth-bg">
      <div className="gp" />
      <div style={{ textAlign: "center" }}>
        <GSBLogo size={80} style={{ margin: "0 auto 12px", display: "block" }} />
        <div style={{ color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "3px", fontSize: "1.1rem" }}>GREEK SIDE BUNKER</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 20 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", animation: `pulse 1.2s ease-in-out ${i * .2}s infinite`, opacity: .4 }} />)}
        </div>
      </div>
    </div>
  );

  if (!activeLeague) return (
    <LeaguePicker
      profile={profile} leagues={leagues} myMemberships={myMemberships}
      selectLeague={selectLeague} signOut={signOut}
      saveProfile={saveProfile}
      createLeague={createLeague}
      joinLeague={joinLeague}
      joinCode={joinCode} setJoinCode={setJoinCode} joinMsg={joinMsg}
    />
  );

  // ── Main App ──
  return (
    <>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* ── Profile Gate Modal — force completion for existing members ── */}
      {showProfileGate && isProfileIncomplete && dataLoaded && (
        <div className="modal-bg">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><AlertTriangle size={18} />Profile Incomplete</div>
            <p style={{ fontSize: ".9rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.7 }}>
              This league requires a <strong style={{ color: "var(--cream)" }}>handicap index</strong> and a valid <strong style={{ color: "var(--cream)" }}>GHIN number</strong> (7-8 digits) to participate. Please update your profile before continuing.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fg">
                <label>Handicap Index</label>
                <input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4"
                  value={profileDraft.handicap ?? profile?.handicap ?? ""}
                  onChange={e => setProfileDraft(d => ({ ...d, handicap: e.target.value }))} />
              </div>
              <div className="fg">
                <label>GHIN #</label>
                <input type="text" placeholder="e.g. 1234567"
                  value={profileDraft.ghin ?? profile?.ghin ?? ""}
                  onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))}
                  style={{ borderColor: profileDraft.ghin && !/^\d{6,8}$/.test(String(profileDraft.ghin)) ? "var(--red)" : undefined }} />
                {profileDraft.ghin && !/^\d{6,8}$/.test(String(profileDraft.ghin)) && (
                  <span style={{ fontSize: ".72rem", color: "var(--red)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} />Must be 7-8 digits</span>
                )}
                {profileDraft.ghin && /^\d{6,8}$/.test(String(profileDraft.ghin)) && (
                  <span style={{ fontSize: ".72rem", color: "var(--green)", marginTop: 2 }}>✓ Valid format</span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-gold"
                disabled={
                  (!profileDraft.handicap && profileDraft.handicap !== 0) ||
                  !/^\d{6,8}$/.test(String(profileDraft.ghin ?? ""))
                }
                onClick={async () => {
                  await saveProfile({ ...profile, ...profileDraft });
                  setShowProfileGate(false);
                }}
              >Save & Continue</button>
              <button className="btn btn-ghost" onClick={() => setShowProfileGate(false)}>Skip for Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Scorecard modal */}
      {viewCardModal && (
        <div className="modal-bg" onClick={() => setViewCardModal(null)}>
          <div className="modal" style={{ maxWidth: 700, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 12px", borderBottom: "1px solid var(--navy-border)" }}>
              <div className="modal-title" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 8 }}><FileText size={17} />Scorecard</div>
              <div style={{ display: "flex", gap: 8 }}>
                {viewCardModal.url && <a href={viewCardModal.url} target="_blank" rel="noreferrer"><button className="btn btn-ghost btn-sm">Photo ↗</button></a>}
                <button className="btn btn-ghost btn-sm" onClick={() => setViewCardModal(null)}>Close</button>
              </div>
            </div>
            {viewCardModal.round ? (
              <div style={{ maxHeight: "75vh", overflowY: "auto" }}>
                <RoundScorecardViewer
                  round={viewCardModal.round}
                  course={viewCardModal.course}
                  playerName={viewCardModal.playerName}
                  useHandicap={viewCardModal.useHandicap}
                />
              </div>
            ) : (
              <div style={{ padding: 16 }}>
                <img src={viewCardModal.url} alt="Scorecard" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--gold-border)", display: "block", margin: "0 auto" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Profile modal */}
      {profileModal && (
        <div className="modal-bg" onClick={() => setProfileModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">My Profile</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fg"><label>Display Name</label><input type="text" value={profileDraft.name ?? ""} onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))} /></div>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4" value={profileDraft.handicap ?? ""} onChange={e => setProfileDraft(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN #</label><input type="text" placeholder="e.g. 1234567" value={profileDraft.ghin ?? ""} onChange={e => setProfileDraft(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {profileDraft.ghin && !/^\d{6,8}$/.test(String(profileDraft.ghin)) && (
                <p style={{ fontSize: ".72rem", color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} />GHIN must be 7-8 digits</p>
              )}
              {profileDraft.ghin && /^\d{6,8}$/.test(String(profileDraft.ghin)) && (
                <><GhinLink ghin={profileDraft.ghin} /><p className="note" style={{ marginTop: 4 }}>Your GHIN # will be copied to clipboard when you click the link.</p></>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={() => saveProfile(profileDraft)}>Save</button>
              <button className="btn btn-ghost" onClick={() => setProfileModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Players modal */}
      {playersModal && (
        <div className="modal-bg" onClick={() => setPlayersModal(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">League Players</div>
            <div className="player-card-grid">
              {members.filter(m => m.profile).map(m => {
                const courseHcps = courses.map(c => ({ ...c, ch: calcCourseHcp(m.profile.handicap ?? 0, c.slope, c.par, c.rating, config) }));
                return (
                  <div key={m.user_id} className="player-card">
                    <div className="player-card-avatar">{m.profile.avatar_url ? <img src={m.profile.avatar_url} alt="" /> : ini(m.profile.name)}</div>
                    <div className="player-card-name">{m.profile.name}</div>
                    <div className="player-card-meta" style={{ marginBottom: 6 }}>
                      <span className={`lrole ${m.role}`} style={{ fontSize: ".58rem" }}>{m.role === "admin" ? "Commissioner" : "Player"}</span>
                    </div>
                    {config.entryFee > 0 && <div style={{ marginBottom: 6 }}><span className={`paid-badge ${m.paid ? "paid" : "unpaid"}`}>{m.paid ? "✓ Paid" : "✗ Unpaid"}</span></div>}
                    {config.useHandicap && <div style={{ marginBottom: 6 }}><span className="hcp-badge">Hcp {m.profile.handicap ?? "-"}</span></div>}
                    {m.profile.ghin && <GhinLink ghin={m.profile.ghin} style={{ fontSize: ".68rem", marginBottom: 6, display: "inline-flex" }} />}
                    {config.useHandicap && courses.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {courseHcps.map(c => <div key={c.id} style={{ fontSize: ".68rem", color: "var(--cream-dim)", marginTop: 2 }}>{c.name}: <span style={{ color: "var(--white)" }}>{c.ch}</span></div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 16, width: "100%" }} onClick={() => setPlayersModal(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="app au">
        {/* Topbar */}
        <div className="topbar">
          <div className="brand" onClick={() => { setActiveLeague(null); setDataLoaded(false); }}>
            <GSBLogo size={36} />
            <div><div className="brand-name">GREEK SIDE BUNKER</div><span className="brand-league">{activeLeague.name}</span></div>
          </div>
          <div className="topbar-right">
            {isAdmin && <span className="badge-admin">Commissioner</span>}
            <span className="fmt-pip">{config.tournamentMode ? "Tournament" : FORMAT_LABELS[config.scoringFormat]}</span>
            {isAdmin && pendingJoins.length > 0 && (
              <button className="btn btn-ghost btn-sm" style={{ color: "var(--purple)" }} onClick={() => setTab("admin")}>
                {pendingJoins.length} join request{pendingJoins.length > 1 ? "s" : ""}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setPlayersModal(true)}>Players</button>
            <div className="user-chip" onClick={() => { setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin }); setProfileModal(true); }}>
              <div className="avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : ini(profile?.name)}</div>
              <div>
                <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{profile?.name}</div>
                {config.useHandicap && <div style={{ fontSize: ".7rem", color: "var(--cream-dim)" }}>Hcp {profile?.handicap ?? "-"}</div>}
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowMenu(m => !m)}
                style={{ fontSize: "1.1rem", padding: "6px 10px" }}
              >☰</button>
              {showMenu && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowMenu(false)} />
                  <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", background: "var(--navy-card)", border: "1px solid var(--gold-border)", borderRadius: 10, minWidth: 200, zIndex: 100, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,.6)", padding: "6px 0" }}>
                    <button className="menu-item" onClick={() => { setShowMenu(false); setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin }); setProfileModal(true); }}>Edit Profile</button>
                    <div style={{ borderTop: "1px solid var(--navy-border)", margin: "6px 0" }} />
                    <button className="menu-item" onClick={() => { setShowMenu(false); setShowHelp(true); }}>Guide</button>
                    <div style={{ borderTop: "1px solid var(--navy-border)", margin: "6px 0" }} />
                    <button className="menu-item" onClick={() => { setShowMenu(false); setActiveLeague(null); }}>Switch League</button>
                    <div style={{ borderTop: "1px solid var(--navy-border)", margin: "6px 0" }} />
                    <button className="menu-item" style={{ color: "#f09090" }} onClick={() => { setShowMenu(false); signOut(); }}>Sign Out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <SeasonBar config={config} />

        {/* DB error banner */}
        {dbError && (
          <div className="alert-d" style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span>{dbError}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>Refresh</button>
          </div>
        )}

        {/* Profile incomplete banner */}
        {isProfileIncomplete && dataLoaded && (
          <div className="alert-w" style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} />Your profile is missing a handicap index or valid GHIN number — required by this league.</span>
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => {
              setProfileDraft({ name: profile?.name, handicap: profile?.handicap, ghin: profile?.ghin });
              setProfileModal(true);
            }}>Update Profile</button>
          </div>
        )}

        {/* Banner */}
        {dataLoaded && (
          <div className="banner">
            <div className="bstat"><div className="bstat-n">{players.length}</div><div className="bstat-l">Players</div></div>
            <div className="bstat"><div className="bstat-n">{courses.length}</div><div className="bstat-l">Courses</div></div>
            <div className="bstat"><div className="bstat-n">{approvedCount}</div><div className="bstat-l">Rounds</div></div>
            <div className="bstat" style={{ padding: "12px 16px" }}>
              <div className="bstat-n">{leaguePct}%</div><div className="bstat-l">Complete</div>
              <div className="pw" style={{ marginTop: 5 }}><div className="pf" style={{ width: `${leaguePct}%` }} /></div>
            </div>
          </div>
        )}

        {/* Nav */}
        <div className="nav-wrap">
          <div className="nav">
            {[
              ["leaderboard", <><Trophy size={14} />Leaderboard</>, false],
              ["score", <><Pencil size={14} />Post Score</>, false],
              ...(config.attestRequired ? [["attest", <><Clock size={14} />Attest</>, true]] : []),
              ...(isAdmin ? [["admin", <><Settings size={14} />Admin</>, false]] : []),
            ].map(([k, l, isAttest]) => (
              <button
                key={k}
                className={`nav-tab${tab === k ? " active" : ""}${k === "admin" ? " admin-tab" : ""}${isAttest ? " attest-tab" : ""}`}
                onClick={() => setTab(k)}
              >
                {l}
                {isAttest && pendingForMe.length > 0 && <span className="nav-badge">{pendingForMe.length}</span>}
              </button>
            ))}
          </div>
        </div>

        {!dataLoaded && <div className="empty">Loading…</div>}

        {/* ── Tab content ── */}
        {tab === "leaderboard" && dataLoaded && (
          <Leaderboard
            config={config} courses={courses} members={members} rounds={rounds} payouts={payouts}
            session={session} activeLeague={activeLeague} isAdmin={isAdmin}
            overallLB={overallLB} grossLB={grossLB} courseLB={courseLB}
            bestNetLB={bestNetLB} bestGrossLB={bestGrossLB}
            teamLB={teamLB} tournamentRoundLB={tournamentRoundLB} tournamentOverallLB={tournamentOverallLB}
            completionData={completionData} scored={scored} myHasSubmitted={myHasSubmitted}
            selCourse={selCourse} setSelCourse={setSelCourse}
            setConfig={setConfig} setViewCardModal={setViewCardModal}
          />
        )}

        {tab === "score" && dataLoaded && (
          <PostScore
            session={session} profile={profile} setProfile={setProfile} activeLeague={activeLeague}
            courses={courses} members={members} rounds={rounds} config={config}
            isOpen={isOpen}
            form={form} setForm={setForm}
            formMsg={formMsg} setFormMsg={setFormMsg}
            cardFile={cardFile} setCardFile={setCardFile}
            cardPreview={cardPreview} setCardPreview={setCardPreview}
            aiReading={aiReading} setAiReading={setAiReading}
            aiResult={aiResult} setAiResult={setAiResult}
            setRounds={setRounds}
            setViewCardModal={setViewCardModal}
            liveRound={liveRound} setLiveRound={setLiveRound}
            setCompanionRounds={setCompanionRounds}
          />
        )}

        {tab === "attest" && dataLoaded && (
          <AttestTab
            pendingForMe={pendingForMe}
            config={config}
            setRounds={setRounds}
            setViewCardModal={setViewCardModal}
          />
        )}

        {tab === "admin" && isAdmin && dataLoaded && (
          <AdminTab
            session={session} activeLeague={activeLeague}
            config={config} setConfig={setConfig}
            courses={courses} setCourses={setCourses}
            members={members} setMembers={setMembers}
            rounds={rounds} setRounds={setRounds}
            payouts={payouts}
            pendingJoins={pendingJoins} setPendingJoins={setPendingJoins}
            setViewCardModal={setViewCardModal}
          />
        )}
      </div>

      {/* LiveScorecard via portal — renders into document.body to escape any CSS stacking context */}
      {liveRound && createPortal(
        <ErrorBoundary onReset={async () => {
          // Delete the stuck in-progress round so it doesn't count against the player
          if (liveRound?.group_id) {
            await supabase.from("rounds").delete().eq("group_id", liveRound.group_id);
          } else if (liveRound?.id) {
            await supabase.from("rounds").delete().eq("id", liveRound.id);
          }
          setRounds(p => p.filter(r => r.id !== liveRound?.id));
          setLiveRound(null);
        }}>
        <LiveScorecard
          round={liveRound}
          course={courses.find(c => c.id === liveRound.course_id)}
          courseHandicap={liveRound.course_handicap}
          config={config}
          profile={profile}
          members={members}
          activeLeague={activeLeague}
          setRounds={setRounds}
          companions={companionRounds}
          onComplete={(updated) => {
            setCompanionRounds([]);
            setLiveRound(null);
            setForm(f => ({ ...f, score: "", net: "", courseId: "", attesterId: "", teamId: "", tournamentRoundId: "" }));
            setFormMsg({
              type: "s",
              text: config.attestRequired
                ? `Submitted! Attestation sent to ${updated.attester_name}.`
                : "Round submitted and approved!",
            });
            setTimeout(() => setFormMsg({ type: "", text: "" }), 5000);
          }}
          onClose={() => setLiveRound(null)}
        />
        </ErrorBoundary>,
        document.body
      )}
    </>
  );
}
