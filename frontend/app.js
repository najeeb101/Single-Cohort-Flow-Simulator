"use strict";

const SVGNS = "http://www.w3.org/2000/svg";
const STAGE_COLORS = {
  Admitted: "#6b7488", Year1: "#4878d0", Year2: "#5aa9e6", Year3: "#6acc65",
  Year4: "#e8b84b", Graduated: "#3ec46d", Dropped: "#d65f5f", Censored: "#b47cc7",
};

let DATA = null;
let frames = [];
let nodePositions = {};
let nodeEls = {};
let idx = 0;
let playing = false;
let timer = null;

// ---------------------------------------------------------------- //
// Load — served from the repo root (py -m http.server); fetches     //
// straight from outputs/, no copies into frontend/ needed.          //
// ---------------------------------------------------------------- //
fetch("../outputs/reports/flow_timeline.json")
  .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
  .then(boot)
  .catch(() => document.getElementById("loaderr").classList.remove("hidden"));

function boot(data) {
  DATA = data;
  frames = data.frames || [];
  document.getElementById("app").classList.remove("hidden");
  renderMetaLine();
  renderInputs();
  buildGraph();
  buildCohortSelector();
  wireControls();
  renderRecommendation();
  renderHeadline();
  renderCohortsTable();
  renderBottlenecks();
  renderFigures();
  render();
  // Start at the first study term (term 0) so the story begins when cohort 0 enters,
  // then auto-play.
  idx = Math.max(0, frames.findIndex((f) => f.term === 0));
  render();
  togglePlay();
}

function wireControls() {
  const scrub = document.getElementById("scrub");
  scrub.max = String(frames.length - 1);
  scrub.addEventListener("input", () => { idx = +scrub.value; render(); });
  document.getElementById("playBtn").addEventListener("click", togglePlay);
  document.getElementById("stepFwdBtn").addEventListener("click", () => step(1));
  document.getElementById("stepBackBtn").addEventListener("click", () => step(-1));
  document.getElementById("speed").addEventListener("change", () => { if (playing) startTimer(); });
  document.getElementById("cohortSel").addEventListener("change", render);
}

// ---------------------------------------------------------------- //
// Inputs / meta                                                     //
// ---------------------------------------------------------------- //
function renderMetaLine() {
  const m = DATA.meta;
  document.getElementById("meta-line").textContent =
    `${m.num_cohorts} study cohorts + ${m.num_incumbent_cohorts} incumbent · ` +
    `${m.cohort_size} students each · shared seats · seed ${m.seed}`;
}

function renderInputs() {
  const m = DATA.meta;
  const chips = [
    ["Study cohorts", m.num_cohorts],
    ["Incumbent cohorts", m.num_incumbent_cohorts],
    ["Cohort size", m.cohort_size],
    ["Max semesters", m.max_terms],
    ["Seats / section", m.seats_per_section],
    ["Courses", m.graph.nodes.length],
    ["Prerequisite links", m.graph.edges.length],
    ["Seed", m.seed],
  ];
  document.getElementById("inputs").innerHTML = chips
    .map(([k, v]) => `<div class="chip">${k}: <b>${v}</b></div>`)
    .join("");
}

