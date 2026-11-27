// Jahresrückblick (/rueckblick/<jahr>/): Zahlen, Briefmarken, Reisen, Lieblingsort, Fotos und Monate eines Jahres.
// Rechnet mit denselben Daten und Regeln wie der Globus (globusDaten, landIdsZuordnen, Kilometer nur innerhalb von
// Reisen, Zuhause zählt als ein Ort), damit die Zahlen zur Statistik-Leiste passen. Nur öffentliche Felder.
import fs from 'node:fs';
import path from 'node:path';
import { feature } from 'topojson-client';
import { landIdsZuordnen, markeSVG } from './marke.mjs';
import { entfernungKm } from '../../scripts/ortname.mjs';
import { globusDaten, ohneBei } from './daten';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const lesen = (datei: string) => { try { return JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { return null; } };

export async function jahresRueckblicke() {
  const G = await globusDaten();
  // Länderformen: grob aus world-atlas (wie der Globus), genau aus public/data/land10 (von scripts/prepare.mjs, vor dem Bau)
  const topo = lesen(path.join(process.cwd(), 'node_modules/world-atlas/countries-110m.json'));
  const C110 = topo ? (feature(topo, topo.objects.countries) as unknown as { features: { id: string }[] }).features : [];
  const E = G.eintraege.map((e) => ({ ...e, ts: Date.parse(e.iso), cid: null as string | null }));
  landIdsZuordnen(E, C110);
  const landName: Record<string, string> = {}; for (const e of E) if (e.cid && !landName[e.cid]) landName[e.cid] = e.land;
  const form = (id: string) => lesen(path.join(process.cwd(), 'public/data/land10', `${id}.json`)) ?? C110.find((c) => String(c.id) === id) ?? null;
  const ersterBesuch: Record<string, (typeof E)[number]> = {};
  for (const e of [...E].sort((a, b) => a.ts - b.ts)) if (e.cid) ersterBesuch[e.cid] ??= e;

  const jahre = [...new Set(E.map((e) => e.iso.slice(0, 4)))].sort().reverse();
  return jahre.map((jahr) => {
    const imJahr = (iso: string) => iso.startsWith(jahr);
    const es = E.filter((e) => imJahr(e.iso)).sort((a, b) => a.ts - b.ts); // chronologisch
    const heim = es.filter((e) => e.zuhause);
    const orte = es.length - heim.length + (heim.length ? 1 : 0);

    // Briefmarken: jedes Land des Jahres in der Reihenfolge des ersten Besuchs in diesem Jahr; „neu“ = erstes Mal überhaupt
    const ids = [...new Set(es.map((e) => e.cid).filter((c): c is string => !!c))];
    const marken = ids.map((id) => {
      const erste = es.find((e) => e.cid === id)!;
      return { id, name: landName[id] || '', neu: ersterBesuch[id] === erste, ort: ohneBei(erste.ort), datum: erste.datum,
        svg: markeSVG({ id, form: form(id), name: landName[id] || '', ort: ohneBei(erste.ort), ts: erste.ts, zusatz: '-rb' }) };
    });

    // Reisen des Jahres und Kilometer wie auf dem Globus: Luftlinie zwischen aufeinanderfolgenden Stationen derselben Reise
    let km = 0; const reisen: { titel: string; zeitraum: string; stationen: number; von: number; orte: string[] }[] = [];
    for (const r of G.reisen) {
      const st = r.stationen.map((id) => E.find((e) => e.id === id)).filter((e): e is (typeof E)[number] => !!e);
      for (let i = 1; i < st.length; i++) if (imJahr(st[i - 1].iso) && imJahr(st[i].iso)) km += entfernungKm(st[i - 1].lat, st[i - 1].lon, st[i].lat, st[i].lon);
      const drin = st.filter((e) => imJahr(e.iso));
      if (drin.length) reisen.push({ titel: r.titel, zeitraum: r.zeitraum, stationen: drin.length, von: st.length, orte: [...new Set(drin.map((e) => ohneBei(e.ort)))] });
    }

    // Lieblingsort: wo es die meisten Einträge gab (erst ab zwei)
    const zaehler = new Map<string, number>(); for (const e of es) { const o = ohneBei(e.ort); zaehler.set(o, (zaehler.get(o) ?? 0) + 1); }
    const [lieblingsort, lieblingsZahl] = [...zaehler].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

    // Fotos: reihum aus jedem Eintrag eins, damit nicht ein Eintrag alles füllt; höchstens 12
    const fotos: { klein: string; bild: string; text: string; url: string; titel: string; ort: string }[] = [];
    for (let runde = 0; fotos.length < 12 && es.some((e) => e.fotos.length > runde); runde++) {
      for (const e of es) { const f = e.fotos[runde]; if (f && fotos.length < 12) fotos.push({ ...f, url: e.url, titel: e.titel, ort: ohneBei(e.ort) }); }
    }

    const monate = MONATE.map((name, i) => ({ name, es: es.filter((e) => Number(e.iso.slice(5, 7)) === i + 1) })).filter((m) => m.es.length);
    const gedanken = G.gedichte.filter((g) => imJahr(g.iso)).sort((a, b) => a.iso.localeCompare(b.iso));
    return { jahr, es, orte, marken, km, reisen, lieblingsort: lieblingsZahl >= 2 ? { ort: lieblingsort, zahl: lieblingsZahl } : null, fotos, monate, gedanken,
      von: es[0]?.datum ?? '', bis: es[es.length - 1]?.datum ?? '' };
  });
}
