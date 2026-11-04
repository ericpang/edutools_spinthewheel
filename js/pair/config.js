// How the phone and the computer find each other (README 4.1, UP-7, section 7).
//
// The two pages that use these settings (pair.html and send.html) have their own Content-Security-Policy, and it
// names the signalling host below. If you change `signalling.host`, change `connect-src` in both pages too
// (a test checks that they agree). The main page never talks to anyone but itself.
export const PAIRING = Object.freeze({
  /** false hides the "Use a photo from your phone" button. */
  enabled: true,
  /** PeerJS's free public pairing service. To run your own: https://github.com/peers/peerjs-server */
  signalling: Object.freeze({ host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' }),
  /**
   * null uses PeerJS's defaults: a Google STUN server and PeerJS's TURN relays (which only ever see encrypted bytes).
   * Set your own list, for example [{ urls: 'stun:stun.example.org:3478' }], to use other servers.
   */
  iceServers: null,
  /** How long the computer's code works. */
  sessionMinutes: 10,
  /** How long the phone waits to reach the computer. */
  connectSeconds: 25,
});
