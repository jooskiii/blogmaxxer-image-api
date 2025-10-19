// /api/preview.js — best-effort preview image: OG/Twitter -> apple-touch-icon -> favicon
export default async function handler(req, res) {
  try {
    const pageUrl = (req.query.url || '').trim();
    if (!/^https?:\/\//i.test(pageUrl)) {
      return res.status(400).json({ error: 'Missing or invalid ?url=' });
    }

    const r = await fetch(pageUrl, {
      headers: { 'user-agent': 'jooski.fun-preview/1.0 (+https://jooski.fun)' },
      redirect: 'follow'
    });

    const html = await r.text();

    // helpers
    const first = (re) => { const m = html.match(re); return m ? m[1] : ''; };
    const resolve = (u) => new URL(u, pageUrl).toString();

    // 1) OG/Twitter images
    const ogOrTw = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i
    ];
    for (const re of ogOrTw) {
      const m = first(re);
      if (m) return redirect(resolve(m), res);
    }

    // 2) Largest apple-touch-icon
    const appleIcons = [...html.matchAll(
      /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi
    )].map(tag => {
      const href = (tag[0].match(/href=["']([^"']+)["']/i) || [,''])[1];
      const sizes = (tag[0].match(/sizes=["'](\d+)x(\d+)["']/i) || [,'0','0']).slice(1).map(Number);
      const area = sizes[0]*sizes[1];
      return { href, area };
    }).filter(x => x.href);
    if (appleIcons.length) {
      appleIcons.sort((a,b)=> b.area - a.area);
      return redirect(resolve(appleIcons[0].href), res);
    }

    // 3) Favicon (rel=icon / shortcut icon), fallback to /favicon.ico
    const iconHref =
      first(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
      '/favicon.ico';
    return redirect(resolve(iconHref), res);

  } catch (e) {
    return res.status(500).json({ error: 'preview failed', detail: String(e) });
  }
}

function redirect(url, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=259200, stale-while-revalidate=86400'); // 3 days at the edge
  res.status(302).setHeader('Location', url).end();
}
