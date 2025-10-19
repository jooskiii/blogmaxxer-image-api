// /api/ogimg.js
export default async function handler(req, res) {
  try {
    const url = (req.query.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Missing or invalid ?url=' });
    }

    const r = await fetch(url, {
      headers: { 'user-agent': 'jooski.fun-ogbot/1.0 (+https://jooski.fun)' },
      redirect: 'follow'
    });
    const html = await r.text();

    const find = (pattern) => {
      const re = new RegExp(pattern, 'i');
      const match = html.match(re);
      return match ? match[1] : '';
    };

    // look for og:image or twitter:image
    let img =
      find('<meta[^>]+property=[\"\\\']og:image[\"\\\'][^>]+content=[\"\\\']([^\"\\\']+)[\"\\\']') ||
      find('<meta[^>]+name=[\"\\\']twitter:image[\"\\\'][^>]+content=[\"\\\']([^\"\\\']+)[\"\\\']');

    if (!img) return res.status(404).json({ error: 'No OG/Twitter image found' });

    const resolved = new URL(img, url).toString();
    res.setHeader('Cache-Control', 'public, s-maxage=259200, stale-while-revalidate=86400');
    res.status(302).setHeader('Location', resolved).end();
  } catch (e) {
    res.status(500).json({ error: 'OG fetch failed', detail: String(e) });
  }
}
