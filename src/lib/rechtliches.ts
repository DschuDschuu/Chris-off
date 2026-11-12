import { getEntry } from 'astro:content';

// Impressum-Angaben für Impressum und Datenschutz. Fehlende Felder werden durch sichtbare
// Platzhalter ersetzt, damit eine unvollständige Angabe auffällt, aber den Bau nicht stoppt.
export async function rechtliches() {
  const d = (await getEntry('einstellungen', 'rechtliches'))?.data ?? {};
  const wert = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const name = wert(d.name), strasse = wert(d.strasse), ort = wert(d.ort), email = wert(d.email);
  return {
    vollstaendig: !!(name && strasse && ort && email),
    name: name ?? 'Vor- und Nachname',
    strasse: strasse ?? 'Straße Hausnummer',
    ort: ort ?? 'PLZ Ort',
    email: email ?? 'name@beispiel.de',
    telefon: wert(d.telefon),
  };
}
