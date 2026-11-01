// Live audit: runs the site's own lookup code (from index.html) against OpenAlex + PubMed
// for every roster professor plus extra names, and writes a markdown report to stdout.
import { JSDOM } from "jsdom";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8")
  .replace(/<link[^>]+fonts[^>]*>/g, "");
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://prof-pubs.onrender.com/",
  beforeParse(w) { w.fetch = fetch; w.URL = URL; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; },
});
const W = dom.window;
const ev = (s) => W.eval(s);
if (process.env.OPENALEX_KEY) ev(`store.set("key", ${JSON.stringify(process.env.OPENALEX_KEY)})`);

const extra = (process.env.EXTRA_NAMES || "Anubhav Tripathi").split(",").map((s) => s.trim()).filter(Boolean);
let names = [...ev("ROSTER_FLAT").map((p) => p.name), ...extra];
if (process.env.BATCH) { const [i, n] = process.env.BATCH.split("/").map(Number); names = names.filter((_, k) => k % n === i); }
const hint = "Brown University";
const toYear = new Date().getFullYear(), fromYear = toYear - 4;
const out = [];
const log = (s = "") => out.push(s);
const short = (t, n = 110) => (t || "").replace(/\s+/g, " ").slice(0, n);

log(`# Live audit — ${new Date().toISOString()}`);
// CORS checks (what a browser would see)
for (const [label, url, opts] of [
  ["OpenAlex", "https://api.openalex.org/works?per_page=1", {}],
  ["NCBI esearch", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=cartilage&retmode=json&retmax=0", {}],
  ["NCBI efetch", "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=31452104&retmode=xml", {}],
  ["S2 batch preflight", "https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } }],
]) {
  try { const r = await fetch(url, { ...opts, headers: { Origin: "https://prof-pubs.onrender.com", ...(opts.headers || {}) } });
    log(`- CORS ${label}: HTTP ${r.status}, allow-origin=${r.headers.get("access-control-allow-origin")}, allow-headers=${r.headers.get("access-control-allow-headers")}`);
  } catch (e) { log(`- CORS ${label}: ${e.message}`); }
}
log(`Window ${fromYear}–${toYear}, hint "${hint}", OpenAlex key: ${process.env.OPENALEX_KEY ? "env" : ev("oaKey()") ? "built-in" : "NO"}`);
log();

for (const name of names) {
  log(`## ${name}`);
  let cands = [], works = [], pm = { items: [], count: 0, term: "" }, oaErr = null;
  try {
    cands = await ev("findAuthors")(name, hint, fromYear);
    const sel = cands.filter((c) => c.selected);
    if (sel.length) works = await ev("fetchWorks")(sel.map((c) => ev("shortId")(c.id)), fromYear);
  } catch (e) { oaErr = e; }
  try { pm = await ev("pubmedSearch")(name, hint, fromYear); } catch (e) { log(`- PubMed ERROR: ${e.message}`); }
  if (oaErr) log(`- OpenAlex ERROR: ${oaErr.message} (status ${oaErr.status ?? "?"})`);
  log(`- OpenAlex candidates (${cands.length}):`);
  for (const c of cands.slice(0, 8)) {
    log(`  - ${c.selected ? "[x]" : "[ ]"} ${c.affRecent ? "(recent)" : c.affEver ? "(ever)" : ""} ${c.display_name} — ${c.works_count} works, ${c.cited_by_count} cites, h=${c.summary_stats?.h_index ?? "?"} — ${short(c.insts.slice(0, 3).join("; "), 90)} — topic: ${c.topics?.[0]?.display_name ?? "-"}`);
  }
  log(`- PubMed: ${pm.count} hits · term: \`${pm.term}\``);

  const sel = cands.filter((c) => c.selected);
  const ids = new Set(sel.map((c) => ev("shortId")(c.id)));
  const r = ev("buildPapers")(works, pm.items, sel.map((c) => c.id), name, hint, false, false);
  let s2 = null; if (r.papers.some((p) => p.cites == null)) s2 = await ev("s2Citations")(r.papers);
  const A = ev("analyze")(r.papers, fromYear, toYear);
  log(`- RESULT: ${A.n} papers (OpenAlex raw ${works.length}, hidden-elsewhere ${r.droppedElsewhere}, hidden-unverified ${r.droppedUnverified}, PubMed-only added ${r.pmOnly}, PubMed rejected ${r.pmRejected}${s2 === null ? "" : `, S2 citations ok=${s2}`})`);
  log(`- Profile purity: ${Object.entries(r.purity).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", ")}`);
  log(`- Roles: last ${A.role.last} / first ${A.role.first} / middle ${A.role.middle} · cites ${A.cites} · per year ${A.perYearAvg.toFixed(1)}`);
  log(`- Per year: ${A.perYear.map((y) => `${y.year}:${y.first + y.middle + y.last}`).join(" ")}`);
  log(`- Topics: ${A.topics.slice(0, 5).map((t) => `${t.t} (${t.c})`).join("; ")}`);
  log(`- Venues: ${A.venues.slice(0, 5).map((v) => `${v[0]} (${v[1]})`).join("; ")}`);
  log(`- Coauthors: ${A.coauthors.slice(0, 6).map((c) => `${c.name} (${c.n})`).join("; ")}`);
  // duplicates by DOI / title
  const seen = new Map(); let dups = 0;
  for (const p of r.papers) { const k = ev("normTitle")(p.title); if (seen.has(k)) dups++; else seen.set(k, 1); }
  log(`- Duplicate titles left: ${dups}`);
  // affiliation breakdown of raw works
  const affs = new Map(); const hidden = [];
  for (const w of works) {
    const mine = (w.authorships || []).find((a) => ids.has(ev("shortId")(a.author?.id)));
    const txt = mine ? [...(mine.institutions || []).map((i) => i.display_name), ...(mine.raw_affiliation_strings || [])].join(" | ") : "";
    const key = !mine ? "(author not on authorship list!)" : !txt.trim() ? "(none listed)" : ev("instMatches")(txt, hint) ? "MATCH" : short((mine.institutions || [])[0]?.display_name || txt, 60);
    affs.set(key, (affs.get(key) || 0) + 1);
    if (txt.trim() && !ev("instMatches")(txt, hint) && hidden.length < 6) hidden.push(`${w.publication_year} · ${short(w.display_name, 80)} · [${short(txt, 80)}]`);
  }
  log(`- Author affiliation on raw works: ${[...affs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  if (hidden.length) { log(`- Sample hidden papers:`); hidden.forEach((h) => log(`  - ${h}`)); }
  const pmOnly = r.papers.filter((p) => p.src.length === 1 && p.src[0] === "PubMed").slice(0, 5);
  if (pmOnly.length) { log(`- Sample PubMed-only papers:`); pmOnly.forEach((p) => log(`  - ${p.year} · ${short(p.title, 90)} · ${short(p.venue, 40)} · role ${p.role}`)); }
  log(`- Most recent kept:`); r.papers.slice(0, 5).forEach((p) => log(`  - ${p.year} · ${short(p.title, 90)} · ${short(p.venue, 40)} · ${p.role} · cites ${p.cites ?? "-"} · ${p.src.join("+")}`));
  log();
  await new Promise((res) => setTimeout(res, 300));
}
process.stdout.write(out.join("\n") + "\n");
