(()=>{
'use strict';
const $=id=>document.getElementById(id), audio=$('player'), canvas=$('preview');
let requestedAudio=null,requestedImages=[],imageFiles=[],soundFile=null, pictures=[],url=null,analysis=null,recording=false, aligned=[],scenePlan=null,mediaGeneration=0,mediaLoads=0,analyzing=false;
const fields=['title','lyrics','timing','style','bpm','intensity','notes','ratio','resolution','rangeStart','rangeEnd','format','planEngine','typography','introEnd','instrumentals','layerEffects','foregroundMode'];
let syncActive=false, subtitleDraft=null;
let projectId=null, projectBusy=false, aiJob=null, candidate=null, renderController=null;
function status(message) {
  $('localStatus').textContent=message;
  if(syncActive) $('syncStatus').textContent=message;
}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000)}
async function loadMedia(a,files){
mediaLoads++;
try{await applyMedia(a,files)}finally{mediaLoads--}
}
async function applyMedia(file, files) {
  const generation = ++mediaGeneration;
  const reuseImages = files.length === imageFiles.length && files.every((image, index) => image === imageFiles[index]);
  const next = reuseImages ? pictures : [];
  if (!reuseImages) {
    try {
      for (const file of files) {
        const objectUrl = URL.createObjectURL(file);
        try {
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          if (generation !== mediaGeneration) break;
          const scale = 1920 / Math.max(image.width, image.height);
          const resized = scale < 1 && typeof createImageBitmap === 'function'
            ? await createImageBitmap(image, {
              resizeWidth: Math.max(1, Math.round(image.width * scale)),
              resizeHeight: Math.max(1, Math.round(image.height * scale)),
              resizeQuality: 'high',
            }).catch(() => image)
            : image;
          next.push(resized);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    } catch (error) {
      next.forEach(image => image.close?.());
      throw error;
    }
  }
  if (generation !== mediaGeneration) {
    if (!reuseImages) next.forEach(image => image.close?.());
    return;
  }
  if (file !== soundFile) {
    subtitleDraft = null;
    renderSubtitleDraft();
    candidate = null;
    $('syncReview').replaceChildren();
    $('applySync').disabled = true;
    $('applySyncHint').textContent = '';
    $('applySync').textContent = '同期候補を適用';
    $('bpmstatus').textContent = '';
    $('sceneJson').value = '';
    $('sceneEditor').hidden = true;
    audio.pause();
    if (url) URL.revokeObjectURL(url);
    url = file ? URL.createObjectURL(file) : null;
    if (url) audio.src = url;
    else { audio.removeAttribute('src'); audio.load(); }
    analysis = null;
    aligned = [];
    scenePlan = null;
    renderSections();
  }
  if (!reuseImages) pictures.forEach(image => image.close?.());
  soundFile = file;
  imageFiles = files;
  pictures = next;
  timeline();
  repaint();
  $('mediaInfo').textContent = `音源: ${file?.name || 'なし'} / 画像 ${pictures.length}枚`;
}
$('audio').onchange=()=>{requestedAudio=$('audio').files[0]||null;loadMedia(requestedAudio,requestedImages).catch(e=>status(e.message))};$('images').onchange=()=>{requestedImages=[...$('images').files];loadMedia(requestedAudio,requestedImages).catch(e=>status(e.message))};
let cachedCues;
function readVocalRanges(duration) {
  const intro = $('introEnd').value === '' ? 0 : $('introEnd').valueAsNumber;
  return MVAlignment.vocalRanges(duration, intro, $('instrumentals').value);
}
function cues(duration) {
  const lyrics = $('lyrics').value, mode = $('timing').value;
  const rangeKey = $('introEnd').value + '/' + $('instrumentals').value;
  if (cachedCues?.lyrics === lyrics && cachedCues.mode === mode && cachedCues.duration === duration && cachedCues.rangeKey === rangeKey) return cachedCues.rows;
  let ranges;
  try { ranges = readVocalRanges(duration); }
  catch { ranges = [{start: 0, end: duration}]; }
  const lines = lyrics.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let rows = [];
  if (mode === 'manual') rows = MVCore.parseLrc(lyrics);
  if (mode === 'even' && ranges.length) {
    const span = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    rows = lines.map((text, index) => {
      let offset = index * span / lines.length;
      for (const range of ranges) {
        const length = range.end - range.start;
        if (offset < length) return {text, start: range.start + offset};
        offset -= length;
      }
      return {text, start: ranges[ranges.length - 1].end};
    });
  }
  cachedCues = {lyrics, mode, duration, rangeKey, rows, ranges};
  return rows;
}
function plan(t){const p=scenePlan||{base:MVCore.settings($('notes').value),scenes:[]};const scene=p.scenes[MVCore.lastIndex(p.scenes,s=>t>=s.start&&t<s.end)];return {...p.base,...scene,base:$('style').value};}
function size(){const portrait=$('ratio').value==='portrait',h=+$('resolution').value;return portrait?[h,Math.round(h*16/9/2)*2]:[Math.round(h*16/9/2)*2,h]}
function paintImage(context, image, w, h, time, step, visual) {
  if (!image) return;
  const {effects, pulse, strength, glitch, dark} = visual;
  const camera = effects.camera;
  const zoomPhase = (time % step) / step;
  const cameraZoom = camera === 'in' ? .12 * zoomPhase
    : camera === 'out' ? .12 * (1 - zoomPhase) : camera === 'drift' ? .12 : 0;
  const zoom = Math.max(w / image.width, h / image.height)
    * (1.08 + .035 * Math.sin(time * .7) + pulse * .035 * strength + cameraZoom);
  const shake = (effects.shake || glitch ? 9 : 2) * h / 360 * pulse * strength;
  const pan = camera === 'pan' || camera === 'drift' ? Math.sin(time * .6) * w * .025 : 0;
  context.save();
  context.translate(w / 2 + Math.sin(time * 60) * shake + pan, h / 2 + Math.cos(time * 53) * shake);
  if (camera === 'drift') context.rotate(Math.sin(time * .55) * .043);
  if (dark || effects.mono) context.filter = 'grayscale(1) contrast(1.18)';
  context.drawImage(image, -image.width * zoom / 2, -image.height * zoom / 2, image.width * zoom, image.height * zoom);
  context.restore();
}

function activeLyric(time, duration) {
  const rows = cues(duration);
  const range = cachedCues.ranges.find(item => time >= item.start && time < item.end);
  if (!range) return null;
  const index = MVCore.lastIndex(rows, row => row.start >= range.start && row.start <= time);
  const row = rows[index];
  if (!row) return null;
  let end = Math.min(rows[index + 1]?.start ?? duration, range.end);
  const recognized = aligned.find(line => line.text === row.text && Math.abs(line.start - row.start) < .02);
  if (recognized && recognized.end > recognized.start && end - recognized.end >= 1.25) {
    end = Math.min(end, recognized.end + .3);
  }
  return time < end ? {row, index, end} : null;
}

function paintLyrics(context, w, h, time, visual, lyric) {
  const {effects, glitch, minimal} = visual;
  if (!lyric || effects.noText) return;
  const {row, index, end} = lyric;
  const scale = h / 360;
  const elapsed = time - row.start;
  const characters = MVAlignment.graphemes(row.text);
  const mode = effects.typography || $('typography').value;
  if (mode !== 'classic' && typeof MVTypography !== 'undefined') {
    MVTypography.paint(context, w, h, {
      mode, animation: effects.animation, characters, index, elapsed, length: Math.max(.01, end - row.start),
      pulse: visual.pulse, strength: visual.strength, style: effects.base,
      progress: $('karaoke').checked ? MVCore.progress(row, time, end, aligned) : null,
    });
    return;
  }
  const text = effects.animation === 'type' ? characters.slice(0, Math.floor(elapsed * 12) + 1).join('') : row.text;
  const jump = effects.animation === 'bounce' ? Math.sin(elapsed * 10) * Math.exp(-elapsed * 4) * 12 * scale : 0;
  const y = jump + h * (effects.center || glitch || minimal ? .5 : .76);
  let fontSize = Math.min(38 * scale, w / Math.max(7, characters.length * .75));
  context.save();
  const font = () => { context.font = `900 ${fontSize}px sans-serif`; };
  font();
  while (context.measureText(row.text).width > w * .89 && fontSize > 10) { fontSize--; font(); }
  if (effects.animation === 'fade') context.globalAlpha = Math.min(1, elapsed / .35);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = '#000';
  context.shadowBlur = 9 * scale;
  context.lineWidth = 2 * scale;
  context.strokeStyle = '#0009';
  context.strokeText(text, w / 2, y);
  context.fillStyle = 'white';
  context.fillText(text, w / 2, y);
  if ($('karaoke').checked) {
    const progress = MVCore.progress(row, time, end, aligned);
    const complete = Math.floor(progress * characters.length);
    const prefix = context.measureText(characters.slice(0, complete).join('')).width;
    const next = context.measureText(characters.slice(0, complete + 1).join('')).width;
    const width = prefix + (next - prefix) * (progress * characters.length - complete);
    context.beginPath();
    context.rect((w - context.measureText(text).width) / 2, y - fontSize, width, fontSize * 2);
    context.clip();
    context.fillStyle = '#63e8ff';
    context.fillText(text, w / 2, y);
  }
  context.restore();
}

function paintBackground(context, image, w, h, time, step, visual) {
  const {effects,pulse,strength,glitch} = visual;
  const scale=h/360;
  context.fillStyle = '#11101b';
  context.fillRect(0, 0, w, h);
  paintImage(context, image, w, h, time, step, visual);
  const shade = context.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, '#0005');
  shade.addColorStop(.45, '#0000');
  shade.addColorStop(1, '#000b');
  context.fillStyle = shade;
  context.fillRect(0, 0, w, h);
  if (effects.vignette) {
    const vignette = context.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .24, w / 2, h / 2, Math.hypot(w, h) * .53);
    vignette.addColorStop(0, '#0000');
    vignette.addColorStop(1, '#000c');
    context.fillStyle = vignette;
    context.fillRect(0, 0, w, h);
  }
  if (glitch) {
    context.fillStyle = `rgba(0,220,255,${pulse * .12 * strength})`;
    for (let i = 0; i < 5; i++) context.fillRect(0, (Math.sin(i * 19 + time * 17) * .5 + .5) * h, w, 2 * scale);
  }
  if (effects.flash && pulse > .8) {
    context.fillStyle = '#ffffff1a';
    context.fillRect(0, 0, w, h);
  }
}
function draw(time, duration) {
  const context = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const effects = plan(time);
  const bpm = Math.max(30, Math.min(300, +$('bpm').value || 120));
  const pulse = MVCore.beatPulse(time, bpm, analysis);
  const energy = analysis?.energy[Math.min(analysis.energy.length - 1, Math.floor(time * 2))] || 0;
  const chorus = analysis?.sections.find(section => time >= section.start && time < section.end)?.kind?.startsWith('サビ');
  const strength = +$('intensity').value / 100 * (chorus ? 1.4 : 1) * (effects.quiet ? .35 : 1);
  const glitch = effects.base === 'glitch', dark = effects.base === 'dark', minimal = effects.base === 'minimal';
  const visual = {effects, pulse, strength, glitch, dark, minimal};
  const step = 480 / bpm, scale = h / 360;
  const separateForeground = $('foregroundMode').value !== 'none' && pictures.length > 1;
  const count = pictures.length - Number(separateForeground);
  const index = effects.explicitImage ? Math.min(count - 1, effects.image)
    : MVCore.imageIndex(time, analysis, step, count);
  const image = pictures[index];
  const foreground = separateForeground ? pictures[pictures.length - 1] : null;
  const mode = effects.layerEffect || $('layerEffects').value;
  const layer = recording ? 'all' : $('previewLayer').value;
  const lyric = activeLyric(time, duration);
  if (mode !== 'none' || foreground || layer !== 'all') {
    const bar = MVLayers.barAt(time, bpm, analysis?.beats?.[0]);
    const letters = effects.noText ? [] : MVAlignment.graphemes(lyric?.row.text || '').filter(character => /[\p{L}\p{N}]/u.test(character));
    const glyph = letters[bar.index % letters.length];
    MVLayers.paint(context, {w,h,time,bar,strength,glyph,layer,mode,foreground,keyGreen:$('foregroundMode').value==='green'},
      target=>paintBackground(target,image,w,h,time,step,visual),
      target=>paintLyrics(target,w,h,time,visual,lyric));
  } else {
    paintBackground(context,image,w,h,time,step,visual);
    paintLyrics(context,w,h,time,visual,lyric);
  }
  if (layer !== 'all') return;
  if (!minimal) {
    context.fillStyle = '#ffffffcc';
    context.textAlign = 'left';
    context.font = `${12 * scale}px sans-serif`;
    context.fillText($('title').value, w * .04, h * .06);
    context.fillStyle = '#ffffff50';
    context.fillRect(w * .04, h * .95, w * .92, 2 * scale);
    context.fillStyle = glitch ? '#00eaff' : '#fff';
    context.fillRect(w * .04, h * .95, w * .92 * Math.min(1, time / duration), 2 * scale);
  }
  if ($('spectrum').checked) {
    context.fillStyle = '#ffffff80';
    for (let i = 0; i < 32; i++) {
      const amplitude = (.15 + .85 * energy) * (.2 + .8 * Math.abs(Math.sin(i * 2.3 + time * 8))) * (.4 + .6 * pulse);
      context.fillRect(w * (.2 + i * .6 / 32), h * (.92 - amplitude * .06), w * .36 / 32, amplitude * h * .06);
    }
  }
}
function tick(){if(!recording && !audio.paused){draw(audio.currentTime,Number.isFinite(audio.duration)?audio.duration:1)}requestAnimationFrame(tick)}
function repaint(){if(!recording)draw(audio.currentTime||0,Number.isFinite(audio.duration)?audio.duration:1)}
$('ratio').onchange=()=>{const [w,h]=size();canvas.width=w;canvas.height=h;repaint()};
document.addEventListener('input', repaint);
document.addEventListener('click', () => requestAnimationFrame(repaint));
audio.addEventListener('seeked', repaint);
audio.addEventListener('loadedmetadata', () => {timeline();repaint()});
audio.addEventListener('timeupdate', () => {$('seekTimeline').value=audio.currentTime});
$('seekTimeline').oninput=()=>seekTo(+$('seekTimeline').value);$('resolution').onchange=$('ratio').onchange;
function renderSections(){const div=$('sectionEditor');div.replaceChildren();$('sections').textContent=analysis?`推定 ${analysis.bpm} BPM / 拍 ${analysis.beats.length} / 信頼度指標 ${analysis.confidence.toFixed(2)}`:'';for(const sec of analysis?.sections||[]){const label=document.createElement('label');label.textContent=`${sec.start.toFixed(1)}–${sec.end.toFixed(1)} 秒`;const select=document.createElement('select');for(const kind of ['未判定','通常区間','静かな区間','サビ候補','イントロ','Aメロ','Bメロ','サビ','間奏','アウトロ'])select.add(new Option(kind,kind));select.value=sec.kind;select.onchange=()=>{sec.kind=select.value;sec.edited=true;timeline();repaint()};label.append(select);div.append(label)}}
async function analyzeAudio(){if(recording||analyzing)return;if(!soundFile||mediaLoads)return status('音源の読み込みを確認してください');let ac;analyzing=true;try{status('音響解析中');$('analyze').disabled=$('detect').disabled=true;ac=new AudioContext();const file=soundFile,b=await ac.decodeAudioData(await file.arrayBuffer());await new Promise(r=>setTimeout(r,30));const samples=b.getChannelData(0).slice();
if(b.numberOfChannels>1){const right=b.getChannelData(1);for(let i=0;i<samples.length;i++)samples[i]=(samples[i]+right[i])/2}
const result=await analyzeInWorker(samples,b.sampleRate);if(file!==soundFile)return;result.sections=MVCore.labelSections(result.sections,aligned);analysis=result;if(result.confidence>.08)$('bpm').value=result.bpm;$('bpmstatus').textContent=result.confidence>.08?`推定 ${result.bpm} BPM（倍・半分の可能性）`:'明確な拍を検出できません';renderSections();timeline();repaint();status('解析完了。反復構造と音響特徴による候補です。区間名を修正できます。')}catch(e){status(e.message)}finally{await ac?.close().catch(()=>{});analyzing=false;$('analyze').disabled=$('detect').disabled=false}}
$('analyze').onclick=$('detect').onclick=analyzeAudio;
function parsePlan(input, duration) {
  if(!Number.isFinite(duration)||duration<=0)throw Error('音源を選択してください');
  if(!input || !input.base || typeof input.base!=='object' || Array.isArray(input.base) || !Array.isArray(input.scenes) || input.scenes.length>300) throw Error('演出プラン形式が不正です');
  function effects(source){
    const result={};
    for(const key of ['mono','shake','quiet','flash','vignette','center','noText','explicitImage']){
      if(key in source){if(typeof source[key]!=='boolean')throw Error('演出設定が不正です');result[key]=source[key]}
    }
    for(const [key,options] of Object.entries({camera:['in','out','pan','drift','default'],animation:['type','fade','bounce','default'],typography:['auto','poster','vertical','arc','split','classic'],layerEffect:['none','auto','mask','tiles','wave','glitch']})){
      if(source[key]!==undefined){if(!options.includes(source[key]))throw Error('演出設定が不正です');result[key]=source[key]}
    }
    if(result.explicitImage){
      if(!Number.isInteger(source.image)||source.image<0||source.image>=pictures.length)throw Error('画像番号が範囲外です');
      result.image=source.image;
    }
    return result;
  }
  return {base:effects(input.base),scenes:input.scenes.map(scene=>{
    if(!scene||!Number.isFinite(scene.start)||!Number.isFinite(scene.end)||scene.start<0||scene.end<=scene.start||scene.end>duration+.01)throw Error('区間指定が不正です');
    return {start:scene.start,end:scene.end,...effects(scene)};
  })};
}
function setPlan(value){
  scenePlan=value;
  $('sceneEditor').hidden=true;
  $('sceneJson').value=value?JSON.stringify(value,null,2):'';
  timeline();
  repaint();
}
async function generatePlan(partial){
  if(aiJob||recording)return;
  try{
    const duration=audio.duration, file=soundFile, notes=$('notes').value;
    if(!Number.isFinite(duration)||duration<=0)throw Error('音源を選択してください');
    const [from,to]=partial?exportRange(duration):[0,duration];
    const sections=analysis?.sections||[];
    const rules=()=>parsePlan(MVCore.scenes(notes,sections,duration),duration);
    let next, message='演出プランを更新しました';
    if($('planEngine').value==='llm'){
      try{
        next=parsePlan(await runAI({action:'plan',context:{notes,from,to,sections,imageCount:pictures.length}},[]),duration);
      }catch(error){
        if(error.name==='AbortError')throw error;
        message='LLMを利用できなかったためルール解析を適用しました: '+error.message;
        next=rules();
      }
    }else next=rules();
    if(file!==soundFile||notes!==$('notes').value)throw Error('編集内容が変わりました。もう一度実行してください');
    if(partial){
      const old=scenePlan||{base:MVCore.settings(notes),scenes:[]};
      const retained=old.scenes.flatMap(scene=>{
        if(scene.end<=from||scene.start>=to)return [scene];
        return [scene.start<from?{...scene,end:from}:null,scene.end>to?{...scene,start:to}:null].filter(Boolean);
      });
      const defaults={...old.base,...next.base,start:from,end:to};
      const inside=next.scenes.filter(scene=>scene.start<to&&scene.end>from).map(scene=>({...defaults,...scene,start:Math.max(from,scene.start),end:Math.min(to,scene.end)}));
      next={base:old.base,scenes:[...retained,defaults,...inside]};
    }
    setPlan(next);
    status(message);
  }catch(error){status(error.name==='AbortError'?'中止しました':error.message)}
}
$('makePlan').onclick=()=>generatePlan(false);
$('regenerate').onclick=()=>generatePlan(true);
$('applyPlan').onclick=()=>{try{setPlan(parsePlan(JSON.parse($('sceneJson').value),audio.duration));status('演出プランを適用しました')}catch(e){status(e.message)}};
function seekTo(time){if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,time))}
function editScene(index) {
  const scene=scenePlan?.scenes[index];
  if(!scene)return;
  $('sceneEditor').hidden=false;
  $('sceneIndex').value=index;
  $('sceneStart').value=scene.start;
  $('sceneEnd').value=scene.end;
  const images=$('sceneImage');
  images.replaceChildren(new Option('自動',''));
  pictures.forEach((_,i)=>images.add(new Option('画像 '+(i+1),i)));
  images.value=scene.explicitImage?scene.image:'';
  $('sceneCamera').value=scene.camera||'default';
  $('sceneAnimation').value=scene.animation||'default';
  $('sceneTypography').value=scene.typography||'';
  $('sceneLayerEffects').value=scene.layerEffect||'';
  $('sceneVignette').checked=Boolean(scene.vignette);
}
$('saveScene').onclick=()=>{
  try{
    const index=+$('sceneIndex').value, image=$('sceneImage').value;
    const scenes=scenePlan.scenes.slice();
    scenes[index]={...scenes[index],start:$('sceneStart').valueAsNumber,end:$('sceneEnd').valueAsNumber,
      explicitImage:image!=='',image:+image,camera:$('sceneCamera').value,animation:$('sceneAnimation').value,typography:$('sceneTypography').value||undefined,layerEffect:$('sceneLayerEffects').value||undefined,vignette:$('sceneVignette').checked};
    setPlan(parsePlan({...scenePlan,scenes},audio.duration));
    editScene(index);status('区間演出を更新しました');
  }catch(error){status(error.message)}
};
function renderTracks(rows){
  const root=$('timelineTracks'),duration=audio.duration;
  root.replaceChildren();
  if(!Number.isFinite(duration)||duration<=0)return;
  $('seekTimeline').max=duration;
  const beats=document.createElement('div');beats.setAttribute('aria-label','拍');
  for(const time of analysis?.beats||[]){const beat=document.createElement('span');beat.className='beat';beat.style.left=100*time/duration+'%';beats.append(beat)}
  root.append(beats);
  for(const [label,segments] of [
    ['曲構成',(analysis?.sections||[]).map(s=>({...s,text:s.kind}))],
    ['歌詞',rows.map((r,i)=>({...r,end:rows[i+1]?.start??duration}))],
    ['演出',(scenePlan?.scenes||[]).map((s,index)=>({...s,index,text:s.explicitImage?'画像 '+(s.image+1):s.camera||'演出'}))],
  ]){
    const line=document.createElement('div');line.setAttribute('aria-label',label);
    for(const segment of segments){
      if(segment.start>=duration)continue;
      const button=document.createElement('button');button.textContent=segment.text;
      button.style.left=100*segment.start/duration+'%';
      button.style.width=100*(Math.min(duration,segment.end)-segment.start)/duration+'%';
      button.onclick=()=>{seekTo(segment.start);if(label==='演出')editScene(segment.index)};
      line.append(button);
    }
    root.append(line);
  }
}
function timeline(){
  const div=$('timeline');
  div.replaceChildren();
  const rows=cues(audio.duration||1);
  renderTracks(rows);
  rows.forEach((q,i)=>{
    const row=document.createElement('div'), time=document.createElement('input');
    const text=document.createElement('input'), seek=document.createElement('button');
    time.type='number';time.min=0;time.step=.01;time.value=q.start.toFixed(2);
    text.value=q.text;seek.textContent='試聴';seek.onclick=()=>{audio.currentTime=+time.value};
    let original=q;
    const update=()=>{
      const replacement={start:Math.max(0,+time.value||0),text:text.value};
      const stamp=entry=>MVCore.stamp(entry.start)+' '+entry.text;
      let lyrics;
      if($('timing').value==='manual'){
        let replaced=false;
        lyrics=$('lyrics').value.split(/\r?\n/).map(line=>{
          if(replaced)return line;
          const entries=MVCore.parseLrc(line);
          const index=entries.findIndex(entry=>entry.start===original.start&&entry.text===original.text);
          if(index<0)return line;
          entries[index]=replacement;replaced=true;
          return entries.map(stamp).join('\n');
        }).join('\n');
      }else{
        const next=rows.slice();next[i]=replacement;
        lyrics=next.map(stamp).join('\n');
      }
      original=MVCore.parseLrc(stamp(replacement))[0]||replacement;
      $('lyrics').value=lyrics;$('timing').value='manual';aligned=[];
      validateSync(false);renderTracks(cues(audio.duration||1));repaint();
    };
    time.onchange=text.onchange=update;
    row.append(time,text,seek);div.append(row);
  });
}
$('refreshTimeline').onclick=timeline;
$('lyrics').addEventListener('input',()=>renderTracks(cues(audio.duration||1)));
$('timing').addEventListener('change',timeline);
$('stamp').onclick=()=>{$('lyrics').value+=($('lyrics').value?'\n':'')+MVCore.stamp(audio.currentTime)+' ';$('timing').value='manual';$('lyrics').focus()};
$('importAlignment').onchange=async()=>{try{const p=JSON.parse(await $('importAlignment').files[0].text());if(!Array.isArray(p?.lines)||p.lines.some(r=>typeof r?.text!=='string'||!Number.isFinite(r.start)||r.start<0||!Array.isArray(r.characters)||r.characters.some(c=>typeof c?.text!=='string'||(c.start!=null&&!Number.isFinite(c.start))||(c.end!=null&&!Number.isFinite(c.end)))))throw Error('同期JSON形式が不正');aligned=p.lines;$('lyrics').value=aligned.map(r=>MVCore.stamp(r.start)+' '+r.text).join('\n');$('timing').value='manual';timeline();status('文字同期を読み込みました（一部は推定）')}catch(e){status(e.message)}};
const storage=(mode,operation)=>MVStorage.transaction(mode,operation);
async function listProjects(){
  const entries=await storage('readonly',store=>{
    const request=store.openCursor(), entries=[];
    const result={result:entries};
    request.onsuccess=()=>{const cursor=request.result;if(cursor){entries.push([cursor.key,cursor.value.fields?.title]);cursor.continue()}};
    return result;
  });
  const select=$('projectList');
  select.replaceChildren(new Option('プロジェクトを選択',''));
  for(const [id,title] of entries)select.add(new Option(title||'無題のプロジェクト',id));
  select.value=projectId||entries[0]?.[0]||'';
}
function resetField(element) {
  if (element instanceof HTMLSelectElement) {
    const initial = Array.from(element.options).findIndex(option => option.defaultSelected);
    element.selectedIndex = Math.max(0, initial);
  } else element.value = element.defaultValue;
}
$('saveProject').onclick=async()=>{
  if(projectBusy)return;projectBusy=true;
  try{
    if(mediaLoads)throw Error('素材の読み込みが完了していません');
    const id=projectId||crypto.randomUUID();
    await storage('readwrite',s=>s.put({fields:Object.fromEntries(fields.map(id=>[id,$(id).value])),karaoke:$('karaoke').checked,spectrum:$('spectrum').checked,soundFile,imageFiles,analysis,aligned,scenePlan,subtitleDraft},id));
    projectId=id;await listProjects();status('端末内に保存しました。');
  }catch(e){status('保存失敗: '+e.message)}finally{projectBusy=false}
};
$('restoreProject').onclick=async()=>{
  if(projectBusy)return;projectBusy=true;
  try{
    const id=$('projectList').value;
    const p=id&&await storage('readonly',s=>s.get(id));
    if(!p)return status('保存済みプロジェクトを選択してください');
    requestedAudio=p.soundFile||null;requestedImages=p.imageFiles||[];
    $('audio').value='';$('images').value='';
    await loadMedia(requestedAudio,requestedImages);
    for(const field of fields) {
      if(p.fields[field]!=null)$(field).value=p.fields[field];
      else resetField($(field));
    }
    $('karaoke').checked=Boolean(p.karaoke);$('spectrum').checked=Boolean(p.spectrum);
    projectId=id;analysis=p.analysis||null;aligned=p.aligned||[];
    subtitleDraft=p.subtitleDraft||null;renderSubtitleDraft();validateSync(false);
    setPlan(p.scenePlan||null);renderSections();$('ratio').onchange();status('復元しました。');
  }catch(e){status(e.message)}finally{projectBusy=false}
};
$('newProject').onclick=async()=>{
  if(projectBusy||!confirm('現在の編集内容を閉じ、新規プロジェクトを作成しますか？'))return;
  projectId=null;$('projectList').value='';
  requestedAudio=null;requestedImages=[];$('audio').value='';$('images').value='';
  await loadMedia(null,[]);
  for(const id of fields)resetField($(id));
  $('karaoke').checked=$('spectrum').checked=false;
  analysis=null;aligned=[];setPlan(null);renderSections();$('ratio').onchange();status('新規プロジェクト');
};
$('clearProject').onclick=async()=>{
  const id=$('projectList').value;
  if(projectBusy||!id||!confirm('選択中の保存プロジェクトを削除しますか？'))return;
  try{await storage('readwrite',s=>s.delete(id));if(projectId===id)projectId=null;await listProjects();status('保存データを削除しました')}
  catch(e){status(e.message)}
};
listProjects().catch(e=>status(e.message));
$('tapSync').onclick=()=>{const lines=$('lyrics').value.split(/\r?\n/).filter(s=>s.trim()),i=lines.findIndex(s=>!/^\[\d+:/.test(s));if(i<0)return status('全行の時刻が設定済みです');const t=audio.currentTime;lines[i]=MVCore.stamp(t)+' '+lines[i];$('lyrics').value=lines.join('\n');$('timing').value='manual';aligned=[];timeline();status(`${i+1}/${lines.length} 行を同期`)};
$('importLrc').onchange=async()=>{const f=$('importLrc').files[0];if(f){$('lyrics').value=MVCore.parseLrc(await f.text()).map(q=>MVCore.stamp(q.start)+' '+q.text).join('\n');$('timing').value='manual';aligned=[];timeline()}};
function invokeWorker(path,data,transfer,onProgress,signal){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path,{type:path==='ai-worker.js'?'module':'classic'});
    function finish(callback,value){
      worker.terminate();signal?.removeEventListener('abort',abort);callback(value);
    }
    const abort=()=>finish(reject,new DOMException('中止しました','AbortError'));
    if(signal?.aborted){abort();return}
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=event=>finish(reject,new Error(event.message||'バックグラウンド処理に失敗しました'));
    worker.onmessage=({data})=>{
      if(data.progress)onProgress?.(data.progress);
      else if(data.error)finish(reject,new Error(data.error));
      else finish(resolve,data.result);
    };
    try{worker.postMessage(data,transfer)}catch(error){finish(reject,error)}
  });
}
function analyzeInWorker(samples,sampleRate){
  return invokeWorker('analysis-worker.js',{samples,sampleRate},[samples.buffer]);
}
async function runAI(data,transfer,prepare){
  if(aiJob||recording)throw Error('別の処理を実行中です');
  const job=new AbortController();aiJob=job;
  $('cancelAI').disabled=false;
  try{
    if(prepare)({data,transfer}=await prepare(job.signal,data));
    if(job.signal.aborted)throw job.signal.reason||new DOMException('中止しました','AbortError');
    return await invokeWorker('ai-worker.js',data,transfer,status,job.signal);
  }finally{aiJob=null;$('cancelAI').disabled=true}
}
$('cancelAI').onclick=()=>aiJob?.abort();
function lyricInput(){
  return $('lyrics').value.split(/\r?\n/).map(line=>line.replace(/^(?:\s*\[\d+:\d+(?:\.\d+)?\])+/,'').trim()).filter(Boolean);
}
$('recognize').onclick=async()=>{
  if(aiJob||recording){
    $('syncStatus').textContent='別の処理が実行中です。完了または中止後に実行してください。';
    return;
  }
  const file=soundFile;
  const notice = !file ? '先に楽曲ファイルを選択してください。'
    : !Number.isFinite(audio.duration) ? '楽曲の読み込みが完了してから押してください。' : '';
  if(notice){$('syncStatus').textContent=notice;status(notice);return}
  syncActive=true;
  candidate=null;$('syncReview').textContent='';
  validateSync(false);
  let context;
  try{
    const ranges=readVocalRanges(audio.duration);
    if(!ranges.length)throw Error('認識できる範囲がありません。');
    const rangeKey=$('introEnd').value+'/'+$('instrumentals').value;
    const chunks=await runAI({action:'recognize',model:$('recognitionModel').value},[],async(signal,data)=>{
      status('音源を読み込み中');
      context=new AudioContext({sampleRate:16000});
      const decoded=await context.decodeAudioData(await file.arrayBuffer());
      if(signal.aborted)throw signal.reason||new DOMException('中止しました','AbortError');
      const samples=decoded.getChannelData(0).slice();
      for(let channel=1;channel<decoded.numberOfChannels;channel++){
        const other=decoded.getChannelData(channel);
        for(let i=0;i<samples.length;i++)samples[i]+=other[i];
      }
      if(decoded.numberOfChannels>1)for(let i=0;i<samples.length;i++)samples[i]/=decoded.numberOfChannels;
      await context.close();
      return {data:{...data,samples,ranges},transfer:[samples.buffer]};
    });
    if(file!==soundFile||rangeKey!==currentVocalKey())throw Error('素材または認識範囲が変更されました');
    const subtitles = MVAlignment.transcribe(chunks);
    if (!subtitles.length) throw Error('照合できる歌唱または歌詞がありません');
    subtitleDraft = {rangeKey, subtitles};
    renderSubtitleDraft();
    $('subtitleDraft').open = true;
    reviewSubtitles();
  }catch(error){status(error.name==='AbortError'?'中止しました':error.message)}
  finally{syncActive=false;if(context&&context.state!=='closed')await context.close().catch(()=>{})}
};
function currentVocalKey(){
  return $('introEnd').value+'/'+$('instrumentals').value;
}
function renderSubtitleDraft(){
  const subtitles=subtitleDraft?.subtitles||[];
  $('subtitleDraft').hidden=!subtitles.length;
  $('subtitleCount').textContent=`認識字幕 ${subtitles.length} 行`;
  $('rawSubtitles').value=subtitles.length?MVAlignment.srt(subtitles):'';
  $('correctSubtitles').disabled=!subtitles.length;
  $('correctSubtitles').textContent=lyricInput().length ? '入力した歌詞で字幕を再照合' : '認識字幕を同期候補にする';
}
function reviewSubtitles(){
  candidate=null;
  validateSync(false);
  $('syncReview').replaceChildren();
  const file=soundFile, lyrics=$('lyrics').value, lines=lyricInput();
  const rangeKey=currentVocalKey();
  const ranges=readVocalRanges(audio.duration);
  const rangeChanged=subtitleDraft.rangeKey!==rangeKey;
  const subtitles=rangeChanged ? MVAlignment.subtitlesInRanges(subtitleDraft.subtitles,ranges) : subtitleDraft.subtitles;
  if(!subtitles.length)throw Error('現在の歌唱範囲に認識字幕がありません。「音源から字幕を作る」を押してください。');
  const extract=lines.length===0;
  const result=extract?{lines:subtitles}:MVAlignment.correctSubtitles(lines,subtitles,audio.duration);
  const weak = !extract && (result.coverage < .55 || result.lines.some(line => line.coverage < .4));
  candidate = {file,lyrics,ranges,rangeKey,lines:result.lines,inputs:[]};
  const review = $('syncReview');
  let lastStart = -1;
  for (const [index,line] of result.lines.entries()) {
    const label = document.createElement('label');
    label.textContent = extract ? line.text : `${line.text} (${Math.round(line.coverage * 100)}%)`;
    const input = document.createElement('input');
    input.type = 'number'; input.min = 0; input.step = .01;
    if (Number.isFinite(line.start) && line.coverage >= (weak ? .55 : .4)) {
      const start = Math.round(line.start * 100) / 100;
      if (start > lastStart && ranges.some(range => start >= range.start && start < range.end)) {
        input.value = start.toFixed(2);
        lastStart = start;
      }
    }
    input.placeholder = '開始時刻（秒）';
    input.oninput = () => validateSync(false);
    label.htmlFor = input.id = 'candidateTime' + index;
    const audition = document.createElement('button');
    audition.type = 'button';
    audition.textContent = 'この時刻を試聴';
    audition.setAttribute('aria-label', `${index + 1} 行目の時刻を試聴`);
    audition.disabled = !Number.isFinite(input.valueAsNumber);
    input.addEventListener('input', () => {
      audition.disabled = !Number.isFinite(input.valueAsNumber);
    });
    audition.onclick = () => {
      const time = input.valueAsNumber;
      if (soundFile !== file || !Number.isFinite(time) || time < 0 || time >= audio.duration) return;
      audio.currentTime = Math.max(0, time - .35);
      audio.play().catch(error => status(error.message));
    };
    review.append(label);
    if(!extract){
      const original=document.createElement('small');
      original.textContent=line.recognizedText? '認識字幕: '+line.recognizedText:'対応する認識字幕なし';
      review.append(original);
    }
    const usePlayhead = document.createElement('button');
    usePlayhead.type = 'button';
    usePlayhead.textContent = '再生位置を入れる';
    usePlayhead.setAttribute('aria-label', `${index + 1} 行目に再生位置を入れる`);
    usePlayhead.onclick = () => {
      input.value = audio.currentTime.toFixed(2);
      input.dispatchEvent(new Event('input'));
    };
    review.append(input, audition, usePlayhead);
    candidate.inputs.push(input);
  }
  validateSync(false);
  const summary = extract ? `文字起こし候補 ${result.lines.length} 行。試聴してから適用してください。` : weak ? `一致率 ${Math.round(result.coverage*100)}%。空欄を補うか、手動またはタップ同期で調整してください。`
    : `同期候補 一致率 ${Math.round(result.coverage*100)}%。文字時刻は推定です。`;
  status(rangeChanged ? summary + ' 現在の範囲内にある既存字幕を使用しました。新しく含めた区間は再認識が必要です。' : summary);
}
$('saveRawSubtitles').onclick=()=>{
  if(subtitleDraft)download(new Blob([MVAlignment.srt(subtitleDraft.subtitles)],{type:'application/x-subrip;charset=utf-8'}),'recognized.srt');
};
$('correctSubtitles').onclick=()=>{
  if(!subtitleDraft||recording||aiJob)return;
  if(!Number.isFinite(audio.duration)){
    $('syncStatus').textContent='楽曲の読み込みが完了してから押してください。';
    return;
  }
  syncActive=true;
  try {reviewSubtitles();}
  catch(error){status(error.message);}
  finally{syncActive=false;}
};
function validateSync(apply) {
  const button = $('applySync');
  const hint = $('applySyncHint');
  button.textContent = '同期候補を適用';
  button.disabled = true;
  if (!candidate) {
    hint.textContent = subtitleDraft ? '上のボタンで認識字幕から候補を作り直せます。' : '先に「音源から字幕を作る」を押してください。';
    return;
  }
  if (candidate.file !== soundFile || candidate.lyrics !== $('lyrics').value || candidate.rangeKey !== currentVocalKey()) {
    hint.textContent = '歌詞や認識範囲が変わりました。字幕を再照合してください。';
    return;
  }
  const starts = candidate.inputs.map(input => input.value === '' && !input.validity.badInput ? null : Math.round(input.valueAsNumber * 100) / 100);
  const timed = [];
  let message = '';
  for (const [index, start] of starts.entries()) {
    if (start === null) continue;
    const range = candidate.ranges.find(item => start >= item.start && start < item.end);
    if (!range) {
      message = `${index + 1} 行目に歌唱区間内の開始時刻を入れてください。`;
      break;
    }
    if (timed.length && start <= timed[timed.length - 1].start) {
      message = `${index + 1} 行目の開始時刻を前の行より後にしてください。`;
      break;
    }
    timed.push({index, start, range});
  }
  if (message || !timed.length) {
    hint.textContent = message || '開始時刻が空欄です。秒数を入れるか、音声を合わせて「再生位置を入れる」を押してください。';
    return;
  }
  const missing = starts.length - timed.length;
  if (missing) button.textContent = `時刻のある ${timed.length} 行を適用`;
  hint.textContent = missing ? `時刻が空欄の ${missing} 行は歌詞欄に残ります。` : '';
  button.disabled = false;
  if (!apply) return;
  aligned = timed.map(({index, start, range}, offset) => {
    const line = candidate.lines[index];
    const limit = Math.min(timed[offset + 1]?.start ?? audio.duration, range.end);
    if (line.start === null || line.coverage < .4) return {...line,start,end:start,characters:[],words:[]};
    const delta = start - line.start;
    const shift = segment => ({
      ...segment,
      start: Math.min(limit,Math.max(start,segment.start+delta)),
      end: Math.min(limit,Math.max(start,segment.end+delta)),
    });
    return {...shift(line),characters:line.characters.map(shift),words:line.words.map(shift)};
  });
  const lyrics = candidate.lines.map((line, index) => starts[index] === null
    ? line.text : MVCore.stamp(starts[index]) + ' ' + line.text).join('\n');
  if (missing) candidate.lyrics = lyrics;
  else {
    candidate = null;
    $('syncReview').replaceChildren();
  }
  if (analysis) {
    const sections = MVCore.labelSections(analysis.sections,aligned);
    analysis.sections = sections.map((section,index) => analysis.sections[index].edited ? analysis.sections[index] : section);
    renderSections();
  }
  $('lyrics').value = lyrics;
  validateSync(false);
  renderSubtitleDraft();
  $('timing').value = 'manual';
  timeline();
  repaint();
  const notice = missing ? `${timed.length} 行を適用しました。残り ${missing} 行に時刻を入れられます。` : '同期候補を適用しました。';
  $('syncStatus').textContent=notice;
  status(notice);
}
$('lyrics').addEventListener('input', () => {validateSync(false);renderSubtitleDraft();});
for(const id of ['introEnd','instrumentals']){
  $(id).addEventListener('input',()=>{validateSync(false);renderSubtitleDraft();});
  $(id).addEventListener('change',timeline);
}
$('applySync').onclick = () => validateSync(true);

