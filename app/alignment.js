/* Monotonic alignment of supplied lyrics to recognizer timestamps. */
(function (root) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', {granularity: 'grapheme'}) : null;
  const graphemes = text => segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);
  const normalize = text => Array.from(text.normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 96))
    .replace(/[^\p{L}\p{N}]/gu, ''));

  function align(lines, chunks, duration) {
    const words = chunks.flatMap(({text, timestamp, captionIndex}) => {
      const [start, end] = timestamp || [];
      if (typeof text !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
      const from = Math.max(0, start);
      const to = Math.min(end, duration);
      return to > from ? [{text, start: from, end: to, captionIndex}] : [];
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

  function vocalRanges(duration, intro, intervals) {
    if (!Number.isFinite(intro) || intro < 0 || intro >= duration) throw Error('歌い出しを曲の長さより前にしてください。');
    const blocked = [];
    for (const entry of intervals.split(/[、,\n]+/)) {
      if (!entry.trim()) continue;
      const match = entry.trim().match(/^(\d+(?:\.\d+)?)\s*[-〜～–]\s*(\d+(?:\.\d+)?)$/);
      if (!match || +match[1] >= +match[2] || +match[2] > duration) throw Error('間奏・アウトロは曲の範囲内で 32.5-47.2 のように指定してください。');
      blocked.push([+match[1], +match[2]]);
    }
    blocked.sort((a, b) => a[0] - b[0]);
    const allowed = [];
    let start = intro;
    for (const [from, to] of blocked) {
      if (from > start) allowed.push({start, end: from});
      start = Math.max(start, to);
    }
    if (start < duration) allowed.push({start, end: duration});
    return allowed;
  }

  function transcribe(chunks) {
    const lines = [];
    let row;
    for (const {text, timestamp, breakBefore} of chunks) {
      const [start, end] = timestamp || [];
      if (!text?.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (!row || breakBefore || start - row.end >= .72 || /[。！？!?]$/.test(row.text.trimEnd()) || row.text.length >= 24) {
        row = {text: '', start, end, words: [], characters: [], coverage: 1};
        lines.push(row);
      }
      row.text += text.replace(/[\r\n]+/g, ' ');
      row.end = Math.max(row.end, end);
      row.words.push({text: text.trim(), start, end});
    }
    return lines.map(line => ({...line, text: line.text.trim()}));
  }

  function correctSubtitles(lyrics, subtitles, duration) {
    const result = align(lyrics, subtitles.flatMap((subtitle, captionIndex) => subtitle.words.map(word => ({
      text: word.text, timestamp: [word.start, word.end], captionIndex,
    }))), duration);
    const captionUse = new Map();
    const sources = result.lines.map(line => {
      const ids = [...new Set(line.words.map(word => word.captionIndex))];
      for (const id of ids) captionUse.set(id, (captionUse.get(id) || 0) + 1);
      return ids;
    });
    result.lines.forEach((line, index) => {
      const ids = sources[index];
      line.recognizedText = line.words.map(word => word.text).join(' ');
      // A row that spans distant recognition fragments has no trustworthy start.
      const fragmented = line.words.some((word, i) => i && word.start - line.words[i - 1].end > 2);
      if (fragmented) {
        Object.assign(line, {start: null, end: null, coverage: 0, characters: []});
        return;
      }
      if (ids.length !== 1 || captionUse.get(ids[0]) !== 1 || line.coverage < .55) return;
      const caption = subtitles[ids[0]];
      const start = Math.max(result.lines[index - 1]?.end ?? 0, caption.start, line.start - .45);
      const end = Math.min(result.lines[index + 1]?.start ?? duration, caption.end, line.end + .45);
      if (start < line.start) {
        const first = line.characters.findIndex(character => character.matched);
        for (let i = 0; i < first; i++) {
          line.characters[i].start = start + (line.start - start) * i / first;
          line.characters[i].end = start + (line.start - start) * (i + 1) / first;
        }
        line.start = start;
      }
      if (end > line.end) {
        let last = line.characters.length - 1;
        while (last >= 0 && !line.characters[last].matched) last--;
        const count = line.characters.length - last - 1;
        for (let i = 0; i < count; i++) {
          const character = line.characters[last + 1 + i];
          character.start = line.end + (end - line.end) * i / count;
          character.end = line.end + (end - line.end) * (i + 1) / count;
        }
        line.end = end;
      }
    });
    const total = result.lines.reduce((sum, line) => sum + normalize(line.text).length, 0);
    result.coverage = result.lines.reduce((sum, line) => sum + normalize(line.text).length * line.coverage, 0) / total;
    return result;
  }

  function srt(subtitles) {
    function time(seconds) {
      const ms = Math.max(0, Math.round(seconds * 1000));
      const [hours, minutes, secs] = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60];
      return [hours, minutes, secs].map(value => String(value).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
    }
    return subtitles.map((row, index) => `${index + 1}\r\n${time(row.start)} --> ${time(row.end)}\r\n${row.text}\r\n`).join('\r\n');
  }

  const api = {align, graphemes, vocalRanges, transcribe, correctSubtitles, srt};
  if (typeof module !== 'undefined') module.exports = api;
  else root.MVAlignment = api;
})(globalThis);
