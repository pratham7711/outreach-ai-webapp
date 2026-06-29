type Listener = (event: { data: unknown }) => void;

class PolyfilledMessagePort {
  onmessage: Listener | null = null;
  otherPort: PolyfilledMessagePort | null = null;
  postMessage(data: unknown): void {
    const target = this.otherPort;
    if (!target) return;
    queueMicrotask(() => {
      if (target.onmessage) target.onmessage({ data });
    });
  }
  start(): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

class PolyfilledMessageChannel {
  port1: PolyfilledMessagePort;
  port2: PolyfilledMessagePort;
  constructor() {
    this.port1 = new PolyfilledMessagePort();
    this.port2 = new PolyfilledMessagePort();
    this.port1.otherPort = this.port2;
    this.port2.otherPort = this.port1;
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.MessageChannel === "undefined") {
  g.MessageChannel = PolyfilledMessageChannel;
}
if (typeof g.MessagePort === "undefined") {
  g.MessagePort = PolyfilledMessagePort;
}

import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from "util";

if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = NodeTextEncoder;
}
if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = NodeTextDecoder;
}

export {};
