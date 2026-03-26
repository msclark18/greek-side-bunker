export default function SeasonBar({ config }) {
  if (!config.seasonStart && !config.seasonEnd) return null;
  const now = new Date();
  const s = config.seasonStart ? new Date(config.seasonStart + "T00:00:00") : null;
  const e = config.seasonEnd ? new Date(config.seasonEnd + "T00:00:00") : null;
  if (s && s > now) return <div className="season-bar upcoming">Season opens {s.toLocaleDateString()}</div>;
  if (e && e < now) return <div className="season-bar inactive">Season ended {e.toLocaleDateString()} — submissions closed</div>;
  return <div className="season-bar active">Season active{e ? ` · ends ${e.toLocaleDateString()}` : ""}</div>;
}
