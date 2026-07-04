import React from "react";
import { Suspense } from "react";
import PortalMessagesClient from "./PortalMessagesClient";

export default function PortalMessagesPage() {
  return (
    <Suspense fallback={null}>
      <PortalMessagesClient />
    </Suspense>
  );
}
