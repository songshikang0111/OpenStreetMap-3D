import { CylinderGeometry, IcosahedronGeometry } from 'three';

export const crownGeometry = () => new IcosahedronGeometry(1, 1);
export const trunkGeometry = () => new CylinderGeometry(0.12, 0.18, 1, 6, 1).translate(0, 0.5, 0);
