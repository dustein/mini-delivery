/**
 * TouchControls.jsx
 *
 * Mobile on-screen controls rendered as HTML elements over the canvas.
 * Layout (confirmed in plan):
 *   - Right side (vertical):   [↑] aceleração  /  [↓] freio/ré
 *   - Bottom center (horizontal): [←]  [→] direção
 *
 * Each button fires onPress(key) on touchstart/mousedown and
 * onRelease(key) on touchend/touchcancel/mouseup/mouseleave.
 *
 * Visual pressed state is handled purely with CSS :active to avoid
 * per-press React re-renders (zero state in this component).
 *
 * Props:
 *   onPress(key: string)    — key = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
 *   onRelease(key: string)
 */

const BUTTONS = {
  ArrowUp:    { symbol: '▲', label: 'Accelerate' },
  ArrowDown:  { symbol: '▼', label: 'Brake / Reverse' },
  ArrowLeft:  { symbol: '◀', label: 'Turn Left' },
  ArrowRight: { symbol: '▶', label: 'Turn Right' },
};

/**
 * A single touch/mouse button.
 * No React state — visual feedback via CSS :active only.
 */
function TouchButton({ keyCode, onPress, onRelease }) {
  const { symbol, label } = BUTTONS[keyCode];

  const handleStart = (e) => {
    e.preventDefault();   // block browser scroll/zoom
    onPress(keyCode);
  };

  const handleEnd = (e) => {
    e.preventDefault();
    onRelease(keyCode);
  };

  return (
    <button
      className="touch-btn"
      // Touch (mobile)
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
      // Mouse (desktop testing)
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      aria-label={label}
    >
      {symbol}
    </button>
  );
}

export function TouchControls({ onPress, onRelease }) {
  return (
    <div id="touch-controls" aria-hidden="true">

      {/* Right-side vertical group: accelerate / brake */}
      <div id="touch-throttle">
        <TouchButton keyCode="ArrowUp"   onPress={onPress} onRelease={onRelease} />
        <TouchButton keyCode="ArrowDown" onPress={onPress} onRelease={onRelease} />
      </div>

      {/* Bottom-center horizontal group: steer left / right */}
      <div id="touch-steer">
        <TouchButton keyCode="ArrowLeft"  onPress={onPress} onRelease={onRelease} />
        <TouchButton keyCode="ArrowRight" onPress={onPress} onRelease={onRelease} />
      </div>

    </div>
  );
}

export default TouchControls;
