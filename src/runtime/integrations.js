import { decodeChunk } from '../core/scene-codec.js';
import * as styleApi from '../styles/index.js';
// Static imports preserve the public SDK in production bundles and nested URLs.
export async function loadDefaultAdapters() {
  return { decodeChunk, styleApi, createShared: styleApi.createStyleShared };
}
