/* Shared by preview, WebCodecs export and real-time export. */
(function (root) {
  const approaches = {
    fine: ['margin', 'vertical', 'arc'],
    round: ['arc', 'margin', 'split'],
    heavy: ['hero', 'poster', 'split'],
    sharp: ['stairs', 'split', 'vertical'],
  };
  function arrange(text, index, layout, brush, cues) {
    const inks = {minimal:'fine', summer:'round', dark:'heavy', glitch:'sharp'};
    let profile = brush;
    if (!profile || profile === 'auto') {
      if (cues.quiet || (cues.energy !== null && cues.energy < .26)) profile = 'fine';
      else if (cues.chorus || (cues.energy !== null && cues.energy > .67 && cues.motion < .35)) profile = 'heavy';
      else if (cues.shake || cues.motion > .41) profile = 'sharp';
      else profile = cues.energy === null ? inks[cues.style] || 'round' : 'round';
    }
    const options = approaches[profile] || approaches.round;
    let hash = index;
    for (const char of text) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
    const choice = options[hash % options.length];
    return {brush:profile, mode:layout === 'auto' ? choice : layout};
  }
  const palettes = {
    glitch: ['#f9f4ff', '#83ffce', '#eaa6ff', '#261543'],
    dark: ['#fff3de', '#ffb59e', '#f3d17a', '#321b32'],
    summer: ['#fff8d8', '#b9f8ff', '#ffd093', '#184052'],
    minimal: ['#fffdf6', '#d0e5d9', '#f7d7cb', '#303635'],
  };
  const clamp = value => Math.max(0, Math.min(1, value));

  function paint(context, w, h, frame) {
    const {characters, index, elapsed, length, pulse, strength, style, progress} = frame;
    if (!characters.length) return;
    const {mode, brush} = frame;
    const color = palettes[style] || palettes.glitch;
    const short = Math.min(w, h);
    const vertical = mode === 'vertical';
    const hero = mode === 'hero';
    const heroIndex = hero ? characters.findIndex(character => /[\p{L}\p{N}]/u.test(character)) : -1;
    const capacity = vertical ? 8 : (w < h ? 8 : 13);
    const groups = Math.ceil(characters.length / capacity);
    const columns = Math.ceil(characters.length / groups);
    const width = w * (vertical ? .6 : .82);
    const height = h * .66;
    const stepX = width / (vertical ? groups : columns);
    const stepY = height / (vertical ? columns : groups);
    const font = Math.min(short * (characters.length <= 4 ? .2 : .139), stepX * .9, stepY * .78);
    const entrance = Math.min(.42, length * .38);
    const exit = Math.min(.18, length * .2);
    const opacity = clamp((length - elapsed) / Math.max(.01, exit));
    const level = Math.min(1.3, strength) * (brush === 'fine' ? .38 : brush === 'round' ? .68 : 1);
    const direction = index % 2 ? -1 : 1;

    context.save();
    context.translate(w * .5, h * (mode === 'margin' ? (direction > 0 ? .69 : .35) : .52));
    if (mode === 'poster' || mode === 'split') {
      const flick = pulse * level;
      context.save();
      context.rotate(direction * .1);
      context.globalAlpha = (.36 + flick * .14) * opacity;
      context.fillStyle = color[3];
      const band = Math.min(height, Math.max(font * 1.65, groups * font * 1.2));
      if (mode === 'split') {
        context.fillRect(-w * .5, -band * .55, w * .66, band * .49);
        context.fillRect(-w * .16, band * .06, w * .66, band * .49);
      } else {
        context.fillRect(-w * .5, -band / 2, w, band);
      }
      context.restore();
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    for (let i = 0; i < characters.length; i++) {
      const glyph = characters[i];
      if (/^\s+$/u.test(glyph)) continue;
      const group = Math.floor(i / columns);
      const cell = i % columns;
      const count = Math.min(columns, characters.length - group * columns);
      const along = count > 1 ? cell / (count - 1) * 2 - 1 : 0;
      const delay = entrance * .36 * i / characters.length;
      const reveal = frame.animation === 'type' ? Number(elapsed >= entrance * i / characters.length)
        : clamp((elapsed - delay) / Math.max(.01, entrance * .64));
      const fly = frame.animation === 'fade' ? 0 : (1 - reveal) ** 3;
      let x = vertical ? (groups / 2 - group - .5) * stepX : (cell - (count - 1) / 2) * stepX;
      let y = vertical ? (cell - (count - 1) / 2) * stepY : (group - (groups - 1) / 2) * stepY * .74;
      if (mode === 'arc') y += (along * along - .48) * short * .20;
      if (mode === 'split') y += (along < 0 ? -1 : 1) * direction * Math.min(stepY * .17, short * .12);
      if (vertical) x += Math.sin(cell * 1.1) * font * .24 * direction;
      if (mode === 'stairs') y += along * direction * Math.min(short * .29, stepY * .35);
      if (mode === 'margin') {
        const run = count * stepX;
        x += direction * Math.min(w * .12, Math.max(0, (w * .87 - run) / 2));
      }
      let size = font;
      if (heroIndex >= 0) {
        if (i === heroIndex) {
          x = 0;
          y = -h * .14;
          size = Math.min(h * .43, w * .68);
        } else {
          y = h * .24 + (group - (groups - 1) / 2) * Math.min(stepY * .28, short * .1);
          size *= .66;
        }
      }
      const accent = i === heroIndex || (i + index) % 4 === 0;
      const pop = frame.animation === 'bounce' ? Math.sin(reveal * Math.PI) * .24 : 0;
      const bounce = pulse * level * (accent ? .27 : .11) + pop;
      const turn = brush === 'fine' ? .055 : brush === 'round' ? .14 : .27;
      const rotation = (mode === 'arc' ? along * .37 : 0) + turn * Math.sin(i * 2.1 + index);
      const stretch = accent ? 1.14 : (i % 3 === 1 ? .84 : 1);
      context.save();
      context.translate(x + direction * fly * short * .24, y + (i % 2 ? -1 : 1) * (fly * short * .18 + bounce * font * .28));
      context.rotate(rotation + direction * fly * .8);
      context.scale((.6 + .4 * reveal + bounce) * stretch, (.68 + .32 * reveal + bounce) * (accent ? 1.18 : 1));
      context.globalAlpha = reveal * opacity;
      const fill = progress !== null && i < progress * characters.length ? color[1] : color[accent ? 2 : 0];
      const brushReveal = frame.animation === 'type' ? reveal : Math.min(1, reveal * 1.35);
      if (!MVInk.paint(context, glyph, size * 1.17, brushReveal, fill, color[3], false, brush)) {
        context.font = `${brush === 'fine' ? 400 : 900} ${size}px sans-serif`;
        context.strokeStyle = color[3];
        context.lineWidth = Math.max(1, size * .085);
        context.strokeText(glyph, 0, 0);
        context.fillStyle = fill;
        context.fillText(glyph, 0, 0);
      }
      context.restore();
    }
    context.restore();
  }

  const api = {paint, arrange};
  if (typeof module !== 'undefined') module.exports = api;
  else root.MVTypography = api;
})(globalThis);
