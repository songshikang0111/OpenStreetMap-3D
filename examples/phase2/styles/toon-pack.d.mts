import type * as THREE from 'three';
import type { StylePack } from '@city-ink/map';
export interface ToonPack extends StylePack {
  id: string;
  version: string;
  supportsTiles: true;
  hostCompatible: true;
  loaded: Set<string>;
}
export default function toonPack(three: typeof THREE): ToonPack;
