'use strict';

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function score(q, name) {
  const n = norm(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n === 'microsoft ' + q) return 95;
  if (n.startsWith(q + ' ')) return 80;
  if ((' ' + n + ' ').includes(' ' + q + ' ')) return 70;
  const nt = n.split(' ');
  const qt = q.split(' ');
  if (qt.every((t) => nt.includes(t))) return 60;
  if (n.includes(q)) return 40;
  return 0;
}

// Returns the best candidates for a spoken app name. 0 = none, 1 = unambiguous, >1 = ambiguous (max 5).
function matchApps(query, apps) {
  const q = norm(query);
  const scored = (apps || [])
    .map((a) => ({ a, s: score(q, a.name) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  if (!scored.length) return [];
  const top = scored[0].s;
  let c = scored.filter((x) => x.s === top).map((x) => x.a);
  // collapse duplicates that share the same display name
  const seen = new Set();
  c = c.filter((a) => { const k = norm(a.name); if (seen.has(k)) return false; seen.add(k); return true; });
  if (c.length > 1) {
    const toks = c.map((a) => norm(a.name).split(' ').length);
    const min = Math.min(...toks);
    const shortest = c.filter((a, i) => toks[i] === min);
    if (shortest.length === 1) return shortest;
  }
  return c.slice(0, 5);
}

module.exports = { matchApps, norm };
