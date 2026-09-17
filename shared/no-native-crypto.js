// CryptoJS public-player decoding supplies fixed salt/IV and never needs random
// bytes. Keep its optional Node fallback out of the native SkyStream bundle.
export function randomBytes() {
  throw new Error('Random generation is unavailable in the player decoder');
}
