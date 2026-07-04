let overrideTime = 0;
window.__setFrame = (f, fps) => {
  overrideTime = f * (1000 / fps);
  if (window.__MOTIONFLOW_UPDATE__) window.__MOTIONFLOW_UPDATE__(f);
};
const _origNow = performance.now.bind(performance);
Object.defineProperty(performance, 'now', {
  get: () => () => overrideTime > 0 ? overrideTime : _origNow()
});
