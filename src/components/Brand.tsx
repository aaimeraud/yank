/**
 * The space the macOS traffic lights (close, minimize, full screen) need at
 * the top left of the window. The mark used to sit here; the Dock icon and
 * the favicon still carry the brand.
 */
export default function Brand() {
  return <div className="brand" data-tauri-drag-region aria-hidden="true" />;
}
