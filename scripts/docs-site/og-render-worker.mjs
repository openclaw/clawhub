import { parentPort, workerData } from "node:worker_threads";
import { Resvg } from "@resvg/resvg-js";

try {
  const png = new Resvg(workerData.svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  parentPort.postMessage({ png });
} catch (err) {
  parentPort.postMessage({ error: err.message });
}