function exportRange(duration){
  const from=$('rangeStart').value===''?0:$('rangeStart').valueAsNumber;
  const to=$('rangeEnd').value===''?duration:$('rangeEnd').valueAsNumber;
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to>duration+.01||from>=Math.min(duration,to))throw Error('出力区間が不正です');
  return [from,Math.min(to,duration)];
}
function recordFrames(context,length,from,drawFrame,signal){
  const started=context.currentTime;
  return new Promise((resolve,reject)=>{
    let frame, previous=-1;
    const abort=()=>{
      cancelAnimationFrame(frame);
      reject(new DOMException('中止しました','AbortError'));
    };
    signal.addEventListener('abort',abort,{once:true});
    function next(){
      try {
        const elapsed=context.currentTime-started;
        const index=Math.floor(Math.min(elapsed,length)*30);
        if(index!==previous){
          drawFrame(from+Math.min(elapsed,length));
          previous=index;
          const message=`書き出し ${Math.min(100,Math.floor(elapsed/length*100))}%`;
          if($('localStatus').textContent!==message)status(message);
        }
        if(elapsed>=length){signal.removeEventListener('abort',abort);resolve()}
        else frame=requestAnimationFrame(next);
      } catch (error) {
        signal.removeEventListener('abort',abort);
        reject(error);
      }
    }
    next();
  });
}
$('renderLocal').onclick=async()=>{
  if(recording||aiJob)return;
  if(mediaLoads||analyzing||projectBusy)return status('読み込みまたは解析の完了後に書き出してください');
  if(!soundFile)return status('音源を選択してください');
  if($('timing').value==='auto'&&lyricInput().length)return status('同期候補を適用するか、手動同期・仮同期を選択してください');
  if($('timing').value==='manual'&&$('lyrics').value.split(/\r?\n/).some(line=>line.trim()&&!MVCore.parseLrc(line).length))return status('書き出す前に、歌詞欄の時刻が空欄の行を同期してください。');
  const mp4=$('format').value==='mp4';
  const mime=window.MediaRecorder&&canvas.captureStream&&(mp4?['video/mp4;codecs="avc1.640028,mp4a.40.2"','video/mp4;codecs="avc1.42001f,mp4a.40.2"']:['video/webm;codecs=vp8,opus','video/webm']).find(type=>MediaRecorder.isTypeSupported(type));
  const controller=new AbortController(), signal=controller.signal;
  let context,stream,destination,recorder,source;
  const controls=new Map();
  renderController=controller;recording=true;
  const whenHidden=()=>{if(document.hidden)controller.abort('hidden')};
  document.addEventListener('visibilitychange',whenHidden);
  try{
    for(const el of document.querySelectorAll('input,select,textarea,button')){
      if(el.id==='cancelRender')continue;
      controls.set(el,el.disabled);el.disabled=true;
    }
    $('cancelRender').disabled=false;
    audio.pause();
    const [w,h]=size();canvas.width=w;canvas.height=h;
    status('書き出し準備中');
    context=new AudioContext({sampleRate:48000});
    const buffer=await context.decodeAudioData(await soundFile.arrayBuffer());
    if(signal.aborted)throw signal.reason||new DOMException('中止しました','AbortError');
    readVocalRanges(Number.isFinite(audio.duration) ? audio.duration : buffer.duration);
    const [from,to]=exportRange(buffer.duration), length=to-from;
    $('brightnessStatus').textContent='';
    let brightness=MVLayers.inspectBrightness();
    const drawFrame=time=>{
      draw(time,buffer.duration);
      brightness.frame(canvas,time);
    };
    const reportBrightness=()=>{
      $('brightnessStatus').textContent=`連続フレームの明暗チェック（簡易） 最大 ${brightness.peak()} 回／秒の明暗反転`;
    };
    const exporter=await import('./video-export.mjs');
    const options=await exporter.encodingOptions(mp4,w,h,buffer.numberOfChannels);
    if(signal.aborted)throw signal.reason||new DOMException('中止しました','AbortError');
    if(options){
      try {
        const file=await exporter.encode(canvas,buffer,from,to,options,
          drawFrame,
          progress=>status(`書き出し ${Math.floor(progress*100)}%`),signal);
        download(file,`MV.${mp4?'mp4':'webm'}`);
        reportBrightness();
        status('書き出し完了');
        return;
      }catch(error){
        if(signal.aborted||!mime)throw error;
        brightness=MVLayers.inspectBrightness();
        status('リアルタイム録画で再試行します');
      }
    }
    if(!mime){
      status(mp4?'H.264/AAC出力に非対応です。WebMを選択してください。':'WebM出力に非対応です');
      return;
    }
    await context.resume();
    if(signal.aborted)throw signal.reason||new DOMException('中止しました','AbortError');
    destination=context.createMediaStreamDestination();
    source=context.createBufferSource();source.buffer=buffer;source.connect(destination);
    drawFrame(from);
    stream=canvas.captureStream(30);
    for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.min(w,h)>720?8000000:4000000});
    const chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
    const stopped=new Promise(resolve=>{recorder.onstop=resolve});
    let recorderError;
    recorder.onerror=event=>{recorderError=event.error||Error('録画失敗');controller.abort()};
    recorder.start(1000);
    source.start(0,from,length);
    try{await recordFrames(context,length,from,drawFrame,signal)}
    catch(error){throw recorderError||error}
    if(recorder.state!=='inactive')recorder.stop();
    await stopped;
    if(signal.aborted)throw signal.reason||new DOMException('中止しました','AbortError');
    if(!chunks.length)throw Error('動画データを取得できませんでした');
    download(new Blob(chunks,{type:recorder.mimeType}),`MV.${mp4?'mp4':'webm'}`);
    reportBrightness();
    status('書き出し完了');
  }catch(error){
    status(signal.reason==='hidden'?'画面が非表示になったため中止しました':error.name==='AbortError'?'中止しました':'出力失敗: '+error.message+(mp4?'。WebMもお試しください。':''));
  }finally{
    document.removeEventListener('visibilitychange',whenHidden);
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    try{source?.stop()}catch{}
    stream?.getTracks().forEach(track=>track.stop());
    destination?.stream.getTracks().forEach(track=>track.stop());
    if(context)await context.close().catch(()=>{});
    renderController=null;recording=false;
    for(const [el,disabled] of controls)el.disabled=disabled;
    $('cancelRender').disabled=true;repaint();
  }
};
$('cancelRender').onclick=()=>renderController?.abort();
// Keep the cloud ZIP export compatible with saved media and local settings.
$('export').onclick=async()=>{try{if(!soundFile||!imageFiles.length)throw Error('音源と画像を選択してください');const ext=f=>f.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'');const p={...Object.fromEntries(['title','lyrics','timing','style','notes'].map(id=>[id,$(id).value])),bpm:+$('bpm').value,intensity:+$('intensity').value,audio:'audio.'+ext(soundFile),images:imageFiles.map((f,i)=>'image'+i+'.'+ext(f)),analysis,aligned,scenePlan,ratio:$('ratio').value,resolution:+$('resolution').value,karaoke:$('karaoke').checked};const entries=[['project.json',new TextEncoder().encode(JSON.stringify(p,null,2))],[p.audio,new Uint8Array(await soundFile.arrayBuffer())]];for(let i=0;i<imageFiles.length;i++)entries.push([p.images[i],new Uint8Array(await imageFiles[i].arrayBuffer())]);download(zip(entries),'mv-materials.zip');status('クラウド用素材ZIPを保存しました')}catch(e){status(e.message)}};
$('ratio').onchange();
tick();
})();
