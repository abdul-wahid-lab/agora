// Pure presentation - renders a peaks array (0..1) as a bar chart, same
// visual language as the design reference's voice-message screens (9.1's
// live recording meter, 9.2/9.3's static playback waveform). `progress`
// (0..1, optional) splits the bars into an "already played" color and a
// "remaining" color, matching the two-tone look a sent/received bubble
// both use once playback starts.
export default function WaveformBars({ peaks, progress, height = 26, barColor, playedColor, gap = 2.5 }) {
  // minWidth: 0 lets this actually shrink inside a tight flex parent (a
  // narrow window, a small voice-note bubble) the way flex: 1 alone
  // doesn't; overflow: hidden is the real fix for what minWidth: 0 alone
  // can't solve, since the bars themselves have a genuine fixed minimum
  // total width (peaks.length * (3px + gap)) that can still exceed a
  // truly narrow container - found live, this was quietly contributing to
  // a page-wide horizontal scrollbar rather than just clipping its own
  // row the way a bar chart safely can.
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", alignItems: "center", gap, height }}>
      {peaks.map((p, i) => {
        const played = progress != null && i / peaks.length <= progress;
        const barHeight = Math.max(3, Math.round(p * height));
        return <div key={i} style={{ width: 3, height: barHeight, borderRadius: 2, background: played && playedColor ? playedColor : barColor, flexShrink: 0 }} />;
      })}
    </div>
  );
}
