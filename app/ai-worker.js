/* Libraries and public weights are fetched only when the matching action is requested. */
self.onmessage = async ({data}) => {
  const progress = message => self.postMessage({progress: message});
  try {
    if (data.action === 'recognize') {
      const {pipeline, env} = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      const recognize = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny_timestamped', {
        device: 'wasm', dtype: 'q8', revision: '517244293732ee2d58139af5814231b7e6830a0d',
        progress_callback: event => {
          if (event.status === 'progress') progress(`モデル取得中 ${Math.floor(event.progress || 0)}%`);
        },
      });
      const chunks = [];
      const windowSize = 25 * 16000;
      for (let offset = 0; offset < data.samples.length; offset += windowSize) {
        progress(`歌唱認識中 ${Math.floor(offset / data.samples.length * 100)}%`);
        const from = Math.max(0, offset - 16000);
        const to = Math.min(data.samples.length, offset + windowSize + 16000);
        const result = await recognize(data.samples.subarray(from, to), {
          language: 'japanese', task: 'transcribe', return_timestamps: 'word',
        });
        for (const item of result.chunks || []) {
          const [start, end] = item.timestamp;
          if (start == null || end == null) continue;
          const timestamp = [start + from / 16000, end + from / 16000];
          const midpoint = (timestamp[0] + timestamp[1]) * 8000;
          if (midpoint >= offset && midpoint < Math.min(data.samples.length, offset + windowSize)) {
            chunks.push({text: item.text, timestamp});
          }
        }
      }
      self.postMessage({result: chunks});
    } else if (data.action === 'plan') {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw Error('WebGPUを利用できません');
      if (!adapter.features.has('shader-f16')) throw Error('この端末のWebGPUは演出モデルの演算形式に非対応です');
      const {CreateMLCEngine} = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm');
      const engine = await CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC', {
        initProgressCallback: event => progress(`演出モデルを準備中 ${Math.floor(event.progress * 100)}%`),
      });
      progress('演出プランを生成中');
      const completion = await engine.chat.completions.create({
        messages: [
          {role: 'system', content: 'You design music videos from Japanese instructions. Output one JSON object with base (effect defaults) and scenes (array). Each scene has numeric start/end in seconds, optionally image (zero based, also set explicitImage true), camera (in/out/pan/drift/default), animation (type/fade/bounce/default), and optional booleans mono/shake/quiet/flash/vignette/center/noText. Respect the requested time bounds and image count.'},
          {role: 'user', content: JSON.stringify(data.context)},
        ],
        response_format: {type: 'json_object'},
        temperature: 0.2,
        max_tokens: 900,
      });
      const result = JSON.parse(completion.choices[0].message.content);
      await engine.unload();
      self.postMessage({result});
    }
  } catch (error) {
    self.postMessage({error: error.message || String(error)});
  }
};
