/* Shared by preview, WebCodecs export and real-time export. */
(function (root) {
  const modes = ['poster', 'vertical', 'arc', 'split'];
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
    const mode = frame.mode === 'auto' ? modes[index % modes.length] : frame.mode;
    const color = palettes[style] || palettes.glitch;
    const short = Math.min(w, h);
    const vertical = mode === 'vertical';
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
    const level = Math.min(1.3, strength);
    const direction = index % 2 ? -1 : 1;

    context.save();
    context.translate(w * .5, h * .52);
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
      const accent = (i + index) % 4 === 0;
      const pop = frame.animation === 'bounce' ? Math.sin(reveal * Math.PI) * .24 : 0;
      const bounce = pulse * level * (accent ? .27 : .11) + pop;
      const rotation = mode === 'arc' ? along * .37 : (mode === 'vertical' ? .14 : .22) * Math.sin(i * 2.1 + index);
      const stretch = accent ? 1.14 : (i % 3 === 1 ? .84 : 1);
      context.save();
      context.translate(x + direction * fly * short * .24, y + (i % 2 ? -1 : 1) * (fly * short * .18 + bounce * font * .28));
      context.rotate(rotation + direction * fly * .8);
      context.scale((.6 + .4 * reveal + bounce) * stretch, (.68 + .32 * reveal + bounce) * (accent ? 1.18 : 1));
      context.globalAlpha = reveal * opacity;
      context.font = `${accent ? 900 : 800} ${font}px ${i % 5 === 3 ? 'serif' : 'sans-serif'}`;
      context.strokeStyle = color[3];
      context.lineWidth = Math.max(1, font * .085);
      context.strokeText(glyph, 0, 0);
      context.fillStyle = progress !== null && i < progress * characters.length ? color[1] : color[accent ? 2 : 0];
      context.fillText(glyph, 0, 0);
      context.restore();
    }
    context.restore();
  }

  root.MVTypography = {paint};
})(globalThis);
