/**
 * GamePage.jsx
 *
 * React wrapper + HUD overlay (Phase 1F — with compass indicator).
 *
 * Phase 2 changes:
 *   - Async bootstrap: geolocation → API fetch → game.init(graphData) → game.start()
 *   - Loading overlay shown during geolocation + map fetch
 *   - Error overlay with "Jogar offline" fallback (uses mock grid)
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

// ─── Geolocation helper ───────────────────────────────────────────────────────

/**
 * Wraps navigator.geolocation.getCurrentPosition in a Promise.
 * Rejects with a user-facing Error on denial or unavailability.
 */
function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Seu dispositivo não suporta geolocalização.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Permita o acesso à localização para carregar o mapa real.'));
        } else {
          reject(new Error('Não foi possível obter sua localização. Tente novamente.'));
        }
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GamePage() {
  const canvasRef = useRef(null);
  const gameRef   = useRef(null);

  // ── Loading / error state ─────────────────────────────────────────────────
  const [loadingStatus, setLoadingStatus] = useState('Obtendo localização…');
  const [errorMsg,      setErrorMsg]      = useState(null);

  // ── Game HUD state ────────────────────────────────────────────────────────
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

  // ── Bootstrap helper — shared between online and offline paths ────────────
  const startGame = useCallback(async (graphData) => {
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

    await game.init(graphData);  // null → mock grid fallback
    gameRef.current = game;
    game.start();
    setLoadingStatus(null);
    setErrorMsg(null);
  }, []);

  // ── Async bootstrap: geolocation → API → game ────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Request GPS position
      let position;
      try {
        position = await requestGeolocation();
      } catch (gpsErr) {
        if (cancelled) return;
        setLoadingStatus(null);
        setErrorMsg(gpsErr.message);
        return;
      }

      if (cancelled) return;

      // 2. Fetch map from API
      setLoadingStatus('Carregando mapa…');
      let graphData;
      try {
        graphData = await MiniDeliveryGame.loadFromAPI(position.lat, position.lng);
      } catch (apiErr) {
        if (cancelled) return;
        setLoadingStatus(null);
        setErrorMsg(apiErr.message);
        return;
      }

      if (cancelled) return;

      // 3. Init and start with real data
      setLoadingStatus('Iniciando jogo…');
      await startGame(graphData);
    })();

    return () => {
      cancelled = true;
      if (gameRef.current) {
        gameRef.current.destroy();
        gameRef.current = null;
      }
    };
  }, [startGame]);

  // ── Offline fallback — called when user taps "Jogar offline" ─────────────
  const handlePlayOffline = useCallback(async () => {
    setErrorMsg(null);
    setLoadingStatus('Iniciando modo offline…');
    console.warn('[MiniDelivery] Starting in offline mode with mock grid.');
    await startGame(null);  // null → GraphManager uses mock data
  }, [startGame]);

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

      {/* ── Loading overlay ──────────────────────────────────────────────── */}
      {loadingStatus && (
        <div id="loading-overlay" role="status" aria-live="polite">
          <div id="loading-spinner" aria-hidden="true" />
          <p id="loading-text">{loadingStatus}</p>
        </div>
      )}

      {/* ── Error overlay ────────────────────────────────────────────────── */}
      {errorMsg && (
        <div id="error-overlay" role="alert">
          <p id="error-text">{errorMsg}</p>
          <button
            id="btn-play-offline"
            className="hud-btn"
            onClick={handlePlayOffline}
          >
            🗺️ Jogar offline
          </button>
        </div>
      )}

      {/* ── HUD (only when game is running) ─────────────────────────────── */}
      {!loadingStatus && !errorMsg && (
        <>
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
        </>
      )}
    </div>
  );
}

export default GamePage;
