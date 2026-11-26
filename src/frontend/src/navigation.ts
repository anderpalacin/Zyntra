// Volver atrás de verdad: a la página y la posición exactas de donde venías.
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/** "Back": vuelve a la entrada anterior del historial; si se abrió la página directamente, va a `fallback`. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback);
  }, [location.key, navigate, fallback]);
}

// Posición de scroll de cada entrada del historial (location.key), mientras dure la pestaña.
const positions = new Map<string, number>();
const RESTORE_TIMEOUT = 8000; // las páginas cargan datos: esperamos a que haya altura suficiente

/**
 * Al volver (atrás/adelante) restaura el scroll que tenía esa página; al ir a una página nueva, arriba del todo.
 * El BrowserRouter de React Router no lo hace solo y el navegador no puede, porque el contenido llega después.
 */
export function useScrollMemory() {
  const location = useLocation();
  const type = useNavigationType();
  const lastPath = useRef(location.pathname);

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  useEffect(() => {
    const key = location.key;
    let restoring = false;
    let raf = 0;
    const save = () => {
      if (!restoring) positions.set(key, window.scrollY);
    };
    const stop = () => {
      restoring = false;
      cancelAnimationFrame(raf);
    };
    window.addEventListener('scroll', save, { passive: true });
    // Si el usuario se mueve mientras esperamos, no le arrastramos.
    const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    userEvents.forEach((e) => window.addEventListener(e, stop, { passive: true }));

    const target = positions.get(key);
    if (type === 'POP' && target !== undefined) {
      restoring = true;
      const start = performance.now();
      const tick = () => {
        if (!restoring) return;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(target, Math.max(max, 0)));
        if (max >= target || performance.now() - start > RESTORE_TIMEOUT) restoring = false;
        else raf = requestAnimationFrame(tick);
      };
      tick();
    } else if (type !== 'POP' && location.pathname !== lastPath.current) {
      window.scrollTo(0, 0); // página nueva (cambiar de ciudad dentro de la misma página no mueve el scroll)
    }
    lastPath.current = location.pathname;

    return () => {
      stop();
      window.removeEventListener('scroll', save);
      userEvents.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
}
