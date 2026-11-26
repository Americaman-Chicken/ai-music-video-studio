importScripts('./core.js');
self.onmessage = ({data}) => {
  try {
    const {samples, sampleRate} = data;
    const result = MVCore.structure(samples, sampleRate, MVCore.analyze(samples, sampleRate));
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
