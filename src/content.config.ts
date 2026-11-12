import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Die Inhalte kommen aus Christophs Inhalts-Repo. Beim Bauen zeigt CONTENT_DIR darauf,
// lokal wird der Beispielordner benutzt.
const basis = process.env.CONTENT_DIR || './example-content';

// Ort eines Eintrags oder Gedichts. Der Editor speichert ihn im Feld „karte“ als GeoJSON-Punkt,
// z. B. {"type":"Point","coordinates":[-9.14,38.71]} – Achtung: erst Länge, dann Breite.
// Ältere Einträge haben stattdessen die Zahlenfelder „breite“ und „laenge“; die gelten weiter.
const ortsFelder = {
  karte: z.union([z.string(), z.object({}).passthrough()]).optional().nullable(),
  breite: z.coerce.number().optional().nullable(),
  laenge: z.coerce.number().optional().nullable(),
};

type Ort = { karte?: string | object | null; breite?: number | null; laenge?: number | null };

// Liefert [breite, laenge] oder null, wenn kein gültiger Ort angegeben ist.
function ortLesen({ karte, breite, laenge }: Ort): [number, number] | null {
  if (karte) {
    try {
      const g: any = typeof karte === 'string' ? JSON.parse(karte) : karte;
      const [lon, lat] = g?.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : [];
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    } catch {
      // ungültiger Text im Feld: unten auf breite/laenge zurückfallen
    }
  }
  if (Number.isFinite(breite) && Number.isFinite(laenge)) return [breite as number, laenge as number];
  return null;
}

const eintraege = defineCollection({
  loader: glob({ pattern: '**/*.md', base: `${basis}/eintraege` }),
  schema: z
    .object({
      titel: z.string(),
      datum: z.coerce.date(),
      ort: z.string(),
      land: z.string(),
      ...ortsFelder,
      reise: z.string().optional().nullable(), // Verweis auf eine Reise (Dateiname/Slug), leer = Tagebuch
      titelbild: z.string().optional().nullable(),
      galerie: z.array(z.object({ bild: z.string(), text: z.string().optional().nullable() })).default([]),
      lieder: z.array(z.object({ youtube: z.string(), titel: z.string().optional().nullable() })).default([]),
      vorlesen: z.string().optional().nullable(),
      uhrzeit: z.string().optional().nullable(),
      wetter: z.string().optional().nullable(),
      persoenliches: z.string().optional().nullable(),
      ganz_persoenlich: z.string().optional().nullable(),
      entwurf: z.boolean().default(false),
    })
    // „Ganz persönlich“ wird hier entfernt und ist dadurch beim Bauen nirgends verfügbar.
    // Der Ort wird auf breite/laenge vereinheitlicht, damit Globus und Seiten nur diese Form kennen.
    .transform(({ ganz_persoenlich, karte, breite, laenge, ...rest }, ctx) => {
      const punkt = ortLesen({ karte, breite, laenge });
      if (!punkt) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ort fehlt: im Editor bei „Ort auf der Karte“ einen Punkt setzen.' });
        return z.NEVER;
      }
      return { ...rest, breite: punkt[0], laenge: punkt[1] };
    }),
});

const gedichte = defineCollection({
  loader: glob({ pattern: '**/*.md', base: `${basis}/gedichte` }),
  schema: z
    .object({
      titel: z.string(),
      datum: z.coerce.date(),
      eintrag: z.string().optional().nullable(),
      ort: z.string().optional().nullable(),
      ...ortsFelder,
      entwurf: z.boolean().default(false),
    })
    // Gedichte ohne eigenen Ort übernehmen ihn vom verknüpften Eintrag (siehe globusDaten()).
    .transform(({ karte, breite, laenge, ...rest }) => {
      const punkt = ortLesen({ karte, breite, laenge });
      return { ...rest, breite: punkt?.[0] ?? null, laenge: punkt?.[1] ?? null };
    }),
});

// Reisen fassen Einträge zu Stationen zusammen (Einträge verweisen per „reise“ auf sie).
const reisen = defineCollection({
  loader: glob({ pattern: '**/*.md', base: `${basis}/reisen` }),
  schema: z.object({
    titel: z.string(),
    beschreibung: z.string().optional().nullable(),
    titelbild: z.string().optional().nullable(),
  }),
});

// Impressum-Angaben, die Christoph im Editor unter „Einstellungen → Impressum & Kontakt“ pflegt.
// Alles optional: fehlt etwas, zeigt die Impressum-Seite einen Hinweis statt den Bau abzubrechen.
const einstellungen = defineCollection({
  loader: glob({ pattern: 'rechtliches.md', base: `${basis}/einstellungen` }),
  schema: z.object({
    name: z.string().optional().nullable(),
    strasse: z.string().optional().nullable(),
    ort: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    telefon: z.string().optional().nullable(),
  }),
});

export const collections = { eintraege, gedichte, reisen, einstellungen };
