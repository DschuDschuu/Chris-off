import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Die Inhalte kommen aus Christophs Inhalts-Repo. Beim Bauen zeigt CONTENT_DIR darauf,
// lokal wird der Beispielordner benutzt.
const basis = process.env.CONTENT_DIR || './example-content';

const eintraege = defineCollection({
  loader: glob({ pattern: '**/*.md', base: `${basis}/eintraege` }),
  schema: z
    .object({
      titel: z.string(),
      datum: z.coerce.date(),
      ort: z.string(),
      land: z.string(),
      breite: z.coerce.number(),
      laenge: z.coerce.number(),
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
    .transform(({ ganz_persoenlich, ...rest }) => rest),
});

const gedichte = defineCollection({
  loader: glob({ pattern: '**/*.md', base: `${basis}/gedichte` }),
  schema: z.object({
    titel: z.string(),
    datum: z.coerce.date(),
    eintrag: z.string().optional().nullable(),
    ort: z.string().optional().nullable(),
    breite: z.coerce.number().optional().nullable(),
    laenge: z.coerce.number().optional().nullable(),
    entwurf: z.boolean().default(false),
  }),
});

export const collections = { eintraege, gedichte };
