/* Pure, local analysis and scene planning; no network dependencies. */
(function(root){
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function parseLrc(s){return s.split(/\r?\n/).flatMap(line=>{const tags=[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)],text=line.replace(/^\s*(?:\[\d+:\d+(?:\.\d+)?\]\s*)+/,'').trim();return text?tags.filter(m=>+m[2]<60).map(m=>({start:+m[1]*60+ +m[2],text})):[]}).sort((a,b)=>a.start-b.start)}
function stamp(t){const cs=Math.round(Math.max(0,t)*100);return `[${String(Math.floor(cs/6000)).padStart(2,'0')}:${(cs%6000/100).toFixed(2).padStart(5,'0')}]`}
function settings(n){return {mono:/白黒|モノクロ/.test(n),shake:/揺れ|激し|振動/.test(n),quiet:/静か|穏やか|ゆっくり/.test(n),flash:/フラッシュ|点滅/.test(n),vignette:/周辺減光|周辺を暗|ビネット/.test(n),center:/中央|真ん中/.test(n),noText:/歌詞なし|歌詞を表示しない/.test(n),camera:/ズームアウト|引いて/.test(n)?'out':/ズーム|近づ/.test(n)?'in':/傾き|傾け/.test(n)?'drift':/横移動|パン/.test(n)?'pan':'default',animation:/タイプライター|一文字ずつ/.test(n)?'type':/フェード/.test(n)?'fade':/跳ね|バウンス/.test(n)?'bounce':'default'}}
function scenes(notes,sections,duration){const base=settings(notes.split(/\n/).filter(x=>!/^\s*(?:\d+(?:\.\d+)?\s*[-–〜]|Aメロ|Bメロ|サビ|間奏|イントロ|アウトロ)/i.test(x)).join('\n'));const result=[];for(const line of notes.split('\n')){const m=line.match(/^\s*(\d+(?:\.\d+)?)\s*[-–〜]\s*(\d+(?:\.\d+)?)\s*秒?\s*[:：]?\s*(.*)/);const k=line.match(/^\s*(Aメロ|Bメロ|サビ|間奏|イントロ|アウトロ)\s*[:：]\s*(.*)/i);const ranges=m?[{start:+m[1],end:+m[2]}]:k?sections.filter(s=>s.kind===k[1]||s.kind===k[1]+'候補'):[];const phrase=m?m[3]:k?k[2]:'';for(const r of ranges){const start=clamp(r.start,0,duration),end=clamp(r.end,0,duration);if(end>start)result.push({start,end,...settings(phrase),image:Math.max(0,(+(phrase.match(/画像\s*(\d+)/)?.[1]||0))-1),explicitImage:/画像\s*\d+/.test(phrase)})}}return {base,scenes:result}}
function analyze(x,sr){const hop=Math.max(1,Math.round(sr*.01)),env=[],raw=[],features=[];let prev=0;for(let i=0;i<x.length;i+=hop){let sum=0,diff=0,n=0;for(let j=i;j<Math.min(i+hop,x.length);j+=4){sum+=x[j]**2;if(j>=4)diff+=(x[j]-x[j-4])**2;n++}const v=Math.sqrt(sum/Math.max(1,n));raw.push(v);features.push(Math.sqrt(diff/Math.max(1,n))/(v+.00001));const e=Math.log1p(v*100);env.push(Math.max(0,e-prev));prev=e}const mean=env.reduce((a,b)=>a+b,0)/Math.max(1,env.length);let best=0,lag=0;for(let l=25;l<=150;l++){let a=0,u=0,v=0;for(let i=l;i<env.length;i++){const q=env[i]-mean,r=env[i-l]-mean;a+=q*r;u+=q*q;v+=r*r}const score=a/Math.sqrt(u*v||1);if(score>best){best=score;lag=l}}let bpm=lag?6000/lag:120;while(bpm<70)bpm*=2;while(bpm>180)bpm/=2;const period=6000/bpm;let phase=0,phaseScore=-1;for(let p=0;p<period;p++){let score=0;for(let i=p;i<env.length;i+=period)score+=env[Math.round(i)]||0;if(score>phaseScore){phaseScore=score;phase=p}}const duration=x.length/sr,beats=[];if(best>.08)for(let t=phase/100;t<duration;t+=60/bpm){
 const estimated=Math.round(t*100), radius=Math.min(8,Math.round(period*.15));
 let index=estimated, strength=env[index]||0;
 for(let i=Math.max(0,estimated-radius);i<=Math.min(env.length-1,estimated+radius);i++){
  const candidate=env[i]*(1-.35*Math.abs(i-estimated)/Math.max(1,radius));
  if(candidate>strength){strength=candidate;index=i;}
 }
 beats.push(Math.min(duration,index/100));
}const energy=[];for(let i=0;i<raw.length;i+=50)energy.push(Math.sqrt(raw.slice(i,i+50).reduce((a,b)=>a+b*b,0)/Math.min(50,raw.length-i)));const peak=[...energy].sort((a,b)=>a-b)[Math.floor(energy.length*.95)]||1;const normalized=energy.map(v=>clamp(v/peak,0,1));const step=best>.08?Math.max(4,16*60/bpm):8,sections=[];for(let t=0;t<duration-.001;t+=step){const a=Math.floor(t*100),b=Math.min(raw.length,Math.floor((t+step)*100));let vector=[];for(let j=0;j<8;j++){const lo=Math.floor(a+(b-a)*j/8),hi=Math.floor(a+(b-a)*(j+1)/8);let r=0,f=0,o=0;for(let k=lo;k<hi;k++){r+=raw[k];f+=features[k];o+=env[k]}const n=Math.max(1,hi-lo);vector.push(r/n/peak,f/n,o/n)}sections.push({start:t,end:Math.min(t+step,duration),vector,level:vector.filter((_,i)=>i%3===0).reduce((a,b)=>a+b,0)/8,kind:'未判定'})}for(let i=0;i<sections.length;i++){const s=sections[i];let similarity=0;for(let j=0;j<sections.length;j++){if(Math.abs(i-j)<2)continue;const v=sections[j].vector;const dist=Math.sqrt(s.vector.reduce((a,x,k)=>a+(x-v[k])**2,0)/24);similarity=Math.max(similarity,1-dist)}s.repetition=similarity;s.kind=s.level<.09?'静かな区間':similarity>.88&&s.level>.55?'サビ候補':'通常区間'}for(const section of sections)delete section.vector;return {duration,bpm:Math.round(bpm),confidence:best,beats,energy:normalized,sections}}
/* Compare coarse spectral fingerprints across beat-sized blocks. */
function structure(samples, sampleRate, analysis) {
  const sections = analysis.sections;
  const stride = Math.max(1, Math.floor(sampleRate / 6000));
  const rate = sampleRate / stride;
  const frequencies = [65, 98, 147, 220, 330, 494, 740, 1109, 1661, 2489];
  const coefficients = frequencies.map(frequency => 2 * Math.cos(2 * Math.PI * frequency / rate));
  const frame = Math.round(rate * .08);
  const window = Array.from({length: frame}, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / Math.max(1, frame - 1)));
  const fingerprints = sections.map(section => {
    const bands = coefficients.map(() => 0);
    for (let time = section.start; time + .08 <= section.end; time += .25) {
      const start = Math.round(time * sampleRate);
      coefficients.forEach((coefficient, band) => {
        let previous = 0, older = 0;
        for (let i = 0; i < frame; i++) {
          const next = (samples[start + i * stride] || 0) * window[i] + coefficient * previous - older;
          older = previous;
          previous = next;
        }
        bands[band] += Math.sqrt(Math.max(0, previous ** 2 + older ** 2 - coefficient * previous * older));
      });
    }
    const length = Math.hypot(...bands) || 1;
    return bands.map(value => value / length);
  });
  sections.forEach((section, index) => {
    let repeat = 0;
    for (let other = 0; other < sections.length; other++) {
      if (Math.abs(index - other) < 2) continue;
      const similarity = fingerprints[index].reduce((sum, value, band) => sum + value * fingerprints[other][band], 0);
      repeat = Math.max(repeat, similarity);
    }
    section.repetition = clamp(repeat, 0, 1);
  });
  return analysis;
}
function labelSections(sections, lyrics = []) {
  const reliableLyrics = lyrics.filter(line => Number.isFinite(line.start) && Number.isFinite(line.end));
  const levels = sections.filter(section => section.level >= .09).map(section => section.level).sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)] || 0;
  const chorusCandidate = section => section && section.repetition > .93 && section.level > median * 1.08;
  let verse = 'Aメロ';
  return sections.map((section, index) => {
    const vocal = reliableLyrics.some(line => line.start < section.end && line.end > section.start);
    let kind = section.level < .09 ? '静かな区間' : '通常区間';
    if (sections.length >= 4 && reliableLyrics.length && !vocal) {
      kind = index === 0 ? 'イントロ' : index === sections.length - 1 ? 'アウトロ' : '間奏';
    } else if (sections.length >= 4 && chorusCandidate(section)) {
      kind = 'サビ候補';
    } else if (sections.length >= 4 && vocal) {
      if (chorusCandidate(sections[index + 1])) verse = 'Bメロ';
      if (chorusCandidate(sections[index - 1])) verse = 'Aメロ';
      kind = verse;
    }
    return {...section, kind};
  });
}
function beatPulse(time, bpm, analysis) {
  const beats = analysis?.bpm === bpm && analysis.beats;
  const index = beats ? beats.findLastIndex(beat => beat <= time) : -1;
  const phase = index < 0 ? ((time * bpm / 60) % 1 + 1) % 1
    : clamp((time - beats[index]) / ((beats[index + 1] ?? beats[index] + 60 / bpm) - beats[index]), 0, 1);
  return (1 - phase) ** 5;
}
function imageIndex(time, analysis, step, count) {
  if (!count) return -1;
  const sections = analysis?.sections || [];
  const section = sections.findLastIndex(item => time >= item.start);
  if (section >= 0 && sections.length > 1) return section % count;
  const beats = analysis?.beats || [];
  const beat = beats.findLastIndex(value => value <= time);
  return (beat >= 0 ? Math.floor(beat / 8) : Math.floor(time / step)) % count;
}
function progress(cue, time, end, aligned) {
  const row = aligned?.find(line => line.text === cue.text && Math.abs(line.start - cue.start) < .15);
  const characters = row?.characters;
  if (!characters?.length) return clamp((time - cue.start) / Math.max(.1, end - cue.start), 0, 1);
  const index = characters.findLastIndex(character => Number.isFinite(character.start) && character.start <= time);
  if (index < 0) return 0;
  const character = characters[index];
  const fraction = character.end > character.start ? clamp((time - character.start) / (character.end - character.start), 0, 1) : 1;
  return (index + fraction) / characters.length;
}
const api={parseLrc,stamp,settings,scenes,analyze,structure,labelSections,beatPulse,imageIndex,progress};if(typeof module!=='undefined')module.exports=api;else root.MVCore=api;
})(globalThis);
