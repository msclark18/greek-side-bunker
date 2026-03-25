import { useState, useRef, useEffect } from "react";
import { supabase } from "../supabase.js";
import { DEFAULT_CONFIG, FORMAT_LABELS } from "../constants/config.js";
import { calcCourseHcp, calcStableford } from "../utils/golf.js";
import Toggle from "../components/Toggle.jsx";
import GhinLink from "../components/GhinLink.jsx";
import { Settings, Users, Flag, ClipboardList, BarChart2, FileText, Mail, Trophy, DollarSign, AlertTriangle, Check, X, Clock, Camera, Lock } from "lucide-react";

export default function AdminTab({
  session, activeLeague,
  config, setConfig,
  courses, setCourses,
  members, setMembers,
  rounds, setRounds,
  payouts,
  pendingJoins, setPendingJoins,
  setViewCardModal,
}) {
  const [adminTab, setAdminTab] = useState("config");
  const [configDraft, setConfigDraft] = useState(null);
  const [addMsg, setAddMsg] = useState("");
  const [newCourse, setNewCourse] = useState({ name: "", par: "", holes: "18", slope: "", rating: "" });
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [courseSearch, setCourseSearch] = useState({ open: false, query: "", results: [], loading: false, scanLoading: false, error: "", selected: null, selectedTee: null, teeDraft: {} });
  const scorecardInputRef = useRef(null);
  const [editMemberHcp, setEditMemberHcp] = useState(null);
  const [emailDraft, setEmailDraft] = useState({ subject: "", message: "" });
  const [emailSending, setEmailSending] = useState(false);
  const editorRef = useRef(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });
  const [savedRange, setSavedRange] = useState(null);
  const [linkModal, setLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailSelected, setEmailSelected] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberDraft, setAddMemberDraft] = useState({ email: "", name: "", handicap: "", ghin: "" });
  const [addMemberMsg, setAddMemberMsg] = useState({ text: "", ok: true });
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [handicapChangePending, setHandicapChangePending] = useState(null); // { key, value, label, newConfig }
  const [retroLoading, setRetroLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveBylaws, setConfirmRemoveBylaws] = useState(false);
  const [confirmDeleteRound, setConfirmDeleteRound] = useState(null);
  const [editRound, setEditRound] = useState(null);
  const [editRoundDraft, setEditRoundDraft] = useState({});
  const [reminderSending, setReminderSending] = useState(false);

  // ── Config ──
  const saveConfig = async (newCfg) => {
    const cats = newCfg.payoutCategories ?? [];
    const totalPct = cats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
    if (totalPct > 100) { setAddMsg("Payout percentages exceed 100%. Please fix before saving."); return; }
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
    setConfigDraft(null);
  };

  // ── League started check ──
  const leagueStarted = config.attestRequired
    ? rounds.some(r => r.attest_status === "approved")
    : rounds.length > 0;

  // ── Handicap setting change (intercept for future-only vs retroactive) ──
  const handleSaveConfig = (newConfig) => {
    if (!leagueStarted) { saveConfig(newConfig); return; }
    const hcpChanged =
      newConfig.handicapPct !== config.handicapPct ||
      newConfig.useSlopeRating !== config.useSlopeRating ||
      newConfig.maxHandicap !== config.maxHandicap;
    if (!hcpChanged) { saveConfig(newConfig); return; }
    const changed = [];
    if (newConfig.handicapPct !== config.handicapPct) changed.push(`Handicap % (${config.handicapPct}% → ${newConfig.handicapPct}%)`);
    if (newConfig.useSlopeRating !== config.useSlopeRating) changed.push(`Slope/rating formula`);
    if (newConfig.maxHandicap !== config.maxHandicap) changed.push(`Max handicap cap`);
    setHandicapChangePending({ label: changed.join(", "), newConfig });
  };

  const applyHandicapChange = async (retroactive) => {
    const { newConfig } = handicapChangePending;
    setHandicapChangePending(null);
    await saveConfig(newConfig);
    if (!retroactive) return;
    setRetroLoading(true);
    const approvedRounds = rounds.filter(r => r.attest_status === "approved" || !config.attestRequired);
    const memberMap = Object.fromEntries(members.filter(m => m.profile).map(m => [m.user_id, m.profile]));
    const courseMap = Object.fromEntries(courses.map(c => [String(c.id), c]));
    const updatedValues = {};
    const updates = approvedRounds
      .filter(r => r.course_id && memberMap[r.player_id]?.handicap != null)
      .map(r => {
        const course = courseMap[String(r.course_id)];
        const profile = memberMap[r.player_id];
        if (!course || !profile) return null;
        const newCourseHcp = calcCourseHcp(profile.handicap, course.slope, course.par, course.rating, newConfig);
        const newNet = r.gross - newCourseHcp;
        const newStableford = newConfig.scoringFormat === "stableford"
          ? calcStableford(r.gross, newCourseHcp, course.par) : null;
        const patch = {
          course_handicap: newCourseHcp,
          net: newNet,
          ...(newStableford !== null ? { stableford_pts: newStableford } : {}),
        };
        updatedValues[r.id] = patch;
        return supabase.from("rounds").update(patch).eq("id", r.id);
      }).filter(Boolean);
    await Promise.all(updates);
    // Sync local state so UI reflects changes immediately without a page reload
    setRounds(prev => prev.map(r => updatedValues[r.id] ? { ...r, ...updatedValues[r.id] } : r));
    setRetroLoading(false);
    setAddMsg(`Retroactively updated ${updates.length} rounds.`);
    setTimeout(() => setAddMsg(""), 4000);
  };

  // ── Course Search ──
  const searchGolfCourses = async (query) => {
    if (!query.trim()) return;
    setCourseSearch(s => ({ ...s, loading: true, error: "", results: [], selected: null, selectedTee: null }));

    const normalize = (s) => s?.toLowerCase() ?? "";
    const matchesQuery = (c, q) => {
      const haystack = normalize(c.club_name) + " " + normalize(c.course_name);
      return q.trim().split(/\s+/).every(w => haystack.includes(normalize(w)));
    };

    const cacheToDB = async (courses) => {
      if (!courses.length) return;
      await supabase.from("course_cache").upsert(
        courses.map(c => ({ api_id: c.id, club_name: c.club_name, course_name: c.course_name, location: c.location, tees: c.tees })),
        { onConflict: "api_id", ignoreDuplicates: true }
      );
    };

    const fetchFromAPI = async (q) => {
      const res = await fetch(`/api/search-courses?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      const courses = data.courses ?? [];
      cacheToDB(courses);
      return courses;
    };

    try {
      // 1. Check local cache first
      const q = query.trim();
      const { data: cached } = await supabase
        .from("course_cache")
        .select("api_id, club_name, course_name, location, tees")
        .or(`club_name.ilike.%${q}%,course_name.ilike.%${q}%`)
        .limit(20);

      let results = (cached ?? []).map(c => ({ id: c.api_id, club_name: c.club_name, course_name: c.course_name, location: c.location, tees: c.tees }));

      // 2. If cache has hits, return them immediately; still fetch API in background to keep cache fresh
      if (results.length >= 3) {
        setCourseSearch(s => ({ ...s, loading: false, results }));
        fetchFromAPI(q).catch(() => {});
        return;
      }

      // 3. Cache miss — hit the API
      let apiResults = await fetchFromAPI(q);

      // 4. If multi-word query returns nothing, retry with first word + filter client-side
      if (apiResults.length === 0) {
        const words = q.split(/\s+/);
        if (words.length > 1) {
          const broader = await fetchFromAPI(words[0]);
          apiResults = broader.filter(c => matchesQuery(c, q));
        }
      }

      // 5. Merge cache + API results, dedupe by api_id
      const seen = new Set(results.map(r => r.id));
      for (const c of apiResults) {
        if (!seen.has(c.id)) { results.push(c); seen.add(c.id); }
      }

      setCourseSearch(s => ({ ...s, loading: false, results }));
    } catch (e) {
      setCourseSearch(s => ({ ...s, loading: false, error: e.message }));
    }
  };

  const scanScorecard = async (file) => {
    if (!file) return;
    setCourseSearch(s => ({ ...s, scanLoading: true, error: "", selected: null, selectedTee: null }));
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/parse-scorecard-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: base64, mediaType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      const { course } = data;
      // Shape into the same format as API results so the tee picker works identically
      const synthetic = {
        id: null,
        club_name: course.club_name,
        course_name: course.course_name,
        location: null,
        tees: {
          male: course.tees.map(t => ({
            tee_name: t.tee_name,
            par_total: t.par_total,
            number_of_holes: t.number_of_holes ?? 18,
            slope_rating: t.slope_rating,
            course_rating: t.course_rating,
            total_yards: null,
            holes: [],
          })),
          female: [],
        },
      };
      setCourseSearch(s => ({ ...s, scanLoading: false, selected: synthetic, results: [] }));
    } catch (e) {
      setCourseSearch(s => ({ ...s, scanLoading: false, error: e.message ?? "Scan failed. Try a clearer photo." }));
    }
  };

  const confirmCourseFromSearch = async () => {
    const { selected, selectedTee, teeDraft } = courseSearch;
    if (!selected || !selectedTee) return;
    const tee = selectedTee;
    const slope = Number(teeDraft.slope ?? tee.slope_rating);
    const rating = Number(teeDraft.rating ?? tee.course_rating);
    const par = Number(teeDraft.par ?? tee.par_total);
    const holes = Number(teeDraft.holes ?? tee.number_of_holes ?? 18);
    if (!slope || !rating || !par) {
      setCourseSearch(s => ({ ...s, error: "Please fill in all missing values (slope, rating, par) before adding." }));
      return;
    }
    const courseName = selected.club_name === selected.course_name
      ? selected.club_name
      : `${selected.club_name} — ${selected.course_name}`;
    const { data, error } = await supabase.from("courses").insert({
      league_id: activeLeague.id,
      name: courseName,
      par,
      holes,
      slope,
      rating,
    }).select().single();
    if (error) {
      setCourseSearch(s => ({ ...s, error: error.message }));
      return;
    }
    if (data) {
      setCourses(p => [...p, data]);
      setAddMsg(`${courseName} added!`);
      setTimeout(() => setAddMsg(""), 3000);
    }
    setCourseSearch({ open: false, query: "", results: [], loading: false, scanLoading: false, error: "", selected: null, selectedTee: null, teeDraft: {} });
  };

  // ── Courses ──
  const addCourse = async () => {
    if (!newCourse.name || !newCourse.par || !newCourse.slope || !newCourse.rating) return;
    const { data } = await supabase.from("courses").insert({
      league_id: activeLeague.id, ...newCourse,
      par: Number(newCourse.par), holes: Number(newCourse.holes),
      slope: Number(newCourse.slope), rating: Number(newCourse.rating),
    }).select().single();
    if (data) {
      setCourses(p => [...p, data]);
      setNewCourse({ name: "", par: "", holes: "18", slope: "", rating: "" });
      setShowAddCourse(false);
      setAddMsg("Course added!");
      setTimeout(() => setAddMsg(""), 3000);
    }
  };

  const deleteCourse = async (id) => {
    await supabase.from("courses").delete().eq("id", id);
    setCourses(p => p.filter(c => c.id !== id));
  };

  const togglePlayoffOnly = async (id, cur) => {
    await supabase.from("courses").update({ playoff_only: !cur }).eq("id", id);
    setCourses(p => p.map(c => c.id === id ? { ...c, playoff_only: !cur } : c));
  };

  // ── Pending invites ──
  useEffect(() => {
    if (adminTab !== "members" || !activeLeague?.id) return;
    supabase.from("league_invites").select("*").eq("league_id", activeLeague.id)
      .then(({ data }) => setPendingInvites(data ?? []));
  }, [adminTab, activeLeague?.id]);

  const cancelInvite = async (id) => {
    await supabase.from("league_invites").delete().eq("id", id);
    setPendingInvites(p => p.filter(i => i.id !== id));
  };

  // ── Members ──
  const approveJoin = async (req) => {
    await supabase.from("league_members").insert({ league_id: req.league_id, user_id: req.user_id, role: "player" });
    await supabase.from("league_join_requests").update({ status: "approved" }).eq("id", req.id);
    setPendingJoins(p => p.filter(r => r.id !== req.id));
    setMembers(p => [...p, { user_id: req.user_id, role: "player", profile: req.profile }]);
  };

  const denyJoin = async (req) => {
    await supabase.from("league_join_requests").update({ status: "denied" }).eq("id", req.id);
    setPendingJoins(p => p.filter(r => r.id !== req.id));
  };

  const removeMember = async (uid) => {
    if (uid === session.user.id) return;
    await supabase.from("league_members").delete().eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.filter(m => m.user_id !== uid));
  };

  const toggleRole = async (uid, cur) => {
    const r = cur === "admin" ? "player" : "admin";
    await supabase.from("league_members").update({ role: r }).eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.map(m => m.user_id === uid ? { ...m, role: r } : m));
  };

  const togglePaid = async (uid, cur) => {
    const paid = !cur;
    await supabase.from("league_members").update({ paid }).eq("league_id", activeLeague.id).eq("user_id", uid);
    setMembers(p => p.map(m => m.user_id === uid ? { ...m, paid } : m));
  };

  const saveMemberHcp = async () => {
    if (!editMemberHcp) return;
    await supabase.from("profiles").update({ handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin }).eq("id", editMemberHcp.uid);
    setMembers(p => p.map(m => m.user_id === editMemberHcp.uid ? { ...m, profile: { ...m.profile, handicap: Number(editMemberHcp.handicap), ghin: editMemberHcp.ghin } } : m));
    setEditMemberHcp(null);
  };

  const addMemberByEmail = async () => {
    const email = addMemberDraft.email.trim().toLowerCase();
    const name = addMemberDraft.name.trim();
    if (!email || !name) return;
    setAddMemberLoading(true);
    setAddMemberMsg({ text: "", ok: true });

    const { data: profile } = await supabase.from("profiles").select("id, name, email, handicap, ghin").eq("email", email).maybeSingle();
    if (!profile) {
      // No account yet — store an invite row client-side, then fire-and-forget the email API
      const { error: inviteError } = await supabase.from("league_invites").upsert({
        league_id:  activeLeague.id,
        email,
        name,
        handicap:   addMemberDraft.handicap !== "" ? Number(addMemberDraft.handicap) : null,
        ghin:       addMemberDraft.ghin.trim() || null,
        invited_by: session?.user?.email ?? null,
        invited_at: new Date().toISOString(),
      }, { onConflict: "league_id,email" });
      if (inviteError) {
        setAddMemberMsg({ text: "✗ " + inviteError.message, ok: false });
        setAddMemberLoading(false);
        return;
      }
      // Send invite email (best-effort)
      fetch(`/api/invite-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: activeLeague.id, leagueName: activeLeague.name, email, name, invitedBy: session?.user?.email }),
      }).catch(() => {});
      setAddMemberMsg({ text: `Invite created for ${email}. They'll get a signup email when they join.`, ok: true });
      setAddMemberDraft({ email: "", name: "", handicap: "", ghin: "" });
      setShowAddMember(false);
      const { data: invites } = await supabase.from("league_invites").select("*").eq("league_id", activeLeague.id);
      setPendingInvites(invites ?? []);
      setAddMemberLoading(false);
      setTimeout(() => setAddMemberMsg({ text: "", ok: true }), 5000);
      return;
    }
    if (members.some(m => m.user_id === profile.id)) {
      setAddMemberMsg({ text: "This player is already a member of this league.", ok: false });
      setAddMemberLoading(false);
      return;
    }

    const { error } = await supabase.from("league_members").insert({ league_id: activeLeague.id, user_id: profile.id, role: "player" });
    if (error) {
      setAddMemberMsg({ text: "Failed to add member: " + error.message, ok: false });
      setAddMemberLoading(false);
      return;
    }

    // Update profile fields if the commissioner provided overrides
    const updates = {};
    if (name !== profile.name) updates.name = name;
    if (addMemberDraft.handicap !== "") updates.handicap = Number(addMemberDraft.handicap);
    if (addMemberDraft.ghin.trim() !== "") updates.ghin = addMemberDraft.ghin.trim();
    if (Object.keys(updates).length > 0) {
      await supabase.from("profiles").update(updates).eq("id", profile.id);
    }

    const finalProfile = { ...profile, ...updates };
    setMembers(p => [...p, { user_id: profile.id, role: "player", paid: false, profile: finalProfile }]);
    setAddMemberMsg({ text: `✓ ${finalProfile.name} added to the league!`, ok: true });
    setAddMemberDraft({ email: "", name: "", handicap: "", ghin: "" });
    setShowAddMember(false);
    setAddMemberLoading(false);
    setTimeout(() => setAddMemberMsg({ text: "", ok: true }), 4000);
  };

  // ── Rounds ──
  const adminApproveRound = async (r) => {
    await supabase.from("rounds").update({ attest_status: "approved", attest_at: new Date().toISOString() }).eq("id", r.id);
    setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "approved" } : x));
  };

  const adminRejectRound = async (r) => {
    await supabase.from("rounds").update({ attest_status: "rejected", attest_at: new Date().toISOString() }).eq("id", r.id);
    setRounds(p => p.map(x => x.id === r.id ? { ...x, attest_status: "rejected" } : x));
  };

  const saveEditRound = async () => {
    if (!editRound) return;
    const gross = Number(editRoundDraft.gross);
    if (!gross) return;
    const net = gross - editRound.course_handicap;
    const pts = config.scoringFormat === "stableford" ? calcStableford(gross, editRound.course_handicap, editRound.par) : null;
    const update = { gross, net, date: editRoundDraft.date, ...(pts !== null ? { stableford_pts: pts } : {}) };
    await supabase.from("rounds").update(update).eq("id", editRound.id);
    setRounds(p => p.map(r => r.id === editRound.id ? { ...r, ...update } : r));
    setEditRound(null);
  };

  const sendRoundReminders = async () => {
    const regularCourses = courses.filter(c => !c.playoff_only);
    const total = regularCourses.length * config.roundsPerCourse;
    const incomplete = members.filter(m => {
      const played = rounds.filter(r => r.player_id === m.user_id && regularCourses.some(c => c.id === r.course_id) && r.attest_status !== "rejected").length;
      return played < total && m.profile?.email;
    });
    if (incomplete.length === 0) { setEmailMsg("✓ All members have completed their rounds!"); return; }
    setReminderSending(true);
    setEmailMsg("");
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
      await Promise.all(incomplete.map(async m => {
        const played = rounds.filter(r => r.player_id === m.user_id && regularCourses.some(c => c.id === r.course_id) && r.attest_status !== "rejected").length;
        const remaining = total - played;
        await fetch(`${apiUrl}/api/send-league-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leagueId: activeLeague.id, leagueName: activeLeague.name,
            subject: `Reminder: ${remaining} round${remaining !== 1 ? "s" : ""} still needed in ${activeLeague.name}`,
            message: `Hi ${m.profile.name},<br><br>This is a friendly reminder that you have <strong>${remaining} round${remaining !== 1 ? "s" : ""} remaining</strong> to post in <strong>${activeLeague.name}</strong>.<br><br>You've completed <strong>${played} of ${total}</strong> required rounds. Make sure to post your remaining rounds before the season ends!<br><br><em>Courses: ${regularCourses.map(c => c.name).join(", ")}</em>`,
            senderName: session?.user?.email,
            recipients: [m.profile.email],
          }),
        });
      }));
      setEmailMsg(`✓ Reminders sent to ${incomplete.length} member${incomplete.length !== 1 ? "s" : ""}!`);
    } catch (e) {
      setEmailMsg("✗ Failed to send reminders: " + e.message);
    }
    setReminderSending(false);
    setTimeout(() => setEmailMsg(""), 5000);
  };

  const deleteRound = async (round) => {
    if (round.scorecard_url) {
      const storagePath = round.scorecard_url.split("/public/scorecards/")[1];
      if (storagePath) await supabase.storage.from("scorecards").remove([storagePath]);
    }
    await supabase.from("rounds").delete().eq("id", round.id);
    setRounds(p => p.filter(r => r.id !== round.id));
  };

  const clearAllRounds = async () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 5000); return; }
