/**
 * GamePage.jsx
 *
 * React wrapper + HUD overlay (Phase 1F — with compass indicator).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MiniDeliveryGame } from '../engine/MiniDeliveryGame.js';
import { ZOOM_LEVELS }      from '../engine/Camera.js';
import { TouchControls }    from './TouchControls.jsx';
import '../styles/game.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ZOOM_LABEL = {
  [ZOOM_LEVELS.STREET]:       '🔍 Street',
  [ZOOM_LEVELS.NEIGHBORHOOD]: '🔍 City',
  [ZOOM_LEVELS.CITY]:         '🔍 Full Map',
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const OBJECTIVE_LABEL = {
  PICKUP:   '📦 Go to pickup',
  DELIVERY: '🏠 Deliver the package',
  COMPLETE: '✅ Delivered!',
};

/**
 * Compass arrow that rotates toward the objective bearing.
 * bearingDeg: 0 = East (canvas convention), 90 = South, etc.
 * We rotate a ▲ arrow glyph to point toward the target.
 */
function CompassArrow({ bearingDeg, objectiveState }) {
  if (objectiveState === 'COMPLETE') return null;

  // Canvas convention: 0° = East (right). CSS rotate: 0° = up (North).
  // Adjustment: CSS up = canvas -90°, so add 90° to convert.
  const cssRotation = bearingDeg + 90;

  return (
    <span
      id="hud-compass"
      style={{ transform: `rotate(${cssRotation}deg)` }}
      aria-hidden="true"
      title="Direction to objective"
    >
      ▲
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GamePage() {
  const canvasRef = useRef(null);
  const gameRef   = useRef(null);

  const [gameState, setGameState] = useState({
    zoomLevel:       ZOOM_LEVELS.STREET,
    speed:           0,
    vehicleState:    'MOVING',
    objectiveState:  'PICKUP',
    totalDeliveries: 0,
    elapsedTime:     0,
    lastDeliveryTime: null,
    bearingDeg:      0,
    distPx:          0,
  });

  // ── Bootstrap engine ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new MiniDeliveryGame(canvas, (state) => {
      setGameState((prev) => {
        // Skip re-render if nothing meaningful changed
        if (
          prev.zoomLevel       === state.zoomLevel       &&
          prev.vehicleState    === state.vehicleState    &&
          prev.objectiveState  === state.objectiveState  &&
          prev.totalDeliveries === state.totalDeliveries &&
          Math.abs(prev.speed        - state.speed)        < 1   &&
          Math.abs(prev.elapsedTime  - state.elapsedTime)  < 0.5 &&
          Math.abs(prev.bearingDeg   - state.bearingDeg)   < 5   &&
          Math.abs(prev.distPx       - state.distPx)       < 8
        ) return prev;
        return state;
      });
    });

    gameRef.current = game;
    game.start();

    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const handleZoomCycle = useCallback(() => gameRef.current?.cycleZoom(), []);
  const handlePress     = useCallback((key) => gameRef.current?.pressKey(key),   []);
  const handleRelease   = useCallback((key) => gameRef.current?.releaseKey(key), []);

  const {
    zoomLevel, speed, vehicleState, objectiveState,
    totalDeliveries, elapsedTime, lastDeliveryTime,
    bearingDeg, distPx,
  } = gameState;

  const isDeadEnd  = vehicleState  === 'DEADEND';
  const isComplete = objectiveState === 'COMPLETE';

  // Convert world-pixel distance to approximate "blocks" for display
  const distBlocks = Math.round(distPx / 160);

  return (
    <div id="game-page">
      <canvas ref={canvasRef} id="game-canvas" />

      <div id="hud">
        {/* ── Top-left: objective + timer + compass ─────────────── */}
        <div id="hud-top-left" className="hud-panel">
          <div id="hud-stack">
            <span
              id="hud-objective"
              className={`hud-label ${isComplete ? 'hud-label--complete' : ''}`}
            >
              {OBJECTIVE_LABEL[objectiveState] ?? ''}
            </span>

            <div id="hud-nav-row">
              <span id="hud-timer" className="hud-badge">⏱ {formatTime(elapsedTime)}</span>
              {!isComplete && distPx > 0 && (
                <>
                  <CompassArrow
                    bearingDeg={bearingDeg}
                    objectiveState={objectiveState}
                  />
                  <span className="hud-badge" id="hud-dist">
                    {distBlocks > 0 ? `${distBlocks} blk` : 'here!'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Top-right: score + zoom ────────────────────────────── */}
        <div id="hud-top-right" className="hud-panel">
          <span id="hud-score" className="hud-badge">🚚 {totalDeliveries}</span>
          <button
            id="btn-zoom"
            className="hud-btn"
            onClick={handleZoomCycle}
            aria-label="Cycle zoom level"
          >
            {ZOOM_LABEL[zoomLevel] ?? '🔍'}
          </button>
        </div>

        {/* ── Centre: contextual banners ─────────────────────────── */}
        {isDeadEnd && (
          <div id="hud-deadend" className="hud-center">
            🚫 Dead end — hold ↓ to reverse
          </div>
        )}

        {isComplete && (
          <div id="hud-complete" className="hud-center">
            ✅ Delivered in {formatTime(lastDeliveryTime ?? 0)}!
          </div>
        )}

        {/* ── Bottom-left: speed ────────────────────────────────── */}
        <div id="hud-bottom-left" className="hud-panel hud-bottom-left">
          <span id="hud-speed" className="hud-badge">{speed} px/s</span>
        </div>
      </div>

      <TouchControls onPress={handlePress} onRelease={handleRelease} />
    </div>
  );
}

export default GamePage;
