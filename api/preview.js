// /api/preview.js — OG image or thum.io screenshot fallback
export default async function handler(req, res) {
  const pageUrl = (req.query.url || '').trim();
  
  if (!/^https?:\/\//i.test(pageUrl)) {
    return res.status(400).json({ error: 'Missing or invalid ?url=' });
  }

  const screenshot = `https://image.thum.io/get/width/600/noanimate/${pageUrl}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const r = await fetch(pageUrl, {
      headers: { 'user-agent': 'jooski.fun-preview/1.0 (+https://jooski.fun)' },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    const html = await r.text();

    const first = (re) => { const m = html.match(re); return m ? m[1] : ''; };
    const resolve = (u) => {
      try { return new URL(u, pageUrl).toString(); }
      catch { return ''; }
    };

    const ogPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
      /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    ];

    for (const re of ogPatterns) {
      const m = first(re);
      if (m && m.length > 5) return redirect(resolve(m), res);
    }

    return redirect(screenshot, res);

  } catch (e) {
    // Timeout, network error, whatever — just use thum.io
    return redirect(screenshot, res);
  }
}

function redirect(url, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
  res.status(302).setHeader('Location', url).end();
}
