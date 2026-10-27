window.aagFonts = ['Manrope', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];
window.applyTextStyles = (root, slide) => {
  root.style.containerType = 'inline-size';
  for (const [key, selector] of Object.entries({ title: ':scope > h1, :scope > h2', body: ':scope > p', options: ':scope > ol, :scope > ul' })) {
    const style = slide.textStyles?.[key];
    for (const element of root.querySelectorAll(selector)) {
      element.style.fontFamily = style ? `"${style.fontFamily}", sans-serif` : '';
      element.style.fontSize = style ? `${style.fontSize / 16}cqw` : '';
      element.style.fontWeight = style ? style.bold ? '700' : '400' : '';
    }
  }
};
window.renderSlideElements = function renderSlideElements(slide, { editable = false, playback = false, selectedIndex = -1, onSelect = () => {}, onChange = () => {}, backgroundSrc, aspectRatio = '16:9' } = {}) {
  const surface = document.createElement('div'); surface.className = 'element-slide';
  surface.style.aspectRatio = aspectRatio === '4:3' ? '4 / 3' : '16 / 9';
  if (slide.background) surface.style.background = slide.background;
  if (slide.type === 'imported') {
    surface.classList.add('imported-element-slide');
    const background = document.createElement('img');
    background.className = 'imported-slide imported-background';
    background.alt = slide.title;
    if (backgroundSrc !== '') background.src = backgroundSrc ?? `/aag/api/imports/${slide.importId}/pages/${slide.page}`;
    surface.append(background);
  }
  (slide.elements ?? []).forEach((element, index) => {
    const object = document.createElement('div');
    object.className = `slide-object slide-object-${element.type}${editable && index === selectedIndex ? ' selected' : ''}`;
    const position = () => { for (const key of ['x', 'y']) object.style[key === 'x' ? 'left' : 'top'] = `${element[key]}%`; for (const key of ['w', 'h']) object.style[key === 'w' ? 'width' : 'height'] = `${element[key]}%`; };
    position();
    if (element.rotation) object.style.transform = `rotate(${element.rotation}deg)`;
    if (element.type === 'shape') { object.style.backgroundColor = element.color; if (element.shape === 'ellipse') object.style.borderRadius = '50%'; }
    else if (element.type === 'image') {
      const image = document.createElement('img'); image.alt = 'Изображение слайда'; image.dataset.assetId = element.assetId; image.src = `/aag/api/assets/${element.assetId}`; image.style.objectFit = element.fit || 'contain'; image.style.objectPosition = `${element.focalX ?? 50}% ${element.focalY ?? 50}%`; object.append(image);
    } else if (element.type === 'video') {
      if (editable || !playback) { const placeholder = document.createElement('div'); placeholder.className = 'video-placeholder'; placeholder.textContent = `▶ ${element.provider ? 'Видео по ссылке' : 'Видео'}${!editable ? ' · на экране аудитории' : ''}`; object.append(placeholder); }
      else if (element.assetId) {
        const video = document.createElement('video'); video.src = `/aag/api/assets/${element.assetId}`; video.controls = true; video.preload = 'metadata'; video.playsInline = true; video.autoplay = !!element.autoplay; video.muted = element.muted ?? true; video.loop = !!element.loop; video.style.objectFit = element.fit || 'contain'; video.style.objectPosition = `${element.focalX ?? 50}% ${element.focalY ?? 50}%`;
        video.addEventListener('loadedmetadata', () => { if (element.startTime && element.startTime < video.duration) video.currentTime = element.startTime; }); object.append(video);
      } else {
        const url = new URL(element.url);
        if (element.provider === 'youtube') { url.searchParams.set('autoplay', element.autoplay ? '1' : '0'); url.searchParams.set('mute', element.muted ? '1' : '0'); url.searchParams.set('start', String(element.startTime || 0)); url.searchParams.set('enablejsapi', '1'); if (element.loop) { url.searchParams.set('loop', '1'); url.searchParams.set('playlist', url.pathname.split('/').pop()); } }
        else if (element.provider === 'rutube') { url.searchParams.set('t', String(element.startTime || 0)); if (element.autoplay) url.searchParams.set('autoplay', '1'); }
        else if (element.autoplay) url.searchParams.set('autoplay', '1');
        const frame = document.createElement('iframe'); frame.src = url.toString(); frame.title = 'Видео слайда'; frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); object.append(frame);
      }
    } else {
      object.textContent = element.text;
      object.style.color = element.color;
      object.style.fontSize = `${element.fontSize / 16}cqw`;
      object.style.fontFamily = `"${element.fontFamily || 'Manrope'}", sans-serif`;
      object.style.fontWeight = element.bold ? '700' : '400';
      object.style.fontStyle = element.italic ? 'italic' : 'normal';
      object.style.textAlign = element.align;
    }
    if (editable) {
      object.tabIndex = 0;
      object.setAttribute('aria-label', `Элемент ${index + 1}: ${element.type === 'text' ? element.text : element.type === 'image' ? 'изображение' : element.type === 'video' ? 'видео' : 'фигура'}`);
      object.addEventListener('click', () => onSelect(index));
      for (const corner of ['nw', 'ne', 'sw', 'se']) { const handle = document.createElement('span'); handle.className = `resize-handle resize-${corner}`; handle.dataset.corner = corner; handle.setAttribute('aria-label', 'Изменить размер'); object.append(handle); }
      object.addEventListener('pointerdown', (event) => {
        event.preventDefault(); object.focus({ preventScroll: true }); onSelect(index);
        const corner = event.target.dataset?.corner;
        const startX = event.clientX, startY = event.clientY;
        const start = { x: element.x, y: element.y, w: element.w, h: element.h };
        let moved = false;
        object.setPointerCapture(event.pointerId);
        const move = (next) => {
          moved = true;
          const rect = surface.getBoundingClientRect();
          const dx = (next.clientX - startX) * 100 / rect.width;
          const dy = (next.clientY - startY) * 100 / rect.height;
          if (corner) {
            Object.assign(element, window.editorSlideTools.resizeElement(start, dx, dy, corner, ['image', 'video'].includes(element.type) && element.lockAspect !== false && !next.shiftKey));
          } else {
            element.x = Math.max(0, Math.min(100 - element.w, Math.round(start.x + dx)));
            element.y = Math.max(0, Math.min(100 - element.h, Math.round(start.y + dy)));
          }
          position();
        };
        const finish = () => { object.removeEventListener('pointermove', move); object.removeEventListener('pointerup', finish); object.removeEventListener('pointercancel', finish); if (moved) onChange(); };
        object.addEventListener('pointermove', move);
        object.addEventListener('pointerup', finish);
        object.addEventListener('pointercancel', finish);
      });
      object.addEventListener('keydown', (event) => { const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]; if (!delta) return; event.preventDefault(); element.x = Math.max(0, Math.min(100 - element.w, element.x + delta[0] * (event.shiftKey ? 5 : 1))); element.y = Math.max(0, Math.min(100 - element.h, element.y + delta[1] * (event.shiftKey ? 5 : 1))); position(); onChange(); });
    }
    surface.append(object);
  });
  return surface;
};
window.renderQuestionOverlay = function renderQuestionOverlay(slide, options = {}) {
  const indexes = (slide.elements ?? []).map((element, index) => ['text', 'shape'].includes(element.type) ? index : -1).filter((index) => index >= 0);
  const overlay = document.createElement('div'); overlay.className = 'question-slide-overlay';
  overlay.append(window.renderSlideElements({ elements: indexes.map((index) => slide.elements[index]) }, {
    ...options,
    selectedIndex: indexes.indexOf(options.selectedIndex),
    onSelect: (index) => options.onSelect?.(indexes[index]),
  }));
  return overlay;
};
