const invalid = () => { const issue = new Error('Вставьте HTTPS-ссылку на видео YouTube, Rutube или VK.'); issue.status = 400; throw issue; };
export function normalizeVideoUrl(value) {
  let input;
  try { input = new URL(value); } catch { return invalid(); }
  if (input.protocol !== 'https:' || input.username || input.password || input.port) return invalid();
  const host = input.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(host)) {
    const id = host === 'youtu.be' ? input.pathname.slice(1) : input.pathname === '/watch' ? input.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)\/?$/.exec(input.pathname)?.[1];
    if (!/^[\w-]{11}$/.test(id || '')) return invalid();
    return { provider: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (['rutube.ru', 'www.rutube.ru'].includes(host)) {
    const id = /^\/(?:video\/(?:private\/)?|shorts\/|play\/embed\/)([a-f0-9]{32})\/?$/i.exec(input.pathname)?.[1];
    if (!id) return invalid();
    const output = new URL(`https://rutube.ru/play/embed/${id}`);
    const access = input.searchParams.get('p');
    if (access && /^[\w-]{1,150}$/.test(access)) output.searchParams.set('p', access);
    return { provider: 'rutube', url: output.toString() };
  }
  if (['vk.com', 'www.vk.com', 'vkvideo.ru', 'www.vkvideo.ru'].includes(host)) {
    const parts = /^\/video(-?\d+)_(\d+)\/?$/.exec(input.pathname);
    const oid = parts?.[1] ?? (input.pathname === '/video_ext.php' ? input.searchParams.get('oid') : null);
    const id = parts?.[2] ?? input.searchParams.get('id');
    if (!/^-?\d{1,20}$/.test(oid || '') || !/^\d{1,20}$/.test(id || '')) return invalid();
    const output = new URL('https://vk.com/video_ext.php'); output.searchParams.set('oid', oid); output.searchParams.set('id', id); output.searchParams.set('hd', '2');
    const hash = input.searchParams.get('hash'); if (hash && /^[a-f0-9]{1,100}$/i.test(hash)) output.searchParams.set('hash', hash);
    return { provider: 'vk', url: output.toString() };
  }
  return invalid();
}
