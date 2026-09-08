const { chromium } = require(process.env.PLAYWRIGHT_ENTRY);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
  });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.route('**/api/trips/runtime-validation/itinerary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        trip: {
          id: 'runtime-validation',
          destination: null,
          destinationInput: null,
          durationDays: 3,
          startDate: null,
          endDate: null,
          explorationPreference: 'nearby_day_trips',
          geographicScope: null,
          arrivalTime: null,
          departureTime: null,
          arrivalPoint: null,
          departurePoint: null,
          finalizedAt: null,
          finalizedBy: null,
          planningMode: null,
          setupStage: 'destination',
          isHost: true,
          hostDisplayName: 'Runtime validation',
        },
        itinerary: null,
      }),
    });
  });

  await page.goto(
    'http://localhost:3000/trip/runtime-validation/itinerary?step=destination',
    { waitUntil: 'domcontentloaded', timeout: 45_000 },
  );
  await page.waitForTimeout(15_000);

  const beforeHeading = await page.evaluate(() => {
    const map = document.querySelector(
      '[aria-label="Interactive 3D Earth"]',
    )?.firstElementChild;
    return typeof map?.heading === 'number' ? map.heading : null;
  });
  await page.waitForTimeout(2_000);
  const afterHeading = await page.evaluate(() => {
    const map = document.querySelector(
      '[aria-label="Interactive 3D Earth"]',
    )?.firstElementChild;
    return typeof map?.heading === 'number' ? map.heading : null;
  });

  const stopResult = await page.evaluate(() => {
    const map = document.querySelector(
      '[aria-label="Interactive 3D Earth"]',
    )?.firstElementChild;
    const input = document.querySelector('#destination-input');
    if (!map || !input || typeof map.stopCameraAnimation !== 'function') {
      return { instrumented: false, stopCalls: 0 };
    }
    const original = map.stopCameraAnimation.bind(map);
    let stopCalls = 0;
    try {
      map.stopCameraAnimation = () => {
        stopCalls += 1;
        return original();
      };
      input.focus();
      return { instrumented: true, stopCalls };
    } catch {
      return { instrumented: false, stopCalls: 0 };
    }
  });

  const screenshotPath =
    'C:/Users/Asus/Documents/ChatGPT/Codenection/destination-globe-1366x768.png';
  await page.screenshot({ path: screenshotPath });

  const state = await page.evaluate(() => {
    const mapContainer = document.querySelector(
      '[aria-label="Interactive 3D Earth"]',
    );
    const map = mapContainer?.firstElementChild;
    const input = document.querySelector('#destination-input');
    const main = document.querySelector('main');
    const rect = mapContainer?.getBoundingClientRect();
    return {
      mapTag: map?.tagName ?? null,
      mapChildPresent: Boolean(map),
      mapRect: rect
        ? { width: rect.width, height: rect.height, x: rect.x, y: rect.y }
        : null,
      unavailableMessage: document.body.innerText.includes(
        '3D Earth needs a browser-restricted Google Maps JavaScript API key.',
      ),
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      main: main
        ? { scrollWidth: main.scrollWidth, scrollHeight: main.scrollHeight }
        : null,
      inputVisible: Boolean(input?.getBoundingClientRect().width),
      mapsScriptLoaded: Array.from(document.scripts).some((script) =>
        script.src.startsWith('https://maps.googleapis.com/maps/api/js'),
      ),
    };
  });

  console.log(
    JSON.stringify(
      {
        ...state,
        beforeHeading,
        afterHeading,
        headingChanged:
          beforeHeading !== null &&
          afterHeading !== null &&
          Math.abs(afterHeading - beforeHeading) > 0.01,
        stopResult,
        consoleErrors: consoleErrors.map((message) =>
          message.replace(/key=[^&\s]+/gi, 'key=[redacted]'),
        ),
        screenshotPath,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
