const FPS = 30;
const SAMPLE_RATE = 48000;
const AUDIO_BATCH = SAMPLE_RATE / 50;
const micros = seconds => Math.round(seconds * 1_000_000);
const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));

export async function encodingOptions(mp4, width, height, channels) {
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder || channels > 2) return null;
  const video = {
    codec: mp4 ? 'avc1.640028' : 'vp8',
    width, height, framerate: FPS,
    bitrate: Math.min(width, height) > 720 ? 8_000_000 : 4_000_000,
  };
  if (mp4) video.avc = {format: 'avc'};
  const audio = {
    codec: mp4 ? 'mp4a.40.2' : 'opus',
    sampleRate: SAMPLE_RATE, numberOfChannels: channels, bitrate: channels === 1 ? 96_000 : 160_000,
  };
  try {
    const [videoSupport, audioSupport] = await Promise.all([
      VideoEncoder.isConfigSupported(video), AudioEncoder.isConfigSupported(audio),
    ]);
    return videoSupport.supported && audioSupport.supported ? {mp4, video, audio} : null;
  } catch {
    return null;
  }
}

export async function encode(canvas, buffer, from, to, options, paint, onProgress, signal) {
  const {mp4, video, audio} = options;
  const {Muxer, ArrayBufferTarget} = await (mp4
    ? import('./vendor/mp4-muxer.mjs')
    : import('./vendor/webm-muxer.mjs'));
  signal.throwIfAborted();
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {codec: mp4 ? 'avc' : 'V_VP8', width: video.width, height: video.height, frameRate: FPS},
    audio: {codec: mp4 ? 'aac' : 'A_OPUS', sampleRate: SAMPLE_RATE, numberOfChannels: audio.numberOfChannels},
    ...(mp4 ? {fastStart: 'in-memory'} : {}),
    firstTimestampBehavior: 'offset',
  });
  let failure;
  const fail = error => { failure ||= error; };
  function output(method) {
    return (chunk, metadata) => {
      if (failure || signal.aborted) return;
      try { muxer[method](chunk, metadata); } catch (error) { fail(error); }
    };
  }
  function check() {
    signal.throwIfAborted();
    if (failure) throw failure;
  }
  let videoEncoder, audioEncoder;
  try {
    videoEncoder = new VideoEncoder({output: output('addVideoChunk'), error: fail});
    audioEncoder = new AudioEncoder({output: output('addAudioChunk'), error: fail});
    videoEncoder.configure(video);
    audioEncoder.configure(audio);
    const audioChannels = Array.from({length: audio.numberOfChannels}, (_, index) => buffer.getChannelData(index));
    const endSample = Math.min(buffer.length, Math.round(to * SAMPLE_RATE));
    const startSample = Math.round(from * SAMPLE_RATE);
    const length = to - from;
    const frameCount = Math.ceil(length * FPS);
    let sample = startSample;
    for (let index = 0; index < frameCount; index++) {
      check();
      const time = index / FPS;
      const frameEnd = Math.min(length, (index + 1) / FPS);
      paint(from + time);
      const frame = new VideoFrame(canvas, {timestamp: micros(time), duration: micros(frameEnd) - micros(time)});
      try { videoEncoder.encode(frame, {keyFrame: index % (FPS * 2) === 0}); } finally { frame.close(); }
      const audioThrough = Math.min(endSample, startSample + Math.ceil(frameEnd * SAMPLE_RATE));
      while (sample < audioThrough) {
        const numberOfFrames = Math.min(AUDIO_BATCH, endSample - sample);
        const data = new Float32Array(numberOfFrames * audioChannels.length);
        audioChannels.forEach((channel, channelIndex) => {
          data.set(channel.subarray(sample, sample + numberOfFrames), channelIndex * numberOfFrames);
        });
        const packet = new AudioData({
          format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames,
          numberOfChannels: audioChannels.length, timestamp: micros((sample - startSample) / SAMPLE_RATE), data,
        });
        try { audioEncoder.encode(packet); } finally { packet.close(); }
        sample += numberOfFrames;
      }
      if (index % 4 === 0) {
        onProgress(index / frameCount);
        await yieldToPage();
      }
      while (videoEncoder.encodeQueueSize > 6 || audioEncoder.encodeQueueSize > 12) {
        await yieldToPage();
        check();
      }
    }
    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    check();
    muxer.finalize();
    return new Blob([target.buffer], {type: mp4 ? 'video/mp4' : 'video/webm'});
  } finally {
    if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
  }
}
