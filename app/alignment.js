/* Monotonic alignment of supplied lyrics to recognizer timestamps. */
(function (root) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', {granularity: 'grapheme'}) : null;
  const graphemes = text => segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);
  const normalize = text => Array.from(text.normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 96))
    .replace(/[^\p{L}\p{N}]/gu, ''));

  function align(lines, chunks, duration) {
    const words = chunks.flatMap(({text, timestamp}) => {
      const [start, end] = timestamp || [];
      if (typeof text !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      const from = Math.max(0, start);
      const to = Math.min(end, duration);
      return to > from ? [{text, start: from, end: to}] : [];
    }).sort((a, b) => a.start - b.start);
    const heard = words.flatMap(word => {
      const chars = normalize(word.text);
      return chars.map((char, index) => ({
        char, word,
        start: word.start + (word.end - word.start) * index / chars.length,
        end: word.start + (word.end - word.start) * (index + 1) / chars.length,
      }));
    });
    const rows = lines.map(text => ({text, characters: graphemes(text).map(text => ({text}))}));
    const expected = rows.flatMap(row => row.characters.flatMap(g => normalize(g.text).map(char => ({char, g}))));
    const width = heard.length + 1;
    if (!heard.length || !expected.length) throw Error('照合できる歌唱または歌詞がありません');
    if ((expected.length + 1) * width > 16_000_000) throw Error('歌詞が長すぎます。曲を分割して同期してください');
    const trace = new Uint8Array((expected.length + 1) * width);
    let previous = new Float32Array(width);
    let current = new Float32Array(width);
    for (let i = 1; i <= expected.length; i++) {
      current[0] = 0;
      for (let j = 1; j < width; j++) {
        const match = expected[i - 1].char === heard[j - 1].char
          ? previous[j - 1] + 1 - .1 * Math.abs(i / expected.length - j / heard.length)
          : -1;
        const up = previous[j], left = current[j - 1];
        const direction = match >= up && match >= left ? 1 : up >= left ? 2 : 3;
        current[j] = direction === 1 ? match : direction === 2 ? up : left;
        trace[i * width + j] = direction;
      }
      [previous, current] = [current, previous];
    }
    const matched = new Map();
    let count = 0;
    for (let i = expected.length, j = heard.length; i && j;) {
      const direction = trace[i * width + j];
      if (direction === 1) {
        const {g} = expected[--i], hit = heard[--j];
        const hits = matched.get(g) || [];
        hits.unshift(hit);
        matched.set(g, hits);
        count++;
      } else if (direction === 2) i--;
      else j--;
    }
    let lastEnd = 0;
    for (const row of rows) {
      const hits = row.characters.flatMap(g => matched.get(g) || []);
      row.coverage = hits.length / Math.max(1, normalize(row.text).length);
      row.start = hits.length ? Math.max(lastEnd, hits[0].start) : null;
      row.end = hits.length ? Math.max(row.start, hits[hits.length - 1].end) : null;
      row.words = [...new Set(hits.map(hit => hit.word))];
      if (!hits.length) continue;
      lastEnd = row.end;
      let cursor = row.start;
      for (const g of row.characters) {
        const own = matched.get(g);
        g.matched = Boolean(own);
        g.estimated = true;
        if (!own) continue;
        g.start = Math.max(cursor, Math.min(row.end, own[0].start));
        g.end = Math.max(g.start, Math.min(row.end, own[own.length - 1].end));
        cursor = g.end;
      }
      // Distribute a gap across missing sung graphemes. Punctuation consumes no time.
      cursor = row.start;
      for (let i = 0; i < row.characters.length;) {
        const g = row.characters[i];
        if (g.matched) {
          cursor = g.end;
          i++;
          continue;
        }
        let next = i + 1;
        while (next < row.characters.length && !row.characters[next].matched) next++;
        const gap = row.characters.slice(i, next);
        const weights = gap.map(character => normalize(character.text).length);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const interval = (row.characters[next]?.start ?? row.end) - cursor;
        const start = cursor;
        let elapsed = 0;
        gap.forEach((character, index) => {
          character.start = cursor;
          elapsed += weights[index];
          cursor = total ? start + interval * elapsed / total : start;
          character.end = cursor;
        });
        i = next;
      }
    }
    return {method: 'whisper_word_character_interpolation', coverage: count / expected.length, lines: rows};
  }

  const api = {align, graphemes};
  if (typeof module !== 'undefined') module.exports = api;
  else root.MVAlignment = api;
})(globalThis);
