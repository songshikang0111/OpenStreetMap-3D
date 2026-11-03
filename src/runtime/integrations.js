import { decodeChunk } from '../core/scene-codec.js';
import { validateSceneManifest } from '../core/scene-manifest.js';
import * as styleApi from '../styles/index.js';
// Static imports preserve the public SDK in production bundles and nested URLs.
export async function loadDefaultAdapters() {
  return { decodeChunk, validateSceneManifest, styleApi, createShared: styleApi.createStyleShared };
}