setConfirmClear(false);
    await supabase.from("rounds").delete().eq("league_id", activeLeague.id);
    setRounds([]);
  };

  // ── Export ──
  const exportCSV = () => {
    const headers = ["Player", "Course", "Gross", "Net", "Course Handicap", "Par", "Stableford Pts", "Date", "Status"];
    const rows = rounds.map(r => [r.player_name, r.course_name, r.gross, r.net, r.course_handicap, r.par, r.stableford_pts ?? "", r.date, r.attest_status]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${activeLeague.name}-rounds.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const insertLink = () => {
    if (!linkUrl) { setLinkModal(false); return; }
    const url = linkUrl.startsWith("http") ? linkUrl : "https://" + linkUrl;
    const display = linkText.trim() || url;
    editorRef.current?.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    document.execCommand("insertHTML", false, `<a href="${esc(url)}" style="color:var(--gold)">${esc(display)}</a>`);
    setEmailDraft(d => ({ ...d, message: editorRef.current?.innerHTML ?? "" }));
    setLinkModal(false);
    setLinkUrl("");
    setLinkText("");
  };

  const sendLeagueEmail = async () => {
    const message = editorRef.current?.innerHTML ?? "";
    const hasContent = editorRef.current?.innerText?.trim();
    if (!emailDraft.subject.trim() || !hasContent) return;
    const selected = emailSelected ?? members.map(m => m.user_id);
    const recipients = members
      .filter(m => selected.includes(m.user_id) && m.profile?.email)
      .map(m => m.profile?.email);
    if (recipients.length === 0) { setEmailMsg("✗ No recipients selected."); return; }
    setEmailSending(true);
    setEmailMsg("");
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? window.location.origin;
      const res = await fetch(`${apiUrl}/api/send-league-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: activeLeague.id,
          leagueName: activeLeague.name,
          subject: emailDraft.subject,
          message,
          senderName: session?.user?.email,
          recipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setEmailMsg(`✓ Email sent to ${data.sent} member${data.sent !== 1 ? "s" : ""}!`);
      setEmailDraft({ subject: "", message: "" });
      if (editorRef.current) editorRef.current.innerHTML = "";
      setEmailSelected(null);
    } catch (e) {
      setEmailMsg("✗ Failed to send: " + e.message);
    }
    setEmailSending(false);
    setTimeout(() => setEmailMsg(""), 5000);
  };

  const uploadBylaws = async (file) => {
    if (!file || file.type !== "application/pdf") { setAddMsg("Please upload a PDF file."); return; }
    if (file.size > 10 * 1024 * 1024) { setAddMsg("File is too large — max 10 MB."); return; }
    setAddMsg("Uploading...");
    const path = `bylaws/${activeLeague.id}.pdf`;
    const { error } = await supabase.storage.from("bylaws").upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) { setAddMsg("Upload failed: " + error.message); return; }
    const { data: urlData } = supabase.storage.from("bylaws").getPublicUrl(path);
    const newCfg = { ...config, bylawsUrl: urlData.publicUrl, bylawsName: file.name };
    await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
    setConfig(newCfg);
    setAddMsg("✓ Bylaws uploaded!");
    setTimeout(() => setAddMsg(""), 3000);
  };

  const netEl = (net, par) => config.useHandicap
    ? <span className={`sb`}>{net}</span>
    : <span className="sb">{net}</span>;

  const attestBadge = (status) => !config.attestRequired
    ? <span className="ab auto">Auto ✓</span>
    : <span className={`ab ${status}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{status === "approved" ? "✓ Approved" : status === "rejected" ? "✗ Rejected" : <><Clock size={11} />Pending</>}</span>;

  // Reusable team builder — shared across Groups and Tournament per-round tabs
  const renderTeamBuilder = (teams, setTeamsFn, teamSize) => {
    const resolveRef = (ref) => {
      if (!ref) return null;
      const m = members.find(mb => mb.user_id === ref);
      return m?.profile?.name ?? ref;
    };
    const normalizedTeams = teams.map(t => ({ ...t, players: (t.players ?? []).map(resolveRef).filter(Boolean) }));
    const assignedPlayers = new Set(normalizedTeams.flatMap(t => t.players ?? []));
    const unassigned = members.filter(m => m.profile && !assignedPlayers.has(m.profile.name));
    return (
      <>
        {normalizedTeams.length === 0 && <p className="note" style={{ marginBottom: 8 }}>No teams yet. Add a team below.</p>}
        {normalizedTeams.map((team, ti) => (
          <div key={team.id} style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <input type="text" value={team.name} placeholder="Team name"
                onChange={e => setTeamsFn(normalizedTeams.map((t, i) => i === ti ? { ...t, name: e.target.value } : t))}
                style={{ flex: "1 1 120px", fontSize: ".86rem" }} />
              <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: ".7rem" }}
                onClick={() => setTeamsFn(normalizedTeams.filter((_, i) => i !== ti))}>✕ Remove</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Array.from({ length: teamSize }).map((_, si) => {
                const assigned = team.players?.[si] ?? null;
                const opts = members.filter(m => m.profile && (m.profile.name === assigned || !assignedPlayers.has(m.profile.name)));
                return (
                  <select key={si} value={assigned ?? ""}
                    onChange={e => {
                      const newPlayers = [...(team.players ?? [])];
                      newPlayers[si] = e.target.value || null;
                      setTeamsFn(normalizedTeams.map((t, i) => i === ti ? { ...t, players: newPlayers.filter(Boolean) } : t));
                    }}
                    style={{ flex: "1 1 130px", minWidth: 110, fontSize: ".82rem" }}>
                    <option value="">— Player {si + 1} —</option>
                    {opts.map(m => <option key={m.user_id} value={m.profile.name}>{m.profile.name}</option>)}
                  </select>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: ".65rem" }}
            onClick={() => setTeamsFn([...normalizedTeams, { id: `team_${Date.now()}`, name: `Team ${normalizedTeams.length + 1}`, players: [] }])}>
            + Add Team
          </button>
          {unassigned.length > 0 && (
            <span style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>
              {unassigned.length} unassigned: {unassigned.map(m => m.profile.name).join(", ")}
            </span>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      {/* Edit Round Modal */}
      {editRound && (
        <div className="modal-bg" onClick={() => setEditRound(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Edit Round</div>
            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: ".85rem" }}>
              <div style={{ color: "var(--cream)", fontWeight: 600, marginBottom: 2 }}>{editRound.player_name}</div>
              <div style={{ color: "var(--cream-dim)" }}>{editRound.course_name}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              <div className="fg">
                <label>Gross Score</label>
                <input type="number" value={editRoundDraft.gross}
                  onChange={e => setEditRoundDraft(d => ({ ...d, gross: e.target.value }))} autoFocus />
              </div>
              <div className="fg">
                <label>Date</label>
                <input type="date" value={editRoundDraft.date}
                  onChange={e => setEditRoundDraft(d => ({ ...d, date: e.target.value }))} />
              </div>
              {config.useHandicap && editRoundDraft.gross && (
                <div style={{ background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: 8, padding: "10px 14px", fontSize: ".85rem", color: "var(--cream-dim)" }}>
                  Course Hcp: <strong style={{ color: "var(--cream)" }}>{editRound.course_handicap}</strong>
                  {" · "}Est. Net: <strong style={{ color: "var(--gold)" }}>{Number(editRoundDraft.gross) - editRound.course_handicap}</strong>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveEditRound} disabled={!editRoundDraft.gross}>Save Changes</button>
              <button className="btn btn-ghost" onClick={() => setEditRound(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Round Modal */}
      {confirmDeleteRound && (
        <div className="modal-bg" onClick={() => setConfirmDeleteRound(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Delete Round?</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 16, lineHeight: 1.7 }}>
              Are you sure you want to permanently delete this round? This cannot be undone.
            </p>
            <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: ".85rem" }}>
              <div style={{ color: "var(--cream)", fontWeight: 600, marginBottom: 4 }}>{confirmDeleteRound.player_name}</div>
              <div style={{ color: "var(--cream-dim)" }}>{confirmDeleteRound.course_name} · {confirmDeleteRound.date}</div>
              <div style={{ color: "var(--cream-dim)", marginTop: 2 }}>Gross {confirmDeleteRound.gross}{config.useHandicap ? ` · Net ${confirmDeleteRound.net}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-danger" onClick={() => { deleteRound(confirmDeleteRound); setConfirmDeleteRound(null); }}>Delete</button>
              <button className="btn btn-ghost" onClick={() => setConfirmDeleteRound(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Retroactive recalc loading overlay */}
      {retroLoading && (
        <div className="modal-bg">
          <div className="modal" style={{ textAlign: "center", padding: "32px 24px" }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>⟳</div>
            <div style={{ fontWeight: 600, color: "var(--cream)", marginBottom: 8 }}>Updating rounds…</div>
            <div style={{ fontSize: ".84rem", color: "var(--cream-dim)" }}>Recalculating handicaps for all approved rounds.</div>
          </div>
        </div>
      )}

      {/* Handicap change — future only vs retroactive */}
      {handicapChangePending && (
        <div className="modal-bg" onClick={() => setHandicapChangePending(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ marginBottom: 8 }}>Apply Handicap Change</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 20, lineHeight: 1.7 }}>
              You're changing <strong style={{ color: "var(--cream)" }}>{handicapChangePending.label}</strong>. How should this apply?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <button className="btn btn-ghost" style={{ textAlign: "left", padding: "14px 16px", borderRadius: 10 }}
                onClick={() => applyHandicapChange(false)}>
                <div style={{ fontWeight: 600, color: "var(--cream)", marginBottom: 3 }}>Future rounds only</div>
                <div style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>Already approved rounds keep their current net scores.</div>
              </button>
              <button className="btn btn-ghost" style={{ textAlign: "left", padding: "14px 16px", borderRadius: 10, borderColor: "rgba(212,168,67,.35)" }}
                onClick={() => applyHandicapChange(true)}>
                <div style={{ fontWeight: 600, color: "var(--gold)", marginBottom: 3 }}>All approved rounds</div>
                <div style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>Retroactively recalculates net scores and course handicaps for every approved round in the league.</div>
              </button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setHandicapChangePending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Edit Hcp Modal */}
      {editMemberHcp && (
        <div className="modal-bg" onClick={() => setEditMemberHcp(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Edit Handicap — {editMemberHcp.name}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 18 }}>
              <div className="fgrid">
                <div className="fg"><label>Handicap Index</label><input type="number" step=".1" min={0} max={54} value={editMemberHcp.handicap ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, handicap: e.target.value }))} /></div>
                <div className="fg"><label>GHIN #</label><input type="text" value={editMemberHcp.ghin ?? ""} onChange={e => setEditMemberHcp(d => ({ ...d, ghin: e.target.value }))} /></div>
              </div>
              {courses.length > 0 && editMemberHcp.handicap && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Course Handicaps Preview</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {courses.map(c => {
                      const ch = calcCourseHcp(Number(editMemberHcp.handicap), c.slope, c.par, c.rating, config);
                      return <span key={c.id} className="hcp-badge">{c.name}: <strong>{ch}</strong></span>;
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-gold" onClick={saveMemberHcp}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditMemberHcp(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="stabs-wrap">
        <div className="stabs">
          {[
            ["config", <><Settings size={13} />Config</>],
            ["league", "League Info"],
            ...((configDraft ?? config).tournamentMode ? [["tournament", <><Trophy size={13} />Tournament</>]] : []),
            ["groups", <><Users size={13} />Groups</>],
            ["payouts", <><DollarSign size={13} />Payouts</>],
            ["members", <><Users size={13} />Members{pendingJoins.length > 0 ? ` (${pendingJoins.length})` : ""}</>],
            ["courses", <><Flag size={13} />Courses</>],
            ["rounds", <><ClipboardList size={13} />All Rounds</>],
            ["export", <><BarChart2 size={13} />Export</>],
            ["bylaws", <><FileText size={13} />Bylaws</>],
            ["email", <><Mail size={13} />Email Members</>],
          ].map(([k, l]) => (
            <button key={k} className={`stab${adminTab === k ? " active" : ""}`} onClick={() => setAdminTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {addMsg && <div className="alert-s" style={{ marginBottom: 12 }}>{addMsg}</div>}

      {/* ── CONFIG ── */}
      {adminTab === "config" && (() => {
        const d = configDraft ?? config;
        const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
        const dirty = configDraft !== null;
        const payoutCats = d.payoutCategories ?? DEFAULT_CONFIG.payoutCategories;
        const totalPayoutPct = payoutCats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
        const payoutOverLimit = totalPayoutPct > 100;
        const Locked = ({ children }) => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--cream-dim)", fontSize: ".88rem" }}>{children}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: ".68rem", color: "#4b5563", background: "rgba(255,255,255,.05)", border: "1px solid var(--navy-border)", borderRadius: 6, padding: "2px 7px" }}>
              <Lock size={9} />League started
            </span>
          </div>
        );

        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}><Settings size={15} />League Configuration</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {dirty && <>
                  <button className="btn btn-gold" onClick={() => handleSaveConfig(configDraft)} disabled={payoutOverLimit}>Save Changes</button>
                  <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                </>}
                {!dirty && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                League Type
                {leagueStarted && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: ".68rem", color: "#4b5563", background: "rgba(255,255,255,.05)", border: "1px solid var(--navy-border)", borderRadius: 6, padding: "2px 7px" }}><Lock size={9} />Locked</span>}
              </div>
              <div className="format-grid">
                {[
                  ["stroke",      "Stroke Play",  "Classic lowest-score-wins"],
                  ["stableford",  "Stableford",   "Points per hole, most wins"],
                  ["match",       "Match Play",   "Head-to-head holes"],
                  ["scramble",    "Scramble",     "Team best-ball format"],
                  ["tournament",  "Tournament",   "Multi-round event with mixed formats"],
                ].map(([val, name, hint]) => (
                  <button key={val} className={`format-btn ${d.scoringFormat === val ? "sel" : ""}`}
                    disabled={leagueStarted}
                    onClick={() => !leagueStarted && setConfigDraft(prev => ({
                      ...(prev ?? config),
                      scoringFormat: val,
                      tournamentMode: val === "tournament",
                    }))}>
                    <span className="format-name">{name}</span><span className="format-hint">{hint}</span>
                  </button>
                ))}
              </div>
            </div>


            <div className="cfg-section">
              <div className="cfg-section-title">Round Rules</div>
              {!d.tournamentMode && <>
                <div className="cfg-row">
                  <div><div className="cfg-label">Required rounds per course</div><div className="cfg-desc">How many rounds each player/team must post at each course</div></div>
                  {leagueStarted
                    ? <Locked>{d.roundsPerCourse}</Locked>
                    : <select value={d.roundsPerCourse} onChange={e => set("roundsPerCourse", Number(e.target.value))} style={{ width: 80 }}>
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>}
                </div>
                {["stroke", "stableford"].includes(d.scoringFormat) && (
                  <div className="cfg-row">
                    <div><div className="cfg-label">Best N scores count</div><div className="cfg-desc">Only the best N of all submitted scores count. Leave blank to count all.</div></div>
                    {leagueStarted
                      ? <Locked>{d.scoresToCount ?? "All"}</Locked>
                      : <input type="number" min={1} placeholder="All" value={d.scoresToCount ?? ""} onChange={e => set("scoresToCount", e.target.value ? Number(e.target.value) : null)} style={{ width: 80 }} />}
                  </div>
                )}
              </>}
              <div className="cfg-row">
                <div><div className="cfg-label">Require attestation</div><div className="cfg-desc">Playing partner must approve each round by email</div></div>
                <Toggle checked={d.attestRequired} onChange={v => set("attestRequired", v)} />
              </div>
              {d.attestRequired && (
                <div className="cfg-row">
                  <div><div className="cfg-label">CC commissioner on attestations</div><div className="cfg-desc">Commissioner receives a copy of every attestation email</div></div>
                  <Toggle checked={d.ccCommissioner ?? false} onChange={v => set("ccCommissioner", v)} />
                </div>
              )}
              <div className="cfg-row">
                <div><div className="cfg-label">Require scorecard photo</div><div className="cfg-desc">Players must upload a photo with every submission</div></div>
                <Toggle checked={d.scorecardRequired} onChange={v => set("scorecardRequired", v)} />
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Handicap & Scoring</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Use handicaps (net scoring)</div><div className="cfg-desc">Off = gross scores only</div></div>
                <Toggle checked={d.useHandicap} onChange={v => set("useHandicap", v)} />
              </div>
              {d.useHandicap && <>
                <div className="cfg-row">
                  <div><div className="cfg-label">Handicap percentage used</div><div className="cfg-desc">e.g. 85 means players use 85% of their handicap index</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min={50} max={100} value={d.handicapPct}
                      onChange={e => set("handicapPct", Number(e.target.value))}
                      style={{ width: 70 }} />
                    <span style={{ color: "var(--cream-dim)" }}>%</span>
                  </div>
                </div>
                <div className="cfg-row">
                  <div><div className="cfg-label">Use USGA slope/rating formula</div><div className="cfg-desc">Off = flat subtract (index used directly)</div></div>
                  <Toggle checked={d.useSlopeRating} onChange={v => set("useSlopeRating", v)} />
                </div>
                <div className="cfg-row">
                  <div><div className="cfg-label">Max handicap cap</div><div className="cfg-desc">Leave blank for no cap</div></div>
                  <input type="number" min={0} max={54} placeholder="None" value={d.maxHandicap ?? ""}
                    onChange={e => set("maxHandicap", e.target.value ? Number(e.target.value) : null)}
                    style={{ width: 80 }} />
                </div>
              </>}
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Membership</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Join mode</div><div className="cfg-desc">Open = anyone joins instantly · Approval = you review requests</div></div>
                <select value={d.joinMode} onChange={e => set("joinMode", e.target.value)} style={{ width: 160 }}>
                  <option value="open">Open (invite code)</option>
                  <option value="approval">Approval required</option>
                </select>
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Max players</div><div className="cfg-desc">Leave blank for unlimited</div></div>
                <input type="number" min={2} placeholder="Unlimited" value={d.maxPlayers ?? ""} onChange={e => set("maxPlayers", e.target.value ? Number(e.target.value) : null)} style={{ width: 100 }} />
              </div>
              <div className="cfg-row">
                <div><div className="cfg-label">Hide scores until submitted</div><div className="cfg-desc">Players can't see others' scores until they post their own</div></div>
                <Toggle checked={d.hideScores} onChange={v => set("hideScores", v)} />
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><Trophy size={13} />Playoffs</div>
              <div className="cfg-row"><div><div className="cfg-label">Enable playoffs</div><div className="cfg-desc">Adds a Playoffs tab to the leaderboard</div></div><Toggle checked={d.playoffEnabled ?? true} onChange={v => set("playoffEnabled", v)} /></div>
              {(d.playoffEnabled ?? true) && <>
                <div className="cfg-row"><div><div className="cfg-label">Number of qualifiers</div><div className="cfg-desc">Top N players by regular season standings</div></div><select value={d.playoffQualifiers ?? 4} onChange={e => set("playoffQualifiers", Number(e.target.value))} style={{ width: 80 }}>{[2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="cfg-row"><div><div className="cfg-label">Seeding based on</div><div className="cfg-desc">How players are ranked to determine bracket seeding</div></div><select value={d.playoffSeedingBy ?? "net"} onChange={e => set("playoffSeedingBy", e.target.value)} style={{ width: 130 }}><option value="net">Regular Season Net</option><option value="gross">Regular Season Gross</option><option value="stableford">Stableford Pts</option></select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff format</div><div className="cfg-desc">How playoff matches are decided</div></div><select value={d.playoffFormat ?? "match"} onChange={e => set("playoffFormat", e.target.value)} style={{ width: 130 }}><option value="match">Match Play</option><option value="stroke">Stroke Play</option><option value="stableford">Stableford</option></select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff course</div><div className="cfg-desc">Course where playoff matches will be played</div></div><select value={d.playoffCourse ?? ""} onChange={e => set("playoffCourse", e.target.value || null)} style={{ width: 160 }}><option value="">Not set</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div className="cfg-row"><div><div className="cfg-label">Playoff date</div><div className="cfg-desc">Scheduled date for playoff matches</div></div><input type="date" value={d.playoffDate ?? ""} onChange={e => set("playoffDate", e.target.value || null)} style={{ width: 160 }} /></div>
              </>}
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Season Window</div>
              <p className="note" style={{ marginBottom: 12 }}>Submissions accepted only within this range. Leave blank for no restriction.</p>
              <div className="fgrid">
                <div className="fg"><label>Season Start</label><input type="date" value={d.seasonStart ?? ""} onChange={e => set("seasonStart", e.target.value || null)} /></div>
                <div className="fg"><label>Season End</label><input type="date" value={d.seasonEnd ?? ""} onChange={e => set("seasonEnd", e.target.value || null)} /></div>
              </div>
            </div>

            {dirty && (
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-gold" onClick={() => handleSaveConfig(configDraft)} disabled={payoutOverLimit}>Save Changes</button>
                <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── TOURNAMENT ── */}
      {adminTab === "tournament" && (() => {
        const d = configDraft ?? config;
        const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
        const dirty = configDraft !== null;
        const tRounds = d.tournamentRounds ?? [];
        const setTRounds = (rounds) => set("tournamentRounds", rounds);
        const FORMAT_HCP_DEFAULTS = {
          scramble:       { handicapPct: 25,  scrambleHcpMethod: "lowest" },
          texas_scramble: { handicapPct: 50,  scrambleHcpMethod: "each" },
          best_ball:      { handicapPct: 100, scrambleHcpMethod: "each" },
          stroke:         { handicapPct: 100, scrambleHcpMethod: "each" },
          stableford:     { handicapPct: 100, scrambleHcpMethod: "each" },
        };
        const addTRound = () => setTRounds([...tRounds, {
          id: `tr_${Date.now()}`, day: tRounds.length + 1,
          label: `Round ${tRounds.length + 1}`, holes: 18,
          format: "stroke", teamSize: 2, texasScrambleMode: "individual", courseId: null,
          handicapPct: 100, scrambleHcpMethod: "each",
        }]);
        const updTRound = (idx, patch) => setTRounds(tRounds.map((r, i) => i === idx ? { ...r, ...patch } : r));
        const remTRound = (idx) => setTRounds(tRounds.filter((_, i) => i !== idx));
        const TEAM_FMTS = ["scramble", "texas_scramble", "best_ball"];
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}><Trophy size={15} />Tournament Rounds</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {dirty && <>
                  <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save Changes</button>
                  <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                </>}
                {!dirty && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
              </div>
            </div>
            <div className="cfg-section">
              <div className="cfg-row" style={{ marginBottom: 8 }}>
                <div><div className="cfg-label">Teams stay the same across all rounds</div><div className="cfg-desc">Off = teams can be reconfigured per round</div></div>
                <Toggle checked={d.teamsFixed ?? true} onChange={v => set("teamsFixed", v)} />
              </div>
              {tRounds.length === 0 && <p className="note" style={{ marginBottom: 8 }}>No rounds yet. Add a round below.</p>}
              {tRounds.map((tr, idx) => (
                <div key={tr.id} style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 120px", minWidth: 100 }}>
                      <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Label</label>
                      <input type="text" value={tr.label} onChange={e => updTRound(idx, { label: e.target.value })} style={{ fontSize: ".85rem" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 60px" }}>
                      <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Holes</label>
                      <select value={tr.holes} onChange={e => updTRound(idx, { holes: Number(e.target.value) })} style={{ fontSize: ".82rem" }}>
                        <option value={9}>9</option>
                        <option value={18}>18</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px", minWidth: 130 }}>
                      <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Format</label>
                      <select value={tr.format} onChange={e => { const fmt = e.target.value; updTRound(idx, { format: fmt, ...(FORMAT_HCP_DEFAULTS[fmt] ?? { handicapPct: 100, scrambleHcpMethod: "each" }) }); }} style={{ fontSize: ".82rem" }}>
                        <option value="stroke">Stroke Play</option>
                        <option value="stableford">Stableford</option>
                        <option value="scramble">Scramble</option>
                        <option value="texas_scramble">Texas Scramble</option>
                        <option value="best_ball">Best Ball</option>
                      </select>
                    </div>
                    {TEAM_FMTS.includes(tr.format) && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 80px" }}>
                        <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Team Size</label>
                        <select value={tr.teamSize ?? 2} onChange={e => updTRound(idx, { teamSize: Number(e.target.value) })} style={{ fontSize: ".82rem" }}>
                          <option value={2}>2-man</option>
                          <option value={4}>4-man</option>
                        </select>
                      </div>
                    )}
                    {tr.format === "texas_scramble" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px", minWidth: 130 }}>
                        <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Scoring</label>
                        <select value={tr.texasScrambleMode ?? "individual"} onChange={e => updTRound(idx, { texasScrambleMode: e.target.value })} style={{ fontSize: ".82rem" }}>
                          <option value="individual">Each score counts</option>
                          <option value="best">Team takes best score</option>
                        </select>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 120 }}>
                      <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Course</label>
                      <select value={tr.courseId ?? ""} onChange={e => updTRound(idx, { courseId: e.target.value ? Number(e.target.value) : null })} style={{ fontSize: ".82rem" }}>
                        <option value="">— TBD —</option>
                        {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {d.useHandicap && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 70px" }}>
                        <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Hcp %</label>
                        <input type="number" min={0} max={100} value={tr.handicapPct ?? 100} onChange={e => updTRound(idx, { handicapPct: Number(e.target.value) })} style={{ fontSize: ".82rem", width: "100%" }} />
                      </div>
                    )}
                    {d.useHandicap && TEAM_FMTS.includes(tr.format) && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 120 }}>
                        <label style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)" }}>Hcp Method</label>
                        <select value={tr.scrambleHcpMethod ?? "each"} onChange={e => updTRound(idx, { scrambleHcpMethod: e.target.value })} style={{ fontSize: ".82rem" }}>
                          <option value="each">Each player</option>
                          <option value="lowest">Lowest</option>
                          <option value="average">Average</option>
                          <option value="combined">Combined (weighted)</option>
                        </select>
                      </div>
                    )}
                    <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: ".7rem", alignSelf: "flex-end" }} onClick={() => remTRound(idx)}>✕</button>
                  </div>
                  {!(d.teamsFixed ?? true) && TEAM_FMTS.includes(tr.format) && (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--navy-border)", paddingTop: 12 }}>
                      <div style={{ fontSize: ".6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--gold)", fontFamily: "var(--font-d)", marginBottom: 8 }}>Teams for this round</div>
                      {renderTeamBuilder(tr.teams ?? [], (t) => updTRound(idx, { teams: t }), tr.teamSize ?? 2)}
                    </div>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ fontSize: ".65rem", marginTop: 4 }} onClick={addTRound}>+ Add Round</button>
            </div>
            {dirty && (
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save Changes</button>
                <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── GROUPS ── */}
      {adminTab === "groups" && (() => {
        const d = configDraft ?? config;
        const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
        const dirty = configDraft !== null;
        const TEAM_FMTS = ["scramble", "texas_scramble", "best_ball"];
        const showTeams = TEAM_FMTS.includes(d.scoringFormat) ||
          (d.tournamentMode && (d.teamsFixed ?? true) && (d.tournamentRounds ?? []).some(r => TEAM_FMTS.includes(r.format)));

        const teamSize = d.tournamentMode
          ? Math.max(2, ...(d.tournamentRounds ?? []).filter(r => TEAM_FMTS.includes(r.format)).map(r => r.teamSize ?? 2))
          : d.scrambleTeamSize ?? 2;
        const teams = d.scrambleTeams ?? [];
        const resolvePlayerRef = (ref) => {
          if (!ref) return null;
          const m = members.find(mb => mb.user_id === ref);
          return m?.profile?.name ?? ref;
        };
        const normTeams = teams.map(t => ({ ...t, players: (t.players ?? []).map(resolvePlayerRef).filter(Boolean) }));
        const assignedInTeams = new Set(normTeams.flatMap(t => t.players ?? []));

        const flights = d.flights ?? [];
        const assignedIds = new Set(flights.flatMap(f => f.memberIds ?? []));
        const unassignedFlights = members.filter(m => m.profile && !assignedIds.has(m.user_id));

        const FLIGHT_COLORS = ["var(--gold)", "#7c9ef5", "#7be0a0", "#f09090", "#c084fc", "#fb923c"];

        return (
          <>
            {/* ── TEAMS ── */}
            {showTeams && (
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                  <div className="card-hdr" style={{ marginBottom: 0 }}>Teams</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {dirty && <>
                      <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save</button>
                      <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                    </>}
                    {!dirty && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
                  </div>
                </div>
                <p className="note" style={{ marginBottom: 14 }}>
                  {d.tournamentMode
                    ? "Teams are shared across all rounds — match team sizes to the formats in Tournament tab."
                    : "Assign players to teams for the scramble season."}
                </p>

                {!d.tournamentMode && (
                  <div className="cfg-row" style={{ marginBottom: 16 }}>
                    <div><div className="cfg-label">Team size</div><div className="cfg-desc">Players per team</div></div>
                    <select value={d.scrambleTeamSize ?? 2} onChange={e => set("scrambleTeamSize", Number(e.target.value))} style={{ width: 90 }}>
                      <option value={2}>2-man</option>
                      <option value={4}>4-man</option>
                    </select>
                  </div>
                )}

                {normTeams.length === 0 && (
                  <div style={{ textAlign: "center", padding: "24px 0", color: "var(--cream-dim)", fontSize: ".85rem" }}>
                    No teams yet. Add your first team below.
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                  {normTeams.map((team, ti) => {
                    return (
                      <div key={team.id} style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 10, overflow: "hidden" }}>
                        {/* Team header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--navy-border)", background: "rgba(255,255,255,.02)" }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-d)", fontSize: ".85rem", color: "var(--gold)", flexShrink: 0 }}>
                            {(team.name?.[0] ?? "T").toUpperCase()}
                          </div>
                          <input type="text" value={team.name} placeholder="Team name"
                            onChange={e => set("scrambleTeams", normTeams.map((t, i) => i === ti ? { ...t, name: e.target.value } : t))}
                            style={{ flex: 1, fontSize: ".9rem", fontWeight: 500, background: "transparent", border: "none", color: "var(--white)", padding: 0, outline: "none" }} />
                          <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: ".72rem", flexShrink: 0 }}
                            onClick={() => set("scrambleTeams", normTeams.filter((_, i) => i !== ti))}>Remove</button>
                        </div>
                        {/* Player slots */}
                        <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {Array.from({ length: teamSize }).map((_, si) => {
                            const assigned = team.players?.[si] ?? null;
                            const opts = members.filter(m => m.profile && (m.profile.name === assigned || !assignedInTeams.has(m.profile.name)));
                            return (
                              <div key={si} style={{ flex: "1 1 140px", minWidth: 120 }}>
                                <div style={{ fontSize: ".58rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)", marginBottom: 4 }}>
                                  Player {si + 1}
                                </div>
                                <select value={assigned ?? ""}
                                  onChange={e => {
                                    const newPlayers = [...(team.players ?? [])];
                                    newPlayers[si] = e.target.value || null;
                                    set("scrambleTeams", normTeams.map((t, i) => i === ti ? { ...t, players: newPlayers.filter(Boolean) } : t));
                                  }}
                                  style={{ width: "100%", fontSize: ".85rem" }}>
                                  <option value="">— Select player —</option>
                                  {opts.map(m => <option key={m.user_id} value={m.profile.name}>{m.profile.name}</option>)}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => set("scrambleTeams", [...normTeams, { id: `team_${Date.now()}`, name: `Team ${normTeams.length + 1}`, players: [] }])}>
                    + Add Team
                  </button>
                  {(() => {
                    const unassigned = members.filter(m => m.profile && !assignedInTeams.has(m.profile.name));
                    return unassigned.length > 0
                      ? <span style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>{unassigned.length} unassigned: {unassigned.map(m => m.profile.name).join(", ")}</span>
                      : normTeams.length > 0 ? <span style={{ fontSize: ".72rem", color: "var(--green)" }}>✓ All players assigned</span> : null;
                  })()}
                </div>
              </div>
            )}

            {/* ── FLIGHTS ── */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="card-hdr" style={{ marginBottom: 0 }}>Flights</div>
                  <span style={{ fontSize: ".7rem", color: "var(--cream-dim)", fontFamily: "var(--font-b)" }}>optional</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {dirty && !showTeams && <>
                    <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save</button>
                    <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                  </>}
                  {!dirty && !showTeams && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => set("flights", [...flights, { id: `flight_${Date.now()}`, name: `Flight ${flights.length + 1}`, memberIds: [] }])}>
                    + Add Flight
                  </button>
                </div>
              </div>
              <p className="note" style={{ marginBottom: 14 }}>
                Flights divide players into separate divisions on the leaderboard. Each player can only be in one flight.
              </p>

              {flights.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--cream-dim)", fontSize: ".85rem" }}>
                  No flights yet. Add a flight above to create divisions.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                  {flights.map((flight, fi) => {
                    const count = (flight.memberIds ?? []).length;
                    const color = FLIGHT_COLORS[fi % FLIGHT_COLORS.length];
                    return (
                      <div key={flight.id} style={{ border: `1px solid var(--navy-border)`, borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--navy-border)", background: "rgba(255,255,255,.02)" }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                          <input type="text" value={flight.name} placeholder="Flight name"
                            onChange={e => set("flights", flights.map((f, i) => i === fi ? { ...f, name: e.target.value } : f))}
                            style={{ flex: 1, fontSize: ".9rem", fontWeight: 500, background: "transparent", border: "none", color: "var(--white)", padding: 0, outline: "none" }} />
                          <span style={{ fontSize: ".72rem", color, fontFamily: "var(--font-d)", letterSpacing: "1px", flexShrink: 0 }}>{count} player{count !== 1 ? "s" : ""}</span>
                          <button className="btn btn-danger" style={{ padding: "3px 10px", fontSize: ".72rem", flexShrink: 0 }}
                            onClick={() => set("flights", flights.filter((_, i) => i !== fi))}>Remove</button>
                        </div>
                        <div style={{ padding: "10px 14px" }}>
                          <div style={{ fontSize: ".62rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "var(--cream-dim)", marginBottom: 8 }}>Click to assign / remove</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {members.filter(m => m.profile).map(m => {
                              const inThis = (flight.memberIds ?? []).includes(m.user_id);
                              const inOther = !inThis && assignedIds.has(m.user_id);
                              if (inOther) return null;
                              return (
                                <button key={m.user_id}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 6,
                                    padding: "5px 10px", borderRadius: 20, fontSize: ".78rem",
                                    border: `1px solid ${inThis ? color : "rgba(255,255,255,.1)"}`,
                                    background: inThis ? `${color}22` : "transparent",
                                    color: inThis ? color : "var(--cream-dim)",
                                    cursor: "pointer", transition: "all .15s",
                                  }}
                                  onClick={() => {
                                    const ids = flight.memberIds ?? [];
                                    const newIds = inThis ? ids.filter(id => id !== m.user_id) : [...ids, m.user_id];
                                    set("flights", flights.map((f, i) => i === fi ? { ...f, memberIds: newIds } : f));
                                  }}>
                                  <span style={{ width: 18, height: 18, borderRadius: "50%", background: inThis ? color : "rgba(255,255,255,.1)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: ".6rem", color: inThis ? "#000" : "var(--cream-dim)", fontFamily: "var(--font-d)", fontWeight: 700 }}>
                                    {(m.profile.name?.[0] ?? "?").toUpperCase()}
                                  </span>
                                  {m.profile.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {unassignedFlights.length > 0 && flights.length > 0 && (
                <p className="note" style={{ marginTop: 4 }}>
                  {unassignedFlights.length} not in any flight: {unassignedFlights.map(m => m.profile.name).join(", ")}
                </p>
              )}

              {dirty && (
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button className="btn btn-gold" onClick={() => saveConfig(configDraft)}>Save Changes</button>
                  <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                </div>
              )}
            </div>
          </>
        );
      })()}

      {/* ── PAYOUTS ── */}
      {adminTab === "payouts" && (() => {
        const d = configDraft ?? config;
        const set = (k, v) => setConfigDraft(prev => ({ ...(prev ?? config), [k]: v }));
        const dirty = configDraft !== null;
        const legacyIdToType = { champion: "playoff_1", runnerUp: "playoff_2", thirdPlace: "playoff_3", regularNet: "net_1", regularGross: "gross_1" };
        const cats = (d.payoutCategories ?? DEFAULT_CONFIG.payoutCategories).map(cat => {
          if (cat.mapTo !== undefined) return cat;
          const type = cat.type ?? legacyIdToType[cat.id];
          if (!type || type === "none") return { ...cat, mapTo: "none", mapRank: 1 };
          const m = type.match(/^(playoff|net|gross)_(\d+)$/);
          return m ? { ...cat, mapTo: m[1], mapRank: Number(m[2]) } : { ...cat, mapTo: "none", mapRank: 1 };
        });
        const totalPct = cats.reduce((s, c) => s + (Number(c.pct) || 0), 0);
        const overLimit = totalPct > 100;
        const pool = (d.entryFee ?? 0) * members.filter(m => m.paid).length;
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div className="card-hdr" style={{ marginBottom: 0 }}><DollarSign size={15} />Payouts</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {dirty && <>
                  <button className="btn btn-gold" onClick={() => saveConfig(configDraft)} disabled={overLimit}>Save Changes</button>
                  <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
                </>}
                {!dirty && <span style={{ fontSize: ".76rem", color: "var(--green)", fontFamily: "var(--font-d)", letterSpacing: "1px" }}>✓ Saved</span>}
              </div>
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Entry Fee</div>
              <div className="cfg-row">
                <div><div className="cfg-label">Entry fee per player</div><div className="cfg-desc">Used to calculate the total prize pool</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--cream-dim)" }}>$</span>
                  <input type="number" min={0} placeholder="0" value={d.entryFee ?? ""} onChange={e => set("entryFee", e.target.value ? Number(e.target.value) : null)} style={{ width: 90 }} />
                </div>
              </div>
              {d.entryFee > 0 && members.length > 0 && (() => {
                const paidCnt = members.filter(m => m.paid).length;
                return <div style={{ padding: "10px 0 4px", fontSize: ".82rem", color: "var(--cream-dim)" }}><span style={{ color: "var(--gold-light)", fontFamily: "var(--font-d)" }}>${(d.entryFee * paidCnt).toLocaleString()}</span> collected so far ({paidCnt} of {members.length} players paid)</div>;
              })()}
            </div>

            <div className="cfg-section">
              <div className="cfg-section-title">Award Rules</div>
              <div className="cfg-row">
                <div><div className="cfg-label">One award per player</div><div className="cfg-desc">A player cannot win both a net and a gross category</div></div>
                <Toggle checked={d.exclusiveWinners ?? false} onChange={v => set("exclusiveWinners", v)} />
              </div>
              {(d.exclusiveWinners ?? false) && (
                <div className="cfg-row">
                  <div><div className="cfg-label">Precedence</div><div className="cfg-desc">Which category wins when a player qualifies for both</div></div>
                  <select value={d.exclusivePrecedence ?? "gross"} onChange={e => set("exclusivePrecedence", e.target.value)} style={{ width: 160 }}>
                    <option value="gross">Gross over Net</option>
                    <option value="net">Net over Gross</option>
                    <option value="highest">Highest Payout Wins</option>
                  </select>
                </div>
              )}
            </div>

            <div className="cfg-section">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div className="cfg-section-title" style={{ marginBottom: 0 }}>Payout Categories</div>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: ".65rem" }} onClick={() => {
                  set("payoutCategories", [...cats, { id: `custom_${Date.now()}`, label: "New Category", pct: 0, mapTo: "none", mapRank: 1 }]);
                }}>+ Add Category</button>
              </div>
              <p className="note" style={{ marginBottom: 12 }}>Map each category to a placement so winners are tracked automatically. Set the % of the prize pool for each.</p>
              {cats.map((cat, idx) => {
                const amt = pool > 0 ? Math.round(pool * cat.pct / 100) : null;
                const upd = (patch) => set("payoutCategories", cats.map((c, i) => i === idx ? { ...c, ...patch } : c));
                return (
                  <div key={cat.id} className="payout-cat-row" style={{ flexWrap: "wrap", gap: 8 }}>
                    <input type="text" value={cat.label} placeholder="Category name"
                      style={{ flex: "1 1 130px", minWidth: 100, fontSize: ".86rem" }}
                      onChange={e => upd({ label: e.target.value })} />
                    <select value={cat.mapTo ?? "none"} onChange={e => upd({ mapTo: e.target.value, mapRank: cat.mapRank ?? 1 })}
                      style={{ flex: "1 1 130px", minWidth: 120, fontSize: ".82rem" }}>
                      <option value="none">— Side game —</option>
                      <option value="playoff">Playoff</option>
                      <option value="net">Net standings</option>
                      <option value="gross">Gross standings</option>
                    </select>
                    {d.tournamentMode && (cat.mapTo === "net" || cat.mapTo === "gross") && (
                      <select value={cat.tournamentRoundId ?? ""} onChange={e => upd({ tournamentRoundId: e.target.value || null })}
                        style={{ flex: "1 1 130px", minWidth: 120, fontSize: ".82rem" }}>
                        <option value="">Overall</option>
                        {(d.tournamentRounds ?? []).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </select>
                    )}
                    {(d.flights ?? []).length > 0 && (cat.mapTo === "net" || cat.mapTo === "gross") && (
                      <select value={cat.flightId ?? ""} onChange={e => upd({ flightId: e.target.value || null })}
                        style={{ flex: "1 1 130px", minWidth: 120, fontSize: ".82rem" }}>
                        <option value="">All flights</option>
                        {(d.flights ?? []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    )}
                    {(cat.mapTo ?? "none") !== "none" ? (
                      <input type="number" min={1} max={99} value={cat.mapRank ?? 1}
                        onChange={e => upd({ mapRank: Math.max(1, Number(e.target.value) || 1) })}
                        style={{ width: 52, fontSize: ".82rem", textAlign: "center" }}
                        title="Rank (1 = 1st place, 2 = 2nd place, etc.)" />
                    ) : (
                      <select value={cat.winner ?? ""} onChange={e => upd({ winner: e.target.value || null })}
                        style={{ flex: "1 1 130px", minWidth: 120, fontSize: ".82rem" }}>
                        <option value="">— Assign winner —</option>
                        {members.filter(m => m.profile).map(m => <option key={m.user_id} value={m.profile.name}>{m.profile.name}</option>)}
                      </select>
                    )}
                    <div className="payout-pct-input">
                      <input type="number" min={0} max={100} step={1} value={cat.pct || ""} placeholder="0"
                        style={{ borderColor: overLimit && cat.pct > 0 ? "rgba(224,92,92,.5)" : undefined }}
                        onChange={e => { const val = Math.max(0, Math.min(100, Number(e.target.value) || 0)); upd({ pct: val }); }} />
                      <span style={{ color: "var(--cream-dim)" }}>%</span>
                    </div>
                    <div className="payout-amount">{amt != null && cat.pct > 0 ? `$${amt.toLocaleString()}` : <span style={{ color: "#4b5563" }}>—</span>}</div>
                    <button className="btn btn-danger" style={{ padding: "3px 8px", fontSize: ".7rem", flexShrink: 0 }} onClick={() => set("payoutCategories", cats.filter((_, i) => i !== idx))}>✕</button>
                  </div>
                );
              })}
              <div className="pct-bar-wrap"><div className="pct-bar" style={{ width: `${Math.min(totalPct, 100)}%`, background: overLimit ? "var(--red)" : totalPct === 100 ? "var(--green)" : "linear-gradient(90deg,var(--gold),var(--gold-light))" }} /></div>
              <div className="pct-total-row">
                <span style={{ color: "var(--cream-dim)" }}>Total allocated</span>
                <span className={overLimit ? "pct-total-over" : totalPct === 100 ? "pct-total-ok" : "pct-total-under"}>
                  {overLimit ? `${totalPct}% — exceeds 100%` : totalPct === 100 ? `✓ ${totalPct}% — fully allocated` : `${totalPct}% (${100 - totalPct}% remaining)`}
                </span>
              </div>
              {overLimit && <div className="alert-d" style={{ marginTop: 10, fontSize: ".8rem" }}>Total exceeds 100%. Please reduce before saving.</div>}
            </div>

            {dirty && (
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button className="btn btn-gold" onClick={() => saveConfig(configDraft)} disabled={overLimit}>Save Changes</button>
                <button className="btn btn-ghost" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── MEMBERS ── */}
      {adminTab === "members" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="card-hdr" style={{ marginBottom: 0 }}><Users size={15} />League Members</div>
            {config.entryFee > 0 && (() => {
              const paidCount = members.filter(m => m.paid).length;
              const unpaidCount = members.length - paidCount;
              return (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: ".76rem", color: "#6ee7a0", display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={11} />{paidCount} paid</span>
                  {unpaidCount > 0 && <span style={{ fontSize: ".76rem", color: "#f09090", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} />{unpaidCount} unpaid</span>}
                  <span style={{ fontSize: ".76rem", color: "var(--gold-light)", fontFamily: "var(--font-d)" }}>${(paidCount * config.entryFee).toLocaleString()} / ${(members.length * config.entryFee).toLocaleString()} collected</span>
                </div>
              );
            })()}
          </div>

          {/* Add member manually */}
          <div style={{ marginBottom: 16 }}>
            {!showAddMember ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddMember(true)}>+ Add Member Manually</button>
            ) : (
              <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: "16px" }}>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 12 }}>Add Member</div>
                <div className="fgrid" style={{ marginBottom: 12 }}>
                  <div className="fg" style={{ gridColumn: "1/-1" }}>
                    <label>Email <span style={{ color: "var(--red)" }}>*</span></label>
                    <input type="email" placeholder="player@email.com" value={addMemberDraft.email}
                      onChange={e => setAddMemberDraft(d => ({ ...d, email: e.target.value }))} />
                    <span style={{ fontSize: ".7rem", color: "var(--cream-dim)", marginTop: 3, display: "block" }}>Must match their Greek Side Bunker account email.</span>
                  </div>
                  <div className="fg" style={{ gridColumn: "1/-1" }}>
                    <label>Display Name <span style={{ color: "var(--red)" }}>*</span></label>
                    <input type="text" placeholder="John Smith" value={addMemberDraft.name}
                      onChange={e => setAddMemberDraft(d => ({ ...d, name: e.target.value }))} />
                  </div>
                  <div className="fg">
                    <label>Handicap Index</label>
                    <input type="number" step=".1" min={0} max={54} placeholder="e.g. 8.4" value={addMemberDraft.handicap}
                      onChange={e => setAddMemberDraft(d => ({ ...d, handicap: e.target.value }))} />
                  </div>
                  <div className="fg">
                    <label>GHIN #</label>
                    <input type="text" placeholder="e.g. 1234567" value={addMemberDraft.ghin}
                      onChange={e => setAddMemberDraft(d => ({ ...d, ghin: e.target.value }))} />
                  </div>
                </div>
                {addMemberMsg.text && (
                  <div style={{ marginBottom: 10, fontSize: ".82rem", color: addMemberMsg.ok ? "var(--green)" : "#f09090" }}>{addMemberMsg.text}</div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-gold btn-sm" onClick={addMemberByEmail}
                    disabled={!addMemberDraft.email.trim() || !addMemberDraft.name.trim() || addMemberLoading}>
                    {addMemberLoading ? "Adding..." : "Add to League"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddMember(false); setAddMemberMsg({ text: "", ok: true }); }}>Cancel</button>
                </div>
              </div>
            )}
            {!showAddMember && addMemberMsg.text && (
              <div style={{ marginTop: 8, fontSize: ".82rem", color: addMemberMsg.ok ? "var(--green)" : "#f09090" }}>{addMemberMsg.text}</div>
            )}
          </div>

          {pendingInvites.length > 0 && (
            <>
              <div style={{ fontSize: ".7rem", color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <Mail size={11} />Pending Invites ({pendingInvites.length})
              </div>
              {pendingInvites.map(inv => (
                <div key={inv.id} className="pchip" style={{ borderColor: "rgba(212,168,67,.25)", opacity: 0.85 }}>
                  <div className="avatar lg" style={{ background: "rgba(212,168,67,.12)", border: "1px solid rgba(212,168,67,.3)", color: "var(--gold)", fontSize: ".75rem" }}>
                    {inv.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="pchip-info">
                    <div className="pchip-name">{inv.name}</div>
                    <div className="pchip-meta">
                      {inv.email}
                      {inv.handicap != null && <> · Hcp {inv.handicap}</>}
                      {" · "}<span style={{ color: "var(--gold-light)" }}>Invite pending</span>
                    </div>
                  </div>
                  <div className="pchip-actions">
                    <button className="btn btn-danger" onClick={() => cancelInvite(inv.id)}>Cancel</button>
                  </div>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--navy-border)", margin: "12px 0" }} />
            </>
          )}

          {pendingJoins.length > 0 && <>
            <div style={{ fontSize: ".7rem", color: "var(--purple)", fontFamily: "var(--font-d)", letterSpacing: "2px", textTransform: "uppercase", marginBottom: 8 }}>Pending Join Requests</div>
            {pendingJoins.map(req => (
              <div key={req.id} className="pchip" style={{ borderColor: "rgba(155,127,232,.3)" }}>
                <div className="avatar lg">{req.profile?.avatar_url ? <img src={req.profile.avatar_url} alt="" /> : req.profile?.name?.[0]?.toUpperCase()}</div>
                <div className="pchip-info"><div className="pchip-name">{req.profile?.name}</div><div className="pchip-meta">{req.profile?.email}</div></div>
                <div className="pchip-actions">
                  <button className="btn btn-gold btn-sm" onClick={() => approveJoin(req)}>Approve</button>
                  <button className="btn btn-danger" onClick={() => denyJoin(req)}>Deny</button>
                </div>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--navy-border)", margin: "12px 0" }} />
          </>}

          {members.map(m => (
            <div key={m.user_id} className="pchip" style={{ borderColor: config.entryFee > 0 ? (m.paid ? "rgba(76,175,125,.2)" : "rgba(224,92,92,.15)") : undefined }}>
              <div className="avatar lg">{m.profile?.avatar_url ? <img src={m.profile.avatar_url} alt="" /> : m.profile?.name?.[0]?.toUpperCase()}</div>
              <div className="pchip-info">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="pchip-name">{m.profile?.name ?? "Unknown"}</div>
                  {config.entryFee > 0 && <span className={`paid-badge ${m.paid ? "paid" : "unpaid"}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{m.paid ? <><Check size={10} />Paid</> : <><X size={10} />Unpaid</>}</span>}
                  {config.useHandicap && ((!m.profile.handicap && m.profile.handicap !== 0) || !/^\d{7,8}$/.test(String(m.profile.ghin ?? ""))) && (
                    <span style={{ fontSize: ".6rem", padding: "2px 7px", borderRadius: 20, background: "rgba(224,92,92,.12)", border: "1px solid rgba(224,92,92,.3)", color: "#f09090", fontFamily: "var(--font-d)", letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                      <AlertTriangle size={10} style={{ display: "inline" }} /> Profile Incomplete
                    </span>
                  )}
                </div>
                <div className="pchip-meta">
                  {m.profile?.email ?? "-"} · Hcp {m.profile?.handicap ?? "-"}
                  {m.profile.ghin && <> · <GhinLink ghin={m.profile.ghin} style={{ fontSize: ".68rem" }} /></>}
                  {" · "}{rounds.filter(r => r.player_id === m.user_id).length} rounds
                </div>
                {config.useHandicap && courses.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                    {courses.map(c => {
                      const ch = calcCourseHcp(m.profile.handicap ?? 0, c.slope, c.par, c.rating, config);
                      return <span key={c.id} className="hcp-badge" style={{ fontSize: ".66rem" }}>{c.name}: {ch}</span>;
                    })}
                  </div>
                )}
              </div>
              <div className="pchip-actions">
                <span className={`lrole ${m.role}`}>{m.role === "admin" ? "Commissioner" : "Player"}</span>
                {config.entryFee > 0 && <button className={`btn btn-sm ${m.paid ? "btn-danger" : "btn-gold"}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => togglePaid(m.user_id, m.paid)}>{m.paid ? "Mark Unpaid" : <><Check size={12} />Mark Paid</>}</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setEditMemberHcp({ uid: m.user_id, name: m.profile?.name, handicap: m.profile?.handicap, ghin: m.profile?.ghin })}>Edit Hcp</button>
                {m.user_id !== session.user.id && <button className="btn btn-ghost btn-sm" onClick={() => toggleRole(m.user_id, m.role)}>{m.role === "admin" ? "→ Player" : "→ Commissioner"}</button>}
                {m.user_id !== session.user.id && <button className="btn btn-danger" onClick={() => removeMember(m.user_id)}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── COURSE SEARCH MODAL ── */}
      {courseSearch.open && (
        <div className="modal-bg" onClick={() => setCourseSearch(s => ({ ...s, open: false }))}>
          <div className="modal" style={{ maxWidth: 520, width: "100%" }} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ marginBottom: 14 }}>Search Golf Course</div>

            {/* Scan scorecard */}
            <input
              ref={scorecardInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={e => scanScorecard(e.target.files?.[0])}
            />
            <button
              className="btn btn-ghost"
              style={{ width: "100%", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: "1px dashed rgba(212,168,67,.35)", color: "var(--gold-light)" }}
              onClick={() => scorecardInputRef.current?.click()}
              disabled={courseSearch.scanLoading}
            >
              {courseSearch.scanLoading
                ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Scanning scorecard…</>
                : <><Camera size={14} /> Scan Scorecard with AI</>}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--navy-border)" }} />
              <span style={{ fontSize: ".7rem", color: "var(--cream-dim)", letterSpacing: "1px" }}>OR SEARCH BY NAME</span>
              <div style={{ flex: 1, height: 1, background: "var(--navy-border)" }} />
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Course or club name..."
                value={courseSearch.query}
                onChange={e => setCourseSearch(s => ({ ...s, query: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && searchGolfCourses(courseSearch.query)}
                style={{ flex: 1 }}
                autoFocus
              />
              <button className="btn btn-gold" onClick={() => searchGolfCourses(courseSearch.query)} disabled={courseSearch.loading}>
                {courseSearch.loading ? "Searching…" : "Search"}
              </button>
            </div>
            {courseSearch.error && <div style={{ color: "#f09090", fontSize: ".82rem", marginBottom: 10 }}>{courseSearch.error}</div>}

            {/* Results list */}
            {!courseSearch.selected && courseSearch.results.length > 0 && (
              <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {courseSearch.results.map(c => (
                  <button key={c.id} className="btn btn-ghost" style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8 }}
                    onClick={() => setCourseSearch(s => ({ ...s, selected: c, selectedTee: null }))}>
                    <div style={{ fontWeight: 600, color: "var(--cream)" }}>{c.club_name}</div>
                    {c.course_name !== c.club_name && <div style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{c.course_name}</div>}
                    <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", marginTop: 2 }}>{c.location?.city}{c.location?.state ? `, ${c.location.state}` : ""}</div>
                  </button>
                ))}
              </div>
            )}
            {!courseSearch.selected && courseSearch.results.length === 0 && !courseSearch.loading && courseSearch.query && !courseSearch.error && (
              <div style={{ color: "var(--cream-dim)", fontSize: ".84rem" }}>No results. Try a different name.</div>
            )}

            {/* Tee picker */}
            {courseSearch.selected && (() => {
              const c = courseSearch.selected;
              const allTees = [...(c.tees?.male ?? []), ...(c.tees?.female ?? [])];
              return (
                <div>
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => setCourseSearch(s => ({ ...s, selected: null, selectedTee: null }))}>← Back to results</button>
                  <div style={{ fontWeight: 600, color: "var(--cream)", marginBottom: 4 }}>{c.club_name}</div>
                  {c.course_name !== c.club_name && <div style={{ fontSize: ".82rem", color: "var(--cream-dim)", marginBottom: 10 }}>{c.course_name}</div>}
                  <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Select Tee Box</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                    {allTees.map((tee, i) => {
                      const sel = courseSearch.selectedTee === tee;
                      const missingCount = [tee.slope_rating, tee.course_rating, tee.par_total].filter(v => v == null).length;
                      return (
                        <button key={i} className={`btn ${sel ? "btn-gold" : "btn-ghost"}`}
                          style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8 }}
                          onClick={() => setCourseSearch(s => ({ ...s, selectedTee: tee, teeDraft: {}, error: "" }))}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600 }}>{tee.tee_name}</span>
                            <span style={{ fontSize: ".75rem", color: sel ? "rgba(255,255,255,.8)" : "var(--cream-dim)" }}>
                              Par {tee.par_total ?? "?"} · {tee.number_of_holes ?? 18} holes · Slope {tee.slope_rating ?? "?"} · Rating {tee.course_rating ?? "?"}
                              {missingCount > 0 && <span style={{ color: "#f0c96a", marginLeft: 6 }}>({missingCount} missing)</span>}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Fill in missing values for selected tee */}
                  {courseSearch.selectedTee && (() => {
                    const tee = courseSearch.selectedTee;
                    const missing = [];
                    if (tee.slope_rating == null) missing.push("slope");
                    if (tee.course_rating == null) missing.push("rating");
                    if (tee.par_total == null) missing.push("par");
                    if (missing.length === 0) return null;
                    return (
                      <div style={{ marginTop: 12, background: "rgba(240,201,106,.07)", border: "1px solid rgba(240,201,106,.2)", borderRadius: 8, padding: "12px 14px" }}>
                        <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 10 }}>Fill in missing values</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {missing.includes("slope") && (
                            <div className="fg" style={{ flex: "1 1 80px" }}>
                              <label>Slope</label>
                              <input type="number" placeholder="113" value={courseSearch.teeDraft.slope ?? ""}
                                onChange={e => setCourseSearch(s => ({ ...s, teeDraft: { ...s.teeDraft, slope: e.target.value } }))} />
                            </div>
                          )}
                          {missing.includes("rating") && (
                            <div className="fg" style={{ flex: "1 1 80px" }}>
                              <label>Rating</label>
                              <input type="number" step=".1" placeholder="72.0" value={courseSearch.teeDraft.rating ?? ""}
                                onChange={e => setCourseSearch(s => ({ ...s, teeDraft: { ...s.teeDraft, rating: e.target.value } }))} />
                            </div>
                          )}
                          {missing.includes("par") && (
                            <div className="fg" style={{ flex: "1 1 80px" }}>
                              <label>Par</label>
                              <input type="number" placeholder="72" value={courseSearch.teeDraft.par ?? ""}
                                onChange={e => setCourseSearch(s => ({ ...s, teeDraft: { ...s.teeDraft, par: e.target.value } }))} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button className="btn btn-gold" onClick={confirmCourseFromSearch} disabled={!courseSearch.selectedTee}>Add Course</button>
                    <button className="btn btn-ghost" onClick={() => setCourseSearch({ open: false, query: "", results: [], loading: false, error: "", selected: null, selectedTee: null })}>Cancel</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── COURSES ── */}
      {adminTab === "courses" && (
        <div className="card">
          <div className="card-hdr"><Flag size={15} />Courses</div>
          {courses.map(c => (
            <div key={c.id} className="pchip" style={{ borderColor: c.playoff_only ? "rgba(212,168,67,.25)" : undefined }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="pchip-name">{c.name}</div>
                  {c.playoff_only && <span style={{ fontSize: ".6rem", padding: "1px 7px", borderRadius: 20, background: "rgba(212,168,67,.15)", border: "1px solid var(--gold-border)", color: "var(--gold)", fontFamily: "var(--font-d)", letterSpacing: "1px", textTransform: "uppercase" }}>Playoff Only</span>}
                </div>
                <div className="pchip-meta">Par {c.par} · {c.holes} holes · Slope {c.slope} · Rating {c.rating}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: ".58rem", color: "var(--cream-dim)", letterSpacing: "1px", textTransform: "uppercase", fontFamily: "var(--font-d)" }}>Playoff Only</span>
                  <Toggle checked={!!c.playoff_only} onChange={() => togglePlayoffOnly(c.id, c.playoff_only)} />
                </div>
                <button className="btn btn-danger" onClick={() => deleteCourse(c.id)}>Remove</button>
              </div>
            </div>
          ))}
          {!showAddCourse ? (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn btn-gold btn-sm" onClick={() => setCourseSearch(s => ({ ...s, open: true }))}>Search & Add Course</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddCourse(true)}>+ Add Manually</button>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div className="fgrid" style={{ marginBottom: 12 }}>
                <div className="fg" style={{ gridColumn: "1/-1" }}><label>Course Name</label><input type="text" value={newCourse.name} onChange={e => setNewCourse(c => ({ ...c, name: e.target.value }))} /></div>
                <div className="fg"><label>Par</label><input type="number" placeholder="72" value={newCourse.par} onChange={e => setNewCourse(c => ({ ...c, par: e.target.value }))} /></div>
                <div className="fg"><label>Holes</label><select value={newCourse.holes} onChange={e => setNewCourse(c => ({ ...c, holes: e.target.value }))}><option>18</option><option>9</option></select></div>
                <div className="fg"><label>Slope</label><input type="number" placeholder="113" value={newCourse.slope} onChange={e => setNewCourse(c => ({ ...c, slope: e.target.value }))} /></div>
                <div className="fg"><label>Rating</label><input type="number" step=".1" placeholder="72.0" value={newCourse.rating} onChange={e => setNewCourse(c => ({ ...c, rating: e.target.value }))} /></div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-gold" onClick={addCourse} disabled={!newCourse.name || !newCourse.par || !newCourse.slope || !newCourse.rating}>Add</button>
                <button className="btn btn-ghost" onClick={() => setShowAddCourse(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ALL ROUNDS ── */}
      {adminTab === "rounds" && (() => {
        const TEAM_FORMATS = ["scramble", "texas_scramble", "best_ball"];
        const teamLookup = Object.fromEntries((config.scrambleTeams ?? []).map(t => [String(t.id), t.name]));
        const isTeamMode = (config.scrambleTeams ?? []).length > 0 &&
          (TEAM_FORMATS.includes(config.scoringFormat) ||
           (config.tournamentMode && (config.tournamentRounds ?? []).some(tr => TEAM_FORMATS.includes(tr.format))));

        // Deduplicate: in team mode keep one row per team per course/tournament-round (latest wins)
        const displayRounds = isTeamMode
          ? Object.values(rounds.reduce((acc, r) => {
              const key = r.team_id ? `${r.team_id}_${r.tournament_round_id ?? r.course_id}` : r.id;
              if (!acc[key] || r.created_at > acc[key].created_at) acc[key] = r;
              return acc;
            }, {})).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          : rounds;

        return (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div className="card-hdr" style={{ marginBottom: 0 }}><ClipboardList size={15} />All Rounds</div>
            <button className="btn btn-danger" onClick={clearAllRounds}>Clear All</button>
          </div>
          {rounds.length === 0 ? <div className="empty">No rounds yet.</div> : (
            <div className="tw"><table>
              <thead><tr>
                <th>{isTeamMode ? "Team" : "Player"}</th><th>Course</th><th>Gross</th>
                {config.useHandicap && <th>Crs Hcp</th>}
                <th>Net</th>
                {config.scoringFormat === "stableford" && <th>Pts</th>}
                {config.attestRequired && <th>Attester</th>}
                <th>Status</th><th>Date</th><th>Card</th><th></th>
              </tr></thead>
              <tbody>{displayRounds.map(r => (
                <tr key={r.id}>
                  <td>
                    {isTeamMode && teamLookup[String(r.team_id)]
                      ? <><span className="pname" style={{ fontSize: ".84rem" }}>{teamLookup[String(r.team_id)]}</span><div style={{ fontSize: ".72rem", color: "var(--cream-dim)" }}>{r.player_name}</div></>
                      : <span className="pname" style={{ fontSize: ".84rem" }}>{r.player_name}</span>}
                  </td>
                  <td style={{ fontSize: ".8rem", color: "var(--cream-dim)" }}>{r.course_name}</td>
                  <td>{r.gross}</td>
                  {config.useHandicap && <td><span className="hcp-badge" style={{ fontSize: ".66rem" }}>{r.course_handicap}</span></td>}
                  <td>{netEl(r.net, r.par)}</td>
                  {config.scoringFormat === "stableford" && <td style={{ color: "var(--purple)" }}>{r.stableford_pts ?? "-"}</td>}
                  {config.attestRequired && <td style={{ fontSize: ".78rem", color: "var(--cream-dim)" }}>{r.attester_name ?? "—"}</td>}
                  <td>{attestBadge(r.attest_status)}</td>
                  <td style={{ fontSize: ".76rem", color: "var(--cream-dim)" }}>{r.date}</td>
                  <td>{r.scorecard_url ? <button className="sc-btn" onClick={() => setViewCardModal({ url: r.scorecard_url })}><FileText size={13} /></button> : <span style={{ color: "#4b5563" }}>—</span>}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                      {config.attestRequired && r.attest_status === "pending" && (<>
                        <button className="btn btn-gold btn-sm" title="Approve" onClick={() => adminApproveRound(r)}><Check size={12} /></button>
                        <button className="btn btn-danger btn-sm" title="Reject" onClick={() => adminRejectRound(r)}><X size={12} /></button>
                      </>)}
                      <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => { setEditRound(r); setEditRoundDraft({ gross: String(r.gross), date: r.date }); }}>✎</button>
                      <button className="btn btn-danger btn-sm" title="Delete" onClick={() => setConfirmDeleteRound(r)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        );
      })()}

      {/* ── EXPORT ── */}
      {adminTab === "export" && (
        <div className="card">
          <div className="card-hdr"><BarChart2 size={15} />Export Data</div>
          <div style={{ marginBottom: 20 }}>
            <div className="cfg-section-title">Google Sheet Integration</div>
            <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 14, lineHeight: 1.6 }}>
              Link your Google Sheet so players can view exported data. Download the CSV below and import via <strong style={{ color: "var(--cream)" }}>File → Import</strong>.
            </p>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label>Google Sheet URL (shown to all members)</label>
              <input type="url" placeholder="https://docs.google.com/spreadsheets/d/..."
                value={configDraft?.googleSheetUrl ?? config.googleSheetUrl ?? ""}
                onChange={e => setConfigDraft(d => ({ ...(d ?? config), googleSheetUrl: e.target.value || null }))} />
            </div>
            {(configDraft?.googleSheetUrl || config.googleSheetUrl) && (
              <a href={configDraft?.googleSheetUrl ?? config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge" style={{ marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 5 }}><BarChart2 size={13} />Open Google Sheet ↗</a>
            )}
            {configDraft && (
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button className="btn btn-gold btn-sm" onClick={() => saveConfig(configDraft)}>Save Sheet URL</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfigDraft(null)}>Cancel</button>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--navy-border)", paddingTop: 16 }}>
            <div className="cfg-section-title">Download CSV</div>
            <p style={{ fontSize: ".86rem", color: "var(--cream-dim)", marginBottom: 14 }}>Download all rounds as a CSV file.</p>
            <button className="btn btn-gold" onClick={exportCSV} disabled={rounds.length === 0}>
              ⬇ Download Rounds CSV ({rounds.length} rounds)
            </button>
          </div>
        </div>
      )}

      {/* ── EMAIL MEMBERS ── */}
      {adminTab === "email" && (
        <div className="card">
          <div className="card-hdr"><Mail size={15} />Email Members</div>
          <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.6 }}>
            Send a message to all {members.length} members in this league. Emails are sent from <strong style={{ color: "var(--cream)" }}>noreply@greeksidebunker.com</strong>.
          </p>
          {(() => {
            const selected = emailSelected ?? members.map(m => m.user_id);
            const allSelected = selected.length === members.length;
            const toggle = (uid) => {
              if (selected.includes(uid)) setEmailSelected(selected.filter(id => id !== uid));
              else setEmailSelected([...selected, uid]);
            };
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="fg">
                  <label>Subject</label>
                  <input
                    type="text"
                    placeholder="e.g. Season starts this Saturday!"
                    value={emailDraft.subject}
                    onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  />
                </div>
                <div className="fg">
                  <label>Message</label>
                  {/* Toolbar */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderBottom: "none", borderRadius: "8px 8px 0 0", padding: "6px 8px" }}>
                    {[
                      { key: "bold", label: "B", cmd: "bold", style: { fontWeight: 700 } },
                      { key: "italic", label: "I", cmd: "italic", style: { fontStyle: "italic" } },
                      { key: "underline", label: "U", cmd: "underline", style: { textDecoration: "underline" } },
                    ].map(({ key, label, cmd, style }) => (
                      <button key={key} type="button"
                        onMouseDown={e => {
                          e.preventDefault();
                          document.execCommand(cmd);
                          const active = document.queryCommandState(cmd);
                          setActiveFormats(f => ({ ...f, [key]: active }));
                          setEmailDraft(d => ({ ...d, message: editorRef.current?.innerHTML ?? "" }));
                        }}
                        style={{ background: activeFormats[key] ? "rgba(212,168,67,.2)" : "rgba(255,255,255,.06)", border: activeFormats[key] ? "1px solid rgba(212,168,67,.5)" : "1px solid rgba(255,255,255,.1)", borderRadius: 4, color: activeFormats[key] ? "var(--gold)" : "var(--cream)", padding: "3px 10px", cursor: "pointer", fontSize: ".85rem", minWidth: 28, textAlign: "center", ...style }}>
                        {label}
                      </button>
                    ))}
                    <div style={{ width: 1, height: 20, background: "rgba(255,255,255,.15)", margin: "0 4px" }} />
                    <button type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        document.execCommand("insertUnorderedList");
                        setEmailDraft(d => ({ ...d, message: editorRef.current?.innerHTML ?? "" }));
                      }}
                      style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 4, color: "var(--cream)", padding: "3px 10px", cursor: "pointer", fontSize: ".82rem" }}>
                      • List
                    </button>
                    <button type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        document.execCommand("insertOrderedList");
                        setEmailDraft(d => ({ ...d, message: editorRef.current?.innerHTML ?? "" }));
                      }}
                      style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 4, color: "var(--cream)", padding: "3px 10px", cursor: "pointer", fontSize: ".82rem" }}>
                      1. List
                    </button>
                    <div style={{ width: 1, height: 20, background: "rgba(255,255,255,.15)", margin: "0 4px" }} />
                    <button type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        const sel = window.getSelection();
                        if (sel?.rangeCount > 0) {
                          setSavedRange(sel.getRangeAt(0).cloneRange());
                          setLinkText(sel.toString());
                        }
                        setLinkUrl("");
                        setLinkModal(true);
                      }}
                      style={{ background: "rgba(212,168,67,.1)", border: "1px solid rgba(212,168,67,.3)", borderRadius: 4, color: "var(--gold)", padding: "3px 10px", cursor: "pointer", fontSize: ".82rem" }}>
                      Link
                    </button>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", borderRadius: "0 0 8px 8px", padding: "10px 12px 10px 28px", color: "var(--cream)", fontFamily: "inherit", fontSize: ".9rem", minHeight: 160, outline: "none", lineHeight: 1.7, overflowWrap: "break-word", wordBreak: "break-word" }}
                    data-placeholder="Type your message here..."
                  />
                </div>


                {linkModal && (
                  <div className="modal-bg" onClick={() => setLinkModal(false)}>
                    <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
                      <div className="modal-title">Insert Link</div>
                      <div className="fg" style={{ marginBottom: 12 }}>
                        <label>Display Text</label>
                        <input type="text" placeholder="Click here" value={linkText}
                          onChange={e => setLinkText(e.target.value)}
                          autoFocus />
                      </div>
                      <div className="fg" style={{ marginBottom: 16 }}>
                        <label>URL</label>
                        <input type="url" placeholder="https://..." value={linkUrl}
                          onChange={e => setLinkUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); insertLink(); } }} />
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button className="btn btn-gold" onClick={insertLink}>Insert</button>
                        <button className="btn btn-ghost" onClick={() => setLinkModal(false)}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="fg">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <label style={{ marginBottom: 0 }}>Recipients ({selected.length} of {members.length})</label>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEmailSelected(allSelected ? [] : members.map(m => m.user_id))}>
                      {allSelected ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", padding: "4px 0" }}>
                    {members.map(m => (
                      <label key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 10px", borderRadius: 6, background: selected.includes(m.user_id) ? "rgba(212,168,67,.08)" : "transparent", border: "1px solid", borderColor: selected.includes(m.user_id) ? "rgba(212,168,67,.25)" : "transparent", transition: "all .15s" }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(m.user_id)}
                          onChange={() => toggle(m.user_id)}
                          style={{ accentColor: "var(--gold)", width: 15, height: 15, flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{m.profile?.name}</div>
                          <div style={{ fontSize: ".72rem", color: "var(--cream-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.profile?.email}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn btn-gold"
                    disabled={emailSending || !emailDraft.subject.trim() || selected.length === 0}
                    onClick={sendLeagueEmail}
                  >
                    {emailSending ? "Sending..." : `Send to ${selected.length} Member${selected.length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={reminderSending || emailSending}
                    onClick={sendRoundReminders}
                    title="Send a round-completion reminder to all members who haven't finished their required rounds"
                  >
                    {reminderSending ? "Sending..." : "Send Round Reminders"}
                  </button>
                  {emailMsg && (
                    <span style={{ fontSize: ".85rem", color: emailMsg.startsWith("✓") ? "var(--green)" : "#f09090" }}>
                      {emailMsg}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── BYLAWS ── */}
      {adminTab === "bylaws" && (
        <div className="card">
          <div className="card-hdr"><FileText size={15} />League Bylaws</div>
          <p style={{ fontSize: ".88rem", color: "var(--cream-dim)", marginBottom: 18, lineHeight: 1.6 }}>
            Upload a PDF of your league bylaws or rules. It will be visible to all members under the <strong style={{ color: "var(--cream)" }}>Rules</strong> tab.
          </p>
          {config.bylawsUrl && (
            <div style={{ background: "rgba(76,175,125,.08)", border: "1px solid rgba(76,175,125,.25)", borderRadius: 8, padding: "14px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontSize: ".62rem", letterSpacing: "2px", color: "#6ee7a0", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 4 }}>Current Bylaws</div>
                <div style={{ fontSize: ".88rem", color: "var(--cream)" }}>{config.bylawsName ?? "bylaws.pdf"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={config.bylawsUrl} target="_blank" rel="noreferrer">
                  <button className="btn btn-ghost btn-sm">View ↗</button>
                </a>
                <button className="btn btn-danger" onClick={async () => {
                  if (!confirmRemoveBylaws) { setConfirmRemoveBylaws(true); setTimeout(() => setConfirmRemoveBylaws(false), 5000); return; }
setConfirmRemoveBylaws(false);
                  const newCfg = { ...config, bylawsUrl: null, bylawsName: null };
                  await supabase.from("league_settings").upsert({ league_id: activeLeague.id, config: newCfg, payouts }, { onConflict: "league_id" });
                  setConfig(newCfg);
                }}>Remove</button>
              </div>
            </div>
          )}
          <div className="fg">
            <label>{config.bylawsUrl ? "Replace Bylaws PDF" : "Upload Bylaws PDF"}</label>
            <div className="upload-zone"
              onClick={() => document.getElementById("bylaws-upload").click()}
              onDragOver={e => e.preventDefault()}
              onDrop={async e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) await uploadBylaws(file); }}>
              <div style={{ marginBottom: 4, color: "var(--cream-dim)" }}><FileText size={22} /></div>
              <div style={{ fontSize: ".85rem", color: "var(--cream-dim)" }}>
                Drop PDF here or <strong style={{ color: "var(--gold)" }}>browse</strong> · PDF only · max 10 MB
              </div>
              <input id="bylaws-upload" type="file" accept="application/pdf" style={{ display: "none" }}
                onChange={async e => { if (e.target.files[0]) await uploadBylaws(e.target.files[0]); }} />
            </div>
          </div>
          {addMsg && <div className="alert-s" style={{ marginTop: 12 }}>{addMsg}</div>}
        </div>
      )}

      {/* ── LEAGUE INFO ── */}
      {adminTab === "league" && (
        <div className="card">
          <div className="card-hdr">League Info</div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: ".7rem", letterSpacing: "2px", color: "var(--gold)", fontFamily: "var(--font-d)", textTransform: "uppercase", marginBottom: 8 }}>Invite Code</div>
            <div className="invite-box">
              <div>
                <div className="invite-code">{activeLeague.invite_code}</div>
                <div style={{ fontSize: ".78rem", color: "var(--cream-dim)", fontStyle: "italic", marginTop: 3 }}>Join mode: <strong>{config.joinMode === "approval" ? "Approval required" : "Open"}</strong></div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(activeLeague.invite_code)}>Copy</button>
            </div>
          </div>
          {config.googleSheetUrl && (
            <div style={{ marginBottom: 16 }}>
              <a href={config.googleSheetUrl} target="_blank" rel="noreferrer" className="gs-badge" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><BarChart2 size={13} />View League Google Sheet ↗</a>
            </div>
          )}
          <div style={{ fontSize: ".88rem", color: "var(--cream-dim)", lineHeight: 2 }}>
            <div>Name: <span style={{ color: "var(--white)" }}>{activeLeague.name}</span></div>
            {activeLeague.description && <div>Description: <span style={{ color: "var(--white)" }}>{activeLeague.description}</span></div>}
            <div>Scoring format: <span style={{ color: "var(--purple)" }}>{config.tournamentMode ? "Tournament" : FORMAT_LABELS[config.scoringFormat]}</span></div>
            <div>Members: <span style={{ color: "var(--white)" }}>{members.length}{config.maxPlayers ? ` / ${config.maxPlayers} max` : ""}</span></div>
            <div>Handicap: <span style={{ color: "var(--white)" }}>{config.useHandicap ? `${config.handicapPct}%${config.useSlopeRating ? " (USGA slope/rating)" : " (flat)"}${config.maxHandicap ? ` · max ${config.maxHandicap}` : ""}` : "Gross only"}</span></div>
            <div>Attestation: <span style={{ color: "var(--white)" }}>{config.attestRequired ? "Required" : "Off"}</span></div>
            <div>Created: <span style={{ color: "var(--white)" }}>{new Date(activeLeague.created_at).toLocaleDateString()}</span></div>
          </div>
        </div>
      )}
    </>
  );
}
