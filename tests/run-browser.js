// Browser entry for tests/index.html: import every test file, then run them.
// Add new test files here (Node discovers *.test.js on its own).
import './core.test.js';
import './faces.test.js';
import './state.test.js';
import './pair.test.js';
import { runAll } from './harness.js';

runAll(document.getElementById('out'));
