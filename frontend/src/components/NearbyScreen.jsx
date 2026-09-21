import { useEffect, useState } from "react";
import { api, connectEvents } from "../api";
import { colorFor, initials } from "../lib/avatar";

export default function NearbyScreen({ me }) {
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const list = await api.peers();
        if (!cancelled) {
          setPeers(list);
          setLoading(false);
        }
      } catch {
        // backend not reachable yet (e.g. still starting) - keep retrying silently
      }
    }

    poll();
    const interval = setInterval(poll, 1500);
    const stopEvents = connectEvents((evt) => {
      if (evt.type === "peer_joined" || evt.type === "peer_left") poll();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      stopEvents();
    };
  }, []);

  return (
    <div style={{ flex: 1, padding: "28px 36px", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 className="serif" style={{ fontSize: 34, margin: 0 }}>
          Nearby
        </h1>
        {me && (
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
            you are {me.device_name} · peer_id {me.peer_id.slice(0, 8)}
          </span>
        )}
      </div>

      {loading && (
        <p style={{ color: "var(--text-2)" }}>Scanning for people nearby&hellip;</p>
      )}

      {!loading && peers.length === 0 && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 20,
            padding: 40,
            textAlign: "center",
            maxWidth: 420,
          }}
        >
          <h3 style={{ margin: "0 0 8px" }}>No one else is on this network yet</h3>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: 14 }}>
            Agora keeps listening — anyone who joins this network will appear here on their own.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
        {peers.map((p) => (
          <div
            key={p.peer_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "12px 16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
            }}
          >
            <span
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: colorFor(p.peer_id),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 600,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {initials(p.name)}
              <span
                style={{
                  position: "absolute",
                  right: -1,
                  bottom: -1,
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  border: "2px solid var(--surface)",
                }}
              />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                {p.address}:{p.port} · via {p.source}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