// ---------------------------------------------------------------- //
// Graph layout (longest-path layering, dependency-free SVG)         //
// ---------------------------------------------------------------- //
function buildGraph() {
  const g = DATA.meta.graph;
  const nodes = g.nodes, edges = g.edges;
  const prereqs = {};
  nodes.forEach((n) => (prereqs[n.code] = []));
  edges.forEach((e) => { if (prereqs[e.to]) prereqs[e.to].push(e.from); });

  const layerCache = {};
  function layer(code, seen) {
    if (code in layerCache) return layerCache[code];
    seen = seen || new Set();
    if (seen.has(code)) return 0;
    seen.add(code);
    const ps = prereqs[code] || [];
    const l = ps.length ? 1 + Math.max(...ps.map((p) => layer(p, seen))) : 0;
    layerCache[code] = l;
    return l;
  }
  nodes.forEach((n) => layer(n.code));

  const byLayer = {};
  nodes.forEach((n) => { (byLayer[layerCache[n.code]] ||= []).push(n); });
  const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

  const NW = 132, NH = 48, HGAP = 70, VGAP = 16, MX = 24, MY = 24;
  let maxRows = 0;
  layers.forEach((l) => {
    byLayer[l].sort((a, b) => (a.study_plan_order - b.study_plan_order) || a.code.localeCompare(b.code));
    maxRows = Math.max(maxRows, byLayer[l].length);
  });
  const width = MX * 2 + layers.length * NW + (layers.length - 1) * HGAP;
  const height = MY * 2 + maxRows * NH + (maxRows - 1) * VGAP;

  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const defs = document.createElementNS(SVGNS, "defs");
  defs.innerHTML =
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
       <path d="M0,0 L10,5 L0,10 z" fill="#56607a"/></marker>`;
  svg.appendChild(defs);

  layers.forEach((l, ci) => {
    const col = byLayer[l];
    const colH = col.length * NH + (col.length - 1) * VGAP;
    const y0 = MY + (height - MY * 2 - colH) / 2;
    col.forEach((n, ri) => {
      nodePositions[n.code] = { x: MX + ci * (NW + HGAP), y: y0 + ri * (NH + VGAP), w: NW, h: NH };
    });
  });

  edges.forEach((e) => {
    const a = nodePositions[e.from], b = nodePositions[e.to];
    if (!a || !b) return;
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", "edge" + (e.kind === "one_of" ? " one_of" : ""));
    path.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(path);
  });

  nodes.forEach((n) => {
    const p = nodePositions[n.code];
    const grp = document.createElementNS(SVGNS, "g");
    grp.setAttribute("class", "node");
    grp.setAttribute("transform", `translate(${p.x},${p.y})`);
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("width", p.w); rect.setAttribute("height", p.h);
    rect.setAttribute("rx", 7); rect.setAttribute("fill", "#d9d9d9");
    grp.appendChild(rect);
    const code = document.createElementNS(SVGNS, "text");
    code.setAttribute("class", "code"); code.setAttribute("x", 8); code.setAttribute("y", 17);
    code.textContent = n.code; grp.appendChild(code);
    const stat = document.createElementNS(SVGNS, "text");
    stat.setAttribute("class", "stat"); stat.setAttribute("x", 8); stat.setAttribute("y", 33);
    grp.appendChild(stat);
    const stat2 = document.createElementNS(SVGNS, "text");
    stat2.setAttribute("class", "stat"); stat2.setAttribute("x", 8); stat2.setAttribute("y", 44);
    grp.appendChild(stat2);
    const title = document.createElementNS(SVGNS, "title");
    title.textContent = `${n.code} — ${n.title}\n${n.credits} CH · ${n.category} · ${n.offering.join("+")}`;
    grp.appendChild(title);
    svg.appendChild(grp);
    nodeEls[n.code] = { group: grp, rect, stat, stat2 };
  });

  const wrap = document.getElementById("graph");
  wrap.innerHTML = ""; wrap.appendChild(svg);
}

function utilColor(u) {
  if (u <= 0) return "#9fd89f";
  if (u >= 1) return "#e2553b";
  const stops = [[0, [159, 216, 159]], [0.6, [242, 193, 78]], [1, [226, 85, 59]]];
  for (let i = 1; i < stops.length; i++) {
    if (u <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (u - t0) / (t1 - t0);
      const c = c0.map((v, k) => Math.round(v + f * (c1[k] - v)));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "#e2553b";
}

// ---------------------------------------------------------------- //
// Render a frame                                                    //
// ---------------------------------------------------------------- //
function render() {
  const f = frames[idx];
  if (!f) return;
  document.getElementById("scrub").value = String(idx);
  const lbl = f.term < 0 ? `Warm-up · ${f.season} (t=${f.term})` : `${f.label} (t=${f.term})`;
  document.getElementById("termLabel").textContent = lbl;

  for (const code in nodeEls) {
    const el = nodeEls[code], st = f.courses[code];
    if (!st || !st.offered) {
      el.rect.setAttribute("fill", "#d9d9d9");
      el.group.setAttribute("class", "node notoffered");
      el.stat.textContent = "not offered"; el.stat2.textContent = "";
      continue;
    }
    const util = st.capacity ? st.granted / st.capacity : 0;
    el.rect.setAttribute("fill", utilColor(util));
    el.group.setAttribute("class", "node" + (st.full ? " full" : ""));
    el.stat.textContent = `${st.granted}/${st.capacity}` +
      (st.sections ? ` · ${st.sections} sec` : "") + (st.full ? " ▣" : "");
    const waiting = (st.prereq_waiting || 0) + (st.offering_blocked || 0);
    el.stat2.textContent =
      (st.denied ? `−${st.denied} denied  ` : "") +
      (st.passed || st.failed ? `✓${st.passed} ✗${st.failed}` : (waiting ? `${waiting} waiting` : ""));
  }

  renderStages(f);
  renderFlows(f);
  renderNarrative(f, frames[idx + 1]);
}

function currentCohortKey() { return document.getElementById("cohortSel").value; }

function aggFlows(frame) {
  const agg = {};
  Object.values(frame.stages.cohorts).forEach((c) =>
    (c.flows || []).forEach((fl) => {
      const k = fl.from + "→" + fl.to;
      agg[k] = (agg[k] || 0) + fl.count;
    }));
  return agg;
}

function renderStages(f) {
  const key = currentCohortKey();
  const block = key === "totals" ? f.stages.totals
    : (f.stages.cohorts[key] || { nodes: {}, seats_requested: 0, seats_denied: 0 });
  const nodes = block.nodes || {};
  const order = DATA.meta.stage_nodes;
  const max = Math.max(1, ...order.map((n) => nodes[n] || 0));
  const host = document.getElementById("stages");
  host.innerHTML = "";
  order.forEach((name) => {
    const v = nodes[name] || 0;
    const row = document.createElement("div");
    row.className = "stage-row";
    row.innerHTML =
      `<span class="name">${name}</span>
       <span class="bar"><span style="width:${(v / max) * 100}%;background:${STAGE_COLORS[name]}"></span></span>
       <span class="val">${v}</span>`;
    host.appendChild(row);
  });
  document.getElementById("seatline").innerHTML =
    `Seats this term — requested <b>${block.seats_requested || 0}</b>, ` +
    `denied <b style="color:#e2553b">${block.seats_denied || 0}</b>`;
}

function renderFlows(f) {
  const key = currentCohortKey();
  let flows;
  if (key === "totals") {
    flows = Object.entries(aggFlows(f)).map(([k, count]) => {
      const [from, to] = k.split("→"); return { from, to, count };
    });
  } else flows = (f.stages.cohorts[key] || {}).flows || [];
  flows.sort((a, b) => b.count - a.count);
  const ul = document.getElementById("flows");
  ul.innerHTML = "";
  flows.slice(0, 6).forEach((fl) => {
    const li = document.createElement("li");
    li.innerHTML = `${fl.from} → ${fl.to} <span class="cnt">${fl.count}</span>`;
    ul.appendChild(li);
  });
  if (!flows.length) ul.innerHTML = "<li class='hint'>no movement</li>";
}

// ---------------------------------------------------------------- //
// Per-semester narrative                                            //
// ---------------------------------------------------------------- //
function renderNarrative(f, nf) {
  const now = [];
  const flows = aggFlows(f);
  const get = (k) => flows[k] || 0;

  const entered = get("Admitted→Year1");
  if (entered > 0) now.push(`<span class="em">A new cohort of ${entered} freshmen enrolled.</span>`);

  // seat pressure
  const denied = Object.entries(f.courses)
    .filter(([, s]) => s.offered && s.denied > 0)
    .sort((a, b) => b[1].denied - a[1].denied).slice(0, 3);
  if (denied.length) {
    now.push(`Seats ran out in <span class="bad">` +
      denied.map(([c, s]) => `${c} (−${s.denied})`).join(", ") + `</span>.`);
  }

  // advancement
  const adv = get("Year1→Year2") + get("Year2→Year3") + get("Year3→Year4");
  if (adv > 0) now.push(`${adv} students advanced to a higher year.`);

  const grad = Object.keys(flows).filter((k) => k.endsWith("→Graduated"))
    .reduce((s, k) => s + flows[k], 0);
  if (grad > 0) now.push(`<span class="good">${grad} students graduated.</span>`);

  const dropped = Object.keys(flows).filter((k) => k.endsWith("→Dropped"))
    .reduce((s, k) => s + flows[k], 0);
  if (dropped > 0) now.push(`<span class="bad">${dropped} dropped out</span> (academic).`);

  const cens = Object.keys(flows).filter((k) => k.endsWith("→Censored"))
    .reduce((s, k) => s + flows[k], 0);
  if (cens > 0) now.push(`<span class="bad">${cens} ran out of time</span> (hit the 12-semester limit).`);

  // course outcomes
  const totPass = Object.values(f.courses).reduce((s, c) => s + (c.passed || 0), 0);
  const totFail = Object.values(f.courses).reduce((s, c) => s + (c.failed || 0), 0);
  if (totPass + totFail > 0) now.push(`Course results: ${totPass} passes, ${totFail} fails.`);

  if (!now.length) now.push("Quiet term — students continuing their courses.");

  // NEXT semester preview
  const next = [];
  if (nf) {
    next.push(`<b>${nf.term < 0 ? "Warm-up · " + nf.season : nf.label}</b> begins.`);
    // offering changes
    const opening = [], closing = [];
    for (const code in nf.courses) {
      const a = f.courses[code], b = nf.courses[code];
      if (a && b) {
        if (!a.offered && b.offered) opening.push(code);
        if (a.offered && !b.offered) closing.push(code);
      }
    }
    if (opening.length) next.push(`<span class="em">Opens:</span> ${opening.slice(0, 6).join(", ")}.`);
    if (closing.length) next.push(`Closes (off-season): ${closing.slice(0, 6).join(", ")}.`);
    const nextEntrants = aggFlows(nf)["Admitted→Year1"] || 0;
    if (nextEntrants > 0) next.push(`<span class="em">A new cohort will enrol.</span>`);
    // courses likely to be contested next term: those waiting now
    const waiting = Object.entries(f.courses)
      .filter(([, s]) => (s.prereq_waiting || 0) > 0)
      .sort((a, b) => b[1].prereq_waiting - a[1].prereq_waiting).slice(0, 2);
    if (waiting.length) {
      next.push(`Students are queued behind prerequisites for ` +
        waiting.map(([c, s]) => `${c} (${s.prereq_waiting})`).join(", ") + `.`);
    }
  } else {
    next.push("End of the simulation horizon — see the dashboard below for final outcomes.");
  }

  document.getElementById("narrNow").innerHTML = now.map((s) => `<li>${s}</li>`).join("");
  document.getElementById("narrNext").innerHTML = next.map((s) => `<li>${s}</li>`).join("");
}

// ---------------------------------------------------------------- //
// Playback                                                          //
// ---------------------------------------------------------------- //
function step(d) { idx = Math.max(0, Math.min(frames.length - 1, idx + d)); render(); }
function togglePlay() {
  playing = !playing;
  document.getElementById("playBtn").textContent = playing ? "⏸ Pause" : "▶ Play";
  if (playing) { if (idx >= frames.length - 1) idx = 0; startTimer(); }
  else clearInterval(timer);
}
function startTimer() {
  clearInterval(timer);
  const ms = +document.getElementById("speed").value;
  timer = setInterval(() => {
    if (idx >= frames.length - 1) { togglePlay(); return; }
    step(1);
  }, ms);
}

// ---------------------------------------------------------------- //
// Cohort selector                                                   //
// ---------------------------------------------------------------- //
function buildCohortSelector() {
  const sel = document.getElementById("cohortSel");
  sel.innerHTML = `<option value="totals">University total</option>`;
  (DATA.meta.cohorts || []).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = (c.is_incumbent ? "Incumbent " : "Cohort ") + c.id + ` (enters t=${c.entry_term})`;
    sel.appendChild(opt);
  });
}

// ---------------------------------------------------------------- //
// Inline report sections                                            //
// ---------------------------------------------------------------- //
function pct(x) { return (x * 100).toFixed(1) + "%"; }

function renderRecommendation() {
  const rec = (DATA.summary || {}).admissions_recommendation || {};
  const host = document.getElementById("rec");
  if (!rec.recommended_intake) { host.innerHTML = "<span class='hint'>No recommendation.</span>"; return; }
  const crit = (rec.criteria || []).map((c) =>
    `<tr><td>${c.name}</td><td>${c.observed}</td><td>${c.target}</td>
     <td>${typeof c.slack === "number" ? c.slack.toFixed(2) : c.slack}</td></tr>`).join("");
  host.innerHTML =
    `<div class="big">Admit ${rec.recommended_intake} students / year
       <span style="font-size:14px;color:#9aa7bd">(current ${rec.current_intake})</span></div>
     <div class="note">Binding criterion: <b style="color:#e8edf5">${rec.binding_criterion}</b>
       (slack ${rec.binding_slack}). ${rec.note}</div>
     <table><tr><th>Health criterion</th><th>Observed</th><th>Target</th><th>Slack</th></tr>${crit}</table>`;
}

function renderHeadline() {
  const h = (DATA.summary || {}).headline || {};
  const ci = h.confidence_intervals || {};
  if (ci.graduation_rate) document.getElementById("mcNote").textContent =
    `(Monte Carlo, ${ci.graduation_rate.n_runs} seeds — 95% CI shown)`;
  const kpis = [
    ["Graduation rate", pct(h.graduation_rate || 0), ci.graduation_rate, true],
    ["Avg time to degree", (h.avg_graduation_time || 0).toFixed(1) + " sem", ci.avg_graduation_time, false],
    ["On-time (≤8 sem)", pct(h.on_time_rate || 0), ci.on_time_rate, true],
    ["Academic dropout", pct(h.academic_dropout_rate || 0), ci.academic_dropout_rate, true],
    ["Censored", pct(h.censored_rate || 0), ci.censored_rate, true],
    ["Probation (ever)", pct(h.probation_rate || 0), ci.probation_rate, true],
    ["Mean GPA at grad", (h.mean_gpa_at_graduation || 0).toFixed(2), ci.mean_gpa_at_graduation, false],
  ];
  document.getElementById("headline").innerHTML = kpis.map(([label, val, c, isPct]) => {
    let ciTxt = "";
    if (c) ciTxt = isPct ? `95% CI ${pct(c.ci_low)}–${pct(c.ci_high)}`
                         : `95% CI ${c.ci_low.toFixed(1)}–${c.ci_high.toFixed(1)}`;
    return `<div class="kpi"><div class="label">${label}</div>
      <div class="value">${val}</div><div class="ci">${ciTxt}</div></div>`;
  }).join("");
}

function renderCohortsTable() {
  const cohorts = (DATA.summary || {}).per_cohort || [];
  const rows = cohorts.map((c) =>
    `<tr class="${c.is_incumbent ? "incumbent" : ""}">
      <td>${c.is_incumbent ? "inc " : ""}${c.cohort_id}</td>
      <td>${c.n}</td><td>${pct(c.graduation_rate)}</td>
      <td>${pct(c.academic_dropout_rate)}</td><td>${pct(c.censored_rate)}</td>
      <td>${c.avg_time_to_degree.toFixed(1)}</td>
      <td>${c.top_capacity_block || "—"}</td><td>${c.top_prereq_block || "—"}</td>
      <td>${c.top_fail || "—"}</td>
    </tr>`).join("");
  document.getElementById("cohortsTable").innerHTML =
    `<table><tr><th>Cohort</th><th>n</th><th>Grad</th><th>Dropout</th><th>Censored</th>
      <th>Avg sem</th><th>Top seat-block</th><th>Top prereq-block</th><th>Top fail</th></tr>${rows}</table>`;
}

function renderBottlenecks() {
  const b = (DATA.summary || {}).top_bottlenecks || {};
  const cards = [
    ["Failures", b.fail], ["Capacity blocks", b.capacity],
    ["Offering blocks", b.offering], ["Prerequisite blocks", b.prereq],
  ];
  document.getElementById("bottlenecks").innerHTML = cards.map(([title, list]) => {
    const items = (list || []).map(([code, n]) => `<li>${code} <span class="hint">(${n})</span></li>`).join("");
    return `<div class="bn-card"><h4>${title}</h4><ol>${items || "<li class='hint'>none</li>"}</ol></div>`;
  }).join("");
}

function renderFigures() {
  const scenario = DATA.meta.scenario || "A_baseline";
  const figs = [
    ["university_enrollment.png", "University population over time (build-up to steady state)"],
    ["cohort_flow.png", "Per-cohort head-count — later cohorts progress slower"],
    ["utilization_heatmap.png", "Seat utilization by course × semester"],
    ["graduation_histogram.png", "Time-to-graduate distribution"],
    [`bottlenecks_${scenario}.png`, "Bottleneck signals: fail / capacity / offering / prereq"],
    ["curriculum_network.png", "Prerequisite network, shaded by failure count"],
  ];
  document.getElementById("figures").innerHTML = figs.map(([file, cap]) =>
    `<div class="figure">
       <img src="../outputs/figures/${file}" alt="${cap}" onerror="this.parentElement.style.display='none'"/>
       <div class="cap">${cap}</div>
     </div>`).join("");
}
