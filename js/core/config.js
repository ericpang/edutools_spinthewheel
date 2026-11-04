// Tunable numbers from the README (sections 4 to 6). Keep this file and the README in sync.

// Wheel and faces
export const MAX_FACES = 50;            // FD-8: at most this many faces on the wheel
export const MIN_FACES = 2;             // RV-6: faces needed to build the wheel
export const SMALL_FACE_PX = 48;        // a face box shorter than this is a "small face"
export const LABEL_MAX = 40;            // RV-4
export const LOW_CONFIDENCE = 0.65;     // detections scoring below this are flagged "check" in the review

// Photo intake (UP-3)
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const WORKING_COPY_MAX_PIXELS = 25_000_000;
export const LOW_RES_EDGE_PX = 1000;

// Crops (5.4)
export const THUMB_SIZE = 256;
export const POPOUT_CROP_CAP = 1024;
export const CROP_PADDING = 1.8;
export const CROP_SHIFT_UP = 0.05;

// Detection (5.2)
export const TILE_CANVAS_PX = 256;      // tiles are resized to this before the model sees them
export const MIN_FACE_FRACTION = 0.17;  // model card: faces at 15% to 20% of the input side or more
// A level is responsible for faces from 17% to 34% of its tile (the next level takes over at 34%), so tiles
// must overlap by at least 34%: then every such face lies whole inside at least one tile.
export const TILE_OVERLAP = 0.35;
export const MODEL_MIN_SCORE = 0.2;     // lowest score kept in the cache; sensitivity levels filter above it
export const MERGE_IOU = 0.4;
export const MERGE_CONTAINMENT = 0.7;
export const MIN_ASPECT = 0.5;
export const MAX_ASPECT = 2;

export const SENSITIVITY = Object.freeze({
  low: Object.freeze({ minScore: 0.7, smallest: 48 }),
  normal: Object.freeze({ minScore: 0.5, smallest: 32 }),
  high: Object.freeze({ minScore: 0.35, smallest: 24 }),
  max: Object.freeze({ minScore: 0.25, smallest: 16 }),
});
export const SENSITIVITY_ORDER = Object.freeze(['low', 'normal', 'high', 'max']);
export const DEFAULT_SENSITIVITY = 'normal';

// Spin (6.2)
export const SPIN_TURNS = 3;            // full rounds before the wheel settles (then the rest of the turn to the landing spot)
export const LANDING_MARGIN = Object.freeze([0.15, 0.85]);
export const SPIN_SECONDS = Object.freeze({ short: [2.5, 3.5], normal: [4, 6], long: [7, 9] });
export const THUMB_RING_FRACTION = 0.74;
