window.editorSlideTools = {
  resizeElement(start, dx, dy, corner, lockAspect) {
    const west = corner.includes('w'), north = corner.includes('n');
    const maxW = west ? start.x + start.w : 100 - start.x;
    const maxH = north ? start.y + start.h : 100 - start.y;
    let w = Math.max(5, start.w + (west ? -dx : dx));
    let h = Math.max(5, start.h + (north ? -dy : dy));
    if (lockAspect) {
      const sx = w / start.w, sy = h / start.h;
      const scale = Math.min(Math.max(5 / start.w, 5 / start.h, Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy), maxW / start.w, maxH / start.h);
      w = start.w * scale; h = start.h * scale;
    } else { w = Math.min(maxW, w); h = Math.min(maxH, h); }
    return { x: west ? start.x + start.w - w : start.x, y: north ? start.y + start.h - h : start.y, w, h };
  },
  insertQuestion(slides, selectedIndex, presentationAnchor, question) {
    const questionTypes = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'];
    const anchor = questionTypes.includes(slides[selectedIndex]?.type) ? selectedIndex : Math.min(presentationAnchor, slides.length - 1);
    const next = [...slides];
    next.splice(anchor + 1, 0, question);
    return { slides: next, index: anchor + 1 };
  },
  duplicateSlide(slide) {
    const copy = structuredClone(slide);
    for (const element of copy.elements ?? []) element.id = crypto.randomUUID();
    return copy;
  },
  moveElement(elements, index, direction) {
    const next = [...elements];
    const target = index + (direction === 'forward' ? 1 : -1);
    if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
    return next;
  },
  createElement(type, assetId) {
    const id = crypto.randomUUID();
    if (type === 'text') return { id, type, x: 20, y: 40, w: 55, h: 18, text: 'Новая надпись', color: '#ffffff', fontSize: 32, bold: false, italic: false, align: 'left' };
    if (type === 'shape') return { id, type, shape: 'rectangle', x: 30, y: 55, w: 30, h: 18, color: '#bf9f62' };
    if (['image', 'video'].includes(type)) return { id, type, x: 20, y: 20, w: 60, h: 60, assetId, fit: 'contain', focalX: 50, focalY: 50, rotation: 0, lockAspect: true, ...(type === 'video' ? { autoplay: false, muted: true, loop: false, startTime: 0 } : {}) };
    throw new Error('Неизвестный тип элемента.');
  },
  setSlideLayout(slide, type) {
    if (!['cover', 'content', 'closing'].includes(type) || !['cover', 'content', 'closing'].includes(slide.type)) throw new Error('Этот макет недоступен.');
    const copy = { ...slide, type };
    if (['content', 'closing'].includes(type)) copy.bullets = copy.bullets || [];
    else delete copy.bullets;
    return copy;
  },
};
