const assert=require('node:assert/strict'), c=require('../app/core.js');
assert.equal(c.stamp(59.999),'[01:00.00]');assert.deepEqual(c.parseLrc('[00:01.00][00:03.00] あ\n[ar:abc]'),[{start:1,text:'あ'},{start:3,text:'あ'}]);
const p=c.scenes('白黒\n10-20秒: 画像2 ズームイン\nサビ: 揺れ',[{start:20,end:30,kind:'サビ'}],25);assert.equal(p.scenes.length,2);assert.equal(p.scenes[0].image,1);assert.equal(p.scenes[1].end,25);assert.equal(p.base.mono,true);
const sr=8000,x=new Float32Array(sr*12);for(let i=0;i<x.length;i++)if(i%(sr/2)<sr*.025)x[i]=Math.sin(i*.6)*.8;const a=c.analyze(x,sr);assert.ok(Math.abs(a.bpm-120)<=3,JSON.stringify(a));assert.ok(a.beats.length>20);assert.ok(c.analyze(new Float32Array(sr*2),sr).confidence<.08);console.log('core regression passed',a.bpm);

const {align} = require('../app/alignment.js');
const synced = align(['なつの歌', '君へ', 'なつの歌'], [
  {text: 'ナツノ歌', timestamp: [1, 2]},
  {text: '君へ', timestamp: [3, 4]},
  {text: 'なつの歌', timestamp: [6, 7]},
], 8);
assert.equal(synced.coverage, 1);
assert.deepEqual(synced.lines.map(line => line.start), [1, 3, 6]);
assert.ok(synced.lines.every(line => line.characters.every(character => character.estimated)));
assert.equal(align(['猫'], [{text: '犬', timestamp: [1, 2]}], 3).coverage, 0);
assert.throws(() => align(['猫'], [{text: '猫', timestamp: [0, null]}], 3));
assert.equal(c.imageIndex(8, {sections: [{start: 0}, {start: 6}]}, 4, 3), 1);
assert.equal(c.imageIndex(4, null, 4, 2), 1);
const labels = c.labelSections([
  {start: 0, end: 5, level: .5, repetition: .1},
  {start: 5, end: 10, level: .5, repetition: .2},
  {start: 10, end: 15, level: .8, repetition: .95},
  {start: 15, end: 20, level: .3, repetition: .1},
], [{start: 6, end: 13}]);
assert.deepEqual(labels.map(section => section.kind), ['イントロ', 'Bメロ', 'サビ候補', 'アウトロ']);

const long = new Float32Array(sr * 180);
for (let i = 0; i < long.length; i++) if (i % (sr / 2) < sr * .025) long[i] = Math.sin(i * .6) * .8;
const longAnalysis = c.structure(long, sr, c.analyze(long, sr));
assert.ok(Math.abs(longAnalysis.bpm - 120) <= 3);
assert.ok(longAnalysis.beats.length >= 350);
assert.ok(longAnalysis.sections.length > 4);
assert.ok(longAnalysis.sections.every(section => Number.isFinite(section.repetition)));

const gapped = align(['夏の、夜の歌'], [
  {text: '夏', timestamp: [1, 1.5]},
  {text: '歌', timestamp: [3, 3.5]},
], 4).lines[0];
assert.deepEqual(gapped.characters.map(({start, end}) => [start, end]), [
  [1, 1.5], [1.5, 2], [2, 2], [2, 2.5], [2.5, 3], [3, 3.5],
]);
assert.equal(gapped.coverage, .4);

const {vocalRanges, transcribe} = require('../app/alignment.js');
assert.deepEqual(vocalRanges(54, 8, '4-6\n20-24、21-30\n48-54'), [
  {start: 8, end: 20}, {start: 30, end: 48},
]);
assert.throws(() => vocalRanges(54, 8, '30-20'));
assert.deepEqual(transcribe([
  {text: '夜の', timestamp: [8, 8.3]}, {text: '歌', timestamp: [8.3, 8.6]},
  {text: '光', timestamp: [8.9, 9.2], breakBefore: true},
  {text: '次へ', timestamp: [13.7, 14.2]},
]).map(({text,start,end}) => ({text,start,end})), [
  {text:'夜の歌',start:8,end:8.6}, {text:'光',start:8.9,end:9.2}, {text:'次へ',start:13.7,end:14.2},
]);
