import type * as THREE from 'three';
export interface ToonPack {
  id: string;
  version: string;
  supportsTiles: true;
  hostCompatible: true;
  loaded: Set<string>;
  [key: string]: unknown;
}
export default function toonPack(three: typeof THREE): ToonPack;
