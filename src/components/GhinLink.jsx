const ghinUrl = () => `https://www.ghin.com/golfer-lookup/all-golfers`;

export default function GhinLink({ ghin, style }) {
  if (!ghin) return null;
  const handleClick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(String(ghin)).catch(() => {});
    window.open(ghinUrl(), "_blank", "noreferrer");
  };
  return (
    <a href={ghinUrl()} onClick={handleClick} className="ghin-link" style={style} title={`Copy GHIN # ${ghin} and open lookup`}>
      🔗 GHIN ↗
    </a>
  );
}
