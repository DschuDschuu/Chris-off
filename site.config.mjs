// Zentrale Einstellungen der Seite. Alles hier darf angepasst werden.
export default {
  titel: 'Notizen von unterwegs',
  untertitel: 'Ein Reisetagebuch',
  autor: 'Christoph',
  // Adresse der fertigen Seite (wird beim Bauen über SITE_URL gesetzt)
  url: process.env.SITE_URL || 'https://example.org',
  // Christophs privates Inhalts-Repo (für den Editor unter /admin)
  inhalteRepo: process.env.CONTENT_REPO || 'CHRISTOPH-GITHUB-NAME/tagebuch-inhalte',
  // Aussehen der Weltkugel: 'hell' | 'vintage' | 'punkte' | 'linien'
  globus: 'hell',
  // Fog of War: freier Umkreis um jeden Ort und halbe Breite der Route (km)
  nebel: { radiusKm: 25, routeKm: 10 },
  // Gedichte: 'mix' (Küste = Flaschenpost, sonst Papierflieger) | 'flieger' | 'flasche'
  gedichte: 'mix',
};
