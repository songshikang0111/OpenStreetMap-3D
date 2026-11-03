const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** Apply saved or programmatic views without orbit damping or polar clamping. */
export function applyView(camera, controls, view) {
  if (!view || typeof view !== 'object' || view.position !== undefined && !vector(view.position) || view.target !== undefined && !vector(view.target) || view.fov != null && (!Number.isFinite(view.fov) || view.fov < 5 || view.fov > 140)) throw new TypeError('View needs finite position/target and FOV in [5, 140].');
  if (view.near != null && (!Number.isFinite(view.near) || view.near <= 0)) throw new TypeError('near must be positive.');
  // Consume the previous gesture's remaining damping before installing an exact
  // saved view. Otherwise a valid setView can drift on subsequent RAF updates.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  try {
    controls.update();
    if (view.position) camera.position.fromArray(view.position);
    if (view.target) controls.target.fromArray(view.target);
    if (view.fov != null) camera.fov = view.fov;
    if (view.near != null) camera.near = view.near;
    camera.updateProjectionMatrix();
    controls.update();
  } finally { controls.enableDamping = damping; }
}
