// RSS-Feed: alle veröffentlichten Einträge (ohne Gedichte)
import rss from '@astrojs/rss';
import site from '../../site.config.mjs';
import { alleEintraege, auszug, textVon } from '../lib/daten';

export async function GET(context) {
  const eintraege = await alleEintraege();
  return rss({
    title: site.titel,
    description: `${site.untertitel} von ${site.autor}`,
    site: context.site,
    customData: '<language>de-de</language>',
    items: eintraege.map((e) => ({
      title: `${e.data.ort}: ${e.data.titel}`,
      pubDate: e.data.datum,
      link: `/${e.id}/`,
      description: auszug(textVon(e), 400),
    })),
  });
}
