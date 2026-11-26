"""Private CPU Whisper recognition + character matching. Not acoustic forced alignment."""
import json, pathlib, unicodedata, difflib

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFKC',s).casefold() if c.isalnum())

def align(lines, words):
    heard=[]; times=[]
    for w in words:
        chars=norm(w['text'])
        for j,c in enumerate(chars):
            heard.append(c); times.append((w['start']+(w['end']-w['start'])*j/len(chars),w['start']+(w['end']-w['start'])*(j+1)/len(chars),w.get('probability')))
    expected=''.join(norm(x) for x in lines)
    if not expected or not heard: raise ValueError('No usable lyrics recognized')
    mapping={a+j:times[b+j] for a,b,n in difflib.SequenceMatcher(None,expected,''.join(heard),autojunk=False).get_matching_blocks() for j in range(n)}
    confidence=len(mapping)/len(expected)
    if confidence<.55: raise ValueError(f'Low alignment coverage {confidence:.0%}; use manual timestamps')
    result=[]; offset=0
    for line in lines:
        chars=[]
        for char in line:
            n=len(norm(char)); matched=[mapping[i] for i in range(offset,offset+n) if i in mapping];offset+=n
            chars.append({'text':char,'start':matched[0][0] if matched else None,'end':matched[-1][1] if matched else None,'matched':bool(matched)})
        valid=[c for c in chars if c['matched']]; coverage=len(valid)/max(1,sum(bool(norm(c['text'])) for c in chars))
        if not valid or coverage<.4: raise ValueError(f'Low line coverage: {line}; use manual timestamps')
        start=valid[0]['start'];end=valid[-1]['end']
        for i,c in enumerate(chars):
            if c['start'] is not None: continue
            left=next((j for j in range(i-1,-1,-1) if chars[j]['matched']),None);right=next((j for j in range(i+1,len(chars)) if chars[j]['matched']),None)
            a=chars[left]['end'] if left is not None else start;b=chars[right]['start'] if right is not None else end
            lo=left if left is not None else -1;hi=right if right is not None else len(chars)
            c['start']=a+(b-a)*(i-lo-1)/max(1,hi-lo-1);c['end']=a+(b-a)*(i-lo)/max(1,hi-lo-1)
        result.append({'text':line,'start':start,'end':end,'coverage':coverage,'characters':chars})
    return {'method':'whisper_word_character_interpolation','coverage':confidence,'lines':result,'recognized_words':words}

def main():
    from faster_whisper import WhisperModel
    root=pathlib.Path('public'); p=json.loads((root/'project.json').read_text())
    if p['timing']!='auto': return
    lines=[x.strip() for x in p['lyrics'].splitlines() if x.strip()]
    segments,_=WhisperModel('small',device='cpu',compute_type='int8').transcribe(str(root/p['audio']),language='ja',word_timestamps=True,vad_filter=False,condition_on_previous_text=False)
    words=[{'text':w.word,'start':w.start,'end':w.end,'probability':w.probability} for s in segments for w in s.words or []]
    out=pathlib.Path('out');out.mkdir(exist_ok=True);(out/'recognized_words.json').write_text(json.dumps(words,ensure_ascii=False,indent=2))
    result=align(lines,words)
    def stamp(t):
        cs=round(t*100);return f'[{cs//6000:02d}:{(cs%6000)/100:05.2f}]'
    p['lyrics']='\n'.join(stamp(r['start'])+' '+r['text'] for r in result['lines']);p['timing']='manual';p['aligned']=result['lines']
    (root/'project.json').write_text(json.dumps(p,ensure_ascii=False,indent=2));(out/'aligned.lrc').write_text(p['lyrics']);(out/'alignment.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
