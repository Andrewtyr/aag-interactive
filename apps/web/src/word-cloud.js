window.layoutWordCloud = function layoutWordCloud(values) {
  const words = [...values]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'ru'))
    .slice(0, 40);
  const distinct = words.length;
  if (!distinct) return [];
  const biggestCount = Math.max(1, words[0].count);
  // One or two words are highly visible; with 40 words everything gets smaller.
  // Frequency remains relative to the most frequent word, not to the audience size.
  const baseSize = 82 / Math.pow(distinct, 0.32);
  return words.map((item, index) => {
      const angle = -Math.PI / 2 + (index - 1) * 2.399963229728653;
      const radius = Math.min(42, 25 + 4 * Math.sqrt(index));
      const popularity = Math.sqrt(Math.max(0, item.count) / biggestCount);
      const sparsePositions = distinct === 2 ? [[50, 50], [50, 16]]
        : distinct === 3 ? [[50, 50], [36, 19], [69, 81]] : null;
      return {
        text: item.text,
        count: item.count,
        fontSize: Math.max(16, Math.min(82, Math.round(baseSize * (0.62 + 0.38 * popularity)))),
        x: sparsePositions ? sparsePositions[index][0] : index === 0 ? 50 : Math.round(50 + Math.cos(angle) * radius),
        y: sparsePositions ? sparsePositions[index][1] : index === 0 ? 50 : Math.round(50 + Math.sin(angle) * radius * 0.82),
      };
    });
};

window.renderWordCloud = function renderWordCloud(values) {
  const cloud = document.createElement('div');
  cloud.className = `cloud-map ${values.length <= 3 ? 'cloud-sparse' : values.length <= 12 ? 'cloud-medium' : 'cloud-dense'}`;
  cloud.setAttribute('aria-label', 'Облако ответов участников');
  for (const [index, item] of window.layoutWordCloud(values).entries()) {
    const word = document.createElement('span');
    word.className = `cloud-word${index === 0 ? ' cloud-word-center' : ''}`;
    word.textContent = item.text;
    word.title = `${item.text}: ${item.count}`;
    word.style.left = `${item.x}%`;
    word.style.top = `${item.y}%`;
    word.style.setProperty('--cloud-size', `${item.fontSize}px`);
    cloud.append(word);
  }
  if (values.length > 40) {
    const more = document.createElement('small');
    more.className = 'cloud-more';
    more.textContent = `Показаны 40 самых частых слов из ${values.length}`;
    cloud.append(more);
  }
  return cloud;
};
