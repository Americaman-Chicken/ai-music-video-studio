/* Canvas brush outlines derived from KanjiVG stroke centerlines. */
(function (root) {
  const cache = new Map();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  const pens = {
    classic: {width:4.1, taper:3, grain:.55, slant:0, bend:0, split:.86},
    fine: {width:1.75, taper:5, grain:.15, slant:.15, bend:2, split:.94},
    round: {width:3.65, taper:2, grain:.20, slant:-.07, bend:-5, split:1},
    heavy: {width:7.0, taper:2, grain:.55, slant:.02, bend:2, split:.72},
    sharp: {width:4.5, taper:7, grain:1.25, slant:.26, bend:5, split:.58},
  };
  function brushOutline(samples, count, seed, profile) {
    const pen = pens[profile] || pens.classic;
    const outline = new Path2D();
    const left = [], right = [];
    for (let i = 0; i < count; i++) {
      const point = samples[i];
      const before = samples[Math.max(0, i - 1)];
      const after = samples[Math.min(count - 1, i + 1)];
      const dx = after.x - before.x, dy = after.y - before.y;
      const norm = Math.hypot(dx, dy) || 1;
      const angleWeight = Math.abs(dx / norm) * .44 + .73;
      const pressure = Math.min(1, (i + 1) / pen.taper) * Math.min(1, (samples.length - i) / pen.taper);
      const grain = Math.sin(i * 1.9 + seed * 1.3) * pen.grain;
      const width = .65 + (pen.width + grain) * pressure * angleWeight;
      const offsetX = -dy / norm * width, offsetY = dx / norm * width;
      const x = point.x + (54.5 - point.y) * pen.slant;
      const y = point.y + Math.sin(point.x * Math.PI / 109) * pen.bend;
      left.push([x + offsetX, y + offsetY]);
      right.push([x - offsetX * pen.split, y - offsetY * pen.split]);
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
    const strokes = paths.map(path => {
      svg.setAttribute('d', path);
      const length = svg.getTotalLength();
      const segments = Math.max(2, Math.ceil(length / 2));
      const samples = Array.from({length: segments + 1}, (_, i) => svg.getPointAtLength(length * i / segments));
      return {samples, outlines: Object.create(null)};
    });
    if (cache.size >= 500) cache.clear();
    cache.set(key, strokes);
    return strokes;
  }

  function paint(context, character, size, reveal, color, shadow, heavy = false, profile = 'classic') {
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
    context.strokeStyle = color;
    context.lineJoin = 'round';
    context.lineWidth = 4.5;
    for (let i = 0; i < Math.ceil(count); i++) {
      const stroke = strokes[i];
      const partial = count - i;
      const visible = Math.floor(stroke.samples.length * partial);
      if (partial >= 1) {
        const outline = stroke.outlines[profile] || (stroke.outlines[profile] = brushOutline(stroke.samples, stroke.samples.length, i, profile));
        context.fill(outline);
        if (heavy) context.stroke(outline);
      }
      else if (visible >= 2) context.fill(brushOutline(stroke.samples, visible, i, profile));
    }
    context.restore();
    return true;
  }

  root.MVInk = {paint, has: character => Boolean(strokesFor(character))};
})(globalThis);
