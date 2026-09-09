import "@testing-library/jest-dom/vitest";
import { installDomEnvironment } from "./dom-env";

// jsdom does not implement matchMedia, and Node 25's experimental Web Storage
// shadows the DOM's. See dom-env.ts for why both need replacing.
installDomEnvironment();
