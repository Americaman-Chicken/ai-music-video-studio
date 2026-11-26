/* Canvas brush outlines derived from KanjiVG stroke centerlines. */
(function (root) {
  const cache = new Map();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  function brushOutline(samples, count, seed) {
    const outline = new Path2D();
    const left = [], right = [];
    for (let i = 0; i < count; i++) {
      const point = samples[i];
      const before = samples[Math.max(0, i - 1)];
      const after = samples[Math.min(count - 1, i + 1)];
      const dx = after.x - before.x, dy = after.y - before.y;
      const norm = Math.hypot(dx, dy) || 1;
      const angleWeight = Math.abs(dx / norm) * .44 + .73;
      const pressure = Math.min(1, (i + 1) / 3) * Math.min(1, (samples.length - i) / 3);
      const grain = Math.sin(i * 1.9 + seed * 1.3) * .55;
      const width = .65 + (4.1 + grain) * pressure * angleWeight;
      const offsetX = -dy / norm * width, offsetY = dx / norm * width;
      left.push([point.x + offsetX, point.y + offsetY]);
      right.push([point.x - offsetX * .86, point.y - offsetY * .86]);
    }
    outline.moveTo(...left[0]);
    for (const point of left.slice(1)) outline.lineTo(...point);
    for (let i = right.length - 1; i >= 0; i--) outline.lineTo(...right[i]);
    outline.closePath();
    return outline;
  }

  function strokesFor(character) {
    const key = character.normalize('NFC').replace(/[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, '');
    if (cache.has(key)) return cache.get(key);
    const paths = root.MVStrokeData?.[key];
    if (!Array.isArray(paths)) return null;
    const strokes = paths.map((path, index) => {
      svg.setAttribute('d', path);
      const length = svg.getTotalLength();
      const segments = Math.max(2, Math.ceil(length / 2));
      const samples = Array.from({length: segments + 1}, (_, i) => svg.getPointAtLength(length * i / segments));
      return {samples, total: brushOutline(samples, samples.length, index)};
    });
    if (cache.size >= 500) cache.clear();
    cache.set(key, strokes);
    return strokes;
  }

  function paint(context, character, size, reveal, color, shadow) {
    const strokes = strokesFor(character);
    if (!strokes) return false;
    const count = reveal * strokes.length;
    context.save();
    context.scale(size / 100, size / 100);
    context.translate(-54.5, -54.5);
    context.shadowColor = shadow;
    context.shadowOffsetX = Math.max(1, size * .025);
    context.shadowOffsetY = Math.max(1, size * .03);
    context.fillStyle = color;
    for (let i = 0; i < Math.ceil(count); i++) {
      const stroke = strokes[i];
      const partial = count - i;
      const visible = Math.floor(stroke.samples.length * partial);
      if (partial >= 1) context.fill(stroke.total);
      else if (visible >= 2) context.fill(brushOutline(stroke.samples, visible, i));
    }
    context.restore();
    return true;
  }

  root.MVInk = {paint, has: character => Boolean(strokesFor(character))};
})(globalThis);
