// Connects the store to the face search: starts a search when the store asks for one,
// reports progress, and stops it when the teacher cancels or starts over.
import { actions, getState, subscribe } from '../state.js';
import { t } from '../strings.js';
import { collectDetections, runSearch } from './search.js';

let detectorPromise = null;
let cacheFor = null;   // { photoId, cache }: raw detections per level, reused when only the sensitivity changes
let active = null;     // { requestId, abort }

/** The detector is loaded once, on the first photo (the runtime is large). A failed load can be retried. */
function loadDetector() {
  detectorPromise ??= (async () => {
    const { createMediaPipeDetector } = await import('./mediapipe.js');
    const detector = createMediaPipeDetector();
    await detector.init();
    return detector;
  })().catch((err) => { detectorPromise = null; throw err; });
  return detectorPromise;
}

async function run(requestId) {
  const { photo, sensitivity } = getState();
  if (!cacheFor || cacheFor.photoId !== photo.id) cacheFor = { photoId: photo.id, cache: new Map() };
  const { cache } = cacheFor;
  active?.abort.abort();
  const abort = new AbortController();
  active = { requestId, abort };
  try {
    const detector = await loadDetector();
    abort.signal.throwIfAborted();
    const detections = await runSearch({
      photo, detector, sensitivity, cache, signal: abort.signal,
      onProgress: (p) => actions.detectionProgress(p, t('detect.scanning', Math.round(p * 100))),
      onLevelDone: () => actions.detectionPreview(collectDetections({ photo, cache, sensitivity })),
    });
    if (abort.signal.aborted || getState().detect.requestId !== requestId) return;
    actions.detectionDone(detections);
  } catch (err) {
    if (abort.signal.aborted || err?.name === 'AbortError') return;
    console.error('Face detection failed:', err);
    actions.detectionFailed(err);
  }
}

export function startDetectionController() {
  let handled = getState().detect.requestId;
  subscribe((s) => {
    if (s.detect.status === 'running' && s.detect.requestId !== handled) {
      handled = s.detect.requestId;
      run(s.detect.requestId);
    }
    // Finished, failed, cancelled or the teacher started over: stop whatever is still running.
    if (active && (s.detect.status !== 'running' || s.detect.requestId !== active.requestId)) {
      active.abort.abort();
      active = null;
    }
  });
}
