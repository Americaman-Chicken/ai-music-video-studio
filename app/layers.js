/* Frame-based effects shared by preview and both video export paths. */
(function (root) {
  const modes = ['none', 'tiles', 'mask', 'glitch'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function barAt(time, bpm, origin = 0) {
    const count = Math.max(0, (time - origin) * bpm / 240);
    return {index: Math.floor(count), position: count % 1};
  }
  function modeAt(mode, bar) {
    return mode === 'auto' ? modes[bar.index % modes.length] : mode;
  }
  function bandOffset(index, bar, amplitude) {
    const value = Math.sin((index + 1) * 78.23 + (bar + 1) * 23.51) * 43758.54;
    return ((value - Math.floor(value)) * 2 - 1) * amplitude;
  }
  function surface(canvas, w, h) {
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, w, h);
    return context;
  }

  let layers, foregroundCache;
  function paintForeground(context, image, keyGreen, w, h, time) {
    if (!image) return;
    let source = image;
    if (keyGreen) {
      if (foregroundCache?.image !== image) {
        const keyed = document.createElement('canvas');
        const c = surface(keyed, image.width, image.height);
        c.drawImage(image, 0, 0);
        const pixels = c.getImageData(0, 0, keyed.width, keyed.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
          const excess = g - Math.max(r, b);
          const opacity = g < 65 ? 1 : 1 - clamp((excess - 22) / 53, 0, 1);
          pixels.data[i + 3] *= opacity;
          pixels.data[i + 1] = g - Math.max(0, excess) * (1 - opacity);
        }
        c.putImageData(pixels, 0, 0);
        foregroundCache = {image, keyed};
      }
      source = foregroundCache.keyed;
    }
    const zoom = Math.max(w / source.width, h / source.height) * 1.026;
    const width = source.width * zoom, height = source.height * zoom;
    context.drawImage(source, (w - width) / 2 + Math.sin(time * .8) * w * .008,
      (h - height) / 2, width, height);
  }

  function paint(context, options, background, lyrics) {
    const {w, h, time, bar, strength, glyph, layer, foreground, keyGreen} = options;
    const mode = modeAt(options.mode, bar);
    if (!layers) layers = [document.createElement('canvas'), document.createElement('canvas')];
    const [art, combined] = layers;
    const artContext = surface(art, w, h);
    const stage = surface(combined, w, h);
    const level = clamp(strength, 0, 1);
    const envelope = Math.sin(Math.PI * bar.position);
    if (layer !== 'lyrics') {
      background(artContext);
      stage.fillStyle = '#141324';
      stage.fillRect(0, 0, w, h);
      if (mode === 'tiles' && layer === 'all') {
        const cellW = w / 4, cellH = h / 4;
        stage.drawImage(art, 0, 0);
        for (let i = 0; i < 16; i++) {
          const x = i % 4 * cellW, y = Math.floor(i / 4) * cellH;
          const shift = envelope * level;
          stage.drawImage(art, x, y, cellW, cellH, x + bandOffset(i, bar.index, cellW * .37 * shift),
            y + bandOffset(i + 16, bar.index, cellH * .18 * shift), cellW, cellH);
        }
      } else if (mode === 'wave' && layer === 'all') {
        stage.drawImage(art, 0, 0);
        for (let i = 0; i < 24; i++) {
          const y = Math.round(i * h / 24), end = Math.round((i + 1) * h / 24);
          const distance = (Math.sin(i * .34 + time * 2) + Math.sin(i * .21 - time * 1.4)) * w * .021;
          stage.drawImage(art, 0, y, w, end - y, distance * level, y, w, end - y);
        }
      } else if (mode === 'mask' && glyph && layer === 'all') {
        const size = Math.min(w, h) * (1.06 + .12 * envelope * level);
        stage.clearRect(0, 0, w, h);
        stage.save();
        stage.translate(w / 2, h / 2);
        if (!root.MVInk.paint(stage, glyph, size, 1, '#fff', 'transparent', true)) {
          stage.font = `900 ${size}px sans-serif`;
          stage.textAlign = 'center';
          stage.textBaseline = 'middle';
          stage.fillStyle = '#fff';
          stage.fillText(glyph, 0, 0);
        }
        stage.restore();
        stage.globalCompositeOperation = 'source-in';
        stage.drawImage(art, 0, 0);
        stage.globalCompositeOperation = 'destination-over';
        stage.globalAlpha = .25;
        stage.drawImage(art, 0, 0);
        stage.globalAlpha = 1;
        stage.fillStyle = '#100e20';
        stage.fillRect(0, 0, w, h);
        stage.globalCompositeOperation = 'source-over';
      } else {
        stage.drawImage(art, 0, 0);
      }
      paintForeground(stage, foreground, keyGreen, w, h, time);
    } else {
      stage.fillStyle = '#141324';
      stage.fillRect(0, 0, w, h);
    }
    if (layer !== 'art') lyrics(stage);
    context.drawImage(combined, 0, 0);
    if (mode === 'glitch' && layer === 'all') {
      const shift = clamp((bar.position - .74) / .12, 0, 1) * clamp((1 - bar.position) / .10, 0, 1) * level;
      for (let i = 0; i < 10 && shift > 0; i++) {
        const y = Math.round(i * h / 10), end = Math.round((i + 1) * h / 10);
        const x = Math.round(bandOffset(i, bar.index, w * .055 * shift));
        context.drawImage(combined, 0, y, w, end - y, x, y, w, end - y);
      }
    }
  }

  function inspectBrightness() {
    const sample = document.createElement('canvas');
    sample.width = 16;
    sample.height = 9;
    const context = sample.getContext('2d', {willReadFrequently: true});
    let previous, lastDirection = 0, peak = 0;
    const reversals = [];
    return {
      frame(canvas, time) {
        context.drawImage(canvas, 0, 0, 16, 9);
        const pixels = context.getImageData(0, 0, 16, 9).data;
        const values = new Float32Array(16 * 9);
        let lighter = 0, darker = 0;
        for (let i = 0; i < values.length; i++) {
          values[i] = .2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2];
          if (previous) {
            const change = values[i] - previous[i];
            if (change > 44) lighter++;
            if (change < -44) darker++;
          }
        }
        previous = values;
        const direction = lighter >= 36 ? 1 : darker >= 36 ? -1 : 0;
        if (!direction) return;
        if (lastDirection && lastDirection !== direction) {
          reversals.push(time);
          while (reversals.length && time - reversals[0] >= 1) reversals.shift();
          peak = Math.max(peak, reversals.length);
        }
        lastDirection = direction;
      },
      peak: () => peak,
    };
  }

  const api = {barAt, modeAt, bandOffset, paint, inspectBrightness};
  if (typeof module !== 'undefined') module.exports = api;
  else root.MVLayers = api;
})(globalThis);
