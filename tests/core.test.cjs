const assert=require('node:assert/strict'), c=require('../app/core.js');
assert.equal(c.stamp(59.999),'[01:00.00]');assert.deepEqual(c.parseLrc('[00:01.00][00:03.00] あ\n[ar:abc]'),[{start:1,text:'あ'},{start:3,text:'あ'}]);
const p=c.scenes('白黒\n10-20秒: 画像2 ズームイン\nサビ: 揺れ',[{start:20,end:30,kind:'サビ'}],25);assert.equal(p.scenes.length,2);assert.equal(p.scenes[0].image,1);assert.equal(p.scenes[1].end,25);assert.equal(p.base.mono,true);
const sr=8000,x=new Float32Array(sr*12);for(let i=0;i<x.length;i++)if(i%(sr/2)<sr*.025)x[i]=Math.sin(i*.6)*.8;const a=c.analyze(x,sr);assert.ok(Math.abs(a.bpm-120)<=3,JSON.stringify(a));assert.ok(a.beats.length>20);assert.ok(c.analyze(new Float32Array(sr*2),sr).confidence<.08);console.log('core regression passed',a.bpm);
