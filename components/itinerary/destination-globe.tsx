'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { phase2Fetch } from '@/lib/phase2/client';

type Camera = {
  center: { lat: number; lng: number; altitude?: number };
  range: number;
  tilt: number;
  heading?: number;
};

type Map3D = HTMLElement & {
  flyCameraAround: (options: {
    camera: Camera;
    durationMillis: number;
    repeatCount: number;
  }) => void | Promise<void>;
  flyCameraTo: (options: {
    endCamera: Camera;
    durationMillis: number;
  }) => void | Promise<void>;
  stopCameraAnimation: () => void;
};

type MapsWindow = Window & {
  google?: {
    maps?: {
      importLibrary?: (
        library: string,
      ) => Promise<{ Map3DElement: new (options: object) => Map3D }>;
    };
  };
};

type LocationResponse = {
  location: {
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
  };
};

export type DestinationGlobeHandle = {
  pauseIdle: () => void;
  resumeIdle: () => void;
  flyTo: (destination: string) => Promise<boolean>;
  returnToGlobe: (resumeRotation: boolean) => Promise<void>;
};

const GLOBAL_CAMERA: Camera = {
  center: { lat: 12, lng: 18, altitude: 0 },
  range: 20_500_000,
  tilt: 0,
  heading: 0,
};

let mapsLoader: Promise<void> | null = null;

function waitForMapsImportLibrary() {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if ((window as MapsWindow).google?.maps?.importLibrary) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= 10_000) {
        reject(new Error('MAP_LOAD_FAILED'));
        return;
      }
      window.setTimeout(check, 50);
    };
    check();
  });
}

function loadMaps(apiKey: string) {
  const mapsWindow = window as MapsWindow;
  if (mapsWindow.google?.maps?.importLibrary) return Promise.resolve();
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-destination-globe]',
    );
    if (existing) {
      existing.addEventListener(
        'load',
        () => void waitForMapsImportLibrary().then(resolve, reject),
        { once: true },
      );
      existing.addEventListener(
        'error',
        () => reject(new Error('MAP_LOAD_FAILED')),
        {
          once: true,
        },
      );
      return;
    }
    const script = document.createElement('script');
    script.dataset.destinationGlobe = 'true';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
    script.onload = () => void waitForMapsImportLibrary().then(resolve, reject);
    script.onerror = () => reject(new Error('MAP_LOAD_FAILED'));
    document.head.append(script);
  });
  return mapsLoader;
}

function animationEnd(map: Map3D, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      map.removeEventListener('gmp-animationend', finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    map.addEventListener('gmp-animationend', finish, { once: true });
  });
}

export const DestinationGlobe = forwardRef<
  DestinationGlobeHandle,
  { tripId: string; idleEnabled: boolean }
>(function DestinationGlobe({ tripId, idleEnabled }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map3D | null>(null);
  const idleEnabledRef = useRef(idleEnabled);
  const locationCache = useRef(new Map<string, LocationResponse['location']>());
  const disposedRef = useRef(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  function stopCamera() {
    mapRef.current?.stopCameraAnimation();
  }

  function startIdle() {
    const map = mapRef.current;
    if (!map) return;
    map.stopCameraAnimation();
    void map.flyCameraAround({
      camera: GLOBAL_CAMERA,
      durationMillis: 45_000,
      repeatCount: Number.POSITIVE_INFINITY,
    });
  }

  async function resolveLocation(destination: string) {
    const key = destination.trim().toLowerCase();
    const cached = locationCache.current.get(key);
    if (cached) return cached;
    const payload = await phase2Fetch<LocationResponse>(
      `/api/trips/${tripId}/destination-location`,
      { method: 'POST', body: JSON.stringify({ query: destination }) },
    );
    locationCache.current.set(key, payload.location);
    return payload.location;
  }

  async function flyTo(destination: string) {
    const map = mapRef.current;
    if (!map) return false;
    stopCamera();
    try {
      const location = await resolveLocation(destination);
      if (disposedRef.current) return false;
      const ended = animationEnd(map, 8_000);
      await map.flyCameraTo({
        endCamera: {
          center: {
            lat: location.latitude,
            lng: location.longitude,
            altitude: 0,
          },
          range: 58_000,
          tilt: 48,
          heading: 18,
        },
        durationMillis: 6_500,
      });
      await ended;
      return !disposedRef.current;
    } catch {
      return false;
    }
  }

  async function returnToGlobe(resumeRotation: boolean) {
    const map = mapRef.current;
    if (!map) return;
    stopCamera();
    const ended = animationEnd(map, 5_000);
    await map.flyCameraTo({ endCamera: GLOBAL_CAMERA, durationMillis: 3_800 });
    await ended;
    if (resumeRotation && !disposedRef.current) startIdle();
  }

  useImperativeHandle(ref, () => ({
    pauseIdle: stopCamera,
    resumeIdle: startIdle,
    flyTo,
    returnToGlobe,
  }));

  useEffect(() => {
    disposedRef.current = false;
    if (!apiKey || !containerRef.current) {
      setStatus('unavailable');
      return;
    }

    void loadMaps(apiKey)
      .then(async () => {
        const mapsWindow = window as MapsWindow;
        const library =
          await mapsWindow.google?.maps?.importLibrary?.('maps3d');
        if (!library || disposedRef.current || !containerRef.current) {
          throw new Error('MAP_3D_UNAVAILABLE');
        }
        const map = new library.Map3DElement({
          ...GLOBAL_CAMERA,
          mode: 'SATELLITE',
          defaultUIHidden: true,
          gestureHandling: 'GREEDY',
        });
        map.style.width = '100%';
        map.style.height = '100%';
        containerRef.current.replaceChildren(map);
        mapRef.current = map;
        setStatus('ready');
        if (idleEnabledRef.current) {
          map.stopCameraAnimation();
          void map.flyCameraAround({
            camera: GLOBAL_CAMERA,
            durationMillis: 45_000,
            repeatCount: Number.POSITIVE_INFINITY,
          });
        }
      })
      .catch(() => setStatus('unavailable'));

    return () => {
      disposedRef.current = true;
      mapRef.current?.stopCameraAnimation();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    idleEnabledRef.current = idleEnabled;
    const map = mapRef.current;
    if (!map) return;
    map.stopCameraAnimation();
    if (idleEnabled) {
      void map.flyCameraAround({
        camera: GLOBAL_CAMERA,
        durationMillis: 45_000,
        repeatCount: Number.POSITIVE_INFINITY,
      });
    }
  }, [idleEnabled]);

  return (
    <div className="absolute inset-0 bg-[#071019]">
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Interactive 3D Earth"
      />
      {status !== 'ready' && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_45%,#244962_0%,#0b1d2c_32%,#05090e_72%)]" />
      )}
      {status === 'loading' && (
        <p className="absolute bottom-5 right-6 text-xs tracking-[0.14em] text-white/55">
          LOADING EARTH
        </p>
      )}
      {status === 'unavailable' && (
        <p className="absolute bottom-5 right-6 max-w-xs text-right text-xs leading-5 text-white/58">
          3D Earth needs a browser-restricted Google Maps JavaScript API key.
        </p>
      )}
    </div>
  );
});
