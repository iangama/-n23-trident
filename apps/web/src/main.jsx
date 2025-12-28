import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const LS = {
  token: "n23t_token",
  ws: "n23t_ws"
};

async function api(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers });
  const isJson = (r.headers.get("content-type") || "").includes("application/json");
  const body = isJson ? await r.json().catch(() => ({})) : await r.text().catch(() => "");
  if (!r.ok) throw new Error(body?.error || body || "erro");
  return body;
}

function Badge({ s }) {
  const map = {
    PENDING: ["#243a5a", "#cfe7ff"],
    RUNNING: ["#4a3a14", "#ffe7b5"],
    VERIFIED:["#163a2a", "#bfffe0"],
    REJECTED:["#3a1616", "#ffd0d0"]
  };
  const [bg, fg] = map[s] || map.PENDING;
  return <span style={{ padding:"4px 9px", borderRadius:999, background:bg, color:fg, border:"1px solid #22304a", fontSize:12 }}>{s}</span>;
}

function Card({ children }) {
  return <div style={{ background:"#0f1624", border:"1px solid #22304a", borderRadius:14, padding:16 }}>{children}</div>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(LS.token) || "");
  const [me, setMe] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [wsId, setWsId] = useState(Number(localStorage.getItem(LS.ws) || 0) || 0);

  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState(0);

  const [email, setEmail] = useState("demo@n23t.com");
  const [password, setPassword] = useState("demo1234");

  const [newWsName, setNewWsName] = useState("");
  const [newClaim, setNewClaim] = useState("");

  const [evSource, setEvSource] = useState("");
  const [evExcerpt, setEvExcerpt] = useState("");

  const [err, setErr] = useState("");

  async function refresh() {
    if (!token) return;
    setErr("");
    const meData = await api("/api/me", {}, token);
    setMe(meData);
    const wss = await api("/api/workspaces", {}, token);
    setWorkspaces(wss);

    const chosen = wsId || (wss[0]?.id || 0);
    if (chosen && chosen !== wsId) {
      setWsId(chosen);
      localStorage.setItem(LS.ws, String(chosen));
    }
    if (chosen) {
      const cls = await api(`/api/workspaces/${chosen}/claims`, {}, token);
      setClaims(cls);
      const first = cls[0]?.id || 0;
      if (!selectedClaimId && first) setSelectedClaimId(first);
      if (selectedClaimId && !cls.find(c => c.id === selectedClaimId) && first) setSelectedClaimId(first);
    }
  }

  useEffect(() => { refresh().catch(e => setErr(e.message)); }, [token]);
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [token, wsId, selectedClaimId]);

  const selectedClaim = useMemo(() => claims.find(c => c.id === selectedClaimId), [claims, selectedClaimId]);

  async function doLogin() {
    try {
      setErr("");
      const out = await api("/api/login", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem(LS.token, out.token);
      setToken(out.token);
    } catch (e) { setErr(e.message); }
  }

  async function doRegister() {
    try {
      setErr("");
      const out = await api("/api/register", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ email, password, workspaceName: "Default" })
      });
      localStorage.setItem(LS.token, out.token);
      setToken(out.token);
    } catch (e) { setErr(e.message); }
  }

  async function doSeed() {
    try {
      setErr("");
      const out = await api("/api/dev/seed", { method:"POST" });
      // seed reseta DB e cria demo; força login com credenciais padrão
      setEmail(out.email); setPassword(out.password);
      await doLogin();
    } catch (e) { setErr(e.message); }
  }

  async function createWs() {
    try {
      setErr("");
      const ws = await api("/api/workspaces", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ name: newWsName })
      }, token);
      setNewWsName("");
      setWsId(ws.id);
      localStorage.setItem(LS.ws, String(ws.id));
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function createClaim() {
    try {
      setErr("");
      await api(`/api/workspaces/${wsId}/claims`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ text: newClaim })
      }, token);
      setNewClaim("");
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function addEvidenceText() {
    try {
      setErr("");
      if (!selectedClaimId) return;
      await api(`/api/claims/${selectedClaimId}/evidence`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ source: evSource, excerpt: evExcerpt })
      }, token);
      setEvSource(""); setEvExcerpt("");
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function uploadPdf(file) {
    try {
      setErr("");
      if (!selectedClaimId) return;
      const fd = new FormData();
      fd.append("file", file);
      await api(`/api/claims/${selectedClaimId}/evidence/pdf`, { method:"POST", body: fd }, token);
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function verifyEvidence(id) {
    try {
      setErr("");
      await api(`/api/evidence/${id}/verify`, { method:"POST" }, token);
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function delEvidence(id) {
    try {
      setErr("");
      await api(`/api/evidence/${id}`, { method:"DELETE" }, token);
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  function logout() {
    localStorage.removeItem(LS.token);
    setToken("");
    setMe(null);
    setClaims([]);
    setWorkspaces([]);
    setWsId(0);
    setSelectedClaimId(0);
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0b0f17", color:"#e6edf3", fontFamily:"system-ui" }}>
      <div style={{ maxWidth: 1150, margin:"0 auto", padding: 24 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>N23.3 — TRIDENT</div>
            <div style={{ opacity: .7, fontSize: 12 }}>auth + workspaces + pdf pipeline + metrics + prometheus/grafana</div>
          </div>
          <div style={{ display:"flex", gap: 8, alignItems:"center" }}>
            <a href="/metrics" style={{ color:"#9ad", fontSize:12 }}>metrics</a>
            <a href="/prom" style={{ color:"#9ad", fontSize:12 }}>prom</a>
            <a href="/graf" style={{ color:"#9ad", fontSize:12 }}>graf</a>
          </div>
        </div>

        {err ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border:"1px solid #ff5a5a55", background:"#ff5a5a12" }}>
            {err}
          </div>
        ) : null}

        {!token ? (
          <div style={{ marginTop: 16, display:"grid", gridTemplateColumns:"1fr 1fr", gap: 16 }}>
            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Login</div>
              <div style={{ display:"flex", flexDirection:"column", gap: 8 }}>
                <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email"
                  style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="password" type="password"
                  style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                <div style={{ display:"flex", gap: 8 }}>
                  <button onClick={doLogin}
                    style={{ flex:1, padding:"10px 12px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                    Login
                  </button>
                  <button onClick={doRegister}
                    style={{ flex:1, padding:"10px 12px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                    Register
                  </button>
                </div>
                <button onClick={doSeed}
                  style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #355b2b", background:"#132a15", color:"#c9ffd2", cursor:"pointer" }}>
                  Reset + Seed demo
                </button>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>O que tem aqui</div>
              <div style={{ opacity:.8, fontSize: 14, lineHeight: 1.5 }}>
                Multi-tenant (workspaces), JWT, claims isolados por workspace, evidências em texto ou PDF, pipeline async com worker e status,
                e observabilidade com /metrics + Prometheus + Grafana.
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ marginTop: 16, display:"grid", gridTemplateColumns:"1fr 2fr", gap: 16 }}>
            <Card>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontWeight:700 }}>Workspaces</div>
                <button onClick={logout} style={{ padding:"6px 10px", borderRadius:10, border:"1px solid #3a2b2b", background:"#2a1414", color:"#ffd3d3", cursor:"pointer" }}>
                  Logout
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: .7 }}>{me?.email}</div>

              <div style={{ marginTop: 12, display:"flex", gap: 8 }}>
                <input value={newWsName} onChange={e=>setNewWsName(e.target.value)} placeholder="novo workspace"
                  style={{ flex:1, padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                <button onClick={createWs}
                  style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                  Add
                </button>
              </div>

              <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap: 8 }}>
                {workspaces.map(w => (
                  <button key={w.id} onClick={() => { setWsId(w.id); localStorage.setItem(LS.ws, String(w.id)); }}
                    style={{
                      textAlign:"left",
                      padding:"10px 12px",
                      borderRadius:12,
                      border:"1px solid #22304a",
                      background: w.id===wsId ? "#172846" : "#0b1220",
                      color:"#e6edf3",
                      cursor:"pointer"
                    }}>
                    <div style={{ fontSize:12, opacity:.7 }}>#{w.id}</div>
                    <div style={{ fontSize:14 }}>{w.name}</div>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight:700 }}>Claims</div>
                  <div style={{ fontSize:12, opacity:.7 }}>workspace #{wsId}</div>
                </div>
                <div style={{ display:"flex", gap: 8 }}>
                  <input value={newClaim} onChange={e=>setNewClaim(e.target.value)} placeholder="novo claim"
                    style={{ width: 360, padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                  <button onClick={createClaim}
                    style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                    Add
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12, display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12 }}>
                <div style={{ display:"flex", flexDirection:"column", gap: 8 }}>
                  {claims.map(c => (
                    <button key={c.id} onClick={() => setSelectedClaimId(c.id)}
                      style={{
                        textAlign:"left",
                        padding:"10px 12px",
                        borderRadius:12,
                        border:"1px solid #22304a",
                        background: c.id===selectedClaimId ? "#172846" : "#0b1220",
                        color:"#e6edf3",
                        cursor:"pointer"
                      }}>
                      <div style={{ fontSize:12, opacity:.7 }}>#{c.id} · evidences {c.evidences?.length || 0}</div>
                      <div style={{ fontSize:14 }}>{c.text}</div>
                    </button>
                  ))}
                </div>

                <div>
                  {selectedClaim ? (
                    <>
                      <div style={{ padding: 12, borderRadius: 12, background:"#0b1220", border:"1px solid #22304a" }}>
                        <div style={{ fontSize: 12, opacity:.7 }}>Claim #{selectedClaim.id}</div>
                        <div style={{ fontSize: 16, marginTop: 6 }}>{selectedClaim.text}</div>
                      </div>

                      <div style={{ marginTop: 10, display:"grid", gridTemplateColumns:"1fr 1fr 120px", gap: 8 }}>
                        <input value={evSource} onChange={e=>setEvSource(e.target.value)} placeholder="source"
                          style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                        <input value={evExcerpt} onChange={e=>setEvExcerpt(e.target.value)} placeholder="excerpt"
                          style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #22304a", background:"#0b1220", color:"#e6edf3" }} />
                        <button onClick={addEvidenceText}
                          style={{ padding:"10px 12px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                          Add
                        </button>
                      </div>

                      <div style={{ marginTop: 10, display:"flex", gap: 8, alignItems:"center" }}>
                        <input type="file" accept="application/pdf"
                          onChange={(e)=>{ const f=e.target.files?.[0]; if(f) uploadPdf(f); e.target.value=""; }}
                          style={{ flex:1, padding:"10px 12px", borderRadius:10, border:"1px dashed #22304a", background:"#0b1220", color:"#e6edf3" }} />
                        <div style={{ fontSize:12, opacity:.7 }}>upload pdf → auto verify</div>
                      </div>

                      <div style={{ marginTop: 12, display:"flex", flexDirection:"column", gap: 10 }}>
                        {(selectedClaim.evidences || []).map(ev => (
                          <div key={ev.id} style={{ padding: 12, borderRadius: 12, background:"#0b1220", border:"1px solid #22304a" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap: 12 }}>
                              <div style={{ display:"flex", gap: 10, alignItems:"center" }}>
                                <div style={{ fontSize:12, opacity:.7 }}>#{ev.id}</div>
                                <Badge s={ev.status} />
                                <div style={{ fontSize:12, opacity:.7 }}>score {ev.score}</div>
                              </div>
                              <div style={{ display:"flex", gap: 8 }}>
                                <button onClick={()=>verifyEvidence(ev.id)}
                                  style={{ padding:"6px 10px", borderRadius:10, border:"1px solid #2b3b5c", background:"#15213a", color:"#e6edf3", cursor:"pointer" }}>
                                  Verify
                                </button>
                                <button onClick={()=>delEvidence(ev.id)}
                                  style={{ padding:"6px 10px", borderRadius:10, border:"1px solid #3a2b2b", background:"#2a1414", color:"#ffd3d3", cursor:"pointer" }}>
                                  Delete
                                </button>
                              </div>
                            </div>
                            {ev.reason ? <div style={{ marginTop:6, fontSize:12, opacity:.75 }}>reason: {ev.reason}</div> : null}
                            <div style={{ marginTop: 8, fontSize:13, opacity:.85 }}>{ev.source}{ev.filePath ? ` · file: ${ev.filePath}` : ""}</div>
                            <div style={{ marginTop: 6, fontSize:14 }}>{ev.excerpt}</div>
                          </div>
                        ))}
                        {(!selectedClaim.evidences || selectedClaim.evidences.length === 0) ? (
                          <div style={{ opacity:.7, fontSize: 13 }}>sem evidências ainda</div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div style={{ opacity:.7 }}>crie um claim</div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
